// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

using UnrealBuildTool;

public class BlockCityUltraEditor : ModuleRules
{
	public BlockCityUltraEditor(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = ModuleRules.PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"BlockCityUltra"
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"UnrealEd",
			"Slate",
			"SlateCore",
			"InputCore",
			"EditorFramework",
			"EditorSubsystem",
			"ToolMenus",
			"AssetTools",
			"AssetRegistry",
			"LevelEditor",
			"Projects",
			"WorldPartitionEditor",
			"Json",
			"JsonUtilities"
		});
	}
}
