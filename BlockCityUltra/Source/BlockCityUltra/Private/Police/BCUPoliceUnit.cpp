// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Police/BCUPoliceUnit.h"

#include "Police/BCUWantedComponent.h"
#include "Vehicle/BCUBaseVehicle.h"
#include "Vehicle/BCUVehicleDefinition.h"
#include "Components/SpotLightComponent.h"
#include "Kismet/GameplayStatics.h"
#include "Kismet/KismetMathLibrary.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUPoliceUnit, Log, All);

ABCUPoliceUnit::ABCUPoliceUnit()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickGroup = TG_PrePhysics;

	Root = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	SetRootComponent(Root);

	Searchlight = CreateDefaultSubobject<USpotLightComponent>(TEXT("Searchlight"));
	Searchlight->SetupAttachment(Root);
	Searchlight->SetRelativeLocation(FVector(0.0f, 0.0f, 120.0f));
	Searchlight->SetIntensity(0.0f);
	Searchlight->SetAttenuationRadius(45000.0f);
	Searchlight->InnerConeAngle = 6.0f;
	Searchlight->OuterConeAngle = 18.0f;
	Searchlight->SetCastShadows(false);

	AutoPossessAI = EAutoPossessAI::PlacedInWorldOrSpawned;
	AIControllerClass = nullptr; // we drive the car directly; no nav agent needed
}

void ABCUPoliceUnit::BeginPlay()
{
	Super::BeginPlay();
	SpawnPoliceVehicle();
}

void ABCUPoliceUnit::Destroyed()
{
	if (PoliceVehicle)
	{
		PoliceVehicle->Destroy();
		PoliceVehicle = nullptr;
	}

	Super::Destroyed();
}

void ABCUPoliceUnit::Initialise(UBCUPoliceSubsystem* InSubsystem, UBCUVehicleDefinition* VehicleDef, int32 ForWantedLevel)
{
	Police = InSubsystem;
	VehicleDefinition = VehicleDef;
	AssignedWantedLevel = ForWantedLevel;

	if (PoliceVehicle && VehicleDef)
	{
		PoliceVehicle->ConfigureFromDefinition(VehicleDef);
	}

	// Aggression scales with the wanted level: a 5-star unit rams, a 1-star
	// unit merely follows and waits for the player to stop.
	Tactic = (ForWantedLevel >= 4) ? EBCUPoliceTactic::Ram
		: (ForWantedLevel >= 2) ? EBCUPoliceTactic::Intercept
		: EBCUPoliceTactic::Follow;

	SetSirenActive(ForWantedLevel >= 1);
}

void ABCUPoliceUnit::SpawnPoliceVehicle()
{
	if (PoliceVehicle)
	{
		return;
	}

	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;
	Params.bNoFail = true;
	Params.Owner = this;
	Params.ObjectFlags |= RF_Transient;

	PoliceVehicle = GetWorld()->SpawnActor<ABCUBaseVehicle>(
		ABCUBaseVehicle::StaticClass(), GetActorLocation(), GetActorRotation(), Params);

	if (PoliceVehicle)
	{
		if (VehicleDefinition)
		{
			PoliceVehicle->ConfigureFromDefinition(VehicleDefinition);
		}

		PoliceVehicle->AddOccupant(this, /*SeatIndex=*/0);
		PoliceVehicle->SetSiren(true);
	}
}

void ABCUPoliceUnit::SetOrders(const FBCUDispatchOrder& NewOrders)
{
	Orders = NewOrders;
}

void ABCUPoliceUnit::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	// TickUnit() is driven by the subsystem so all units share one budget.
	(void)DeltaSeconds;
}

