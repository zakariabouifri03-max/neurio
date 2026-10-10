// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Vehicle/BCUBaseVehicle.h"

#include "Vehicle/BCUVehicleVoxelBuilder.h"
#include "Vehicle/BCUVehicleAudioComponent.h"
#include "Vehicle/BCUVehicleDamageComponent.h"
#include "Vehicle/BCUVehicleCustomisationComponent.h"
#include "AI/BCUTrafficComponent.h"
#include "Core/BCUGameState.h"
#include "ChaosWheeledVehicleMovementComponent.h"
#include "Components/BoxComponent.h"
#include "Components/PointLightComponent.h"
#include "Components/SpotLightComponent.h"
#include "Components/StaticMeshComponent.h"
#include "NiagaraComponent.h"
#include "Engine/StaticMesh.h"
#include "GameFramework/Pawn.h"
#include "TimerManager.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUVehicle, Log, All);

ABCUBaseVehicle::ABCUBaseVehicle()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickGroup = TG_PrePhysics;
	PrimaryActorTick.TickInterval = 0.0f;

	bReplicates = true;
	SetReplicateMovement(true);
	bAlwaysRelevant = false;

	GetMesh()->SetCollisionProfileName(TEXT("BCU_Vehicle"));
	GetMesh()->SetSimulatePhysics(true);
	GetMesh()->SetCanEverAffectNavigation(false);

	// Voxel body: generated at BeginPlay from the definition, rendered as a
	// Nanite static mesh. Kept separate from Chaos' Mesh so the physics proxy
	// stays a simple convex hull while the *look* is fully cubic.
	VoxelBody = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("VoxelBody"));
	VoxelBody->SetupAttachment(GetMesh());
	VoxelBody->SetRelativeLocation(FVector::ZeroVector);
	VoxelBody->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	VoxelBody->SetCastShadow(true);
	VoxelBody->bAffectDynamicIndirectLighting = true;
	VoxelBody->SetRenderInMainPass(true);
	VoxelBody->SetRenderCustomDepth(false);

	VehicleAudio = CreateDefaultSubobject<UBCUVehicleAudioComponent>(TEXT("VehicleAudio"));
	Damage = CreateDefaultSubobject<UBCUVehicleDamageComponent>(TEXT("Damage"));
	Customisation = CreateDefaultSubobject<UBCUVehicleCustomisationComponent>(TEXT("Customisation"));

	ExhaustFX = CreateDefaultSubobject<UNiagaraComponent>(TEXT("ExhaustFX"));
	ExhaustFX->SetupAttachment(GetMesh());
	ExhaustFX->SetAutoActivate(false);
	ExhaustFX->SetRelativeLocation(FVector(-80.0f, 34.0f, 24.0f));

	TyreSmokeFX = CreateDefaultSubobject<UNiagaraComponent>(TEXT("TyreSmokeFX"));
	TyreSmokeFX->SetupAttachment(GetMesh());
	TyreSmokeFX->SetAutoActivate(false);

	HeadlightLeft = CreateDefaultSubobject<USpotLightComponent>(TEXT("HeadlightLeft"));
	HeadlightLeft->SetupAttachment(GetMesh());
	HeadlightLeft->SetRelativeLocationAndRotation(FVector(95.0f, -58.0f, 52.0f), FRotator(-2.0f, 0.0f, 0.0f));
	HeadlightLeft->SetIntensity(0.0f);
	HeadlightLeft->SetAttenuationRadius(38000.0f);
	HeadlightLeft->InnerConeAngle = 12.0f;
	HeadlightLeft->OuterConeAngle = 34.0f;
	HeadlightLeft->SetCastShadows(true);
	HeadlightLeft->bAffectTranslucentLighting = false;

	HeadlightRight = CreateDefaultSubobject<USpotLightComponent>(TEXT("HeadlightRight"));
	HeadlightRight->SetupAttachment(GetMesh());
	HeadlightRight->SetRelativeLocationAndRotation(FVector(95.0f, 58.0f, 52.0f), FRotator(-2.0f, 0.0f, 0.0f));
	HeadlightRight->SetIntensity(0.0f);
	HeadlightRight->SetAttenuationRadius(38000.0f);
	HeadlightRight->InnerConeAngle = 12.0f;
	HeadlightRight->OuterConeAngle = 34.0f;
	HeadlightRight->SetCastShadows(true);
	HeadlightRight->bAffectTranslucentLighting = false;

	TaillightGlow = CreateDefaultSubobject<UPointLightComponent>(TEXT("TaillightGlow"));
	TaillightGlow->SetupAttachment(GetMesh());
	TaillightGlow->SetRelativeLocation(FVector(-96.0f, 0.0f, 56.0f));
	TaillightGlow->SetIntensity(0.0f);
	TaillightGlow->SetAttenuationRadius(900.0f);
	TaillightGlow->SetLightColor(FColor(255, 16, 10));
	TaillightGlow->SetCastShadows(false);

	EmergencyLightA = CreateDefaultSubobject<UPointLightComponent>(TEXT("EmergencyLightA"));
	EmergencyLightA->SetupAttachment(GetMesh());
	EmergencyLightA->SetRelativeLocation(FVector(-6.0f, -26.0f, 118.0f));
	EmergencyLightA->SetIntensity(0.0f);
	EmergencyLightA->SetAttenuationRadius(5200.0f);
	EmergencyLightA->SetCastShadows(false);
	EmergencyLightA->bAffectTranslucentLighting = true;

	EmergencyLightB = CreateDefaultSubobject<UPointLightComponent>(TEXT("EmergencyLightB"));
	EmergencyLightB->SetupAttachment(GetMesh());
	EmergencyLightB->SetRelativeLocation(FVector(-6.0f, 26.0f, 118.0f));
	EmergencyLightB->SetIntensity(0.0f);
	EmergencyLightB->SetAttenuationRadius(5200.0f);
	EmergencyLightB->SetCastShadows(false);
	EmergencyLightB->bAffectTranslucentLighting = true;

	EntryTrigger = CreateDefaultSubobject<UBoxComponent>(TEXT("EntryTrigger"));
	EntryTrigger->SetupAttachment(GetMesh());
	EntryTrigger->SetBoxExtent(FVector(190.0f, 150.0f, 110.0f));
	EntryTrigger->SetCollisionProfileName(TEXT("BCU_Trigger"));
	EntryTrigger->SetGenerateOverlapEvents(true);
	EntryTrigger->SetHiddenInGame(true);
}

