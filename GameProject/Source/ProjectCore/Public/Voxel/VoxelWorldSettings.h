// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "Voxel/VoxelCoreTypes.h"
#include "Voxel/VoxelMesher.h"
#include "VoxelWorldSettings.generated.h"

/**
 * Biome classification.
 *
 * Phase 02 uses this to pick surface materials and terrain shape only - there are
 * no biome-specific rules, no flora, no weather. The enum exists now so the
 * generator's output can already be classified (and so Phase 03 can build real
 * biomes on top of a stable id instead of retrofitting one).
 */
UENUM(BlueprintType)
enum class EVoxelBiome : uint8
{
	Unknown		UMETA(DisplayName = "Unknown"),
	Grassland	UMETA(DisplayName = "Grassland"),
	Forest		UMETA(DisplayName = "Forest"),
	Desert		UMETA(DisplayName = "Desert"),
	Mountain	UMETA(DisplayName = "Mountain"),
	Beach		UMETA(DisplayName = "Beach"),
	Urban		UMETA(DisplayName = "Urban (Phase 03)"),
	Water		UMETA(DisplayName = "Water (Phase 03)")
};

/**
 * WORLD GENERATION SETTINGS
 *
 * Everything the terrain generator is allowed to know. A chunk's contents are a pure
 * function of (these settings, the chunk coordinate), which is the property the save
 * system depends on: generated blocks are never stored, they are recomputed. Change
 * any value here and previously generated chunks no longer match their saves, so the
 * settings are stored alongside the save's seed and validated on load.
 */
USTRUCT(BlueprintType)
struct FWorldGenerationSettings
{
	GENERATED_BODY()

	/** World seed. Same seed plus same settings plus same coordinate == same terrain. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Generation")
	int32 Seed = 20260101;

	/** Total column height in blocks. Must match the chunk's SizeZ. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Generation", meta = (ClampMin = "16", ClampMax = "512"))
	int32 WorldHeight = 128;

	/** Height (in blocks) of the sea plane. Terrain below it is classified as beach/water. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Generation", meta = (ClampMin = "0", ClampMax = "512"))
	int32 SeaLevel = 40;

	/** Mean land height in blocks, before any noise is applied. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Generation", meta = (ClampMin = "1", ClampMax = "256"))
	int32 BaseHeight = 48;

	/** Frequency of the broad land-shape noise. Smaller = larger features. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Generation", meta = (ClampMin = "0.00005", ClampMax = "0.1"))
	float TerrainScale = 0.0040f;

	/** Amplitude of the broad land-shape noise, in blocks. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Generation", meta = (ClampMin = "0.0", ClampMax = "200.0"))
	float NoiseAmplitude = 14.0f;

	/** Frequency of the mountain mask. Should be lower than TerrainScale for continent-sized ranges. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Generation", meta = (ClampMin = "0.00002", ClampMax = "0.05"))
	float MountainScale = 0.0011f;

	/** Extra height mountains can add, in blocks. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Generation", meta = (ClampMin = "0.0", ClampMax = "300.0"))
	float MountainAmplitude = 46.0f;

	/** Ridged noise above this mask value starts producing mountains. 1.0 disables them. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Generation", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float MountainThreshold = 0.42f;

	/** Sharpness of the mountain mask transition. Higher = more abrupt foothills. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Generation", meta = (ClampMin = "0.01", ClampMax = "1.0"))
	float MountainFalloff = 0.30f;

	/** Frequency of the fine detail noise; breaks up flat terraces. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Generation", meta = (ClampMin = "0.0005", ClampMax = "0.5"))
	float DetailScale = 0.0450f;

	/** Amplitude of the fine detail noise, in blocks. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Generation", meta = (ClampMin = "0.0", ClampMax = "20.0"))
	float DetailAmplitude = 2.0f;

	/** Frequency of the biome mask. One biome spans roughly 1 / BiomeScale blocks. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Generation", meta = (ClampMin = "0.00002", ClampMax = "0.05"))
	float BiomeScale = 0.00055f;

	/** Octaves for the broad land-shape noise. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Generation", meta = (ClampMin = "1", ClampMax = "8"))
	int32 TerrainOctaves = 4;

	/** Octaves for the ridged mountain noise. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Generation", meta = (ClampMin = "1", ClampMax = "8"))
	int32 MountainOctaves = 4;

	/** How many blocks above the surface are soil (dirt/sand) before stone. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Generation", meta = (ClampMin = "0", ClampMax = "16"))
	int32 SoilDepth = 3;

	/**
	 * Water filling is a Phase 03 system. When this is 0 (the default) the generator
	 * leaves the column between the sea bed and SeaLevel as air and merely classifies
	 * it, so Phase 03 can drop water in without a single change to terrain code.
	 * Set it to a real water block id to start filling immediately.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Generation|Phase 03")
	uint16 WaterBlockId = 0;

	/** Width of the sand band around the shoreline, in blocks of height above sea level. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Generation", meta = (ClampMin = "0", ClampMax = "16"))
	int32 BeachHeightBand = 3;
};

/**
 * STREAMING SETTINGS
 *
 * The three radii are what keep a continent-sized world inside a memory budget:
 * nothing outside UnloadDistance ever exists, nothing outside PreloadDistance is
 * ever generated, and nothing outside ViewDistance is ever drawn.
 */
USTRUCT(BlueprintType)
struct FVoxelStreamingSettings
{
	GENERATED_BODY()

