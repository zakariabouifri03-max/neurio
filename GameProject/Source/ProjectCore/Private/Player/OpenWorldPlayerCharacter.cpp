// Copyright GameProject. All rights reserved. Original content only.

#include "Player/OpenWorldPlayerCharacter.h"

#include "Components/CapsuleComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Core/GameProjectBlueprintLibrary.h"
#include "Core/GameProjectLog.h"
#include "Core/GameProjectTags.h"
#include "Engine/StaticMesh.h"
#include "GameFramework/CharacterMovementComponent.h"
#include "GameFramework/PlayerController.h"
#include "Interaction/OpenWorldInteractionComponent.h"
#include "PhysicsEngine/PhysicalMaterial.h"
#include "Player/OpenWorldCameraRigComponent.h"
#include "Player/OpenWorldMovementSettings.h"
#include "World/OpenWorldStreamingSourceComponent.h"

AOpenWorldPlayerCharacter::AOpenWorldPlayerCharacter()
{
	// No custom Tick: gait, camera and interaction are all event/timer driven.
	// ACharacter's own tick stays enabled because the engine needs it.
	PrimaryActorTick.bCanEverTick = true;
	bUseControllerRotationPitch = false;
	bUseControllerRotationYaw = false;
	bUseControllerRotationRoll = false;

	GetCapsuleComponent()->SetCapsuleSize(34.0f, 90.0f);
	GetCapsuleComponent()->SetCollisionProfileName(TEXT("Pawn"));

	CameraRig = CreateDefaultSubobject<UOpenWorldCameraRigComponent>(TEXT("CameraRig"));
	CameraRig->SetupAttachment(GetCapsuleComponent());
	// Shoulder height for a ~180cm character, so the arm pivots at the head.
	CameraRig->SetRelativeLocation(FVector(0.0f, 0.0f, 60.0f));

	Interaction = CreateDefaultSubobject<UOpenWorldInteractionComponent>(TEXT("Interaction"));
	StreamingSource = CreateDefaultSubobject<UOpenWorldStreamingSourceComponent>(TEXT("StreamingSource"));

	PlaceholderBody = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("PlaceholderBody"));
	PlaceholderBody->SetupAttachment(GetCapsuleComponent());
	PlaceholderBody->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	PlaceholderBody->SetGenerateOverlapEvents(false);
	PlaceholderBody->SetCastShadow(true);
	PlaceholderBody->SetVisibility(false);

	// Mesh is not needed for gameplay in Phase 01, but keeping it non-rendering
	// avoids "no skeleton" spam in the log until a real character is authored.
	GetMesh()->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	GetMesh()->bCastDynamicShadow = true;
}

void AOpenWorldPlayerCharacter::PossessedBy(AController* NewController)
{
	Super::PossessedBy(NewController);

	ApplyMovementBaseSettings();
	UpdateGait();
}

void AOpenWorldPlayerCharacter::BeginPlay()
{
	Super::BeginPlay();

	ApplyMovementBaseSettings();
	EnsurePlaceholderVisuals();

	LastSafeLocation = GetActorLocation();
	UpdatePlayerStateTags();

	UE_LOG(LogPlayer, Log, TEXT("Player character BeginPlay at %s (gait=%s)."),
		*UGameProjectBlueprintLibrary::FormatPosition(LastSafeLocation),
		*UEnum::GetValueAsString(CurrentGait));
}

void AOpenWorldPlayerCharacter::ApplyMovementBaseSettings()
{
	// Resolve once and hold the reference here so the asset cannot be collected
	// while the pawn is alive.
	MovementSettings = UOpenWorldMovementSettings::Resolve();

	UCharacterMovementComponent* Movement = GetCharacterMovement();
	if (!Movement || !MovementSettings)
	{
		return;
	}

	MovementSettings->ApplyBase(*Movement, *GetCapsuleComponent());
	Movement->bUseControllerRotationYaw = false;

	// Sensible rotation model for third person: the pawn faces where it moves,
	// the camera owns where the player looks.
	Movement->bOrientRotationToMovement = MovementSettings->bOrientRotationToMovement;
}

void AOpenWorldPlayerCharacter::EnsurePlaceholderVisuals()
{
	const bool bHasAuthoredMesh = GetMesh() && GetMesh()->GetSkeletalMeshAsset() != nullptr;
	if (bHasAuthoredMesh)
	{
		PlaceholderBody->SetVisibility(false, /*bPropagateToChildren*/ true);
		return;
	}

	UStaticMesh* Cube = UGameProjectBlueprintLibrary::GetPlaceholderCubeMesh();
	if (!Cube)
	{
		return;
	}

	// Two engine cubes make a readable blocky humanoid that matches the game's
	// voxel identity, and cost nothing to keep.
	PlaceholderBody->SetStaticMesh(Cube);
	PlaceholderBody->SetRelativeLocation(FVector(0.0f, 0.0f, -20.0f));
	PlaceholderBody->SetRelativeScale3D(FVector(0.55f, 0.35f, 1.25f));
	PlaceholderBody->SetVisibility(true, /*bPropagateToChildren*/ true);

	if (UMaterialInterface* Material = UGameProjectBlueprintLibrary::GetPlaceholderMaterial())
	{
		PlaceholderBody->SetMaterial(0, Material);
	}
}