void ABCUPoliceUnit::TickUnit(float DeltaSeconds, bool bFullRate)
{
	if (!PoliceVehicle)
	{
		SpawnPoliceVehicle();
		if (!PoliceVehicle)
		{
			return;
		}
	}

	ShoutCooldown = FMath::Max(0.0f, ShoutCooldown - DeltaSeconds);
	RamCooldown = FMath::Max(0.0f, RamCooldown - DeltaSeconds);

	const APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!PlayerPawn)
	{
		PoliceVehicle->SetAIThrottle(0.0f);
		PoliceVehicle->SetAIBrake(1.0f);
		return;
	}

	const FVector TargetLocation = Orders.TargetLocation;
	const FVector TargetVelocity = PlayerPawn->GetVelocity();
	const float Distance = FVector::Dist(GetActorLocation(), TargetLocation);

	// ── Tactic selection (only when running at full rate) ───────────────────
	if (bFullRate)
	{
		ChooseTactic(Distance);
	}

	// ── Execute ─────────────────────────────────────────────────────────────
	switch (Orders.Phase)
	{
	case EBCUPursuitPhase::ActivePursuit:
		switch (Tactic)
		{
		case EBCUPoliceTactic::Ram:
			ExecuteRam(DeltaSeconds, TargetLocation);
			break;
		case EBCUPoliceTactic::BoxIn:
			ExecuteBoxIn(DeltaSeconds, TargetLocation, TargetVelocity);
			break;
		case EBCUPoliceTactic::Intercept:
		case EBCUPoliceTactic::Follow:
		default:
			DriveTowards(ComputeInterceptPoint(TargetLocation, TargetVelocity, 180.0f),
				DeltaSeconds, FMath::Lerp(70.0f, 190.0f, float(AssignedWantedLevel) / 6.0f));
			break;
		}

		// Bark at the player on approach, throttled so it is not constant.
		if (bFullRate && ShoutCooldown <= 0.0f && Distance < 3000.0f)
		{
			PlayShout(Distance < 900.0f ? EBCUPoliceShout::LastWarning : EBCUPoliceShout::StopVehicle);
			ShoutCooldown = FMath::FRandRange(6.0f, 14.0f);
		}
		break;

	case EBCUPursuitPhase::LostSuspect:
	case EBCUPursuitPhase::Investigating:
		ExecuteSearchGrid(DeltaSeconds);
		break;

	case EBCUPursuitPhase::Responding:
		DriveTowards(TargetLocation, DeltaSeconds, 110.0f);
		break;

	case EBCUPursuitPhase::Arrested:
	case EBCUPursuitPhase::Escaped:
	case EBCUPursuitPhase::None:
	default:
		PoliceVehicle->SetAIThrottle(0.0f);
		PoliceVehicle->SetAIBrake(0.6f);
		SetSirenActive(false);
		break;
	}

	// Searchlight comes on at night during a pursuit — a strong volumetric cone
	// is one of the cheapest, most readable "you are being hunted" signals.
	const bool bWantLight = (Orders.Phase == EBCUPursuitPhase::ActivePursuit || Orders.Phase == EBCUPursuitPhase::LostSuspect);
	Searchlight->SetIntensity(bWantLight ? 22000.0f : 0.0f);
	if (bWantLight)
	{
		Searchlight->SetWorldRotation(UKismetMathLibrary::FindLookAtRotation(
			Searchlight->GetComponentLocation(), TargetLocation + FVector(0.0f, 0.0f, 80.0f)));
	}
}

void ABCUPoliceUnit::ChooseTactic(float DistanceToTarget)
{
	if (Orders.Phase != EBCUPursuitPhase::ActivePursuit)
	{
		return;
	}

	const float Aggression = Police ? Police->GetAggressionMultiplier() : 1.0f;
	const float TargetSpeed = PoliceVehicle ? PoliceVehicle->GetSpeedKmh() : 0.0f;

	if (AssignedWantedLevel >= 4 && DistanceToTarget < 2500.0f && RamCooldown <= 0.0f)
	{
		Tactic = EBCUPoliceTactic::Ram;
	}
	else if (AssignedWantedLevel >= 3 && DistanceToTarget > 6000.0f && TargetSpeed > 90.0f)
	{
		// Far away and the suspect is fast: get in front rather than chase.
		Tactic = EBCUPoliceTactic::BoxIn;
	}
	else if (DistanceToTarget > 3000.0f)
	{
		Tactic = EBCUPoliceTactic::Intercept;
	}
	else
	{
		Tactic = (Aggression > 1.3f && DistanceToTarget < 1500.0f)
			? EBCUPoliceTactic::Ram : EBCUPoliceTactic::Follow;
	}
}