void ABCUBaseVehicle::PostInitializeComponents()
{
	Super::PostInitializeComponents();

	// Sub-stepping keeps 300 km/h collisions from tunnelling through the thin
	// voxel walls of a skyscraper lobby.
	if (UChaosWheeledVehicleMovementComponent* WheelMovement =
			Cast<UChaosWheeledVehicleMovementComponent>(GetVehicleMovement()))
	{
		WheelMovement->SetUseSubStepping(true);
		WheelMovement->SetSubstepThreshold(1200.0f);
		WheelMovement->SimulateDrag = true;
		WheelMovement->DragCoefficient = Definition ? Definition->DragCoefficient : 0.34f;
	}
}

void ABCUBaseVehicle::BeginPlay()
{
	Super::BeginPlay();

	LastPhysicsPosition = GetActorLocation();
	FuelLitres = Definition ? Definition->FuelTankLitres : 62.0f;
	BoostRemaining = Definition ? Definition->BoostDurationSeconds : 0.0f;

	CreateSeatOccupantSlots();
	ApplyDefinitionToChaos();
	BuildVoxelBody();

	if (Damage)
	{
		Damage->Initialise(Definition ? Definition->BodyHealth : 1000.0f);
	}
	if (VehicleAudio)
	{
		VehicleAudio->Initialise(Definition);
	}
	if (Customisation)
	{
		Customisation->Initialise(this);
		Customisation->ApplyPaint(PaintColor);
		Customisation->ApplyWheelStyle(WheelStyle);
		Customisation->ApplyUpgradeLevels(EngineLevel, HandlingLevel, BrakeLevel);
	}

	// Unattended vehicles are parked; AI attaches its component afterwards.
	SetState(HasDriver() ? EBCUVehicleState::Idle : EBCUVehicleState::Parked);

	UE_LOG(LogBCUVehicle, Log, TEXT("Vehicle ready: %s (%s, %d wheels, %d seats)"),
		*GetNameSafe(Definition),
		Definition ? *UEnum::GetValueAsString(Definition->VehicleClass).RightChop(21) : TEXT("?"),
		GetVehicleMovement() ? GetVehicleMovement()->Wheels.Num() : 0,
		SeatOccupants.Num());
}

