// Copyright GameProject. All rights reserved. Original content only.

using UnrealBuildTool;
using System.Collections.Generic;

/// <summary>
/// Shipping/Test/Development *game* target. Contains only the runtime module:
/// every editor-only tool is isolated in ProjectCoreEditor and is never linked here.
/// </summary>
public class ProjectCoreTarget : TargetRules
{
	public ProjectCoreTarget(TargetInfo Target) : base(Target)
	{
		Type = TargetType.Game;

		// UE5.5+ build settings. If you must build on 5.3/5.4, change V5 -> V4.
		DefaultBuildSettings = BuildSettingsVersion.V5;
		IncludeOrderVersion = EngineIncludeOrderVersion.Latest;

		ExtraModuleNames.AddRange(new string[] { "ProjectCore" });

		// A huge streamed world benefits from faster cook/load paths and no editor-only data.
		bUseLoggingInShipping = false;
		bUseChecksInShipping = false;
	}
}