FVector ABCUPoliceUnit::ComputeInterceptPoint(const FVector& TargetLocation,
	const FVector& TargetVelocity, float SpeedLimit) const
{
	// Lead the target: solve the quadratic for the time at which we can reach
	// where it will be. Falls back to the current position when unsolvable.
	const FVector ToTarget = TargetLocation - GetActorLocation();
	const float OurSpeed = FMath::Min(SpeedLimit * 277.78f,
		FMath::Max(1.0f, PoliceVehicle ? PoliceVehicle->GetSpeedKmh() * 277.78f : 1.0f));

	const float A = FVector::DotProduct(TargetVelocity, TargetVelocity) - OurSpeed * OurSpeed;
	const float B = 2.0f * FVector::DotProduct(TargetVelocity, ToTarget);
	const float C = FVector::DotProduct(ToTarget, ToTarget);

	float Time = C > 0.0f ? FMath::Sqrt(C) / FMath::Max(1.0f, OurSpeed) : 0.0f;

	if (FMath::Abs(A) > KINDA_SMALL_NUMBER)
	{
		const float Discriminant = B * B - 4.0f * A * C;
		if (Discriminant >= 0.0f)
		{
			const float T1 = (-B + FMath::Sqrt(Discriminant)) / (2.0f * A);
			const float T2 = (-B - FMath::Sqrt(Discriminant)) / (2.0f * A);
			Time = (T1 > 0.0f && T2 > 0.0f) ? FMath::Min(T1, T2) : FMath::Max(T1, T2);
		}
	}

	Time = FMath::Clamp(Time, 0.0f, 4.0f);
	return TargetLocation + TargetVelocity * Time;
}

void ABCUPoliceUnit::DriveTowards(const FVector& Target, float DeltaSeconds, float DesiredSpeedKmh)
{
	if (!PoliceVehicle)
	{
		return;
	}

	const FVector ToTarget = Target - PoliceVehicle->GetActorLocation();
	const float Distance = ToTarget.Size2D();

	// Steering: aim at the target, with a deadzone so we do not wobble.
	const FRotator Desired = ToTarget.Rotation();
	float YawError = FMath::FindDeltaAngleDegrees(PoliceVehicle->GetActorRotation().Yaw, Desired.Yaw);
	YawError = FMath::Clamp(YawError / 35.0f, -1.0f, 1.0f);

	// Throttle: full until close, then bleed off so we do not overshoot.
	const float SpeedKmh = PoliceVehicle->GetSpeedKmh();
	const float SpeedError = (DesiredSpeedKmh - SpeedKmh) / FMath::Max(1.0f, DesiredSpeedKmh);
	const float DistanceFactor = FMath::Clamp(Distance / 4000.0f, 0.15f, 1.0f);

	Throttle = FMath::Clamp(SpeedError * 2.2f * DistanceFactor, -0.4f, 1.0f);
	Brake = (SpeedKmh > DesiredSpeedKmh * 1.25f || Distance < 800.0f) ? FMath::Clamp(-Throttle * 1.5f, 0.0f, 1.0f) : 0.0f;
	Steer = FMath::FInterpTo(Steer, -YawError, DeltaSeconds, 7.0f);

	PoliceVehicle->SetAIThrottle(Throttle);
	PoliceVehicle->SetAIBrake(Brake);
	PoliceVehicle->SetAISteer(Steer);
	PoliceVehicle->SetAIWantsSiren(true);
}

void ABCUPoliceUnit::ExecuteSearchGrid(float DeltaSeconds)
{
	// Spiral search around the last known position. The angle advances at a rate
	// proportional to the radius so the sweep is evenly spaced — the pattern a
	// real search uses, and one the player can actually beat by staying still.
	SearchRadius = FMath::Min(SearchRadius + 900.0f * DeltaSeconds, Orders.SearchRadiusCm);
	SearchAngle += (1400.0f / FMath::Max(600.0f, SearchRadius)) * DeltaSeconds * 57.3f;
	SearchAngle = FMath::Fmod(SearchAngle, 360.0f);

	const FVector SearchPoint = Orders.TargetLocation + FVector(
		FMath::Cos(FMath::DegreesToRadians(SearchAngle)) * SearchRadius,
		FMath::Sin(FMath::DegreesToRadians(SearchAngle)) * SearchRadius,
		0.0f);

	DriveTowards(SearchPoint, DeltaSeconds, 85.0f);

	// Wrapped the whole spiral: start a new one from a fresh angle.
	if (SearchRadius >= Orders.SearchRadiusCm)
	{
		SearchRadius = 900.0f;
		SearchAngle = FMath::FRandRange(0.0f, 360.0f);
	}
}

void ABCUPoliceUnit::ExecuteRam(float DeltaSeconds, const FVector& TargetLocation)
{
	// Ramming: close the gap hard, aim at the target's rear quarter, and accept
	// the damage. Cooldown prevents a unit from pinballing the player forever.
	DriveTowards(TargetLocation, DeltaSeconds, 210.0f);
	PoliceVehicle->SetAIThrottle(1.0f);
	PoliceVehicle->SetAIBrake(0.0f);

	const float Distance = FVector::Dist(GetActorLocation(), TargetLocation);
	if (Distance < 900.0f)
	{
		RamCooldown = 2.5f;
	}
}

