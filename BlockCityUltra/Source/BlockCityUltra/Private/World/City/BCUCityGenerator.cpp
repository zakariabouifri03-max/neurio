// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
//
// Deterministic procedural city generation. Every function here is pure with
// respect to its inputs: given the same FBCUCitySeed + cell coordinate, the
// output is byte-identical on every machine and every run. That is what lets
// us generate a 200 km² metropolitan region on demand, stream it with World
// Partition, and still reproduce a bug report from a save file.

#include "World/City/BCUCityGenerator.h"

#include "World/City/BCUDistrictDataAsset.h"
#include "World/Voxel/BCUVoxelGrid.h"
#include "World/Voxel/BCUVoxelTypes.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUCityGen, Log, All);

namespace BCUCity
{
	// One city cell is 256 m × 256 m. At 25 cm voxels that is 1024 × 1024 in
	// plan, which is too big for a single chunk grid pass at 60 fps — so cells
	// are subdivided into 16 chunks of 256 voxels and only the ones that
	// actually contain geometry are allocated (sparse storage).
	static const int32 CellVoxelsX = 1024;
	static const int32 CellVoxelsY = 1024;
	static const int32 CellVoxelsZ = 960;    // 240 m — tall enough for a 60-storey tower
	static const float CellSizeCm = 25600.0f;

	static const int32 SidewalkWidth = 3;    // 0.75 m — voxel-scale pavement
	static const int32 KerbHeight = 1;

	static FVector CellOrigin(const FBCUCellCoord& Coord)
	{
		return FVector(Coord.X * CellSizeCm, Coord.Y * CellSizeCm, 0.0f);
	}
}

UBCUCityGenerator::UBCUCityGenerator()
{
}

//═══════════════════════════════════════════════════════════════════════════════
// Deterministic noise / hashing
//═══════════════════════════════════════════════════════════════════════════════

int32 UBCUCityGenerator::Hash3(int32 X, int32 Y, int32 Z, int32 Seed)
{
	// Integer hash (Thomas Wang's 32-bit finaliser, mixed across three axes).
	uint32 h = uint32(X) * 374761393u + uint32(Y) * 668265263u + uint32(Z) * 2147483647u + uint32(Seed) * 2246822519u;
	h = (h ^ (h >> 13)) * 1274126177u;
	h = h ^ (h >> 16);
	return int32(h & 0x7FFFFFFF);
}

float UBCUCityGenerator::ValueNoise2D(float X, float Y, int32 Seed)
{
	const int32 xi = FMath::FloorToInt(X);
	const int32 yi = FMath::FloorToInt(Y);
	const float xf = X - float(xi);
	const float yf = Y - float(yi);

	// Quintic fade: C2-continuous, so height fields have no visible creases.
	const float u = xf * xf * xf * (xf * (xf * 6.0f - 15.0f) + 10.0f);
	const float v = yf * yf * yf * (yf * (yf * 6.0f - 15.0f) + 10.0f);

	auto Corner = [&](int32 CX, int32 CY)
	{
		return float(Hash3(CX, CY, 0, Seed) % 65536) / 65535.0f;
	};

	const float A = Corner(xi, yi);
	const float B = Corner(xi + 1, yi);
	const float C = Corner(xi, yi + 1);
	const float D = Corner(xi + 1, yi + 1);

	return FMath::Lerp(FMath::Lerp(A, B, u), FMath::Lerp(C, D, u), v);
}

float UBCUCityGenerator::FractalNoise2D(float X, float Y, int32 Seed, int32 Octaves, float Lacunarity, float Gain)
{
	float Sum = 0.0f;
	float Amplitude = 1.0f;
	float Frequency = 1.0f;
	float Normaliser = 0.0f;

	for (int32 i = 0; i < FMath::Clamp(Octaves, 1, 8); ++i)
	{
		Sum += ValueNoise2D(X * Frequency, Y * Frequency, Seed + i * 1013) * Amplitude;
		Normaliser += Amplitude;
		Amplitude *= Gain;
		Frequency *= Lacunarity;
	}

	return Normaliser > 0.0f ? Sum / Normaliser : 0.0f;
}

//═══════════════════════════════════════════════════════════════════════════════
// Region layout — which district owns which cell
//═══════════════════════════════════════════════════════════════════════════════

FName UBCUCityGenerator::ResolveDistrictName(const FBCUCellCoord& Coord, const FBCUCitySeed& Seed)
{
	// The region is laid out as a fixed macro-plan (original design, no real
	// city is reproduced). Coordinates are in cells; the region is 64 × 64
	// cells ≈ 16.4 km × 16.4 km of dense city plus wilderness beyond.
	const float Noise = FractalNoise2D(Coord.X * 0.07f, Coord.Y * 0.07f, Seed.Seed, 3);
	const float DistanceFromCore = FMath::Sqrt(float(Coord.X * Coord.X + Coord.Y * Coord.Y));

	// River runs diagonally through the region and carves the waterfront.
	const float RiverDistance = FMath::Abs(float(Coord.X - Coord.Y) * 0.7071f) + (Noise - 0.5f) * 6.0f;

	if (RiverDistance < 2.2f)
	{
		return TEXT("AshfallRiver");
	}

	if (DistanceFromCore < 7.0f)
	{
		return TEXT("FoundryHeights");       // downtown: hundreds of skyscrapers
	}

	if (DistanceFromCore < 12.0f)
	{
		// Ring around downtown: luxury + commercial, split by the noise field
		// so the boundary between them is organic rather than a perfect circle.
		return Noise > 0.55f ? TEXT("MarbellaRow") : TEXT("NeonMile");
	}

	if (DistanceFromCore < 20.0f)
	{
		// East of the core is the port; west is residential.
		return (Coord.X > Coord.Y) ? TEXT("IronsideDocks") : TEXT("RowanPark");
	}

	if (DistanceFromCore < 26.0f)
	{
		return Noise > 0.6f ? TEXT("CalderInternational") : TEXT("HighwayNetwork");
	}

	if (DistanceFromCore < 40.0f)
	{
		return TEXT("AshfallBasin");         // countryside, forests, lakes
	}

	return TEXT("GraniteRidge");             // mountains
}

int32 UBCUCityGenerator::GetRegionCellCount(const FBCUCitySeed& Seed)
{
	// 64 × 64 dense region + a 16-cell wilderness apron on each side.
	return 96 * 96;
}

//═══════════════════════════════════════════════════════════════════════════════
// Pass 1 — road layout
//═══════════════════════════════════════════════════════════════════════════════

void UBCUCityGenerator::GenerateRoadLayout(
	const FBCUCellCoord& Coord,
	const FBCUCitySeed& Seed,
	const UBCUDistrictDataAsset* District,
	TArray<FBCURoadSegment>& OutRoads)
{
	OutRoads.Reset();

	const float Density = District ? District->RoadDensity : FMath::Clamp(Seed.Density, 0.2f, 1.0f);
	const bool bIsDowntown = District && District->bIsDowntown;
	const bool bIsRural = District && District->bIsRural;

	// Block pitch: downtown is tight (small blocks, many streets), suburbs are
	// loose. Everything is snapped to the voxel grid so corners stay cubic.
	int32 BlockPitch = bIsDowntown ? 64 : (bIsRural ? 256 : 128);
	BlockPitch = FMath::Clamp(int32(float(BlockPitch) / FMath::Max(0.2f, Density)), 32, 384);

	const int32 MainRoadWidth = bIsDowntown ? 11 : 9;
	const int32 LocalRoadWidth = bIsDowntown ? 7 : 7;

	// ── Primary grid ────────────────────────────────────────────────────────
	// Phase the grid per cell so streets continue across cell borders. Phase is
	// derived from the *global* coordinate, not the local one.
	const int32 PhaseX = FMath::FloorToInt(float(Coord.X * BCUCity::CellVoxelsX) / BlockPitch) * BlockPitch
		- Coord.X * BCUCity::CellVoxelsX;
	const int32 PhaseY = FMath::FloorToInt(float(Coord.Y * BCUCity::CellVoxelsY) / BlockPitch) * BlockPitch
		- Coord.Y * BCUCity::CellVoxelsY;

	for (int32 X = PhaseX; X <= BCUCity::CellVoxelsX; X += BlockPitch)
	{
		FBCURoadSegment Road;
		Road.Start = FIntVector(X, 0, 0);
		Road.End = FIntVector(X, BCUCity::CellVoxelsY, 0);
		Road.WidthVoxels = MainRoadWidth;
		Road.bIsHighway = false;
		Road.LanesEachWay = bIsDowntown ? 2 : 1;
		OutRoads.Add(Road);
	}

	for (int32 Y = PhaseY; Y <= BCUCity::CellVoxelsY; Y += BlockPitch)
	{
		FBCURoadSegment Road;
		Road.Start = FIntVector(0, Y, 0);
		Road.End = FIntVector(BCUCity::CellVoxelsX, Y, 0);
		Road.WidthVoxels = MainRoadWidth;
		Road.LanesEachWay = bIsDowntown ? 2 : 1;
		OutRoads.Add(Road);
	}

	// ── Secondary streets (only where density asks for them) ────────────────
	if (!bIsRural && Density > 0.45f)
	{
		const int32 SecondaryPitch = BlockPitch / 2;
		for (int32 X = PhaseX + SecondaryPitch; X <= BCUCity::CellVoxelsX; X += BlockPitch)
		{
			FBCURoadSegment Road;
			Road.Start = FIntVector(X, 0, 0);
			Road.End = FIntVector(X, BCUCity::CellVoxelsY, 0);
			Road.WidthVoxels = LocalRoadWidth;
			Road.LanesEachWay = 1;
			OutRoads.Add(Road);
		}
	}

	// ── Highway / ring road: one per region, wide, grade-separated ──────────
	const int32 HighwayCell = 14;
	if (Coord.X == HighwayCell || Coord.Y == HighwayCell)
	{
		FBCURoadSegment Highway;
		if (Coord.X == HighwayCell)
		{
			Highway.Start = FIntVector(512 - 9, 0, 8);
			Highway.End = FIntVector(512 + 9, BCUCity::CellVoxelsY, 8);
		}
		else
		{
			Highway.Start = FIntVector(0, 512 - 9, 8);
			Highway.End = FIntVector(BCUCity::CellVoxelsX, 512 + 9, 8);
		}
		Highway.WidthVoxels = 17;
		Highway.bIsHighway = true;
		Highway.bHasSidewalk = false;
		Highway.LanesEachWay = 3;
		OutRoads.Add(Highway);
	}

	// ── Bridges and tunnels where a road crosses the river ──────────────────
	const float RiverDistance = FMath::Abs(float(Coord.X - Coord.Y) * 0.7071f);
	if (RiverDistance < 6.0f)
	{
		for (FBCURoadSegment& Road : OutRoads)
		{
			Road.bIsBridge = true;
			Road.Start.Z += 6;   // raised deck
			Road.End.Z += 6;
		}
	}

	// ── Lane centres for the traffic graph ──────────────────────────────────
	for (FBCURoadSegment& Road : OutRoads)
	{
		Road.LaneOffsets.Reset();
		const int32 HalfWidth = Road.WidthVoxels / 2;
		for (int32 Lane = 0; Lane < Road.LanesEachWay * 2; ++Lane)
		{
			const bool bForward = Lane < Road.LanesEachWay;
			const int32 IndexInDirection = bForward ? Lane : (Lane - Road.LanesEachWay);
			const int32 OffsetFromCentre = 2 + IndexInDirection * 3;
			Road.LaneOffsets.Add(int8(bForward ? OffsetFromCentre : -OffsetFromCentre));
		}
		(void)HalfWidth;
	}
}

