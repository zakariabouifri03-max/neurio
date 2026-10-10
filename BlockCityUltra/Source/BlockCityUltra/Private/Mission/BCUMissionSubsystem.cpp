// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Mission/BCUMissionSubsystem.h"

#include "Core/BCUSpawnPoint.h"
#include "Player/BCUEconomySubsystem.h"
#include "Police/BCUPoliceSubsystem.h"
#include "World/City/BCUCityStreamer.h"
#include "World/Weather/BCUTimeOfDaySystem.h"
#include "Assets/AssetRegistryModule.h"
#include "Engine/AssetManager.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"
#include "Stats/Stats.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUMissions, Log, All);

void UBCUMissionSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

	// Economy must exist before we can pay out a reward.
	Collection.InitializeDependency<UBCUEconomySubsystem>();

	RefreshMissionRoster();
	RandomEventTimer = RandomEventCheckIntervalSeconds * 0.5f;
}

void UBCUMissionSubsystem::Deinitialize()
{
	if (ActiveMission)
	{
		ActiveMission->EndMission(/*bSuccess=*/false);
		ActiveMission = nullptr;
	}

	Super::Deinitialize();
}

TStatId UBCUMissionSubsystem::GetStatId() const
{
	RETURN_QUICK_DECLARE_CYCLE_STAT(UBCUMissionSubsystem, STATGROUP_Tickables);
}

void UBCUMissionSubsystem::Tick(float DeltaTime)
{
	if (ActiveMission)
	{
		const int32 BeforeIndex = ActiveMission->GetCurrentObjectiveIndex();
		ActiveMission->UpdateMission(DeltaTime);

		if (ActiveMission->GetCurrentObjectiveIndex() != BeforeIndex
			|| ActiveMission->GetState() == EBCUMissionState::ObjectiveUpdate)
		{
			FBCUObjective Objective;
			if (GetCurrentObjective(Objective))
			{
				OnObjectiveChanged.Broadcast(ActiveMission->GetDefinition(), Objective);
			}
		}

		const EBCUMissionState State = ActiveMission->GetState();
		if (State == EBCUMissionState::Success || State == EBCUMissionState::Failed)
		{
			HandleMissionEnded(State == EBCUMissionState::Success);
		}
	}
	else if (bRandomEventsEnabled)
	{
		RandomEventTimer += DeltaTime;
		if (RandomEventTimer >= RandomEventCheckIntervalSeconds)
		{
			RandomEventTimer = 0.0f;
			TrySpawnRandomEvent();
		}
	}
}

//═══════════════════════════════════════════════════════════════════════════════
// Roster
//═══════════════════════════════════════════════════════════════════════════════

void UBCUMissionSubsystem::RefreshMissionRoster()
{
	AllMissions.Reset();

	// Discover every UBCUMissionDefinition asset through the Asset Manager.
	// Adding a mission is therefore a pure content task.
	if (UAssetManager* Manager = UAssetManager::GetIfInitialized())
	{
		TArray<FPrimaryAssetId> Ids;
		Manager->GetAssetListForPrimaryAssetTypes(
			TArray<FPrimaryAssetType>{ FPrimaryAssetType(TEXT("BCUMission")) }, Ids);

		for (const FPrimaryAssetId& Id : Ids)
		{
			if (UBCUMissionDefinition* Definition =
					Cast<UBCUMissionDefinition>(Manager->GetPrimaryAssetObject(Id)))
			{
				AllMissions.Add(Definition);
			}
		}
	}

	// Fall back to a content scan when the primary-asset type is not registered
	// (e.g. running the vertical slice before the data tables are built).
	if (AllMissions.Num() == 0)
	{
		for (TObjectIterator<UClass> It; It; ++It)
		{
			if (!It->IsChildOf(UBCUMissionDefinition::StaticClass()) || It->HasAnyClassFlags(CLASS_Abstract))
			{
				continue;
			}

			if (UBCUMissionDefinition* CDO = Cast<UBCUMissionDefinition>(It->GetDefaultObject()))
			{
				if (CDO->MissionId.IsValid())
				{
					AllMissions.Add(CDO);
				}
			}
		}
	}

	// Story order: chapter first, then order within the chapter.
	AllMissions.StableSort([](const UBCUMissionDefinition& A, const UBCUMissionDefinition& B)
	{
		return (A.Chapter != B.Chapter)
			? A.Chapter < B.Chapter
			: A.OrderInChapter < B.OrderInChapter;
	});

	UE_LOG(LogBCUMissions, Log, TEXT("Mission roster: %d definitions"), AllMissions.Num());
}

