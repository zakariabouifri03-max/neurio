// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "Logging/LogMacros.h"

/**
 * One log category per subsystem. Keeping them separate means a designer can
 * run with `Log LogVoxel Warning` (or use the console filter) instead of the
 * whole game shouting at once. Verbosity defaults are deliberately quiet:
 * these systems run every frame in a streamed world and must not spam.
 */
PROJECTCORE_API DECLARE_LOG_CATEGORY_EXTERN(LogGameCore, Log, All);
PROJECTCORE_API DECLARE_LOG_CATEGORY_EXTERN(LogPlayer, Log, All);
PROJECTCORE_API DECLARE_LOG_CATEGORY_EXTERN(LogWorld, Log, All);
PROJECTCORE_API DECLARE_LOG_CATEGORY_EXTERN(LogVoxel, Log, All);
PROJECTCORE_API DECLARE_LOG_CATEGORY_EXTERN(LogInteraction, Log, All);
PROJECTCORE_API DECLARE_LOG_CATEGORY_EXTERN(LogSave, Log, All);
PROJECTCORE_API DECLARE_LOG_CATEGORY_EXTERN(LogGameProjectInput, Log, All);
PROJECTCORE_API DECLARE_LOG_CATEGORY_EXTERN(LogGameProjectUI, Log, All);
PROJECTCORE_API DECLARE_LOG_CATEGORY_EXTERN(LogGameProjectSettings, Log, All);
PROJECTCORE_API DECLARE_LOG_CATEGORY_EXTERN(LogGameProjectDebug, Log, All);

/** Fatal-ish channel used by the save system and asset resolution. */
PROJECTCORE_API DECLARE_LOG_CATEGORY_EXTERN(LogGameProjectError, Error, All);
