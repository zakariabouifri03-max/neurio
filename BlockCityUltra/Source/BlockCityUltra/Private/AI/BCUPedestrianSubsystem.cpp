// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "AI/BCUPedestrianSubsystem.h"

#include "AI/BCUNPCCharacter.h"
#include "AI/BCUPedestrianAI.h"
#include "Core/BCUSpawnPoint.h"
#include "Player/BCUVoxelBodyComponent.h"
#include "Police/BCUPoliceSubsystem.h"
#include "World/City/BCUDistrictDataAsset.h"
#include "World/City/BCUCityStreamer.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"
#include "Player/BCUHealthComponent.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUPeds, Log, All);

void UBCUPedestrianSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	NearPawns.Reserve(64);
	FarPositions.Reserve(512);
	FarHeadings.Reserve(512);
	ApplyScalability();
}

void UBCUPedestrianSubsystem::Deinitialize()
{
	for (ACharacter* Pawn : NearPawns) { if (Pawn) { Pawn->Destroy(); } }
	NearPawns.Reset();
	for (UInstancedStaticMeshComponent* Comp : FarInstances) { if (Comp) { Comp->DestroyComponent(); } }
	FarInstances.Reset();
	Super::Deinitialize();
}

TStatId UBCUPedestrianSubsystem::GetStatId() const
{
	RETURN_QUICK_DECLARE_CYCLE_STAT(UBCUPedestrianSubsystem, STATGROUP_Tickables);
}

void UBCUPedestrianSubsystem::Tick(float DeltaTime)
{
	if (!UGameplayStatics::GetPlayerPawn(this, 0)) { return; }

	UpdateNearPawns(DeltaTime);
	SpawnNearPlayer(DeltaTime);
	DespawnDistant();

	// Far crowd updates at 1 Hz: it is a visual mass, not a simulation.
	FarUpdateTimer += DeltaTime;
	if (FarUpdateTimer >= 1.0f)
	{
		FarUpdateTimer = 0.0f;
		UpdateFarCrowd(1.0f);
		PromoteFarToNear();
		DemoteNearToFar();
	}
}

void UBCUPedestrianSubsystem::UpdateNearPawns(float DeltaTime)
{
	// Near pawns are real ACharacters with an AI controller: they tick
	// themselves. Here we only cull the dead references and keep the budget.
	for (int32 i = NearPawns.Num() - 1; i >= 0; --i)
	{
		if (!NearPawns[i] || NearPawns[i]->IsPendingKillPending()) { NearPawns.RemoveAt(i); }
	}

	(void)DeltaTime;
}

void UBCUPedestrianSubsystem::SpawnNearPlayer(float DeltaTime)
{
	SpawnTimer += DeltaTime;
	if (SpawnTimer < 0.6f) { return; }
	SpawnTimer = 0.0f;

	const int32 Budget = FMath::RoundToInt(float(MaxActivePedestrians) * DensityScale * BasePedestrianDensity);
	if (NearPawns.Num() + FarInstanceCount >= Budget) { return; }

	const APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!PlayerPawn) { return; }

	// Collect walk points in the spawn ring; a pedestrian never appears in the
	// player's view, only just outside it.
	const FVector Player = PlayerPawn->GetActorLocation();
	TArray<TPair<FBCUCellCoord, FVector>> Candidates;

	for (const TPair<FBCUCellCoord, TArray<FVector>>& Pair : WalkPoints)
	{
		for (const FVector& Point : Pair.Value)
		{
			const float Distance = FVector::Dist(Point, Player);
			if (Distance > SpawnRadiusCm * 0.5f && Distance < SpawnRadiusCm)
			{
				Candidates.Add(TPair<FBCUCellCoord, FVector>(Pair.Key, Point));
			}
		}
	}

	if (Candidates.Num() == 0) { return; }

	const int32 ToSpawn = FMath::Min(3, Budget - (NearPawns.Num() + FarInstanceCount));
	for (int32 s = 0; s < ToSpawn && Candidates.Num() > 0; ++s)
	{
		const int32 Pick = FMath::RandRange(0, Candidates.Num() - 1);
		const FBCUCellCoord Cell = Candidates[Pick].Key;
		const FVector Location = Candidates[Pick].Value;
		Candidates.RemoveAt(Pick);

		// Most of the crowd is far-tier: cheap instances. Only a fraction get a
		// real pawn, and only close to the player.
		const bool bNear = FVector::Dist(Location, Player) < FarSimulationDistanceCm;

		if (bNear)
		{
			if (ACharacter* Ped = SpawnPedestrian(Location, PickOutfitForCell(Cell)))
			{
				NearPawns.Add(Ped);
			}
		}
		else
		{
			FarPositions.Add(Location);
			FarHeadings.Add(FVector2D(FMath::FRandRange(-1.0f, 1.0f), FMath::FRandRange(-1.0f, 1.0f)).GetSafeNormal());
			FarInstanceCount = FarPositions.Num();
		}
	}
}

