// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Police/BCUPoliceSubsystem.h"

#include "Police/BCUPoliceUnit.h"
#include "Core/BCUGameState.h"
#include "Core/BCUGameMode.h"
#include "Core/BCUPlayerController.h"
#include "Core/BCUPlayerState.h"
#include "Core/BCUSpawnPoint.h"
#include "Player/BCUPlayerCharacter.h"
#include "Vehicle/BCUBaseVehicle.h"
#include "Vehicle/BCUVehicleDefinition.h"
#include "World/City/BCUCityStreamer.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"
#include "Stats/Stats.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUPolice, Log, All);

namespace BCUPolice
{
	// Heat table: how much each crime pushes the wanted meter. Tuned so a single
	// traffic violation is a nuisance and a heist is an immediate 4-star event.
	static float HeatFor(EBCUCrimeType Type)
	{
		switch (Type)
		{
		case EBCUCrimeType::TrafficViolation:	return 8.0f;
		case EBCUCrimeType::RecklessDriving:	return 18.0f;
		case EBCUCrimeType::PropertyDamage:		return 22.0f;
		case EBCUCrimeType::VehicleTheft:		return 34.0f;
		case EBCUCrimeType::PedestrianInjury:	return 40.0f;
		case EBCUCrimeType::Assault:			return 48.0f;
		case EBCUCrimeType::WeaponDischarge:	return 55.0f;
		case EBCUCrimeType::AssaultOnOfficer:	return 72.0f;
		case EBCUCrimeType::EvadingArrest:		return 60.0f;
		case EBCUCrimeType::Explosion:			return 95.0f;
		case EBCUCrimeType::Murder:				return 110.0f;
		case EBCUCrimeType::Heist:				return 160.0f;
		case EBCUCrimeType::HeliDown:			return 130.0f;
		default:								return 0.0f;
		}
	}

	// Wanted buckets. Level N starts at these heat values.
	static const float WantedThresholds[7] = { 0.0f, 25.0f, 70.0f, 150.0f, 280.0f, 460.0f, 700.0f };
}

void UBCUPoliceSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

	ActiveCrimes.Reserve(64);
	Orders.Reserve(MaxActivePursuitUnits * 2);
	ActiveUnits.Reserve(MaxActivePursuitUnits * 2);
}

void UBCUPoliceSubsystem::Deinitialize()
{
	for (ABCUPoliceUnit* Unit : ActiveUnits)
	{
		if (Unit)
		{
			Unit->Destroy();
		}
	}
	ActiveUnits.Reset();
	Orders.Reset();

	Super::Deinitialize();
}

TStatId UBCUPoliceSubsystem::GetStatId() const
{
	RETURN_QUICK_DECLARE_CYCLE_STAT(UBCUPoliceSubsystem, STATGROUP_Tickables);
}

void UBCUPoliceSubsystem::Tick(float DeltaTime)
{
	if (!GetWorld())
	{
		return;
	}

	UpdatePlayerTracking(DeltaTime);
	UpdateHeatAndWanted(DeltaTime);
	UpdateCrimes(DeltaTime);
	UpdateDispatch(DeltaTime);
	UpdateUnits(DeltaTime);
	UpdatePursuitPhase();
	DespawnDistantUnits();
}

//═══════════════════════════════════════════════════════════════════════════════
// Player tracking — line of sight, last known position, hiding
//═══════════════════════════════════════════════════════════════════════════════

