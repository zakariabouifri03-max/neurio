// Copyright GameProject. All rights reserved. Original content only.

#include "Voxel/VoxelTerrainGenerator.h"

namespace
{
	/**
	 * Falls back to something the palette actually knows.
	 *
	 * A generator that emits an id the palette has never heard of would produce a
	 * chunk whose blocks all resolve to air at mesh time - terrain that silently
	 * vanishes. Degrading to stone, then to air, keeps the failure visible and
	 * bounded instead of corrupt.
	 */
	uint16 ResolveBlockId(uint16 Desired, const FVoxelBlockPalette& Palette)
	{
		if (Palette.Contains(Desired))
		{
			return Desired;
		}
		if (Palette.Contains(VoxelBlockIds::Stone))
		{
			return VoxelBlockIds::Stone;
		}
		return VoxelBlockIds::Air;
	}

	/** Above this height, soil gives way to bare rock. Derived from the settings, not hardcoded. */
	float ComputeRockLine(const FWorldGenerationSettings& Settings)
	{
		return static_cast<float>(Settings.BaseHeight) + Settings.MountainAmplitude * 0.42f;
	}
}

// ===========================================================================
// FNoiseVoxelTerrainGenerator - noise layers
// ===========================================================================
float FNoiseVoxelTerrainGenerator::GetMountainMask(int32 VoxelX, int32 VoxelY, const FWorldGenerationSettings& Settings) const
{
	// Half the mountain frequency: the mask describes where ranges are, which is a
	// bigger feature than the ridges inside them.
	const float Mask = VoxelNoise::Fbm2D(
		static_cast<float>(VoxelX) * Settings.MountainScale * 0.5f,
		static_cast<float>(VoxelY) * Settings.MountainScale * 0.5f,
		Settings.Seed + 31337, 3);

	const float Normalised = Mask * 0.5f + 0.5f;

	// Smoothstep rather than a hard cut: a threshold alone gives mountains a
	// perfectly straight coastline of foothills, which reads instantly as noise.
	return FMath::SmoothStep(Settings.MountainThreshold,
		Settings.MountainThreshold + FMath::Max(Settings.MountainFalloff, 0.0001f), Normalised);
}

float FNoiseVoxelTerrainGenerator::GetBiomeMask(int32 VoxelX, int32 VoxelY, const FWorldGenerationSettings& Settings) const
{
	// Temperature-ish mask. One call, one seed offset, so it never correlates with
	// the height field and deserts do not line up with valleys.
	return VoxelNoise::Fbm2D(
		static_cast<float>(VoxelX) * Settings.BiomeScale,
		static_cast<float>(VoxelY) * Settings.BiomeScale,
		Settings.Seed + 55501, 3);
}

float FNoiseVoxelTerrainGenerator::GetMoistureMask(int32 VoxelX, int32 VoxelY, const FWorldGenerationSettings& Settings) const
{
	return VoxelNoise::Fbm2D(
		static_cast<float>(VoxelX) * Settings.BiomeScale * 1.7f,
		static_cast<float>(VoxelY) * Settings.BiomeScale * 1.7f,
		Settings.Seed + 777013, 3);
}

float FNoiseVoxelTerrainGenerator::GetRawHeight(int32 VoxelX, int32 VoxelY, const FWorldGenerationSettings& Settings) const
{
	const float X = static_cast<float>(VoxelX);
	const float Y = static_cast<float>(VoxelY);

	// Layer 1: broad land shape.
	const float Base = VoxelNoise::Fbm2D(X * Settings.TerrainScale, Y * Settings.TerrainScale,
		Settings.Seed, FMath::Max(1, Settings.TerrainOctaves));

	// Layer 2: mountains, gated by the mask so ranges are places rather than
	// everywhere. Ridged noise is what gives peaks their sharp creases.
	const float Mask = GetMountainMask(VoxelX, VoxelY, Settings);
	const float Ridge = VoxelNoise::Ridged2D(X * Settings.MountainScale, Y * Settings.MountainScale,
		Settings.Seed + 91109, FMath::Max(1, Settings.MountainOctaves));

	// Layer 3: detail. Damped inside mountain ranges, where the ridges already
	// provide plenty of variation and extra noise just looks like static.
	const float Detail = VoxelNoise::Fbm2D(X * Settings.DetailScale, Y * Settings.DetailScale,
		Settings.Seed + 424243, 2);

	float Height = static_cast<float>(Settings.BaseHeight);
	Height += Base * Settings.NoiseAmplitude;
	Height += Ridge * Settings.MountainAmplitude * Mask;
	Height += Detail * Settings.DetailAmplitude * (1.0f - Mask * 0.5f);

	return Height;
}

