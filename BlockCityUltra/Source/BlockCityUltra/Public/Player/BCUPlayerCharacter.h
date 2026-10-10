// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "BCUPlayerCharacter.generated.h"

class UBCUCameraSystem;
class USpringArmComponent;
class UCameraComponent;
class UBCUInteractionComponent;
class UBCUVoxelBodyComponent;
class UWidgetComponent;
class ABCUBaseVehicle;
class ABCUPlayerController;
class UBCUHealthComponent;

UENUM(BlueprintType)
enum class EBCULocomotionState : uint8
{
	Idle		UMETA(DisplayName = "Idle"),
	Walking		UMETA(DisplayName = "Walking"),
	Jogging		UMETA(DisplayName = "Jogging"),
	Sprinting	UMETA(DisplayName = "Sprinting"),
	Jumping		UMETA(DisplayName = "Jumping"),
	Falling		UMETA(DisplayName = "Falling"),
	Swimming	UMETA(DisplayName = "Swimming"),
	InVehicle	UMETA(DisplayName = "In Vehicle"),
	Entering	UMETA(DisplayName = "Entering Vehicle"),
	Exiting		UMETA(DisplayName = "Exiting Vehicle"),
	Downed		UMETA(DisplayName = "Downed")
};

/**
 * The player avatar. Third-person, voxel-built body, fully enterable vehicles.
 *
 * The body is *not* a skinned mesh with a pixel shader: it is assembled from
 * cubic voxel parts (UBCUVoxelBodyComponent) driven by an animation blueprint,
 * which is what keeps the silhouette recognisably blocky while the lighting,
 * materials and cloth response stay physically based.
 */
UCLASS(Blueprintable)
class BLOCKCITYULTRA_API ABCUPlayerCharacter : public ACharacter
{
	GENERATED_BODY()

public:
	ABCUPlayerCharacter();

	//~ AActor / APawn / ACharacter
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;
	virtual void PossessedBy(AController* NewController) override;
	virtual void Landed(const FHitResult& Hit) override;
	//~ End

	// ── Components ──────────────────────────────────────────────────────────
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Character|Components")
	TObjectPtr<USpringArmComponent> CameraBoom;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Character|Components")
	TObjectPtr<UCameraComponent> FollowCamera;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Character|Components")
	TObjectPtr<UBCUCameraSystem> CameraSystem;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Character|Components")
	TObjectPtr<UBCUInteractionComponent> Interaction;

	/** Builds the cubic voxel body parts and their PBR materials. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Character|Components")
	TObjectPtr<UBCUVoxelBodyComponent> VoxelBody;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Character|Components")
	TObjectPtr<UBCUHealthComponent> Health;

	/** Prompt widget shown above the head of the focused interactable. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Character|Components")
	TObjectPtr<UWidgetComponent> InteractionPrompt;

	// ── Movement API used by the player controller ──────────────────────────
	/** Adds movement from a normalised 2D axis (camera-relative). */
	UFUNCTION(BlueprintCallable, Category = "BCU|Character|Movement")
	void AddMovementInputFromAxis(const FVector2D& Axis);

	UFUNCTION(BlueprintCallable, Category = "BCU|Character|Movement")
	void SetWantsSprint(bool bWants);

	UFUNCTION(BlueprintCallable, Category = "BCU|Character|Movement")
	void StartJump();

	UFUNCTION(BlueprintCallable, Category = "BCU|Character|Movement")
	void StopJump();

	UFUNCTION(BlueprintPure, Category = "BCU|Character|Movement")
	EBCULocomotionState GetLocomotionState() const { return LocomotionState; }

	/** Ground speed in km/h — used by the HUD and the sprint-stamina logic. */
	UFUNCTION(BlueprintPure, Category = "BCU|Character|Movement")
	float GetSpeedKmh() const;

	// ── Vehicle coupling ────────────────────────────────────────────────────
	UFUNCTION(BlueprintCallable, Category = "BCU|Character|Vehicle")
	void SetVehicleBeingDriven(ABCUBaseVehicle* Vehicle);

	UFUNCTION(BlueprintPure, Category = "BCU|Character|Vehicle")
	ABCUBaseVehicle* GetVehicleBeingDriven() const { return VehicleBeingDriven; }

	UFUNCTION(BlueprintPure, Category = "BCU|Character|Vehicle")
	bool IsDriving() const { return VehicleBeingDriven != nullptr; }

