// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "Vehicle/BCUVehicleDefinition.h"
#include "World/Voxel/BCUVoxelTypes.h"
#include "BCUVehicleSubsystem.generated.h"

class ABCUBaseVehicle;
class UBCUVehicleVoxelBuilder;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnBCUGarageChanged, const TArray<FName>&, OwnedVehicleIds);

/**
 * Vehicle registry + garage + customisation authority.
 *
 * Owns the list of every UBCUVehicleDefinition in the project (discovered via
 * the Asset Manager primary-asset type "BCUVehicle"), the player's owned
 * vehicles, and the cached generated meshes so two identical cars do not each
 * pay for a mesh build.
 */
UCLASS(config = Game, Blueprintable)
class BLOCKCITYULTRA_API UBCUVehicleSubsystem : public UWorldSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	/** Refreshes the vehicle catalogue from the Asset Manager. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicles")
	void RefreshCatalogue();

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicles")
	UBCUVehicleDefinition* FindVehicle(FName VehicleId) const;

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicles")
	const TArray<UBCUVehicleDefinition*>& GetCatalogue() const { return Catalogue; }

	/** Vehicles filtered by class — used by the dealership UI. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicles")
	TArray<UBCUVehicleDefinition*> GetVehiclesOfClass(EBCUVehicleClass Class) const;

	/** District-appropriate traffic pick (trucks at the port, luxes uptown). */
	UBCUVehicleDefinition* PickTrafficVehicleForCell(const FBCUCellCoord& Cell) const;

	// ── Garage / ownership ──────────────────────────────────────────────────
	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicles|Garage")
	void GrantVehicle(FName VehicleId);

	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicles|Garage")
	bool RemoveVehicle(FName VehicleId);

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicles|Garage")
	bool OwnsVehicle(FName VehicleId) const { return OwnedVehicles.Contains(VehicleId); }

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicles|Garage")
	const TArray<FName>& GetOwnedVehicles() const { return OwnedVehicles; }

	/** Spawns an owned vehicle at a location (garage " summon"). */
	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicles|Garage")
	ABCUBaseVehicle* SpawnOwnedVehicle(FName VehicleId, const FVector& Location, const FRotator& Rotation);

	/** Nearest parked player-owned car to a point. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicles|Garage")
	ABCUBaseVehicle* FindNearestOwnedVehicle(const FVector& Location, float MaxDistanceCm) const;

	UPROPERTY(BlueprintAssignable, Category = "BCU|Vehicles|Garage")
	FOnBCUGarageChanged OnGarageChanged;

	// ── Customisation ───────────────────────────────────────────────────────
	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicles|Customisation")
	void SetVehiclePaint(ABCUBaseVehicle* Vehicle, const FLinearColor& Color);

	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicles|Customisation")
	void SetVehicleUpgrades(ABCUBaseVehicle* Vehicle, int32 EngineLevel, int32 HandlingLevel, int32 BrakeLevel);

	/** Cost of a customisation operation (read from DT_CustomisationCosts). */
	UFUNCTION(BlueprintPure, Category = "BCU|Vehicles|Customisation")
	int32 GetCustomisationCost(FName CategoryId, int32 Level) const;

	// ── Mesh cache ──────────────────────────────────────────────────────────
	/** Returns a cached generated mesh for (definition, paint, wheels). */
	UStaticMesh* GetCachedVehicleMesh(UBCUVehicleDefinition* Definition,
		const FLinearColor& Paint, FName WheelStyle);

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicles|Debug")
	FString GetVehicleStats() const;

	/** Called by the controller when the player gets into a car. */
	void OnPlayerEnteredVehicle(ABCUBaseVehicle* Vehicle, int32 SeatIndex);

protected:
	UPROPERTY(Transient)
	TArray<TObjectPtr<UBCUVehicleDefinition>> Catalogue;

	UPROPERTY(SaveGame, BlueprintReadOnly, Category = "BCU|Vehicles")
	TArray<FName> OwnedVehicles;

	UPROPERTY(Transient)
	TArray<TObjectPtr<ABCUBaseVehicle>> SpawnedOwnedVehicles;

	/** (DefinitionName|PaintHex|WheelStyle) → generated mesh. */
	TMap<FString, TObjectPtr<UStaticMesh>> MeshCache;
};