// ------------------------------------------------------------------ input
void AOpenWorldPlayerCharacter::ApplyMoveInput(const FVector2D& AxisValue)
{
	PendingMoveInput = AxisValue.GetClampedToMaxSize(1.0f);
	bHasMoveInput = !PendingMoveInput.IsNearlyZero();

	if (!bHasMoveInput)
	{
		UpdateGait();
		return;
	}

	// Camera-relative movement: forward/right come from the *control* rotation with
	// pitch flattened, so looking up or down never changes where "forward" is.
	const FRotator YawRotation(0.0f, GetControlRotation().Yaw, 0.0f);
	const FVector Forward = FRotationMatrix(YawRotation).GetUnitAxis(EAxis::X);
	const FVector Right = FRotationMatrix(YawRotation).GetUnitAxis(EAxis::Y);

	AddMovementInput(Forward, PendingMoveInput.Y);
	AddMovementInput(Right, PendingMoveInput.X);

	UpdateGait();
}

void AOpenWorldPlayerCharacter::ApplyLookInput(const FVector2D& AxisValue)
{
	APlayerController* PC = Cast<APlayerController>(GetController());
	if (!PC)
	{
		return;
	}

	// Sensitivity lives in the settings subsystem so the options menu can change it
	// at runtime without the character knowing anything about UI.
	const float SensitivityScale = GetLookSensitivityScale();

	const FRotator Current = PC->GetControlRotation();
	const float NewPitch = CameraRig ? CameraRig->ClampPitch(Current.Pitch + AxisValue.Y * SensitivityScale)
	                                  : FMath::Clamp(Current.Pitch + AxisValue.Y * SensitivityScale, -89.0f, 89.0f);

	PC->SetControlRotation(FRotator(NewPitch, Current.Yaw + AxisValue.X * SensitivityScale, 0.0f));
}

void AOpenWorldPlayerCharacter::StartJump()
{
	// Re-applying the base settings here is unnecessary, but re-checking the gait is:
	// jumping while crouched should stand the character up, which is the behaviour
	// players expect and which the engine will not do for us.
	if (bIsCrouched)
	{
		UnCrouch();
	}
	Jump();
}

void AOpenWorldPlayerCharacter::StopJump()
{
	// Cutting upward velocity on release gives controllable jump arcs without a
	// custom movement mode.
	UCharacterMovementComponent* Movement = GetCharacterMovement();
	if (Movement && MovementSettings && Movement->Velocity.Z > 0.0f)
	{
		Movement->Velocity.Z *= MovementSettings->JumpReleaseVelocityScale;
	}
	StopJumping();
}

void AOpenWorldPlayerCharacter::SetSprintHeld(bool bHeld)
{
	if (bSprintHeld == bHeld)
	{
		return;
	}

	bSprintHeld = bHeld;
	UpdateGait();
}

void AOpenWorldPlayerCharacter::ToggleCrouch()
{
	if (bIsCrouched)
	{
		// UnCrouch can fail (blocked by a low ceiling); the engine handles the test.
		UnCrouch();
	}
	else
	{
		Crouch();
	}
	UpdateGait();
}

void AOpenWorldPlayerCharacter::RequestInteract()
{
	if (Interaction)
	{
		Interaction->TryInteract();
	}
}

void AOpenWorldPlayerCharacter::Crouch(bool bClientSimulation)
{
	Super::Crouch(bClientSimulation);
	UpdateGait();
}

void AOpenWorldPlayerCharacter::UnCrouch(bool bClientSimulation)
{
	Super::UnCrouch(bClientSimulation);
	UpdateGait();
}