	/** Called right after ExitVehicleIfDriving placed us on the pavement. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Character|Vehicle")
	void PostExitVehicle(ABCUBaseVehicle* Vehicle);

	// ── Health / respawn ────────────────────────────────────────────────────
	UFUNCTION(BlueprintCallable, Category = "BCU|Character|Health")
	void ApplyDamage(float Amount, const FVector& Impulse);

	UFUNCTION(BlueprintCallable, Category = "BCU|Character|Health")
	void Revive();

	UFUNCTION(BlueprintPure, Category = "BCU|Character|Health")
	float GetHealthFraction() const;

	UFUNCTION(BlueprintCallable, Category = "BCU|Character|Health")
	void Heal(float Amount);

	// ── Stamina (sprint / climbing) ─────────────────────────────────────────
	UFUNCTION(BlueprintPure, Category = "BCU|Character|Stamina")
	float GetStaminaFraction() const { return StaminaFraction; }

	// ── Customisation ───────────────────────────────────────────────────────
	/** Applies an outfit from the wardrobe (id from DT_CharacterCustomisation). */
	UFUNCTION(BlueprintCallable, Category = "BCU|Character|Customisation")
	void ApplyOutfit(FName OutfitId);

	UFUNCTION(BlueprintCallable, Category = "BCU|Character|Customisation")
	void SetBodyVoxelPalette(FLinearColor Skin, FLinearColor Shirt, FLinearColor Trousers, FLinearColor Shoes);

	/** Controller back-reference (avoids casts in hot paths). */
	void SetOwningBCUController(ABCUPlayerController* InController) { BCUPC = InController; }

	UFUNCTION(BlueprintPure, Category = "BCU|Character")
	ABCUPlayerController* GetBCUController() const { return BCUPC; }

	UFUNCTION(BlueprintPure, Category = "BCU|Character")
	UBCUCameraSystem* GetCameraSystem() const { return CameraSystem; }

	/** Bound to UBCUHealthComponent::OnHealthDepleted. */
	UFUNCTION()
	void OnHealthDepleted();

	/** Distance travelled on foot this session, in km (for stats). */
	UFUNCTION(BlueprintPure, Category = "BCU|Character|Stats")
	float GetDistanceTravelledKm() const { return DistanceTravelledKm; }

protected:
	virtual void SetupPlayerInputComponent(UInputComponent* PlayerInputComponent) override;
	virtual float TakeDamage(float DamageAmount, FDamageEvent const& DamageEvent,
		AController* EventInstigator, AActor* DamageCauser) override;
	virtual void PostInitializeComponents() override;

	/** Speeds per locomotion state (cm/s). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Character|Movement")
	float WalkSpeed = 180.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Character|Movement")
	float JogSpeed = 420.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Character|Movement")
	float SprintSpeed = 660.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Character|Movement")
	float CrouchSpeed = 110.0f;

	/** Acceleration/deceleration feel: snappy on foot, weighty in vehicles. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Character|Movement")
	float GroundAcceleration = 2400.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Character|Movement")
	float GroundDeceleration = 3200.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Character|Movement")
	float RotationRateDegreesPerSecond = 720.0f;

	/** Stamina drain while sprinting and regen rate (per second, 0..1). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Character|Stamina")
	float StaminaDrainPerSecond = 0.16f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Character|Stamina")
	float StaminaRegenPerSecond = 0.11f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Character|Stamina")
	float StaminaExhaustedThreshold = 0.05f;

	UPROPERTY(Transient)
	TObjectPtr<ABCUPlayerController> BCUPC;

	UPROPERTY(Transient)
	TObjectPtr<ABCUBaseVehicle> VehicleBeingDriven;

	EBCULocomotionState LocomotionState = EBCULocomotionState::Idle;
	float StaminaFraction = 1.0f;
	bool bWantsSprint = false;
	bool bExhausted = false;
	float DistanceTravelledKm = 0.0f;
	FVector LastPosition = FVector::ZeroVector;
	FVector2D CachedMoveAxis = FVector2D::ZeroVector;

	void UpdateLocomotionState(float DeltaSeconds);
	void UpdateStamina(float DeltaSeconds);
	void UpdateDistanceStats(float DeltaSeconds);
	void ApplySpeedForState();
};