//═══════════════════════════════════════════════════════════════════════════════
// Pass 2 + 3 — parcels and massing
//═══════════════════════════════════════════════════════════════════════════════

void UBCUCityGenerator::GenerateBuildings(
	const FBCUCellCoord& Coord,
	const FBCUCitySeed& Seed,
	const UBCUDistrictDataAsset* District,
	const TArray<FBCURoadSegment>& Roads,
	TArray<FBCUBuildingSpec>& OutBuildings)
{
	OutBuildings.Reset();

	const float Density = District ? District->BuildingDensity : Seed.Density;
	const float Verticality = District ? District->Verticality : Seed.Verticality;
	const bool bIsRural = District && District->bIsRural;

	// Occupancy mask: cells inside a road corridor cannot be built on. Stored at
	// 1/4 resolution (256×256 bits per cell) — 8 KB, negligible.
	const int32 MaskScale = 4;
	const int32 MaskW = BCUCity::CellVoxelsX / MaskScale;
	const int32 MaskH = BCUCity::CellVoxelsY / MaskScale;
	TArray<bool> Occupied;
	Occupied.Init(false, MaskW * MaskH);

	for (const FBCURoadSegment& Road : Roads)
	{
		const int32 HalfWidth = Road.WidthVoxels / 2 + BCUCity::SidewalkWidth + 1;
		const bool bVertical = Road.Start.X == Road.End.X;

		if (bVertical)
		{
			const int32 X = Road.Start.X / MaskScale;
			for (int32 Y = 0; Y < MaskH; ++Y)
			{
				for (int32 DX = -HalfWidth / MaskScale; DX <= HalfWidth / MaskScale; ++DX)
				{
					const int32 MX = X + DX;
					if (MX >= 0 && MX < MaskW)
					{
						Occupied[MX + Y * MaskW] = true;
					}
				}
			}
		}
		else
		{
			const int32 Y = Road.Start.Y / MaskScale;
			for (int32 X = 0; X < MaskW; ++X)
			{
				for (int32 DY = -HalfWidth / MaskScale; DY <= HalfWidth / MaskScale; ++DY)
				{
					const int32 MY = Y + DY;
					if (MY >= 0 && MY < MaskH)
					{
						Occupied[X + MY * MaskW] = true;
					}
				}
			}
		}
	}

	// ── Walk the block grid and place one building per parcel ───────────────
	const int32 ParcelPitch = FMath::Max(16, (District ? District->ParcelSizeVoxels : 48));

	for (int32 PY = ParcelPitch / 2; PY < BCUCity::CellVoxelsY - ParcelPitch; PY += ParcelPitch)
	{
		for (int32 PX = ParcelPitch / 2; PX < BCUCity::CellVoxelsX - ParcelPitch; PX += ParcelPitch)
		{
			const int32 MX = PX / MaskScale;
			const int32 MY = PY / MaskScale;
			if (Occupied[MX + MY * MaskW])
			{
				continue;
			}

			const int32 BuildingSeed = Hash3(PX + Coord.X * 7919, PY + Coord.Y * 104729, 0, Seed.Seed);
			const float Roll = float(BuildingSeed % 1000) / 1000.0f;

			// Density culls parcels: rural cells keep ~10%, downtown ~95%.
			if (Roll > Density)
			{
				continue;
			}

			FBCUBuildingSpec Spec;
			Spec.Seed = BuildingSeed;
			Spec.Origin = FIntVector(PX, PY, 0);
			Spec.BuildingId = FName(*FString::Printf(TEXT("B_%d_%d_%d"), Coord.X, Coord.Y, BuildingSeed % 100000));

			// Footprint: fill most of the parcel, jittered.
			const int32 Jitter = 4 + (BuildingSeed % 9);
			Spec.Footprint = FIntVector2(
				FMath::Clamp(ParcelPitch - Jitter, 8, 96),
				FMath::Clamp(ParcelPitch - ((BuildingSeed >> 4) % 9) - 2, 8, 96));

			// ── Style + height from the district recipe ──────────────────────
			const float HeightNoise = FractalNoise2D(PX * 0.006f, PY * 0.006f, Seed.Seed + 17, 4);
			int32 BaseHeight = 8;

			if (District && District->StyleWeights.Num() > 0)
			{
				// Weighted pick from the district's style table.
				float Total = 0.0f;
				for (const FBCUStyleWeight& W : District->StyleWeights) { Total += W.Weight; }
				float Target = Roll * Total;
				EBCUBlockStyle Chosen = District->StyleWeights[0].Style;
				for (const FBCUStyleWeight& W : District->StyleWeights)
				{
					Target -= W.Weight;
					if (Target <= 0.0f) { Chosen = W.Style; break; }
				}
				Spec.Style = Chosen;
				BaseHeight = District->BaseHeightVoxels;
			}
			else
			{
				Spec.Style = bIsRural ? EBCUBlockStyle::Farmhouse : EBCUBlockStyle::MidRiseOffice;
			}

			// Skyscrapers: only downtown, only on tall-noise peaks. This is what
			// gives the skyline a readable silhouette instead of uniform noise.
			const bool bCanTower = Verticality > 0.5f && HeightNoise > (0.72f - Verticality * 0.28f);
			if (bCanTower && (Spec.Style == EBCUBlockStyle::MidRiseOffice || Spec.Style == EBCUBlockStyle::Skyscraper))
			{
				Spec.Style = (BuildingSeed % 3 == 0) ? EBCUBlockStyle::ArtDecoTower
					: ((BuildingSeed % 3 == 1) ? EBCUBlockStyle::GlassCurtainWall : EBCUBlockStyle::Skyscraper);
				BaseHeight = FMath::RoundToInt(BaseHeight + Verticality * 140.0f * HeightNoise);
				Spec.SetbackCount = FMath::Clamp(BaseHeight / 60, 0, 5);
				Spec.bHasAntenna = (BuildingSeed % 5 == 0);
				Spec.bHasHelipad = (BuildingSeed % 11 == 0);
				Spec.bHasWaterTank = (BuildingSeed % 4 == 0);
			}
			else
			{
				BaseHeight = FMath::RoundToInt(BaseHeight * (0.55f + HeightNoise * 0.9f));
			}

			Spec.HeightVoxels = FMath::Clamp(BaseHeight, 4, 480);

			// ── Window grid: bigger windows on glass towers, small on brick ──
			switch (Spec.Style)
			{
			case EBCUBlockStyle::GlassCurtainWall:
				Spec.FacadeMaterial = EBCUVoxelMaterial::Steel;
				Spec.AccentMaterial = EBCUVoxelMaterial::Aluminium;
				Spec.GroundFloorMaterial = EBCUVoxelMaterial::Marble;
				Spec.WindowWidth = 3; Spec.WindowHeight = 4;
				Spec.WindowHorizontalGap = 1; Spec.WindowVerticalGap = 1;
				Spec.LitWindowFraction = 0.58f;
				break;
			case EBCUBlockStyle::ArtDecoTower:
				Spec.FacadeMaterial = EBCUVoxelMaterial::Sandstone;
				Spec.AccentMaterial = EBCUVoxelMaterial::Chrome;
				Spec.GroundFloorMaterial = EBCUVoxelMaterial::Granite;
				Spec.WindowWidth = 2; Spec.WindowHeight = 4;
				Spec.WindowHorizontalGap = 2; Spec.WindowVerticalGap = 2;
				Spec.LitWindowFraction = 0.46f;
				break;
			case EBCUBlockStyle::BrickWalkup:
			case EBCUBlockStyle::Townhouse:
				Spec.FacadeMaterial = (BuildingSeed % 2 == 0)
					? EBCUVoxelMaterial::BrickRed : EBCUVoxelMaterial::BrickBrown;
				Spec.AccentMaterial = EBCUVoxelMaterial::WoodDark;
				Spec.GroundFloorMaterial = EBCUVoxelMaterial::BrickRed;
				Spec.WindowWidth = 2; Spec.WindowHeight = 3;
				Spec.WindowHorizontalGap = 3; Spec.WindowVerticalGap = 3;
				Spec.LitWindowFraction = 0.62f;
				break;
			case EBCUBlockStyle::SuburbanHouse:
			case EBCUBlockStyle::Farmhouse:
			case EBCUBlockStyle::Cabin:
				Spec.FacadeMaterial = EBCUVoxelMaterial::PlasterWhite;
				Spec.AccentMaterial = EBCUVoxelMaterial::WoodOak;
				Spec.GroundFloorMaterial = EBCUVoxelMaterial::PlasterWhite;
				Spec.WindowWidth = 2; Spec.WindowHeight = 2;
				Spec.WindowHorizontalGap = 4; Spec.WindowVerticalGap = 3;
				Spec.LitWindowFraction = 0.70f;
				break;
			case EBCUBlockStyle::Warehouse:
			case EBCUBlockStyle::Factory:
			case EBCUBlockStyle::PortShed:
				Spec.FacadeMaterial = EBCUVoxelMaterial::Corrugated;
				Spec.AccentMaterial = EBCUVoxelMaterial::SteelRusted;
				Spec.GroundFloorMaterial = EBCUVoxelMaterial::ConcreteDirty;
				Spec.WindowWidth = 3; Spec.WindowHeight = 2;
				Spec.WindowHorizontalGap = 6; Spec.WindowVerticalGap = 5;
				Spec.LitWindowFraction = 0.18f;
				break;
			case EBCUBlockStyle::LuxuryBoutique:
			case EBCUBlockStyle::RetailStrip:
				Spec.FacadeMaterial = EBCUVoxelMaterial::Marble;
				Spec.AccentMaterial = EBCUVoxelMaterial::Chrome;
				Spec.GroundFloorMaterial = EBCUVoxelMaterial::GlassReflective;
				Spec.WindowWidth = 4; Spec.WindowHeight = 4;
				Spec.WindowHorizontalGap = 2; Spec.WindowVerticalGap = 4;
				Spec.LitWindowFraction = 0.80f;
				Spec.bHasNeonSignage = true;
				Spec.ArcadeDepth = 2;
				break;
			case EBCUBlockStyle::EntertainmentVenue:
				Spec.FacadeMaterial = EBCUVoxelMaterial::ConcreteDirty;
				Spec.AccentMaterial = EBCUVoxelMaterial::Steel;
				Spec.GroundFloorMaterial = EBCUVoxelMaterial::GlassTinted;
				Spec.WindowWidth = 3; Spec.WindowHeight = 3;
				Spec.WindowHorizontalGap = 3; Spec.WindowVerticalGap = 3;
				Spec.LitWindowFraction = 0.35f;
				Spec.bHasNeonSignage = true;
				break;
			case EBCUBlockStyle::PoliceStation:
				Spec.FacadeMaterial = EBCUVoxelMaterial::BrickBrown;
				Spec.AccentMaterial = EBCUVoxelMaterial::PaintedBlue;
				Spec.GroundFloorMaterial = EBCUVoxelMaterial::ConcretePaving;
				Spec.WindowWidth = 2; Spec.WindowHeight = 3;
				Spec.WindowHorizontalGap = 3; Spec.WindowVerticalGap = 3;
				Spec.LitWindowFraction = 0.85f;
				break;
			case EBCUBlockStyle::Hospital:
				Spec.FacadeMaterial = EBCUVoxelMaterial::PlasterWhite;
				Spec.AccentMaterial = EBCUVoxelMaterial::PaintedRed;
				Spec.GroundFloorMaterial = EBCUVoxelMaterial::Tile;
				Spec.WindowWidth = 3; Spec.WindowHeight = 3;
				Spec.WindowHorizontalGap = 2; Spec.WindowVerticalGap = 2;
				Spec.LitWindowFraction = 0.90f;
				break;
			case EBCUBlockStyle::ParkingStructure:
				Spec.FacadeMaterial = EBCUVoxelMaterial::Concrete;
				Spec.AccentMaterial = EBCUVoxelMaterial::PaintedYellow;
				Spec.GroundFloorMaterial = EBCUVoxelMaterial::Asphalt;
				Spec.WindowWidth = 6; Spec.WindowHeight = 3;
				Spec.WindowHorizontalGap = 1; Spec.WindowVerticalGap = 2;
				Spec.LitWindowFraction = 0.25f;
				break;
			default:
				Spec.FacadeMaterial = EBCUVoxelMaterial::Concrete;
				Spec.AccentMaterial = EBCUVoxelMaterial::Steel;
				Spec.GroundFloorMaterial = EBCUVoxelMaterial::Granite;
				Spec.WindowWidth = 2; Spec.WindowHeight = 3;
				Spec.WindowHorizontalGap = 2; Spec.WindowVerticalGap = 2;
				Spec.LitWindowFraction = 0.42f;
				break;
			}

			Spec.FacadePaletteIndex = uint8(1 + (BuildingSeed % 5)); // facade ageing

			// Ground-floor arcade on tall downtown buildings.
			if (Spec.HeightVoxels > 60 && BuildingSeed % 3 == 0)
			{
				Spec.ArcadeDepth = 3;
				Spec.ArcadeHeight = 6;
			}

			// Interiors: only for buildings the player can actually enter. That
			// is a deliberate budget decision — see Docs/05 §7.
			Spec.bGenerateInterior = District && District->bGenerateInteriors
				&& (Spec.Style == EBCUBlockStyle::RetailStrip
					|| Spec.Style == EBCUBlockStyle::LuxuryBoutique
					|| Spec.Style == EBCUBlockStyle::Garage
					|| Spec.Style == EBCUBlockStyle::PoliceStation
					|| Spec.Style == EBCUBlockStyle::Hospital
					|| Spec.Style == EBCUBlockStyle::EntertainmentVenue
					|| Spec.Style == EBCUBlockStyle::TransitStation
					|| (Spec.HeightVoxels > 40 && BuildingSeed % 7 == 0));
			Spec.InteriorFloorCount = Spec.bGenerateInterior
				? FMath::Clamp(Spec.HeightVoxels / 8, 1, 12) : 0;

			Spec.RotationDegrees = 0; // grid-aligned: the cubic aesthetic
			OutBuildings.Add(Spec);
		}
	}

	UE_LOG(LogBCUCityGen, Verbose, TEXT("Cell %s: %d roads, %d buildings"),
		*Coord.ToString(), Roads.Num(), OutBuildings.Num());
}

