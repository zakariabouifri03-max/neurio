// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

using UnrealBuildTool;
using System.Collections.Generic;

public class BlockCityUltraEditorTarget : TargetRules
{
	public BlockCityUltraEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;
		DefaultBuildSettings = BuildSettingsVersion.V5;
		IncludeOrderVersion = EngineIncludeOrderVersion.Unreal5_5;

		ExtraModuleNames.AddRange(new string[]
		{
			"BlockCityUltra",
			"BlockCityUltraEditor"
		});

		bOverrideBuildEnvironment = true;

		GlobalDefinitions.Add("BCU_ASYNC_CITY_GEN=1");
		GlobalDefinitions.Add("BCU_MAX_ASYNC_BUILD_THREADS=6");

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

		GlobalDefinitions.Add("BCU_WITH_EDITOR_TOOLS=1");
		GlobalDefinitions.Add("BCU_SHIPPING_TELEMETRY=1");
	}
}
