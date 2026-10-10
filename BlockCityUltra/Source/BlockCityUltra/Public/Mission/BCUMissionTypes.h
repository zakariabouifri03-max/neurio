// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "World/Voxel/BCUVoxelTypes.h"
#include "BCUMissionTypes.generated.h"

class UBCUMission;
class ABCUBaseVehicle;

UENUM(BlueprintType)
enum class EBCUMissionType : uint8
{
	Story			UMETA(DisplayName = "Story Mission"),
	Race			UMETA(DisplayName = "Street Race"),
	Delivery		UMETA(DisplayName = "Delivery"),
	Heist			UMETA(DisplayName = "Heist"),
	Taxi			UMETA(DisplayName = "Taxi Job"),
	Vigilante		UMETA(DisplayName = "Vigilante"),
	Paramedic		UMETA(DisplayName = "Paramedic"),
	Firefighter		UMETA(DisplayName = "Firefighter"),
	Stunt			UMETA(DisplayName = "Stunt Jump"),
	Collection		UMETA(DisplayName = "Collection"),
	RandomEvent		UMETA(DisplayName = "Random Event"),
	PropertyJob		UMETA(DisplayName = "Property Job")
};

UENUM(BlueprintType)
enum class EBCUMissionState : uint8
{
	NotStarted		UMETA(DisplayName = "Not Started"),
	Available		UMETA(DisplayName = "Available"),
	Active			UMETA(DisplayName = "Active"),
	ObjectiveUpdate	UMETA(DisplayName = "Objective Update"),
	Success			UMETA(DisplayName = "Success"),
	Failed			UMETA(DisplayName = "Failed"),
	Abandoned		UMETA(DisplayName = "Abandoned")
};

UENUM(BlueprintType)
enum class EBCUObjectiveType : uint8
{
	GoToLocation		UMETA(DisplayName = "Go To Location"),
	DriveRoute			UMETA(DisplayName = "Drive Route (checkpoints)"),
	DeliverItem			UMETA(DisplayName = "Deliver Item"),
	CollectItems		UMETA(DisplayName = "Collect Items"),
	EliminateTarget		UMETA(DisplayName = "Eliminate Target"),
	EvadePolice			UMETA(DisplayName = "Evade Police"),
	SurviveTimed		UMETA(DisplayName = "Survive For Time"),
	ProtectTarget		UMETA(DisplayName = "Protect Target"),
	StealVehicle		UMETA(DisplayName = "Steal Vehicle"),
	ReachSpeed			UMETA(DisplayName = "Reach Speed"),
	PerformStunt		UMETA(DisplayName = "Perform Stunt"),
	TalkToNPC			UMETA(DisplayName = "Talk To NPC"),
	WaitForPlayer		UMETA(DisplayName = "Wait For Input"),
	Custom				UMETA(DisplayName = "Custom (Blueprint)")
};

UENUM(BlueprintType)
enum class EBCUDifficultyTier : uint8
{
	Easy		UMETA(DisplayName = "Easy"),
	Normal		UMETA(DisplayName = "Normal"),
	Hard		UMETA(DisplayName = "Hard"),
	Extreme		UMETA(DisplayName = "Extreme")
};

/** One checkpoint of a route objective. */
USTRUCT(BlueprintType)
struct FBCUCheckpoint
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Mission")
	FVector Location = FVector::ZeroVector;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Mission", meta = (ClampMin = "50.0"))
	float RadiusCm = 600.0f;

	/** Must be hit within this many seconds of the previous one (0 = no limit). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Mission")
	float TimeLimitSeconds = 0.0f;

	/** Skip this checkpoint if the player is on foot and it is a driving route. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Mission")
	bool bRequiresVehicle = false;
};

/** One step of a mission. Ordered; all must complete for the mission to succeed. */
USTRUCT(BlueprintType)
struct FBCUObjective
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Mission|Objective")
	EBCUObjectiveType Type = EBCUObjectiveType::GoToLocation;

	/** HUD text, e.g. "Drive to the pier before the container ships." */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Mission|Objective")
	FText Description;

	/** Short marker label for the minimap. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Mission|Objective")
	FText MarkerLabel;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Mission|Objective")
	TArray<FBCUCheckpoint> Checkpoints;

	/** Items to collect (CollectItems). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Mission|Objective")
	int32 RequiredCount = 1;

	/** Seconds allowed for the whole objective (0 = unlimited). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Mission|Objective")
	float TimeLimitSeconds = 0.0f;

	/** Wanted level to reach / stay below (EvadePolice). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Mission|Objective")
	int32 WantedLevelRequirement = 0;

	/** Speed in km/h (ReachSpeed). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Mission|Objective")
	float SpeedRequirementKmh = 0.0f;

	/** Vehicle that must be stolen/driven (StealVehicle). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Mission|Objective")
	FName RequiredVehicleId = NAME_None;

	/** NPC to talk to (TalkToNPC). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Mission|Objective")
	FName RequiredNPCId = NAME_None;

	/** Failing this objective fails the mission (vs. just skipping it). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Mission|Objective")
	bool bIsMandatory = true;

	/** Marker colour on the map/minimap. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Mission|Objective")
	FLinearColor MarkerColor = FLinearColor(1.0f, 0.85f, 0.2f);

	/** Runtime progress — not editable. */
	UPROPERTY(BlueprintReadOnly, Transient, Category = "BCU|Mission|Objective")
	int32 Progress = 0;

	UPROPERTY(BlueprintReadOnly, Transient, Category = "BCU|Mission|Objective")
	int32 CurrentCheckpoint = 0;

	UPROPERTY(BlueprintReadOnly, Transient, Category = "BCU|Mission|Objective")
	bool bComplete = false;
};

