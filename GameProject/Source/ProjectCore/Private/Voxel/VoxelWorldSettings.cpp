// Copyright GameProject. All rights reserved. Original content only.

#include "Voxel/VoxelWorldSettings.h"

int32 FVoxelWorldSettings::Validate(TArray<FString>* OutProblems) const
{
	int32 Problems = 0;

	auto Report = [OutProblems, &Problems](const TCHAR* Message)
	{
		++Problems;
		if (OutProblems)
		{
			OutProblems->Add(Message);
		}
	};

	if (!Dimensions.IsValid())
	{
		Report(TEXT("Chunk dimensions are invalid (a size is zero or block scale is not positive)."));
	}

	if (!Dimensions.IsHorizontalPowerOfTwo())
	{
		// Not fatal - FloorDiv handles any divisor - but it costs a division per
		// coordinate conversion instead of a shift, on the hottest path in streaming.
		Report(TEXT("Chunk SizeX/SizeY are not powers of two; streaming will still work but conversions are slower."));
	}

	if (Generation.WorldHeight != Dimensions.SizeZ)
	{
		Report(TEXT("Generation.WorldHeight does not match Dimensions.SizeZ; terrain would be clipped or float."));
	}

	if (Generation.SeaLevel > Generation.WorldHeight)
	{
		Report(TEXT("Generation.SeaLevel is above the top of the world column."));
	}

	if (Generation.BaseHeight + Generation.NoiseAmplitude + Generation.MountainAmplitude + Generation.DetailAmplitude
		> static_cast<float>(Generation.WorldHeight))
	{
		Report(TEXT("Terrain amplitudes can exceed WorldHeight; peaks would be clamped flat."));
	}

	if (Generation.BaseHeight - Generation.NoiseAmplitude - Generation.DetailAmplitude < 1.0f)
	{
		Report(TEXT("Terrain can dip to or below z=0; valleys would be clamped to the world floor."));
	}

	if (Streaming.UnloadDistanceInChunks <= Streaming.PreloadDistanceInChunks)
	{
		Report(TEXT("UnloadDistanceInChunks must exceed PreloadDistanceInChunks or chunks will load and unload in a loop."));
	}

	if (Streaming.PreloadDistanceInChunks < Streaming.ViewDistanceInChunks)
	{
		Report(TEXT("PreloadDistanceInChunks should be at least ViewDistanceInChunks; visible chunks would arrive ungenerated."));
	}

	if (Streaming.ViewDistanceInChunks > Streaming.UnloadDistanceInChunks)
	{
		Report(TEXT("ViewDistanceInChunks exceeds UnloadDistanceInChunks; chunks would be drawn after being released."));
	}

	if (LowDetailLODDistanceInChunks < SimplifiedLODDistanceInChunks)
	{
		Report(TEXT("LowDetailLODDistanceInChunks should not be nearer than SimplifiedLODDistanceInChunks."));
	}

	const int32 Diameter = 2 * Streaming.ViewDistanceInChunks + 1;
	const int32 VisibleChunks = Diameter * Diameter;
	if (VisibleChunks > Streaming.MaxResidentChunks)
	{
		Report(TEXT("MaxResidentChunks is smaller than the visible set; chunks at the edge of view would never load."));
	}

	if (Mesher.MaxVerticesPerSection < 256)
	{
		Report(TEXT("MaxVerticesPerSection is below 256; sections would split constantly."));
	}

	return Problems;
}