// ------------------------------------------------------------------ gait
void AOpenWorldPlayerCharacter::UpdateGait()
{
	EOpenWorldGait DesiredGait;
	if (bIsCrouched)
	{
		DesiredGait = EOpenWorldGait::Crouch;
	}
	else if (bSprintHeld && bHasMoveInput)
	{
		DesiredGait = EOpenWorldGait::Sprint;
	}
	else if (bHasMoveInput)
	{
		DesiredGait = EOpenWorldGait::Run;
	}
	else
	{
		// Standing still keeps the walk profile so releasing the stick decelerates
		// at the walk rate instead of the sprint rate.
		DesiredGait = EOpenWorldGait::Walk;
	}

	const FOpenWorldGaitSettings* GaitSettings = nullptr;
	if (MovementSettings)
	{
		switch (DesiredGait)
		{
		case EOpenWorldGait::Walk:   GaitSettings = &MovementSettings->Walk;   break;
		case EOpenWorldGait::Run:    GaitSettings = &MovementSettings->Run;    break;
		case EOpenWorldGait::Sprint: GaitSettings = &MovementSettings->Sprint; break;
		case EOpenWorldGait::Crouch: GaitSettings = &MovementSettings->Crouch; break;
		default:                     GaitSettings = &MovementSettings->Run;    break;
		}
	}

	if (UCharacterMovementComponent* Movement = GetCharacterMovement())
	{
		if (GaitSettings)
		{
			MovementSettings->ApplyGait(*Movement, *GaitSettings);
		}

		// While airborne the gait must not change the horizontal authority, but the
		// camera should still feel the sprint.
		const bool bGrounded = Movement->MovementMode == MOVE_Walking || Movement->MovementMode == MOVE_Navigating;
		Movement->bOrientRotationToMovement = MovementSettings ? MovementSettings->bOrientRotationToMovement : true;
		if (!bGrounded)
		{
			Movement->MaxAcceleration = GaitSettings ? GaitSettings->MaxAcceleration : 2048.0f;
		}

		if (CameraRig && GaitSettings)
		{
			CameraRig->SetGaitCameraBonus(GaitSettings->CameraFOVBonus, GaitSettings->CameraArmLengthBonus);
		}
	}

	if (DesiredGait != CurrentGait)
	{
		const EOpenWorldGait Previous = CurrentGait;
		CurrentGait = DesiredGait;
		UpdatePlayerStateTags();
		OnGaitChanged.Broadcast(Previous, CurrentGait);

		UE_LOG(LogPlayer, Verbose, TEXT("Gait %s -> %s"),
			*UEnum::GetValueAsString(Previous), *UEnum::GetValueAsString(CurrentGait));
	}
}

void AOpenWorldPlayerCharacter::UpdatePlayerStateTags()
{
	PlayerStateTags.Reset();

	if (CurrentGait == EOpenWorldGait::Sprint)
	{
		PlayerStateTags.AddTag(GameProjectTags::PlayerStateSprinting());
	}
	if (bIsCrouched)
	{
		PlayerStateTags.AddTag(GameProjectTags::PlayerStateCrouching());
	}
	if (GetCharacterMovement() && GetCharacterMovement()->IsFalling())
	{
		PlayerStateTags.AddTag(GameProjectTags::PlayerStateInAir());
	}
}

FGameplayTagContainer AOpenWorldPlayerCharacter::GetPlayerStateTags() const
{
	return PlayerStateTags;
}

float AOpenWorldPlayerCharacter::GetHorizontalSpeed() const
{
	const FVector Velocity = GetVelocity();
	return FMath::Sqrt(Velocity.X * Velocity.X + Velocity.Y * Velocity.Y);
}

EPhysicalSurface AOpenWorldPlayerCharacter::GetCurrentGroundSurfaceType() const
{
	const UCharacterMovementComponent* Movement = GetCharacterMovement();
	if (!Movement)
	{
		return SurfaceType_Default;
	}

	const FHitResult& Floor = Movement->CurrentFloor.HitResult;
	if (Floor.IsValidBlockingHit() && Floor.PhysicalMaterial.IsValid())
	{
		return UPhysicalMaterial::DetermineSurfaceType(Floor.PhysicalMaterial.Get());
	}
	return SurfaceType_Default;
}

// ------------------------------------------------------------------ vitals
void AOpenWorldPlayerCharacter::SetHealth(float NewHealth)
{
	const float Clamped = FMath::Clamp(NewHealth, 0.0f, MaxHealth);
	if (FMath::IsNearlyEqual(Clamped, Health))
	{
		return;
	}

	Health = Clamped;
	OnVitalsChanged.Broadcast(Health, Armor);
}

void AOpenWorldPlayerCharacter::SetArmor(float NewArmor)
{
	const float Clamped = FMath::Clamp(NewArmor, 0.0f, MaxArmor);
	if (FMath::IsNearlyEqual(Clamped, Armor))
	{
		return;
	}

	Armor = Clamped;
	OnVitalsChanged.Broadcast(Health, Armor);
}

// ------------------------------------------------------------------ recovery
void AOpenWorldPlayerCharacter::Landed(const FHitResult& Hit)
{
	Super::Landed(Hit);

	// Only remember positions we actually stood on; this is what makes the
	// fell-out-of-world recovery put the player somewhere sane in a voxel world
	// that may still be streaming under their feet.
	if (Hit.IsValidBlockingHit())
	{
		LastSafeLocation = GetActorLocation();
	}
	UpdatePlayerStateTags();
}

void AOpenWorldPlayerCharacter::FellOutOfWorld(const UClass* DamageType)
{
	UE_LOG(LogPlayer, Warning, TEXT("Player fell out of the world at %s; recovering to %s."),
		*UGameProjectBlueprintLibrary::FormatPosition(GetActorLocation()),
		*UGameProjectBlueprintLibrary::FormatPosition(LastSafeLocation));

	// Deliberately not calling Super (which kills the pawn). A foundation build
	// that dies whenever a chunk has not streamed in yet is untestable.
	SetActorLocationAndRotation(LastSafeLocation, GetActorRotation(), /*bSweep*/ false);

	if (UCharacterMovementComponent* Movement = GetCharacterMovement())
	{
		Movement->Velocity = FVector::ZeroVector;
		Movement->SetMovementMode(MOVE_Walking);
	}
}