/** A line of dialogue spoken by an NPC during a mission. */
USTRUCT(BlueprintType)
struct FBCUDialogueLine
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Mission|Dialogue")
	FName SpeakerId = NAME_None;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Mission|Dialogue")
	FText Text;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Mission|Dialogue")
	TSoftObjectPtr<class USoundBase> VoiceOver;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Mission|Dialogue")
	float DurationSeconds = 3.0f;

	/** Play this line only if the player is in this state (e.g. wanted). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Mission|Dialogue")
	bool bOnlyWhenWanted = false;
};

/** Reward bundle. */
USTRUCT(BlueprintType)
struct FBCUMissionReward
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Mission|Reward")
	int32 Cash = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Mission|Reward")
	int32 Reputation = 0;

	/** Vehicle unlocked into the player's garage. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Mission|Reward")
	FName VehicleUnlockId = NAME_None;

	/** Property unlocked (safehouse, garage, business). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Mission|Reward")
	FName PropertyUnlockId = NAME_None;

	/** Outfit / cosmetic unlock. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Mission|Reward")
	TArray<FName> CosmeticUnlocks;
};

/** Static, editable mission content. Instances live in /Game/Data/Missions. */
UCLASS(BlueprintType, meta = (DisplayName = "BCU Mission Definition"))
class BLOCKCITYULTRA_API UBCUMissionDefinition : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Identity")
	FName MissionId = NAME_None;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Identity")
	FText Title;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Identity")
	FText Briefing;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Identity")
	EBCUMissionType Type = EBCUMissionType::Story;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Identity")
	EBCUDifficultyTier Difficulty = EBCUDifficultyTier::Normal;

	/** Story chapter this mission belongs to (drives ordering + unlocks). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Identity")
	int32 Chapter = 1;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Identity")
	int32 OrderInChapter = 1;

	/** Giver NPC + the district the mission takes place in. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Identity")
	FName GiverNPCId = NAME_None;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Identity")
	FName DistrictId = NAME_None;

	// ── Prerequisites ───────────────────────────────────────────────────────
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Requirements")
	TArray<FName> RequiredCompletedMissions;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Requirements")
	int32 MinReputation = 0;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Requirements")
	int32 MinCompletedMissions = 0;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Requirements")
	bool bRequiresVehicle = false;

	/** Time-of-day window the mission may start in (hours, wraps midnight). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Requirements")
	float EarliestStartHour = 0.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Requirements")
	float LatestStartHour = 24.0f;

	/** Required weather (e.g. a heist that only runs in a storm). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Requirements")
	bool bRequiresRain = false;

	// ── Content ─────────────────────────────────────────────────────────────
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Content")
	TArray<FBCUObjective> Objectives;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Content")
	TArray<FBCUDialogueLine> IntroDialogue;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Content")
	TArray<FBCUDialogueLine> MidDialogue;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Content")
	TArray<FBCUDialogueLine> SuccessDialogue;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Content")
	TArray<FBCUDialogueLine> FailureDialogue;

	// ── Rewards ─────────────────────────────────────────────────────────────
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Reward")
	FBCUMissionReward Reward;

	/** Bonus for finishing under the par time. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Reward")
	int32 TimeBonusCash = 0;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Reward")
	float ParTimeSeconds = 0.0f;

	/** Bonus for finishing with no damage taken. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Reward")
	int32 NoDamageBonusCash = 0;

	// ── World effects while active ──────────────────────────────────────────
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|World")
	bool bSpawnsPoliceResponse = false;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|World")
	int32 ForcedWantedLevel = 0;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|World")
	bool bFreezesTimeOfDay = false;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|World")
	bool bSuppressesTraffic = false;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|World")
	bool bSuppressesRandomEvents = true;

	/** Cells pre-loaded when the mission starts (no mid-chase streaming). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|World")
	TArray<FBCUCellCoord> PreloadCells;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|World")
	TArray<TSoftObjectPtr<ABCUBaseVehicle>> SpawnedVehicles;

	// ── Runtime class (Blueprint subclass with custom logic) ────────────────
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Runtime")
	TSoftClassPtr<UBCUMission> MissionClass;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Runtime")
	TSoftObjectPtr<class ULevelSequence> IntroCinematic;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Runtime")
	TSoftObjectPtr<class ULevelSequence> OutroCinematic;

	//~ UPrimaryDataAsset
	virtual FPrimaryAssetId GetPrimaryAssetId() const override
	{
		return FPrimaryAssetId(TEXT("BCUMission"), MissionId);
	}
	//~ End

	/** Total objective count — used by the HUD progress bar. */
	UFUNCTION(BlueprintPure, Category = "BCU|Mission")
	int32 GetObjectiveCount() const { return Objectives.Num(); }

	/** True when the mission can start given the player's progress. */
	UFUNCTION(BlueprintPure, Category = "BCU|Mission")
	bool AreRequirementsMet(int32 CompletedMissions, int32 Reputation,
		const TArray<FName>& CompletedIds, float CurrentHour) const;
};

