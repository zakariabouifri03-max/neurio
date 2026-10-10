// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "BlockCityUltra.h"

#include "Core/BCUCore.h"
#include "HAL/IConsoleManager.h"
#include "Misc/CoreDelegates.h"

DEFINE_LOG_CATEGORY(LogBCU);

namespace BCUConsole
{
	// ── Quality presets (bound to Alt+1..4 in DefaultInput.ini) ─────────────
	static void ApplyPresetByName(const FString& PresetName)
	{
		UE_LOG(LogBCU, Log, TEXT("Applying graphics preset '%s'"), *PresetName);
		// The graphics subsystem owns the actual cvar set; this is the console
		// path so it works from a shipping build's debug console too.
		static IConsoleVariable* CVar = IConsoleManager::Get().FindConsoleVariable(TEXT("bcu.gfx.Preset"));
		if (CVar) { CVar->Set(*PresetName, ECVF_SetByConsole); }
	}

	static FAutoConsoleCommand PresetPerformance(TEXT("bcu.preset.performance"),
		TEXT("Switch to the Performance preset (RTX 5060-class target: 60 fps at 1080p)."),
		FConsoleCommandDelegate::CreateStatic([]() { ApplyPresetByName(TEXT("Performance")); }));

	static FAutoConsoleCommand PresetBalanced(TEXT("bcu.preset.balanced"),
		TEXT("Switch to the Balanced preset."),
		FConsoleCommandDelegate::CreateStatic([]() { ApplyPresetByName(TEXT("Balanced")); }));

	static FAutoConsoleCommand PresetQuality(TEXT("bcu.preset.quality"),
		TEXT("Switch to the Quality preset."),
		FConsoleCommandDelegate::CreateStatic([]() { ApplyPresetByName(TEXT("Quality")); }));

	static FAutoConsoleCommand PresetUltra(TEXT("bcu.preset.ultra"),
		TEXT("Switch to the Ultra preset (full RT, 4K target)."),
		FConsoleCommandDelegate::CreateStatic([]() { ApplyPresetByName(TEXT("Ultra")); }));

	// ── Benchmark ───────────────────────────────────────────────────────────
	static FAutoConsoleCommand Benchmark(TEXT("bcu.benchmark"),
		TEXT("Run the 6-second graphics benchmark and print the result."),
		FConsoleCommandDelegate::CreateStatic([]()
		{
			IConsoleManager::Get().ProcessUserConsoleInput(
				const_cast<TCHAR*>(TEXT("bcu.benchmark.start")), GLog, nullptr);
		}));

	// ── City / streaming debug ──────────────────────────────────────────────
	static TAutoConsoleVariable<int32> CVarCityQuality(TEXT("bcu.city.Quality"), 2,
		TEXT("City detail tier. 0=Performance, 1=Balanced, 2=Quality, 3=Ultra.\n")
		TEXT("Drives load radius, voxel LOD bias and prop density."),
		ECVF_Scalability | ECVF_RenderThreadSafe);

	static TAutoConsoleVariable<int32> CVarCityLoadRadius(TEXT("bcu.city.LoadRadiusCells"), 5,
		TEXT("Number of 256 m city cells kept resident around the player."),
		ECVF_Scalability);

	static TAutoConsoleVariable<int32> CVarCityMeshLODBias(TEXT("bcu.city.MeshLODBias"), 0,
		TEXT("Extra unload radius in cells on top of the load radius."),
		ECVF_Scalability);

	static TAutoConsoleVariable<int32> CVarCityPerFrame(TEXT("bcu.city.MaxCellsLoadedPerFrame"), 2,
		TEXT("Maximum city cells generated per frame (hitch budget)."),
		ECVF_Scalability);

	static TAutoConsoleVariable<int32> CVarCityHLOD(TEXT("bcu.city.HLODOnlyDistanceCm"), 230400,
		TEXT("Distance beyond which only the merged HLOD proxy is drawn."),
		ECVF_Scalability);

	static TAutoConsoleVariable<int32> CVarCityInterior(TEXT("bcu.city.InteriorStreaming"), 1,
		TEXT("1 = stream building interiors, 0 = never generate or stream them."),
		ECVF_Scalability);

	static TAutoConsoleVariable<int32> CVarVoxelQuality(TEXT("bcu.voxel.Quality"), 2,
		TEXT("Voxel tier: 0=coarse (fewer voxels, no interiors), 3=full detail + AO."),
		ECVF_Scalability);