int32 FNoiseVoxelTerrainGenerator::GetSurfaceHeight(int32 VoxelX, int32 VoxelY, const FWorldGenerationSettings& Settings) const
{
	const int32 MaxHeight = FMath::Max(1, Settings.WorldHeight - 1);
	return FMath::Clamp(FMath::RoundToInt(GetRawHeight(VoxelX, VoxelY, Settings)), 1, MaxHeight);
}

bool FNoiseVoxelTerrainGenerator::IsBelowSeaLevel(int32 VoxelX, int32 VoxelY, const FWorldGenerationSettings& Settings) const
{
	return GetSurfaceHeight(VoxelX, VoxelY, Settings) < Settings.SeaLevel;
}

EVoxelBiome FNoiseVoxelTerrainGenerator::GetBiome(int32 VoxelX, int32 VoxelY, const FWorldGenerationSettings& Settings) const
{
	const int32 Surface = GetSurfaceHeight(VoxelX, VoxelY, Settings);

	// Sea bed first. Phase 03 turns these columns into water; Phase 02 classifies
	// them and leaves the column as air above the sea bed, which is why the world
	// never silently fills with an unimplemented material.
	if (Surface < Settings.SeaLevel)
	{
		return EVoxelBiome::Water;
	}

	// A beach is simply land within a few blocks of the sea plane, which is what
	// makes coastlines get a sand band for free instead of needing a coastline pass.
	if (Surface <= Settings.SeaLevel + Settings.BeachHeightBand)
	{
		return EVoxelBiome::Beach;
	}

	const float Mask = GetMountainMask(VoxelX, VoxelY, Settings);
	if (Mask > 0.62f || static_cast<float>(Surface) > ComputeRockLine(Settings))
	{
		return EVoxelBiome::Mountain;
	}

	const float Temperature = GetBiomeMask(VoxelX, VoxelY, Settings);
	const float Moisture = GetMoistureMask(VoxelX, VoxelY, Settings);

	if (Temperature > 0.22f && Moisture < 0.02f)
	{
		return EVoxelBiome::Desert;
	}
	if (Moisture > 0.12f)
	{
		return EVoxelBiome::Forest;
	}
	return EVoxelBiome::Grassland;
}

