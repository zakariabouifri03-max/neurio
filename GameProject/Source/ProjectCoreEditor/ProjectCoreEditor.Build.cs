// Copyright GameProject. All rights reserved. Original content only.

using UnrealBuildTool;

public class ProjectCoreEditor : ModuleRules
{
	public ProjectCoreEditor(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

		PublicDependencyModuleNames.AddRange(new string[]
		{
			"Core",
			"CoreUObject",
			"Engine",
			"ProjectCore"
		});

		PrivateDependencyModuleNames.AddRange(new string[]
		{
			"UnrealEd",
			"AssetTools",
			"AssetRegistry",
			"Slate",
			"SlateCore",
			"InputCore",
			"EnhancedInput",
			"Json",
			"JsonUtilities",
			"Projects"
		});
	}
}