void ABCUBaseVehicle::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	// Merge player + AI intent into one set of smoothed actuator values. The
	// player always wins when both are set (a hijacked traffic car).
	const bool bPlayerHasIntent = PlayerThrottle != 0.0f || PlayerBrake > 0.0f || PlayerSteer != 0.0f;
	const bool bPlayerDriving = HasDriver() && bPlayerHasIntent;

	const float TargetThrottle = bPlayerDriving ? PlayerThrottle : AIThrottle;
	const float TargetBrake = bPlayerDriving ? PlayerBrake : AIBrake;
	const float TargetSteer = bPlayerDriving ? PlayerSteer : AISteer;
	const bool bHandbrake = bPlayerDriving ? false : bAIHandbrake;

	const float ThrottleAlpha = FMath::Clamp(ThrottleSmoothing * DeltaSeconds, 0.0f, 1.0f);
	const float BrakeAlpha = FMath::Clamp(BrakeSmoothing * DeltaSeconds, 0.0f, 1.0f);
	const float SteerAlpha = FMath::Clamp(SteerSmoothing * DeltaSeconds, 0.0f, 1.0f);

	SmoothedThrottle = FMath::Lerp(SmoothedThrottle, TargetThrottle, ThrottleAlpha);
	SmoothedBrake = FMath::Lerp(SmoothedBrake, FMath::Max(TargetBrake, bHandbrake ? 1.0f : 0.0f), BrakeAlpha);
	SmoothedSteer = FMath::Lerp(SmoothedSteer, TargetSteer, SteerAlpha);

	// Speed-sensitive steering: full lock at 10 km/h, 35% of it at top speed.
	const float SpeedFraction = Definition
		? FMath::Clamp(GetSpeedKmh() / FMath::Max(1.0f, Definition->TopSpeedKmh), 0.0f, 1.0f)
		: 0.0f;
	const float SteerScale = FMath::Lerp(1.0f, 0.35f, SpeedFraction);

	if (UChaosWheeledVehicleMovementComponent* WheelMovement =
			Cast<UChaosWheeledVehicleMovementComponent>(GetVehicleMovement()))
	{
		float Throttle = SmoothedThrottle;
		float Brake = SmoothedBrake;

		// Reverse is negative throttle at a standstill, brake otherwise.
		if (Throttle < 0.0f && GetSpeedKmh() > 3.0f)
		{
			Brake = FMath::Max(Brake, -Throttle);
			Throttle = 0.0f;
		}

		if (bBoostActive)
		{
			Throttle *= (Definition ? Definition->BoostTorqueMultiplier : 1.0f);
		}

		if (FuelLitres <= 0.0f || IsWrecked())
		{
			Throttle = 0.0f;
		}

		WheelMovement->SetThrottleInput(Throttle);
		WheelMovement->SetBrakeInput(Brake);
		WheelMovement->SetSteeringInput(SmoothedSteer * SteerScale);
		WheelMovement->SetHandbrakeInput(bHandbrake || SmoothedBrake >= 0.99f && GetSpeedKmh() < 2.0f);
	}

	UpdateVehicleState(DeltaSeconds);
	UpdateFuelAndOdometer(DeltaSeconds);
	UpdateLights(DeltaSeconds);
	UpdateBoost(DeltaSeconds);

	if (VehicleAudio)
	{
		VehicleAudio->UpdateEngine(GetEngineRPM(), SmoothedThrottle, GetSpeedKmh(), IsDrifting());
	}

	if (Traffic)
	{
		Traffic->TickTraffic(DeltaSeconds);
	}
}

void ABCUBaseVehicle::Destroyed()
{
	if (Damage)
	{
		Damage->Shutdown();
	}
	if (VehicleAudio)
	{
		VehicleAudio->Shutdown();
	}

	Super::Destroyed();
}

float ABCUBaseVehicle::TakeDamage(float DamageAmount, FDamageEvent const& DamageEvent,
	AController* EventInstigator, AActor* DamageCauser)
{
	const float Applied = Super::TakeDamage(DamageAmount, DamageEvent, EventInstigator, DamageCauser);

	if (Applied > 0.0f && Damage)
	{
		FVector ImpactPoint = GetActorLocation();
		FVector ImpactNormal = FVector::UpVector;

		if (const FPointDamageEvent* Point = DamageEvent.GetTypeID() == FPointDamageEvent::ClassID
				? static_cast<const FPointDamageEvent*>(&DamageEvent) : nullptr)
		{
			ImpactPoint = Point->HitInfo.ImpactPoint;
			ImpactNormal = Point->HitInfo.ImpactNormal;
		}

		Damage->ApplyImpact(Applied, ImpactPoint, ImpactNormal, DamageCauser);

		if (Damage->IsWrecked())
		{
			SetState(EBCUVehicleState::Wrecked);
		}
	}

	return Applied;
}

//═══════════════════════════════════════════════════════════════════════════════
// Definition → physics/visuals
//═══════════════════════════════════════════════════════════════════════════════

void ABCUBaseVehicle::ConfigureFromDefinition(UBCUVehicleDefinition* InDefinition)
{
	if (!InDefinition)
	{
		return;
	}

	Definition = InDefinition;

	if (HasActorBegunPlay())
	{
		CreateSeatOccupantSlots();
		ApplyDefinitionToChaos();
		BuildVoxelBody();

		if (VehicleAudio)	{ VehicleAudio->Initialise(InDefinition); }
		if (Damage)			{ Damage->Initialise(InDefinition->BodyHealth); }
		if (Customisation)	{ Customisation->Initialise(this); Customisation->ApplyPaint(PaintColor); }
	}
}

