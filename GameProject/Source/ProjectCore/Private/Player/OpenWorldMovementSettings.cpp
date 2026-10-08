// Copyright GameProject. All rights reserved. Original content only.

#include "Player/OpenWorldMovementSettings.h"

#include "Components/CapsuleComponent.h"
#include "Core/GameProjectBlueprintLibrary.h"
#include "Core/GameProjectLog.h"
#include "Core/GameProjectSettings.h"
#include "GameFramework/CharacterMovementComponent.h"

UOpenWorldMovementSettings::UOpenWorldMovementSettings()
{
	// Gait ladder. Numbers are in cm/s: 300 walk, 600 run, 850 sprint, 180 crouch.
	// These are the only place in the project where on-foot speeds exist.
	Walk.MaxSpeed = 300.0f;
	Walk.MaxAcceleration = 1536.0f;
	Walk.BrakingDeceleration = 1024.0f;
	Walk.GroundFriction = 6.0f;
	Walk.RotationRate = FRotator(0.0f, 720.0f, 0.0f);

	Run.MaxSpeed = 600.0f;
	Run.MaxAcceleration = 2048.0f;
	Run.BrakingDeceleration = 1024.0f;
	Run.GroundFriction = 4.0f;
	Run.RotationRate = FRotator(0.0f, 540.0f, 0.0f);

	Sprint.MaxSpeed = 850.0f;
	Sprint.MaxAcceleration = 3072.0f;
	Sprint.BrakingDeceleration = 768.0f;
	Sprint.GroundFriction = 3.0f;
	Sprint.RotationRate = FRotator(0.0f, 360.0f, 0.0f);
	Sprint.CameraFOVBonus = 6.0f;
	Sprint.CameraArmLengthBonus = 45.0f;

	Crouch.MaxSpeed = 180.0f;
	Crouch.MaxAcceleration = 1024.0f;
	Crouch.BrakingDeceleration = 1536.0f;
	Crouch.GroundFriction = 8.0f;
	Crouch.RotationRate = FRotator(0.0f, 360.0f, 0.0f);
}

void UOpenWorldMovementSettings::ApplyGait(UCharacterMovementComponent& Movement, const FOpenWorldGaitSettings& Gait) const
{
	Movement.MaxWalkSpeed = Gait.MaxSpeed;
	Movement.MaxWalkSpeedCrouched = Crouch.MaxSpeed;
	Movement.MaxAcceleration = Gait.MaxAcceleration;
	Movement.BrakingDecelerationWalking = Gait.BrakingDeceleration;
	Movement.GroundFriction = Gait.GroundFriction;
	Movement.RotationRate = Gait.RotationRate;
}

void UOpenWorldMovementSettings::ApplyBase(UCharacterMovementComponent& Movement, UCapsuleComponent& Capsule) const
{
	Capsule.SetCapsuleRadius(CapsuleRadius, /*bUpdateOverlaps*/ false);
	Capsule.SetCapsuleHalfHeight(StandingHalfHeight, /*bUpdateOverlaps*/ false);

	Movement.JumpZVelocity = JumpZVelocity;
	Movement.AirControl = AirControl;
	Movement.MaxStepHeight = MaxStepHeight;
	Movement.WalkableFloorAngle = WalkableFloorAngle;
	Movement.bOrientRotationToMovement = bOrientRotationToMovement;
	Movement.RotationRate = Run.RotationRate;
	Movement.MaxWalkSpeed = Run.MaxSpeed;
	Movement.MaxWalkSpeedCrouched = Crouch.MaxSpeed;
	Movement.MaxAcceleration = Run.MaxAcceleration;
	Movement.BrakingDecelerationWalking = Run.BrakingDeceleration;
	Movement.BrakingDecelerationFalling = 0.0f;
	Movement.GroundFriction = Run.GroundFriction;
	Movement.bUseControllerDesiredRotation = false;

	// Voxel walls are thin and sprint speeds are high: keep the simulation sub-step
	// small enough that the capsule cannot tunnel through a single-block wall.
	Movement.MaxSimulationTimeStep = 0.05f;

	// Phase 01 has no physics props to shove around. Re-enable when destructibles
	// and pushable objects land, not before.
	Movement.bEnablePhysicsInteraction = false;
}

const UOpenWorldMovementSettings* UOpenWorldMovementSettings::Resolve()
{
	const UOpenWorldMovementSettings* Resolved = UGameProjectBlueprintLibrary::ResolveSoftObject(
		UGameProjectSettings::Get().MovementSettings, TEXT("movement settings"));

	if (!Resolved)
	{
		// No asset assigned yet: fall back to the C++ defaults (the CDO is always
		// rooted) rather than to zeroed movement, which would look like a bug.
		Resolved = GetDefault<UOpenWorldMovementSettings>();
	}

	return Resolved;
}
