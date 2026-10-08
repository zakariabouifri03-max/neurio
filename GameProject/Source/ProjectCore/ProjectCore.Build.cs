// Copyright GameProject. All rights reserved. Original content only.

using UnrealBuildTool;

public class ProjectCore : ModuleRules
{
	public ProjectCore(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		bUseUnity = true;

		// Kept deliberately small: every additional public dependency is inherited by
		// every future system, which is how projects end up with 40-minute builds.
		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"InputCore",
			"EnhancedInput",
			"GameplayTags",
			"UMG",
			"DeveloperSettings"
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"NavigationSystem",
			"Projects"
		});

		// Debug tooling is compiled out of Shipping/Test builds entirely.
		if (Target.Configuration == UnrealTargetConfiguration.Shipping ||
		    Target.Configuration == UnrealTargetConfiguration.Test)
		{
			PublicDefinitions.Add("GAMEPROJECT_DEBUG_TOOLS=0");
		}
		else
		{
			PublicDefinitions.Add("GAMEPROJECT_DEBUG_TOOLS=1");
		}
	}
}