void ABCUBaseVehicle::ApplyDefinitionToChaos()
{
	UChaosWheeledVehicleMovementComponent* WheelMovement =
		Cast<UChaosWheeledVehicleMovementComponent>(GetVehicleMovement());
	if (!WheelMovement || !Definition)
	{
		return;
	}

	WheelMovement->MassKilograms = Definition->MassKg;
	WheelMovement->ChassisWidth = Definition->BodyVoxelDimensions.X * Definition->VoxelSizeCm;
	WheelMovement->ChassisHeight = Definition->BodyVoxelDimensions.Y * Definition->VoxelSizeCm;
	WheelMovement->DragCoefficient = Definition->DragCoefficient;
	WheelMovement->CenterOfMass = Definition->CenterOfMassOffset;
	WheelMovement->MaxEngineRPM = Definition->MaxRPM;
	WheelMovement->EngineTorqueCurve = FRuntimeFloatCurve();
	WheelMovement->EngineTorqueCurve.GetRichCurve()->AddKey(0.0f, Definition->PeakTorqueNm * 0.55f);
	WheelMovement->EngineTorqueCurve.GetRichCurve()->AddKey(Definition->PeakTorqueRPM, Definition->PeakTorqueNm);
	WheelMovement->EngineTorqueCurve.GetRichCurve()->AddKey(Definition->MaxRPM, Definition->PeakTorqueNm * 0.72f);
	WheelMovement->EngineRevUpRate = 5.0f;
	WheelMovement->EngineRevDownRate = 6.5f;
	WheelMovement->TransmissionEfficiency = 0.92f;
	WheelMovement->UseAutomaticGears = true;
	WheelMovement->FinalRatio = Definition->FinalDriveRatio;
	WheelMovement->ForwardGears.Empty();
	for (const float Ratio : Definition->GearRatios)
	{
		FChaosEngineGearData Gear;
		Gear.Ratio = Ratio;
		Gear.DownRatio = 0.45f;
		Gear.UpRatio = 0.72f;
		WheelMovement->ForwardGears.Add(Gear);
	}

	if (Definition->DriveTrain == EBCUDriveTrain::AWD)
	{
		WheelMovement->DifferentialType = EVehicleDifferential4W::LimitedSlip_4W;
	}
	else if (Definition->DriveTrain == EBCUDriveTrain::RWD)
	{
		WheelMovement->DifferentialType = EVehicleDifferential::LimitedSlip;
	}
	else
	{
		WheelMovement->DifferentialType = EVehicleDifferential::Open;
	}

	WheelMovement->SetUseSweepWheelCollision(false);

	// Wheels: rebuild from the definition so a data-only vehicle is complete.
	WheelMovement->Wheels.Empty();
	for (int32 Index = 0; Index < Definition->Wheels.Num(); ++Index)
	{
		const FBCUWheelSpec& Spec = Definition->Wheels[Index];

		FWheelSetup WheelSetup;
		WheelSetup.WheelClass = Definition->IsTwoWheeler()
			? UChaosVehicleWheel::StaticClass()
			: UChaosVehicleWheel::StaticClass();
		WheelSetup.WheelName = Spec.WheelName;
		WheelSetup.Offset = Spec.Location;
		WheelSetup.WheelBoneName = Spec.WheelName;
		WheelMovement->WheelSetups.Add(WheelSetup);
	}

	WheelMovement->InstantiateWheelsFromSetups();

	// Per-wheel suspension + tyre tuning from the spec.
	for (int32 Index = 0; Index < WheelMovement->Wheels.Num() && Index < Definition->Wheels.Num(); ++Index)
	{
		UChaosVehicleWheel* Wheel = Cast<UChaosVehicleWheel>(WheelMovement->Wheels[Index]);
		if (!Wheel)
		{
			continue;
		}

		const FBCUWheelSpec& Spec = Definition->Wheels[Index];
		Wheel->WheelRadius = Spec.RadiusCm;
		Wheel->WheelWidth = Spec.WidthCm;
		Wheel->WheelMass = Definition->IsTwoWheeler() ? 12.0f : 22.0f;
		Wheel->MaxDrop = Spec.SuspensionMaxDropCm;
		Wheel->MaxCompression = Spec.SuspensionMaxCompressionCm;
		Wheel->SuspensionDampingRatio = Spec.DampingRatio;
		Wheel->SpringRate = Spec.SpringRate;
		Wheel->SlipThreshold = Spec.SlipThreshold;
		Wheel->SkidThreshold = Spec.SlipThreshold;
		Wheel->FrictionForceMultiplier = Spec.TyreFrictionScale * (1.0f + Definition->OffroadBias * 0.25f);
	}

	// Two-wheelers need a gyroscopic stabiliser or they fall over at 0 km/h.
	if (Definition->IsTwoWheeler())
	{
		WheelMovement->LeanSteeringFactor = 0.35f;
		WheelMovement->TorqueLeanFactor = 0.55f;
		WheelMovement->LeanMaxAngle = 42.0f;
		WheelMovement->TorqueMaxAngle = 46.0f;
	}
}

