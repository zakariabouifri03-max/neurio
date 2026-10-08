// Native test runner for the engine-agnostic voxel core.
//
// These tests are REAL: they compile the actual project headers and sources with a
// small stand-in for Unreal's core types (see Shim/CoreMinimal.h) and execute them.
// Everything that does not need a UObject - coordinate maths, chunk storage, the
// noise field, both meshers, the terrain generator and settings validation - is
// covered here and verified by running it, not by reading it.
//
// What is NOT covered here, and cannot be without an engine install: anything
// touching UProceduralMeshComponent, actors, replication, World Partition or the
// editor. Those layers are listed as untested in the phase deliverable.

#include "Voxel/VoxelBlockPalette.h"
#include "Voxel/VoxelChunkData.h"
#include "Voxel/VoxelCoordinates.h"
#include "Voxel/VoxelCoreTypes.h"
#include "Voxel/VoxelMesher.h"
#include "Voxel/VoxelNoise.h"
#include "Voxel/VoxelTerrainGenerator.h"
#include "Voxel/VoxelWorldSettings.h"

#include <cstdio>
#include <string>
#include <vector>

// ===========================================================================
// Tiny test framework
// ===========================================================================
namespace TestRunner
{
	int32 ChecksRun = 0;
	int32 ChecksFailed = 0;
	const char* CurrentTest = "";
	std::vector<std::string> Failures;

	void Begin(const char* Name)
	{
		CurrentTest = Name;
		std::printf("  %-52s", Name);
	}

	void End(bool bAnyFailureInThisTest)
	{
		std::printf("%s\n", bAnyFailureInThisTest ? "[FAIL]" : "[ ok ]");
	}

	void Fail(const char* File, int Line, const std::string& Message)
	{
		++ChecksFailed;
		char Buffer[1024];
		std::snprintf(Buffer, sizeof(Buffer), "%s:%d  %s", File, Line, Message.c_str());
		Failures.push_back(Buffer);
		// Printed immediately as well as collected: a crash later in the run must not
		// swallow the diagnostics from earlier tests.
		std::printf("\n  ! %s\n    %-52s", Buffer, CurrentTest);
	}
}

#define TEST_BEGIN(Name) \
	const int32 FailuresBefore = TestRunner::ChecksFailed; \
	TestRunner::Begin(Name);

#define TEST_END() \
	TestRunner::End(TestRunner::ChecksFailed != FailuresBefore);

