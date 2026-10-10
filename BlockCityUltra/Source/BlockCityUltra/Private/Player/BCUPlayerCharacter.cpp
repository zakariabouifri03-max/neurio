// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Player/BCUPlayerCharacter.h"

#include "Core/BCUGameMode.h"
#include "Core/BCUPlayerController.h"
#include "Player/BCUCameraSystem.h"
#include "Player/BCUInteractionComponent.h"
#include "Player/BCUHealthComponent.h"
#include "Player/BCUVoxelBodyComponent.h"
#include "Vehicle/BCUBaseVehicle.h"
#include "Camera/CameraComponent.h"
#include "Components/CapsuleComponent.h"
#include "Components/WidgetComponent.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/SpringArmComponent.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUCharacter, Log, All);

ABCUPlayerCharacter::ABCUPlayerCharacter()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickGroup = TG_PrePhysics;

	bUseControllerRotationPitch = false;
	bUseControllerRotationYaw = false;      // camera-relative movement
	bUseControllerRotationRoll = false;

	// Voxel-proportioned capsule: blocky characters are slightly wider than
	// they are deep, which reads better against cubic architecture.
	GetCapsuleComponent()->InitCapsuleSize(46.0f, 96.0f);
	GetCapsuleComponent()->SetCollisionProfileName(TEXT("BCU_Pedestrian"));

	UCharacterMovementComponent* Move = GetCharacterMovement();
	Move->bOrientRotationToMovement = true;
	Move->RotationRate = FRotator(0.0f, RotationRateDegreesPerSecond, 0.0f);
	Move->bConstrainToPlane = true;
	Move->bSnapToPlaneAtStart = true;
	Move->MaxWalkSpeed = JogSpeed;
	Move->MaxAcceleration = GroundAcceleration;
	Move->BrakingDecelerationWalking = GroundDeceleration;
	Move->GroundFriction = 8.0f;
	Move->JumpZVelocity = 520.0f;
	Move->AirControl = 0.28f;
	Move->MaxSwimSpeed = 260.0f;
	Move->Buoyancy = 0.9f;
	Move->bCanWalkOffLedges = true;
	Move->SetIsReplicated(true);
	Move->NetworkSimulatedSmoothLocationError = 4.0f;
	Move->bAllowRootMotion = false;

	CameraBoom = CreateDefaultSubobject<USpringArmComponent>(TEXT("CameraBoom"));
	CameraBoom->SetupAttachment(RootComponent);
	CameraBoom->TargetArmLength = 420.0f;
	CameraBoom->SocketOffset = FVector(0.0f, 48.0f, 62.0f);
	CameraBoom->bUsePawnControlRotation = true;
	CameraBoom->bInheritPitch = false;
	CameraBoom->bInheritRoll = false;
	CameraBoom->bEnableCameraLag = true;
	CameraBoom->CameraLagSpeed = 11.0f;
	CameraBoom->bEnableCameraRotationLag = true;
	CameraBoom->CameraRotationLagSpeed = 9.0f;
	CameraBoom->bDoCollisionTest = true;
	CameraBoom->ProbeSize = 14.0f;
	CameraBoom->ProbeChannel = ECC_Camera;

	FollowCamera = CreateDefaultSubobject<UCameraComponent>(TEXT("FollowCamera"));
	FollowCamera->SetupAttachment(CameraBoom, USpringArmComponent::SocketName);
	FollowCamera->bUsePawnControlRotation = false;
	FollowCamera->FieldOfView = 90.0f;
	FollowCamera->bConstrainAspectRatio = false;
	FollowCamera->PostProcessSettings.bOverride_MotionBlurAmount = true;
	FollowCamera->PostProcessSettings.MotionBlurAmount = 0.35f;
	FollowCamera->PostProcessSettings.bOverride_AutoExposureMethod = true;
	FollowCamera->PostProcessSettings.AutoExposureMethod = EAutoExposureMethod::AEM_Histogram;

	CameraSystem = CreateDefaultSubobject<UBCUCameraSystem>(TEXT("CameraSystem"));
	CameraSystem->SetFollowCamera(FollowCamera);
	CameraSystem->SetBoom(CameraBoom);

	Interaction = CreateDefaultSubobject<UBCUInteractionComponent>(TEXT("Interaction"));
	Interaction->SetupAttachment(RootComponent);

	VoxelBody = CreateDefaultSubobject<UBCUVoxelBodyComponent>(TEXT("VoxelBody"));
	VoxelBody->SetupAttachment(RootComponent);

	Health = CreateDefaultSubobject<UBCUHealthComponent>(TEXT("Health"));
	Health->SetMaxHealth(100.0f);

	InteractionPrompt = CreateDefaultSubobject<UWidgetComponent>(TEXT("InteractionPrompt"));
	InteractionPrompt->SetupAttachment(RootComponent);
	InteractionPrompt->SetRelativeLocation(FVector(0.0f, 0.0f, 130.0f));
	InteractionPrompt->SetWidgetSpace(EWidgetSpace::Screen);
	InteractionPrompt->SetDrawSize(FVector2D(320.0f, 64.0f));
	InteractionPrompt->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	InteractionPrompt->SetHiddenInGame(true);

	BaseEyeHeight = 82.0f;
}