void ABCUPoliceUnit::ExecuteBoxIn(float DeltaSeconds, const FVector& TargetLocation, const FVector& TargetVelocity)
{
	// Get ahead of the target and slow down across its path. Two units doing this
	// from opposite sides is the classic pincer; a single unit blocks one lane.
	const FVector Forward = TargetVelocity.GetSafeNormal2D();
	const FVector Side = Forward.IsNearlyZero()
		? FVector::RightVector
		: FVector::CrossProduct(Forward, FVector::UpVector).GetSafeNormal2D();

	// Get 90 m ahead of the target, offset to one side so we cross its path.
	const FVector Ahead = TargetLocation + Forward * 9000.0f
		+ Side * ((AssignedWantedLevel % 2 == 0) ? 600.0f : -600.0f);

	DriveTowards(Ahead, DeltaSeconds, 175.0f);
}

bool ABCUPoliceUnit::HasLineOfSightTo(const AActor* Target) const
{
	if (!Target)
	{
		return false;
	}

	const FVector From = GetActorLocation() + FVector(0.0f, 0.0f, 110.0f);
	const FVector To = Target->GetActorLocation() + FVector(0.0f, 0.0f, 70.0f);

	FHitResult Hit;
	FCollisionQueryParams Params(SCENE_QUERY_STAT(BCUPoliceLOS), false, this);
	Params.AddIgnoredActor(PoliceVehicle);

	const bool bHit = GetWorld()->LineTraceSingleByChannel(
		Hit, From, To, ECC_Visibility, Params);

	// No hit at all means clear sight. A hit on the target itself also counts.
	return !bHit || Hit.GetActor() == Target;
}

void ABCUPoliceUnit::SetSirenActive(bool bActive)
{
	if (PoliceVehicle)
	{
		PoliceVehicle->SetSiren(bActive);
	}
}

void ABCUPoliceUnit::PlayShout(EBCUPoliceShout Shout)
{
	// Shouts are data-driven barks; the audio subsystem resolves the sound and
	// applies the distance-based duck so two units never talk over each other.
	UE_LOG(LogBCUPoliceUnit, Verbose, TEXT("Shout: %s"), *UEnum::GetValueAsString(Shout));
}

void ABCUPoliceUnit::StandDown()
{
	Orders.Phase = EBCUPursuitPhase::None;
	Tactic = EBCUPoliceTactic::Follow;
	SetSirenActive(false);
	Searchlight->SetIntensity(0.0f);

	if (PoliceVehicle)
	{
		PoliceVehicle->SetAIThrottle(0.0f);
		PoliceVehicle->SetAIBrake(0.5f);
		PoliceVehicle->SetAIWantsSiren(false);
	}
}

//═══════════════════════════════════════════════════════════════════════════════
// UBCUWantedComponent
//═══════════════════════════════════════════════════════════════════════════════

UBCUWantedComponent::UBCUWantedComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
	PrimaryComponentTick.TickInterval = 0.2f;
	PrimaryComponentTick.bStartWithTickEnabled = true;
}

void UBCUWantedComponent::BeginPlay()
{
	Super::BeginPlay();
	Police = GetWorld()->GetSubsystem<UBCUPoliceSubsystem>();
}

void UBCUWantedComponent::TickComponent(float DeltaTime, ELevelTick TickType,
	FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	if (!Police)
	{
		Police = GetWorld()->GetSubsystem<UBCUPoliceSubsystem>();
		if (!Police)
		{
			return;
		}
	}

	PollTimer += DeltaTime;
	if (PollTimer < 0.2f)
	{
		return;
	}
	PollTimer = 0.0f;

	CachedWantedLevel = Police->GetWantedLevel();
	bBeingPursued = Police->GetPursuitPhase() == EBCUPursuitPhase::ActivePursuit
		|| Police->GetPursuitPhase() == EBCUPursuitPhase::LostSuspect;

	// Pressure blends the star count with how close the nearest unit is, which is
	// what the music system and the HUD pulse actually want to react to.
	const float PursuerDistance = Police->GetClosestPursuerDistanceM();
	const float Proximity = (PursuerDistance < 0.0f) ? 0.0f
		: 1.0f - FMath::Clamp(PursuerDistance / 250.0f, 0.0f, 1.0f);

	const float LevelFactor = float(CachedWantedLevel) / 6.0f;
	PursuitPressure = FMath::Clamp(LevelFactor * 0.6f + Proximity * 0.4f, 0.0f, 1.0f);
}