#define CHECK(Condition) \
	do { ++TestRunner::ChecksRun; if (!(Condition)) { TestRunner::Fail(__FILE__, __LINE__, std::string("expected: ") + #Condition); } } while (false)

#define CHECK_INT(Actual, Expected) \
	do { \
		++TestRunner::ChecksRun; \
		const long long ActualValue = static_cast<long long>(Actual); \
		const long long ExpectedValue = static_cast<long long>(Expected); \
		if (ActualValue != ExpectedValue) { \
			char Msg[256]; std::snprintf(Msg, sizeof(Msg), "%s == %lld, expected %lld", #Actual, ActualValue, ExpectedValue); \
			TestRunner::Fail(__FILE__, __LINE__, Msg); \
		} \
	} while (false)

#define CHECK_FLOAT(Actual, Expected, Tolerance) \
	do { \
		++TestRunner::ChecksRun; \
		const double ActualValue = static_cast<double>(Actual); \
		const double ExpectedValue = static_cast<double>(Expected); \
		if (!(std::fabs(ActualValue - ExpectedValue) <= (Tolerance))) { \
			char Msg[256]; std::snprintf(Msg, sizeof(Msg), "%s == %.6f, expected %.6f (+-%.6f)", #Actual, ActualValue, ExpectedValue, (double)(Tolerance)); \
			TestRunner::Fail(__FILE__, __LINE__, Msg); \
		} \
	} while (false)

#include <cmath>

// ===========================================================================
// Shared fixtures
// ===========================================================================
namespace
{
	FVoxelDimensions MakeDims(int32 SizeX = 32, int32 SizeY = 32, int32 SizeZ = 128, float BlockSize = 100.0f)
	{
		FVoxelDimensions Dims;
		Dims.SizeX = SizeX;
		Dims.SizeY = SizeY;
		Dims.SizeZ = SizeZ;
		Dims.BlockWorldSize = BlockSize;
		return Dims;
	}

	/** Mirrors the code-default palette UVoxelBlockRegistry builds with no assets. */
	FVoxelBlockPalette MakeTestPalette()
	{
		FVoxelBlockPalette Palette;

		FVoxelBlockProperties& Air = Palette.AddOrGet(VoxelBlockIds::Air);
		Air = FVoxelBlockProperties::MakeAir();

		for (uint16 Id = 1; Id < static_cast<uint16>(VoxelBlockIds::DefaultCount); ++Id)
		{
			FVoxelBlockProperties& Props = Palette.AddOrGet(Id);
			Props.BlockId = Id;
			Props.MeshBehaviour = EVoxelBlockMeshBehaviour::FullCube;
			Props.CollisionType = EVoxelBlockCollisionType::Solid;
			Props.bOpaque = true;
			Props.bSolid = true;
			Props.MaterialSlotIndex = VoxelMaterialSlots::Opaque;
			Props.Hardness = 1.0f;
			Props.Tint = FColor::White;
			Props.UVs.SetAll(FVoxelAtlasRect::FromTile(Id, 4, 0.02f));
		}

		// Glass: visible but not opaque, so it must not hide its neighbours' faces.
		FVoxelBlockProperties& Glass = Palette.AddOrGet(VoxelBlockIds::Glass);
		Glass.bOpaque = false;
		Glass.MaterialSlotIndex = VoxelMaterialSlots::Transparent;

		return Palette;
	}

	FVoxelMesherSettings MakeMesherSettings(EVoxelMesherMode Mode = EVoxelMesherMode::CulledFaces)
	{
		FVoxelMesherSettings Settings;
		Settings.Mode = Mode;
		return Settings;
	}

	FWorldGenerationSettings MakeGenSettings(int32 Seed = 20260101)
	{
		FWorldGenerationSettings Settings;
		Settings.Seed = Seed;
		Settings.WorldHeight = 128;
		Settings.SeaLevel = 40;
		Settings.BaseHeight = 48;
		return Settings;
	}

	FVoxelChunkData MakeChunk(const FVoxelChunkCoord& Coord, const FVoxelDimensions& Dims)
	{
		FVoxelChunkData Chunk;
		Chunk.Allocate(Coord, Dims);
		return Chunk;
	}

	/** Counts quads across every section. */
	int32 CountQuads(const FVoxelMeshResult& Result)
	{
		int32 Quads = 0;
		for (const FVoxelMeshSection& Section : Result.Sections)
		{
			Quads += Section.Vertices.Num() / 4;
		}
		return Quads;
	}

	int32 CountVertices(const FVoxelMeshResult& Result)
	{
		int32 Total = 0;
		for (const FVoxelMeshSection& Section : Result.Sections)
		{
			Total += Section.Vertices.Num();
		}
		return Total;
	}
}

// ===========================================================================
// 1. Coordinate maths - the requirement that negatives and boundaries are exact
// ===========================================================================
void Test_FloorDivMod()
{
	TEST_BEGIN("FloorDiv / FloorMod over all sign combinations")

	const int32 Divisor = 32;
	struct { int32 Value; int32 ExpectedDiv; int32 ExpectedMod; } Cases[] = {
		{ 0, 0, 0 }, { 1, 0, 1 }, { 31, 0, 31 }, { 32, 1, 0 }, { 33, 1, 1 }, { 63, 1, 31 }, { 64, 2, 0 },
		{ -1, -1, 31 }, { -31, -1, 1 }, { -32, -1, 0 }, { -33, -2, 31 }, { -64, -2, 0 }, { -65, -3, 31 }
	};

	for (const auto& Case : Cases)
	{
		CHECK_INT(VoxelCoordinates::FloorDiv(Case.Value, Divisor), Case.ExpectedDiv);
		CHECK_INT(VoxelCoordinates::FloorMod(Case.Value, Divisor), Case.ExpectedMod);
	}

	// The remainder must never be negative: a negative local index would read
	// memory before the start of a chunk's block array.
	for (int32 Value = -2000; Value <= 2000; ++Value)
	{
		const int32 Mod = VoxelCoordinates::FloorMod(Value, Divisor);
		CHECK(Mod >= 0 && Mod < Divisor);
		if (Mod < 0 || Mod >= Divisor) { break; }
	}

	// Shift equivalents must agree with the general form for power-of-two divisors.
	for (int32 Value = -2000; Value <= 2000; ++Value)
	{
		CHECK_INT(VoxelCoordinates::FloorDivShift(Value, 5), VoxelCoordinates::FloorDiv(Value, 32));
		CHECK_INT(VoxelCoordinates::FloorModShift(Value, 5), VoxelCoordinates::FloorMod(Value, 32));
	}

	TEST_END()
}

void Test_WorldVoxelRoundTrip()
{
	TEST_BEGIN("World <-> voxel round trip, including negatives")

	const float BlockSize = 100.0f;

	struct { double X; int32 ExpectedVoxelX; } Cases[] = {
		{ 0.0, 0 }, { 99.0, 0 }, { 100.0, 1 }, { 199.5, 1 }, { -0.5, -1 }, { -1.0, -1 },
		{ -99.0, -1 }, { -100.0, -1 }, { -100.5, -2 }, { -200.0, -2 }
	};

	for (const auto& Case : Cases)
	{
		const FIntVector Voxel = VoxelCoordinates::WorldToVoxel(FVector(Case.X, 0.0, 0.0), BlockSize);
		CHECK_INT(Voxel.X, Case.ExpectedVoxelX);
	}

	// Centre of every block must map back to that block. This is the property the
	// player's "which block am I looking at" trace depends on.
	const int32 Samples[] = { -5000, -33, -1, 0, 1, 32, 999, 5000, 123456 };
	for (int32 X : Samples)
	{
		for (int32 Z : Samples)
		{
			const FIntVector Voxel(X, -X, Z);
			const FVector Centre = VoxelCoordinates::VoxelToWorldCenter(Voxel, BlockSize);
			const FIntVector Back = VoxelCoordinates::WorldToVoxel(Centre, BlockSize);
			CHECK(Back == Voxel);

			const FVector Min = VoxelCoordinates::VoxelToWorld(Voxel, BlockSize);
			CHECK(VoxelCoordinates::WorldToVoxel(Min, BlockSize) == Voxel);
		}
	}

	// Large world coordinates: 500 km from the origin in both directions. Going
	// through float here would lose whole blocks; this proves the double path.
	const FIntVector Far(5000000, -5000000, 120);
	const FVector FarCentre = VoxelCoordinates::VoxelToWorldCenter(Far, BlockSize);
	CHECK(VoxelCoordinates::WorldToVoxel(FarCentre, BlockSize) == Far);
	CHECK_FLOAT(FarCentre.X, 500000050.0, 1e-3);

	TEST_END()
}

void Test_ChunkCoordinates()
{
	TEST_BEGIN("Chunk coordinates, including the required negative cases")

	const FVoxelDimensions Dims = MakeDims(32, 32, 128, 100.0f);

	// The specific cases called out in the requirements.
	CHECK(VoxelCoordinates::VoxelToChunk(FIntVector(32, 0, 0), Dims) == FVoxelChunkCoord(1, 0));
	CHECK(VoxelCoordinates::VoxelToChunk(FIntVector(-1, 0, 0), Dims) == FVoxelChunkCoord(-1, 0));
	CHECK(VoxelCoordinates::VoxelToChunk(FIntVector(0, -1, 0), Dims) == FVoxelChunkCoord(0, -1));
	CHECK(VoxelCoordinates::VoxelToChunk(FIntVector(-32, -32, 0), Dims) == FVoxelChunkCoord(-1, -1));
	CHECK(VoxelCoordinates::VoxelToChunk(FIntVector(-33, 1, 0), Dims) == FVoxelChunkCoord(-2, 0));
	CHECK(VoxelCoordinates::VoxelToChunk(FIntVector(0, 0, -5), Dims) == FVoxelChunkCoord(0, 0)); // Z is not chunked

	// Every voxel of a chunk must resolve back to that chunk, for a spread of
	// chunk coordinates on both sides of the origin.
	const FVoxelChunkCoord Coords[] = { { 0, 0 }, { 1, 0 }, { -1, 0 }, { 0, -1 }, { -1, -1 }, { 7, -3 }, { -120, 45 } };
	for (const FVoxelChunkCoord& Coord : Coords)
	{
		const FIntVector Origin = VoxelCoordinates::ChunkToVoxel(Coord, Dims);
		CHECK(VoxelCoordinates::VoxelToChunk(Origin, Dims) == Coord);

		for (int32 Z : { 0, 1, 63, 127 })
		{
			for (int32 Y : { 0, 1, 15, 31 })
			{
				for (int32 X : { 0, 1, 15, 31 })
				{
					const FIntVector Voxel = Origin + FIntVector(X, Y, Z);
					CHECK(VoxelCoordinates::VoxelToChunk(Voxel, Dims) == Coord);

					const FIntVector Local = VoxelCoordinates::VoxelToLocal(Voxel, Coord, Dims);
					CHECK_INT(Local.X, X);
					CHECK_INT(Local.Y, Y);
					CHECK_INT(Local.Z, Z);
					CHECK(VoxelCoordinates::LocalToVoxel(Local, Coord, Dims) == Voxel);
				}
			}
		}

		// World space agrees with voxel space about which chunk a position is in.
		const FVector ChunkMin = VoxelCoordinates::ChunkToWorld(Coord, Dims);
		const FVector ChunkCentre = VoxelCoordinates::ChunkToWorldCenter(Coord, Dims);
		CHECK(VoxelCoordinates::WorldToChunk(ChunkMin, Dims) == Coord);
		CHECK(VoxelCoordinates::WorldToChunk(ChunkCentre, Dims) == Coord);
		CHECK(VoxelCoordinates::ChunkContainsWorldPosition(Coord, ChunkCentre, Dims));
		CHECK(!VoxelCoordinates::ChunkContainsWorldPosition(Coord, ChunkCentre + FVector(100000.0, 0.0, 0.0), Dims));

		const FBox Bounds = VoxelCoordinates::ChunkWorldBounds(Coord, Dims);
		CHECK_FLOAT(Bounds.Min.X, ChunkMin.X, 1e-6);
		CHECK_FLOAT(Bounds.Max.X - Bounds.Min.X, 3200.0, 1e-3);
		CHECK_FLOAT(Bounds.Max.Z - Bounds.Min.Z, 12800.0, 1e-3);
	}

	// Chunk spacing must be exact: neighbouring chunks are exactly one chunk apart,
	// including across zero, where a sign error would collapse them onto each other.
	for (int32 X = -3; X <= 3; ++X)
	{
		const FVector A = VoxelCoordinates::ChunkToWorld(FVoxelChunkCoord(X, 0), Dims);
		const FVector B = VoxelCoordinates::ChunkToWorld(FVoxelChunkCoord(X + 1, 0), Dims);
		CHECK_FLOAT(B.X - A.X, 3200.0, 1e-3);
	}

	TEST_END()
}

void Test_LocalIndexing()
{
	TEST_BEGIN("Local index <-> coordinate round trip and bounds rejection")

	const FVoxelDimensions Dims = MakeDims(8, 4, 16, 100.0f);
	const int32 Count = Dims.NumBlocks();
	CHECK_INT(Count, 8 * 4 * 16);

	for (int32 Index = 0; Index < Count; ++Index)
	{
		const FIntVector Local = VoxelCoordinates::IndexToLocal(Index, Dims);
		CHECK(VoxelCoordinates::IsInsideChunk(Local, Dims));
		CHECK_INT(VoxelCoordinates::LocalToIndex(Local, Dims), Index);
	}

	// Out of range in every direction must be refused, never wrapped.
	CHECK_INT(VoxelCoordinates::LocalToIndex(FIntVector(-1, 0, 0), Dims), INDEX_NONE);
	CHECK_INT(VoxelCoordinates::LocalToIndex(FIntVector(8, 0, 0), Dims), INDEX_NONE);
	CHECK_INT(VoxelCoordinates::LocalToIndex(FIntVector(0, 4, 0), Dims), INDEX_NONE);
	CHECK_INT(VoxelCoordinates::LocalToIndex(FIntVector(0, 0, 16), Dims), INDEX_NONE);
	CHECK_INT(VoxelCoordinates::LocalToIndex(FIntVector(0, 0, -1), Dims), INDEX_NONE);
	CHECK_INT(VoxelCoordinates::IndexToLocal(-1, Dims).X, INDEX_NONE);
	CHECK_INT(VoxelCoordinates::IndexToLocal(Count, Dims).X, INDEX_NONE);

	// X is the fastest axis: index 1 is (1,0,0), not (0,1,0).
	CHECK(VoxelCoordinates::IndexToLocal(1, Dims) == FIntVector(1, 0, 0));
	CHECK(VoxelCoordinates::IndexToLocal(8, Dims) == FIntVector(0, 1, 0));
	CHECK(VoxelCoordinates::IndexToLocal(32, Dims) == FIntVector(0, 0, 1));

	TEST_END()
}

// ===========================================================================
// 2. Chunk data
// ===========================================================================
void Test_ChunkDataBasics()
{
	TEST_BEGIN("Chunk allocation, access and out-of-range refusal")

	const FVoxelDimensions Dims = MakeDims(32, 32, 128, 100.0f);
	FVoxelChunkData Chunk = MakeChunk(FVoxelChunkCoord(-2, 3), Dims);

	CHECK(Chunk.IsAllocated());
	CHECK_INT(Chunk.Blocks.Num(), 32 * 32 * 128);
	CHECK(Chunk.IsUniform(0));
	CHECK(Chunk.IsEmpty());
	CHECK_INT(Chunk.MaxUsedZ, -1);
	CHECK_INT(Chunk.GetBlockId(0, 0, 0), 0);

	// Reads outside the chunk return air instead of reading neighbouring memory.
	CHECK_INT(Chunk.GetBlockId(-1, 0, 0), 0);
	CHECK_INT(Chunk.GetBlockId(32, 0, 0), 0);
	CHECK_INT(Chunk.GetBlockId(0, 0, 128), 0);
	CHECK(!Chunk.SetBlock(-1, 0, 0, FVoxelBlock::Make(3)));
	CHECK(!Chunk.SetBlock(0, 0, 128, FVoxelBlock::Make(3)));

	CHECK(Chunk.SetBlock(5, 7, 70, FVoxelBlock::Make(VoxelBlockIds::Stone)));
	CHECK_INT(Chunk.GetBlockId(5, 7, 70), VoxelBlockIds::Stone);
	CHECK_INT(Chunk.MaxUsedZ, 70);
	CHECK_INT(Chunk.MinUsedZ, 70);
	CHECK(!Chunk.IsEmpty());
	CHECK(!Chunk.IsUniform(0));

	// Meta and flags survive a write, so per-block gameplay data is not lost.
	FVoxelBlock Detailed = FVoxelBlock::Make(VoxelBlockIds::Wood, 9, 0);
	Detailed.SetRotation(2);
	Detailed.SetVariant(3);
	CHECK(Chunk.SetBlock(1, 1, 1, Detailed));
	const FVoxelBlock Read = Chunk.GetBlock(1, 1, 1);
	CHECK_INT(Read.BlockId, VoxelBlockIds::Wood);
	CHECK_INT(Read.Meta, 9);
	CHECK_INT(Read.GetRotation(), 2);
	CHECK_INT(Read.GetVariant(), 3);

	// Removing the top block must shrink the used range, otherwise meshing keeps
	// walking empty layers forever.
	CHECK(Chunk.SetBlock(5, 7, 70, FVoxelBlock::MakeAir()));
	CHECK_INT(Chunk.MaxUsedZ, 1);

	// Absolute voxel access on a chunk that is not at the origin.
	const FIntVector Voxel = Chunk.LocalToVoxel(FIntVector(4, 4, 40));
	CHECK_INT(Voxel.X, -2 * 32 + 4);
	CHECK_INT(Voxel.Y, 3 * 32 + 4);
	CHECK(Chunk.ContainsVoxel(Voxel));
	CHECK(Chunk.SetBlockAtVoxel(Voxel, FVoxelBlock::Make(VoxelBlockIds::Grass)));
	CHECK_INT(Chunk.GetBlockAtVoxel(Voxel).BlockId, VoxelBlockIds::Grass);
	CHECK(!Chunk.SetBlockAtVoxel(Voxel + FIntVector(40, 0, 0), FVoxelBlock::Make(VoxelBlockIds::Grass)));

	// An unallocated chunk refuses writes rather than growing on demand.
	FVoxelChunkData Empty;
	CHECK(!Empty.IsAllocated());
	CHECK(!Empty.SetBlock(0, 0, 0, FVoxelBlock::Make(1)));
	CHECK(!Empty.IsUniform(0));

	// Memory accounting is the number the streaming budget is built on.
	CHECK_INT(static_cast<long long>(Chunk.GetAllocatedBytes()),
		static_cast<long long>(32) * 32 * 128 * 4 + static_cast<long long>(Chunk.Modifications.Edits.Num()) * 8);

	Chunk.Release();
	CHECK(!Chunk.IsAllocated());
	CHECK_INT(Chunk.Blocks.Num(), 0);

	TEST_END()
}

void Test_ChunkModifications()
{
	TEST_BEGIN("Modification tracking and save packing round trip")

	const FVoxelDimensions Dims = MakeDims(16, 16, 64, 100.0f);
	FVoxelChunkData Chunk = MakeChunk(FVoxelChunkCoord(-1, -1), Dims);

	Chunk.SetBlock(0, 0, 0, FVoxelBlock::Make(VoxelBlockIds::Stone));
	Chunk.SetBlock(1, 0, 0, FVoxelBlock::Make(VoxelBlockIds::Stone));
	CHECK_INT(Chunk.Modifications.Edits.Num(), 2);

	// Writing the same value twice is not a second edit, and rewriting a voxel
	// replaces its edit instead of appending another one.
	Chunk.SetBlock(0, 0, 0, FVoxelBlock::Make(VoxelBlockIds::Stone));
	CHECK_INT(Chunk.Modifications.Edits.Num(), 2);
	Chunk.SetBlock(0, 0, 0, FVoxelBlock::Make(VoxelBlockIds::Dirt));
	CHECK_INT(Chunk.Modifications.Edits.Num(), 2);
	CHECK_INT(Chunk.Modifications.Edits[0].Block.BlockId, VoxelBlockIds::Dirt);

	// Generated terrain must never be recorded as an edit: that is the whole point
	// of only saving deltas.
	Chunk.SetBlock(5, 5, 5, FVoxelBlock::Make(VoxelBlockIds::Sand), false);
	CHECK_INT(Chunk.Modifications.Edits.Num(), 2);
	CHECK_INT(Chunk.GetBlockId(5, 5, 5), VoxelBlockIds::Sand);

	Chunk.SetBlock(15, 15, 63, FVoxelBlock::Make(VoxelBlockIds::Glass, 4, 7));
	CHECK_INT(Chunk.Modifications.Edits.Num(), 3);

	// Edits stay index sorted, which is what makes packing deterministic.
	CHECK(Chunk.Modifications.Edits[0].LocalIndex < Chunk.Modifications.Edits[1].LocalIndex);
	CHECK(Chunk.Modifications.Edits[1].LocalIndex < Chunk.Modifications.Edits[2].LocalIndex);

	Chunk.Modifications.Coord = Chunk.Coord;
	Chunk.Modifications.Pack();
	CHECK_INT(Chunk.Modifications.PackedBytes.Num(), 4 + 3 * 8);

	// Same edits must always produce the same bytes, so saves can be compared.
	TArray<uint8> FirstPass = Chunk.Modifications.PackedBytes;
	Chunk.Modifications.Pack();
	CHECK_INT(Chunk.Modifications.PackedBytes.Num(), FirstPass.Num());
	bool bIdentical = true;
	for (int32 Index = 0; Index < FirstPass.Num(); ++Index)
	{
		if (FirstPass[Index] != Chunk.Modifications.PackedBytes[Index]) { bIdentical = false; break; }
	}
	CHECK(bIdentical);

	FVoxelChunkModification Restored;
	Restored.PackedBytes = Chunk.Modifications.PackedBytes;
	CHECK(Restored.Unpack());
	CHECK_INT(Restored.Edits.Num(), 3);
	for (int32 Index = 0; Index < 3; ++Index)
	{
		CHECK_INT(Restored.Edits[Index].LocalIndex, Chunk.Modifications.Edits[Index].LocalIndex);
		CHECK(Restored.Edits[Index].Block == Chunk.Modifications.Edits[Index].Block);
	}
	CHECK_INT(Restored.Edits[2].Block.Meta, 4);
	CHECK_INT(Restored.Edits[2].Block.Flags, 7);

	// A truncated blob must be rejected, not partially applied.
	FVoxelChunkModification Truncated;
	Truncated.PackedBytes = Chunk.Modifications.PackedBytes;
	Truncated.PackedBytes.SetNum(Truncated.PackedBytes.Num() - 3);
	CHECK(!Truncated.Unpack());
	CHECK_INT(Truncated.Edits.Num(), 0);

	// A blob whose header lies about the edit count must be rejected too.
	FVoxelChunkModification Lying;
	Lying.PackedBytes = Chunk.Modifications.PackedBytes;
	const int32 BigCount = 9999;
	FMemory::Memcpy(Lying.PackedBytes.GetData(), &BigCount, sizeof(int32));
	CHECK(!Lying.Unpack());

	// An empty blob legitimately means "this chunk was never edited".
	FVoxelChunkModification EmptyBlob;
	CHECK(EmptyBlob.Unpack());
	CHECK_INT(EmptyBlob.Edits.Num(), 0);

	TEST_END()
}

// ===========================================================================
// 3. Noise: determinism is a correctness requirement, not a nice-to-have
// ===========================================================================
void Test_NoiseDeterminism()
{
	TEST_BEGIN("Noise determinism, range and smoothness")

	const int32 Seed = 20260101;

	// Identical inputs must give bit-identical outputs. Generated chunks are never
	// saved, so this is the property that makes saves possible at all.
	for (int32 Pass = 0; Pass < 2; ++Pass)
	{
		for (int32 X = -64; X <= 64; X += 7)
		{
			for (int32 Y = -64; Y <= 64; Y += 11)
			{
				const float First = VoxelNoise::Fbm2D(X * 0.01f, Y * 0.01f, Seed, 4);
				const float Second = VoxelNoise::Fbm2D(X * 0.01f, Y * 0.01f, Seed, 4);
				CHECK(First == Second);
			}
		}
	}

	// Hash quality: the mean of the unit hash must sit near 0.5. A mixer that
	// collapses bits shows up here immediately as a skewed mean.
	double Sum = 0.0;
	int32 Buckets[8] = { 0, 0, 0, 0, 0, 0, 0, 0 };
	const int32 Samples = 20000;
	for (int32 Index = 0; Index < Samples; ++Index)
	{
		const float Unit = VoxelNoise::HashToUnit(VoxelNoise::Hash(Index, Index * 7 + 1, Index * 13 - 5, Seed));
		CHECK(Unit >= 0.0f && Unit < 1.0f);
		Sum += Unit;
		++Buckets[FMath::Clamp(static_cast<int32>(Unit * 8.0f), 0, 7)];
	}
	CHECK_FLOAT(Sum / Samples, 0.5, 0.02);

	const int32 ExpectedBucket = Samples / 8;
	for (int32 Bucket = 0; Bucket < 8; ++Bucket)
	{
		// A loose bound: this is a smoke test for gross distribution failure, not a
		// statistical certification of the mixer.
		CHECK(std::abs(Buckets[Bucket] - ExpectedBucket) < ExpectedBucket / 3);
	}

	// Ranges.
	for (int32 X = -500; X <= 500; X += 13)
	{
		for (int32 Y = -500; Y <= 500; Y += 17)
		{
			const float Value = VoxelNoise::Value2D(X * 0.03f, Y * 0.03f, Seed);
			CHECK(Value >= -1.0f && Value <= 1.0f);

			const float Fbm = VoxelNoise::Fbm2D(X * 0.03f, Y * 0.03f, Seed, 5);
			CHECK(Fbm >= -1.0f && Fbm <= 1.0f);

			const float Ridged = VoxelNoise::Ridged2D(X * 0.03f, Y * 0.03f, Seed, 4);
			CHECK(Ridged >= 0.0f && Ridged <= 1.0f);

			const float Value3D = VoxelNoise::Value3D(X * 0.03f, Y * 0.03f, 0.7f, Seed);
			CHECK(Value3D >= -1.0f && Value3D <= 1.0f);
		}
	}

	// Different seeds must produce different terrain.
	CHECK(VoxelNoise::Fbm2D(0.25f, 0.75f, 1, 4) != VoxelNoise::Fbm2D(0.25f, 0.75f, 2, 4));

	// Continuity: adjacent samples must be close. A noise field that jumps between
	// neighbouring integers produces terrain that looks like static.
	float WorstJump = 0.0f;
	for (int32 Index = 0; Index < 2000; ++Index)
	{
		const float T = Index * 0.013f;
		WorstJump = FMath::Max(WorstJump,
			FMath::Abs(VoxelNoise::Value2D(T, 0.31f, Seed) - VoxelNoise::Value2D(T + 0.01f, 0.31f, Seed)));
	}
	CHECK(WorstJump < 0.15f);

	// Ridged noise must actually peak: its maximum over a region should be well
	// above its mean, otherwise mountains would be flat.
	float RidgedMax = 0.0f, RidgedSum = 0.0f;
	int32 RidgedCount = 0;
	for (int32 X = 0; X < 200; ++X)
	{
		for (int32 Y = 0; Y < 200; ++Y)
		{
			const float R = VoxelNoise::Ridged2D(X * 0.05f, Y * 0.05f, Seed, 4);
			RidgedMax = FMath::Max(RidgedMax, R);
			RidgedSum += R;
			++RidgedCount;
		}
	}
	CHECK(RidgedMax > (RidgedSum / RidgedCount) * 1.5f);

	TEST_END()
}

// ===========================================================================
// 4. Palette
// ===========================================================================
void Test_BlockPalette()
{
	TEST_BEGIN("Palette growth and invalid-id degradation")

	FVoxelBlockPalette Palette;
	CHECK_INT(Palette.Num(), 0);
	CHECK(!Palette.Contains(5));

	// Asking for an id that does not exist must degrade to air, never assert or
	// read out of bounds: a designer removing a block definition cannot be allowed
	// to crash a running world.
	const FVoxelBlockProperties& Missing = Palette.Get(5);
	CHECK_INT(Missing.BlockId, 0);
	CHECK(!Missing.bSolid);
	CHECK(!Missing.IsRenderable());

	FVoxelBlockProperties& Added = Palette.AddOrGet(5);
	Added.BlockId = 5;
	Added.MeshBehaviour = EVoxelBlockMeshBehaviour::FullCube;
	CHECK_INT(Palette.Num(), 6);
	CHECK(Palette.Contains(5));
	CHECK(Palette.Get(5).IsRenderable());

	// Gaps are filled with air, so every index below the highest id is valid.
	for (int32 Index = 0; Index < 5; ++Index)
	{
		CHECK(!Palette.Get(static_cast<uint16>(Index)).IsRenderable());
	}

	// Atlas rect maths, including padding, which is what stops tile bleed.
	const FVoxelAtlasRect Rect = FVoxelAtlasRect::FromTile(5, 4, 0.0f);
	CHECK_FLOAT(Rect.UMin, 0.25f, 1e-6);
	CHECK_FLOAT(Rect.VMin, 0.25f, 1e-6);
	CHECK_FLOAT(Rect.UMax, 0.50f, 1e-6);
	CHECK_FLOAT(Rect.VMax, 0.50f, 1e-6);

	const FVoxelAtlasRect Padded = FVoxelAtlasRect::FromTile(0, 4, 0.1f);
	CHECK(Padded.UMin > 0.0f);
	CHECK(Padded.UMax < 0.25f);
	CHECK(Padded.Width() < 0.25f);

	// A degenerate atlas must not divide by zero.
	const FVoxelAtlasRect Degenerate = FVoxelAtlasRect::FromTile(3, 0, 0.0f);
	CHECK_FLOAT(Degenerate.UMin, 0.0f, 1e-6);
	CHECK_FLOAT(Degenerate.UMax, 1.0f, 1e-6);

	TEST_END()
}

// ===========================================================================
// 5. Meshing
// ===========================================================================
namespace
{
	/**
	 * Every triangle must be wound so that the right-handed cross product points
	 * AWAY from the declared normal. UE is left handed and treats clockwise-from-
	 * front as facing the viewer, so this is the check that proves no face is
	 * invisible from outside - the failure mode that shows up as terrain you can
	 * see through from one side only.
	 */
	bool WindingIsConsistent(const FVoxelMeshResult& Result)
	{
		for (const FVoxelMeshSection& Section : Result.Sections)
		{
			if (Section.Triangles.Num() % 3 != 0) { return false; }

			for (int32 Index = 0; Index < Section.Triangles.Num(); Index += 3)
			{
				const int32 A = Section.Triangles[Index];
				const int32 B = Section.Triangles[Index + 1];
				const int32 C = Section.Triangles[Index + 2];

				if (!Section.Vertices.IsValidIndex(A) || !Section.Vertices.IsValidIndex(B) || !Section.Vertices.IsValidIndex(C))
				{
					return false;
				}
				if (A == B || B == C || A == C)
				{
					return false; // Degenerate triangle.
				}

				const FVector Cross = FVector::CrossProduct(Section.Vertices[B] - Section.Vertices[A],
					Section.Vertices[C] - Section.Vertices[A]);
				const FVector Normal = Section.Normals.IsValidIndex(A) ? Section.Normals[A] : FVector(0, 0, 0);

				if (FVector::DotProduct(Cross, Normal) >= 0.0)
				{
					return false;
				}
			}
		}
		return true;
	}

	bool WindingIsConsistent(const FVoxelCollisionMesh& Mesh)
	{
		FVoxelMeshResult Wrapper;
		FVoxelMeshSection& Section = Wrapper.Sections.AddDefaulted();
		Section.Vertices = Mesh.Vertices;
		Section.Triangles = Mesh.Triangles;

		// Collision has no normals; derive the expected one from the first triangle
		// of each quad and require the second to agree.
		for (int32 Index = 0; Index + 5 < Mesh.Triangles.Num(); Index += 6)
		{
			const FVector& A = Mesh.Vertices[Mesh.Triangles[Index]];
			const FVector& B = Mesh.Vertices[Mesh.Triangles[Index + 1]];
			const FVector& C = Mesh.Vertices[Mesh.Triangles[Index + 2]];
			const FVector& D = Mesh.Vertices[Mesh.Triangles[Index + 5]];

			const FVector First = FVector::CrossProduct(B - A, C - A);
			const FVector Second = FVector::CrossProduct(C - A, D - A);
			if (FVector::DotProduct(First, Second) <= 0.0)
			{
				return false;
			}
		}
		return true;
	}

	bool AllUVsInsideAtlas(const FVoxelMeshResult& Result)
	{
		for (const FVoxelMeshSection& Section : Result.Sections)
		{
			for (const FVector2D& UV : Section.UVs)
			{
				if (UV.X < -1e-3f || UV.X > 1.0f + 1e-3f || UV.Y < -1e-3f || UV.Y > 1.0f + 1e-3f)
				{
					return false;
				}
			}
		}
		return true;
	}

	/** True when every vertex sharing a normal also shares a colour (i.e. no AO). */
	bool ColorsAreUniformPerFace(const FVoxelMeshResult& Result)
	{
		for (const FVoxelMeshSection& Section : Result.Sections)
		{
			for (int32 Index = 0; Index < Section.Vertices.Num(); Index += 4)
			{
				if (Index + 3 >= Section.Vertices.Num()) { break; }
				const FColor Reference = Section.Colors[Index];
				for (int32 Corner = 1; Corner < 4; ++Corner)
				{
					if (!(Section.Colors[Index + Corner] == Reference))
					{
						return false;
					}
				}
			}
		}
		return true;
	}
}

void Test_MesherSingleBlock()
{
	TEST_BEGIN("Mesher: one block, face counts and winding")

	const FVoxelDimensions Dims = MakeDims(16, 16, 64, 100.0f);
	const FVoxelBlockPalette Palette = MakeTestPalette();

	FVoxelChunkData Chunk = MakeChunk(FVoxelChunkCoord(0, 0), Dims);
	Chunk.SetBlock(5, 5, 10, FVoxelBlock::Make(VoxelBlockIds::Stone), false);

	const FVoxelBlockSnapshot Snapshot(Chunk);
	const FVoxelCulledMesher Culled;

	FVoxelMesherSettings Settings = MakeMesherSettings(EVoxelMesherMode::CulledFaces);
	FVoxelMeshResult Result;
	Culled.GenerateVisualMesh(Snapshot, Palette, Settings, Result);

	CHECK(Result.IsValid());
	CHECK_INT(Result.TotalFaces, 6);           // Floating block: nothing to cull.
	CHECK_INT(CountQuads(Result), 6);
	CHECK_INT(CountVertices(Result), 24);
	CHECK_INT(Result.TotalTriangles, 12);
	CHECK_INT(Result.Sections.Num(), 1);
	CHECK_INT(Result.Sections[0].MaterialSlotIndex, VoxelMaterialSlots::Opaque);
	CHECK(WindingIsConsistent(Result));
	CHECK(AllUVsInsideAtlas(Result));
	CHECK(ColorsAreUniformPerFace(Result));    // Nothing adjacent, so AO is 3 everywhere.

	// Local bounds: the block occupies 500..600 in X and Y, 1000..1100 in Z.
	CHECK_FLOAT(Result.Bounds.Min.X, 500.0, 1e-3);
	CHECK_FLOAT(Result.Bounds.Max.X, 600.0, 1e-3);
	CHECK_FLOAT(Result.Bounds.Min.Z, 1000.0, 1e-3);
	CHECK_FLOAT(Result.Bounds.Max.Z, 1100.0, 1e-3);

	// All six face directions must be present exactly once.
	int32 FaceDirectionCounts[6] = { 0, 0, 0, 0, 0, 0 };
	for (const FVoxelMeshSection& Section : Result.Sections)
	{
		for (int32 Index = 0; Index < Section.Normals.Num(); ++Index)
		{
			const FVector& N = Section.Normals[Index];
			for (int32 Face = 0; Face < 6; ++Face)
			{
				const FIntVector Expected = VoxelMeshTables::GetFace(static_cast<EVoxelFace>(Face)).Normal;
				if (N.X == Expected.X && N.Y == Expected.Y && N.Z == Expected.Z)
				{
					++FaceDirectionCounts[Face];
				}
			}
		}
	}
	for (int32 Face = 0; Face < 6; ++Face)
	{
		CHECK_INT(FaceDirectionCounts[Face], 4); // One quad == four vertices per direction.
	}

	// Sitting on the world floor removes the underside.
	FVoxelChunkData FloorChunk = MakeChunk(FVoxelChunkCoord(0, 0), Dims);
	FloorChunk.SetBlock(5, 5, 0, FVoxelBlock::Make(VoxelBlockIds::Stone), false);
	const FVoxelBlockSnapshot FloorSnapshot(FloorChunk);

	FVoxelMeshResult FloorResult;
	Culled.GenerateVisualMesh(FloorSnapshot, Palette, Settings, FloorResult);
	CHECK_INT(FloorResult.TotalFaces, 5);
	CHECK_INT(FloorResult.CulledFaces, 1);

	FVoxelMesherSettings KeepBottom = Settings;
	KeepBottom.bCullWorldBottomFace = false;
	FVoxelMeshResult KeepBottomResult;
	Culled.GenerateVisualMesh(FloorSnapshot, Palette, KeepBottom, KeepBottomResult);
	CHECK_INT(KeepBottomResult.TotalFaces, 6);
	CHECK_INT(KeepBottomResult.CulledFaces, 0);

	TEST_END()
}

void Test_MesherFaceCulling()
{
	TEST_BEGIN("Mesher: shared faces between solid blocks are removed")

	const FVoxelDimensions Dims = MakeDims(16, 16, 64, 100.0f);
	const FVoxelBlockPalette Palette = MakeTestPalette();
	const FVoxelCulledMesher Culled;
	FVoxelMesherSettings Settings = MakeMesherSettings();
	Settings.bEnableAmbientOcclusion = false;

	// Two touching blocks: 12 candidate faces, 2 of them shared, so 10 must survive.
	FVoxelChunkData Pair = MakeChunk(FVoxelChunkCoord(0, 0), Dims);
	Pair.SetBlock(4, 4, 10, FVoxelBlock::Make(VoxelBlockIds::Stone), false);
	Pair.SetBlock(5, 4, 10, FVoxelBlock::Make(VoxelBlockIds::Stone), false);

	FVoxelMeshResult PairResult;
	Culled.GenerateVisualMesh(FVoxelBlockSnapshot(Pair), Palette, Settings, PairResult);
	CHECK_INT(PairResult.TotalFaces, 10);
	CHECK_INT(PairResult.CulledFaces, 2);
	CHECK(WindingIsConsistent(PairResult));

	// A solid 3x3x3 cube resting on the world floor: 27 blocks, 162 candidate faces,
	// 54 shared pairs removing 108 of them, then the 9 undersides culled as the
	// world floor. 45 must remain - exactly the 5 visible sides of a 3x3 cube.
	FVoxelChunkData Cube = MakeChunk(FVoxelChunkCoord(0, 0), Dims);
	for (int32 Z = 0; Z < 3; ++Z)
	{
		for (int32 Y = 0; Y < 3; ++Y)
		{
			for (int32 X = 0; X < 3; ++X)
			{
				Cube.SetBlock(X + 4, Y + 4, Z, FVoxelBlock::Make(VoxelBlockIds::Stone), false);
			}
		}
	}

	FVoxelMeshResult CubeResult;
	Culled.GenerateVisualMesh(FVoxelBlockSnapshot(Cube), Palette, Settings, CubeResult);
	CHECK_INT(CubeResult.TotalFaces, 45);
	CHECK_INT(CubeResult.CulledFaces, 162 - 45);
	CHECK(WindingIsConsistent(CubeResult));

	// Glass next to glass must not draw the internal pane; glass next to stone must
	// draw both surfaces. Getting this wrong either doubles transparent overdraw or
	// leaves holes you can see through a window.
	FVoxelChunkData GlassPair = MakeChunk(FVoxelChunkCoord(0, 0), Dims);
	GlassPair.SetBlock(4, 4, 10, FVoxelBlock::Make(VoxelBlockIds::Glass), false);
	GlassPair.SetBlock(5, 4, 10, FVoxelBlock::Make(VoxelBlockIds::Glass), false);

	FVoxelMeshResult GlassResult;
	Culled.GenerateVisualMesh(FVoxelBlockSnapshot(GlassPair), Palette, Settings, GlassResult);
	CHECK_INT(GlassResult.TotalFaces, 10);
	CHECK_INT(GlassResult.Sections.Num(), 1);
	CHECK_INT(GlassResult.Sections[0].MaterialSlotIndex, VoxelMaterialSlots::Transparent);

	FVoxelChunkData Mixed = MakeChunk(FVoxelChunkCoord(0, 0), Dims);
	Mixed.SetBlock(4, 4, 10, FVoxelBlock::Make(VoxelBlockIds::Glass), false);
	Mixed.SetBlock(5, 4, 10, FVoxelBlock::Make(VoxelBlockIds::Stone), false);

	FVoxelMeshResult MixedResult;
	Culled.GenerateVisualMesh(FVoxelBlockSnapshot(Mixed), Palette, Settings, MixedResult);
	// Stone keeps all 6 faces (glass does not occlude, so the shared face is drawn),
	// glass loses the one against stone, and they land in two material sections.
	CHECK_INT(MixedResult.TotalFaces, 11);
	CHECK_INT(MixedResult.Sections.Num(), 2);

	int32 OpaqueSection = INDEX_NONE, TransparentSection = INDEX_NONE;
	for (int32 Index = 0; Index < MixedResult.Sections.Num(); ++Index)
	{
		if (MixedResult.Sections[Index].MaterialSlotIndex == VoxelMaterialSlots::Opaque) { OpaqueSection = Index; }
		if (MixedResult.Sections[Index].MaterialSlotIndex == VoxelMaterialSlots::Transparent) { TransparentSection = Index; }
	}
	CHECK(OpaqueSection != INDEX_NONE);
	CHECK(TransparentSection != INDEX_NONE);
	if (OpaqueSection != INDEX_NONE && TransparentSection != INDEX_NONE)
	{
		CHECK_INT(MixedResult.Sections[OpaqueSection].FaceCount, 6);
		CHECK_INT(MixedResult.Sections[TransparentSection].FaceCount, 5);
	}

	// Air and non-renderable blocks contribute nothing.
	FVoxelChunkData Nothing = MakeChunk(FVoxelChunkCoord(0, 0), Dims);
	FVoxelMeshResult NothingResult;
	Culled.GenerateVisualMesh(FVoxelBlockSnapshot(Nothing), Palette, Settings, NothingResult);
	CHECK(NothingResult.IsValid());
	CHECK_INT(NothingResult.TotalFaces, 0);
	CHECK_INT(NothingResult.Sections.Num(), 0);

	TEST_END()
}

void Test_MesherAmbientOcclusion()
{
	TEST_BEGIN("Mesher: ambient occlusion darkens enclosed corners only")

	const FVoxelDimensions Dims = MakeDims(16, 16, 64, 100.0f);
	const FVoxelBlockPalette Palette = MakeTestPalette();
	const FVoxelCulledMesher Culled;
	FVoxelMesherSettings Settings = MakeMesherSettings();
	CHECK(Settings.bEnableAmbientOcclusion);

	// A lone block has no occluders: every vertex of every face is equally bright.
	FVoxelChunkData Lone = MakeChunk(FVoxelChunkCoord(0, 0), Dims);
	Lone.SetBlock(6, 6, 10, FVoxelBlock::Make(VoxelBlockIds::Stone), false);

	FVoxelMeshResult LoneResult;
	Culled.GenerateVisualMesh(FVoxelBlockSnapshot(Lone), Palette, Settings, LoneResult);
	CHECK(ColorsAreUniformPerFace(LoneResult));

	// Now put a taller block next to it. The corner of the low block's top face that
	// touches the tall one must be darker than the corner that does not.
	FVoxelChunkData Step = MakeChunk(FVoxelChunkCoord(0, 0), Dims);
	Step.SetBlock(6, 6, 10, FVoxelBlock::Make(VoxelBlockIds::Stone), false);
	Step.SetBlock(7, 6, 11, FVoxelBlock::Make(VoxelBlockIds::Stone), false);

	FVoxelMeshResult StepResult;
	Culled.GenerateVisualMesh(FVoxelBlockSnapshot(Step), Palette, Settings, StepResult);
	CHECK(!ColorsAreUniformPerFace(StepResult));

	// Find the low block's top face (normal +Z at height 1100) and compare its
	// brightest and darkest vertex.
	uint8 Darkest = 255, Brightest = 0;
	bool bFoundTopFace = false;
	for (const FVoxelMeshSection& Section : StepResult.Sections)
	{
		for (int32 Index = 0; Index + 3 < Section.Vertices.Num(); Index += 4)
		{
			if (Section.Normals[Index].Z < 0.5) { continue; }
			if (!FMath::IsNearlyEqual(Section.Vertices[Index].Z, 1100.0, 1e-3)) { continue; }

			bFoundTopFace = true;
			for (int32 Corner = 0; Corner < 4; ++Corner)
			{
				Darkest = FMath::Min(Darkest, Section.Colors[Index + Corner].R);
				Brightest = FMath::Max(Brightest, Section.Colors[Index + Corner].R);
			}
		}
	}
	CHECK(bFoundTopFace);
	CHECK(Brightest > Darkest);
	// The darkest corner is two AO steps down, which must be visibly darker and not
	// a rounding difference.
	CHECK(Brightest - Darkest > 20);

	// Turning AO off must flatten the shading again while keeping identical geometry.
	FVoxelMesherSettings NoAO = Settings;
	NoAO.bEnableAmbientOcclusion = false;
	FVoxelMeshResult NoAOResult;
	Culled.GenerateVisualMesh(FVoxelBlockSnapshot(Step), Palette, NoAO, NoAOResult);
	CHECK(ColorsAreUniformPerFace(NoAOResult));
	CHECK_INT(NoAOResult.TotalFaces, StepResult.TotalFaces);
	CHECK_INT(CountVertices(NoAOResult), CountVertices(StepResult));

	// A fully enclosed corner (two flanking blocks) must bottom out at the darkest
	// AO level and stay there even if the diagonal is also filled.
	FVoxelChunkData Pit = MakeChunk(FVoxelChunkCoord(0, 0), Dims);
	Pit.SetBlock(6, 6, 10, FVoxelBlock::Make(VoxelBlockIds::Stone), false);
	Pit.SetBlock(7, 6, 11, FVoxelBlock::Make(VoxelBlockIds::Stone), false);
	Pit.SetBlock(6, 7, 11, FVoxelBlock::Make(VoxelBlockIds::Stone), false);
	Pit.SetBlock(7, 7, 11, FVoxelBlock::Make(VoxelBlockIds::Stone), false);

	FVoxelMeshResult PitResult;
	Culled.GenerateVisualMesh(FVoxelBlockSnapshot(Pit), Palette, Settings, PitResult);

	uint8 PitDarkest = 255;
	for (const FVoxelMeshSection& Section : PitResult.Sections)
	{
		for (const FColor& Color : Section.Colors)
		{
			PitDarkest = FMath::Min(PitDarkest, Color.R);
		}
	}
	CHECK(PitDarkest < Darkest);

	TEST_END()
}

void Test_MesherGreedy()
{
	TEST_BEGIN("Mesher: greedy merging reduces quads without changing the shape")

	const FVoxelDimensions Dims = MakeDims(16, 16, 64, 100.0f);
	const FVoxelBlockPalette Palette = MakeTestPalette();

	// A flat 8x8 platform on the world floor.
	FVoxelChunkData Platform = MakeChunk(FVoxelChunkCoord(0, 0), Dims);
	for (int32 Y = 0; Y < 8; ++Y)
	{
		for (int32 X = 0; X < 8; ++X)
		{
			Platform.SetBlock(X, Y, 0, FVoxelBlock::Make(VoxelBlockIds::Stone), false);
		}
	}
	const FVoxelBlockSnapshot Snapshot(Platform);

	FVoxelMesherSettings CulledSettings = MakeMesherSettings(EVoxelMesherMode::CulledFaces);
	CulledSettings.bEnableAmbientOcclusion = false;

	FVoxelMeshResult CulledResult;
	FVoxelCulledMesher().GenerateVisualMesh(Snapshot, Palette, CulledSettings, CulledResult);

	// 64 tops plus 8x4 sides; the 64 undersides are the world floor and are culled.
	CHECK_INT(CulledResult.TotalFaces, 64 + 32);
	CHECK_INT(CountQuads(CulledResult), 96);

	FVoxelMesherSettings GreedySettings = MakeMesherSettings(EVoxelMesherMode::Greedy);
	FVoxelMeshResult GreedyResult;
	FVoxelGreedyMesher().GenerateVisualMesh(Snapshot, Palette, GreedySettings, GreedyResult);

	CHECK(GreedyResult.IsValid());
	// One merged top, one merged rect per side, no underside: five quads total.
	CHECK_INT(CountQuads(GreedyResult), 5);
	CHECK_INT(CountVertices(GreedyResult), 20);
	CHECK_INT(GreedyResult.TotalTriangles, 10);

	// Merging reports the faces it stands in for, so the statistics stay comparable
	// between meshers instead of looking like geometry went missing.
	CHECK_INT(GreedyResult.TotalFaces, CulledResult.TotalFaces);

	// The silhouette must be identical: greedy changes triangle count, not shape.
	CHECK_FLOAT(GreedyResult.Bounds.Min.X, CulledResult.Bounds.Min.X, 1e-3);
	CHECK_FLOAT(GreedyResult.Bounds.Min.Y, CulledResult.Bounds.Min.Y, 1e-3);
	CHECK_FLOAT(GreedyResult.Bounds.Min.Z, CulledResult.Bounds.Min.Z, 1e-3);
	CHECK_FLOAT(GreedyResult.Bounds.Max.X, CulledResult.Bounds.Max.X, 1e-3);
	CHECK_FLOAT(GreedyResult.Bounds.Max.Y, CulledResult.Bounds.Max.Y, 1e-3);
	CHECK_FLOAT(GreedyResult.Bounds.Max.Z, CulledResult.Bounds.Max.Z, 1e-3);
	CHECK(WindingIsConsistent(GreedyResult));

	// Different block ids must never merge into one quad, or a grass stripe would
	// come out painted with whichever texture won the merge.
	FVoxelChunkData Striped = MakeChunk(FVoxelChunkCoord(0, 0), Dims);
	for (int32 Y = 0; Y < 8; ++Y)
	{
		for (int32 X = 0; X < 8; ++X)
		{
			const uint16 Id = ((X + Y) % 2 == 0) ? VoxelBlockIds::Grass : VoxelBlockIds::Sand;
			Striped.SetBlock(X, Y, 0, FVoxelBlock::Make(Id), false);
		}
	}

	FVoxelMeshResult StripedResult;
	FVoxelGreedyMesher().GenerateVisualMesh(FVoxelBlockSnapshot(Striped), Palette, GreedySettings, StripedResult);
	CHECK_INT(StripedResult.Sections.Num(), 1);   // Same material slot...
	CHECK(CountQuads(StripedResult) > 5);         // ...but a checkerboard cannot merge.
	CHECK_INT(StripedResult.TotalFaces, 64 + 32);

	// Greedy UVs tile once per block spanned, so a merged 8-wide quad covers eight
	// tiles instead of stretching one texture across eight metres. The test atlas is
	// 4x4, so one tile is 0.25 of UV space and the widest quad spans eight of them.
	const float TileWidth = 0.25f;
	float WidestUSpan = 0.0f;
	float WidestVSpan = 0.0f;

	for (const FVoxelMeshSection& Section : GreedyResult.Sections)
	{
		for (int32 Index = 0; Index + 3 < Section.UVs.Num(); Index += 4)
		{
			float MinU = 1e9f, MaxU = -1e9f, MinV = 1e9f, MaxV = -1e9f;
			for (int32 Corner = 0; Corner < 4; ++Corner)
			{
				MinU = FMath::Min(MinU, Section.UVs[Index + Corner].X);
				MaxU = FMath::Max(MaxU, Section.UVs[Index + Corner].X);
				MinV = FMath::Min(MinV, Section.UVs[Index + Corner].Y);
				MaxV = FMath::Max(MaxV, Section.UVs[Index + Corner].Y);
				CHECK(Section.UVs[Index + Corner].X >= -1e-3f);
				CHECK(Section.UVs[Index + Corner].Y >= -1e-3f);
			}
			WidestUSpan = FMath::Max(WidestUSpan, MaxU - MinU);
			WidestVSpan = FMath::Max(WidestVSpan, MaxV - MinV);
		}
	}

	CHECK(WidestUSpan > TileWidth * 1.5f);
	CHECK(WidestVSpan > TileWidth * 1.5f);
	CHECK(WidestUSpan <= TileWidth * 8.0f + 1e-3f);
	CHECK(WidestVSpan <= TileWidth * 8.0f + 1e-3f);

	TEST_END()
}

void Test_MesherCollision()
{
	TEST_BEGIN("Mesher: collision is separate, merged and consistent")

	const FVoxelDimensions Dims = MakeDims(16, 16, 64, 100.0f);
	const FVoxelBlockPalette Palette = MakeTestPalette();

	FVoxelChunkData Platform = MakeChunk(FVoxelChunkCoord(0, 0), Dims);
	for (int32 Y = 0; Y < 8; ++Y)
	{
		for (int32 X = 0; X < 8; ++X)
		{
			Platform.SetBlock(X, Y, 0, FVoxelBlock::Make(VoxelBlockIds::Stone), false);
		}
	}
	const FVoxelBlockSnapshot Snapshot(Platform);

	FVoxelMesherSettings Settings = MakeMesherSettings();

	FVoxelCollisionMesh Collision;
	FVoxelCulledMesher().GenerateCollisionMesh(Snapshot, Palette, Settings, Collision);

	CHECK(Collision.Error == EVoxelMeshError::None);
	CHECK(!Collision.IsEmpty());
	CHECK_INT(Collision.Triangles.Num() % 3, 0);
	CHECK_INT(Collision.Vertices.Num(), 20);    // Five merged rects, same as greedy visual.
	CHECK(WindingIsConsistent(Collision));

	// Both meshers must produce identical collision: collision never depends on the
	// visual LOD, or walking over a hill would change as you approached it.
	FVoxelCollisionMesh GreedyCollision;
	FVoxelGreedyMesher().GenerateCollisionMesh(Snapshot, Palette, Settings, GreedyCollision);
	CHECK_INT(GreedyCollision.Vertices.Num(), Collision.Vertices.Num());
	CHECK_INT(GreedyCollision.Triangles.Num(), Collision.Triangles.Num());

	// The top of the platform must be a walkable surface at z=100.
	CHECK_FLOAT(Collision.Bounds.Max.Z, 100.0, 1e-3);
	CHECK_FLOAT(Collision.Bounds.Min.Z, 0.0, 1e-3);

	// A non-solid block must contribute no collision at all, otherwise decoration
	// would stop the player walking through it.
	FVoxelBlockPalette WithDecoration = Palette;
	FVoxelBlockProperties& Decoration = WithDecoration.AddOrGet(11);
	Decoration.BlockId = 11;
	Decoration.MeshBehaviour = EVoxelBlockMeshBehaviour::FullCube;
	Decoration.CollisionType = EVoxelBlockCollisionType::None;
	Decoration.bOpaque = false;
	Decoration.bSolid = false;

	FVoxelChunkData Decorated = MakeChunk(FVoxelChunkCoord(0, 0), Dims);
	Decorated.SetBlock(2, 2, 1, FVoxelBlock::Make(11), false);

	FVoxelCollisionMesh DecorationCollision;
	FVoxelCulledMesher().GenerateCollisionMesh(FVoxelBlockSnapshot(Decorated), WithDecoration, Settings, DecorationCollision);
	CHECK(DecorationCollision.IsEmpty());

	FVoxelMeshResult DecorationVisual;
	FVoxelCulledMesher().GenerateVisualMesh(FVoxelBlockSnapshot(Decorated), WithDecoration, Settings, DecorationVisual);
	CHECK_INT(DecorationVisual.TotalFaces, 6);   // Visible, but not solid.

	TEST_END()
}

void Test_MesherSectionSplitting()
{
	TEST_BEGIN("Mesher: sections split at the vertex budget")

	const FVoxelDimensions Dims = MakeDims(32, 32, 64, 100.0f);
	const FVoxelBlockPalette Palette = MakeTestPalette();

	FVoxelChunkData Terrain = MakeChunk(FVoxelChunkCoord(0, 0), Dims);
	for (int32 Y = 0; Y < 32; ++Y)
	{
		for (int32 X = 0; X < 32; ++X)
		{
			const int32 Height = 4 + ((X * 7 + Y * 5) % 9);
			for (int32 Z = 0; Z <= Height; ++Z)
			{
				Terrain.SetBlock(X, Y, Z, FVoxelBlock::Make(Z == Height ? VoxelBlockIds::Grass : VoxelBlockIds::Dirt), false);
			}
		}
	}
	const FVoxelBlockSnapshot Snapshot(Terrain);

	FVoxelMesherSettings Wide = MakeMesherSettings();
	Wide.MaxVerticesPerSection = 65536;
	FVoxelMeshResult WideResult;
	FVoxelCulledMesher().GenerateVisualMesh(Snapshot, Palette, Wide, WideResult);
	CHECK_INT(WideResult.Sections.Num(), 1);
	const int32 BaselineFaces = WideResult.TotalFaces;
	CHECK(BaselineFaces > 1000);

	FVoxelMesherSettings Narrow = MakeMesherSettings();
	Narrow.MaxVerticesPerSection = 512;
	FVoxelMeshResult NarrowResult;
	FVoxelCulledMesher().GenerateVisualMesh(Snapshot, Palette, Narrow, NarrowResult);

	CHECK(NarrowResult.Sections.Num() > 1);
	// Splitting must not lose or duplicate a single face.
	CHECK_INT(NarrowResult.TotalFaces, BaselineFaces);
	CHECK_INT(CountVertices(NarrowResult), CountVertices(WideResult));
	CHECK(WindingIsConsistent(NarrowResult));

	for (const FVoxelMeshSection& Section : NarrowResult.Sections)
	{
		CHECK(Section.Vertices.Num() <= 512);
		CHECK_INT(Section.Vertices.Num() % 4, 0);
		CHECK_INT(Section.Triangles.Num(), Section.Vertices.Num() / 4 * 6);
	}

	TEST_END()
}

void Test_MesherErrorHandling()
{
	TEST_BEGIN("Mesher: invalid input is reported, never guessed at")

	const FVoxelBlockPalette Palette = MakeTestPalette();
	const FVoxelCulledMesher Culled;
	FVoxelMesherSettings Settings = MakeMesherSettings();

	// No block data at all: valid result, no geometry, no crash.
	FVoxelBlockSnapshot EmptySnapshot;
	FVoxelMeshResult EmptyResult;
	Culled.GenerateVisualMesh(EmptySnapshot, Palette, Settings, EmptyResult);
	CHECK(EmptyResult.IsValid());
	CHECK_INT(EmptyResult.TotalFaces, 0);

	// Dimensions that cannot describe a chunk must be refused.
	FVoxelDimensions Bad = MakeDims(0, 32, 128, 100.0f);
	FVoxelChunkData BadChunk;
	BadChunk.Coord = FVoxelChunkCoord(0, 0);
	BadChunk.Dims = Bad;
	FVoxelMeshResult BadResult;
	Culled.GenerateVisualMesh(FVoxelBlockSnapshot(BadChunk), Palette, Settings, BadResult);
	CHECK(BadResult.Error == EVoxelMeshError::InvalidDimensions);
	CHECK(!BadResult.IsValid());

	// A palette with no entries cannot resolve any block id.
	FVoxelChunkData Chunk = MakeChunk(FVoxelChunkCoord(0, 0), MakeDims(8, 8, 16, 100.0f));
	Chunk.SetBlock(1, 1, 1, FVoxelBlock::Make(VoxelBlockIds::Stone), false);
	FVoxelBlockPalette EmptyPalette;
	FVoxelMeshResult PaletteResult;
	Culled.GenerateVisualMesh(FVoxelBlockSnapshot(Chunk), EmptyPalette, Settings, PaletteResult);
	CHECK(PaletteResult.Error == EVoxelMeshError::EmptyPalette);

	// An id the palette does not know degrades to air: no geometry, no crash, and
	// crucially no out-of-bounds read.
	FVoxelBlockPalette SmallPalette;
	FVoxelBlockProperties& Air = SmallPalette.AddOrGet(0);
	Air = FVoxelBlockProperties::MakeAir();
	FVoxelChunkData UnknownIdChunk = MakeChunk(FVoxelChunkCoord(0, 0), MakeDims(8, 8, 16, 100.0f));
	UnknownIdChunk.SetBlock(1, 1, 1, FVoxelBlock::Make(4000), false);
	FVoxelMeshResult UnknownResult;
	Culled.GenerateVisualMesh(FVoxelBlockSnapshot(UnknownIdChunk), SmallPalette, Settings, UnknownResult);
	CHECK(UnknownResult.IsValid());
	CHECK_INT(UnknownResult.TotalFaces, 0);

	// A negative block scale must not produce inverted geometry.
	FVoxelChunkData NegativeScale = MakeChunk(FVoxelChunkCoord(0, 0), MakeDims(8, 8, 16, -100.0f));
	CHECK(!NegativeScale.IsAllocated());   // Allocate rejects invalid dimensions.

	TEST_END()
}

// ===========================================================================
// 6. Chunk borders - the requirement that neighbours hide each other's faces
// ===========================================================================
void Test_BorderSlabs()
{
	TEST_BEGIN("Border slabs resolve across chunk boundaries")

	const FVoxelDimensions Dims = MakeDims(16, 16, 64, 100.0f);
	const FVoxelBlockPalette Palette = MakeTestPalette();

	FVoxelChunkData Left = MakeChunk(FVoxelChunkCoord(0, 0), Dims);
	FVoxelChunkData Right = MakeChunk(FVoxelChunkCoord(1, 0), Dims);

	// A wall of stone on the left chunk's eastern edge and the right chunk's
	// western edge: the face between them must disappear.
	for (int32 Z = 0; Z < 8; ++Z)
	{
		for (int32 Y = 0; Y < 16; ++Y)
		{
			Left.SetBlock(15, Y, Z, FVoxelBlock::Make(VoxelBlockIds::Stone), false);
			Right.SetBlock(0, Y, Z, FVoxelBlock::Make(VoxelBlockIds::Stone), false);
		}
	}

	const int32 ExpectedSlabSize = FVoxelBlockSnapshot::BorderSlabSize(EVoxelFace::XPos, Dims);
	CHECK_INT(ExpectedSlabSize, 16 * 64);
	CHECK_INT(FVoxelBlockSnapshot::BorderSlabSize(EVoxelFace::YPos, Dims), 16 * 64);
	CHECK_INT(FVoxelBlockSnapshot::BorderSlabSize(EVoxelFace::ZPos, Dims), 0);   // Z is not chunked

	// The left chunk asks for the layer of its XPos neighbour that faces back at it,
	// which is the neighbour's XNeg layer.
	TArray<FVoxelBlock> Slab = FVoxelBlockSnapshot::ExtractBorderSlab(Right, VoxelMeshTables::Opposite(EVoxelFace::XPos));
	CHECK_INT(Slab.Num(), ExpectedSlabSize);

	FVoxelBlockSnapshot Snapshot(Left);
	Snapshot.AddBorderSlab(EVoxelFace::XPos, MoveTemp(Slab));

	CHECK(Snapshot.IsNeighbourAvailable(FVoxelChunkCoord(1, 0)));
	CHECK(!Snapshot.IsNeighbourAvailable(FVoxelChunkCoord(-1, 0)));
	CHECK(!Snapshot.IsNeighbourAvailable(FVoxelChunkCoord(0, 1)));
	CHECK(!Snapshot.IsNeighbourAvailable(FVoxelChunkCoord(1, 1)));   // Diagonals are never supplied
	CHECK(Snapshot.IsNeighbourAvailable(FVoxelChunkCoord(0, 0)));

	// Reading the first voxel of the neighbour must return the slab's stone, and the
	// slab must be indexed the same way it was written: (Z, Y) order.
	const FIntVector FirstNeighbourVoxel(16, 0, 0);
	CHECK_INT(Snapshot.GetBlockAtVoxel(FirstNeighbourVoxel).BlockId, VoxelBlockIds::Stone);
	CHECK_INT(Snapshot.GetBlockAtVoxel(FIntVector(16, 3, 5)).BlockId, VoxelBlockIds::Stone);
	CHECK_INT(Snapshot.GetBlockAtVoxel(FIntVector(16, 0, 9)).BlockId, 0);   // Above the wall: air

	// Local reads are unaffected by slabs.
	CHECK_INT(Snapshot.GetLocalBlock(15, 0, 0).BlockId, VoxelBlockIds::Stone);
	CHECK_INT(Snapshot.GetLocalBlock(14, 0, 0).BlockId, 0);

	// With the neighbour known, the shared border faces are culled on both sides.
	FVoxelMesherSettings Settings = MakeMesherSettings();
	Settings.bEnableAmbientOcclusion = false;

	FVoxelMeshResult LeftResult;
	FVoxelCulledMesher().GenerateVisualMesh(Snapshot, Palette, Settings, LeftResult);

	FVoxelMeshResult LeftAlone;
	FVoxelCulledMesher().GenerateVisualMesh(FVoxelBlockSnapshot(Left), Palette, Settings, LeftAlone);

	// 16 rows x 8 high = 128 border faces, all of them now hidden.
	CHECK_INT(LeftAlone.TotalFaces - LeftResult.TotalFaces, 128);
	CHECK(WindingIsConsistent(LeftResult));

	// A wrongly sized slab must be refused rather than read out of bounds.
	FVoxelBlockSnapshot BadSlabSnapshot(Left);
	TArray<FVoxelBlock> TooSmall;
	TooSmall.SetNumZeroed(4);
	BadSlabSnapshot.AddBorderSlab(EVoxelFace::XPos, MoveTemp(TooSmall));
	CHECK(!BadSlabSnapshot.IsNeighbourAvailable(FVoxelChunkCoord(1, 0)));
	CHECK_INT(BadSlabSnapshot.GetBlockAtVoxel(FirstNeighbourVoxel).BlockId, 0);

	// Without a neighbour, the border face is drawn. That is the safe direction: an
	// extra quad is invisible, a missing one is a hole in the world.
	CHECK(LeftAlone.TotalFaces > LeftResult.TotalFaces);

	// The same wall built in a chunk pair on the negative side of the origin, where
	// an index sign error would show up immediately.
	FVoxelChunkData NegLeft = MakeChunk(FVoxelChunkCoord(-2, -3), Dims);
	FVoxelChunkData NegRight = MakeChunk(FVoxelChunkCoord(-1, -3), Dims);
	NegLeft.SetBlock(15, 15, 4, FVoxelBlock::Make(VoxelBlockIds::Stone), false);
	NegRight.SetBlock(0, 15, 4, FVoxelBlock::Make(VoxelBlockIds::Stone), false);

	FVoxelBlockSnapshot NegSnapshot(NegLeft);
	NegSnapshot.AddBorderSlab(EVoxelFace::XPos,
		FVoxelBlockSnapshot::ExtractBorderSlab(NegRight, VoxelMeshTables::Opposite(EVoxelFace::XPos)));

	CHECK_INT(NegSnapshot.GetBlockAtVoxel(FIntVector(-16, -33, 4)).BlockId, VoxelBlockIds::Stone);

	FVoxelMeshResult NegResult;
	FVoxelCulledMesher().GenerateVisualMesh(NegSnapshot, Palette, Settings, NegResult);
	FVoxelMeshResult NegAlone;
	FVoxelCulledMesher().GenerateVisualMesh(FVoxelBlockSnapshot(NegLeft), Palette, Settings, NegAlone);
	CHECK_INT(NegAlone.TotalFaces, 6);
	CHECK_INT(NegResult.TotalFaces, 5);      // The +X face is hidden by the neighbour.

	TEST_END()
}

// ===========================================================================
// 7. Terrain generation
// ===========================================================================
void Test_TerrainDeterminism()
{
	TEST_BEGIN("Terrain: seed + chunk coordinate reproduce identical blocks")

	const FVoxelDimensions Dims = MakeDims(16, 16, 128, 100.0f);
	const FVoxelBlockPalette Palette = MakeTestPalette();
	const FWorldGenerationSettings Settings = MakeGenSettings(424242);
	const FNoiseVoxelTerrainGenerator Generator;

	auto Generate = [&](const FVoxelChunkCoord& Coord, const FWorldGenerationSettings& InSettings)
	{
		FVoxelChunkData Chunk = MakeChunk(Coord, Dims);
		Generator.GenerateChunk(Chunk, InSettings, Palette);
		return Chunk;
	};

	auto CompareBlocks = [](const FVoxelChunkData& A, const FVoxelChunkData& B)
	{
		if (A.Blocks.Num() != B.Blocks.Num()) { return false; }
		for (int32 Index = 0; Index < A.Blocks.Num(); ++Index)
		{
			if (!(A.Blocks[Index] == B.Blocks[Index])) { return false; }
		}
		return true;
	};

	const FVoxelChunkCoord Coord(3, -7);

	// Same seed, same coordinate, generated twice: bit-identical.
	const FVoxelChunkData First = Generate(Coord, Settings);
	const FVoxelChunkData Second = Generate(Coord, Settings);
	CHECK(CompareBlocks(First, Second));
	CHECK(!First.IsEmpty());
	CHECK(First.MaxUsedZ > 0);

	// A different chunk coordinate must give different terrain...
	CHECK(!CompareBlocks(First, Generate(FVoxelChunkCoord(4, -7), Settings)));
	CHECK(!CompareBlocks(First, Generate(FVoxelChunkCoord(-3, 7), Settings)));

	// ...and a different seed must change the same coordinate.
	CHECK(!CompareBlocks(First, Generate(Coord, MakeGenSettings(424243))));

	// Re-generating into a chunk that already holds data must produce the same
	// result as generating into a fresh one: no accumulation between runs.
	FVoxelChunkData Reused = First;
	Generator.GenerateChunk(Reused, Settings, Palette);
	CHECK(CompareBlocks(First, Reused));

	// Negative coordinates must work identically to positive ones.
	const FVoxelChunkData Negative = Generate(FVoxelChunkCoord(-11, -19), Settings);
	CHECK(!Negative.IsEmpty());
	CHECK(Negative.MaxUsedZ > 0);
	CHECK(Negative.MaxUsedZ < Dims.SizeZ);

	// Player edits survive re-generation because the caller re-applies them; the
	// generator itself must not have recorded anything as a modification.
	CHECK_INT(First.Modifications.Edits.Num(), 0);

	TEST_END()
}

void Test_TerrainShape()
{
	TEST_BEGIN("Terrain: height range, layers, coastline and biomes")

	const FVoxelDimensions Dims = MakeDims(16, 16, 128, 100.0f);
	const FVoxelBlockPalette Palette = MakeTestPalette();
	const FNoiseVoxelTerrainGenerator Generator;

	FWorldGenerationSettings Settings = MakeGenSettings(987654);
	Settings.WorldHeight = 128;
	Settings.SeaLevel = 40;
	Settings.BaseHeight = 48;
	Settings.NoiseAmplitude = 14.0f;
	Settings.MountainAmplitude = 46.0f;
	Settings.DetailAmplitude = 2.0f;

	// Surface heights must stay inside the column, for a wide sweep of coordinates
	// including large negative ones.
	int32 MinHeight = 100000, MaxHeight = -100000;
	for (int32 X = -4000; X <= 4000; X += 37)
	{
		for (int32 Y = -4000; Y <= 4000; Y += 53)
		{
			const int32 Height = Generator.GetSurfaceHeight(X, Y, Settings);
			CHECK(Height >= 1);
			CHECK(Height < Settings.WorldHeight);
			MinHeight = FMath::Min(MinHeight, Height);
			MaxHeight = FMath::Max(MaxHeight, Height);
		}
	}
	// The world must actually vary: a generator that collapsed to a constant would
	// pass every range check and still produce a flat, useless world.
	CHECK(MaxHeight - MinHeight > 20);

	// What the generator reports must match what it writes. This is the check that
	// catches an off-by-one between the height field and the block fill, which would
	// otherwise show up as floating grass or buried surfaces.
	for (int32 Pass = 0; Pass < 4; ++Pass)
	{
		const FVoxelChunkCoord Coord(Pass * 3 - 4, Pass * 5 - 7);
		FVoxelChunkData Chunk = MakeChunk(Coord, Dims);
		Generator.GenerateChunk(Chunk, Settings, Palette);

		const FIntVector Origin = VoxelCoordinates::ChunkToVoxel(Coord, Dims);
		for (int32 LocalY = 0; LocalY < Dims.SizeY; LocalY += 3)
		{
			for (int32 LocalX = 0; LocalX < Dims.SizeX; LocalX += 3)
			{
				const int32 WorldX = Origin.X + LocalX;
				const int32 WorldY = Origin.Y + LocalY;
				const int32 Expected = Generator.GetSurfaceHeight(WorldX, WorldY, Settings);

				int32 ActualTop = -1;
				for (int32 Z = Dims.SizeZ - 1; Z >= 0; --Z)
				{
					if (!Chunk.GetBlock(LocalX, LocalY, Z).IsAir())
					{
						ActualTop = Z;
						break;
					}
				}
				CHECK_INT(ActualTop, Expected);

				// Every column must be solid all the way down: no floating terrain and
				// no holes a player could fall through the world with.
				for (int32 Z = 0; Z <= ActualTop; ++Z)
				{
					CHECK(!Chunk.GetBlock(LocalX, LocalY, Z).IsAir());
				}

				// Layering: surface material, then soil, then stone.
				const EVoxelBiome Biome = Generator.GetBiome(WorldX, WorldY, Settings);
				const uint16 SurfaceId = Chunk.GetBlockId(LocalX, LocalY, ActualTop);
				const uint16 DeepId = Chunk.GetBlockId(LocalX, LocalY, FMath::Max(0, ActualTop - Settings.SoilDepth - 4));

				CHECK_INT(DeepId, VoxelBlockIds::Stone);
				CHECK_INT(Chunk.GetBlockId(LocalX, LocalY, 0), VoxelBlockIds::Stone);   // World floor

				switch (Biome)
				{
				case EVoxelBiome::Desert:
				case EVoxelBiome::Beach:
				case EVoxelBiome::Water:
					CHECK_INT(SurfaceId, VoxelBlockIds::Sand);
					break;
				case EVoxelBiome::Mountain:
					CHECK(SurfaceId == VoxelBlockIds::Stone || SurfaceId == VoxelBlockIds::Gravel
						|| SurfaceId == VoxelBlockIds::Grass || SurfaceId == VoxelBlockIds::Dirt);
					break;
				default:
					CHECK(SurfaceId == VoxelBlockIds::Grass || SurfaceId == VoxelBlockIds::Dirt);
					break;
				}
			}
		}
	}

	// Biome classification must agree with the sea level it is given.
	FWorldGenerationSettings Shallow = Settings;
	Shallow.SeaLevel = 200;   // Above every peak: the whole world is sea bed.
	CHECK(Generator.GetBiome(0, 0, Shallow) == EVoxelBiome::Water);
	CHECK(Generator.IsBelowSeaLevel(0, 0, Shallow));

	FWorldGenerationSettings Dry = Settings;
	Dry.SeaLevel = 0;
	CHECK(!Generator.IsBelowSeaLevel(0, 0, Dry));
	CHECK(Generator.GetBiome(0, 0, Dry) != EVoxelBiome::Water);

	// Beaches appear as a band around the sea plane, not only exactly at it.
	bool bFoundBeach = false;
	for (int32 X = -3000; X <= 3000 && !bFoundBeach; X += 11)
	{
		for (int32 Y = -3000; Y <= 3000; Y += 11)
		{
			if (Generator.GetBiome(X, Y, Settings) == EVoxelBiome::Beach)
			{
				const int32 Surface = Generator.GetSurfaceHeight(X, Y, Settings);
				CHECK(Surface >= Settings.SeaLevel);
				CHECK(Surface <= Settings.SeaLevel + Settings.BeachHeightBand);
				bFoundBeach = true;
				break;
			}
		}
	}
	CHECK(bFoundBeach);

	// Mountains must exist somewhere with these settings, otherwise the amplitude
	// parameters are not wired to anything.
	bool bFoundMountain = false;
	for (int32 X = -20000; X <= 20000 && !bFoundMountain; X += 97)
	{
		for (int32 Y = -20000; Y <= 20000; Y += 97)
		{
			if (Generator.GetBiome(X, Y, Settings) == EVoxelBiome::Mountain)
			{
				bFoundMountain = true;
				break;
			}
		}
	}
	CHECK(bFoundMountain);

	// Terrain must be continuous across a chunk boundary. A seam here means the
	// origin maths disagrees with the height field, and the world visibly cracks
	// every 32 blocks.
	const FVoxelChunkCoord A(0, 0), B(1, 0);
	int32 WorstSeam = 0;
	for (int32 Y = 0; Y < 200; ++Y)
	{
		const int32 LeftVoxelX = Dims.SizeX - 1;      // Last column of chunk A.
		const int32 RightVoxelX = Dims.SizeX;         // First column of chunk B.
		const int32 LeftHeight = Generator.GetSurfaceHeight(LeftVoxelX, Y, Settings);
		const int32 RightHeight = Generator.GetSurfaceHeight(RightVoxelX, Y, Settings);
		WorstSeam = FMath::Max(WorstSeam, FMath::Abs(LeftHeight - RightHeight));
	}
	CHECK(WorstSeam < 8);

	// Sub-sea columns are left as air in Phase 02 (water is a Phase 03 system) but
	// must still be classified, so Phase 03 can fill them without touching terrain.
	bool bFoundSubSea = false;
	for (int32 X = -20000; X <= 20000 && !bFoundSubSea; X += 97)
	{
		for (int32 Y = -20000; Y <= 20000; Y += 97)
		{
			if (Generator.IsBelowSeaLevel(X, Y, Settings))
			{
				bFoundSubSea = true;
				break;
			}
		}
	}
	CHECK(bFoundSubSea);

	TEST_END()
}

void Test_FlatGenerator()
{
	TEST_BEGIN("Flat generator: a known-answer world for smoke tests")

	const FVoxelDimensions Dims = MakeDims(8, 8, 64, 100.0f);
	const FVoxelBlockPalette Palette = MakeTestPalette();
	FFlatVoxelTerrainGenerator Flat;

	FWorldGenerationSettings Settings = MakeGenSettings(1);
	Settings.BaseHeight = 12;
	Settings.WorldHeight = 64;
	Settings.SeaLevel = 4;

	FVoxelChunkData Chunk = MakeChunk(FVoxelChunkCoord(-5, 2), Dims);
	Flat.GenerateChunk(Chunk, Settings, Palette);

	CHECK_INT(Chunk.MaxUsedZ, 12);
	CHECK_INT(Flat.GetSurfaceHeight(0, 0, Settings), 12);

	int32 SolidCount = 0;
	for (int32 Z = 0; Z < Dims.SizeZ; ++Z)
	{
		for (int32 Y = 0; Y < Dims.SizeY; ++Y)
		{
			for (int32 X = 0; X < Dims.SizeX; ++X)
			{
				const uint16 Id = Chunk.GetBlockId(X, Y, Z);
				if (Id != VoxelBlockIds::Air) { ++SolidCount; }

				if (Z == 12) { CHECK_INT(Id, Flat.SurfaceBlockId); }
				else if (Z > 12 - Flat.SoilDepth && Z < 12) { CHECK_INT(Id, Flat.SubSurfaceBlockId); }
				else if (Z < 12 && Z > 0) { CHECK_INT(Id, VoxelBlockIds::Stone); }
				else if (Z > 12) { CHECK_INT(Id, VoxelBlockIds::Air); }
			}
		}
	}
	CHECK_INT(SolidCount, 8 * 8 * 13);

	// A flat world must still mesh. The top is a single merged quad; the sides cannot
	// merge past a material change, so each of the four sides splits into three rects
	// (grass, dirt, stone) - 1 + 4x3 = 13. Greedy merging is per block id by design:
	// merging across ids would paint a whole facade with one block's texture.
	FVoxelMeshResult GreedyResult;
	FVoxelGreedyMesher().GenerateVisualMesh(FVoxelBlockSnapshot(Chunk), Palette, MakeMesherSettings(EVoxelMesherMode::Greedy), GreedyResult);
	CHECK(GreedyResult.IsValid());
	CHECK_INT(CountQuads(GreedyResult), 13);

	// The culled mesher on the same chunk must count every individual face instead.
	FVoxelMeshResult FlatCulled;
	FVoxelCulledMesher().GenerateVisualMesh(FVoxelBlockSnapshot(Chunk), Palette, MakeMesherSettings(), FlatCulled);
	CHECK_INT(FlatCulled.TotalFaces, 64 + 4 * 8 * 13);   // Top plus four 8x13 sides, floor culled.
	CHECK_INT(GreedyResult.TotalFaces, FlatCulled.TotalFaces);
	CHECK(CountQuads(GreedyResult) < CountQuads(FlatCulled));

	TEST_END()
}

// ===========================================================================
// 8. World settings
// ===========================================================================
void Test_WorldSettingsValidation()
{
	TEST_BEGIN("World settings: validation catches unusable configurations")

	FVoxelWorldSettings Good;
	Good.Dimensions = MakeDims(32, 32, 128, 100.0f);
	Good.Generation.WorldHeight = 128;
	Good.Generation.SeaLevel = 40;
	Good.Generation.BaseHeight = 48;
	Good.Streaming.ViewDistanceInChunks = 8;
	Good.Streaming.PreloadDistanceInChunks = 10;
	Good.Streaming.UnloadDistanceInChunks = 12;

	TArray<FString> Problems;
	CHECK_INT(Good.Validate(&Problems), 0);
	CHECK_INT(Problems.Num(), 0);

	// Unload inside preload makes chunks load and unload in a loop, burning the
	// whole frame budget without ever showing anything.
	FVoxelWorldSettings Thrashing = Good;
	Thrashing.Streaming.UnloadDistanceInChunks = 6;
	Problems.Reset();
	CHECK(Thrashing.Validate(&Problems) > 0);
	CHECK(Problems.Num() > 0);

	// Visible chunks that were never generated would pop in with no geometry.
	FVoxelWorldSettings NoPreload = Good;
	NoPreload.Streaming.PreloadDistanceInChunks = 4;
	CHECK(NoPreload.Validate() > 0);

	// A sea level above the column would classify the whole world as ocean.
	FVoxelWorldSettings Ocean = Good;
	Ocean.Generation.SeaLevel = 500;
	CHECK(Ocean.Validate() > 0);

	// Amplitudes that exceed the column height clamp peaks flat.
	FVoxelWorldSettings Clipped = Good;
	Clipped.Generation.BaseHeight = 120;
	Clipped.Generation.MountainAmplitude = 60.0f;
	CHECK(Clipped.Validate() > 0);

	// A generation height that disagrees with the chunk shape would clip terrain.
	FVoxelWorldSettings Mismatched = Good;
	Mismatched.Generation.WorldHeight = 64;
	CHECK(Mismatched.Validate() > 0);

	// Non power-of-two sizes are allowed but must be reported, because they change
	// the cost of every coordinate conversion in the streaming path.
	FVoxelWorldSettings Odd = Good;
	Odd.Dimensions.SizeX = 30;
	Problems.Reset();
	CHECK_INT(Odd.Validate(&Problems), 1);
	CHECK(!Odd.Dimensions.IsHorizontalPowerOfTwo());
	CHECK(Good.Dimensions.IsHorizontalPowerOfTwo());

	// A resident cap below the visible set means edge chunks never load.
	FVoxelWorldSettings Starved = Good;
	Starved.Streaming.MaxResidentChunks = 16;
	CHECK(Starved.Validate() > 0);

	// LOD bands must be ordered.
	FVoxelWorldSettings InvertedLOD = Good;
	InvertedLOD.LowDetailLODDistanceInChunks = 2;
	CHECK(InvertedLOD.Validate() > 0);

	TEST_END()
}

void Test_LODAndStateHelpers()
{
	TEST_BEGIN("LOD bands and chunk state helpers")

	FVoxelWorldSettings Settings;
	CHECK(Settings.Dimensions.IsHorizontalPowerOfTwo());
	CHECK_INT(Settings.Dimensions.NumBlocks(), 32 * 32 * 128);
	CHECK_FLOAT(Settings.Dimensions.WorldSizeX(), 3200.0f, 1e-3f);
	CHECK_FLOAT(Settings.Dimensions.WorldSizeZ(), 12800.0f, 1e-3f);

	Settings.SimplifiedLODDistanceInChunks = 5;
	Settings.LowDetailLODDistanceInChunks = 7;

	CHECK(Settings.ResolveLOD(0) == EVoxelChunkLOD::Full);
	CHECK(Settings.ResolveLOD(4) == EVoxelChunkLOD::Full);
	CHECK(Settings.ResolveLOD(5) == EVoxelChunkLOD::Simplified);
	CHECK(Settings.ResolveLOD(6) == EVoxelChunkLOD::Simplified);
	CHECK(Settings.ResolveLOD(7) == EVoxelChunkLOD::LowDetail);
	CHECK(Settings.ResolveLOD(50) == EVoxelChunkLOD::LowDetail);

	CHECK(Settings.ResolveMesherMode(EVoxelChunkLOD::Full) == EVoxelMesherMode::CulledFaces);
	CHECK(Settings.ResolveMesherMode(EVoxelChunkLOD::Simplified) == EVoxelMesherMode::Greedy);
	CHECK(VoxelMesherFactory::GetForLOD(EVoxelChunkLOD::Full).GetMode() == EVoxelMesherMode::CulledFaces);
	CHECK(VoxelMesherFactory::GetForLOD(EVoxelChunkLOD::LowDetail).GetMode() == EVoxelMesherMode::Greedy);

	Settings.bEnableDistanceLOD = false;
	CHECK(Settings.ResolveLOD(100) == EVoxelChunkLOD::Full);

	// A chunk being worked on by a thread must never be released underneath it.
	CHECK(VoxelChunkState::IsWorkerOwned(EVoxelChunkState::Generating));
	CHECK(VoxelChunkState::IsWorkerOwned(EVoxelChunkState::Meshing));
	CHECK(!VoxelChunkState::IsWorkerOwned(EVoxelChunkState::Generated));
	CHECK(!VoxelChunkState::CanUnloadSafely(EVoxelChunkState::Generating));
	CHECK(!VoxelChunkState::CanUnloadSafely(EVoxelChunkState::Meshing));
	CHECK(VoxelChunkState::CanUnloadSafely(EVoxelChunkState::Generated));
	CHECK(VoxelChunkState::CanUnloadSafely(EVoxelChunkState::Visible));
	CHECK(!VoxelChunkState::CanUnloadSafely(EVoxelChunkState::Unloading));
	CHECK(VoxelChunkState::HoldsBlockData(EVoxelChunkState::Generated));
	CHECK(VoxelChunkState::HoldsBlockData(EVoxelChunkState::Visible));
	CHECK(!VoxelChunkState::HoldsBlockData(EVoxelChunkState::Queued));
	CHECK(!VoxelChunkState::HoldsBlockData(EVoxelChunkState::Unloaded));

	// Every state must have a name, or the debug HUD prints garbage.
	const EVoxelChunkState All[] = {
		EVoxelChunkState::Unloaded, EVoxelChunkState::Queued, EVoxelChunkState::Generating,
		EVoxelChunkState::Generated, EVoxelChunkState::Meshing, EVoxelChunkState::Meshed,
		EVoxelChunkState::CollisionReady, EVoxelChunkState::Visible, EVoxelChunkState::Unloading,
		EVoxelChunkState::Failed
	};
	for (EVoxelChunkState State : All)
	{
		const TCHAR* Name = VoxelChunkState::ToString(State);
		CHECK(Name != nullptr);
		CHECK(Name[0] != '\0');
	}

	// Chunk coordinate hashing must be stable and must separate mirrored pairs,
	// otherwise (1,-1) and (-1,1) collide in the streaming map.
	CHECK(GetTypeHash(FVoxelChunkCoord(1, -1)) != GetTypeHash(FVoxelChunkCoord(-1, 1)));
	CHECK(GetTypeHash(FVoxelChunkCoord(3, 4)) == GetTypeHash(FVoxelChunkCoord(3, 4)));
	CHECK_INT(FVoxelChunkCoord(-2, 5).ChebyshevDistanceTo(FVoxelChunkCoord(1, 1)), 4);
	CHECK_INT(FVoxelChunkCoord(0, 0).SquaredDistanceTo(FVoxelChunkCoord(-3, 4)), 25);

	// Block bit packing: rotation and variant must not overwrite each other.
	FVoxelBlock Block = FVoxelBlock::Make(7, 200, 0);
	Block.SetRotation(3);
	CHECK_INT(Block.GetRotation(), 3);
	CHECK_INT(Block.Meta, 200);
	Block.SetVariant(2);
	CHECK_INT(Block.GetVariant(), 2);
	CHECK_INT(Block.GetRotation(), 3);
	CHECK_INT(Block.BlockId, 7);
	CHECK_INT(sizeof(FVoxelBlock), 4);

	// Neighbour table: index 13 is self, and all 27 offsets are unique.
	CHECK(VoxelCoordinates::NeighbourOffset(VoxelCoordinates::NeighbourSelfIndex) == FIntVector(0, 0, 0));
	for (int32 Index = 0; Index < 27; ++Index)
	{
		const FIntVector& Offset = VoxelCoordinates::NeighbourOffset(Index);
		CHECK(FMath::Abs(Offset.X) <= 1 && FMath::Abs(Offset.Y) <= 1 && FMath::Abs(Offset.Z) <= 1);
		for (int32 Other = Index + 1; Other < 27; ++Other)
		{
			CHECK(Offset != VoxelCoordinates::NeighbourOffset(Other));
		}
	}

	TEST_END()
}

// ===========================================================================
// 9. End to end: generate, mesh, edit, re-mesh
// ===========================================================================
void Test_GenerateMeshEditPipeline()
{
	TEST_BEGIN("End to end: generate, mesh, edit one block, re-mesh")

	const FVoxelDimensions Dims = MakeDims(16, 16, 64, 100.0f);
	const FVoxelBlockPalette Palette = MakeTestPalette();
	const FNoiseVoxelTerrainGenerator Generator;
	FWorldGenerationSettings GenSettings = MakeGenSettings(31337);
	GenSettings.WorldHeight = 64;
	GenSettings.BaseHeight = 24;
	GenSettings.SeaLevel = 12;
	GenSettings.MountainAmplitude = 18.0f;

	FVoxelChunkData Chunk = MakeChunk(FVoxelChunkCoord(-2, 1), Dims);
	Generator.GenerateChunk(Chunk, GenSettings, Palette);
	CHECK(!Chunk.IsEmpty());

	FVoxelMesherSettings MeshSettings = MakeMesherSettings();
	FVoxelMeshResult Before;
	FVoxelCulledMesher().GenerateVisualMesh(FVoxelBlockSnapshot(Chunk), Palette, MeshSettings, Before);
	CHECK(Before.IsValid());
	CHECK(Before.TotalFaces > 0);
	CHECK(WindingIsConsistent(Before));

	FVoxelCollisionMesh CollisionBefore;
	FVoxelCulledMesher().GenerateCollisionMesh(FVoxelBlockSnapshot(Chunk), Palette, MeshSettings, CollisionBefore);
	CHECK(!CollisionBefore.IsEmpty());

	// Dig one block out of the surface. Exactly the faces around that hole may
	// change: a rebuild-everything response to a one-block edit is the failure mode
	// the whole dirty-flag design exists to prevent.
	const FIntVector Origin = VoxelCoordinates::ChunkToVoxel(Chunk.Coord, Dims);
	const int32 DigX = 8, DigY = 8;
	const int32 Surface = Generator.GetSurfaceHeight(Origin.X + DigX, Origin.Y + DigY, GenSettings);
	CHECK(Chunk.SetBlock(DigX, DigY, Surface, FVoxelBlock::MakeAir()));
	CHECK(Chunk.State.bMeshDirty);
	CHECK(Chunk.State.bCollisionDirty);
	CHECK_INT(Chunk.Modifications.Edits.Num(), 1);

	FVoxelMeshResult After;
	FVoxelCulledMesher().GenerateVisualMesh(FVoxelBlockSnapshot(Chunk), Palette, MeshSettings, After);
	CHECK(After.IsValid());

	// Measured while the hole is still open. Collision is greedy merged, so the
	// comparison uses a position checksum: a merged mesh can keep the same vertex
	// count while changing shape, and the same shape must mean the same checksum.
	auto CollisionChecksum = [](const FVoxelCollisionMesh& Mesh)
	{
		double Sum = 0.0;
		for (const FVector& Vertex : Mesh.Vertices)
		{
			Sum += Vertex.X * 1.0 + Vertex.Y * 3.0 + Vertex.Z * 7.0;
		}
		return Sum;
	};

	FVoxelCollisionMesh CollisionAfterDig;
	FVoxelCulledMesher().GenerateCollisionMesh(FVoxelBlockSnapshot(Chunk), Palette, MeshSettings, CollisionAfterDig);
	CHECK(!CollisionAfterDig.IsEmpty());
	CHECK(CollisionChecksum(CollisionAfterDig) != CollisionChecksum(CollisionBefore));
	CHECK(WindingIsConsistent(CollisionAfterDig));

	// Removing a surface block hides its own top face (-1) and exposes the four walls
	// of the hole plus the top of the block underneath (+5), for a net +4. What must
	// never happen is no change at all.
	CHECK(After.TotalFaces != Before.TotalFaces);
	CHECK(After.TotalFaces > Before.TotalFaces);
	CHECK_INT(After.TotalFaces - Before.TotalFaces, 4);
	CHECK(WindingIsConsistent(After));

	// Putting it back must restore the original mesh exactly.
	CHECK(Chunk.SetBlock(DigX, DigY, Surface, FVoxelBlock::Make(VoxelBlockIds::Grass)));
	FVoxelMeshResult Restored;
	FVoxelCulledMesher().GenerateVisualMesh(FVoxelBlockSnapshot(Chunk), Palette, MeshSettings, Restored);

	// The block may not be the same material the generator chose, so compare against
	// a chunk regenerated from scratch with the same edit applied.
	FVoxelChunkData Reference = MakeChunk(FVoxelChunkCoord(-2, 1), Dims);
	Generator.GenerateChunk(Reference, GenSettings, Palette);
	for (const FVoxelBlockEdit& Edit : Chunk.Modifications.Edits)
	{
		const FIntVector Local = VoxelCoordinates::IndexToLocal(Edit.LocalIndex, Dims);
		Reference.SetBlock(Local, Edit.Block, false);
	}
	FVoxelMeshResult ReferenceResult;
	FVoxelCulledMesher().GenerateVisualMesh(FVoxelBlockSnapshot(Reference), Palette, MeshSettings, ReferenceResult);

	CHECK_INT(Restored.TotalFaces, ReferenceResult.TotalFaces);
	CHECK_INT(CountVertices(Restored), CountVertices(ReferenceResult));

	// Refilling the hole must put collision back exactly where it was, or edits would
	// slowly drift the walkable surface away from the visible one.
	FVoxelCollisionMesh CollisionAfterRefill;
	FVoxelCulledMesher().GenerateCollisionMesh(FVoxelBlockSnapshot(Chunk), Palette, MeshSettings, CollisionAfterRefill);
	CHECK_FLOAT(CollisionChecksum(CollisionAfterRefill), CollisionChecksum(CollisionBefore), 1e-6);

	// A placed block adds faces too. Placed three above the surface so no neighbouring
	// column can touch it: at Surface+1 an adjacent taller column would hide some of
	// its faces and the expected count would depend on the terrain.
	const int32 PlaceZ = Surface + 3;
	CHECK(Chunk.SetBlock(DigX, DigY, PlaceZ, FVoxelBlock::Make(VoxelBlockIds::Brick)));
	FVoxelMeshResult Placed;
	FVoxelCulledMesher().GenerateVisualMesh(FVoxelBlockSnapshot(Chunk), Palette, MeshSettings, Placed);
	CHECK_INT(Placed.TotalFaces - Restored.TotalFaces, 6);   // Fully isolated block: all six faces.
	CHECK_INT(Chunk.Modifications.Edits.Num(), 2);
	CHECK_INT(Chunk.MaxUsedZ, PlaceZ);

	// Greedy mode on the same edited chunk must stay valid and produce fewer quads.
	FVoxelMeshResult PlacedGreedy;
	FVoxelGreedyMesher().GenerateVisualMesh(FVoxelBlockSnapshot(Chunk), Palette,
		MakeMesherSettings(EVoxelMesherMode::Greedy), PlacedGreedy);
	CHECK(PlacedGreedy.IsValid());
	CHECK(WindingIsConsistent(PlacedGreedy));
	CHECK(CountQuads(PlacedGreedy) < CountQuads(Placed));
	CHECK_INT(PlacedGreedy.TotalFaces, Placed.TotalFaces);

	TEST_END()
}

// ===========================================================================
int main()
{
	// Line buffered: without this, a crash part way through the run takes the whole
	// buffered report with it and the failures look like a hang.
	std::setvbuf(stdout, nullptr, _IOLBF, 0);

	std::printf("\n=== GameProject voxel core - native tests ===\n");
	std::printf("(engine-agnostic layer only; UObject shells are not covered here)\n\n");

	std::printf("Coordinate maths\n");
	Test_FloorDivMod();
	Test_WorldVoxelRoundTrip();
	Test_ChunkCoordinates();
	Test_LocalIndexing();

	std::printf("\nChunk data\n");
	Test_ChunkDataBasics();
	Test_ChunkModifications();

	std::printf("\nNoise and palette\n");
	Test_NoiseDeterminism();
	Test_BlockPalette();

	std::printf("\nMesh generation\n");
	Test_MesherSingleBlock();
	Test_MesherFaceCulling();
	Test_MesherAmbientOcclusion();
	Test_MesherGreedy();
	Test_MesherCollision();
	Test_MesherSectionSplitting();
	Test_MesherErrorHandling();
	Test_BorderSlabs();

	std::printf("\nTerrain generation\n");
	Test_TerrainDeterminism();
	Test_TerrainShape();
	Test_FlatGenerator();

	std::printf("\nSettings and pipeline\n");
	Test_WorldSettingsValidation();
	Test_LODAndStateHelpers();
	Test_GenerateMeshEditPipeline();

	std::printf("\n--- %d checks, %d failed ---\n", TestRunner::ChecksRun, TestRunner::ChecksFailed);

	if (!TestRunner::Failures.empty())
	{
		std::printf("\nFailures:\n");
		for (const std::string& Failure : TestRunner::Failures)
		{
			std::printf("%s\n", Failure.c_str());
		}
		std::printf("\nRESULT: FAIL\n");
		return 1;
	}

	std::printf("\nRESULT: PASS\n");
	return 0;
}
