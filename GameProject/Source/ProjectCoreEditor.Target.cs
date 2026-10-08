// Copyright GameProject. All rights reserved. Original content only.

using UnrealBuildTool;
using System.Collections.Generic;

/// <summary>
/// Editor target. Adds the runtime module (editor tools depend on it) plus the
/// editor-only module that owns project bootstrap / asset authoring utilities.
/// </summary>
public class ProjectCoreEditorTarget : TargetRules
{
	public ProjectCoreEditorTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Editor;

		DefaultBuildSettings = BuildSettingsVersion.V5;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;

		ExtraModuleNames.AddRange(new string[] { "ProjectCore", "ProjectCoreEditor" });
	}
}