//═══════════════════════════════════════════════════════════════════════════════
// Pass 4 — carving
//═══════════════════════════════════════════════════════════════════════════════

void UBCUCityGenerator::CarveBuilding(UBCUVoxelGrid* Grid, const FBCUBuildingSpec& Spec)
{
	if (!Grid)
	{
		return;
	}

	CarveFacade(Grid, Spec);
	CarveGroundFloor(Grid, Spec);
	CarveWindows(Grid, Spec);
	CarveRoof(Grid, Spec);

	if (Spec.bHasNeonSignage)
	{
		PlaceNeonSignage(Grid, Spec, Spec.Seed);
	}

	if (Spec.bGenerateInterior)
	{
		CarveInteriorShell(Grid, Spec);
	}
}

void UBCUCityGenerator::CarveFacade(UBCUVoxelGrid* Grid, const FBCUBuildingSpec& Spec)
{
	const FIntVector Origin = Spec.Origin;
	const int32 W = Spec.Footprint.X;
	const int32 D = Spec.Footprint.Y;
	const int32 H = Spec.HeightVoxels;

	// Setback tiers: each tier shrinks the footprint and starts higher. This is
	// what produces the stepped Art-Deco/zoning silhouette instead of extruded
	// boxes, and it costs nothing at generation time.
	const int32 Tiers = FMath::Clamp(Spec.SetbackCount, 0, 6) + 1;
	int32 CurrentW = W;
	int32 CurrentD = D;
	int32 TierBaseZ = 0;

	for (int32 Tier = 0; Tier < Tiers; ++Tier)
	{
		const int32 TierHeight = (Tier == Tiers - 1)
			? H - TierBaseZ
			: FMath::Max(4, (H - TierBaseZ) / (Tiers - Tier));

		const int32 OffsetX = (W - CurrentW) / 2;
		const int32 OffsetY = (D - CurrentD) / 2;

		const FBox Shell(
			FVector(Origin.X + OffsetX, Origin.Y + OffsetY, TierBaseZ),
			FVector(Origin.X + OffsetX + CurrentW - 1, Origin.Y + OffsetY + CurrentD - 1, TierBaseZ + TierHeight));

		// Solid shell first, then hollow it: solid fills are far cheaper than
		// per-face placement and the carve pass removes the interior anyway.
		Grid->FillBox(Shell, Spec.FacadeMaterial, Spec.FacadePaletteIndex);
		Grid->CarveBox(Shell, /*WallThickness=*/1.0f);

		// Corner pilasters in the accent material — reads as real structure.
		for (int32 Z = TierBaseZ; Z <= TierBaseZ + TierHeight; ++Z)
		{
			const int32 Corners[4][2] =
			{
				{ Origin.X + OffsetX, Origin.Y + OffsetY },
				{ Origin.X + OffsetX + CurrentW - 1, Origin.Y + OffsetY },
				{ Origin.X + OffsetX, Origin.Y + OffsetY + CurrentD - 1 },
				{ Origin.X + OffsetX + CurrentW - 1, Origin.Y + OffsetY + CurrentD - 1 }
			};

			for (const auto& Corner : Corners)
			{
				Grid->SetVoxel(FIntVector(Corner[0], Corner[1], Z), Spec.AccentMaterial);
			}
		}

		// Horizontal banding every 8 voxels — floor plates visible on the facade.
		if (TierHeight > 12)
		{
			for (int32 Z = TierBaseZ + 8; Z < TierBaseZ + TierHeight; Z += 8)
			{
				for (int32 X = 0; X < CurrentW; ++X)
				{
					Grid->SetVoxel(FIntVector(Origin.X + OffsetX + X, Origin.Y + OffsetY, Z), Spec.AccentMaterial);
					Grid->SetVoxel(FIntVector(Origin.X + OffsetX + X, Origin.Y + OffsetY + CurrentD - 1, Z), Spec.AccentMaterial);
				}
				for (int32 Y = 0; Y < CurrentD; ++Y)
				{
					Grid->SetVoxel(FIntVector(Origin.X + OffsetX, Origin.Y + OffsetY + Y, Z), Spec.AccentMaterial);
					Grid->SetVoxel(FIntVector(Origin.X + OffsetX + CurrentW - 1, Origin.Y + OffsetY + Y, Z), Spec.AccentMaterial);
				}
			}
		}

		TierBaseZ += TierHeight;
		CurrentW = FMath::Max(6, int32(float(CurrentW) * (1.0f - Spec.SetbackFractionPerTier)));
		CurrentD = FMath::Max(6, int32(float(CurrentD) * (1.0f - Spec.SetbackFractionPerTier)));

		if (TierBaseZ >= H)
		{
			break;
		}
	}
}

