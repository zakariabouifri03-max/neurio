// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/WorldSettings.h"
#include "World/Voxel/BCUVoxelTypes.h"
#include "BCUWorldSettings.generated.h"

class UBCUVoxelMaterialSet;
class UBCUDistrictDataAsset;

/**
 * Per-map settings for a BLOCK CITY ULTRA world: the city seed, the material
 * set, the district table and the streaming parameters. Living on WorldSettings
 * means a level carries its own city identity with no extra actor to place.
 */
UCLASS(Blueprintable)
class BLOCKCITYULTRA_API ABCUWorldSettings : public AWorldSettings
{
	GENERATED_BODY()

public:
	ABCUWorldSettings();

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|World")
	FBCUCitySeed CitySeed;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|World")
	TObjectPtr<UBCUVoxelMaterialSet> VoxelMaterialSet;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|World")
	TArray<TObjectPtr<UBCUDistrictDataAsset>> Districts;

	/** True for the vertical-slice map (one district, benchmark lighting). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|World")
	bool bIsVerticalSlice = true;

	/** Region extent in cells for the full map. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|World")
	FIntPoint RegionExtentCells = FIntPoint(96, 96);

	/** Design-time only: regenerate every resident cell on Play. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|World")
	bool bRegenerateCityOnPlay = true;
};
