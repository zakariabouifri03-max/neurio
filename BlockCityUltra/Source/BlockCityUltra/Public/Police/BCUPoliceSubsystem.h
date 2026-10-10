// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "World/Voxel/BCUVoxelTypes.h"
#include "Police/BCUWantedComponent.h"
#include "BCUPoliceSubsystem.generated.h"

class ABCUBaseVehicle;
class ABCUPoliceUnit;
class ABCUPlayerCharacter;
class UBCUVehicleDefinition;
struct FBCURoadSegment;

UENUM(BlueprintType)
enum class EBCUCrimeType : uint8
{
	None					UMETA(DisplayName = "None"),
	TrafficViolation		UMETA(DisplayName = "Traffic Violation"),
	RecklessDriving			UMETA(DisplayName = "Reckless Driving"),
	VehicleTheft			UMETA(DisplayName = "Vehicle Theft"),
	Assault					UMETA(DisplayName = "Assault"),
	AssaultOnOfficer		UMETA(DisplayName = "Assault on Officer"),
	PropertyDamage			UMETA(DisplayName = "Property Damage"),
	PedestrianInjury		UMETA(DisplayName = "Pedestrian Injury"),
	WeaponDischarge			UMETA(DisplayName = "Weapon Discharge"),
	Explosion				UMETA(DisplayName = "Explosion"),
	EvadingArrest			UMETA(DisplayName = "Evading Arrest"),
	Murder					UMETA(DisplayName = "Murder"),
	Heist					UMETA(DisplayName = "Heist in Progress"),
	HeliDown				UMETA(DisplayName = "Aircraft Down")
};

UENUM(BlueprintType)
enum class EBCUPursuitPhase : uint8
{
	None			UMETA(DisplayName = "No Pursuit"),
	Investigating	UMETA(DisplayName = "Investigating"),
	Responding		UMETA(DisplayName = "Units Responding"),
	ActivePursuit	UMETA(DisplayName = "Active Pursuit"),
	LostSuspect		UMETA(DisplayName = "Searching"),
	Arrested		UMETA(DisplayName = "Arrested"),
	Escaped			UMETA(DisplayName = "Escaped")
};

/** One reported crime: where, when, how serious. */
USTRUCT(BlueprintType)
struct FBCUCrimeEvent
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "BCU|Police")
	EBCUCrimeType Type = EBCUCrimeType::None;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|Police")
	FVector Location = FVector::ZeroVector;

	/** World time (seconds) the crime was committed. */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|Police")
	double Timestamp = 0.0;

	/** Heat added to the wanted level. */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|Police")
	float Heat = 0.0f;

	/** The cell the crime happened in — police search it first. */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|Police")
	FBCUCellCoord Cell;

	/** True once a unit has physically arrived and looked at the location. */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|Police")
	bool bInvestigated = false;

	/** True once the evidence has expired (no unit will come). */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|Police")
	bool bExpired = false;
};

/** A dispatched unit: what it is, where it is going, what it is doing. */
USTRUCT(BlueprintType)
struct FBCUDispatchOrder
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "BCU|Police")
	TObjectPtr<ABCUPoliceUnit> Unit = nullptr;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|Police")
	EBCUPursuitPhase Phase = EBCUPursuitPhase::None;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|Police")
	FVector TargetLocation = FVector::ZeroVector;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|Police")
	float SearchRadiusCm = 25600.0f;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|Police")
	double OrderTime = 0.0;

	/** True when the unit has line of sight on the suspect. */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|Police")
	bool bHasVisual = false;

	/** Seconds since the unit last had visual (drives "lost suspect"). */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|Police")
	float TimeSinceVisual = 0.0f;
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnBCUWantedLevelChanged, int32, NewLevel, int32, OldLevel);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnBCUPursuitPhaseChanged, EBCUPursuitPhase, NewPhase);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnBCUPlayerArrested, int32, WantedLevelAtArrest);

/**
 * The progressive wanted system, police dispatch, patrol and pursuit AI.
 *
 * Design contract:
 *  - Heat accumulates per crime and decays over time; wanted level is the
 *    bucketed heat, so a long low-level spree still escalates.
 *  - Each wanted level has a *dispatch profile*: how many units, what kind
 *    (cruiser / interceptor / van / helicopter), how fast they respond, and
 *    whether they try to arrest or to box the player in.
 *  - Units search the last-known-position grid, not the player's real position,
 *    once visual is lost — so hiding actually works.
 *  - Everything is distance-LOD'd: far units simulate at 1 Hz with no AI.
 *
 * All police behaviour, unit names and dialogue are original.
 */