void UBCUCityGenerator::CarveGroundFloor(UBCUVoxelGrid* Grid, const FBCUBuildingSpec& Spec)
{
	const FIntVector Origin = Spec.Origin;
	const int32 W = Spec.Footprint.X;
	const int32 D = Spec.Footprint.Y;
	const int32 GroundHeight = FMath::Min(6, Spec.HeightVoxels);

	// Ground floor uses a different material (stone lobby, shopfront glazing).
	const FBox Ground(
		FVector(Origin.X, Origin.Y, 0),
		FVector(Origin.X + W - 1, Origin.Y + D - 1, GroundHeight));
	Grid->FillBox(Ground, Spec.GroundFloorMaterial);
	Grid->CarveBox(Ground, 1.0f);

	// Recessed arcade: carve a covered walkway through the ground floor.
	if (Spec.ArcadeDepth > 0)
	{
		const FBox Arcade(
			FVector(Origin.X - Spec.ArcadeDepth, Origin.Y + D / 2 - 3, 0),
			FVector(Origin.X + W + Spec.ArcadeDepth, Origin.Y + D / 2 + 3, Spec.ArcadeHeight));
		Grid->CarveBox(Arcade, 0.0f);

		// Arcade ceiling lights: emissive voxels every 4 m.
		for (int32 X = Origin.X; X < Origin.X + W; X += 16)
		{
			FBCUVoxel Light;
			Light.Material = static_cast<uint8>(EBCUVoxelMaterial::LightFixture);
			Light.Flags = FBCUVoxel::FLAG_Emissive;
			Light.Shade = 255;
			Grid->SetVoxel(FIntVector(X, Origin.Y + D / 2, Spec.ArcadeHeight), Light);
		}
	}

	// Entrance: a door-shaped gap on the street-facing side.
	const int32 DoorX = Origin.X + W / 2;
	for (int32 Z = 0; Z <= 4; ++Z)
	{
		for (int32 Y = Origin.Y - 1; Y <= Origin.Y; ++Y)
		{
			Grid->ClearVoxel(FIntVector(DoorX - 1 + (Z % 2), Y, Z));
			Grid->ClearVoxel(FIntVector(DoorX + 0, Y, Z));
			Grid->ClearVoxel(FIntVector(DoorX + 1, Y, Z));
		}
	}

	// Steps up to the door (kerb-height plinth) — small cubic detail that sells
	// the scale when the player walks up to it.
	for (int32 X = DoorX - 3; X <= DoorX + 3; ++X)
	{
		Grid->SetVoxel(FIntVector(X, Origin.Y - 2, 0), EBCUVoxelMaterial::ConcretePaving);
	}
}

void UBCUCityGenerator::CarveWindows(UBCUVoxelGrid* Grid, const FBCUBuildingSpec& Spec)
{
	const FIntVector Origin = Spec.Origin;
	const int32 W = Spec.Footprint.X;
	const int32 D = Spec.Footprint.Y;
	const int32 H = Spec.HeightVoxels;

	const int32 StepX = FMath::Max(2, Spec.WindowWidth + Spec.WindowHorizontalGap);
	const int32 StepZ = FMath::Max(2, Spec.WindowHeight + Spec.WindowVerticalGap);

	// Which windows are lit is decided *once* at generation time and stored in
	// the emissive material choice, so the night skyline is stable (no flicker
	// as cells re-mesh) and cheap (no per-window light component).
	auto LitMaterial = [&](int32 X, int32 Y, int32 Z) -> EBCUVoxelMaterial
	{
		const int32 Hash = Hash3(X, Y, Z, Spec.Seed);
		const float Roll = float(Hash % 1000) / 1000.0f;

		if (Roll > Spec.LitWindowFraction)
		{
			// Unlit: dark glass that still reflects the city.
			return (Hash % 4 == 0) ? EBCUVoxelMaterial::GlassTinted : EBCUVoxelMaterial::GlassReflective;
		}

		switch (Hash % 6)
		{
		case 0: case 1: return EBCUVoxelMaterial::WindowLitWarm;
		case 2: case 3: return EBCUVoxelMaterial::WindowLitCool;
		default:		return EBCUVoxelMaterial::WindowLit;
		}
	};

	for (int32 Z = 4; Z < H - 1; Z += StepZ)
	{
		for (int32 X = 2; X < W - 2; X += StepX)
		{
			const int32 WorldX = Origin.X + X;
			const int32 WorldZ = Z;

			// Front and back facades (constant Y).
			Grid->SetVoxel(FIntVector(WorldX, Origin.Y, WorldZ), LitMaterial(WorldX, Origin.Y, WorldZ));
			Grid->SetVoxel(FIntVector(WorldX, Origin.Y + D - 1, WorldZ), LitMaterial(WorldX, Origin.Y + D - 1, WorldZ));
		}

		for (int32 Y = 2; Y < D - 2; Y += StepX)
		{
			const int32 WorldY = Origin.Y + Y;
			const int32 WorldZ = Z;

			// Left and right facades (constant X).
			Grid->SetVoxel(FIntVector(Origin.X, WorldY, WorldZ), LitMaterial(Origin.X, WorldY, WorldZ));
			Grid->SetVoxel(FIntVector(Origin.X + W - 1, WorldY, WorldZ), LitMaterial(Origin.X + W - 1, WorldY, WorldZ));
		}
	}
}

