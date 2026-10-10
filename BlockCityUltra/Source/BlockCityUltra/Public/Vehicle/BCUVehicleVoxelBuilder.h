// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "Vehicle/BCUVehicleDefinition.h"
#include "BCUVehicleVoxelBuilder.generated.h"

class UStaticMesh;
class UWorld;

/**
 * Builds a vehicle body out of voxels.
 *
 * The silhouette comes from a parametric recipe keyed on BodyStyle: a sedan is
 * a three-box profile, a supercar is a low wedge with a rear diffuser, a truck
 * is a cab plus a box, a bus is one long box with a glazed band. Every recipe
 * is original geometry — nothing here reproduces a real or copyrighted car.
 *
 * Output is a merged static mesh (one per material section) so a whole car is
 * ~4 draw calls, not ~2000 cubes.
 */
UCLASS(BlueprintType)
class BLOCKCITYULTRA_API UBCUVehicleVoxelBuilder : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/** Builds (or returns a cached) mesh for a definition + paint + wheels. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|Voxel")
	static UStaticMesh* BuildVehicleMesh(UWorld* World, UBCUVehicleDefinition* Definition,
		const FLinearColor& PaintColor, FName WheelStyle);

	/** Carves the body shell into a grid (used by the editor preview). */
	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|Voxel")
	static void CarveBody(class UBCUVoxelGrid* Grid, UBCUVehicleDefinition* Definition);

	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|Voxel")
	static void CarveGreenhouse(class UBCUVoxelGrid* Grid, UBCUVehicleDefinition* Definition);

	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|Voxel")
	static void CarveWheels(class UBCUVoxelGrid* Grid, UBCUVehicleDefinition* Definition, FName WheelStyle);

	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|Voxel")
	static void CarveInterior(class UBCUVoxelGrid* Grid, UBCUVehicleDefinition* Definition);

	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|Voxel")
	static void CarveLights(class UBCUVoxelGrid* Grid, UBCUVehicleDefinition* Definition);

	/** Detail level: 0 = low (traffic), 1 = medium, 2 = high (player car). */
	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|Voxel")
	static void CarveDetailTrim(class UBCUVoxelGrid* Grid, UBCUVehicleDefinition* Definition, int32 DetailLevel);

	/** Original silhouette recipes keyed by BodyStyle. */
	static void GetProfileForStyle(FName BodyStyle, TArray<float>& OutRoofLine, TArray<float>& OutBeltLine,
		float& OutFrontOverhang, float& OutRearOverhang);
};