void UBCUPoliceSubsystem::UpdatePlayerTracking(float DeltaTime)
{
	const APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!PlayerPawn)
	{
		bPlayerSpotted = false;
		return;
	}

	const FVector PlayerLocation = PlayerPawn->GetActorLocation();
	PlayerVelocity2D = FVector2D(PlayerPawn->GetVelocity().X, PlayerPawn->GetVelocity().Y);

	// A unit has visual if it is close enough and nothing blocks the ray. The
	// raycast goes against the *voxel* grid, which is exact and cheap.
	bool bAnyVisual = false;
	for (const ABCUPoliceUnit* Unit : ActiveUnits)
	{
		if (!Unit)
		{
			continue;
		}

		const float Distance = FVector::Dist(Unit->GetActorLocation(), PlayerLocation);
		if (Distance > FullSimulationDistanceCm)
		{
			continue;
		}

		if (Unit->HasLineOfSightTo(PlayerPawn))
		{
			bAnyVisual = true;
			break;
		}
	}

	// Hidden in a garage/safehouse: no unit can ever see the player.
	if (bPlayerHidden)
	{
		bAnyVisual = false;
	}

	bPlayerSpotted = bAnyVisual;

	if (bAnyVisual)
	{
		LastKnownPlayerLocation = PlayerLocation;
		LastSeenTime = GetWorld()->GetTimeSeconds();
	}
	else if (WantedLevel > 0)
	{
		// Predict forward from the last known position so a search grid covers
		// where the player is *going*, not just where they were.
		const double Elapsed = GetWorld()->GetTimeSeconds() - LastSeenTime;
		const float PredictSeconds = float(FMath::Min(Elapsed, 6.0));
		LastKnownPlayerLocation += FVector(
			PlayerVelocity2D.X * PredictSeconds, PlayerVelocity2D.Y * PredictSeconds, 0.0f);
	}

	(void)DeltaTime;
}

//═══════════════════════════════════════════════════════════════════════════════
// Heat and wanted level
//═══════════════════════════════════════════════════════════════════════════════

void UBCUPoliceSubsystem::UpdateHeatAndWanted(float DeltaTime)
{
	if (Heat <= 0.0f)
	{
		return;
	}

	// Decay only when unseen. This is the single rule that makes "lose the cops"
	// a real gameplay loop rather than a timer.
	const float DecayRate = bPlayerSpotted ? HeatDecayPerSecondSeen : HeatDecayPerSecondUnseen;
	if (DecayRate > 0.0f)
	{
		AddHeat(-DecayRate * DeltaTime * FMath::Lerp(0.6f, 1.6f, float(WantedLevel) / 6.0f));
	}

	// Being hidden accelerates the decay, so a garage is worth driving to.
	if (bPlayerHidden && !bPlayerSpotted)
	{
		AddHeat(-HeatDecayPerSecondUnseen * DeltaTime * 2.5f);
	}
}

void UBCUPoliceSubsystem::AddHeat(float Amount)
{
	const float OldHeat = Heat;
	Heat = FMath::Clamp(Heat + Amount * AggressionMultiplier, 0.0f, 1200.0f);

	const int32 NewLevel = WantedLevelForHeat(Heat);
	if (NewLevel != WantedLevel)
	{
		const int32 Old = WantedLevel;
		WantedLevel = NewLevel;

		// Mirror to the replicated player state so the HUD/co-op sees it.
		if (ABCUGameState* State = GetWorld()->GetGameState<ABCUGameState>())
		{
			(void)State;
		}
		if (const ABCUPlayerController* PC = Cast<ABCUPlayerController>(
				UGameplayStatics::GetPlayerController(this, 0)))
		{
			if (ABCUPlayerState* PS = PC->GetPlayerState<ABCUPlayerState>())
			{
				PS->SetWantedLevel(NewLevel);
			}
		}

		OnWantedLevelChanged.Broadcast(NewLevel, Old);
		UE_LOG(LogBCUPolice, Log, TEXT("Wanted %d → %d (heat %.0f → %.0f)"), Old, NewLevel, OldHeat, Heat);
	}
}

void UBCUPoliceSubsystem::SetWantedLevel(int32 NewLevel)
{
	NewLevel = FMath::Clamp(NewLevel, 0, 6);
	Heat = HeatForWantedLevel(NewLevel);
	AddHeat(0.0f); // recompute + broadcast
}