void UBCUCityGenerator::CarveRoof(UBCUVoxelGrid* Grid, const FBCUBuildingSpec& Spec)
{
	const FIntVector Origin = Spec.Origin;
	const int32 W = Spec.Footprint.X;
	const int32 D = Spec.Footprint.Y;
	const int32 H = Spec.HeightVoxels;

	// Parapet: a 1-voxel lip around the roof edge.
	if (Spec.bHasParapet)
	{
		for (int32 X = 0; X < W; ++X)
		{
			Grid->SetVoxel(FIntVector(Origin.X + X, Origin.Y, H), Spec.AccentMaterial);
			Grid->SetVoxel(FIntVector(Origin.X + X, Origin.Y + D - 1, H), Spec.AccentMaterial);
			Grid->SetVoxel(FIntVector(Origin.X + X, Origin.Y, H + 1), Spec.AccentMaterial);
			Grid->SetVoxel(FIntVector(Origin.X + X, Origin.Y + D - 1, H + 1), Spec.AccentMaterial);
		}
		for (int32 Y = 0; Y < D; ++Y)
		{
			Grid->SetVoxel(FIntVector(Origin.X, Origin.Y + Y, H), Spec.AccentMaterial);
			Grid->SetVoxel(FIntVector(Origin.X + W - 1, Origin.Y + Y, H), Spec.AccentMaterial);
			Grid->SetVoxel(FIntVector(Origin.X, Origin.Y + Y, H + 1), Spec.AccentMaterial);
			Grid->SetVoxel(FIntVector(Origin.X + W - 1, Origin.Y + Y, H + 1), Spec.AccentMaterial);
		}
	}

	// Roof deck.
	const FBox Deck(
		FVector(Origin.X + 1, Origin.Y + 1, H),
		FVector(Origin.X + W - 2, Origin.Y + D - 2, H));
	Grid->FillBox(Deck, EBCUVoxelMaterial::AsphaltWorn);

	// HVAC blocks.
	if (Spec.bHasRoofHVAC && W > 10 && D > 10)
	{
		const int32 Units = FMath::Clamp((W * D) / 400, 1, 6);
		for (int32 i = 0; i < Units; ++i)
		{
			const int32 Hash = Hash3(i, Spec.Seed, 7, 1);
			const int32 UX = Origin.X + 2 + (Hash % (W - 6));
			const int32 UY = Origin.Y + 2 + ((Hash >> 8) % (D - 6));

			const FBox Unit(FVector(UX, UY, H + 1), FVector(UX + 3, UY + 3, H + 3));
			Grid->FillBox(Unit, EBCUVoxelMaterial::Aluminium);
		}
	}

	// Water tank on a small tower.
	if (Spec.bHasWaterTank && W > 8 && D > 8)
	{
		const int32 CX = Origin.X + W / 2;
		const int32 CY = Origin.Y + D / 2;
		Grid->FillCylinder(FVector(CX, CY, H + 5), 3.0f, 3.0f, EBCUVoxelMaterial::WoodDark);

		// Four legs.
		for (int32 i = 0; i < 4; ++i)
		{
			const int32 Angle = i * 90;
			const int32 LX = CX + int32(3.0f * FMath::Cos(FMath::DegreesToRadians(float(Angle))));
			const int32 LY = CY + int32(3.0f * FMath::Sin(FMath::DegreesToRadians(float(Angle))));
			for (int32 Z = H + 1; Z < H + 4; ++Z)
			{
				Grid->SetVoxel(FIntVector(LX, LY, Z), EBCUVoxelMaterial::Steel);
			}
		}
	}

	// Antenna with an aviation warning light (emissive, so it glows at night).
	if (Spec.bHasAntenna)
	{
		const int32 CX = Origin.X + W / 2;
		const int32 CY = Origin.Y + D / 2;
		for (int32 Z = H + 1; Z < H + 24; ++Z)
		{
			Grid->SetVoxel(FIntVector(CX, CY, Z), EBCUVoxelMaterial::SteelRusted);
		}

		FBCUVoxel Beacon;
		Beacon.Material = static_cast<uint8>(EBCUVoxelMaterial::NeonPink);
		Beacon.Flags = FBCUVoxel::FLAG_Emissive;
		Grid->SetVoxel(FIntVector(CX, CY, H + 24), Beacon);
	}

	// Helipad: a painted H on the roof deck.
	if (Spec.bHasHelipad && W > 16 && D > 16)
	{
		const int32 CX = Origin.X + W / 2;
		const int32 CY = Origin.Y + D / 2;

		const FBox Pad(FVector(CX - 5, CY - 5, H), FVector(CX + 5, CY + 5, H));
		Grid->FillBox(Pad, EBCUVoxelMaterial::PaintedYellow);

		for (int32 Z = 0; Z < 1; ++Z)
		{
			for (int32 i = -3; i <= 3; ++i)
			{
				Grid->SetVoxel(FIntVector(CX - 2, CY + i, H + Z), EBCUVoxelMaterial::PaintedWhite);
				Grid->SetVoxel(FIntVector(CX + 2, CY + i, H + Z), EBCUVoxelMaterial::PaintedWhite);
			}
			for (int32 i = -2; i <= 2; ++i)
			{
				Grid->SetVoxel(FIntVector(CX + i, CY, H + Z), EBCUVoxelMaterial::PaintedWhite);
			}
		}
	}
}

void UBCUCityGenerator::CarveInteriorShell(UBCUVoxelGrid* Grid, const FBCUBuildingSpec& Spec)
{
	// Floor slabs + a stair/lift core. The *contents* (shelving, desks, cars,
	// NPCs) are streamed separately by UBCUInteriorStreamer so an interior is
	// never resident unless the player is inside it.
	const FIntVector Origin = Spec.Origin;
	const int32 W = Spec.Footprint.X;
	const int32 D = Spec.Footprint.Y;
	const int32 FloorHeight = 8;
	const int32 Floors = FMath::Clamp(Spec.InteriorFloorCount, 1, 12);

	for (int32 Floor = 1; Floor <= Floors; ++Floor)
	{
		const int32 Z = Floor * FloorHeight;
		if (Z >= Spec.HeightVoxels)
		{
			break;
		}

		const FBox Slab(
			FVector(Origin.X + 1, Origin.Y + 1, Z),
			FVector(Origin.X + W - 2, Origin.Y + D - 2, Z));
		Grid->FillBox(Slab, EBCUVoxelMaterial::Concrete);

		// Interior floor finish.
		const FBox Finish(
			FVector(Origin.X + 1, Origin.Y + 1, Z + 1),
			FVector(Origin.X + W - 2, Origin.Y + D - 2, Z + 1));
		const bool bTiledFloor = Spec.Style == EBCUBlockStyle::Hospital
			|| Spec.Style == EBCUBlockStyle::RetailStrip
			|| Spec.Style == EBCUBlockStyle::LuxuryBoutique
			|| Spec.Style == EBCUBlockStyle::TransitStation;
		Grid->FillBox(Finish, bTiledFloor ? EBCUVoxelMaterial::Tile : EBCUVoxelMaterial::WoodOak);

		// Lift/stair core in the middle-back of the plan.
		const int32 CoreX = Origin.X + W / 2 - 2;
		const int32 CoreY = Origin.Y + D - 6;
		const FBox Core(FVector(CoreX, CoreY, Z), FVector(CoreX + 4, CoreY + 4, Z + FloorHeight - 1));
		Grid->FillBox(Core, EBCUVoxelMaterial::ConcreteDirty);
		Grid->CarveBox(Core, 1.0f);

		// Stair treads inside the core.
		for (int32 Step = 0; Step < FloorHeight - 1; ++Step)
		{
			Grid->SetVoxel(FIntVector(CoreX + 1, CoreY + 1 + (Step % 3), Z + Step + 1),
				EBCUVoxelMaterial::Steel);
		}

		// Ceiling lights on a grid — emissive voxels, not light components.
		for (int32 X = Origin.X + 4; X < Origin.X + W - 3; X += 8)
		{
			for (int32 Y = Origin.Y + 4; Y < Origin.Y + D - 3; Y += 8)
			{
				FBCUVoxel Light;
				Light.Material = static_cast<uint8>(EBCUVoxelMaterial::LightFixture);
				Light.Flags = FBCUVoxel::FLAG_Emissive | FBCUVoxel::FLAG_InteriorOnly;
				Grid->SetVoxel(FIntVector(X, Y, Z + FloorHeight - 2), Light);
			}
		}
	}
}

void UBCUCityGenerator::PlaceNeonSignage(UBCUVoxelGrid* Grid, const FBCUBuildingSpec& Spec, int32 Seed)
{
	const FIntVector Origin = Spec.Origin;
	const int32 W = Spec.Footprint.X;
	const int32 D = Spec.Footprint.Y;

	const int32 Hash = Hash3(Seed, 3, 11, 91);
	static const EBCUVoxelMaterial NeonColors[4] =
	{
		EBCUVoxelMaterial::NeonPink, EBCUVoxelMaterial::NeonCyan,
		EBCUVoxelMaterial::NeonAmber, EBCUVoxelMaterial::NeonWhite
	};
	const EBCUVoxelMaterial Neon = NeonColors[Hash % 4];

	// A vertical sign blade on the street corner — the classic night-city read.
	const int32 SignHeight = FMath::Clamp(6 + (Hash % 10), 6, 20);
	const int32 SignZ = 8 + (Hash % 12);
	const int32 SignX = Origin.X + ((Hash % 2 == 0) ? 0 : W - 1);
	const int32 SignY = Origin.Y + ((Hash % 4 < 2) ? 1 : D - 2);

	for (int32 Z = SignZ; Z < SignZ + SignHeight; ++Z)
	{
		FBCUVoxel Sign;
		Sign.Material = static_cast<uint8>(Neon);
		Sign.Flags = FBCUVoxel::FLAG_Emissive;
		Sign.PaletteIndex = uint8(Hash % 6);
		Grid->SetVoxel(FIntVector(SignX, SignY, Z), Sign);

		// Bracket back to the wall.
		Grid->SetVoxel(FIntVector(SignX + (SignX == Origin.X ? 1 : -1), SignY, Z), EBCUVoxelMaterial::Steel);
	}

	// Horizontal fascia sign above the ground floor.
	const int32 FasciaZ = 7;
	for (int32 X = Origin.X + 2; X < Origin.X + W - 2; ++X)
	{
		if ((X + Hash) % 3 == 0)
		{
			continue; // gaps make it read as lettering rather than a bar
		}

		FBCUVoxel Fascia;
		Fascia.Material = static_cast<uint8>(NeonColors[(Hash + X) % 4]);
		Fascia.Flags = FBCUVoxel::FLAG_Emissive;
		Grid->SetVoxel(FIntVector(X, Origin.Y, FasciaZ), Fascia);
	}
}