void ABCUBaseVehicle::BuildVoxelBody()
{
	if (!Definition)
	{
		return;
	}

	// Designers may ship a hand-authored mesh; otherwise generate it.
	if (Definition->BodyMeshOverride.IsValid())
	{
		if (UStaticMesh* Override = Definition->BodyMeshOverride.LoadSynchronous())
		{
			VoxelBody->SetStaticMesh(Override);
			return;
		}
	}

	UStaticMesh* Generated = UBCUVehicleVoxelBuilder::BuildVehicleMesh(
		GetWorld(), Definition, PaintColor, WheelStyle);

	if (Generated)
	{
		VoxelBody->SetStaticMesh(Generated);
		VoxelBody->SetCollisionEnabled(ECollisionEnabled::NoCollision); // Chaos hull handles it
	}
}

void ABCUBaseVehicle::CreateSeatOccupantSlots()
{
	const int32 SeatCount = Definition ? FMath::Max(1, Definition->Seats.Num()) : 1;
	SeatOccupants.Init(nullptr, SeatCount);
}

//═══════════════════════════════════════════════════════════════════════════════
// Occupants
//═══════════════════════════════════════════════════════════════════════════════

int32 ABCUBaseVehicle::ResolveSeatForEntrant(int32 RequestedSeat, APawn* Entrant) const
{
	const int32 SeatCount = SeatOccupants.Num();
	if (SeatCount == 0)
	{
		return INDEX_NONE;
	}

	// Driver seat is preferred unless it is taken or specifically refused.
	const int32 DriverIndex = Definition ? Definition->GetDriverSeatIndex() : 0;
	const int32 Preferred = (RequestedSeat == INDEX_NONE) ? DriverIndex : RequestedSeat;

	if (Preferred >= 0 && Preferred < SeatCount && !SeatOccupants[Preferred])
	{
		return Preferred;
	}

	for (int32 Index = 0; Index < SeatCount; ++Index)
	{
		if (!SeatOccupants[Index])
		{
			return Index;
		}
	}

	return INDEX_NONE;
}

bool ABCUBaseVehicle::AddOccupant(APawn* Occupant, int32 SeatIndex)
{
	if (!Occupant || SeatOccupants.Num() <= SeatIndex || SeatIndex < 0)
	{
		return false;
	}

	if (SeatOccupants[SeatIndex])
	{
		return false;
	}

	SeatOccupants[SeatIndex] = Occupant;
	Occupant->AttachToComponent(GetMesh(), FAttachmentTransformRules::SnapToTargetNotIncludingScale);

	const FTransform SeatTM = Definition && Definition->Seats.IsValidIndex(SeatIndex)
		? Definition->Seats[SeatIndex].SeatTransform
		: FTransform(FVector(0.0f, SeatIndex * -46.0f, 44.0f));
	Occupant->SetActorRelativeTransform(SeatTM);
	Occupant->SetActorHiddenInGame(true);
	Occupant->SetActorEnableCollision(false);

	if (Definition && Definition->Seats.IsValidIndex(SeatIndex) && Definition->Seats[SeatIndex].bIsDriverSeat)
	{
		SetState(EBCUVehicleState::Idle);
	}

	OnOccupantChanged.Broadcast(this, true);
	return true;
}

void ABCUBaseVehicle::RemoveOccupant(APawn* Occupant)
{
	const int32 Index = SeatOccupants.IndexOfByKey(Occupant);
	if (Index == INDEX_NONE)
	{
		return;
	}

	SeatOccupants[Index] = nullptr;

	if (Occupant)
	{
		Occupant->DetachFromActor(FDetachmentTransformRules::KeepWorldTransform);
		Occupant->SetActorHiddenInGame(false);
		Occupant->SetActorEnableCollision(true);
	}

	if (!HasDriver())
	{
		SetState(EBCUVehicleState::Parked);

		// Parked AI cars must not roll away down a San Escobar hill.
		if (UChaosWheeledVehicleMovementComponent* WheelMovement =
				Cast<UChaosWheeledVehicleMovementComponent>(GetVehicleMovement()))
		{
			WheelMovement->SetHandbrakeInput(true);
			WheelMovement->SetThrottleInput(0.0f);
		}
	}

	OnOccupantChanged.Broadcast(this, false);
}

APawn* ABCUBaseVehicle::GetSeatPawn(int32 SeatIndex) const
{
	return SeatOccupants.IsValidIndex(SeatIndex) ? SeatOccupants[SeatIndex] : nullptr;
}

APawn* ABCUBaseVehicle::GetDriverPawn() const
{
	const int32 DriverIndex = Definition ? Definition->GetDriverSeatIndex() : 0;
	return GetSeatPawn(FMath::Max(0, DriverIndex));
}

int32 ABCUBaseVehicle::GetOccupantCount() const
{
	int32 Count = 0;
	for (const TObjectPtr<APawn>& Occupant : SeatOccupants)
	{
		if (Occupant)
		{
			Count++;
		}
	}
	return Count;
}