int32 UBCUPoliceSubsystem::WantedLevelForHeat(float InHeat) const
{
	for (int32 Level = 6; Level >= 1; --Level)
	{
		if (InHeat >= BCUPolice::WantedThresholds[Level])
		{
			return Level;
		}
	}
	return 0;
}

float UBCUPoliceSubsystem::HeatForWantedLevel(int32 Level) const
{
	return BCUPolice::WantedThresholds[FMath::Clamp(Level, 0, 6)];
}

float UBCUPoliceSubsystem::GetSecondsUntilNextDecay() const
{
	if (WantedLevel <= 0 || HeatDecayPerSecondUnseen <= 0.0f)
	{
		return -1.0f;
	}

	const float NextThreshold = BCUPolice::WantedThresholds[FMath::Max(0, WantedLevel - 1)];
	const float Needed = FMath::Max(0.0f, Heat - NextThreshold);
	const float Rate = HeatDecayPerSecondUnseen
		* FMath::Lerp(0.6f, 1.6f, float(WantedLevel) / 6.0f)
		* (bPlayerHidden ? 2.5f : 1.0f);

	return Rate > 0.0f ? Needed / Rate : -1.0f;
}

void UBCUPoliceSubsystem::ClearWantedLevel(bool bArrested)
{
	Heat = 0.0f;
	const int32 Old = WantedLevel;
	WantedLevel = 0;

	for (FBCUCrimeEvent& Crime : ActiveCrimes)
	{
		Crime.bExpired = true;
	}
	ActiveCrimes.Reset();

	for (FBCUDispatchOrder& Order : Orders)
	{
		if (Order.Unit)
		{
			Order.Unit->StandDown();
		}
	}
	Orders.Reset();

	SetPursuitPhase(EBCUPursuitPhase::None);
	OnWantedLevelChanged.Broadcast(0, Old);

	if (bArrested)
	{
		OnPlayerArrested.Broadcast(Old);
	}

	UE_LOG(LogBCUPolice, Log, TEXT("Wanted level cleared (%s)"), bArrested ? TEXT("arrested") : TEXT("escaped"));
}

void UBCUPoliceSubsystem::PlayerEnteredHideout()
{
	bPlayerHidden = true;
}

void UBCUPoliceSubsystem::PlayerLeftHideout()
{
	bPlayerHidden = false;
	if (WantedLevel > 0)
	{
		// Leaving a hideout with heat still on re-exposes the last known position.
		if (const APawn* P = UGameplayStatics::GetPlayerPawn(this, 0))
		{
			LastKnownPlayerLocation = P->GetActorLocation();
		}
	}
}

//═══════════════════════════════════════════════════════════════════════════════
// Crime events
//═══════════════════════════════════════════════════════════════════════════════

void UBCUPoliceSubsystem::ReportCrime(EBCUCrimeType Type, const FVector& Location, float HeatOverride)
{
	if (Type == EBCUCrimeType::None)
	{
		return;
	}

	FBCUCrimeEvent Event;
	Event.Type = Type;
	Event.Location = Location;
	Event.Timestamp = GetWorld()->GetTimeSeconds();
	Event.Heat = (HeatOverride >= 0.0f) ? HeatOverride : GetHeatForCrime(Type);

	for (TActorIterator<ABCUCityStreamer> It(GetWorld()); It; ++It)
	{
		Event.Cell = (*It)->WorldToCell(Location);
		break;
	}

	ActiveCrimes.Add(Event);

	// Cap the list: oldest un-investigated crimes expire first so a long rampage
	// does not grow the array without bound.
	if (ActiveCrimes.Num() > 128)
	{
		ActiveCrimes.RemoveAt(0, ActiveCrimes.Num() - 128);
	}

	UE_LOG(LogBCUPolice, Verbose, TEXT("Crime reported: %s at %s (heat %.0f)"),
		*UEnum::GetValueAsString(Type), *Location.ToString(), Event.Heat);
}