//═══════════════════════════════════════════════════════════════════════════════
// Pass 5 — streets, sidewalks, furniture, vegetation
//═══════════════════════════════════════════════════════════════════════════════

void UBCUCityGenerator::CarveRoads(UBCUVoxelGrid* Grid, const TArray<FBCURoadSegment>& Roads)
{
	for (const FBCURoadSegment& Road : Roads)
	{
		const int32 HalfWidth = Road.WidthVoxels / 2;
		const bool bVertical = Road.Start.X == Road.End.X;
		const int32 Z = Road.Start.Z;

		if (bVertical)
		{
			const int32 CentreX = Road.Start.X;
			const int32 Y0 = FMath::Min(Road.Start.Y, Road.End.Y);
			const int32 Y1 = FMath::Max(Road.Start.Y, Road.End.Y);

			const FBox Carriageway(
				FVector(CentreX - HalfWidth, Y0, Z),
				FVector(CentreX + HalfWidth, Y1, Z));
			Grid->FillBox(Carriageway, Road.bIsHighway ? EBCUVoxelMaterial::Asphalt : EBCUVoxelMaterial::Asphalt);

			// Centre line (dashed) + edge lines.
			if (Road.bHasCenterLine)
			{
				for (int32 Y = Y0; Y <= Y1; ++Y)
				{
					if ((Y / 4) % 2 == 0)
					{
						Grid->SetVoxel(FIntVector(CentreX, Y, Z + 1), EBCUVoxelMaterial::RoadLineYellow);
					}
					Grid->SetVoxel(FIntVector(CentreX - HalfWidth + 1, Y, Z + 1), EBCUVoxelMaterial::RoadLineWhite);
					Grid->SetVoxel(FIntVector(CentreX + HalfWidth - 1, Y, Z + 1), EBCUVoxelMaterial::RoadLineWhite);
				}
			}

			// Manholes every 32 voxels.
			for (int32 Y = Y0 + 16; Y < Y1; Y += 32)
			{
				Grid->SetVoxel(FIntVector(CentreX - 2, Y, Z + 1), EBCUVoxelMaterial::ManholeCover);
			}
		}
		else
		{
			const int32 CentreY = Road.Start.Y;
			const int32 X0 = FMath::Min(Road.Start.X, Road.End.X);
			const int32 X1 = FMath::Max(Road.Start.X, Road.End.X);

			const FBox Carriageway(
				FVector(X0, CentreY - HalfWidth, Z),
				FVector(X1, CentreY + HalfWidth, Z));
			Grid->FillBox(Carriageway, EBCUVoxelMaterial::Asphalt);

			if (Road.bHasCenterLine)
			{
				for (int32 X = X0; X <= X1; ++X)
				{
					if ((X / 4) % 2 == 0)
					{
						Grid->SetVoxel(FIntVector(X, CentreY, Z + 1), EBCUVoxelMaterial::RoadLineYellow);
					}
					Grid->SetVoxel(FIntVector(X, CentreY - HalfWidth + 1, Z + 1), EBCUVoxelMaterial::RoadLineWhite);
					Grid->SetVoxel(FIntVector(X, CentreY + HalfWidth - 1, Z + 1), EBCUVoxelMaterial::RoadLineWhite);
				}
			}

			for (int32 X = X0 + 16; X < X1; X += 32)
			{
				Grid->SetVoxel(FIntVector(X, CentreY - 2, Z + 1), EBCUVoxelMaterial::ManholeCover);
			}
		}

		// Crosswalks at every intersection of two roads in this cell.
		if (!Road.bIsHighway)
		{
			for (const FBCURoadSegment& Other : Roads)
			{
				const bool bOtherVertical = Other.Start.X == Other.End.X;
				if (bOtherVertical == bVertical)
				{
					continue; // parallel — no intersection
				}

				const int32 IX = bVertical ? Road.Start.X : Other.Start.X;
				const int32 IY = bVertical ? Other.Start.Y : Road.Start.Y;

				for (int32 i = -3; i <= 3; ++i)
				{
					if (bVertical)
					{
						Grid->SetVoxel(FIntVector(IX + i, IY + HalfWidth + 1, Z + 1), EBCUVoxelMaterial::Crosswalk);
						Grid->SetVoxel(FIntVector(IX + i, IY - HalfWidth - 1, Z + 1), EBCUVoxelMaterial::Crosswalk);
					}
					else
					{
						Grid->SetVoxel(FIntVector(IX + HalfWidth + 1, IY + i, Z + 1), EBCUVoxelMaterial::Crosswalk);
						Grid->SetVoxel(FIntVector(IX - HalfWidth - 1, IY + i, Z + 1), EBCUVoxelMaterial::Crosswalk);
					}
				}
			}
		}
	}
}

void UBCUCityGenerator::CarveSidewalks(UBCUVoxelGrid* Grid, const TArray<FBCURoadSegment>& Roads)
{
	for (const FBCURoadSegment& Road : Roads)
	{
		if (!Road.bHasSidewalk)
		{
			continue;
		}

		const int32 HalfWidth = Road.WidthVoxels / 2;
		const bool bVertical = Road.Start.X == Road.End.X;
		const int32 Z = Road.Start.Z;

		if (bVertical)
		{
			const int32 CentreX = Road.Start.X;
			for (int32 Y = Road.Start.Y; Y <= Road.End.Y; ++Y)
			{
				for (int32 Offset = 1; Offset <= BCUCity::SidewalkWidth; ++Offset)
				{
					Grid->SetVoxel(FIntVector(CentreX - HalfWidth - Offset, Y, Z), EBCUVoxelMaterial::ConcretePaving);
					Grid->SetVoxel(FIntVector(CentreX + HalfWidth + Offset, Y, Z), EBCUVoxelMaterial::ConcretePaving);

					// Kerb on the innermost paving voxel.
					if (Offset == 1)
					{
						Grid->SetVoxel(FIntVector(CentreX - HalfWidth - Offset, Y, Z + BCUCity::KerbHeight), EBCUVoxelMaterial::KerbStone);
						Grid->SetVoxel(FIntVector(CentreX + HalfWidth + Offset, Y, Z + BCUCity::KerbHeight), EBCUVoxelMaterial::KerbStone);
					}
				}

				// Tactile paving at crossings (accessibility detail).
				if ((Y / 8) % 16 == 0)
				{
					Grid->SetVoxel(FIntVector(CentreX - HalfWidth - 2, Y, Z), EBCUVoxelMaterial::TactilePaving);
					Grid->SetVoxel(FIntVector(CentreX + HalfWidth + 2, Y, Z), EBCUVoxelMaterial::TactilePaving);
				}
			}
		}
		else
		{
			const int32 CentreY = Road.Start.Y;
			for (int32 X = Road.Start.X; X <= Road.End.X; ++X)
			{
				for (int32 Offset = 1; Offset <= BCUCity::SidewalkWidth; ++Offset)
				{
					Grid->SetVoxel(FIntVector(X, CentreY - HalfWidth - Offset, Z), EBCUVoxelMaterial::ConcretePaving);
					Grid->SetVoxel(FIntVector(X, CentreY + HalfWidth + Offset, Z), EBCUVoxelMaterial::ConcretePaving);

					if (Offset == 1)
					{
						Grid->SetVoxel(FIntVector(X, CentreY - HalfWidth - Offset, Z + BCUCity::KerbHeight), EBCUVoxelMaterial::KerbStone);
						Grid->SetVoxel(FIntVector(X, CentreY + HalfWidth + Offset, Z + BCUCity::KerbHeight), EBCUVoxelMaterial::KerbStone);
					}
				}
			}
		}
	}
}

