// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "WheeledVehiclePawn.h"
#include "Vehicle/BCUVehicleDefinition.h"
#include "BCUBaseVehicle.generated.h"

class UBoxComponent;
class USpotLightComponent;
class UPointLightComponent;
class UStaticMeshComponent;
class UBCUVehicleAudioComponent;
class UBCUVehicleDamageComponent;
class UBCUVehicleCustomisationComponent;
class UBCUTrafficComponent;
class UNiagaraComponent;
class ABCUPawn;
class APawn;

UENUM(BlueprintType)
enum class EBCUVehicleState : uint8
{
	Parked			UMETA(DisplayName = "Parked"),
	Idle			UMETA(DisplayName = "Idling"),
	Driving			UMETA(DisplayName = "Driving"),
	Braking			UMETA(DisplayName = "Braking"),
	Drifting		UMETA(DisplayName = "Drifting"),
	Airborne		UMETA(DisplayName = "Airborne"),
	Flipped			UMETA(DisplayName = "Flipped"),
	Wrecked			UMETA(DisplayName = "Wrecked"),
	Siren			UMETA(DisplayName = "Emergency Response")
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnBCUVehicleOccupantChanged, ABCUBaseVehicle*, Vehicle, bool, bAdded);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnBCUVehicleStateChanged, EBCUVehicleState, NewState, EBCUVehicleState, OldState);

/**
 * Every drivable thing in BLOCK CITY ULTRA: cars, supercars, motorcycles,
 * trucks, buses, police cruisers, fire engines, boats.
 *
 * Physics: Chaos WheeledVehicle. The body is a *generated voxel mesh* (see
 * UBCUVehicleVoxelBuilder) unless the definition supplies an override, so the
 * blocky silhouette comes from real cubic geometry rather than a shader.
 *
 * The same class serves the player and traffic AI; AI is layered on with
 * UBCUTrafficComponent so traffic cars cost one extra component, not a
 * separate blueprint hierarchy.
 */
UCLASS(Blueprintable)
class BLOCKCITYULTRA_API ABCUBaseVehicle : public AWheeledVehiclePawn
{
	GENERATED_BODY()

public:
	ABCUBaseVehicle();

	//~ AActor / APawn
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;
	virtual void PostInitializeComponents() override;
	virtual void Destroyed() override;
	virtual float TakeDamage(float DamageAmount, FDamageEvent const& DamageEvent,
		AController* EventInstigator, AActor* DamageCauser) override;
	//~ End

	// ── Definition ──────────────────────────────────────────────────────────
	/** Applies a definition: rebuilds the voxel body, wheels, lights, audio. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle")
	void ConfigureFromDefinition(UBCUVehicleDefinition* InDefinition);

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle")
	UBCUVehicleDefinition* GetDefinition() const { return Definition; }

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle")
	FName GetVehicleId() const { return Definition ? Definition->VehicleId : NAME_None; }

	// ── Components ──────────────────────────────────────────────────────────
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Components")
	TObjectPtr<UStaticMeshComponent> VoxelBody;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Components")
	TObjectPtr<UBCUVehicleAudioComponent> VehicleAudio;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Components")
	TObjectPtr<UBCUVehicleDamageComponent> Damage;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Components")
	TObjectPtr<UBCUVehicleCustomisationComponent> Customisation;

	/** Only present on AI traffic; created by UBCUTrafficSubsystem. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Components")
	TObjectPtr<UBCUTrafficComponent> Traffic;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Components")
	TObjectPtr<UNiagaraComponent> ExhaustFX;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Components")
	TObjectPtr<UNiagaraComponent> TyreSmokeFX;

	// ── Occupants / seats ───────────────────────────────────────────────────
	/** Seat index for a would-be entrant (driver seat preferred). */
	int32 ResolveSeatForEntrant(int32 RequestedSeat, APawn* Entrant) const;

	/** Attaches the occupant to a seat. Returns false when the seat is taken. */
	bool AddOccupant(APawn* Occupant, int32 SeatIndex);

	void RemoveOccupant(APawn* Occupant);