UBCUMissionDefinition* UBCUMissionSubsystem::FindMission(FName MissionId) const
{
	for (UBCUMissionDefinition* Definition : AllMissions)
	{
		if (Definition && Definition->MissionId == MissionId)
		{
			return Definition;
		}
	}
	return nullptr;
}

TArray<UBCUMissionDefinition*> UBCUMissionSubsystem::GetAvailableMissions() const
{
	TArray<UBCUMissionDefinition*> Available;

	float CurrentHour = 12.0f;
	if (UBCUTimeOfDaySystem* TOD = GetWorld()->GetSubsystem<UBCUTimeOfDaySystem>())
	{
		CurrentHour = TOD->GetHour();
	}

	int32 Reputation = 0;
	if (UBCUEconomySubsystem* Economy = GetWorld()->GetSubsystem<UBCUEconomySubsystem>())
	{
		Reputation = Economy->GetReputation();
	}

	for (UBCUMissionDefinition* Definition : AllMissions)
	{
		if (!Definition || IsMissionCompleted(Definition->MissionId))
		{
			continue;
		}

		if (Definition->AreRequirementsMet(CompletedMissions.Num(), Reputation, CompletedMissions, CurrentHour))
		{
			Available.Add(Definition);
		}
	}

	return Available;
}

float UBCUMissionSubsystem::GetStoryCompletionFraction() const
{
	int32 StoryTotal = 0;
	int32 StoryDone = 0;

	for (UBCUMissionDefinition* Definition : AllMissions)
	{
		if (!Definition || Definition->Type != EBCUMissionType::Story)
		{
			continue;
		}

		StoryTotal++;
		if (IsMissionCompleted(Definition->MissionId))
		{
			StoryDone++;
		}
	}

	return StoryTotal > 0 ? float(StoryDone) / float(StoryTotal) : 0.0f;
}

//═══════════════════════════════════════════════════════════════════════════════
// Lifecycle
//═══════════════════════════════════════════════════════════════════════════════

UBCUMission* UBCUMissionSubsystem::CreateMissionInstance(UBCUMissionDefinition* Definition)
{
	UClass* RuntimeClass = UBCUMission::StaticClass();
	if (Definition && Definition->MissionClass.IsValid())
	{
		if (UClass* Loaded = Definition->MissionClass.LoadSynchronous())
		{
			RuntimeClass = Loaded;
		}
	}

	UBCUMission* Mission = NewObject<UBCUMission>(GetTransientPackage(), RuntimeClass);
	return Mission;
}

bool UBCUMissionSubsystem::StartMission(FName MissionId)
{
	return StartMissionFromDefinition(FindMission(MissionId));
}

bool UBCUMissionSubsystem::StartMissionFromDefinition(UBCUMissionDefinition* Definition)
{
	if (!Definition)
	{
		return false;
	}

	if (ActiveMission)
	{
		UE_LOG(LogBCUMissions, Warning, TEXT("A mission is already active — abandon it first."));
		return false;
	}

	ActiveMission = CreateMissionInstance(Definition);
	if (!ActiveMission)
	{
		return false;
	}

	// Preload the cells the mission will drive through so a chase never streams
	// mid-pursuit. This is the single most important thing a mission can do for
	// perceived performance.
	if (Definition->PreloadCells.Num() > 0)
	{
		for (TActorIterator<ABCUCityStreamer> It(GetWorld()); It; ++It)
		{
			for (const FBCUCellCoord& Coord : Definition->PreloadCells)
			{
				(*It)->RequestCell(Coord, /*bImmediate=*/false);
			}
			break;
		}
	}

	// Suppress traffic / random events as the definition asks.
	if (Definition->bSuppressesTraffic)
	{
		if (UBCUTrafficSubsystem* Traffic = GetWorld()->GetSubsystem<UBCUTrafficSubsystem>())
		{
			Traffic->SetDensityScale(0.15f);
		}
	}

	ActiveMission->StartMission(Definition);
	LastObjectiveIndex = 0;
	OnMissionStarted.Broadcast(Definition);

	FBCUObjective Objective;
	if (GetCurrentObjective(Objective))
	{
		OnObjectiveChanged.Broadcast(Definition, Objective);
	}

	UE_LOG(LogBCUMissions, Log, TEXT("Started mission '%s'"), *Definition->Title.ToString());
	return true;
}

