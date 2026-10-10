// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "World/City/BCUCityGenerator.h"
#include "BCUDistrictDataAsset.generated.h"

class UMaterialInterface;
class USoundBase;
class UTexture2D;

/** Weighted style pick used by the building generator. */
USTRUCT(BlueprintType)
struct FBCUStyleWeight
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District")
	EBCUBlockStyle Style = EBCUBlockStyle::MidRiseOffice;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District", meta = (ClampMin = "0.0"))
	float Weight = 1.0f;

	/** Minimum height (voxels) this style is allowed to generate. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District")
	int32 MinHeight = 6;

	/** Maximum height (voxels). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District")
	int32 MaxHeight = 80;
};

/** A named traffic/pedestrian behaviour profile for the district. */
USTRUCT(BlueprintType)
struct FBCUDistrictAIProfile
{
	GENERATED_BODY()

	/** Multiplier on the global traffic density setting. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|AI", meta = (ClampMin = "0.0", ClampMax = "4.0"))
	float TrafficDensity = 1.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|AI", meta = (ClampMin = "0.0", ClampMax = "4.0"))
	float PedestrianDensity = 1.0f;

	/** Speed limit in km/h enforced by traffic AI (and the player's tickets). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|AI", meta = (ClampMin = "10.0", ClampMax = "200.0"))
	float SpeedLimitKmh = 50.0f;

	/** How likely police are to spawn from this district's patrol points. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|AI", meta = (ClampMin = "0.0", ClampMax = "3.0"))
	float PolicePresence = 1.0f;

	/** Vehicle classes that may spawn as traffic here. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|AI")
	TArray<TSoftObjectPtr<class UBCUVehicleDefinition>> TrafficVehiclePool;

	/** Pedestrian outfit ids sampled by the pedestrian subsystem. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|AI")
	TArray<FName> PedestrianOutfits;
};

/**
 * One district of the metropolitan region. Everything about how a district
 * *looks* and *behaves* is data, never code: the generator, traffic, police and
 * weather systems all read from here.
 *
 * Original districts (no real or copyrighted city is reproduced):
 *   FoundryHeights   — downtown, hundreds of skyscrapers
 *   RowanPark        — residential neighbourhoods and suburbs
 *   MarbellaRow      — luxury district and shopping streets
 *   IronsideDocks    — industrial port, warehouses, factories
 *   CalderInternational — airport
 *   HighwayNetwork   — highways, bridges, tunnels
 *   AshfallBasin     — countryside, forests, rivers, lakes
 *   GraniteRidge     — mountains
 *   NeonMile         — commercial: garages, police, hospitals, entertainment
 */
UCLASS(BlueprintType, meta = (DisplayName = "BCU District"))
class BLOCKCITYULTRA_API UBCUDistrictDataAsset : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Identity")
	FName DistrictId = NAME_None;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Identity")
	FText DisplayName;

	/** One-line in-fiction description shown on the map screen. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Identity")
	FText Description;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Identity")
	FLinearColor MapColor = FLinearColor(0.5f, 0.5f, 0.5f);

	/** Controlling faction (original): who "owns" the streets here. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Identity")
	FName ControllingFaction = TEXT("None");

	// ── Generation ──────────────────────────────────────────────────────────
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Generation", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float RoadDensity = 0.7f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Generation", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float BuildingDensity = 0.8f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Generation", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float Verticality = 0.5f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Generation", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float NatureAmount = 0.2f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Generation")
	int32 ParcelSizeVoxels = 48;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Generation")
	int32 BaseHeightVoxels = 24;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Generation")
	TArray<FBCUStyleWeight> StyleWeights;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Generation")
	bool bIsDowntown = false;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Generation")
	bool bIsRural = false;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Generation")
	bool bIsMountainous = false;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Generation")
	bool bHasParks = true;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Generation")
	bool bGenerateInteriors = false;

	/** Interior density: fraction of eligible buildings that get an interior. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Generation", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float InteriorFraction = 0.1f;

	// ── Dressing ────────────────────────────────────────────────────────────
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Dressing", meta = (ClampMin = "0.0", ClampMax = "2.0"))
	float StreetFurnitureDensity = 0.7f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Dressing", meta = (ClampMin = "0.0", ClampMax = "2.0"))
	float VegetationDensity = 0.4f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Dressing", meta = (ClampMin = "0.0", ClampMax = "2.0"))
	float SignageDensity = 0.6f;

	/** Extra instanced props unique to this district (crates, containers…). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Dressing")
	TArray<TSoftObjectPtr<UStaticMesh>> DistrictProps;

	// ── AI ──────────────────────────────────────────────────────────────────
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|AI")
	FBCUDistrictAIProfile AI;

	// ── Atmosphere ──────────────────────────────────────────────────────────
	/** Ambient reverb / audio bed for the district. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Atmosphere")
	TSoftObjectPtr<USoundBase> AmbienceLoop;

	/** Volumetric fog tint (harbour haze, industrial smog, mountain mist). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Atmosphere")
	FLinearColor FogTint = FLinearColor(0.55f, 0.58f, 0.62f);

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Atmosphere", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float FogDensityBias = 0.5f;

	/** How often it rains here relative to the global weather system. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Atmosphere", meta = (ClampMin = "0.0", ClampMax = "2.0"))
	float RainBias = 1.0f;

	/** Night lighting warmth: 0 = cold sodium, 1 = warm incandescent. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Atmosphere", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float StreetlightWarmth = 0.5f;

	// ── Economy / progression ───────────────────────────────────────────────
	/** Property prices here (multiplier on the base value). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Economy", meta = (ClampMin = "0.1", ClampMax = "20.0"))
	float PropertyPriceMultiplier = 1.0f;

	/** Mission payout multiplier. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Economy", meta = (ClampMin = "0.1", ClampMax = "5.0"))
	float MissionRewardMultiplier = 1.0f;

	/** Crime rate: raises random-event frequency and police response. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Economy", meta = (ClampMin = "0.0", ClampMax = "2.0"))
	float CrimeRate = 0.5f;

	// ── Streaming ───────────────────────────────────────────────────────────
	/** Cells in this district load with a smaller radius (dense = expensive). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Streaming", meta = (ClampMin = "1"))
	int32 StreamingRadiusOverride = 0;

	/** HLOD merge factor: higher = coarser distant proxy = cheaper. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Streaming", meta = (ClampMin = "1", ClampMax = "8"))
	int32 HLODMergeFactor = 4;

	/** Districts whose cells must never unload during a mission chase. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Streaming")
	bool bAlwaysResident = false;

	//~ UPrimaryDataAsset
	virtual FPrimaryAssetId GetPrimaryAssetId() const override
	{
		return FPrimaryAssetId(TEXT("BCUDistrict"), DistrictId);
	}
	//~ End

	/** Cell coordinate bounds owned by this district (set by the region layout). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Bounds")
	FIntPoint MinCell = FIntPoint(0, 0);

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|District|Bounds")
	FIntPoint MaxCell = FIntPoint(63, 63);

	UFUNCTION(BlueprintPure, Category = "BCU|District")
	bool ContainsCell(const FBCUCellCoord& Coord) const
	{
		return Coord.X >= MinCell.X && Coord.X <= MaxCell.X
			&& Coord.Y >= MinCell.Y && Coord.Y <= MaxCell.Y;
	}
};