// ===========================================================================
// FNoiseVoxelTerrainGenerator - block selection
// ===========================================================================
uint16 FNoiseVoxelTerrainGenerator::ChooseBlock(int32 DepthBelowSurface, int32 Z, int32 SurfaceZ, EVoxelBiome Biome,
	const FWorldGenerationSettings& Settings, const FVoxelBlockPalette& Palette, int32 VoxelX, int32 VoxelY) const
{
	// The world floor is always solid. Without it a player who manages to get under
	// the terrain falls forever, and every chunk boundary at z=0 becomes a hole.
	if (Z <= 0)
	{
		return ResolveBlockId(VoxelBlockIds::Stone, Palette);
	}

	const int32 Soil = FMath::Max(0, Settings.SoilDepth);

	switch (Biome)
	{
	case EVoxelBiome::Desert:
		// Deep sand: dunes are sand all the way down to the soil depth, then stone.
		return ResolveBlockId(DepthBelowSurface <= Soil + 2 ? VoxelBlockIds::Sand : VoxelBlockIds::Stone, Palette);

	case EVoxelBiome::Beach:
	case EVoxelBiome::Water:
		return ResolveBlockId(DepthBelowSurface <= Soil + 1 ? VoxelBlockIds::Sand : VoxelBlockIds::Stone, Palette);

	case EVoxelBiome::Mountain:
	{
		if (static_cast<float>(SurfaceZ) > ComputeRockLine(Settings))
		{
			// Bare rock and scree at altitude. The gravel is scattered by a 3D hash so
			// it is stable per position and never forms regular patterns.
			const float Scree = VoxelNoise::HashToUnit(VoxelNoise::Hash(VoxelX, VoxelY, Z, Settings.Seed + 9001));
			const uint16 RockBlock = (Scree > 0.82f && DepthBelowSurface <= 1) ? VoxelBlockIds::Gravel : VoxelBlockIds::Stone;
			return ResolveBlockId(RockBlock, Palette);
		}
		// Alpine meadow below the rock line: same soil profile as grassland.
		return ResolveBlockId(DepthBelowSurface == 0 ? VoxelBlockIds::Grass
			: (DepthBelowSurface <= Soil ? VoxelBlockIds::Dirt : VoxelBlockIds::Stone), Palette);
	}

	case EVoxelBiome::Forest:
	{
		// Forest floor: dirt at the surface instead of grass on the deeper columns,
		// which reads as leaf litter and costs one extra comparison.
		if (DepthBelowSurface == 0)
		{
			const float Litter = VoxelNoise::HashToUnit(VoxelNoise::Hash(VoxelX, VoxelY, 0, Settings.Seed + 4007));
			return ResolveBlockId(Litter > 0.75f ? VoxelBlockIds::Dirt : VoxelBlockIds::Grass, Palette);
		}
		return ResolveBlockId(DepthBelowSurface <= Soil ? VoxelBlockIds::Dirt : VoxelBlockIds::Stone, Palette);
	}

	case EVoxelBiome::Grassland:
	default:
		return ResolveBlockId(DepthBelowSurface == 0 ? VoxelBlockIds::Grass
			: (DepthBelowSurface <= Soil ? VoxelBlockIds::Dirt : VoxelBlockIds::Stone), Palette);
	}
}

// ===========================================================================
// FNoiseVoxelTerrainGenerator - chunk fill
// ===========================================================================
void FNoiseVoxelTerrainGenerator::GenerateChunk(FVoxelChunkData& OutChunk, const FWorldGenerationSettings& Settings,
	const FVoxelBlockPalette& Palette) const
{
	if (!OutChunk.IsAllocated())
	{
		// The caller owns logging. Staying silent here is what keeps this file free of
		// engine dependencies, so it can run on a worker thread and in unit tests.
		return;
	}

	const FVoxelDimensions& Dims = OutChunk.Dims;
	const FIntVector Origin = VoxelCoordinates::ChunkToVoxel(OutChunk.Coord, Dims);

	const int32 MaxZ = FMath::Min(Dims.SizeZ, FMath::Max(1, Settings.WorldHeight));
	const int32 SeaFillTop = FMath::Min(Settings.SeaLevel, MaxZ - 1);
	const bool bFillWater = (Settings.WaterBlockId != 0 && Palette.Contains(Settings.WaterBlockId));

	// Column-major: the height field and both biome masks are evaluated once per
	// column instead of once per block, which is a SizeZ-fold saving on the most
	// expensive part of generation.
	for (int32 LocalY = 0; LocalY < Dims.SizeY; ++LocalY)
	{
		const int32 WorldY = Origin.Y + LocalY;

		for (int32 LocalX = 0; LocalX < Dims.SizeX; ++LocalX)
		{
			const int32 WorldX = Origin.X + LocalX;

			const int32 SurfaceZ = GetSurfaceHeight(WorldX, WorldY, Settings);
			const EVoxelBiome Biome = GetBiome(WorldX, WorldY, Settings);

			const int32 FillTop = FMath::Min(SurfaceZ, MaxZ - 1);

			for (int32 Z = 0; Z <= FillTop; ++Z)
			{
				const uint16 BlockId = ChooseBlock(SurfaceZ - Z, Z, SurfaceZ, Biome, Settings, Palette, WorldX, WorldY);
				if (BlockId == VoxelBlockIds::Air)
				{
					continue;
				}

				// bRecordModification is false: generated terrain is reproducible from
				// the seed and must never be written into a save file.
				OutChunk.SetBlock(LocalX, LocalY, Z, FVoxelBlock::Make(BlockId), false);
			}

			if (bFillWater)
			{
				for (int32 Z = FillTop + 1; Z <= SeaFillTop; ++Z)
				{
					OutChunk.SetBlock(LocalX, LocalY, Z, FVoxelBlock::Make(Settings.WaterBlockId), false);
				}
			}
		}
	}

	OutChunk.RecomputeUsedRange();
}