void ABCUPlayerCharacter::PostInitializeComponents()
{
	Super::PostInitializeComponents();

	if (UCharacterMovementComponent* Move = GetCharacterMovement())
	{
		Move->RotationRate = FRotator(0.0f, RotationRateDegreesPerSecond, 0.0f);
	}
}

void ABCUPlayerCharacter::BeginPlay()
{
	Super::BeginPlay();

	LastPosition = GetActorLocation();

	if (VoxelBody)
	{
		// Builds the cubic torso/limb/head parts once, then the animation
		// blueprint drives them. Cheap: ~1.4k triangles for a full body.
		VoxelBody->BuildBody();
	}

	if (Health)
	{
		Health->OnHealthDepleted.AddDynamic(this, &ABCUPlayerCharacter::OnHealthDepleted);
	}

	UE_LOG(LogBCUCharacter, Log, TEXT("Player character ready (%s)"), *GetName());
}

void ABCUPlayerCharacter::PossessedBy(AController* NewController)
{
	Super::PossessedBy(NewController);

	if (ABCUPlayerController* PC = Cast<ABCUPlayerController>(NewController))
	{
		BCUPC = PC;
		if (CameraSystem)
		{
			CameraSystem->SetViewTarget(PC);
			CameraSystem->SetCameraModeFor(EBCUControlContext::OnFoot);
		}
	}
}

void ABCUPlayerCharacter::SetupPlayerInputComponent(UInputComponent* PlayerInputComponent)
{
	Super::SetupPlayerInputComponent(PlayerInputComponent);
	// All gameplay bindings live on ABCUPlayerController so the context swap
	// (on foot ⇄ driving ⇄ UI) is handled in exactly one place.
}

void ABCUPlayerCharacter::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	if (IsDriving())
	{
		// The vehicle ticks us; keep the voxel body in the seat pose only.
		if (VoxelBody)
		{
			VoxelBody->SetSeatedPose(VehicleBeingDriven->GetSeatLocalTransformFor(this));
		}
		LocomotionState = EBCULocomotionState::InVehicle;
		return;
	}

	UpdateLocomotionState(DeltaSeconds);
	UpdateStamina(DeltaSeconds);
	UpdateDistanceStats(DeltaSeconds);
	ApplySpeedForState();

	if (CameraSystem)
	{
		CameraSystem->TickCamera(DeltaSeconds);
	}
}

void ABCUPlayerCharacter::AddMovementInputFromAxis(const FVector2D& Axis)
{
	CachedMoveAxis = Axis;

	if (IsDriving() || Axis.IsNearlyZero())
	{
		return;
	}

	// Camera-relative: forward is where the camera looks, flattened.
	const FRotator YawRotation(0.0f, GetControlRotation().Yaw, 0.0f);
	const FVector Forward = FRotationMatrix(YawRotation).GetUnitAxis(EAxis::X);
	const FVector Right = FRotationMatrix(YawRotation).GetUnitAxis(EAxis::Y);

	AddMovementInput(Forward, Axis.Y);
	AddMovementInput(Right, Axis.X);
}

void ABCUPlayerCharacter::SetWantsSprint(bool bWants)
{
	bWantsSprint = bWants && !bExhausted;
}

void ABCUPlayerCharacter::StartJump()
{
	if (!IsDriving() && StaminaFraction > StaminaExhaustedThreshold)
	{
		Jump();
		StaminaFraction = FMath::Max(0.0f, StaminaFraction - 0.06f);
	}
}

