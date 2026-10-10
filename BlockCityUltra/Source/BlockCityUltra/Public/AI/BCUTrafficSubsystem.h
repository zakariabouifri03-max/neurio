// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "World/Voxel/BCUVoxelTypes.h"
#include "World/City/BCUCityGenerator.h"
#include "BCUTrafficSubsystem.generated.h"

class ABCUBaseVehicle;
class UBCUTrafficComponent;
class UBCUVehicleDefinition;
class UBCUVehicleSubsystem;

/** A node of the runtime lane graph: one driveable point on one road. */
USTRUCT(BlueprintType)
struct FBCULaneNode
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "BCU|Traffic")
	FVector Location = FVector::ZeroVector;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|Traffic")
	FVector Direction = FVector::ForwardVector;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|Traffic")
	FBCUCellCoord Cell;

	/** Index of the road this node belongs to (for speed limits). */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|Traffic")
	int32 RoadIndex = 0;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|Traffic")
	float SpeedLimitKmh = 50.0f;

	/** Successor node indices inside the same cell's node array. */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|Traffic")
	TArray<int32> Successors;

	/** True at an intersection — where AI decides to turn. */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|Traffic")
	bool bIsIntersection = false;
};

/** One simulated traffic vehicle (pooled actor + component state). */
USTRUCT(BlueprintType)
struct FBCUTrafficAgent
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "BCU|Traffic")
	TObjectPtr<ABCUBaseVehicle> Vehicle = nullptr;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|Traffic")
	int32 CurrentNode = INDEX_NONE;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|Traffic")
	int32 TargetNode = INDEX_NONE;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|Traffic")
	FBCUCellCoord Cell;

	/** 0 = far (kinematic), 1 = near (full physics + AI). */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|Traffic")
	float SimulationLOD = 0.0f;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|Traffic")
	float DesiredSpeedKmh = 50.0f;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|Traffic")
	bool bHonking = false;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|Traffic")
	bool bYielding = false;
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnBCUTrafficDensityChanged, float, NewDensity);

/**
 * Dynamic traffic: lane graph, vehicle pooling, distance-based simulation LOD.
 *
 * Three simulation tiers, because simulating 140 cars with full Chaos physics
 * and AI is not viable even on an RTX 5060-class machine:
 *   TIER 0 (< 450 m)  full physics, full AI, reactive to the player
 *   TIER 1 (< 900 m)  kinematic movement along the lane graph, 3 Hz AI
 *   TIER 2 (> 900 m)  not simulated; despawned or represented by an impostor
 *
 * The lane graph is built from the road segments the city generator produced,
 * registered per cell by ABCUCityStreamer. When a cell unloads, its nodes and
 * its agents go with it.
 */
UCLASS(config = Game, Blueprintable)
class BLOCKCITYULTRA_API UBCUTrafficSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override;

	// ── Lane graph (registered by the city streamer) ────────────────────────
	void RegisterCellLanes(const FBCUCellCoord& Coord, const TArray<FVector>& SpawnPoints,
		const TArray<FBCURoadSegment>& Roads);
	void UnregisterCell(const FBCUCellCoord& Coord);

	/** Node list for a cell (empty when the cell is not resident). */
	UFUNCTION(BlueprintPure, Category = "BCU|Traffic")
	const TArray<FBCULaneNode>& GetCellNodes(const FBCUCellCoord& Coord) const;

	/** Nearest node to a world location, and its distance. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Traffic")
	bool FindNearestNode(const FVector& Location, float MaxDistanceCm, int32& OutNodeIndex,
		FBCUCellCoord& OutCell) const;

	/** A* along the lane graph. Returns false when no route exists. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Traffic")
	bool FindRouteAlongLanes(const FVector& Start, const FVector& End, TArray<FVector>& OutPath) const;

	// ── Density / budget ────────────────────────────────────────────────────
	UFUNCTION(BlueprintCallable, Category = "BCU|Traffic")
	void SetDensityScale(float Scale);

	UFUNCTION(BlueprintPure, Category = "BCU|Traffic")
	float GetDensityScale() const { return DensityScale; }

	UFUNCTION(BlueprintPure, Category = "BCU|Traffic")
	int32 GetActiveVehicleCount() const { return Agents.Num(); }

	/** Applies the bcu.traffic scalability group. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Traffic")
	void ApplyScalability();

	UPROPERTY(EditAnywhere, BlueprintReadWrite, config, Category = "BCU|Traffic", meta = (ClampMin = "1", ClampMax = "400"))
	int32 MaxActiveTrafficVehicles = 120;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, config, Category = "BCU|Traffic")
	float SpawnRadiusCm = 140000.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, config, Category = "BCU|Traffic")
	float DespawnRadiusCm = 190000.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, config, Category = "BCU|Traffic")
	float SimulationLODFarCm = 90000.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, config, Category = "BCU|Traffic")
	bool bUseDistanceBasedSimulation = true;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, config, Category = "BCU|Traffic")
	float BaseTrafficDensity = 1.0f;

	UPROPERTY(BlueprintAssignable, Category = "BCU|Traffic")
	FOnBCUTrafficDensityChanged OnDensityChanged;

	// ── Agent access (used by police + missions) ────────────────────────────
	const TArray<FBCUTrafficAgent>& GetAgents() const { return Agents; }

	/** Nearest traffic vehicle to a point — for carjacking and AI hijacks. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Traffic")
	ABCUBaseVehicle* FindNearestTrafficVehicle(const FVector& Location, float MaxDistanceCm) const;

	/** Clears a radius of traffic (explosion, roadblock, mission). */
	UFUNCTION(BlueprintCallable, Category = "BCU|Traffic")
	int32 ClearTrafficInRadius(const FVector& Location, float RadiusCm);

	/** Profiler one-liner for `bcu.traffic.stat`. */
	UFUNCTION(BlueprintPure, Category = "BCU|Traffic|Debug")
	FString GetTrafficStats() const;

protected:
	UPROPERTY(Transient)
	TMap<FBCUCellCoord, TArray<FBCULaneNode>> LaneGraph;

	UPROPERTY(Transient)
	TArray<FBCUTrafficAgent> Agents;

	/** Pool of despawned vehicles ready for reuse (avoids spawn cost). */
	UPROPERTY(Transient)
	TArray<TObjectPtr<ABCUBaseVehicle>> VehiclePool;

	UPROPERTY(Transient)
	TObjectPtr<UBCUVehicleSubsystem> Vehicles;

	float DensityScale = 1.0f;
	float SpawnTimer = 0.0f;
	int32 TotalSpawned = 0;
	int32 TotalDespawned = 0;

	void UpdateSimulationLODs(float DeltaTime);
	void DriveAllAgents(float DeltaTime);
	void SpawnTrafficNearPlayer(float DeltaTime);
	void DespawnDistantTraffic();
	void DriveAgent(FBCUTrafficAgent& Agent, float DeltaTime, bool bFullRate);
	void SteerAgentAlongLane(FBCUTrafficAgent& Agent, const FBCULaneNode& Node, float DeltaTime);
	bool AgentAvoidanceCheck(const FBCUTrafficAgent& Agent, float& OutBrake, float& OutSteerBias) const;
	ABCUBaseVehicle* AcquireVehicleFromPool(const FTransform& SpawnTransform, UBCUVehicleDefinition* Def);
	void ReturnVehicleToPool(ABCUBaseVehicle* Vehicle);
	UBCUVehicleDefinition* PickRandomTrafficVehicle(const FBCUCellCoord& Cell) const;

};
