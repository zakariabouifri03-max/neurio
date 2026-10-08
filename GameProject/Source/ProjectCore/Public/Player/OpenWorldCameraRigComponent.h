// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "Components/SceneComponent.h"
#include "OpenWorldCameraRigComponent.generated.h"

class USpringArmComponent;
class UCameraComponent;

/**
 * One camera behaviour: a pose plus the smoothing rules that get there.
 *
 * The rig is driven entirely by these structs so that future phases do not have
 * to touch the player: a vehicle camera, an interior camera, an aim camera or a
 * cinematic camera is *one more entry in the Modes array* (authorable in a
 * Blueprint child) plus a SetMode/PushMode call from the owning system.
 */
USTRUCT(BlueprintType)
struct FOpenWorldCameraMode
{
	GENERATED_BODY()

	/** Stable identifier used by SetMode/PushMode. "Default" must always exist. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mode")
	FName ModeId = TEXT("Default");

	/** Spring arm length in cm. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mode|Arm", meta = (ClampMin = "0.0", ClampMax = "5000.0"))
	float ArmLength = 400.0f;

	/**
	 * Lateral/vertical offset of the arm socket. Over-the-shoulder third person
	 * views shift the camera to one side here, not by moving the arm target.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mode|Arm")
	FVector SocketOffset = FVector(0.0f, 55.0f, 45.0f);

	/** Offset applied to the camera itself, relative to the arm end. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mode|Arm")
	FVector CameraOffset = FVector::ZeroVector;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mode|Lens", meta = (ClampMin = "10.0", ClampMax = "170.0"))
	float FieldOfView = 90.0f;

	/** Arm collision keeps the camera out of walls. Turn off only for cinematics. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mode|Collision")
	bool bDoCollisionTest = true;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mode|Collision", meta = (ClampMin = "1.0", ClampMax = "100.0"))
	float CollisionProbeSize = 12.0f;

	/** Position lag smooths fast movement; leave off for snappy on-foot play. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mode|Smoothing")
	bool bEnableCameraLag = false;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mode|Smoothing", meta = (ClampMin = "0.0", ClampMax = "60.0"))
	float CameraLagSpeed = 12.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mode|Smoothing")
	bool bEnableCameraRotationLag = false;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mode|Smoothing", meta = (ClampMin = "0.0", ClampMax = "60.0"))
	float CameraRotationLagSpeed = 10.0f;

	/** False = locked/fixed camera (cinematics, interiors with a authored view). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mode|Control")
	bool bUsePawnControlRotation = true;

	/** Cross-fade duration when switching into this mode. 0 = instant cut. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mode|Blend", meta = (ClampMin = "0.0", ClampMax = "5.0"))
	float BlendTime = 0.25f;
};

/**
 * Owns the spring arm + camera pair and every rule about how they move.
 *
 * Kept as a component (not folded into the character) so the same rig can be
 * reused by vehicles, drones and cinematics later, and so the character class
 * stays about *character* responsibilities.
 *
 * Ticks only while a blend or a gait offset is animating - an idle camera costs
 * nothing, which matters when every streamed pawn has one.
 */
UCLASS(ClassGroup = (GameProject), meta = (BlueprintSpawnableComponent, DisplayName = "Open World Camera Rig"))
class PROJECTCORE_API UOpenWorldCameraRigComponent : public USceneComponent
{
	GENERATED_BODY()

public:
	UOpenWorldCameraRigComponent();

	//~ Begin UActorComponent
	virtual void BeginPlay() override;
	virtual void TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction) override;
	//~ End UActorComponent

	/** Index 0 is always the on-foot default; add more in a Blueprint child. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Camera|Modes")
	TArray<FOpenWorldCameraMode> Modes;

	/** Pitch limits, in degrees. Applied by the player controller when looking. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Camera|Control", meta = (ClampMin = "-89.0", ClampMax = "0.0"))
	float MinPitch = -70.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Camera|Control", meta = (ClampMin = "0.0", ClampMax = "89.0"))
	float MaxPitch = 60.0f;

	/** Interpolation speed used for gait-driven FOV/arm changes. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Camera|Control", meta = (ClampMin = "0.0"))
	float GaitBlendSpeed = 8.0f;

	// ------------------------------------------------------------- mode API
	UFUNCTION(BlueprintCallable, Category = "GameProject|Camera")
	bool SetMode(FName ModeId);

	/** Pushes a mode onto the stack; PopMode returns to whatever was underneath. */
	UFUNCTION(BlueprintCallable, Category = "GameProject|Camera")
	bool PushMode(FName ModeId);

	UFUNCTION(BlueprintCallable, Category = "GameProject|Camera")
	void PopMode();

	UFUNCTION(BlueprintPure, Category = "GameProject|Camera")
	FName GetActiveModeId() const;

	UFUNCTION(BlueprintPure, Category = "GameProject|Camera")
	const FOpenWorldCameraMode& GetActiveMode() const;

	/** Additive offsets from the current gait (sprint FOV kick, arm pull-back). */
	UFUNCTION(BlueprintCallable, Category = "GameProject|Camera")
	void SetGaitCameraBonus(float FieldOfViewBonus, float ArmLengthBonus);

	// ------------------------------------------------------------- queries
	UFUNCTION(BlueprintPure, Category = "GameProject|Camera")
	FVector GetCameraWorldLocation() const;

	UFUNCTION(BlueprintPure, Category = "GameProject|Camera")
	FVector GetCameraForwardVector() const;

	/** Clamps a pitch value into this rig's limits. */
	UFUNCTION(BlueprintPure, Category = "GameProject|Camera")
	float ClampPitch(float Pitch) const { return FMath::Clamp(Pitch, MinPitch, MaxPitch); }

	UPROPERTY(BlueprintReadOnly, Category = "GameProject|Camera")
	TObjectPtr<USpringArmComponent> SpringArm;

	UPROPERTY(BlueprintReadOnly, Category = "GameProject|Camera")
	TObjectPtr<UCameraComponent> Camera;

protected:
	/** Applies a mode's pose immediately, without blending. */
	void ApplyModeInstant(const FOpenWorldCameraMode& Mode);

	/** Starts a timed blend from the current pose to the target mode. */
	void BeginBlendTo(const FOpenWorldCameraMode& Mode);

	void UpdateBlend(float DeltaTime);

	int32 FindModeIndex(FName ModeId) const;
	void RefreshTickState();

	/** The authored pose currently applied, without gait bonuses. */
	FOpenWorldCameraMode CurrentPose;

	/** Snapshot of the pose we are blending away from. */
	FOpenWorldCameraMode BlendFrom;

	/** Pose we are blending toward (already includes the mode's authored values). */
	FOpenWorldCameraMode BlendTarget;

	float BlendTimeRemaining = 0.0f;
	float BlendDuration = 0.0f;
	bool bIsBlending = false;

	TArray<FName> ModeStack;
	int32 ActiveModeIndex = 0;

	float CurrentGaitFOVBonus = 0.0f;
	float CurrentGaitArmBonus = 0.0f;
	float TargetGaitFOVBonus = 0.0f;
	float TargetGaitArmBonus = 0.0f;

	/** Applied arm length/FOV, kept so the debug HUD can read them cheaply. */
	float AppliedArmLength = 400.0f;
	float AppliedFieldOfView = 90.0f;
};
