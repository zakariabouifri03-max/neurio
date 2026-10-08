// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "OpenWorldTestAreaBuilder.generated.h"

class APlayerStart;
class AInteractableTestActor;
class AVoxelWorldManager;
class ADirectionalLight;
class ASkyLight;
class ASkyAtmosphere;
class AExponentialHeightFog;

/**
 * Builds the Phase 01/02 test environment at runtime.
 *
 * The reason this is an actor and not a hand-authored level: a freshly cloned
 * repository contains no .umap, and a project that cannot be played until someone
 * authors a level by hand is a project nobody tests. This builder makes any empty
 * level (including the engine's Template_Default) a valid test world, and the
 * editor bootstrap script uses the same settings to author Map_VoxelTest for real.
 *
 * Everything it does is idempotent and skipped when the level already provides
 * it, so a properly authored World Partition map keeps its own lighting, player
 * start and interactables.
 */
UCLASS()
class PROJECTCORE_API AOpenWorldTestAreaBuilder : public AActor
{
	GENERATED_BODY()

public:
	AOpenWorldTestAreaBuilder();

	//~ Begin AActor
	virtual void BeginPlay() override;
	//~ End AActor

	/** Builds everything that is missing. Safe to call again at runtime. */
	UFUNCTION(BlueprintCallable, CallInEditor, Category = "GameProject|World|Test")
	void BuildTestArea();

	/** Adds a sky, sun and fog when the level has none. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "GameProject|World|Test")
	bool bSpawnDefaultLighting = true;

	/** Adds a PlayerStart at the configured spawn point when the level has none. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "GameProject|World|Test")
	bool bSpawnPlayerStart = true;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "GameProject|World|Test")
	FVector PlayerStartLocation = FVector(0.0f, 0.0f, 400.0f);

	/** Places a few IInteractable actors so the interaction system is testable immediately. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "GameProject|World|Test")
	bool bSpawnTestInteractables = true;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "GameProject|World|Test", meta = (ClampMin = "0", ClampMax = "16", EditCondition = "bSpawnTestInteractables"))
	int32 TestInteractableCount = 4;

	/** Spacing between spawned test interactables, in cm. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "GameProject|World|Test", meta = (ClampMin = "100.0", EditCondition = "bSpawnTestInteractables"))
	float TestInteractableSpacing = 350.0f;

	UFUNCTION(BlueprintPure, Category = "GameProject|World|Test")
	bool IsBuilt() const { return bIsBuilt; }

protected:
	void EnsureLighting();
	void EnsurePlayerStart();
	void SpawnTestInteractables();
	void EnsureVoxelWorld();

	/** True when this actor created the lighting, so it can be torn down cleanly. */
	UPROPERTY(Transient)
	TArray<TObjectPtr<AActor>> SpawnedActors;

	UPROPERTY(Transient)
	TObjectPtr<AVoxelWorldManager> VoxelWorldManager;

	bool bIsBuilt = false;
};
