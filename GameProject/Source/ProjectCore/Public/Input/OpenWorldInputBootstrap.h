// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "Input/OpenWorldInputConfig.h"
#include "InputActionValue.h"

class UInputAction;
class UInputMappingContext;

/**
 * Builds a complete, working Enhanced Input setup purely in C++.
 *
 * Why this exists: a fresh clone of this repository contains no binary .uasset
 * files, so there would be nothing for a player controller to bind to. Rather
 * than ship a project that is broken until someone hand-authors assets, the
 * input layer is synthesised at runtime from exactly the same definitions the
 * editor bootstrap script (Tools/EditorScripts/bootstrap_project.py) uses to
 * author the real IA_* / IMC_Player assets.
 *
 * As soon as those assets exist they win automatically - see
 * UOpenWorldInputConfig::ResolveAssets - and this path is never taken again.
 *
 * Everything created here is outered to the config object, so garbage collection
 * keeps it alive for exactly as long as the config is referenced.
 */
class PROJECTCORE_API FOpenWorldInputBootstrap
{
public:
	/**
	 * @param Config			Receives the synthesised contexts and actions.
	 * @param bIncludeGamepad	Also builds a dead-zoned gamepad context.
	 */
	static void Populate(UOpenWorldInputConfig& Config, bool bIncludeGamepad);

private:
	static UInputAction* CreateAction(UObject& Outer, const TCHAR* AssetName, EInputActionValueType ValueType);
	static UInputMappingContext* CreateMappingContext(UObject& Outer, const TCHAR* AssetName);
	static UInputMappingContext* BuildKeyboardMouse(UObject& Outer, const TMap<EGameProjectInputAction, TObjectPtr<UInputAction>>& Actions);
	static UInputMappingContext* BuildGamepad(UObject& Outer, const TMap<EGameProjectInputAction, TObjectPtr<UInputAction>>& Actions);
};