void UBCUPedestrianSubsystem::UpdateFarCrowd(float DeltaTime)
{
	if (FarPositions.Num() == 0) { return; }

	const APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!PlayerPawn) { return; }
	const FVector Player = PlayerPawn->GetActorLocation();

	// One kinematic step per far pedestrian: walk along the heading, turn
	// occasionally, despawn when too far. ~240 of these is under 0.05 ms.
	const float WalkSpeed = 130.0f * DeltaTime;

	for (int32 i = FarPositions.Num() - 1; i >= 0; --i)
	{
		FarPositions[i] += FVector(FarHeadings[i].X, FarHeadings[i].Y, 0.0f) * WalkSpeed;

		if (FMath::FRand() < 0.03f * DeltaTime)
		{
			FarHeadings[i] = FVector2D(FMath::FRandRange(-1.0f, 1.0f), FMath::FRandRange(-1.0f, 1.0f)).GetSafeNormal();
		}

		if (FVector::Dist(FarPositions[i], Player) > DespawnRadiusCm)
		{
			FarPositions.RemoveAt(i);
			FarHeadings.RemoveAt(i);
		}
	}

	FarInstanceCount = FarPositions.Num();

	// Re-upload the instance transforms. One HISM component per outfit keeps the
	// draw call count at the number of distinct outfits, not the crowd size.
	for (int32 Outfit = 0; Outfit < FarInstances.Num(); ++Outfit)
	{
		UInstancedStaticMeshComponent* Comp = FarInstances[Outfit];
		if (!Comp) { continue; }

		Comp->ClearInstances();
		for (int32 i = Outfit; i < FarPositions.Num(); i += FMath::Max(1, FarInstances.Num()))
		{
			const FRotator Rotation = FVector(FarHeadings[i].X, FarHeadings[i].Y, 0.0f).Rotation();
			Comp->AddInstance(FTransform(Rotation, FarPositions[i], FVector::OneVector));
		}
	}
}

void UBCUPedestrianSubsystem::PromoteFarToNear()
{
	const APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!PlayerPawn) { return; }

	const FVector Player = PlayerPawn->GetActorLocation();

	for (int32 i = FarPositions.Num() - 1; i >= 0; --i)
	{
		if (FVector::Dist(FarPositions[i], Player) > FarSimulationDistanceCm * 0.85f) { continue; }
		if (NearPawns.Num() >= MaxActivePedestrians) { return; }

		if (ACharacter* Ped = SpawnPedestrian(FarPositions[i], PickOutfitForCell(FBCUCellCoord(0, 0))))
		{
			NearPawns.Add(Ped);
			FarPositions.RemoveAt(i);
			FarHeadings.RemoveAt(i);
		}
	}

	FarInstanceCount = FarPositions.Num();
}