FTransform ABCUBaseVehicle::GetSeatLocalTransformFor(const APawn* Occupant) const
{
	const int32 Index = SeatOccupants.IndexOfByKey(const_cast<APawn*>(Occupant));
	if (Index == INDEX_NONE)
	{
		return FTransform::Identity;
	}

	return Definition && Definition->Seats.IsValidIndex(Index)
		? Definition->Seats[Index].SeatTransform
		: FTransform(FVector(0.0f, Index * -46.0f, 44.0f));
}

bool ABCUBaseVehicle::CanExitSafely(const APawn* Occupant) const
{
	if (IsFlipped() || IsWrecked())
	{
		return true; // always let the player out of a burning wreck
	}

	if (GetSpeedKmh() > SafeExitSpeedKmh)
	{
		return false;
	}

	// Is there pavement (or at least free space) on the exit side?
	const FVector ExitLocation = ComputeExitLocation(Occupant);
	FHitResult Hit;
	FCollisionQueryParams Params(SCENE_QUERY_STAT(BCUExitCheck), false, this);

	const bool bBlocked = GetWorld()->SweepSingleByChannel(
		Hit, ExitLocation + FVector(0.0f, 0.0f, 60.0f), ExitLocation + FVector(0.0f, 0.0f, 20.0f),
		FQuat::Identity, ECC_Pawn, FCollisionShape::MakeCapsule(40.0f, 88.0f), Params);

	return !bBlocked;
}

FVector ABCUBaseVehicle::ComputeExitLocation(const APawn* Occupant) const
{
	const int32 Index = SeatOccupants.IndexOfByKey(const_cast<APawn*>(Occupant));
	FVector Offset = FVector(-40.0f, -150.0f, 0.0f);

	if (Definition && Definition->Seats.IsValidIndex(FMath::Max(0, Index)))
	{
		Offset = Definition->Seats[Index].EntryOffset;
	}

	return GetActorLocation() + GetActorRotation().RotateVector(Offset) + FVector(0.0f, 0.0f, 40.0f);
}

void ABCUBaseVehicle::OnPlayerExited()
{
	// Hand the car back to traffic AI if it was a traffic vehicle.
	if (Traffic && Traffic->ShouldResumeAfterExit())
	{
		Traffic->ResumeRoute();
	}
	else
	{
		SetState(EBCUVehicleState::Parked);
	}
}

void ABCUBaseVehicle::NotifyExitRefused()
{
	if (VehicleAudio)
	{
		VehicleAudio->PlayUISound(EBCUVehicleUISound::ExitRefused);
	}
}

//═══════════════════════════════════════════════════════════════════════════════
// Input / state
//═══════════════════════════════════════════════════════════════════════════════

void ABCUBaseVehicle::ConsumePlayerInput(float DeltaSeconds)
{
	// Tick() already folds PlayerThrottle/Brake/Steer into the smoothed values.
	// This hook exists so a Blueprint controller (or a replay) can push extra
	// per-frame data such as analog trigger curves without a second path.
	if (PlayerThrottle == 0.0f && PlayerBrake == 0.0f && PlayerSteer == 0.0f)
	{
		SmoothedThrottle = FMath::FInterpTo(SmoothedThrottle, 0.0f, DeltaSeconds, ThrottleSmoothing);
	}
}

void ABCUBaseVehicle::SetHandbrake(bool bEngaged)
{
	if (UChaosWheeledVehicleMovementComponent* WheelMovement =
			Cast<UChaosWheeledVehicleMovementComponent>(GetVehicleMovement()))
	{
		WheelMovement->SetHandbrakeInput(bEngaged);
	}

	if (bEngaged && GetSpeedKmh() > 12.0f)
	{
		DriftTimer = 0.6f;
	}
}

void ABCUBaseVehicle::PlayHorn()
{
	if (VehicleAudio)
	{
		VehicleAudio->PlayHorn();
	}
}

void ABCUBaseVehicle::SetHeadlights(bool bOn)
{
	bHeadlightsOn = bOn;
	UpdateLights(0.0f);
}

void ABCUBaseVehicle::SetSiren(bool bOn)
{
	bSirenOn = bOn;

	if (VehicleAudio)
	{
		VehicleAudio->SetSirenActive(bOn);
	}

	if (bOn && Definition && Definition->IsEmergencyVehicle())
	{
		SetState(EBCUVehicleState::Siren);
	}
}

void ABCUBaseVehicle::ActivateBoost()
{
	if (BoostRemaining > 0.0f && !bBoostActive)
	{
		bBoostActive = true;
	}
}

void ABCUBaseVehicle::UpdateBoost(float DeltaSeconds)
{
	if (!bBoostActive)
	{
		return;
	}

	BoostRemaining = FMath::Max(0.0f, BoostRemaining - DeltaSeconds);
	if (BoostRemaining <= 0.0f)
	{
		bBoostActive = false;
	}
}

