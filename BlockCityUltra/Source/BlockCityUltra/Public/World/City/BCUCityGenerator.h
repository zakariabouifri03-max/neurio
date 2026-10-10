// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "World/Voxel/BCUVoxelTypes.h"
#include "BCUCityGenerator.generated.h"

class UBCUVoxelGrid;
class UBCUVoxelMaterialSet;
class UBCUDistrictDataAsset;

/** Style of a generated block — drives material choice, massing and detail. */
UENUM(BlueprintType)
enum class EBCUBlockStyle : uint8
{
	Skyscraper			UMETA(DisplayName = "Skyscraper"),
	ArtDecoTower		UMETA(DisplayName = "Art-Deco Tower"),
	GlassCurtainWall	UMETA(DisplayName = "Glass Curtain Wall"),
	MidRiseOffice		UMETA(DisplayName = "Mid-Rise Office"),
	BrickWalkup			UMETA(DisplayName = "Brick Walk-Up"),
	SuburbanHouse		UMETA(DisplayName = "Suburban House"),
	Townhouse			UMETA(DisplayName = "Townhouse"),
	LuxuryBoutique		UMETA(DisplayName = "Luxury Boutique"),
	Warehouse			UMETA(DisplayName = "Warehouse"),
	Factory				UMETA(DisplayName = "Factory"),
	PortShed			UMETA(DisplayName = "Port Shed"),
	RetailStrip			UMETA(DisplayName = "Retail Strip"),
	ParkingStructure	UMETA(DisplayName = "Parking Structure"),
	PoliceStation		UMETA(DisplayName = "Police Station"),
	Hospital			UMETA(DisplayName = "Hospital"),
	FireStation			UMETA(DisplayName = "Fire Station"),
	School				UMETA(DisplayName = "School"),
	EntertainmentVenue	UMETA(DisplayName = "Entertainment Venue"),
	Garage				UMETA(DisplayName = "Garage"),
	TransitStation		UMETA(DisplayName = "Transit Station"),
	AirportTerminal		UMETA(DisplayName = "Airport Terminal"),
	Farmhouse			UMETA(DisplayName = "Farmhouse"),
	Cabin				UMETA(DisplayName = "Cabin")
};

/** One generated building: everything needed to carve it into a voxel grid. */
USTRUCT(BlueprintType)
struct FBCUBuildingSpec
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	FName BuildingId = NAME_None;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	EBCUBlockStyle Style = EBCUBlockStyle::MidRiseOffice;

	/** Footprint in voxels (X = width, Y = depth). */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	FIntVector2 Footprint = FIntVector2(12, 12);

	/** Height in voxels. */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	int32 HeightVoxels = 24;

	/** Voxel-space origin inside the owning cell. */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	FIntVector Origin = FIntVector::ZeroValue;

	/** Yaw snapped to 0/90/180/270 — keeps the city readable and cubic. */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	int32 RotationDegrees = 0;

	/** Primary facade material. */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	EBCUVoxelMaterial FacadeMaterial = EBCUVoxelMaterial::Concrete;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	EBCUVoxelMaterial AccentMaterial = EBCUVoxelMaterial::Steel;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	EBCUVoxelMaterial GroundFloorMaterial = EBCUVoxelMaterial::Marble;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	uint8 FacadePaletteIndex = 1;

	/** Window grid: width, height and gaps, in voxels. */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	int32 WindowWidth = 2;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	int32 WindowHeight = 3;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	int32 WindowHorizontalGap = 2;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	int32 WindowVerticalGap = 2;

	/** 0..1 — fraction of windows that are lit at night. */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|City", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float LitWindowFraction = 0.42f;

	/** Setback tiers for skyscraper massing (Art-Deco / zoning silhouette). */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	int32 SetbackCount = 0;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	float SetbackFractionPerTier = 0.16f;

	/** Roof detail: water tank, HVAC, helipad, antenna, parapet. */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	bool bHasParapet = true;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	bool bHasRoofHVAC = true;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	bool bHasWaterTank = false;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	bool bHasAntenna = false;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	bool bHasHelipad = false;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	bool bHasNeonSignage = false;

	/** Ground floor arcade / recessed entrance depth in voxels. */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	int32 ArcadeDepth = 0;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	int32 ArcadeHeight = 5;

	/** Interior is generated + streamed separately (see UBCUInteriorStreamer). */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	bool bGenerateInterior = false;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	int32 InteriorFloorCount = 1;

	/** Deterministic per-building seed derived from the city seed + position. */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	int32 Seed = 0;
};

/** Road segment produced by the layout pass, consumed by the street pass. */
USTRUCT(BlueprintType)
struct FBCURoadSegment
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	FIntVector Start = FIntVector::ZeroValue;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	FIntVector End = FIntVector::ZeroValue;

	/** Width in voxels (2 lanes ≈ 7, avenue ≈ 11, highway ≈ 17). */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	int32 WidthVoxels = 7;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	bool bHasCenterLine = true;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	bool bHasSidewalk = true;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	bool bIsHighway = false;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	bool bIsTunnel = false;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	bool bIsBridge = false;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	int32 LanesEachWay = 1;

	/** Lane centre offsets in voxels, used by the traffic lane graph. */
	TArray<int8> LaneOffsets;
};

/** Everything one city cell contains. Produced on a worker thread. */
USTRUCT(BlueprintType)
struct FBCUCityCellData
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	FBCUCellCoord Coord;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	TArray<FBCURoadSegment> Roads;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	TArray<FBCUBuildingSpec> Buildings;

	/** Spawn points discovered while generating (garages, patrol nodes…). */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	TArray<FVector> TrafficSpawnPoints;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	TArray<FVector> PedestrianSpawnPoints;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	TArray<FVector> PoliceSpawnPoints;

	/** Wall-clock ms spent generating + meshing this cell (profiler). */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	double GenerationMs = 0.0;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	int32 VoxelCount = 0;
};