void ABCUPlayerCharacter::StopJump()
{
	StopJumping();
}

void ABCUPlayerCharacter::Landed(const FHitResult& Hit)
{
	Super::Landed(Hit);

	// Fall damage is a real risk in a city with rooftops and flyovers.
	if (UCharacterMovementComponent* Move = GetCharacterMovement())
	{
		const float ImpactSpeed = FMath::Abs(Move->Velocity.Z);
		if (ImpactSpeed > 1800.0f && Health)
		{
			ApplyDamage((ImpactSpeed - 1800.0f) * 0.02f, FVector::ZeroVector);
		}
	}

	if (CameraSystem)
	{
		CameraSystem->NotifyLanding();
	}
}

void ABCUPlayerCharacter::UpdateLocomotionState(float DeltaSeconds)
{
	const UCharacterMovementComponent* Move = GetCharacterMovement();
	if (!Move)
	{
		return;
	}

	if (Health && Health->IsDowned())
	{
		LocomotionState = EBCULocomotionState::Downed;
		return;
	}

	switch (Move->MovementMode)
	{
	case MOVE_Swimming:
		LocomotionState = EBCULocomotionState::Swimming;
		return;
	case MOVE_Falling:
		LocomotionState = EBCULocomotionState::Falling;
		return;
	case MOVE_Navigation:
	case MOVE_Flying:
		LocomotionState = EBCULocomotionState::Falling;
		return;
	default:
		break;
	}

	const float Speed = GetSpeedKmh();
	if (Speed < 1.0f)
	{
		LocomotionState = bWantsSprint ? EBCULocomotionState::Sprinting : EBCULocomotionState::Idle;
	}
	else if (Speed < 14.0f)
	{
		LocomotionState = EBCULocomotionState::Walking;
	}
	else if (Speed < 26.0f)
	{
		LocomotionState = EBCULocomotionState::Jogging;
	}
	else
	{
		LocomotionState = EBCULocomotionState::Sprinting;
	}
}

void ABCUPlayerCharacter::UpdateStamina(float DeltaSeconds)
{
	const bool bDraining = (LocomotionState == EBCULocomotionState::Sprinting)
		&& !CachedMoveAxis.IsNearlyZero();

	if (bDraining)
	{
		StaminaFraction = FMath::Max(0.0f, StaminaFraction - StaminaDrainPerSecond * DeltaSeconds);
		if (StaminaFraction <= 0.0f)
		{
			bExhausted = true;
			bWantsSprint = false;
		}
	}
	else
	{
		StaminaFraction = FMath::Min(1.0f, StaminaFraction + StaminaRegenPerSecond * DeltaSeconds);
		if (StaminaFraction >= 0.45f)
		{
			bExhausted = false;
		}
	}
}

void ABCUPlayerCharacter::UpdateDistanceStats(float DeltaSeconds)
{
	const FVector Now = GetActorLocation();
	const float DeltaCm = FVector::Dist(Now, LastPosition);
	LastPosition = Now;

	// cm → km. Accumulated for the stats panel and the "walked the whole city"
	// achievement; cheap enough to do every tick with a single distance call.
	DistanceTravelledKm += (DeltaCm / 100000.0f);
}

void ABCUPlayerCharacter::ApplySpeedForState()
{
	UCharacterMovementComponent* Move = GetCharacterMovement();
	if (!Move)
	{
		return;
	}

	float TargetSpeed = JogSpeed;
	switch (LocomotionState)
	{
	case EBCULocomotionState::Walking:	TargetSpeed = WalkSpeed; break;
	case EBCULocomotionState::Sprinting:TargetSpeed = SprintSpeed; break;
	case EBCULocomotionState::Swimming:	TargetSpeed = Move->MaxSwimSpeed; break;
	default:							TargetSpeed = JogSpeed; break;
	}

	if (Move->IsCrouching())
	{
		TargetSpeed = CrouchSpeed;
	}

	if (!FMath::IsNearlyEqual(Move->MaxWalkSpeed, TargetSpeed))
	{
		Move->MaxWalkSpeed = TargetSpeed;
		Move->MaxWalkSpeedCrouched = CrouchSpeed;
	}
}

