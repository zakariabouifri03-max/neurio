// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "World/Voxel/BCUVoxelTypes.h"
#include "BCUPedestrianSubsystem.generated.h"

class ACharacter;
class USkeletalMeshComponent;
class UInstancedStaticMeshComponent;
class UBCUVoxelBodyComponent;

UENUM(BlueprintType)
enum class EBCUPedestrianState : uint8
{
	Walking			UMETA(DisplayName = "Walking"),
	Waiting			UMETA(DisplayName = "Waiting"),
	Fleeing			UMETA(DisplayName = "Fleeing"),
	Cowering		UMETA(DisplayName = "Cowering"),
	Idle			UMETA(DisplayName = "Idle"),
	FarLOD			UMETA(DisplayName = "Far (not simulated)"),
	Downed			UMETA(DisplayName = "Downed")
};

/**
 * Pedestrian crowd simulation.
 *
 * Uses a two-tier model rather than one SkeletalMeshComponent per pedestrian:
 *   NEAR  (< FarSimulationDistanceCm) — a real pawn with a voxel body,
 *         animation, perception and flee behaviour.
 *   FAR   — a single InstancedStaticMeshComponent draw call per outfit, moved
 *         by a cheap kinematic update at 1 Hz. Hundreds of pedestrians for the
 *         cost of a handful of draw calls.
 *
 * This is the reason a downtown street can hold 240 pedestrians on a 16 GB
 * machine without the frame rate collapsing.
 */
UCLASS(config = Game, Blueprintable)
class BLOCKCITYULTRA_API UBCUPedestrianSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override;

	void RegisterCellWalkPoints(const FBCUCellCoord& Coord, const TArray<FVector>& Points);
	void UnregisterCell(const FBCUCellCoord& Coord);

	UFUNCTION(BlueprintPure, Category = "BCU|Pedestrians")
	int32 GetActivePedestrianCount() const { return NearPawns.Num(); }

	UFUNCTION(BlueprintPure, Category = "BCU|Pedestrians")
	int32 GetFarPedestrianCount() const { return FarInstanceCount; }

	UFUNCTION(BlueprintCallable, Category = "BCU|Pedestrians")
	void SetDensityScale(float Scale);

	UFUNCTION(BlueprintPure, Category = "BCU|Pedestrians")
	float GetDensityScale() const { return DensityScale; }

	/** Applies the bcu.traffic scalability group (pedestrian budget lives there). */
	UFUNCTION(BlueprintCallable, Category = "BCU|Pedestrians")
	void ApplyScalability();

	/** Makes every pedestrian within a radius panic — gunshots, explosions. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Pedestrians")
	void PanicInRadius(const FVector& Location, float RadiusCm);

	/** Called when a vehicle hits a pedestrian (crime + wanted level). */
	UFUNCTION(BlueprintCallable, Category = "BCU|Pedestrians")
	void OnPedestrianStruck(AActor* Pedestrian, const FVector& Location, float ImpactSpeedKmh);

	/** Spawns a specific NPC (mission giver, faction member). */
	UFUNCTION(BlueprintCallable, Category = "BCU|Pedestrians")
	ACharacter* SpawnNamedNPC(FName NPCId, const FVector& Location, const FRotator& Rotation);

	UPROPERTY(EditAnywhere, BlueprintReadWrite, config, Category = "BCU|Pedestrians", meta = (ClampMin = "1", ClampMax = "600"))
	int32 MaxActivePedestrians = 220;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, config, Category = "BCU|Pedestrians")
	float SpawnRadiusCm = 110000.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, config, Category = "BCU|Pedestrians")
	float DespawnRadiusCm = 150000.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, config, Category = "BCU|Pedestrians")
	float FarSimulationDistanceCm = 70000.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, config, Category = "BCU|Pedestrians")
	float BasePedestrianDensity = 1.0f;

	/** Pedestrian pawn class (BP with a UBCUVoxelBodyComponent). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Pedestrians")
	TSoftClassPtr<ACharacter> PedestrianClass;

	/** Outfit ids sampled per district; content lives in DT_PedestrianOutfits. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Pedestrians")
	TArray<FName> DefaultOutfits;

	UFUNCTION(BlueprintPure, Category = "BCU|Pedestrians|Debug")
	FString GetPedestrianStats() const;

protected:
	UPROPERTY(Transient)
	TMap<FBCUCellCoord, TArray<FVector>> WalkPoints;

	UPROPERTY(Transient)
	TArray<TObjectPtr<ACharacter>> NearPawns;

	UPROPERTY(Transient)
	TMap<FName, TObjectPtr<ACharacter>> NamedNPCs;

	UPROPERTY(Transient)
	TArray<TObjectPtr<UInstancedStaticMeshComponent>> FarInstances;

	/** Kinematic far-LOD pedestrians: position + heading, no actor. */
	TArray<FVector> FarPositions;
	TArray<FVector> FarHeadings;
	int32 FarInstanceCount = 0;

	float DensityScale = 1.0f;
	float SpawnTimer = 0.0f;
	float FarUpdateTimer = 0.0f;

	void UpdateNearPawns(float DeltaTime);
	void UpdateFarCrowd(float DeltaTime);
	void SpawnNearPlayer(float DeltaTime);
	void DespawnDistant();
	void PromoteFarToNear();
	void DemoteNearToFar();
	ACharacter* SpawnPedestrian(const FVector& Location, FName OutfitId);
	FName PickOutfitForCell(const FBCUCellCoord& Cell) const;
};
