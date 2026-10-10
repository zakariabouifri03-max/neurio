// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "Core/BCUPlayerController.h"
#include "BCUCameraSystem.generated.h"

class USpringArmComponent;
class UCameraComponent;
class ABCUBaseVehicle;
class UCameraShakeBase;

UENUM(BlueprintType)
enum class EBCUCameraMode : uint8
{
	ThirdPerson		UMETA(DisplayName = "Third Person"),
	CloseThird		UMETA(DisplayName = "Close Third Person"),
	FirstPerson		UMETA(DisplayName = "First Person"),
	Hood			UMETA(DisplayName = "Hood Cam"),
	Chase			UMETA(DisplayName = "Chase Cam"),
	Cinematic		UMETA(DisplayName = "Cinematic"),
	TopDown			UMETA(DisplayName = "Top Down")
};

/**
 * Camera behaviour for both on-foot and driving.
 *
 * One component, two parameter sets. On foot it is a lag-compensated spring arm
 * with shoulder offset and collision probe; driving it becomes a speed-reactive
 * chase cam whose FOV, distance and lag all scale with velocity so 300 km/h
 * *feels* like 300 km/h without the player losing the road.
 */
UCLASS(ClassGroup = (BCU), meta = (BlueprintSpawnableComponent))
class BLOCKCITYULTRA_API UBCUCameraSystem : public UActorComponent
{
	GENERATED_BODY()

public:
	UBCUCameraSystem();

	virtual void BeginPlay() override;
	virtual void TickComponent(float DeltaTime, ELevelTick TickType,
		FActorComponentTickFunction* ThisTickFunction) override;

	void SetFollowCamera(UCameraComponent* InCamera) { FollowCamera = InCamera; }
	void SetBoom(USpringArmComponent* InBoom) { Boom = InBoom; }

	/** Called by the controller each frame with raw look delta. */
	void AddLookInput(const FVector2D& LookDelta);

	/** Per-frame camera solve (called from the pawn tick). */
	void TickCamera(float DeltaSeconds);

	UFUNCTION(BlueprintCallable, Category = "BCU|Camera")
	void SetViewTarget(AActor* NewTarget);

	UFUNCTION(BlueprintCallable, Category = "BCU|Camera")
	void SetCameraModeFor(EBCUControlContext Context);

	UFUNCTION(BlueprintCallable, Category = "BCU|Camera")
	void CycleCameraMode();

	UFUNCTION(BlueprintCallable, Category = "BCU|Camera")
	void SetCameraMode(EBCUCameraMode Mode);

	UFUNCTION(BlueprintPure, Category = "BCU|Camera")
	EBCUCameraMode GetCameraMode() const { return CurrentMode; }

	UFUNCTION(BlueprintCallable, Category = "BCU|Camera")
	void SetLookBack(bool bActive);

	/** Impact shake (collision, landing, explosion). */
	UFUNCTION(BlueprintCallable, Category = "BCU|Camera")
	void NotifyLanding();

	UFUNCTION(BlueprintCallable, Category = "BCU|Camera")
	void NotifyVehicleExit();

	UFUNCTION(BlueprintCallable, Category = "BCU|Camera")
	void NotifyImpact(float Severity);

	// ── On foot tuning ──────────────────────────────────────────────────────
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Camera|OnFoot")
	float FootBoomLength = 420.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Camera|OnFoot")
	FVector FootSocketOffset = FVector(0.0f, 48.0f, 62.0f);

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Camera|OnFoot")
	float FootCameraLagSpeed = 11.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Camera|OnFoot", meta = (ClampMin = "60.0", ClampMax = "110.0"))
	float FootFOV = 90.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Camera|OnFoot", meta = (ClampMin = "-89.0", ClampMax = "89.0"))
	float PitchLimitDegrees = 78.0f;

	// ── Driving tuning ──────────────────────────────────────────────────────
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Camera|Driving", meta = (ClampMin = "100.0"))
	float ChaseBoomLengthMin = 520.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Camera|Driving")
	float ChaseBoomLengthMax = 820.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Camera|Driving", meta = (ClampMin = "60.0", ClampMax = "120.0"))
	float ChaseFOVMin = 82.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Camera|Driving", meta = (ClampMin = "60.0", ClampMax = "125.0"))
	float ChaseFOVMax = 104.0f;

	/** Speed (km/h) at which the camera reaches its maximum distance/FOV. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Camera|Driving", meta = (ClampMin = "50.0"))
	float SpeedReferenceKmh = 220.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Camera|Driving")
	float ChaseCameraLagSpeed = 6.5f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Camera|Driving")
	float ChaseHeightOffset = 118.0f;

	/** How much the camera leans into a corner (degrees per lateral g). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Camera|Driving")
	float CornerLeanDegrees = 3.2f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Camera")
	TSubclassOf<UCameraShakeBase> ImpactShakeClass;

protected:
	UPROPERTY(Transient)
	TObjectPtr<UCameraComponent> FollowCamera;

	UPROPERTY(Transient)
	TObjectPtr<USpringArmComponent> Boom;

	UPROPERTY(Transient)
	TObjectPtr<AActor> ViewTarget;

	EBCUCameraMode CurrentMode = EBCUCameraMode::ThirdPerson;
	EBCUControlContext ActiveContext = EBCUControlContext::OnFoot;
	bool bLookBack = false;
	float CurrentFOV = 90.0f;
	float CurrentBoomLength = 420.0f;
	float ShakeRemaining = 0.0f;
	FVector2D PendingLook = FVector2D::ZeroVector;

	void SolveOnFoot(float DeltaSeconds);
	void SolveDriving(float DeltaSeconds);
	float GetVehicleSpeedFraction() const;
};