float ABCUPlayerCharacter::GetSpeedKmh() const
{
	const UCharacterMovementComponent* Move = GetCharacterMovement();
	const float SpeedCmPerS = Move ? Move->Velocity.Size2D() : 0.0f;
	return SpeedCmPerS * 0.036f; // cm/s → km/h
}

void ABCUPlayerCharacter::SetVehicleBeingDriven(ABCUBaseVehicle* Vehicle)
{
	VehicleBeingDriven = Vehicle;

	const bool bDriving = (Vehicle != nullptr);
	SetActorHiddenInGame(bDriving);
	SetActorEnableCollision(!bDriving);
	SetActorTickEnabled(true);

	if (UCharacterMovementComponent* Move = GetCharacterMovement())
	{
		Move->SetMovementMode(bDriving ? MOVE_None : MOVE_Walking);
		Move->Velocity = FVector::ZeroVector;
	}

	LocomotionState = bDriving ? EBCULocomotionState::InVehicle : EBCULocomotionState::Idle;

	if (CameraSystem)
	{
		CameraSystem->SetCameraModeFor(bDriving ? EBCUControlContext::Driving : EBCUControlContext::OnFoot);
	}
}

void ABCUPlayerCharacter::PostExitVehicle(ABCUBaseVehicle* Vehicle)
{
	if (UCharacterMovementComponent* Move = GetCharacterMovement())
	{
		Move->SetMovementMode(MOVE_Walking);
	}

	// Match the pavement, not the car: zero the velocity so we do not slide.
	if (GetCharacterMovement())
	{
		GetCharacterMovement()->Velocity = FVector::ZeroVector;
	}

	if (CameraSystem)
	{
		CameraSystem->SetCameraModeFor(EBCUControlContext::OnFoot);
		CameraSystem->NotifyVehicleExit();
	}

	SetActorHiddenInGame(false);
	SetActorEnableCollision(true);
}

float ABCUPlayerCharacter::TakeDamage(float DamageAmount, FDamageEvent const& DamageEvent,
	AController* EventInstigator, AActor* DamageCauser)
{
	const float Applied = Super::TakeDamage(DamageAmount, DamageEvent, EventInstigator, DamageCauser);

	if (Applied > 0.0f)
	{
		FVector Impulse = FVector::ZeroVector;
		if (const FPointDamageEvent* PointEvent = FPointDamageEvent::ClassID == DamageEvent.GetTypeID()
				? static_cast<const FPointDamageEvent*>(&DamageEvent) : nullptr)
		{
			Impulse = PointEvent->HitInfo.ImpactNormal * -1.0f;
		}
		ApplyDamage(Applied, Impulse);
	}

	return Applied;
}

void ABCUPlayerCharacter::ApplyDamage(float Amount, const FVector& Impulse)
{
	if (Health)
	{
		Health->ApplyDamage(Amount, Impulse);
	}
}

void ABCUPlayerCharacter::OnHealthDepleted()
{
	LocomotionState = EBCULocomotionState::Downed;

	if (UWorld* World = GetWorld())
	{
		if (ABCUGameMode* GM = World->GetAuthGameMode<ABCUGameMode>())
		{
			GM->RespawnPlayer(/*bWasArrested=*/false);
		}
	}
}

void ABCUPlayerCharacter::Revive()
{
	if (Health)
	{
		Health->Revive();
	}

	StaminaFraction = 1.0f;
	bExhausted = false;
	LocomotionState = EBCULocomotionState::Idle;
	SetActorHiddenInGame(false);
	SetActorEnableCollision(true);
}

float ABCUPlayerCharacter::GetHealthFraction() const
{
	return Health ? Health->GetHealthFraction() : 1.0f;
}

void ABCUPlayerCharacter::Heal(float Amount)
{
	if (Health)
	{
		Health->Heal(Amount);
	}
}

void ABCUPlayerCharacter::ApplyOutfit(FName OutfitId)
{
	if (VoxelBody)
	{
		VoxelBody->ApplyOutfit(OutfitId);
	}
}

void ABCUPlayerCharacter::SetBodyVoxelPalette(FLinearColor Skin, FLinearColor Shirt,
	FLinearColor Trousers, FLinearColor Shoes)
{
	if (VoxelBody)
	{
		VoxelBody->SetPalette(Skin, Shirt, Trousers, Shoes);
	}
}