void UBCUPoliceSubsystem::ReportPlayerCrime(EBCUCrimeType Type, const FVector& Location, bool bWasWitnessed)
{
	ReportCrime(Type, Location);

	// Unwitnessed crime: half heat, and no unit is dispatched to the location
	// until a patrol stumbles on it.
	AddHeat(GetHeatForCrime(Type) * (bWasWitnessed ? 1.0f : 0.5f));

	if (!bWasWitnessed && ActiveCrimes.Num() > 0)
	{
		ActiveCrimes.Last().bExpired = false;
		ActiveCrimes.Last().bInvestigated = false;
	}
}

float UBCUPoliceSubsystem::GetHeatForCrime(EBCUCrimeType Type) const
{
	return BCUPolice::HeatFor(Type);
}

void UBCUPoliceSubsystem::UpdateCrimes(float DeltaTime)
{
	const double Now = GetWorld()->GetTimeSeconds();

	for (int32 i = ActiveCrimes.Num() - 1; i >= 0; --i)
	{
		FBCUCrimeEvent& Crime = ActiveCrimes[i];

		// Evidence expires: after a while nobody will come to look at it.
		if (!Crime.bInvestigated && (Now - Crime.Timestamp) > EvidenceMemorySeconds)
		{
			Crime.bExpired = true;
		}

		if (Crime.bExpired)
		{
			ActiveCrimes.RemoveAt(i);
		}
	}

	(void)DeltaTime;
}

//═══════════════════════════════════════════════════════════════════════════════
// Dispatch
//═══════════════════════════════════════════════════════════════════════════════

void UBCUPoliceSubsystem::UpdateDispatch(float DeltaTime)
{
	if (!bDispatchEnabled || WantedLevel <= 0)
	{
		DispatchTimer = 0.0f;
		return;
	}

	DispatchTimer += DeltaTime;

	// Response delay shrinks with the wanted level: a 1-star gets a slow cruiser,
	// a 5-star gets an immediate interceptor wall.
	const float ResponseDelay = ResponseDelayPerHeatSeconds
		/ FMath::Max(1.0f, float(WantedLevel))
		/ FMath::Max(0.2f, AggressionMultiplier);

	if (DispatchTimer < ResponseDelay)
	{
		return;
	}

	DispatchTimer = 0.0f;

	const int32 DesiredUnits = FMath::Clamp(WantedLevel * 2, 1, MaxActivePursuitUnits);
	const int32 CurrentUnits = GetActiveUnitCount();

	if (CurrentUnits >= DesiredUnits)
	{
		return;
	}

	const FVector SpawnLocation = ChooseSpawnLocationForResponse(WantedLevel);
	if (SpawnLocation.IsNearlyZero())
	{
		return;
	}

	SpawnPatrolUnit(SpawnLocation, WantedLevel);
}

FVector UBCUPoliceSubsystem::ChooseSpawnLocationForResponse(int32 WantedLevelNow) const
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return FVector::ZeroVector;
	}

	const APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!PlayerPawn)
	{
		return FVector::ZeroVector;
	}

	const FVector PlayerLocation = PlayerPawn->GetActorLocation();

	// Higher wanted levels spawn closer (they are already hunting you) and are
	// allowed to appear just off-screen rather than from a distant station.
	const float MinDistance = (WantedLevelNow >= 4) ? 12000.0f : 30000.0f;
	const float MaxDistance = (WantedLevelNow >= 4) ? 45000.0f : 110000.0f;

	TArray<FVector> Candidates;
	for (const TPair<FBCUCellCoord, TArray<FVector>>& Pair : PatrolPoints)
	{
		for (const FVector& Point : Pair.Value)
		{
			const float Distance = FVector::Dist(Point, PlayerLocation);
			if (Distance >= MinDistance && Distance <= MaxDistance)
			{
				Candidates.Add(Point);
			}
		}
	}

	// Fall back to authored police spawn points.
	if (Candidates.Num() == 0)
	{
		for (TActorIterator<ABCUSpawnPoint> It(World); It; ++It)
		{
			if ((*It)->Kind == EBCUSpawnKind::PolicePatrol || (*It)->Kind == EBCUSpawnKind::PoliceStation)
			{
				const float Distance = FVector::Dist((*It)->GetActorLocation(), PlayerLocation);
				if (Distance >= MinDistance * 0.5f && Distance <= MaxDistance * 3.0f)
				{
					Candidates.Add((*It)->GetActorLocation());
				}
			}
		}
	}

	if (Candidates.Num() == 0)
	{
		// Last resort: a ring around the player, off-camera.
		const float Angle = FMath::FRandRange(0.0f, 2.0f * PI);
		const float Distance = FMath::FRandRange(MinDistance, MaxDistance);
		return PlayerLocation + FVector(FMath::Cos(Angle) * Distance, FMath::Sin(Angle) * Distance, 120.0f);
	}

	return Candidates[FMath::RandRange(0, Candidates.Num() - 1)];
}

