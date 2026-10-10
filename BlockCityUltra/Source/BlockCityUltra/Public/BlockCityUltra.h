// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "Modules/ModuleManager.h"

/**
 * BLOCK CITY ULTRA — runtime module.
 *
 * Original open-world crime-simulator with a voxel-inspired visual identity:
 * the geometry really is cubic, the lighting really is Lumen, and nothing here
 * reproduces any real or copyrighted city, vehicle, character or asset.
 */
class FBlockCityUltraModule : public IModuleInterface
{
public:
	virtual void StartupModule() override;
	virtual void ShutdownModule() override;
};