void ABCUBaseVehicle::UpdateVehicleState(float DeltaSeconds)
{
	EBCUVehicleState NewState = VehicleState;
	const float SpeedKmh = GetSpeedKmh();
	const bool bGrounded = GetVehicleMovement() ? GetVehicleMovement()->IsAnyWheelOnGround() : false;
	const float Slip = FMath::Abs(GetSlipAngle());

	// Slip smoothing avoids flicker between Driving and Drifting.
	SlipAngleSmoothing = FMath::FInterpTo(SlipAngleSmoothing, Slip, DeltaSeconds, 8.0f);

	if (IsWrecked())
	{
		NewState = EBCUVehicleState::Wrecked;
	}
	else if (!bGrounded)
	{
		NewState = EBCUVehicleState::Airborne;
	}
	else if (IsFlipped())
	{
		NewState = EBCUVehicleState::Flipped;
	}
	else if (SlipAngleSmoothing > 14.0f && SpeedKmh > 25.0f)
	{
		NewState = EBCUVehicleState::Drifting;
		DriftTimer = 0.25f;
	}
	else if (DriftTimer > 0.0f)
	{
		DriftTimer -= DeltaSeconds;
		NewState = EBCUVehicleState::Drifting;
	}
	else if (SmoothedBrake > 0.4f && SpeedKmh > 4.0f)
	{
		NewState = EBCUVehicleState::Braking;
	}
	else if (SpeedKmh > 1.0f)
	{
		NewState = EBCUVehicleState::Driving;
	}
	else
	{
		NewState = HasDriver() ? EBCUVehicleState::Idle : EBCUVehicleState::Parked;
	}

	if (bSirenOn && Definition && Definition->IsEmergencyVehicle() && NewState != EBCUVehicleState::Wrecked)
	{
		NewState = EBCUVehicleState::Siren;
	}

	SetState(NewState);

	// Tyre smoke only while actually slipping on the ground.
	if (TyreSmokeFX)
	{
		const bool bWantSmoke = (NewState == EBCUVehicleState::Drifting) && bGrounded;
		if (bWantSmoke && !TyreSmokeFX->IsActive())
		{
			TyreSmokeFX->Activate(true);
		}
		else if (!bWantSmoke && TyreSmokeFX->IsActive())
		{
			TyreSmokeFX->Deactivate();
		}
	}

	// Exhaust vapour at idle in cold weather; handled by the weather system
	// through the audio/FX component so it costs nothing when not needed.
	if (ExhaustFX && !ExhaustFX->IsActive() && NewState == EBCUVehicleState::Idle)
	{
		ExhaustFX->Activate(true);
	}
	else if (ExhaustFX && ExhaustFX->IsActive() && NewState == EBCUVehicleState::Parked)
	{
		ExhaustFX->Deactivate();
	}
}

void ABCUBaseVehicle::SetState(EBCUVehicleState NewState)
{
	if (NewState == VehicleState)
	{
		return;
	}

	const EBCUVehicleState Old = VehicleState;
	VehicleState = NewState;
	OnVehicleStateChanged.Broadcast(NewState, Old);
}

void ABCUBaseVehicle::UpdateFuelAndOdometer(float DeltaSeconds)
{
	const FVector Now = GetActorLocation();
	const float DeltaCm = FVector::Dist(Now, LastPhysicsPosition);
	LastPhysicsPosition = Now;

	const float DeltaKm = DeltaCm / 100000.0f;
	OdometerKm += DeltaKm;

	if (!Definition)
	{
		return;
	}

	// Consumption rises with throttle and boost, and with damage (leaks).
	const float Load = FMath::Abs(SmoothedThrottle) * (bBoostActive ? 2.1f : 1.0f);
	const float LitresPerSecond = (Definition->FuelLitresPer100Km / 360000.0f)
		* (DeltaCm / DeltaSeconds > 0.0f ? DeltaCm / DeltaSeconds : 0.0f)
		* (0.35f + 0.9f * Load);

	FuelLitres = FMath::Max(0.0f, FuelLitres - LitresPerSecond * DeltaSeconds);
}

