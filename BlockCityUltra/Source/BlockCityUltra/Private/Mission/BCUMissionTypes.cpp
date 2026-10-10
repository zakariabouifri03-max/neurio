// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Mission/BCUMissionTypes.h"

#include "Police/BCUPoliceSubsystem.h"
#include "World/Weather/BCUTimeOfDaySystem.h"
#include "Player/BCUPlayerCharacter.h"
#include "Vehicle/BCUBaseVehicle.h"
#include "Kismet/GameplayStatics.h"
#include "GameFramework/Actor.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUMission, Log, All);

//═══════════════════════════════════════════════════════════════════════════════
// UBCUMissionDefinition
//═══════════════════════════════════════════════════════════════════════════════

bool UBCUMissionDefinition::AreRequirementsMet(int32 CompletedMissions, int32 Reputation,
	const TArray<FName>& CompletedIds, float CurrentHour) const
{
	if (CompletedMissions < MinCompletedMissions)
	{
		return false;
	}

	if (Reputation < MinReputation)
	{
		return false;
	}

	for (const FName& Required : RequiredCompletedMissions)
	{
		if (!CompletedIds.Contains(Required))
		{
			return false;
		}
	}

	// Time window wraps midnight when Latest < Earliest (e.g. 22:00 → 04:00).
	if (LatestStartHour > EarliestStartHour)
	{
		if (CurrentHour < EarliestStartHour || CurrentHour > LatestStartHour)
		{
			return false;
		}
	}
	else if (LatestStartHour < EarliestStartHour)
	{
		if (CurrentHour < EarliestStartHour && CurrentHour > LatestStartHour)
		{
			return false;
		}
	}

	return true;
}

//═══════════════════════════════════════════════════════════════════════════════
// UBCUMission
//═══════════════════════════════════════════════════════════════════════════════

void UBCUMission::StartMission_Implementation(UBCUMissionDefinition* InDefinition)
{
	Definition = InDefinition;
	if (!Definition)
	{
		State = EBCUMissionState::NotStarted;
		return;
	}

	RuntimeObjectives = Definition->Objectives;
	CurrentObjectiveIndex = 0;
	ElapsedSeconds = 0.0f;
	ObjectiveElapsedSeconds = 0.0f;
	State = EBCUMissionState::Active;

	// Snapshot health so the no-damage bonus is measurable.
	if (const ACharacter* Player = UGameplayStatics::GetPlayerCharacter(this, 0))
	{
		DamageTakenAtStart = 0.0f;
		(void)Player;
	}

	// Freeze the clock / force weather / preload cells as the definition asks.
	if (UWorld* World = GetWorld())
	{
		if (Definition->bFreezesTimeOfDay)
		{
			if (UBCUTimeOfDaySystem* TOD = World->GetSubsystem<UBCUTimeOfDaySystem>())
			{
				TOD->SetAutoAdvance(false);
			}
		}

		if (Definition->ForcedWantedLevel > 0)
		{
			if (UBCUPoliceSubsystem* Police = World->GetSubsystem<UBCUPoliceSubsystem>())
			{
				Police->SetWantedLevel(Definition->ForcedWantedLevel);
			}
		}
	}

	UE_LOG(LogBCUMission, Log, TEXT("Mission started: %s (%d objectives)"),
		*Definition->Title.ToString(), RuntimeObjectives.Num());
}

void UBCUMission::UpdateMission_Implementation(float DeltaTime)
{
	if (State != EBCUMissionState::Active)
	{
		return;
	}

	ElapsedSeconds += DeltaTime;
	ObjectiveElapsedSeconds += DeltaTime;

	EvaluateObjective(DeltaTime);
}