/**
 * Procedural, deterministic city generation.
 *
 * Pipeline (all pure functions, all runnable off the game thread):
 *   1. Layout     — road graph per district (grid + organic breaks, ring roads,
 *                   highways, river crossings). Snapped to the voxel grid so
 *                   every street is a clean axis-aligned cubic corridor.
 *   2. Parcels    — blocks between roads are subdivided into buildable parcels.
 *   3. Massing    — each parcel gets a FBCUBuildingSpec from the district style
 *                   table + height field (downtown tall, suburbs low).
 *   4. Carve      — facades, windows, arcades, setbacks, roofs, interiors.
 *   5. Dress      — street furniture, signage, vegetation, kerbs, crossings.
 *   6. Mesh       — FBCUVoxelMesher per chunk.
 *
 * Everything is seeded: the same FBCUCitySeed produces byte-identical cities on
 * every machine, which is what makes a shared save file and a reproducible bug
 * report possible.
 *
 * All architecture is generated from original parametric recipes. No real-world
 * building, map or copyrighted asset is reproduced.
 */
UCLASS(BlueprintType, meta = (DisplayName = "BCU City Generator"))
class BLOCKCITYULTRA_API UBCUCityGenerator : public UObject
{
	GENERATED_BODY()

public:
	UBCUCityGenerator();

	/** Runs the full pipeline for one cell. Safe on a worker thread. */
	static FBCUCityCellData GenerateCell(
		const FBCUCellCoord& Coord,
		const FBCUCitySeed& Seed,
		const UBCUDistrictDataAsset* District,
		const UBCUVoxelMaterialSet* MaterialSet);

	/** Carves the generated cell into a voxel grid. Safe on a worker thread. */
	static void CarveCellIntoGrid(
		const FBCUCityCellData& CellData,
		UBCUVoxelGrid* Grid,
		const UBCUDistrictDataAsset* District,
		const FBCUCitySeed& CitySeed);

	// ── Pass 1: layout ──────────────────────────────────────────────────────
	static void GenerateRoadLayout(
		const FBCUCellCoord& Coord,
		const FBCUCitySeed& Seed,
		const UBCUDistrictDataAsset* District,
		TArray<FBCURoadSegment>& OutRoads);

	// ── Pass 2/3: parcels + massing ─────────────────────────────────────────
	static void GenerateBuildings(
		const FBCUCellCoord& Coord,
		const FBCUCitySeed& Seed,
		const UBCUDistrictDataAsset* District,
		const TArray<FBCURoadSegment>& Roads,
		TArray<FBCUBuildingSpec>& OutBuildings);

	// ── Pass 4: individual building carving ─────────────────────────────────
	static void CarveBuilding(UBCUVoxelGrid* Grid, const FBCUBuildingSpec& Spec);
	static void CarveFacade(UBCUVoxelGrid* Grid, const FBCUBuildingSpec& Spec);
	static void CarveWindows(UBCUVoxelGrid* Grid, const FBCUBuildingSpec& Spec);
	static void CarveRoof(UBCUVoxelGrid* Grid, const FBCUBuildingSpec& Spec);
	static void CarveGroundFloor(UBCUVoxelGrid* Grid, const FBCUBuildingSpec& Spec);
	static void CarveInteriorShell(UBCUVoxelGrid* Grid, const FBCUBuildingSpec& Spec);

	// ── Pass 5: streets + dressing ──────────────────────────────────────────
	static void CarveRoads(UBCUVoxelGrid* Grid, const TArray<FBCURoadSegment>& Roads);
	static void CarveSidewalks(UBCUVoxelGrid* Grid, const TArray<FBCURoadSegment>& Roads);
	static void PlaceStreetFurniture(UBCUVoxelGrid* Grid, const FBCUCityCellData& CellData,
		const UBCUDistrictDataAsset* District);
	static void PlaceVegetation(UBCUVoxelGrid* Grid, const FBCUCityCellData& CellData,
		const UBCUDistrictDataAsset* District, int32 Seed);
	static void PlaceNeonSignage(UBCUVoxelGrid* Grid, const FBCUBuildingSpec& Spec, int32 Seed);

	// ── Terrain / nature ────────────────────────────────────────────────────
	static void CarveTerrain(UBCUVoxelGrid* Grid, const FBCUCellCoord& Coord,
		const FBCUCitySeed& Seed, const UBCUDistrictDataAsset* District);
	static void CarveRiver(UBCUVoxelGrid* Grid, const FBCUCellCoord& Coord, const FBCUCitySeed& Seed);
	static void CarveMountainSlope(UBCUVoxelGrid* Grid, const FBCUCellCoord& Coord, const FBCUCitySeed& Seed);
	static void CarveTree(UBCUVoxelGrid* Grid, const FIntVector& Base, int32 Seed,
		EBCUVoxelMaterial LeafMaterial);

	/** Noise helpers — deterministic, no dependency on the world's seed actor. */
	static float ValueNoise2D(float X, float Y, int32 Seed);
	static float FractalNoise2D(float X, float Y, int32 Seed, int32 Octaves = 4, float Lacunarity = 2.0f, float Gain = 0.5f);
	static int32 Hash3(int32 X, int32 Y, int32 Z, int32 Seed);

	/** Which district a cell belongs to, from the region layout. */
	static FName ResolveDistrictName(const FBCUCellCoord& Coord, const FBCUCitySeed& Seed);

	/** Total cells in the shipping region (used by the loading bar). */
	static int32 GetRegionCellCount(const FBCUCitySeed& Seed);
};