	/** Pawn attached to a seat, or nullptr. Seat 0 is normally the driver. */
	APawn* GetSeatPawn(int32 SeatIndex) const;

	/** The pawn that currently has control authority over the vehicle. */
	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|Occupants")
	APawn* GetDriverPawn() const;

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|Occupants")
	int32 GetOccupantCount() const;

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|Occupants")
	bool HasDriver() const { return GetDriverPawn() != nullptr; }

	/** Local transform a seated pawn is rendered at (voxel interior pose). */
	FTransform GetSeatLocalTransformFor(const APawn* Occupant) const;

	/** Can the player step out right now (speed, obstacle, upright)? */
	bool CanExitSafely(const APawn* Occupant) const;

	/** Pavement-side location used when exiting. */
	FVector ComputeExitLocation(const APawn* Occupant) const;

	/** Called when the player leaves (traffic AI may resume driving). */
	void OnPlayerExited();

	/** UI feedback when CanExitSafely() refused an exit. */
	void NotifyExitRefused();

	UPROPERTY(BlueprintAssignable, Category = "BCU|Vehicle|Occupants")
	FOnBCUVehicleOccupantChanged OnOccupantChanged;

	// ── Player input (set by ABCUPlayerController) ──────────────────────────
	void SetPlayerThrottle(float Value) { PlayerThrottle = FMath::Clamp(Value, -1.0f, 1.0f); }
	void SetPlayerBrake(float Value) { PlayerBrake = FMath::Clamp(Value, 0.0f, 1.0f); }
	void SetPlayerSteer(float Value) { PlayerSteer = FMath::Clamp(Value, -1.0f, 1.0f); }

	/** Smooths player input into the values Chaos consumes. */
	void ConsumePlayerInput(float DeltaSeconds);

	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|Input")
	void SetHandbrake(bool bEngaged);

	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|Input")
	void PlayHorn();

	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|Input")
	void SetHeadlights(bool bOn);

	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|Input")
	void SetSiren(bool bOn);

	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|Input")
	void ActivateBoost();

	// ── AI input (used by traffic + police) ─────────────────────────────────
	void SetAIThrottle(float Value) { AIThrottle = FMath::Clamp(Value, -1.0f, 1.0f); }
	void SetAIBrake(float Value) { AIBrake = FMath::Clamp(Value, 0.0f, 1.0f); }
	void SetAISteer(float Value) { AISteer = FMath::Clamp(Value, -1.0f, 1.0f); }
	void SetAIWantsHandbrake(bool bValue) { bAIHandbrake = bValue; }
	void SetAIWantsSiren(bool bValue) { bAISiren = bValue; }

	// ── Telemetry / state ───────────────────────────────────────────────────
	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|State")
	EBCUVehicleState GetVehicleState() const { return VehicleState; }

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|State")
	float GetSpeedKmh() const;

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|State")
	float GetSpeedMph() const { return GetSpeedKmh() * 0.621371f; }

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|State")
	int32 GetCurrentGear() const;

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|State")
	float GetEngineRPM() const;

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|State")
	float GetSlipAngle() const;

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|State")
	bool IsDrifting() const { return VehicleState == EBCUVehicleState::Drifting; }

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|State")
	bool IsFlipped() const;

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|State")
	bool IsWrecked() const { return VehicleState == EBCUVehicleState::Wrecked; }

	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|State")
	void SelfRight();

	/** Fuel in litres; the economy subsystem refuels at garages. */
	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|State")
	float GetFuelLitres() const { return FuelLitres; }

	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|State")
	void Refuel(float Litres);

	/** Odometer for the stats screen and resale valuation. */
	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|State")
	float GetOdometerKm() const { return OdometerKm; }

	UPROPERTY(BlueprintAssignable, Category = "BCU|Vehicle|State")
	FOnBCUVehicleStateChanged OnVehicleStateChanged;

	// ── Persistence ─────────────────────────────────────────────────────────
	/** Live customisation (paint, wheels, upgrades) — saved with the garage. */
	UPROPERTY(BlueprintReadWrite, SaveGame, Category = "BCU|Vehicle|Save")
	FLinearColor PaintColor = FLinearColor(0.72f, 0.09f, 0.11f);