UBCUVehicleDefinition* UBCUPoliceSubsystem::ChooseVehicleForLevel(int32 Level) const
{
	const TArray<TSoftObjectPtr<UBCUVehicleDefinition>>* Pool = nullptr;

	if (Level >= 4 && InterceptorPool.Num() > 0)
	{
		Pool = &InterceptorPool;
	}
	else if (Level >= 3 && VanPool.Num() > 0 && FMath::RandBool())
	{
		Pool = &VanPool;
	}
	else if (CruiserPool.Num() > 0)
	{
		Pool = &CruiserPool;
	}
	else if (InterceptorPool.Num() > 0)
	{
		Pool = &InterceptorPool;
	}

	if (!Pool || Pool->Num() == 0)
	{
		return nullptr;
	}

	return (*Pool)[FMath::RandRange(0, Pool->Num() - 1)].LoadSynchronous();
}

void UBCUPoliceSubsystem::SpawnPatrolUnit(const FVector& SpawnLocation, int32 ForWantedLevel)
{
	UWorld* World = GetWorld();
	if (!World || ActiveUnits.Num() >= MaxActivePursuitUnits * 2)
	{
		return;
	}

	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;
	Params.bNoFail = true;
	Params.ObjectFlags |= RF_Transient;

	ABCUPoliceUnit* Unit = World->SpawnActor<ABCUPoliceUnit>(
		ABCUPoliceUnit::StaticClass(), SpawnLocation, FRotator(0.0f, FMath::FRandRange(0.0f, 360.0f), 0.0f), Params);

	if (!Unit)
	{
		return;
	}

	Unit->Initialise(this, ChooseVehicleForLevel(ForWantedLevel), ForWantedLevel);
	ActiveUnits.Add(Unit);

	FBCUDispatchOrder Order;
	Order.Unit = Unit;
	Order.Phase = (ForWantedLevel >= 3) ? EBCUPursuitPhase::ActivePursuit : EBCUPursuitPhase::Responding;
	Order.TargetLocation = bPlayerSpotted
		? (UGameplayStatics::GetPlayerPawn(this, 0)
			? UGameplayStatics::GetPlayerPawn(this, 0)->GetActorLocation() : LastKnownPlayerLocation)
		: LastKnownPlayerLocation;
	Order.OrderTime = World->GetTimeSeconds();
	Order.SearchRadiusCm = SearchGridHalfExtentCm * FMath::Max(1, ForWantedLevel);
	Orders.Add(Order);

	Unit->SetOrders(Order);
	SetPursuitPhase(Order.Phase);

	UE_LOG(LogBCUPolice, Log, TEXT("Dispatched unit (%d stars) at %s — %d active"),
		ForWantedLevel, *SpawnLocation.ToString(), ActiveUnits.Num());
}

ABCUPoliceUnit* UBCUPoliceSubsystem::FindFreeUnit() const
{
	for (ABCUPoliceUnit* Unit : ActiveUnits)
	{
		if (Unit && Unit->IsIdle())
		{
			return Unit;
		}
	}
	return nullptr;
}