	// ── Traffic / pedestrians ───────────────────────────────────────────────
	static TAutoConsoleVariable<int32> CVarTrafficQuality(TEXT("bcu.traffic.Quality"), 2,
		TEXT("Traffic + pedestrian density tier, 0..3."), ECVF_Scalability);

	static TAutoConsoleVariable<int32> CVarTrafficMax(TEXT("bcu.traffic.MaxActiveVehicles"), 120,
		TEXT("Hard cap on simultaneously simulated traffic vehicles."), ECVF_Scalability);

	static TAutoConsoleVariable<float> CVarTrafficLOD(TEXT("bcu.traffic.SimulationLODFarCm"), 90000.0f,
		TEXT("Distance at which traffic drops to the 3 Hz kinematic tier."), ECVF_Scalability);

	static TAutoConsoleVariable<float> CVarTrafficSpawn(TEXT("bcu.traffic.SpawnRadiusCm"), 140000.0f,
		TEXT("Radius in which traffic is allowed to spawn."), ECVF_Scalability);

	static TAutoConsoleVariable<int32> CVarTrafficPeds(TEXT("bcu.traffic.MaxActivePedestrians"), 220,
		TEXT("Hard cap on simulated pedestrians (near + far tiers)."), ECVF_Scalability);

	// ── Weather ─────────────────────────────────────────────────────────────
	static TAutoConsoleVariable<int32> CVarWeatherQuality(TEXT("bcu.weather.Quality"), 2,
		TEXT("Weather tier: 0=no rain FX, 1=rain only, 2=rain+puddles, 3=+volumetric fog."),
		ECVF_Scalability);

	static TAutoConsoleVariable<float> CVarWetness(TEXT("bcu.weather.WetnessOverride"), -1.0f,
		TEXT("Forces surface wetness (0..1). -1 = let the weather system drive it."),
		ECVF_Cheat);

	// ── Ray tracing (hardware-dependent, probed at runtime) ─────────────────
	static TAutoConsoleVariable<int32> CVarRayTracing(TEXT("bcu.raytracing.Mode"), 0,
		TEXT("0=off, 1=reflections, 2=reflections+shadows, 3=full (GI + translucency).")
		TEXT(" Ignored when the GPU does not support hardware ray tracing."),
		ECVF_Scalability | ECVF_ReadOnly);

	// ── Upscaler (DLSS is optional and never hard-linked) ───────────────────
	static TAutoConsoleVariable<int32> CVarUpscaler(TEXT("bcu.upscaler.Mode"), 0,
		TEXT("0=TSR, 1=DLSS SR, 2=DLSS SR + Frame Generation, 3=off.")
		TEXT(" Falls back to TSR when DLSS is not installed or not licensed."),
		ECVF_Scalability);

	// ── Profiling ───────────────────────────────────────────────────────────
	static FAutoConsoleCommand DumpPerf(TEXT("bcu.dump.perf"),
		TEXT("Dump a full performance report (CPU/GPU/memory/draw calls/streaming) to the log."),
		FConsoleCommandDelegate::CreateStatic([]()
		{
			const TCHAR* Commands[] =
			{
				TEXT("stat unit"), TEXT("stat scenerendering"), TEXT("stat streaming"),
				TEXT("stat memory"), TEXT("stat gpu"), TEXT("stat rhi"),
				TEXT("bcu.city.stat"), TEXT("bcu.traffic.stat"), TEXT("bcu.police.stat")
			};

			for (const TCHAR* Command : Commands)
			{
				IConsoleManager::Get().ProcessUserConsoleInput(
					const_cast<TCHAR*>(Command), GLog, nullptr);
			}

			UE_LOG(LogBCU, Log, TEXT("Performance report written to the log."));
		}));
}

void FBlockCityUltraModule::StartupModule()
{
	UE_LOG(LogBCU, Log, TEXT("BLOCK CITY ULTRA runtime module started (v0.9.0-slice)."));
	UE_LOG(LogBCU, Log, TEXT("All content, names, maps, vehicles, characters and dialogue are original."));
}

void FBlockCityUltraModule::ShutdownModule()
{
	UE_LOG(LogBCU, Log, TEXT("BLOCK CITY ULTRA runtime module shut down."));
}

IMPLEMENT_PRIMARY_GAME_MODULE(FBlockCityUltraModule, BlockCityUltra, "BlockCityUltra");