void UBCUMission::EvaluateObjective(float DeltaTime)
{
	(void)DeltaTime;

	FBCUObjective* Objective = RuntimeObjectives.IsValidIndex(CurrentObjectiveIndex)
		? &RuntimeObjectives[CurrentObjectiveIndex] : nullptr;
	if (!Objective)
	{
		EndMission(/*bSuccess=*/true);
		return;
	}

	UWorld* World = GetWorld();
	const APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!World || !PlayerPawn)
	{
		return;
	}

	// Objective time limit.
	if (Objective->TimeLimitSeconds > 0.0f && ObjectiveElapsedSeconds > Objective->TimeLimitSeconds)
	{
		if (Objective->bIsMandatory)
		{
			FailMission(FText::Format(
				NSLOCTEXT("BCU", "Mission_TimeExpired", "Out of time: {0}"), Objective->Description));
		}
		else
		{
			NextObjective();
		}
		return;
	}

	switch (Objective->Type)
	{
	case EBCUObjectiveType::GoToLocation:
	case EBCUObjectiveType::DriveRoute:
	{
		// Checkpoints are spherical triggers evaluated by distance — cheaper and
		// more forgiving than physics overlaps for a driving game.
		while (Objective->CurrentCheckpoint < Objective->Checkpoints.Num())
		{
			const FBCUCheckpoint& CP = Objective->Checkpoints[Objective->CurrentCheckpoint];
			const float Distance = FVector::Dist(PlayerPawn->GetActorLocation(), CP.Location);

			if (Distance > CP.RadiusCm)
			{
				break;
			}

			if (CP.bRequiresVehicle && !Cast<ABCUBaseVehicle>(PlayerPawn))
			{
				break; // must be driving
			}

			Objective->CurrentCheckpoint++;
			Objective->Progress = Objective->CurrentCheckpoint;
			State = EBCUMissionState::ObjectiveUpdate;
		}

		if (Objective->CurrentCheckpoint >= Objective->Checkpoints.Num() && Objective->Checkpoints.Num() > 0)
		{
			Objective->bComplete = true;
			NextObjective();
		}
		break;
	}

	case EBCUObjectiveType::EvadePolice:
	{
		if (UBCUPoliceSubsystem* Police = World->GetSubsystem<UBCUPoliceSubsystem>())
		{
			// Success when the wanted level has dropped to (or below) the
			// requirement and stays there for the objective's time limit.
			if (Police->GetWantedLevel() <= Objective->WantedLevelRequirement)
			{
				Objective->Progress++;
				if (Objective->Progress >= 5) // ~5 seconds of clean driving
				{
					Objective->bComplete = true;
					NextObjective();
				}
			}
			else
			{
				Objective->Progress = 0;
			}
		}
		break;
	}

	case EBCUObjectiveType::ReachSpeed:
	{
		const ABCUBaseVehicle* Vehicle = Cast<ABCUBaseVehicle>(PlayerPawn);
		const float SpeedKmh = Vehicle ? Vehicle->GetSpeedKmh() : 0.0f;
		if (SpeedKmh >= Objective->SpeedRequirementKmh)
		{
			Objective->bComplete = true;
			NextObjective();
		}
		break;
	}

	case EBCUObjectiveType::StealVehicle:
	{
		const ABCUBaseVehicle* Vehicle = Cast<ABCUBaseVehicle>(PlayerPawn);
		if (Vehicle && Vehicle->GetVehicleId() == Objective->RequiredVehicleId)
		{
			Objective->bComplete = true;
			NextObjective();
		}
		break;
	}

	case EBCUObjectiveType::SurviveTimed:
	{
		if (ObjectiveElapsedSeconds >= Objective->TimeLimitSeconds)
		{
			Objective->bComplete = true;
			NextObjective();
		}
		break;
	}

	case EBCUObjectiveType::CollectItems:
	case EBCUObjectiveType::DeliverItem:
	case EBCUObjectiveType::EliminateTarget:
	case EBCUObjectiveType::ProtectTarget:
	case EBCUObjectiveType::PerformStunt:
	case EBCUObjectiveType::TalkToNPC:
	case EBCUObjectiveType::WaitForPlayer:
	case EBCUObjectiveType::Custom:
	default:
		// These are advanced externally (pickups, damage events, dialogue
		// completion, Blueprint logic). Nothing to poll here.
		break;
	}

	if (State == EBCUMissionState::ObjectiveUpdate)
	{
		State = EBCUMissionState::Active;
	}
}

void UBCUMission::AdvanceObjective(int32 Amount)
{
	FBCUObjective* Objective = RuntimeObjectives.IsValidIndex(CurrentObjectiveIndex)
		? &RuntimeObjectives[CurrentObjectiveIndex] : nullptr;
	if (!Objective)
	{
		return;
	}

	Objective->Progress = FMath::Max(0, Objective->Progress + Amount);

	if (Objective->Progress >= Objective->RequiredCount)
	{
		Objective->bComplete = true;
		NextObjective();
	}
}

bool UBCUMission::NextObjective()
{
	CurrentObjectiveIndex++;
	ObjectiveElapsedSeconds = 0.0f;

	if (CurrentObjectiveIndex >= RuntimeObjectives.Num())
	{
		EndMission(/*bSuccess=*/true);
		return false;
	}

	State = EBCUMissionState::ObjectiveUpdate;
	return true;
}

void UBCUMission::FailMission(const FText& Reason)
{
	UE_LOG(LogBCUMission, Log, TEXT("Mission failed: %s"), *Reason.ToString());
	EndMission(/*bSuccess=*/false);
}

void UBCUMission::EndMission_Implementation(bool bSuccess)
{
	if (State == EBCUMissionState::Success || State == EBCUMissionState::Failed)
	{
		return; // already ended
	}

	State = bSuccess ? EBCUMissionState::Success : EBCUMissionState::Failed;

	// Undo the world effects the definition applied.
	if (UWorld* World = GetWorld())
	{
		if (Definition && Definition->bFreezesTimeOfDay)
		{
			if (UBCUTimeOfDaySystem* TOD = World->GetSubsystem<UBCUTimeOfDaySystem>())
			{
				TOD->SetAutoAdvance(true);
			}
		}
	}

	// Clean up everything the mission spawned.
	for (AActor* Actor : SpawnedActors)
	{
		if (Actor && !Actor->IsPendingKillPending())
		{
			Actor->Destroy();
		}
	}
	SpawnedActors.Reset();

	UE_LOG(LogBCUMission, Log, TEXT("Mission %s in %.1f s"),
		bSuccess ? TEXT("succeeded") : TEXT("failed"), ElapsedSeconds);
}

const FBCUObjective* UBCUMission::GetCurrentObjective() const
{
	return RuntimeObjectives.IsValidIndex(CurrentObjectiveIndex)
		? &RuntimeObjectives[CurrentObjectiveIndex] : nullptr;
}

float UBCUMission::GetRemainingSeconds() const
{
	const FBCUObjective* Objective = GetCurrentObjective();
	if (!Objective || Objective->TimeLimitSeconds <= 0.0f)
	{
		return -1.0f;
	}

	return FMath::Max(0.0f, Objective->TimeLimitSeconds - ObjectiveElapsedSeconds);
}

void UBCUMission::TrackActor(AActor* Actor)
{
	if (Actor)
	{
		SpawnedActors.Add(Actor);
	}
}