void UBCUPoliceSubsystem::DespawnDistantUnits()
{
	const APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!PlayerPawn)
	{
		return;
	}

	for (int32 i = ActiveUnits.Num() - 1; i >= 0; --i)
	{
		ABCUPoliceUnit* Unit = ActiveUnits[i];
		if (!Unit)
		{
			ActiveUnits.RemoveAt(i);
			continue;
		}

		const float Distance = FVector::Dist(Unit->GetActorLocation(), PlayerPawn->GetActorLocation());

		// Beyond the despawn ring *and* not in pursuit: recycle it.
		if (Distance > FullSimulationDistanceCm * 2.5f && WantedLevel == 0)
		{
			Orders.RemoveAll([Unit](const FBCUDispatchOrder& O) { return O.Unit == Unit; });
			Unit->Destroy();
			ActiveUnits.RemoveAt(i);
		}
	}
}

//═══════════════════════════════════════════════════════════════════════════════
// Units + pursuit phase
//═══════════════════════════════════════════════════════════════════════════════

void UBCUPoliceSubsystem::UpdateUnits(float DeltaTime)
{
	const APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(this, 0);

	for (int32 i = 0; i < Orders.Num(); ++i)
	{
		FBCUDispatchOrder& Order = Orders[i];
		if (!Order.Unit)
		{
			Orders.RemoveAt(i--);
			continue;
		}

		// Distance LOD: far units tick their AI at 1 Hz and never raycast.
		const float Distance = PlayerPawn
			? FVector::Dist(Order.Unit->GetActorLocation(), PlayerPawn->GetActorLocation())
			: TNumericLimits<float>::Max();
		const bool bFullRate = Distance < FullSimulationDistanceCm;

		if (bPlayerSpotted && PlayerPawn)
		{
			Order.bHasVisual = true;
			Order.TimeSinceVisual = 0.0f;
			Order.TargetLocation = PlayerPawn->GetActorLocation();
			Order.Phase = EBCUPursuitPhase::ActivePursuit;
		}
		else
		{
			Order.bHasVisual = false;
			Order.TimeSinceVisual += DeltaTime;

			if (Order.TimeSinceVisual > 6.0f && Order.Phase == EBCUPursuitPhase::ActivePursuit)
			{
				Order.Phase = EBCUPursuitPhase::LostSuspect;
				Order.TargetLocation = LastKnownPlayerLocation;
			}
		}

		Order.Unit->SetOrders(Order);
		Order.Unit->TickUnit(bFullRate ? DeltaTime : DeltaTime * 0.15f, bFullRate);

		// Arrest: close, slow, and on foot or boxed in.
		if (WantedLevel > 0 && Order.bHasVisual && Distance < 320.0f)
		{
			const float PlayerSpeed = PlayerPawn ? PlayerPawn->GetVelocity().Size() : 0.0f;
			if (PlayerSpeed < 220.0f)
			{
				AttemptArrest();
			}
		}

		// A unit that has searched its whole grid and found nothing gives up.
		if (Order.Phase == EBCUPursuitPhase::LostSuspect
			&& Order.TimeSinceVisual > EvidenceMemorySeconds)
		{
			Order.Unit->StandDown();
			Order.Phase = EBCUPursuitPhase::None;
			Orders.RemoveAt(i--);
		}
	}
}

void UBCUPoliceSubsystem::AttemptArrest()
{
	// Arrest is a short, cancellable action: if the player drives off in the
	// first 1.5 s the pursuit resumes and heat is added for evasion.
	const APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!PlayerPawn)
	{
		return;
	}

	ReportPlayerCrime(EBCUCrimeType::EvadingArrest, PlayerPawn->GetActorLocation(), /*bWasWitnessed=*/true);
	SetPursuitPhase(EBCUPursuitPhase::Arrested);

	if (ABCUGameMode* GM = GetWorld()->GetAuthGameMode<ABCUGameMode>())
	{
		GM->RespawnPlayer(/*bWasArrested=*/true);
	}

	ClearWantedLevel(/*bArrested=*/true);
}