	UPROPERTY(BlueprintReadWrite, SaveGame, Category = "BCU|Vehicle|Save")
	FName WheelStyle = TEXT("Stock");

	UPROPERTY(BlueprintReadWrite, SaveGame, Category = "BCU|Vehicle|Save")
	int32 EngineLevel = 0;

	UPROPERTY(BlueprintReadWrite, SaveGame, Category = "BCU|Vehicle|Save")
	int32 HandlingLevel = 0;

	UPROPERTY(BlueprintReadWrite, SaveGame, Category = "BCU|Vehicle|Save")
	int32 BrakeLevel = 0;

	UPROPERTY(BlueprintReadWrite, SaveGame, Category = "BCU|Vehicle|Save")
	float HealthRemaining = 1.0f;

	/** True when this vehicle belongs to the player (garage / owned property). */
	UPROPERTY(BlueprintReadWrite, SaveGame, Category = "BCU|Vehicle|Save")
	bool bPlayerOwned = false;

protected:
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle")
	TObjectPtr<UBCUVehicleDefinition> Definition;

	/** Headlights / taillights / lightbar (created from the definition). */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Components")
	TObjectPtr<USpotLightComponent> HeadlightLeft;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Components")
	TObjectPtr<USpotLightComponent> HeadlightRight;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Components")
	TObjectPtr<UPointLightComponent> TaillightGlow;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Components")
	TObjectPtr<UPointLightComponent> EmergencyLightA;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Components")
	TObjectPtr<UPointLightComponent> EmergencyLightB;

	/** Interaction volume so the player can press F near the door. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Components")
	TObjectPtr<UBoxComponent> EntryTrigger;

	UPROPERTY(Transient)
	TArray<TObjectPtr<APawn>> SeatOccupants;

	EBCUVehicleState VehicleState = EBCUVehicleState::Parked;
	float PlayerThrottle = 0.0f;
	float PlayerBrake = 0.0f;
	float PlayerSteer = 0.0f;
	float AIThrottle = 0.0f;
	float AIBrake = 0.0f;
	float AISteer = 0.0f;
	bool bAIHandbrake = false;
	bool bAISiren = false;

	float SmoothedThrottle = 0.0f;
	float SmoothedBrake = 0.0f;
	float SmoothedSteer = 0.0f;
	float FuelLitres = 62.0f;
	float OdometerKm = 0.0f;
	float BoostRemaining = 0.0f;
	bool bHeadlightsOn = false;
	bool bSirenOn = false;
	bool bBoostActive = false;
	float SlipAngleSmoothing = 0.0f;
	float DriftTimer = 0.0f;
	float FlippedTimer = 0.0f;

	/** Input smoothing rates (per second, exponential approach). */
	UPROPERTY(EditAnywhere, config, Category = "BCU|Vehicle|Input")
	float ThrottleSmoothing = 9.0f;

	UPROPERTY(EditAnywhere, config, Category = "BCU|Vehicle|Input")
	float BrakeSmoothing = 14.0f;

	UPROPERTY(EditAnywhere, config, Category = "BCU|Vehicle|Input")
	float SteerSmoothing = 12.0f;

	/** Below this speed an exit is always allowed. */
	UPROPERTY(EditAnywhere, config, Category = "BCU|Vehicle|Occupants", meta = (ClampMin = "0.0"))
	float SafeExitSpeedKmh = 6.0f;

	void UpdateVehicleState(float DeltaSeconds);
	void UpdateFuelAndOdometer(float DeltaSeconds);
	void UpdateLights(float DeltaSeconds);
	void UpdateBoost(float DeltaSeconds);
	void ApplyDefinitionToChaos();

	/** Headlights come on automatically at night / in heavy rain. */
	bool ShouldHeadlightsBeAutoOn() const;
	void BuildVoxelBody();
	void CreateSeatOccupantSlots();
	void SetState(EBCUVehicleState NewState);

private:
	FVector LastPhysicsPosition = FVector::ZeroVector;
};