UCLASS(config = Game, Blueprintable)
class BLOCKCITYULTRA_API UBCUPoliceSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override;

	// ── Crime reporting (called by every gameplay system) ───────────────────
	/** Reports a crime at a location. The core entry point. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Police|Crime")
	void ReportCrime(EBCUCrimeType Type, const FVector& Location, float HeatOverride = -1.0f);

	/** Reports a crime committed by the player specifically (raises wanted). */
	UFUNCTION(BlueprintCallable, Category = "BCU|Police|Crime")
	void ReportPlayerCrime(EBCUCrimeType Type, const FVector& Location, bool bWasWitnessed = true);

	UFUNCTION(BlueprintPure, Category = "BCU|Police|Crime")
	const TArray<FBCUCrimeEvent>& GetActiveCrimes() const { return ActiveCrimes; }

	/** Heat contributed by a crime type (data-driven, editable). */
	UFUNCTION(BlueprintPure, Category = "BCU|Police|Crime")
	float GetHeatForCrime(EBCUCrimeType Type) const;

	// ── Wanted level ────────────────────────────────────────────────────────
	UFUNCTION(BlueprintPure, Category = "BCU|Police|Wanted")
	int32 GetWantedLevel() const { return WantedLevel; }

	UFUNCTION(BlueprintPure, Category = "BCU|Police|Wanted")
	float GetHeat() const { return Heat; }

	UFUNCTION(BlueprintCallable, Category = "BCU|Police|Wanted")
	void SetWantedLevel(int32 NewLevel);

	UFUNCTION(BlueprintCallable, Category = "BCU|Police|Wanted")
	void AddHeat(float Amount);

	/** Clears everything (arrest, bribe, mission, or a pay-and-spray). */
	UFUNCTION(BlueprintCallable, Category = "BCU|Police|Wanted")
	void ClearWantedLevel(bool bArrested);

	/** How long until the wanted level drops one star at the current rate. */
	UFUNCTION(BlueprintPure, Category = "BCU|Police|Wanted")
	float GetSecondsUntilNextDecay() const;

	/** True while police have line of sight and the player is "spotted". */
	UFUNCTION(BlueprintPure, Category = "BCU|Police|Wanted")
	bool IsPlayerSpotted() const { return bPlayerSpotted; }

	/** Entering a garage/safehouse with the wanted level hides the player. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Police|Wanted")
	void PlayerEnteredHideout();

	UFUNCTION(BlueprintCallable, Category = "BCU|Police|Wanted")
	void PlayerLeftHideout();

	UPROPERTY(BlueprintAssignable, Category = "BCU|Police")
	FOnBCUWantedLevelChanged OnWantedLevelChanged;

	UPROPERTY(BlueprintAssignable, Category = "BCU|Police")
	FOnBCUPursuitPhaseChanged OnPursuitPhaseChanged;

	UPROPERTY(BlueprintAssignable, Category = "BCU|Police")
	FOnBCUPlayerArrested OnPlayerArrested;

	// ── Pursuit state ───────────────────────────────────────────────────────
	UFUNCTION(BlueprintPure, Category = "BCU|Police|Pursuit")
	EBCUPursuitPhase GetPursuitPhase() const { return PursuitPhase; }

	UFUNCTION(BlueprintPure, Category = "BCU|Police|Pursuit")
	int32 GetActiveUnitCount() const;

	/** Closest pursuing unit's distance in metres — used by the HUD radar. */
	UFUNCTION(BlueprintPure, Category = "BCU|Police|Pursuit")
	float GetClosestPursuerDistanceM() const;

	/** Direction (in player-local space) to the closest pursuer, for the minimap. */
	UFUNCTION(BlueprintPure, Category = "BCU|Police|Pursuit")
	TArray<FVector> GetPursuerWorldLocations() const;

	// ── Patrol / spawn registration (from the city streamer) ────────────────
	void RegisterPatrolPoints(const FBCUCellCoord& Coord, const TArray<FVector>& Points);
	void UnregisterPatrolPoints(const FBCUCellCoord& Coord);

	// ── Tuning ──────────────────────────────────────────────────────────────
	UPROPERTY(EditAnywhere, config, Category = "BCU|Police")
	bool bDispatchEnabled = true;

	UPROPERTY(EditAnywhere, config, Category = "BCU|Police", meta = (ClampMin = "1", ClampMax = "24"))
	int32 MaxActivePursuitUnits = 8;

	UPROPERTY(EditAnywhere, config, Category = "BCU|Police", meta = (ClampMin = "0.0"))
	float ResponseDelayPerHeatSeconds = 6.0f;

	UPROPERTY(EditAnywhere, config, Category = "BCU|Police")
	float SearchGridHalfExtentCm = 25600.0f;

	UPROPERTY(EditAnywhere, config, Category = "BCU|Police", meta = (ClampMin = "1.0"))
	float EvidenceMemorySeconds = 45.0f;

	UPROPERTY(EditAnywhere, config, Category = "BCU|Police", meta = (ClampMin = "0.0"))
	float HeatDecayPerSecondUnseen = 0.35f;

	UPROPERTY(EditAnywhere, config, Category = "BCU|Police", meta = (ClampMin = "0.0"))
	float HeatDecayPerSecondSeen = 0.0f;

	/** Distance at which a police unit starts simulating AI at full rate. */
	UPROPERTY(EditAnywhere, config, Category = "BCU|Police")
	float FullSimulationDistanceCm = 150000.0f;

	/** Vehicle definitions used per wanted level. */
	UPROPERTY(EditAnywhere, config, Category = "BCU|Police|Dispatch")
	TArray<TSoftObjectPtr<UBCUVehicleDefinition>> CruiserPool;

	UPROPERTY(EditAnywhere, config, Category = "BCU|Police|Dispatch")
	TArray<TSoftObjectPtr<UBCUVehicleDefinition>> InterceptorPool;

	UPROPERTY(EditAnywhere, config, Category = "BCU|Police|Dispatch")
	TArray<TSoftObjectPtr<UBCUVehicleDefinition>> VanPool;

	/** Aggression multiplier pushed in by the game mode (difficulty). */
	void SetAggressionMultiplier(float Value) { AggressionMultiplier = Value; }
	float GetAggressionMultiplier() const { return AggressionMultiplier; }

	/** Debug/profiling one-liner for `bcu.police.stat`. */
	UFUNCTION(BlueprintPure, Category = "BCU|Police|Debug")
	FString GetPoliceStats() const;