void UBCUPoliceSubsystem::UpdatePursuitPhase()
{
	if (WantedLevel == 0 && PursuitPhase != EBCUPursuitPhase::None)
	{
		SetPursuitPhase(EBCUPursuitPhase::Escaped);

		// "Escaped" is a momentary state for the HUD; drop back to None.
		FTimerHandle Handle;
		GetWorld()->GetTimerManager().SetTimer(Handle, FTimerDelegate::CreateWeakLambda(this, [this]()
		{
			if (WantedLevel == 0)
			{
				SetPursuitPhase(EBCUPursuitPhase::None);
			}
		}), 4.0f, false);
		return;
	}

	EBCUPursuitPhase Highest = EBCUPursuitPhase::None;
	for (const FBCUDispatchOrder& Order : Orders)
	{
		if (Order.Phase > Highest)
		{
			Highest = Order.Phase;
		}
	}

	if (Highest != PursuitPhase)
	{
		SetPursuitPhase(Highest);
	}
}

void UBCUPoliceSubsystem::SetPursuitPhase(EBCUPursuitPhase NewPhase)
{
	if (NewPhase == PursuitPhase)
	{
		return;
	}

	PursuitPhase = NewPhase;
	OnPursuitPhaseChanged.Broadcast(NewPhase);
}

int32 UBCUPoliceSubsystem::GetActiveUnitCount() const
{
	int32 Count = 0;
	for (const ABCUPoliceUnit* Unit : ActiveUnits)
	{
		if (Unit && !Unit->IsIdle())
		{
			Count++;
		}
	}
	return Count;
}

float UBCUPoliceSubsystem::GetClosestPursuerDistanceM() const
{
	const APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!PlayerPawn)
	{
		return -1.0f;
	}

	float Closest = TNumericLimits<float>::Max();
	for (const ABCUPoliceUnit* Unit : ActiveUnits)
	{
		if (!Unit)
		{
			continue;
		}

		Closest = FMath::Min(Closest, FVector::Dist(Unit->GetActorLocation(), PlayerPawn->GetActorLocation()));
	}

	return (Closest == TNumericLimits<float>::Max()) ? -1.0f : Closest / 100.0f;
}

TArray<FVector> UBCUPoliceSubsystem::GetPursuerWorldLocations() const
{
	TArray<FVector> Locations;
	Locations.Reserve(ActiveUnits.Num());

	for (const ABCUPoliceUnit* Unit : ActiveUnits)
	{
		if (Unit)
		{
			Locations.Add(Unit->GetActorLocation());
		}
	}

	return Locations;
}

//═══════════════════════════════════════════════════════════════════════════════
// Patrol point registration
//═══════════════════════════════════════════════════════════════════════════════

void UBCUPoliceSubsystem::RegisterPatrolPoints(const FBCUCellCoord& Coord, const TArray<FVector>& Points)
{
	TArray<FVector>& Existing = PatrolPoints.FindOrAdd(Coord);
	Existing.Append(Points);

	// Keep the per-cell list bounded: a dense downtown cell would otherwise
	// register hundreds of points that dispatch never uses.
	if (Existing.Num() > 32)
	{
		Existing.SetNum(32);
	}
}

void UBCUPoliceSubsystem::UnregisterPatrolPoints(const FBCUCellCoord& Coord)
{
	PatrolPoints.Remove(Coord);
}

FString UBCUPoliceSubsystem::GetPoliceStats() const
{
	return FString::Printf(
		TEXT("wanted=%d heat=%.0f phase=%d units=%d orders=%d crimes=%d spotted=%d hidden=%d"),
		WantedLevel, Heat, static_cast<int32>(PursuitPhase), ActiveUnits.Num(),
		Orders.Num(), ActiveCrimes.Num(), bPlayerSpotted ? 1 : 0, bPlayerHidden ? 1 : 0);
}