void UBCUCityGenerator::PlaceStreetFurniture(UBCUVoxelGrid* Grid, const FBCUCityCellData& CellData,
	const UBCUDistrictDataAsset* District)
{
	const float FurnitureDensity = District ? District->StreetFurnitureDensity : 0.6f;
	if (FurnitureDensity <= 0.0f)
	{
		return;
	}

	int32 PlacedLamps = 0;
	int32 PlacedBins = 0;
	int32 PlacedBenches = 0;
	int32 PlacedHydrants = 0;

	for (const FBCURoadSegment& Road : CellData.Roads)
	{
		if (!Road.bHasSidewalk || Road.bIsHighway)
		{
			continue;
		}

		const int32 HalfWidth = Road.WidthVoxels / 2;
		const bool bVertical = Road.Start.X == Road.End.X;
		const int32 Length = bVertical
			? FMath::Abs(Road.End.Y - Road.Start.Y)
			: FMath::Abs(Road.End.X - Road.Start.X);

		// Streetlights every ~20 m; the light itself is an emissive voxel plus a
		// single shared point-light component spawned at runtime only within
		// the player's light budget (never one per lamp in the whole city).
		for (int32 Along = 16; Along < Length; Along += 80)
		{
			const int32 Hash = Hash3(Along, Road.Start.X, Road.Start.Y, CellData.Coord.X * 31 + CellData.Coord.Y);
			if (float(Hash % 1000) / 1000.0f > FurnitureDensity)
			{
				continue;
			}

			int32 X, Y;
			if (bVertical) { X = Road.Start.X + HalfWidth + BCUCity::SidewalkWidth; Y = Road.Start.Y + Along; }
			else			 { X = Road.Start.X + Along; Y = Road.Start.Y + HalfWidth + BCUCity::SidewalkWidth; }

			// Pole.
			for (int32 Z = 1; Z <= 24; ++Z)
			{
				Grid->SetVoxel(FIntVector(X, Y, Z), EBCUVoxelMaterial::Steel);
			}

			// Arm over the carriageway + the luminaire.
			const int32 ArmDirection = bVertical ? -1 : -1;
			for (int32 i = 1; i <= 3; ++i)
			{
				if (bVertical) { Grid->SetVoxel(FIntVector(X + ArmDirection * i, Y, 24), EBCUVoxelMaterial::Steel); }
				else		   { Grid->SetVoxel(FIntVector(X, Y + ArmDirection * i, 24), EBCUVoxelMaterial::Steel); }
			}

			FBCUVoxel Lamp;
			Lamp.Material = static_cast<uint8>(EBCUVoxelMaterial::LightFixture);
			Lamp.Flags = FBCUVoxel::FLAG_Emissive;
			Lamp.Shade = 255;
			if (bVertical) { Grid->SetVoxel(FIntVector(X + ArmDirection * 4, Y, 23), Lamp); }
			else		   { Grid->SetVoxel(FIntVector(X, Y + ArmDirection * 4, 23), Lamp); }

			PlacedLamps++;

			// Refuse bin and bench alternate along the block.
			if (Hash % 3 == 0)
			{
				const FBox Bin(FVector(X + 2, Y, 1), FVector(X + 3, Y + 1, 4));
				Grid->FillBox(Bin, EBCUVoxelMaterial::SteelRusted);
				PlacedBins++;
			}
			else if (Hash % 5 == 0)
			{
				const FBox Bench(FVector(X + 2, Y, 1), FVector(X + 6, Y + 1, 1));
				Grid->FillBox(Bench, EBCUVoxelMaterial::WoodOak);
				for (int32 i = 0; i < 4; ++i)
				{
					Grid->SetVoxel(FIntVector(X + 2 + i * 1, Y, 0), EBCUVoxelMaterial::Steel);
				}
				PlacedBenches++;
			}

			// Fire hydrant near intersections.
			if (Along % 240 < 80)
			{
				Grid->SetVoxel(FIntVector(X - 2, Y + 3, 1), EBCUVoxelMaterial::PaintedRed);
				Grid->SetVoxel(FIntVector(X - 2, Y + 3, 2), EBCUVoxelMaterial::PaintedRed);
				PlacedHydrants++;
			}
		}
	}

	UE_LOG(LogBCUCityGen, Verbose, TEXT("Cell %s furniture: %d lamps, %d bins, %d benches, %d hydrants"),
		*CellData.Coord.ToString(), PlacedLamps, PlacedBins, PlacedBenches, PlacedHydrants);
}

void UBCUCityGenerator::PlaceVegetation(UBCUVoxelGrid* Grid, const FBCUCityCellData& CellData,
	const UBCUDistrictDataAsset* District, int32 Seed)
{
	const float VegetationDensity = District ? District->VegetationDensity : 0.4f;
	if (VegetationDensity <= 0.0f)
	{
		return;
	}

	const EBCUVoxelMaterial Leaf = (Seed % 10 == 0)
		? EBCUVoxelMaterial::LeavesAutumn : EBCUVoxelMaterial::LeavesGreen;

	// Roadside trees in the sidewalk verge.
	for (const FBCURoadSegment& Road : CellData.Roads)
	{
		if (!Road.bHasSidewalk || Road.bIsHighway)
		{
			continue;
		}

		const int32 HalfWidth = Road.WidthVoxels / 2;
		const bool bVertical = Road.Start.X == Road.End.X;
		const int32 Length = bVertical
			? FMath::Abs(Road.End.Y - Road.Start.Y)
			: FMath::Abs(Road.End.X - Road.Start.X);

		for (int32 Along = 40; Along < Length; Along += 64)
		{
			const int32 Hash = Hash3(Along, Road.Start.X + 5, Road.Start.Y + 9, Seed);
			if (float(Hash % 1000) / 1000.0f > VegetationDensity)
			{
				continue;
			}

			const int32 X = bVertical ? Road.Start.X - HalfWidth - BCUCity::SidewalkWidth - 1 : Road.Start.X + Along;
			const int32 Y = bVertical ? Road.Start.Y + Along : Road.Start.Y - HalfWidth - BCUCity::SidewalkWidth - 1;

			// Tree pit: soil voxel under the trunk.
			Grid->SetVoxel(FIntVector(X, Y, 0), EBCUVoxelMaterial::Dirt);
			CarveTree(Grid, FIntVector(X, Y, 1), Hash, Leaf);
		}
	}

	// Park / open-space planting where there is no building.
	if (District && District->bHasParks)
	{
		const int32 ParkCount = FMath::Clamp(int32(VegetationDensity * 6.0f), 0, 8);
		for (int32 i = 0; i < ParkCount; ++i)
		{
			const int32 Hash = Hash3(i, CellData.Coord.X, CellData.Coord.Y, Seed + 3);
			const int32 PX = 32 + (Hash % (BCUCity::CellVoxelsX - 96));
			const int32 PY = 32 + ((Hash >> 7) % (BCUCity::CellVoxelsY - 96));

			const FBox Lawn(FVector(PX, PY, 0), FVector(PX + 48, PY + 48, 0));
			Grid->FillBox(Lawn, EBCUVoxelMaterial::Grass);

			for (int32 t = 0; t < 12; ++t)
			{
				const int32 THash = Hash3(t, PX, PY, Seed);
				CarveTree(Grid,
					FIntVector(PX + 4 + (THash % 40), PY + 4 + ((THash >> 6) % 40), 1),
					THash, Leaf);
			}

			// Flower beds along the path.
			for (int32 F = 0; F < 48; F += 4)
			{
				Grid->SetVoxel(FIntVector(PX + F, PY + 24, 1), EBCUVoxelMaterial::Flowers);
				Grid->SetVoxel(FIntVector(PX + 24, PY + F, 1), EBCUVoxelMaterial::ConcretePaving);
			}
		}
	}
}

void UBCUCityGenerator::CarveTree(UBCUVoxelGrid* Grid, const FIntVector& Base, int32 Seed,
	EBCUVoxelMaterial LeafMaterial)
{
	const int32 TrunkHeight = 8 + (Seed % 12);
	const int32 CanopyRadius = 4 + (Seed % 5);

	for (int32 Z = 0; Z < TrunkHeight; ++Z)
	{
		Grid->SetVoxel(Base + FIntVector(0, 0, Z), EBCUVoxelMaterial::TreeTrunk);
	}

	// Blocky canopy: a cube-ish blob with the corners removed, which reads as a
	// tree at any distance while staying unmistakably voxel.
	const FIntVector CanopyCentre = Base + FIntVector(0, 0, TrunkHeight);
	for (int32 Z = -2; Z <= CanopyRadius - 1; ++Z)
	{
		const int32 LayerRadius = (Z < 0)
			? CanopyRadius
			: FMath::Max(1, CanopyRadius - Z);

		for (int32 Y = -LayerRadius; Y <= LayerRadius; ++Y)
		{
			for (int32 X = -LayerRadius; X <= LayerRadius; ++X)
			{
				// Drop the extreme corners for the blocky-canopy silhouette.
				if (FMath::Abs(X) == LayerRadius && FMath::Abs(Y) == LayerRadius && (Seed + X + Y) % 2 == 0)
				{
					continue;
				}

				Grid->SetVoxel(CanopyCentre + FIntVector(X, Y, Z), LeafMaterial);
			}
		}
	}
}

//═══════════════════════════════════════════════════════════════════════════════
// Terrain / nature
//═══════════════════════════════════════════════════════════════════════════════