/**
 * Runtime mission instance. One exists per active mission; it tracks objective
 * progress, timers, spawned actors and the pass/fail decision.
 *
 * Blueprint subclasses override the virtuals for bespoke logic (a heist that
 * opens a vault, a race that spawns rivals). Everything else is data-driven.
 */
UCLASS(Blueprintable, BlueprintType, meta = (DisplayName = "BCU Mission"))
class BLOCKCITYULTRA_API UBCUMission : public UObject
{
	GENERATED_BODY()

public:
	/** Called once when the mission starts. */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "BCU|Mission")
	void StartMission(UBCUMissionDefinition* InDefinition);
	virtual void StartMission_Implementation(UBCUMissionDefinition* InDefinition);

	/** Per-frame update while active. */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "BCU|Mission")
	void UpdateMission(float DeltaTime);
	virtual void UpdateMission_Implementation(float DeltaTime);

	/** Called when the mission ends for any reason. */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "BCU|Mission")
	void EndMission(bool bSuccess);
	virtual void EndMission_Implementation(bool bSuccess);

	/** Reports progress against an objective (checkpoint hit, item picked up…). */
	UFUNCTION(BlueprintCallable, Category = "BCU|Mission")
	void AdvanceObjective(int32 Amount = 1);

	/** Moves to the next objective; returns false when the mission is complete. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Mission")
	bool NextObjective();

	UFUNCTION(BlueprintCallable, Category = "BCU|Mission")
	void FailMission(const FText& Reason);

	UFUNCTION(BlueprintPure, Category = "BCU|Mission")
	EBCUMissionState GetState() const { return State; }

	UFUNCTION(BlueprintPure, Category = "BCU|Mission")
	int32 GetCurrentObjectiveIndex() const { return CurrentObjectiveIndex; }

	UFUNCTION(BlueprintPure, Category = "BCU|Mission")
	const FBCUObjective* GetCurrentObjective() const;

	UFUNCTION(BlueprintPure, Category = "BCU|Mission")
	UBCUMissionDefinition* GetDefinition() const { return Definition; }

	UFUNCTION(BlueprintPure, Category = "BCU|Mission")
	float GetElapsedSeconds() const { return ElapsedSeconds; }

	UFUNCTION(BlueprintPure, Category = "BCU|Mission")
	float GetRemainingSeconds() const;

	/** Actors spawned by this mission — destroyed on EndMission. */
	UPROPERTY(Transient)
	TArray<TObjectPtr<AActor>> SpawnedActors;

protected:
	UPROPERTY(Transient)
	TObjectPtr<UBCUMissionDefinition> Definition;

	UPROPERTY(Transient)
	TArray<FBCUObjective> RuntimeObjectives;

	EBCUMissionState State = EBCUMissionState::NotStarted;
	int32 CurrentObjectiveIndex = 0;
	float ElapsedSeconds = 0.0f;
	float ObjectiveElapsedSeconds = 0.0f;
	float DamageTakenAtStart = 0.0f;

	/** Registers a spawned actor so EndMission cleans it up. */
	void TrackActor(AActor* Actor);

	/** Evaluates the current objective against live world state. */
	virtual void EvaluateObjective(float DeltaTime);
};