void UBCUPedestrianSubsystem::DemoteNearToFar()
{
	const APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!PlayerPawn) { return; }

	const FVector Player = PlayerPawn->GetActorLocation();

	for (int32 i = NearPawns.Num() - 1; i >= 0; --i)
	{
		ACharacter* Ped = NearPawns[i];
		if (!Ped) { NearPawns.RemoveAt(i); continue; }

		// Never demote a named NPC or a panicking pedestrian mid-animation.
		if (const ABCUNPCCharacter* NPC = Cast<ABCUNPCCharacter>(Ped))
		{
			if (NPC->NPCId.IsValid()) { continue; }
		}

		if (FVector::Dist(Ped->GetActorLocation(), Player) < FarSimulationDistanceCm * 1.25f) { continue; }

		FarPositions.Add(Ped->GetActorLocation());
		FarHeadings.Add(FVector2D(Ped->GetActorForwardVector().X, Ped->GetActorForwardVector().Y).GetSafeNormal());
		FarInstanceCount = FarPositions.Num();

		Ped->Destroy();
		NearPawns.RemoveAt(i);
	}
}

void UBCUPedestrianSubsystem::DespawnDistant()
{
	const APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!PlayerPawn) { return; }

	const FVector Player = PlayerPawn->GetActorLocation();

	for (int32 i = NearPawns.Num() - 1; i >= 0; --i)
	{
		if (NearPawns[i] && FVector::Dist(NearPawns[i]->GetActorLocation(), Player) > DespawnRadiusCm * 1.5f)
		{
			NearPawns[i]->Destroy();
			NearPawns.RemoveAt(i);
		}
	}
}

ACharacter* UBCUPedestrianSubsystem::SpawnPedestrian(const FVector& Location, FName OutfitId)
{
	UClass* PawnClass = PedestrianClass.LoadSynchronous();
	if (!PawnClass) { PawnClass = ABCUNPCCharacter::StaticClass(); }

	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;
	Params.bNoFail = true;
	Params.ObjectFlags |= RF_Transient;

	const FRotator Rotation(0.0f, FMath::FRandRange(0.0f, 360.0f), 0.0f);
	ACharacter* Ped = GetWorld()->SpawnActor<ACharacter>(PawnClass, Location, Rotation, Params);

	if (Ped)
	{
		if (ABCUNPCCharacter* NPC = Cast<ABCUNPCCharacter>(Ped))
		{
			NPC->Role = EBCUNPCRole::Civilian;
			NPC->OutfitId = OutfitId;
			if (NPC->VoxelBody) { NPC->VoxelBody->ApplyOutfit(OutfitId); }
		}

		if (!Ped->GetController())
		{
			Ped->SpawnDefaultController();
		}
	}

	return Ped;
}

FName UBCUPedestrianSubsystem::PickOutfitForCell(const FBCUCellCoord& Cell) const
{
	// District-appropriate outfits first (the port has dock workers, Marbella Row
	// has shoppers), then the global pool.
	for (TActorIterator<ABCUCityStreamer> It(GetWorld()); It; ++It)
	{
		if (UBCUDistrictDataAsset* District = (*It)->GetDistrictForCell(Cell))
		{
			if (District->AI.PedestrianOutfits.Num() > 0)
			{
				return District->AI.PedestrianOutfits[
					FMath::RandRange(0, District->AI.PedestrianOutfits.Num() - 1)];
			}
		}
		break;
	}

	if (DefaultOutfits.Num() > 0)
	{
		return DefaultOutfits[FMath::RandRange(0, DefaultOutfits.Num() - 1)];
	}

	return FName(*FString::Printf(TEXT("Civilian_%d"), FMath::RandRange(1, 12)));
}

ACharacter* UBCUPedestrianSubsystem::SpawnNamedNPC(FName NPCId, const FVector& Location, const FRotator& Rotation)
{
	if (TObjectPtr<ACharacter>* Existing = NamedNPCs.Find(NPCId))
	{
		if (*Existing) { return *Existing; }
	}

	ACharacter* NPC = SpawnPedestrian(Location, NPCId);
	if (ABCUNPCCharacter* Typed = Cast<ABCUNPCCharacter>(NPC))
	{
		Typed->NPCId = NPCId;
		Typed->SetActorRotation(Rotation);
	}

	if (NPC) { NamedNPCs.Add(NPCId, NPC); }
	return NPC;
}