// ===========================================================================
// FFlatVoxelTerrainGenerator
// ===========================================================================
void FFlatVoxelTerrainGenerator::GenerateChunk(FVoxelChunkData& OutChunk, const FWorldGenerationSettings& Settings,
	const FVoxelBlockPalette& Palette) const
{
	if (!OutChunk.IsAllocated())
	{
		return;
	}

	const FVoxelDimensions& Dims = OutChunk.Dims;
	const int32 SurfaceZ = FMath::Clamp(Settings.BaseHeight, 1, FMath::Min(Dims.SizeZ, Settings.WorldHeight) - 1);
	const int32 Soil = FMath::Max(0, SoilDepth);

	const uint16 SurfaceId = ResolveBlockId(SurfaceBlockId, Palette);
	const uint16 SubSurfaceId = ResolveBlockId(SubSurfaceBlockId, Palette);
	const uint16 StoneId = ResolveBlockId(VoxelBlockIds::Stone, Palette);
	const uint16 FloorId = ResolveBlockId(VoxelBlockIds::Stone, Palette);

	for (int32 Z = 0; Z <= SurfaceZ; ++Z)
	{
		uint16 BlockId = StoneId;
		if (Z == 0)
		{
			BlockId = FloorId;
		}
		else if (Z == SurfaceZ)
		{
			BlockId = SurfaceId;
		}
		else if (Z > SurfaceZ - Soil)
		{
			BlockId = SubSurfaceId;
		}

		if (BlockId == VoxelBlockIds::Air)
		{
			continue;
		}

		for (int32 Y = 0; Y < Dims.SizeY; ++Y)
		{
			for (int32 X = 0; X < Dims.SizeX; ++X)
			{
				OutChunk.SetBlock(X, Y, Z, FVoxelBlock::Make(BlockId), false);
			}
		}
	}

	OutChunk.RecomputeUsedRange();
}

int32 FFlatVoxelTerrainGenerator::GetSurfaceHeight(int32 VoxelX, int32 VoxelY, const FWorldGenerationSettings& Settings) const
{
	return FMath::Clamp(Settings.BaseHeight, 1, FMath::Max(1, Settings.WorldHeight - 1));
}

EVoxelBiome FFlatVoxelTerrainGenerator::GetBiome(int32 VoxelX, int32 VoxelY, const FWorldGenerationSettings& Settings) const
{
	return (Settings.BaseHeight < Settings.SeaLevel) ? EVoxelBiome::Water : EVoxelBiome::Grassland;
}

bool FFlatVoxelTerrainGenerator::IsBelowSeaLevel(int32 VoxelX, int32 VoxelY, const FWorldGenerationSettings& Settings) const
{
	return GetSurfaceHeight(VoxelX, VoxelY, Settings) < Settings.SeaLevel;
}

// ===========================================================================
// Factory
// ===========================================================================
namespace VoxelTerrainGeneratorFactory
{
	const IVoxelTerrainGenerator& Get(EVoxelTerrainGeneratorType Type)
	{
		// Stateless singletons again: generators hold no per-world data, the settings
		// struct carries the seed, so one instance serves every world and thread.
		static const FNoiseVoxelTerrainGenerator NoiseGenerator;
		static const FFlatVoxelTerrainGenerator FlatGenerator;

		switch (Type)
		{
		case EVoxelTerrainGeneratorType::Flat:	return FlatGenerator;
		case EVoxelTerrainGeneratorType::Urban:
			// Phase 03. Until an urban generator exists, noise is the honest fallback:
			// a flat world would look like the feature was broken rather than unbuilt.
			return NoiseGenerator;
		case EVoxelTerrainGeneratorType::Noise:
		default:								return NoiseGenerator;
		}
	}
}
