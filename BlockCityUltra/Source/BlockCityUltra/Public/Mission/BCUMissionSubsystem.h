// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "Mission/BCUMissionTypes.h"
#include "BCUMissionSubsystem.generated.h"

class UBCUMission;
class UBCUMissionDefinition;
class UBCUEconomySubsystem;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnBCUMissionStarted, UBCUMissionDefinition*, Definition);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnBCUMissionEnded, UBCUMissionDefinition*, Definition, bool, bSuccess);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnBCUObjectiveChanged, UBCUMissionDefinition*, Definition, const FBCUObjective&, Objective);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnBCURandomEventTriggered, FName, EventId);

/**
 * Owns the mission roster, the active mission, random events and the mission
 * markers the map/minimap draw.
 *
 * The roster is discovered through the Asset Manager primary-asset type
 * "BCUMission", so adding a mission is a data task: drop a
 * UBCUMissionDefinition asset into /Game/Data/Missions and it appears in the
 * phone's mission list with no code change.
 */
UCLASS(config = Game, Blueprintable)
class BLOCKCITYULTRA_API UBCUMissionSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override;

	// ── Roster ──────────────────────────────────────────────────────────────
	/** Scans the Asset Manager for every mission definition. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Mission")
	void RefreshMissionRoster();

	UFUNCTION(BlueprintPure, Category = "BCU|Mission")
	const TArray<UBCUMissionDefinition*>& GetAllMissions() const { return AllMissions; }

	/** Missions the player may start right now (requirements met, not done). */
	UFUNCTION(BlueprintCallable, Category = "BCU|Mission")
	TArray<UBCUMissionDefinition*> GetAvailableMissions() const;

	UFUNCTION(BlueprintPure, Category = "BCU|Mission")
	UBCUMissionDefinition* FindMission(FName MissionId) const;

	// ── Lifecycle ───────────────────────────────────────────────────────────
	UFUNCTION(BlueprintCallable, Category = "BCU|Mission")
	bool StartMission(FName MissionId);

	UFUNCTION(BlueprintCallable, Category = "BCU|Mission")
	bool StartMissionFromDefinition(UBCUMissionDefinition* Definition);

	UFUNCTION(BlueprintCallable, Category = "BCU|Mission")
	void AbandonActiveMission();

	UFUNCTION(BlueprintCallable, Category = "BCU|Mission")
	void FailActiveMission(const FText& Reason);

	UFUNCTION(BlueprintPure, Category = "BCU|Mission")
	UBCUMission* GetActiveMission() const { return ActiveMission; }

	UFUNCTION(BlueprintPure, Category = "BCU|Mission")
	bool IsMissionActive() const { return ActiveMission != nullptr; }

	UFUNCTION(BlueprintPure, Category = "BCU|Mission")
	UBCUMissionDefinition* GetActiveDefinition() const
	{
		return ActiveMission ? ActiveMission->GetDefinition() : nullptr;
	}

	/** Current objective, for the HUD. */
	UFUNCTION(BlueprintPure, Category = "BCU|Mission")
	bool GetCurrentObjective(FBCUObjective& OutObjective) const;

	/** World position of the current objective marker (for minimap + GPS). */
	UFUNCTION(BlueprintPure, Category = "BCU|Mission")
	bool GetCurrentMarkerLocation(FVector& OutLocation, float& OutRadius, FLinearColor& OutColor) const;

	/** Full GPS route to the current marker, following the road graph. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Mission")
	TArray<FVector> BuildRouteToCurrentMarker() const;

	// ── Completion bookkeeping (persisted by the save system) ───────────────
	UFUNCTION(BlueprintCallable, Category = "BCU|Mission")
	void MarkMissionCompleted(FName MissionId, bool bSuccess);

	UFUNCTION(BlueprintPure, Category = "BCU|Mission")
	bool IsMissionCompleted(FName MissionId) const { return CompletedMissions.Contains(MissionId); }

	UFUNCTION(BlueprintPure, Category = "BCU|Mission")
	const TArray<FName>& GetCompletedMissions() const { return CompletedMissions; }

	UFUNCTION(BlueprintPure, Category = "BCU|Mission")
	int32 GetCompletedCount() const { return CompletedMissions.Num(); }

	/** Overall story completion 0..1 for the map screen. */
	UFUNCTION(BlueprintPure, Category = "BCU|Mission")
	float GetStoryCompletionFraction() const;

	// ── Random events ───────────────────────────────────────────────────────
	UFUNCTION(BlueprintCallable, Category = "BCU|Mission|Events")
	void TriggerRandomEvent(FName EventId, const FVector& Location);

	UFUNCTION(BlueprintCallable, Category = "BCU|Mission|Events")
	void SetRandomEventsEnabled(bool bEnabled) { bRandomEventsEnabled = bEnabled; }

	UPROPERTY(EditAnywhere, config, Category = "BCU|Mission|Events")
	bool bRandomEventsEnabled = true;

	UPROPERTY(EditAnywhere, config, Category = "BCU|Mission|Events", meta = (ClampMin = "5.0"))
	float RandomEventCheckIntervalSeconds = 20.0f;

	/** Original random events: mugging, stranded motorist, runaway trailer,
	 *  street race invitation, shop robbery in progress, ambulance call. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Mission|Events")
	TArray<TSoftObjectPtr<UBCUMissionDefinition>> RandomEventPool;

	// ── Difficulty / reward scaling (set by the game mode) ──────────────────
	void SetRewardMultiplier(float Value) { RewardMultiplier = Value; }
	float GetRewardMultiplier() const { return RewardMultiplier; }

	UPROPERTY(BlueprintAssignable, Category = "BCU|Mission")
	FOnBCUMissionStarted OnMissionStarted;

	UPROPERTY(BlueprintAssignable, Category = "BCU|Mission")
	FOnBCUMissionEnded OnMissionEnded;

	UPROPERTY(BlueprintAssignable, Category = "BCU|Mission")
	FOnBCUObjectiveChanged OnObjectiveChanged;

	UPROPERTY(BlueprintAssignable, Category = "BCU|Mission")
	FOnBCURandomEventTriggered OnRandomEventTriggered;

	/** Max simultaneously active missions (story + one side job). */
	UPROPERTY(EditAnywhere, config, Category = "BCU|Mission", meta = (ClampMin = "1", ClampMax = "8"))
	int32 MaxActiveMissions = 3;

protected:
	UPROPERTY(Transient)
	TArray<TObjectPtr<UBCUMissionDefinition>> AllMissions;

	UPROPERTY(Transient)
	TObjectPtr<UBCUMission> ActiveMission;

	UPROPERTY(SaveGame, BlueprintReadOnly, Category = "BCU|Mission")
	TArray<FName> CompletedMissions;

	UPROPERTY(SaveGame, BlueprintReadOnly, Category = "BCU|Mission")
	TArray<FName> FailedMissions;

	float RewardMultiplier = 1.0f;
	float RandomEventTimer = 0.0f;
	int32 LastObjectiveIndex = -1;

	void HandleMissionEnded(bool bSuccess);
	void GrantReward(const FBCUMissionReward& Reward, UBCUMissionDefinition* Definition, float ElapsedSeconds);
	void TrySpawnRandomEvent();
	UBCUMission* CreateMissionInstance(UBCUMissionDefinition* Definition);
};