protected:
	int32 WantedLevel = 0;
	float Heat = 0.0f;
	float AggressionMultiplier = 1.0f;
	bool bPlayerSpotted = false;
	bool bPlayerHidden = false;
	EBCUPursuitPhase PursuitPhase = EBCUPursuitPhase::None;
	FVector LastKnownPlayerLocation = FVector::ZeroVector;
	FVector2D PlayerVelocity2D = FVector2D::ZeroVector;
	double LastSeenTime = 0.0;
	float DispatchTimer = 0.0f;

	TArray<FBCUCrimeEvent> ActiveCrimes;
	TArray<FBCUDispatchOrder> Orders;
	TArray<TObjectPtr<ABCUPoliceUnit>> ActiveUnits;

	/** Patrol points per city cell, registered by the streamer. */
	TMap<FBCUCellCoord, TArray<FVector>> PatrolPoints;

	UPROPERTY(Transient)
	TObjectPtr<UBCUWantedComponent> PlayerWanted;

	void UpdatePlayerTracking(float DeltaTime);
	void UpdateHeatAndWanted(float DeltaTime);
	void UpdateCrimes(float DeltaTime);
	void UpdateDispatch(float DeltaTime);
	void UpdateUnits(float DeltaTime);
	void UpdatePursuitPhase();
	void SpawnPatrolUnit(const FVector& SpawnLocation, int32 ForWantedLevel);
	void DespawnDistantUnits();
	ABCUPoliceUnit* FindFreeUnit() const;
	FVector ChooseSpawnLocationForResponse(int32 WantedLevelNow) const;
	UBCUVehicleDefinition* ChooseVehicleForLevel(int32 Level) const;
	int32 WantedLevelForHeat(float InHeat) const;
	float HeatForWantedLevel(int32 Level) const;
	void SetPursuitPhase(EBCUPursuitPhase NewPhase);
	void AttemptArrest();
};