	/** Chunks within this radius are meshed, collided and visible. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Streaming", meta = (ClampMin = "1", ClampMax = "64"))
	int32 ViewDistanceInChunks = 8;

	/** Chunks within this radius are generated (block data only), ready to mesh. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Streaming", meta = (ClampMin = "1", ClampMax = "64"))
	int32 PreloadDistanceInChunks = 10;

	/** Chunks beyond this radius are released. Must exceed PreloadDistance or chunks thrash. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Streaming", meta = (ClampMin = "2", ClampMax = "96"))
	int32 UnloadDistanceInChunks = 12;

	/** Generation tasks allowed to run at once across all worker threads. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Streaming", meta = (ClampMin = "1", ClampMax = "16"))
	int32 MaxConcurrentGenerationTasks = 3;

	/** Mesh tasks allowed to run at once. Meshing allocates more than generation. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Streaming", meta = (ClampMin = "1", ClampMax = "16"))
	int32 MaxConcurrentMeshTasks = 2;

	/** How often the streaming set is re-evaluated, in seconds. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Streaming", meta = (ClampMin = "0.01", ClampMax = "2.0"))
	float StreamingUpdateInterval = 0.10f;

	/**
	 * Milliseconds of game-thread work the manager may spend per frame applying
	 * finished chunks. Anything left over waits for the next frame, which is what
	 * stops a fast drive across the world from becoming a hitch.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Streaming", meta = (ClampMin = "0.1", ClampMax = "16.0"))
	float FrameBudgetMs = 3.0f;

	/** Weight movement direction in the priority order, so terrain arrives before you do. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Streaming")
	bool bBiasTowardMovementDirection = true;

	/** 0 = pure distance ordering, 1 = strongly forward biased. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Streaming", meta = (ClampMin = "0.0", ClampMax = "1.0", EditCondition = "bBiasTowardMovementDirection"))
	float MovementBiasStrength = 0.55f;

	/** Hard ceiling on resident chunks. Streaming stops requesting past it rather than exhausting memory. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Streaming", meta = (ClampMin = "16", ClampMax = "8192"))
	int32 MaxResidentChunks = 1024;

	/**
	 * When true, a chunk whose neighbours are all present is meshed with
	 * bAssumeOutsideSolid, skipping border faces entirely. Only safe for chunks that
	 * cannot be seen from outside, so it is applied by distance, not globally.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Streaming")
	bool bOptimiseEnclosedChunks = false;
};

/** The complete description of one voxel world. Copied by value into worker tasks. */
USTRUCT(BlueprintType)
struct FVoxelWorldSettings
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	FVoxelDimensions Dimensions;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	FWorldGenerationSettings Generation;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	FVoxelStreamingSettings Streaming;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	FVoxelMesherSettings Mesher;

	/** Chunks closer than this use Mesher.Mode; further ones drop to greedy. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel|LOD", meta = (ClampMin = "1", ClampMax = "64"))
	int32 SimplifiedLODDistanceInChunks = 5;

	/**
	 * Beyond this distance a chunk would use the Phase 03 low-detail representation.
	 * Until that exists it behaves as Simplified, and the value is here so the
	 * streaming code and the debug HUD already speak in terms of three LOD bands.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel|LOD", meta = (ClampMin = "1", ClampMax = "64"))
	int32 LowDetailLODDistanceInChunks = 7;

	/** LOD selection honours distance bands. Turn off to force one mesher everywhere. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel|LOD")
	bool bEnableDistanceLOD = true;

	/** Chooses the LOD band for a chunk at this distance from the streaming focus. */
	EVoxelChunkLOD ResolveLOD(int32 ChebyshevDistanceInChunks) const
	{
		if (!bEnableDistanceLOD)
		{
			return EVoxelChunkLOD::Full;
		}
		if (ChebyshevDistanceInChunks >= LowDetailLODDistanceInChunks)
		{
			return EVoxelChunkLOD::LowDetail;
		}
		if (ChebyshevDistanceInChunks >= SimplifiedLODDistanceInChunks)
		{
			return EVoxelChunkLOD::Simplified;
		}
		return EVoxelChunkLOD::Full;
	}

	/** Effective mesher mode for a LOD band. */
	EVoxelMesherMode ResolveMesherMode(EVoxelChunkLOD LOD) const
	{
		return (LOD == EVoxelChunkLOD::Full) ? Mesher.Mode : EVoxelMesherMode::Greedy;
	}

	/**
	 * Catches the configuration mistakes that would otherwise show up as a broken
	 * world at runtime: unload inside preload, a sea level above the column, and so on.
	 * @return the number of problems found; descriptions go to OutProblems.
	 */
	int32 Validate(TArray<FString>* OutProblems = nullptr) const;
};
