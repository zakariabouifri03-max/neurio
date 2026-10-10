// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Core/BCUWorldSettings.h"

#include "World/City/BCUCityStreamer.h"
#include "World/Voxel/BCUVoxelTypes.h"

ABCUWorldSettings::ABCUWorldSettings()
{
	// Every BCU map is procedurally generated at runtime, so the level itself is
	// empty except for the sky actors and the streamer.
	bEnableWorldBoundsChecks = false;
	DefaultGameMode = nullptr; // resolved from DefaultEngine.ini

	CitySeed.Seed = 20260710;
	CitySeed.Density = 0.62f;
	CitySeed.Verticality = 0.7f;
	CitySeed.Nature = 0.35f;

	RegionExtentCells = FIntPoint(96, 96);
	bIsVerticalSlice = true;
	bRegenerateCityOnPlay = true;
}