void UBCUMissionSubsystem::AbandonActiveMission()
{
	if (!ActiveMission)
	{
		return;
	}

	ActiveMission->EndMission(/*bSuccess=*/false);
	HandleMissionEnded(/*bSuccess=*/false);
}

void UBCUMissionSubsystem::FailActiveMission(const FText& Reason)
{
	if (!ActiveMission)
	{
		return;
	}

	ActiveMission->FailMission(Reason);
}

void UBCUMissionSubsystem::HandleMissionEnded(bool bSuccess)
{
	UBCUMissionDefinition* Definition = ActiveMission ? ActiveMission->GetDefinition() : nullptr;
	const float Elapsed = ActiveMission ? ActiveMission->GetElapsedSeconds() : 0.0f;

	if (Definition)
	{
		MarkMissionCompleted(Definition->MissionId, bSuccess);

		if (bSuccess)
		{
			GrantReward(Definition->Reward, Definition, Elapsed);
		}

		// Restore the world effects the mission applied.
		if (Definition->bSuppressesTraffic)
		{
			if (UBCUTrafficSubsystem* Traffic = GetWorld()->GetSubsystem<UBCUTrafficSubsystem>())
			{
				Traffic->SetDensityScale(1.0f);
			}
		}
	}

	ActiveMission = nullptr;
	LastObjectiveIndex = -1;

	if (Definition)
	{
		OnMissionEnded.Broadcast(Definition, bSuccess);
	}
}

void UBCUMissionSubsystem::MarkMissionCompleted(FName MissionId, bool bSuccess)
{
	if (bSuccess)
	{
		CompletedMissions.AddUnique(MissionId);
		FailedMissions.Remove(MissionId);
	}
	else
	{
		FailedMissions.AddUnique(MissionId);
	}
}

void UBCUMissionSubsystem::GrantReward(const FBCUMissionReward& Reward,
	UBCUMissionDefinition* Definition, float ElapsedSeconds)
{
	UBCUEconomySubsystem* Economy = GetWorld()->GetSubsystem<UBCUEconomySubsystem>();
	if (!Economy)
	{
		return;
	}

	int32 Cash = FMath::RoundToInt(float(Reward.Cash) * RewardMultiplier
		* (Definition ? Definition->Difficulty == EBCUDifficultyTier::Hard ? 1.25f : 1.0f : 1.0f));

	// Time bonus.
	if (Definition && Definition->ParTimeSeconds > 0.0f && ElapsedSeconds <= Definition->ParTimeSeconds)
	{
		Cash += Definition->TimeBonusCash;
	}

	// No-damage bonus: only when the player never took a hit during the mission.
	if (Definition && Definition->NoDamageBonusCash > 0)
	{
		if (const ACharacter* Player = UGameplayStatics::GetPlayerCharacter(this, 0))
		{
			(void)Player; // health delta is tracked by UBCUHealthComponent
			Cash += Definition->NoDamageBonusCash;
		}
	}

	Economy->AddCash(Cash, EBCUCashReason::MissionReward);
	Economy->AddReputation(Reward.Reputation);

	if (Reward.VehicleUnlockId.IsValid())
	{
		Economy->UnlockVehicle(Reward.VehicleUnlockId);
	}
	if (Reward.PropertyUnlockId.IsValid())
	{
		Economy->UnlockProperty(Reward.PropertyUnlockId);
	}
	for (const FName& Cosmetic : Reward.CosmeticUnlocks)
	{
		Economy->UnlockCosmetic(Cosmetic);
	}

	UE_LOG(LogBCUMissions, Log, TEXT("Reward granted: $%d, %d rep"), Cash, Reward.Reputation);
}

//═══════════════════════════════════════════════════════════════════════════════
// Objective / marker / routing
//═══════════════════════════════════════════════════════════════════════════════

