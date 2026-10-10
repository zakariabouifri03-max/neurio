// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "World/Voxel/BCUVoxelMesher.h"
#include "World/Voxel/BCUVoxelTypes.h"
#include "BCUCellActor.generated.h"

class UStaticMeshComponent;
class UHierarchicalInstancedStaticMeshComponent;
class UBCUDistrictDataAsset;
enum class EBCUCityDebugMode : uint8;

/**
 * The actor that carries one resident city cell.
 *
 * Four mesh components (opaque / masked / translucent / emissive) so each can
 * use the right rendering path: opaque is Nanite, the others are not. A HISM
 * holds every repeated prop in the cell as instances.
 */
UCLASS(Blueprintable, meta = (DisplayName = "BCU Cell"))
class BLOCKCITYULTRA_API ABCUCellActor : public AActor
{
	GENERATED_BODY()

public:
	ABCUCellActor();

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Cell")
	TObjectPtr<UStaticMeshComponent> OpaqueMesh;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Cell")
	TObjectPtr<UStaticMeshComponent> MaskedMesh;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Cell")
	TObjectPtr<UStaticMeshComponent> TranslucentMesh;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Cell")
	TObjectPtr<UStaticMeshComponent> EmissiveMesh;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Cell")
	TObjectPtr<UHierarchicalInstancedStaticMeshComponent> PropInstances;

	/** Merged low-detail proxy shown beyond the HLOD distance. */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Cell")
	TObjectPtr<UStaticMeshComponent> HLODMesh;

	UFUNCTION(BlueprintCallable, Category = "BCU|Cell")
	void SetSectionMesh(EBCUMeshSection Section, UStaticMesh* Mesh, const FVector& WorldOrigin, bool bEnableNanite);

	UFUNCTION(BlueprintCallable, Category = "BCU|Cell")
	void SetCellCoord(const FBCUCellCoord& InCoord) { Coord = InCoord; }

	UFUNCTION(BlueprintPure, Category = "BCU|Cell")
	FBCUCellCoord GetCellCoord() const { return Coord; }

	UFUNCTION(BlueprintCallable, Category = "BCU|Cell")
	void SetDistrict(UBCUDistrictDataAsset* InDistrict) { District = InDistrict; }

	UFUNCTION(BlueprintCallable, Category = "BCU|Cell")
	void SetNaniteEnabled(bool bEnabled);

	UFUNCTION(BlueprintCallable, Category = "BCU|Cell")
	void SetDistanceFieldOcclusion(bool bEnabled);

	UFUNCTION(BlueprintCallable, Category = "BCU|Cell")
	void SetCellResident(bool bResident);

	UFUNCTION(BlueprintCallable, Category = "BCU|Cell")
	void SetHLODVisible(bool bVisible);

	UFUNCTION(BlueprintCallable, Category = "BCU|Cell")
	void SetFullDetailVisible(bool bVisible);

	UFUNCTION(BlueprintCallable, Category = "BCU|Cell")
	void SetDebugMode(EBCUCityDebugMode Mode);

	UFUNCTION(BlueprintCallable, Category = "BCU|Cell")
	void DestroyCell();

	UFUNCTION(BlueprintPure, Category = "BCU|Cell")
	int32 GetTriangleCount() const;

	UHierarchicalInstancedStaticMeshComponent* GetPropInstances() const { return PropInstances; }

protected:
	UPROPERTY(Transient)
	FBCUCellCoord Coord;

	UPROPERTY(Transient)
	TObjectPtr<UBCUDistrictDataAsset> District;

	UStaticMeshComponent* ComponentForSection(EBCUMeshSection Section) const;
};
