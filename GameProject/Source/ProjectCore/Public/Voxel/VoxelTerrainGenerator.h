// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "Voxel/VoxelBlockPalette.h"
#include "Voxel/VoxelChunkData.h"
#include "Voxel/VoxelNoise.h"
#include "Voxel/VoxelWorldSettings.h"
#include "VoxelTerrainGenerator.generated.h"

/**
 * VOXEL CORE - TERRAIN GENERATION
 *
 * IVoxelTerrainGenerator is the seam between "what the world looks like" and
 * "how chunks get filled". Streaming, meshing, saving and debugging all talk to the
 * interface; none of them know whether terrain came from noise, from a hand-authored
 * heightmap, or from a city layout in Phase 03.
 *
 * The one hard rule for every implementation: generation is a PURE FUNCTION of
 * (settings, chunk coordinate). No mutable state, no time, no random number
 * generator that is not seeded from those two inputs. Chunks are never stored, so a
 * generator that is not reproducible produces a world that cannot be saved.
 *
 * Implementations are stateless and const, so any number of chunks can be generated
 * concurrently on different threads from the same generator instance.
 */
class IVoxelTerrainGenerator
{
public:
	virtual ~IVoxelTerrainGenerator() = default;

	/**
	 * Fills OutChunk's block array. OutChunk must already be allocated for the right
	 * coordinate and dimensions. Player edits are re-applied by the caller, never here.
	 */
	virtual void GenerateChunk(FVoxelChunkData& OutChunk, const FWorldGenerationSettings& Settings,
		const FVoxelBlockPalette& Palette) const = 0;

	/** Surface height in blocks (the Z of the highest non-air block) for a column. */
	virtual int32 GetSurfaceHeight(int32 VoxelX, int32 VoxelY, const FWorldGenerationSettings& Settings) const = 0;

	/** Biome classification for a column. Foundation only in Phase 02. */
	virtual EVoxelBiome GetBiome(int32 VoxelX, int32 VoxelY, const FWorldGenerationSettings& Settings) const = 0;

	/** True when the column's surface sits below the sea plane. Phase 03 water reads this. */
	virtual bool IsBelowSeaLevel(int32 VoxelX, int32 VoxelY, const FWorldGenerationSettings& Settings) const = 0;

	/** Name for logs and the debug HUD. */
	virtual const TCHAR* GetName() const = 0;
};

/**
 * The built-in multi-layer noise generator.
 *
 * Four independent layers are summed, each with its own scale and amplitude:
 *
 *   1. base        broad FBM   -> continents, plains, rolling hills
 *   2. mountain    ridged FBM, gated by a mask -> ranges with sharp peaks
 *   3. detail      high frequency FBM -> breaks up terraces and flat tops
 *   4. biome       very low frequency -> decides surface material and shape tweaks
 *
 * Layering them separately (rather than one deep FBM) is what produces readable
 * geography: wide flat valleys, distinct coastlines, and mountains that appear in
 * bands instead of everywhere at once.
 */
class FNoiseVoxelTerrainGenerator : public IVoxelTerrainGenerator
{
public:
	virtual void GenerateChunk(FVoxelChunkData& OutChunk, const FWorldGenerationSettings& Settings,
		const FVoxelBlockPalette& Palette) const override;

	virtual int32 GetSurfaceHeight(int32 VoxelX, int32 VoxelY, const FWorldGenerationSettings& Settings) const override;
	virtual EVoxelBiome GetBiome(int32 VoxelX, int32 VoxelY, const FWorldGenerationSettings& Settings) const override;
	virtual bool IsBelowSeaLevel(int32 VoxelX, int32 VoxelY, const FWorldGenerationSettings& Settings) const override;
	virtual const TCHAR* GetName() const override { return TEXT("NoiseTerrain"); }

	/** Raw height field value before clamping, in blocks. Exposed for editor tooling. */
	float GetRawHeight(int32 VoxelX, int32 VoxelY, const FWorldGenerationSettings& Settings) const;

	/** Mountain mask in [0,1]; 0 means flat land, 1 means full mountain influence. */
	float GetMountainMask(int32 VoxelX, int32 VoxelY, const FWorldGenerationSettings& Settings) const;

	/** Biome mask in [-1,1], used to select between grassland, forest and desert. */
	float GetBiomeMask(int32 VoxelX, int32 VoxelY, const FWorldGenerationSettings& Settings) const;

	/** Moisture mask in [-1,1]; drives forest vs grassland and beach banding. */
	float GetMoistureMask(int32 VoxelX, int32 VoxelY, const FWorldGenerationSettings& Settings) const;

private:
	/** Chooses the block for one position given its depth below the surface. */
	uint16 ChooseBlock(int32 DepthBelowSurface, int32 Z, int32 SurfaceZ, EVoxelBiome Biome,
		const FWorldGenerationSettings& Settings, const FVoxelBlockPalette& Palette, int32 VoxelX, int32 VoxelY) const;
};

/** Flat world with a single grass layer: the fastest possible sanity check. */
class FFlatVoxelTerrainGenerator : public IVoxelTerrainGenerator
{
public:
	virtual void GenerateChunk(FVoxelChunkData& OutChunk, const FWorldGenerationSettings& Settings,
		const FVoxelBlockPalette& Palette) const override;

	virtual int32 GetSurfaceHeight(int32 VoxelX, int32 VoxelY, const FWorldGenerationSettings& Settings) const override;
	virtual EVoxelBiome GetBiome(int32 VoxelX, int32 VoxelY, const FWorldGenerationSettings& Settings) const override;
	virtual bool IsBelowSeaLevel(int32 VoxelX, int32 VoxelY, const FWorldGenerationSettings& Settings) const override;
	virtual const TCHAR* GetName() const override { return TEXT("Flat"); }

	/** Block used for the surface layer. Defaults to grass (id 1). */
	uint16 SurfaceBlockId = 1;

	/** Block used below the surface. Defaults to dirt (id 2). */
	uint16 SubSurfaceBlockId = 2;

	/** Blocks of soil above the stone layer. */
	int32 SoilDepth = 3;
};

/**
 * THE documented enable point for terrain generation, matching VoxelMesherFactory.
 * Adding a generator means adding an enum value and one case here - no caller
 * anywhere else in the project changes.
 */
UENUM(BlueprintType)
enum class EVoxelTerrainGeneratorType : uint8
{
	Noise	UMETA(DisplayName = "Multi-Layer Noise"),
	Flat	UMETA(DisplayName = "Flat (test)"),

	/** Reserved for Phase 03: authored roads, plots and building footprints. */
	Urban	UMETA(DisplayName = "Urban (Phase 03)")
};

namespace VoxelTerrainGeneratorFactory
{
	const IVoxelTerrainGenerator& Get(EVoxelTerrainGeneratorType Type);
}