void ABCUBaseVehicle::UpdateLights(float DeltaSeconds)
{
	if (!Definition)
	{
		return;
	}

	// Headlights: on when the player asks, or automatically at night.
	const bool bAutoOn = ShouldHeadlightsBeAutoOn();
	const bool bOn = bHeadlightsOn || bAutoOn;
	const float HeadIntensity = bOn ? Definition->HeadlightIntensity : 0.0f;
	const FColor HeadColor = Definition->HeadlightColor.ToFColor(/*bSRGB=*/true);

	HeadlightLeft->SetIntensity(HeadIntensity);
	HeadlightRight->SetIntensity(HeadIntensity);
	HeadlightLeft->SetLightColor(HeadColor);
	HeadlightRight->SetLightColor(HeadColor);
	HeadlightLeft->SetVisibility(bOn, true);
	HeadlightRight->SetVisibility(bOn, true);

	// Brake lights.
	const float BrakeIntensity = (SmoothedBrake > 0.05f || IsWrecked())
		? Definition->BrakeLightIntensity : (bOn ? Definition->BrakeLightIntensity * 0.18f : 0.0f);
	TaillightGlow->SetIntensity(BrakeIntensity);

	// Emergency lightbar: alternating strobe, only while the siren is on.
	if (Definition->bHasEmergencyLightbar)
	{
		if (bSirenOn)
		{
			const float Phase = FMath::Fmod(GetWorld()->GetTimeSeconds() * 6.0f, 2.0f);
			const bool bAOn = Phase < 1.0f;
			EmergencyLightA->SetIntensity(bAOn ? 9000.0f : 0.0f);
			EmergencyLightB->SetIntensity(bAOn ? 0.0f : 9000.0f);
			EmergencyLightA->SetLightColor(Definition->EmergencyColorA.ToFColor(/*bSRGB=*/true));
			EmergencyLightB->SetLightColor(Definition->EmergencyColorB.ToFColor(/*bSRGB=*/true));
		}
		else
		{
			EmergencyLightA->SetIntensity(0.0f);
			EmergencyLightB->SetIntensity(0.0f);
		}
	}
}

bool ABCUBaseVehicle::ShouldHeadlightsBeAutoOn() const
{
	// Streetlights are on at night, so the car should be too. Read from the
	// replicated game state so a client and the server agree on dusk.
	if (const ABCUGameState* State = GetWorld() ? GetWorld()->GetGameState<ABCUGameState>() : nullptr)
	{
		return State->IsNight() || State->WeatherIntensity > 0.55f;
	}

	return false;
}

float ABCUBaseVehicle::GetSpeedKmh() const
{
	const UChaosWheeledVehicleMovementComponent* WheelMovement =
		Cast<UChaosWheeledVehicleMovementComponent>(GetVehicleMovement());

	const float ForwardSpeedCmPerS = WheelMovement
		? WheelMovement->GetForwardSpeed()
		: GetVelocity().Size();

	return FMath::Abs(ForwardSpeedCmPerS) * 0.036f;
}

int32 ABCUBaseVehicle::GetCurrentGear() const
{
	const UChaosWheeledVehicleMovementComponent* WheelMovement =
		Cast<UChaosWheeledVehicleMovementComponent>(GetVehicleMovement());
	return WheelMovement ? WheelMovement->GetCurrentGear() : 0;
}

float ABCUBaseVehicle::GetEngineRPM() const
{
	const UChaosWheeledVehicleMovementComponent* WheelMovement =
		Cast<UChaosWheeledVehicleMovementComponent>(GetVehicleMovement());
	return WheelMovement ? WheelMovement->GetEngineRotationSpeed() : 0.0f;
}

float ABCUBaseVehicle::GetSlipAngle() const
{
	const FVector Velocity = GetVelocity();
	if (Velocity.IsNearlyZero())
	{
		return 0.0f;
	}

	const FVector Forward = GetActorForwardVector();
	const FVector FlatVelocity = FVector(Velocity.X, Velocity.Y, 0.0f).GetSafeNormal();
	if (FlatVelocity.IsNearlyZero())
	{
		return 0.0f;
	}

	// Signed angle between where we point and where we are actually going.
	return FMath::RadiansToDegrees(FMath::Atan2(
		FVector::CrossProduct(Forward, FlatVelocity).Z,
		FVector::DotProduct(Forward, FlatVelocity)));
}

bool ABCUBaseVehicle::IsFlipped() const
{
	const float UpDot = FVector::DotProduct(GetActorUpVector(), FVector::UpVector);
	return UpDot < 0.25f && GetSpeedKmh() < 25.0f;
}

void ABCUBaseVehicle::SelfRight()
{
	if (!Definition || !Definition->bCanFlipBack)
	{
		return;
	}

	const FVector Location = GetActorLocation() + FVector(0.0f, 0.0f, 60.0f);
	const FRotator Rotation(0.0f, GetActorRotation().Yaw, 0.0f);

	SetActorLocationAndRotation(Location, Rotation, /*bSweep=*/false);

	if (UPrimitiveComponent* Root = GetMesh())
	{
		Root->SetPhysicsLinearVelocity(FVector::ZeroVector);
		Root->SetPhysicsAngularVelocityInDegrees(FVector::ZeroVector);
	}

	SetState(EBCUVehicleState::Idle);
}

void ABCUBaseVehicle::Refuel(float Litres)
{
	const float Tank = Definition ? Definition->FuelTankLitres : 62.0f;
	FuelLitres = FMath::Clamp(FuelLitres + Litres, 0.0f, Tank);
}
