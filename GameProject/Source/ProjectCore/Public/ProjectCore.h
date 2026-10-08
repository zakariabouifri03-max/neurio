// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "Modules/ModuleManager.h"

/**
 * Debug tooling switch. Driven by ProjectCore.Build.cs from the target
 * configuration so debug code cannot survive into Shipping/Test even if a
 * `#if !UE_BUILD_SHIPPING` is forgotten somewhere.
 */
#ifndef GAMEPROJECT_DEBUG_TOOLS
	#define GAMEPROJECT_DEBUG_TOOLS (!(UE_BUILD_SHIPPING || UE_BUILD_TEST))
#endif

/** True only in builds where debug/cheat tooling is allowed to exist. */
#define GAMEPROJECT_WITH_DEBUG_TOOLS (GAMEPROJECT_DEBUG_TOOLS && !UE_BUILD_SHIPPING && !UE_BUILD_TEST)

/** Project-wide constants that are genuinely constant (not designer tunables). */
namespace GameProject
{
	/** Current on-disk save layout. Bump only with a matching migration step. */
	constexpr int32 SaveGameVersion = 1;

	/** Oldest save version this build can still read. */
	constexpr int32 SaveGameMinSupportedVersion = 1;

	/** Reserved block id meaning "air / no block". */
	constexpr uint16 EmptyBlockId = 0;

	/** Priority used when registering the player IMC. Leaves room above/below. */
	constexpr int32 PlayerInputMappingPriority = 10;

	// Engine meshes that are guaranteed to exist in every UE5 install. Used only by
	// placeholder visuals so the project is playable before any art is authored.
	inline constexpr TCHAR FallbackCubeMeshPath[] = TEXT("/Engine/BasicShapes/Cube.Cube");
	inline constexpr TCHAR FallbackPlaneMeshPath[] = TEXT("/Engine/BasicShapes/Plane.Plane");
	inline constexpr TCHAR FallbackMaterialPath[] = TEXT("/Engine/BasicShapes/BasicShapeMaterial.BasicShapeMaterial");
}
