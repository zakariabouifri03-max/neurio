// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "OpenWorldMovementSettings.generated.h"

class UCharacterMovementComponent;
class UCapsuleComponent;

/** Per-gait tuning bundle. One of these per movement mode keeps the table readable. */
USTRUCT(BlueprintType)
struct FOpenWorldGaitSettings
{
	GENERATED_BODY()

	/** Top speed in cm/s for this gait. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Gait", meta = (ClampMin = "0.0"))
	float MaxSpeed = 600.0f;

	/** How quickly the gait reaches MaxSpeed. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Gait", meta = (ClampMin = "0.0"))
	float MaxAcceleration = 2048.0f;

	/** How quickly the gait stops when input is released. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Gait", meta = (ClampMin = "0.0"))
	float BrakingDeceleration = 1024.0f;

	/** Ground friction while in this gait (higher = snappier stop). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Gait", meta = (ClampMin = "0.0", ClampMax = "16.0"))
	float GroundFriction = 4.0f;

	/**
	 * How fast the character turns to face its movement direction, in deg/s.
	 * Sprinting turns slower than walking, which is what makes a heavy character
	 * feel heavy without adding an animation system.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Gait")
	FRotator RotationRate = FRotator(0.0f, 540.0f, 0.0f);

	/** Camera field-of-view offset applied while this gait is active. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Gait|Camera", meta = (ClampMin = "-20.0", ClampMax = "30.0"))
	float CameraFOVBonus = 0.0f;

	/** Extra spring-arm length while this gait is active (pulls the camera back when sprinting). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Gait|Camera", meta = (ClampMin = "-200.0", ClampMax = "400.0"))
	float CameraArmLengthBonus = 0.0f;
};

/**
 * All movement tuning for the on-foot player, in one data asset.
 *
 * Referenced by UGameProjectSettings::MovementSettings; when it is not assigned
 * the character falls back to the CDO defaults below, so the project still runs
 * with zero content. Swapping in a Blueprint child lets designers iterate on
 * feel without a compile, and future phases (vehicle handling, swimming) simply
 * add their own sibling data asset instead of growing this one.
 */
UCLASS(BlueprintType, meta = (DisplayName = "Open World Movement Settings"))
class PROJECTCORE_API UOpenWorldMovementSettings : public UDataAsset
{
	GENERATED_BODY()

public:
	UOpenWorldMovementSettings();

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Gaits")
	FOpenWorldGaitSettings Walk;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Gaits")
	FOpenWorldGaitSettings Run;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Gaits")
	FOpenWorldGaitSettings Sprint;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Gaits")
	FOpenWorldGaitSettings Crouch;

	// ------------------------------------------------------------- capsule
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Capsule", meta = (ClampMin = "10.0"))
	float CapsuleRadius = 34.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Capsule", meta = (ClampMin = "20.0"))
	float StandingHalfHeight = 90.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Capsule", meta = (ClampMin = "10.0"))
	float CrouchedHalfHeight = 52.0f;

	// ------------------------------------------------------------- jump
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Jump", meta = (ClampMin = "0.0"))
	float JumpZVelocity = 480.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Jump", meta = (ClampMin = "0", ClampMax = "5"))
	int32 MaxJumpCount = 1;

	/** Cutting upward velocity on release gives controllable jump arcs. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Jump", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float JumpReleaseVelocityScale = 0.45f;

	// ------------------------------------------------------------- general feel
	/** 0..1 steering authority while airborne. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Feel", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float AirControl = 0.30f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Feel", meta = (ClampMin = "0.0"))
	float MaxStepHeight = 65.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Feel", meta = (ClampMin = "0.0", ClampMax = "89.0"))
	float WalkableFloorAngle = 46.0f;

	/** Face the movement direction (true) or the controller direction (false). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Feel")
	bool bOrientRotationToMovement = true;

	/** Smooth rotation interpolation rate toward the target orientation. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Feel", meta = (ClampMin = "0.0"))
	float RotationInterpSpeed = 12.0f;

	/**
	 * Pushes the applied values onto a movement component. Called once on
	 * possession and whenever the gait changes, never per frame.
	 */
	void ApplyGait(UCharacterMovementComponent& Movement, const FOpenWorldGaitSettings& Gait) const;

	/** Applies capsule + jump + general settings once at startup. */
	void ApplyBase(UCharacterMovementComponent& Movement, UCapsuleComponent& Capsule) const;

	/**
	 * Resolves the configured asset, or the CDO when none is assigned.
	 *
	 * Callers must hold the result in a UPROPERTY: the returned object is only
	 * protected from garbage collection by whoever references it. Returning a raw
	 * pointer (instead of caching one in a static) is deliberate - it keeps the
	 * project free of unmanaged global object references.
	 */
	static const UOpenWorldMovementSettings* Resolve();
};