void UBCUCityGenerator::CarveTerrain(UBCUVoxelGrid* Grid, const FBCUCellCoord& Coord,
	const FBCUCitySeed& Seed, const UBCUDistrictDataAsset* District)
{
	const bool bIsRural = District && District->bIsRural;
	const bool bIsMountain = District && District->bIsMountainous;
	const float Nature = District ? District->NatureAmount : Seed.Nature;

	// Urban cells get a flat slab; rural cells get a real height field. The
	// transition is blended over one cell so roads do not clip into hills.
	const int32 Step = bIsRural ? 4 : 16;   // coarser sampling in the city: it is flat anyway

	for (int32 Y = 0; Y < BCUCity::CellVoxelsY; Y += Step)
	{
		for (int32 X = 0; X < BCUCity::CellVoxelsX; X += Step)
		{
			float Height = 0.0f;

			if (bIsMountain)
			{
				const float Ridge = FractalNoise2D(X * 0.0025f, Y * 0.0025f, Seed.Seed + 101, 5);
				Height = FMath::Pow(Ridge, 1.6f) * 320.0f * Nature;
			}
			else if (bIsRural)
			{
				const float Rolling = FractalNoise2D(X * 0.004f, Y * 0.004f, Seed.Seed + 7, 4);
				Height = (Rolling - 0.5f) * 60.0f * Nature;
			}
			else
			{
				const float Blend = FractalNoise2D(X * 0.006f, Y * 0.006f, Seed.Seed + 3, 2);
				Height = Blend * 6.0f * Nature;
			}

			const int32 Z = FMath::Clamp(FMath::RoundToInt(Height), -8, 480);
			const EBCUVoxelMaterial Surface = bIsMountain
				? (Z > 200 ? EBCUVoxelMaterial::Snow : (Z > 90 ? EBCUVoxelMaterial::Rock : EBCUVoxelMaterial::Grass))
				: (bIsRural ? EBCUVoxelMaterial::Grass : EBCUVoxelMaterial::ConcretePaving);

			const FBox Column(FVector(X, Y, FMath::Min(0, Z)), FVector(X + Step - 1, Y + Step - 1, FMath::Max(0, Z)));
			Grid->FillBox(Column, (Z > 2) ? EBCUVoxelMaterial::Dirt : EBCUVoxelMaterial::Rock);
			Grid->FillBox(FBox(FVector(X, Y, FMath::Max(0, Z - 1)), FVector(X + Step - 1, Y + Step - 1, FMath::Max(0, Z))), Surface);
		}
	}

	CarveRiver(Grid, Coord, Seed);
}

void UBCUCityGenerator::CarveRiver(UBCUVoxelGrid* Grid, const FBCUCellCoord& Coord, const FBCUCitySeed& Seed)
{
	// The Ashfall River runs diagonally through the region with a meander from
	// the noise field. Water is a translucent voxel material with a separate
	// water plane on top for reflections (see Docs/05 §6).
	const float RiverDistanceCells = FMath::Abs(float(Coord.X - Coord.Y) * 0.7071f);
	if (RiverDistanceCells > 3.0f)
	{
		return;
	}

	const int32 Centre = BCUCity::CellVoxelsX / 2 + (Coord.X - Coord.Y) * 180;
	const int32 HalfWidth = 60;

	for (int32 Y = 0; Y < BCUCity::CellVoxelsY; Y += 4)
	{
		const float Meander = (FractalNoise2D(Y * 0.004f, Coord.Y * 3.0f, Seed.Seed + 555, 3) - 0.5f) * 160.0f;
		const int32 X = FMath::Clamp(Centre + int32(Meander), HalfWidth, BCUCity::CellVoxelsX - HalfWidth);

		for (int32 DX = -HalfWidth; DX <= HalfWidth; ++DX)
		{
			const float EdgeFade = 1.0f - FMath::Abs(float(DX)) / float(HalfWidth);
			const int32 Depth = FMath::RoundToInt(EdgeFade * 28.0f);

			// Carve the bed.
			for (int32 Z = -Depth; Z <= 2; ++Z)
			{
				Grid->ClearVoxel(FIntVector(X + DX, Y, Z));
			}

			// Fill with water voxels up to Z = 0.
			for (int32 Z = -Depth; Z <= 0; ++Z)
			{
				Grid->SetVoxel(FIntVector(X + DX, Y, Z), EBCUVoxelMaterial::Water);
			}

			// Sandy bank.
			if (EdgeFade < 0.25f)
			{
				Grid->SetVoxel(FIntVector(X + DX, Y, 1), EBCUVoxelMaterial::Sand);
			}
		}
	}
}

void UBCUCityGenerator::CarveMountainSlope(UBCUVoxelGrid* Grid, const FBCUCellCoord& Coord, const FBCUCitySeed& Seed)
{
	// Granite Ridge: a directional slope plus rock outcrops, so the distant
	// skyline has real parallax instead of a flat height field.
	for (int32 Y = 0; Y < BCUCity::CellVoxelsY; Y += 4)
	{
		for (int32 X = 0; X < BCUCity::CellVoxelsX; X += 4)
		{
			const float Slope = float(X + Y) / float(BCUCity::CellVoxelsX + BCUCity::CellVoxelsY);
			const float Noise = FractalNoise2D(X * 0.003f, Y * 0.003f, Seed.Seed + 909, 5);
			const int32 Height = FMath::Clamp(int32(Slope * 340.0f * Noise * 1.6f), 0, 520);

			if (Height <= 0)
			{
				continue;
			}

			const EBCUVoxelMaterial Material = (Height > 380) ? EBCUVoxelMaterial::Snow
				: (Height > 160) ? EBCUVoxelMaterial::Rock
				: (Noise > 0.55f) ? EBCUVoxelMaterial::Grass : EBCUVoxelMaterial::Rock;

			const FBox Column(FVector(X, Y, 0), FVector(X + 3, Y + 3, Height));
			Grid->FillBox(Column, Material);
		}
	}
}

//═══════════════════════════════════════════════════════════════════════════════
// Top level
//═══════════════════════════════════════════════════════════════════════════════

FBCUCityCellData UBCUCityGenerator::GenerateCell(
	const FBCUCellCoord& Coord,
	const FBCUCitySeed& Seed,
	const UBCUDistrictDataAsset* District,
	const UBCUVoxelMaterialSet* MaterialSet)
{
	const double StartTime = FPlatformTime::Seconds();

	FBCUCityCellData CellData;
	CellData.Coord = Coord;

	GenerateRoadLayout(Coord, Seed, District, CellData.Roads);
	GenerateBuildings(Coord, Seed, District, CellData.Roads, CellData.Buildings);

	// Spawn points for traffic, pedestrians and police patrols. Derived from the
	// road graph so AI always spawns on a lane, never inside a wall.
	for (const FBCURoadSegment& Road : CellData.Roads)
	{
		if (Road.bIsHighway)
		{
			continue;
		}

		const bool bVertical = Road.Start.X == Road.End.X;
		const FVector Origin = BCUCity::CellOrigin(Coord);

		for (int32 Lane = 0; Lane < Road.LaneOffsets.Num(); ++Lane)
		{
			const float LaneOffset = float(Road.LaneOffsets[Lane]) * 25.0f;
			const FVector Point = bVertical
				? Origin + FVector(Road.Start.X * 25.0f + LaneOffset, (Road.Start.Y + Lane * 512) * 25.0f, 100.0f)
				: Origin + FVector((Road.Start.X + Lane * 512) * 25.0f, Road.Start.Y * 25.0f + LaneOffset, 100.0f);

			CellData.TrafficSpawnPoints.Add(Point);
		}

		// Pedestrians spawn on the sidewalk, police on the carriageway.
		const FVector Sidewalk = Origin + FVector(
			(Road.Start.X + Road.WidthVoxels / 2 + 2) * 25.0f,
			Road.Start.Y * 25.0f,
			100.0f);
		CellData.PedestrianSpawnPoints.Add(Sidewalk);

		if (Road.WidthVoxels >= 9)
		{
			CellData.PoliceSpawnPoints.Add(Sidewalk + FVector(200.0f, 0.0f, 0.0f));
		}
	}

	CellData.GenerationMs = (FPlatformTime::Seconds() - StartTime) * 1000.0;
	(void)MaterialSet;
	return CellData;
}

void UBCUCityGenerator::CarveCellIntoGrid(
	const FBCUCityCellData& CellData,
	UBCUVoxelGrid* Grid,
	const UBCUDistrictDataAsset* District,
	const FBCUCitySeed& CitySeed)
{
	if (!Grid)
	{
		return;
	}

	const double StartTime = FPlatformTime::Seconds();

	CarveTerrain(Grid, CellData.Coord, CitySeed, District);
	CarveRoads(Grid, CellData.Roads);
	CarveSidewalks(Grid, CellData.Roads);

	for (const FBCUBuildingSpec& Spec : CellData.Buildings)
	{
		CarveBuilding(Grid, Spec);
	}

	PlaceStreetFurniture(Grid, CellData, District);
	PlaceVegetation(Grid, CellData, District, CellData.Coord.X * 131 + CellData.Coord.Y * 7717);

	const int32 VoxelCount = Grid->GetNonEmptyVoxelCount();
	const_cast<FBCUCityCellData&>(CellData).VoxelCount = VoxelCount;

	UE_LOG(LogBCUCityGen, Log, TEXT("Carved cell %s in %.1f ms (%d voxels)"),
		*CellData.Coord.ToString(), (FPlatformTime::Seconds() - StartTime) * 1000.0, VoxelCount);
}
