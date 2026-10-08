// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"

// World Partition's streaming-source interface only exists on builds that ship
// WP. Feature-detecting it keeps the component compiling (and doing nothing)
// on a build without WP instead of failing the whole module.
#if __has_include("WorldPartition/WorldPartitionStreamingSource.h")
	#include "WorldPartition/WorldPartitionStreamingSource.h"
	#define GAMEPROJECT_WITH_WP_STREAMING_SOURCE 1
#else
	#define GAMEPROJECT_WITH_WP_STREAMING_SOURCE 0
#endif

#include "OpenWorldStreamingSourceComponent.generated.h"

/**
 * Declares this actor as a World Partition streaming source.
 *
 * World Partition already streams around the player pawn by default, so why does
 * this exist? Because an open-world voxel game needs *shaped* streaming:
 *  - a longer range in the direction of travel (highway speeds),
 *  - a different priority for the player versus a scripted cinematic camera,
 *  - the ability to target a specific runtime grid.
 *
 * All three are properties of a streaming source, not of the pawn, so they belong
 * on a component that any actor (player, vehicle, camera, mission focus) can
 * carry.
 */
UCLASS(ClassGroup = (GameProject), meta = (BlueprintSpawnableComponent, DisplayName = "Open World Streaming Source"))
class PROJECTCORE_API UOpenWorldStreamingSourceComponent : public UActorComponent
#if GAMEPROJECT_WITH_WP_STREAMING_SOURCE
	, public IWorldPartitionStreamingSourceProvider
#endif
{
	GENERATED_BODY()

public:
	UOpenWorldStreamingSourceComponent();

	/** Extra radius added on top of the grid's loading range, in cm. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "GameProject|Streaming", meta = (ClampMin = "0.0"))
	float ExtraLoadingRadius = 0.0f;

	/** Scale applied to the grid loading range. 1.0 = use the grid's own value. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "GameProject|Streaming", meta = (ClampMin = "0.1", ClampMax = "8.0"))
	float LoadingRangeScale = 1.0f;

	/** Stretch the source along the owner's velocity direction (fast travel/vehicles). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "GameProject|Streaming")
	bool bStretchAlongVelocity = false;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "GameProject|Streaming", meta = (ClampMin = "0.0", EditCondition = "bStretchAlongVelocity"))
	float VelocityStretchDistance = 5000.0f;

	/** Restrict this source to a named runtime grid. None = all grids. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "GameProject|Streaming")
	FName TargetGrid = NAME_None;

	/** When true, WP will wait for this source's cells before considering streaming complete. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "GameProject|Streaming")
	bool bBlockOnSlowLoading = false;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "GameProject|Streaming")
	bool bEnabled = true;

	/** Give this source a debug colour so it shows up in the editor's streaming visualisation. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "GameProject|Streaming")
	bool bVisualize = false;

#if GAMEPROJECT_WITH_WP_STREAMING_SOURCE
	//~ Begin IWorldPartitionStreamingSourceProvider
	virtual bool GetStreamingSource(FWorldPartitionStreamingSource& OutStreamingSource) const override;
	//~ End IWorldPartitionStreamingSourceProvider
#endif

	/** Unique name WP uses to track this source across frames. */
	FName GetStreamingSourceName() const;
};