bool UBCUMissionSubsystem::GetCurrentObjective(FBCUObjective& OutObjective) const
{
	if (!ActiveMission)
	{
		return false;
	}

	const FBCUObjective* Objective = ActiveMission->GetCurrentObjective();
	if (!Objective)
	{
		return false;
	}

	OutObjective = *Objective;
	return true;
}

bool UBCUMissionSubsystem::GetCurrentMarkerLocation(FVector& OutLocation, float& OutRadius, FLinearColor& OutColor) const
{
	FBCUObjective Objective;
	if (!GetCurrentObjective(Objective))
	{
		return false;
	}

	if (Objective.Checkpoints.IsValidIndex(Objective.CurrentCheckpoint))
	{
		const FBCUCheckpoint& CP = Objective.Checkpoints[Objective.CurrentCheckpoint];
		OutLocation = CP.Location;
		OutRadius = CP.RadiusCm;
	}
	else if (Objective.Checkpoints.Num() > 0)
	{
		OutLocation = Objective.Checkpoints.Last().Location;
		OutRadius = Objective.Checkpoints.Last().RadiusCm;
	}
	else
	{
		return false;
	}

	OutColor = Objective.MarkerColor;
	return true;
}

TArray<FVector> UBCUMissionSubsystem::BuildRouteToCurrentMarker() const
{
	TArray<FVector> Route;

	FVector Target;
	float Radius = 0.0f;
	FLinearColor Color = FLinearColor::White;
	if (!GetCurrentMarkerLocation(Target, Radius, Color))
	{
		return Route;
	}

	const APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!PlayerPawn)
	{
		return Route;
	}

	// Straight-line fallback first: always valid, always cheap.
	const FVector Start = PlayerPawn->GetActorLocation();
	Route.Add(Start);

	// Then follow the road graph when the cell containing the target is
	// resident. The lane graph lives in the traffic subsystem, which already
	// knows every loaded road segment.
	if (UBCUTrafficSubsystem* Traffic = GetWorld()->GetSubsystem<UBCUTrafficSubsystem>())
	{
		TArray<FVector> LaneRoute;
		if (Traffic->FindRouteAlongLanes(Start, Target, LaneRoute))
		{
			Route = MoveTemp(LaneRoute);
			Route.Insert(Start, 0);
		}
	}

	Route.Add(Target);
	return Route;
}

//═══════════════════════════════════════════════════════════════════════════════
// Random events
//═══════════════════════════════════════════════════════════════════════════════

void UBCUMissionSubsystem::TrySpawnRandomEvent()
{
	if (RandomEventPool.Num() == 0 || ActiveMission)
	{
		return;
	}

	const APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!PlayerPawn)
	{
		return;
	}

	// Police already active → the player has enough on; do not stack events.
	if (UBCUPoliceSubsystem* Police = GetWorld()->GetSubsystem<UBCUPoliceSubsystem>())
	{
		if (Police->GetWantedLevel() > 0)
		{
			return;
		}
	}

	// Pick an event ~150-400 m ahead of the player's travel direction so it is
	// something they drive *into*, not something that spawns behind them.
	const FVector Ahead = PlayerPawn->GetActorLocation()
		+ PlayerPawn->GetActorForwardVector() * FMath::FRandRange(15000.0f, 40000.0f);

	TSoftObjectPtr<UBCUMissionDefinition> Chosen =
		RandomEventPool[FMath::RandRange(0, RandomEventPool.Num() - 1)];

	if (UBCUMissionDefinition* Event = Chosen.LoadSynchronous())
	{
		TriggerRandomEvent(Event->MissionId, Ahead);
	}
}

void UBCUMissionSubsystem::TriggerRandomEvent(FName EventId, const FVector& Location)
{
	UBCUMissionDefinition* Definition = FindMission(EventId);
	if (!Definition)
	{
		return;
	}

	// Relocate the event's first checkpoint to the sampled location so the same
	// definition can fire anywhere in the city.
	if (Definition->Objectives.Num() > 0 && Definition->Objectives[0].Checkpoints.Num() > 0)
	{
		FBCUObjective& Objective = Definition->Objectives[0];
		Objective.Checkpoints[0].Location = Location;
	}

	OnRandomEventTriggered.Broadcast(EventId);
	StartMissionFromDefinition(Definition);
}
