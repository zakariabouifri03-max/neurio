// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

using UnrealBuildTool;
using System.Collections.Generic;

public class BlockCityUltraTarget : TargetRules
{
	public BlockCityUltraTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;
		DefaultBuildSettings = BuildSettingsVersion.V5;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_5;

		ExtraModuleNames.AddRange(new string[]
		{
			"BlockCityUltra"
		});

		// ── Open-world scale: this project streams millions of voxel instances ──
		// 16 GB machines run Balanced/Performance; 32 GB runs Quality/Ultra.
		bUseLoggingInShipping = false;
		bUseChecksInShipping = false;
		bAllowGeneratedIniWhenCooked = true;
		bOverrideBuildEnvironment = true;

		// Multicore CPU friendliness: async city generation on worker threads.
		GlobalDefinitions.Add("BCU_ASYNC_CITY_GEN=1");
		GlobalDefinitions.Add("BCU_MAX_ASYNC_BUILD_THREADS=6");

		// Windows: enable the hardware ray tracing + Mesh Shader code paths.
		if (Target.Platform == UnrealTargetPlatform.Win64)
		{
			GlobalDefinitions.Add("BCU_SUPPORTS_HWRT=1");
			GlobalDefinitions.Add("BCU_SUPPORTS_MESH_SHADERS=1");
			WindowsPlatform.bEnableRayTracing = true;
		}
		else
		{
			GlobalDefinitions.Add("BCU_SUPPORTS_HWRT=0");
			GlobalDefinitions.Add("BCU_SUPPORTS_MESH_SHADERS=0");
		}

		// Shipping: deterministic frame pacing so the 30/60/90/120/144 targets
		// chosen in the video options actually hold.
		if (Target.Configuration == UnrealTargetConfiguration.Shipping)
		{
			GlobalDefinitions.Add("BCU_SHIPPING_TELEMETRY=0");
		}
		else
		{
			GlobalDefinitions.Add("BCU_SHIPPING_TELEMETRY=1");
		}

		// Nanite + Lumen are mandatory for the Ultra art direction.
		GlobalDefinitions.Add("BCU_REQUIRE_NANITE=1");
		GlobalDefinitions.Add("BCU_REQUIRE_LUMEN=1");

		// 128-bit build identity for save-file validation.
		BuildVersion = "0.9.0";
		LaunchModuleName = "BlockCityUltra";
	}
}