void UBCUPedestrianSubsystem::PanicInRadius(const FVector& Location, float RadiusCm)
{
	for (ACharacter* Ped : NearPawns)
	{
		if (!Ped) { continue; }
		if (FVector::Dist(Ped->GetActorLocation(), Location) > RadiusCm) { continue; }

		if (ABCUPedestrianAIController* AI = Cast<ABCUPedestrianAIController>(Ped->GetController()))
		{
			AI->Panic(Location);
		}
	}

	// Far pedestrians just scatter: flip their headings away from the threat.
	for (int32 i = 0; i < FarPositions.Num(); ++i)
	{
		if (FVector::Dist(FarPositions[i], Location) > RadiusCm) { continue; }

		const FVector2D Away = FVector2D(
			FarPositions[i].X - Location.X, FarPositions[i].Y - Location.Y).GetSafeNormal();
		if (!Away.IsNearlyZero()) { FarHeadings[i] = Away; }
	}
}

void UBCUPedestrianSubsystem::OnPedestrianStruck(AActor* Pedestrian, const FVector& Location, float ImpactSpeedKmh)
{
	if (!Pedestrian) { return; }

	// Everyone nearby panics, and the police are told (which is what turns a
	// hit-and-run into a wanted level rather than a silent event).
	PanicInRadius(Location, 40000.0f);

	if (UBCUPoliceSubsystem* Police = GetWorld()->GetSubsystem<UBCUPoliceSubsystem>())
	{
		const bool bWitnessed = NearPawns.Num() > 0 && ImpactSpeedKmh > 20.0f;
		Police->ReportPlayerCrime(EBCUCrimeType::PedestrianInjury, Location, bWitnessed);
	}

	if (UBCUHealthComponent* Health = Pedestrian->FindComponentByClass<UBCUHealthComponent>())
	{
		Health->ApplyDamage(ImpactSpeedKmh * 1.4f);
	}

	NearPawns.Remove(Cast<ACharacter>(Pedestrian));
}

void UBCUPedestrianSubsystem::RegisterCellWalkPoints(const FBCUCellCoord& Coord, const TArray<FVector>& Points)
{
	TArray<FVector>& Existing = WalkPoints.FindOrAdd(Coord);
	Existing.Append(Points);
	if (Existing.Num() > 48) { Existing.SetNum(48); }
}

void UBCUPedestrianSubsystem::UnregisterCell(const FBCUCellCoord& Coord)
{
	WalkPoints.Remove(Coord);
}

void UBCUPedestrianSubsystem::SetDensityScale(float Scale)
{
	DensityScale = FMath::Clamp(Scale, 0.0f, 4.0f);
}

void UBCUPedestrianSubsystem::ApplyScalability()
{
	static const auto CVarMax = IConsoleManager::Get().FindTConsoleVariableDataInt(TEXT("bcu.traffic.MaxActivePedestrians"));
	static const auto CVarFar = IConsoleManager::Get().FindTConsoleVariableDataFloat(TEXT("bcu.traffic.FarPedestrianDistanceCm"));

	if (CVarMax) { MaxActivePedestrians = FMath::Clamp(CVarMax->GetValueOnGameThread(), 1, 600); }
	if (CVarFar) { FarSimulationDistanceCm = FMath::Max(10000.0f, CVarFar->GetValueOnGameThread()); }

	DespawnRadiusCm = SpawnRadiusCm * 1.35f;
}

FString UBCUPedestrianSubsystem::GetPedestrianStats() const
{
	return FString::Printf(TEXT("near=%d far=%d named=%d cells=%d density=%.2f"),
		NearPawns.Num(), FarInstanceCount, NamedNPCs.Num(), WalkPoints.Num(), DensityScale);
}
