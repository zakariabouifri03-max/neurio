// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
// All districts, vehicles, characters, missions and dialogue are original works.

using UnrealBuildTool;

public class BlockCityUltra : ModuleRules
{
	public BlockCityUltra(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = ModuleRules.PCHUsageMode.UseExplicitOrSharedPCHs;
		bUseUnity = true;                 // ~35% faster cold builds on 8-core CPUs
		PrivatePCHHeaderFile = "Private/BlockCityUltraPCH.h";
		bEnableExceptions = false;
		ShadowVariableWarningLevel = WarningLevel.Error;
		DefaultWarningLevel = WarningLevel.Error;
		bTreatAsEngineModule = false;

		PublicIncludePaths.AddRange(new string[]
		{
			"BlockCityUltra/Public"
		});

		PrivateIncludePaths.AddRange(new string[]
		{
			"BlockCityUltra/Private"
		});

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"EnhancedInput",
			"InputCore",
			"GameplayTags",
			"Niagara",
			"ChaosVehicles",
			"PhysicsCore",
			"AIModule",
			"NavigationSystem",
			"UMG",
			"Slate",
			"SlateCore",
			"RenderCore",
			"RHI",
			"ApplicationCore",
			"GameplayTasks",
			"MassEntity",
			"MassCommon",
			"MassAIBehavior",
			"MassMovement",
			"MassLOD",
			"MassSpawner",
			"DeveloperSettings"
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"Json",
			"JsonUtilities",
			"Projects",           // IPluginManager — runtime DLSS detection
			"HeadMountedDisplay",
			"SignalProcessing",
			"AudioMixer",
			"MoviePlayer",
			"NetCore",
			"Sockets",
			"HTTP",
			"EngineSettings",
			"GeometryCore",
			"DynamicMesh",
			"MeshDescription",
			"StaticMeshDescription",
			"GeometryFramework",
			"Landscape",
			"Foliage",
			"LevelSequence",
			"Water",
			"PropertyPath",
			"AnalyticsET"
		});

		DynamicallyLoadedModuleNames.AddRange(new string[]
		{
			"Renderer"
		});

		// NVIDIA DLSS is optional and license-gated: the plugin is *never* hard
		// linked. UBCUGraphicsSubsystem probes for it at runtime through
		// IPluginManager + console variables, and gracefully falls back to TSR
		// with dynamic resolution. This keeps the project buildable for anyone
		// who has not (or may not legally) install the DLSS plugin.
		if (Target.Platform == UnrealTargetPlatform.Win64)
		{
			PrivateDefinitions.Add("BCU_WITH_OPTIONAL_DLSS=1");
			PublicDefinitions.Add("BCU_TARGET_PLATFORM_WINDOWS=1");
		}
		else
		{
			PrivateDefinitions.Add("BCU_WITH_OPTIONAL_DLSS=0");
		}

		PublicDefinitions.Add("BCU_VOXEL_SCALE_DEFAULT=25");
		PublicDefinitions.Add("BCU_MAX_VOXEL_MATERIALS=64");

		if (Target.bBuildEditor)
		{
			PrivateDependencyModuleNames.AddRange(new string[]
			{
				"UnrealEd",
				"EditorScriptingUtilities",
				"AssetTools",
				"AssetRegistry",
				"LevelEditor",
				"ToolMenus",
				"WorldPartitionEditor"
			});
		}

		// Shipping builds strip every profiling hook we expose.
		if (Target.Configuration != UnrealTargetConfiguration.DebugGame &&
			Target.Configuration != UnrealTargetConfiguration.Development)
		{
			PublicDefinitions.Add("BCU_WITH_PROFILING=0");
		}
		else
		{
			PublicDefinitions.Add("BCU_WITH_PROFILING=1");
		}
	}
}
