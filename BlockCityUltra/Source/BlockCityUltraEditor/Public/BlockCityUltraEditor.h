// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "Modules/ModuleManager.h"

/**
 * Editor-side module: city generation tools, voxel painting, HLOD build
 * helpers and the district inspector. Nothing here ships in a packaged build.
 */
class FBlockCityUltraEditorModule : public IModuleInterface
{
public:
	virtual void StartupModule() override;
	virtual void ShutdownModule() override;

	/** Registers the "BLOCK CITY ULTRA" editor toolbar menu. */
	void RegisterMenus();
	void UnregisterMenus();

private:
	FDelegateHandle OnPostEngineInitHandle;
	void OnPostEngineInit();

	/** Spawns a BCUCityStreamer + BCUCityGenerator for the active world. */
	void SpawnCityStreamer();
	/** Rebuilds every loaded voxel cell on the async workers. */
	void RebuildAllCells();
	/** Bakes the current World Partition HLOD layers. */
	void BuildHLODs();
	/** Runs the full CPU/GPU/memory/streaming profiling suite. */
	void RunPerformanceReport();

	TSharedPtr<class FUICommandList> CommandList;
};
