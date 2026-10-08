// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "VoxelCoreTypes.generated.h"

/**
 * VOXEL CORE - TYPES
 *
 * Layering rule that the whole voxel engine follows:
 *
 *   [ engine-agnostic core ]  VoxelCoreTypes / VoxelCoordinates / VoxelChunkData
 *                             VoxelNoise / VoxelBlockPalette / VoxelMesher
 *                             VoxelTerrainGenerator
 *            ^  no UObject, no UActorComponent, no engine singletons, no logging.
 *            |  pure data in, pure data out.
 *   [ UObject shell ]         VoxelBlockDefinition / VoxelBlockRegistry
 *                             VoxelChunkComponent / AVoxelChunk / AVoxelWorldManager
 *
 * Everything below the line can be constructed on a worker thread, unit tested
 * without an editor, and reasoned about without thinking about the garbage
 * collector. Everything above it touches UObjects and stays on the game thread.
 * That split is what makes async generation safe rather than merely hopeful.
 */

/** Chunk lifecycle. Ordered: later states imply earlier work is complete. */
UENUM(BlueprintType)
enum class EVoxelChunkState : uint8
{
	/** No memory, no actor. The chunk is only a coordinate. */
	Unloaded		UMETA(DisplayName = "Unloaded"),

	/** Waiting for a generation slot. Nothing allocated yet. */
	Queued			UMETA(DisplayName = "Queued"),

	/** A worker task is filling block data. Must not be touched by the game thread. */
	Generating		UMETA(DisplayName = "Generating"),

	/** Block data is complete and valid. No mesh yet. */
	Generated		UMETA(DisplayName = "Generated"),

	/** A worker task is building mesh data from the block data. */
	Meshing			UMETA(DisplayName = "Meshing"),

	/** Visual mesh data exists. */
	Meshed			UMETA(DisplayName = "Meshed"),

	/** Collision has been applied; the chunk is walkable. */
	CollisionReady	UMETA(DisplayName = "Collision Ready"),

	/** Render components are visible. */
	Visible			UMETA(DisplayName = "Visible"),

	/** Scheduled for release. Never re-enters Generating from here. */
	Unloading		UMETA(DisplayName = "Unloading"),

	/** Generation or meshing failed. Kept for diagnostics, never rendered. */
	Failed			UMETA(DisplayName = "Failed")
};

/** Meshing strategy. Also used as the LOD axis: near chunks get AO, far chunks get merged quads. */
UENUM(BlueprintType)
enum class EVoxelMesherMode : uint8
{
	/** One quad per visible face, with per-vertex ambient occlusion. Best looking. */
	CulledFaces		UMETA(DisplayName = "Culled Faces (AO)"),

	/** Coplanar faces merged into large quads. Fewest triangles, no per-vertex AO. */
	Greedy			UMETA(DisplayName = "Greedy Meshing")
};

/** Level of detail for a chunk. Drives mesher mode and (later) decimation. */
UENUM(BlueprintType)
enum class EVoxelChunkLOD : uint8
{
	/** Full detail, ambient occlusion, per-face quads. */
	Full		UMETA(DisplayName = "Full"),

	/** Greedy merged quads, no AO. Same collision fidelity. */
	Simplified	UMETA(DisplayName = "Simplified"),

	/**
	 * Reserved for Phase 03: a decimated or impostor representation for terrain
	 * beyond the mesh budget (distant mountains, horizon). Declared now so the
	 * streaming code already has somewhere to route far chunks instead of having to
	 * be rewritten when it lands.
	 */
	LowDetail	UMETA(DisplayName = "Low Detail (Phase 03)")
};

/** Collision strategy for a block definition. */
UENUM(BlueprintType)
enum class EVoxelBlockCollisionType : uint8
{
	/** No collision contribution (air, water, decoration). */
	None		UMETA(DisplayName = "None"),

	/** Full cube collision. The normal case for terrain. */
	Solid		UMETA(DisplayName = "Solid"),

	/**
	 * Reserved: partial collision built from a sub-cube (fences, slabs, slopes).
	 * The mesher already emits per-face quads, so this only needs a collision
	 * generator that honours the block's shape.
	 */
	Partial		UMETA(DisplayName = "Partial (future)")
};

/** How the mesher should treat a block's geometry. */
UENUM(BlueprintType)
enum class EVoxelBlockMeshBehaviour : uint8
{
	/** A full cube with six culled faces. Terrain, walls, roads. */
	FullCube	UMETA(DisplayName = "Full Cube"),

	/** Contributes nothing to the mesh (air). */
	None		UMETA(DisplayName = "None"),

	/** Reserved: two crossed quads, no culling (grass, flowers, foliage). */
	Cross		UMETA(DisplayName = "Cross (future)"),

	/** Reserved: authored mesh instead of generated quads (fences, pipes). */
	Custom		UMETA(DisplayName = "Custom (future)")
};

/** Face indices. Order is fixed: the mesher's face tables are indexed by it. */
UENUM(BlueprintType)
enum class EVoxelFace : uint8
{
	XNeg = 0,
	XPos = 1,
	YNeg = 2,
	YPos = 3,
	ZNeg = 4,
	ZPos = 5,

	Count = 6
};

/**
 * One voxel. Exactly 4 bytes.
 *
 * A million blocks is 4 MB, which is the difference between a voxel world that
 * fits in memory and one that does not. Everything that does not fit in 4 bytes
 * (name, material, sound, hardness) lives in the block definition, looked up by
 * id - never inline per block.
 *
 * Deliberately NOT a USTRUCT with UPROPERTYs on its fields: this is hot, bulk
 * data that is never garbage-collected and never reflected per instance.
 */
USTRUCT(BlueprintType)
struct FVoxelBlock
{
	GENERATED_BODY()

	/** Index into the block palette. 0 is always air (see GameProject::EmptyBlockId). */
	uint16 BlockId = 0;

	/** Free-form per-instance data: growth stage, damage, wet/dry, owner... */
	uint8 Meta = 0;

	/** Packed bits: 0-1 rotation, 2-3 visual variant, 4-7 reserved for gameplay. */
	uint8 Flags = 0;

	static FVoxelBlock MakeAir() { return FVoxelBlock(); }

	static FVoxelBlock Make(uint16 InBlockId, uint8 InMeta = 0, uint8 InFlags = 0)
	{
		FVoxelBlock Block;
		Block.BlockId = InBlockId;
		Block.Meta = InMeta;
		Block.Flags = InFlags;
		return Block;
	}

	bool IsAir() const { return BlockId == 0; }

	uint8 GetRotation() const { return static_cast<uint8>(Flags & 0x03); }
	void SetRotation(uint8 InRotation) { Flags = static_cast<uint8>((Flags & ~0x03) | (InRotation & 0x03)); }

	uint8 GetVariant() const { return static_cast<uint8>((Flags >> 2) & 0x03); }
	void SetVariant(uint8 InVariant) { Flags = static_cast<uint8>((Flags & ~0x0C) | ((InVariant & 0x03) << 2)); }

	bool operator==(const FVoxelBlock& Other) const
	{
		return BlockId == Other.BlockId && Meta == Other.Meta && Flags == Other.Flags;
	}

	bool operator!=(const FVoxelBlock& Other) const { return !(*this == Other); }
};

static_assert(sizeof(FVoxelBlock) == 4, "FVoxelBlock must stay 4 bytes; a million blocks is 4MB.");

/** Integer chunk coordinate. Unbounded in both directions - the world has no edge. */
USTRUCT(BlueprintType)
struct FVoxelChunkCoord
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	int32 X = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	int32 Y = 0;

	FVoxelChunkCoord() = default;
	FVoxelChunkCoord(int32 InX, int32 InY) : X(InX), Y(InY) {}

	bool operator==(const FVoxelChunkCoord& Other) const { return X == Other.X && Y == Other.Y; }
	bool operator!=(const FVoxelChunkCoord& Other) const { return !(*this == Other); }

	/** Chebyshev distance in chunks - what streaming radius tests actually want. */
	int32 ChebyshevDistanceTo(const FVoxelChunkCoord& Other) const
	{
		return FMath::Max(FMath::Abs(X - Other.X), FMath::Abs(Y - Other.Y));
	}

	/** Squared euclidean distance, for priority sorting without a sqrt per chunk. */
	int64 SquaredDistanceTo(const FVoxelChunkCoord& Other) const
	{
		const int64 DX = static_cast<int64>(X) - Other.X;
		const int64 DY = static_cast<int64>(Y) - Other.Y;
		return DX * DX + DY * DY;
	}

	FString ToString() const { return FString::Printf(TEXT("(%d,%d)"), X, Y); }

	friend uint32 GetTypeHash(const FVoxelChunkCoord& Coord)
	{
		return HashCombineFast(::GetTypeHash(Coord.X), ::GetTypeHash(Coord.Y));
	}
};

/**
 * Chunk shape and block scale.
 *
 * Passed by value everywhere instead of being read from a global, because the
 * generator and mesher run on worker threads and must not depend on anything
 * that could change underneath them mid-job.
 */
USTRUCT(BlueprintType)
struct FVoxelDimensions
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel", meta = (ClampMin = "4", ClampMax = "128"))
	int32 SizeX = 32;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel", meta = (ClampMin = "4", ClampMax = "128"))
	int32 SizeY = 32;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel", meta = (ClampMin = "8", ClampMax = "512"))
	int32 SizeZ = 128;

	/** Edge length of one block in cm. 100 = one metre, i.e. Minecraft-like scale. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel", meta = (ClampMin = "1.0", ClampMax = "1000.0"))
	float BlockWorldSize = 100.0f;

	int32 NumBlocks() const { return SizeX * SizeY * SizeZ; }
	int32 NumBlocksPerLayer() const { return SizeX * SizeY; }

	FIntVector SizeVector() const { return FIntVector(SizeX, SizeY, SizeZ); }

	float WorldSizeX() const { return SizeX * BlockWorldSize; }
	float WorldSizeY() const { return SizeY * BlockWorldSize; }
	float WorldSizeZ() const { return SizeZ * BlockWorldSize; }

	bool IsValid() const
	{
		return SizeX > 0 && SizeY > 0 && SizeZ > 0 && BlockWorldSize > 0.0f;
	}

	/**
	 * Power-of-two X/Y sizes let WorldToChunk use a shift instead of a division and
	 * make WorldToLocal a mask. Non power-of-two still works (FloorDiv is exact) but
	 * is measurably slower on the hot path.
	 */
	bool IsHorizontalPowerOfTwo() const
	{
		return SizeX > 0 && SizeY > 0
			&& (SizeX & (SizeX - 1)) == 0
			&& (SizeY & (SizeY - 1)) == 0;
	}

	bool operator==(const FVoxelDimensions& Other) const
	{
		return SizeX == Other.SizeX && SizeY == Other.SizeY && SizeZ == Other.SizeZ
			&& FMath::IsNearlyEqual(BlockWorldSize, Other.BlockWorldSize);
	}

	friend uint32 GetTypeHash(const FVoxelDimensions& Dims)
	{
		return HashCombineFast(::GetTypeHash(Dims.SizeX), ::GetTypeHash(Dims.SizeY),
			::GetTypeHash(Dims.SizeZ), ::GetTypeHash(Dims.BlockWorldSize));
	}
};

/**
 * Default block ids.
 *
 * These are the ids the built-in palette, the terrain generator and the debug tools
 * all agree on. They are constants rather than a lookup because a voxel stores its
 * type as a 16-bit id and the whole engine indexes arrays with it; a name-based
 * lookup per block would be catastrophic. New blocks are appended, never inserted:
 * an id that changes meaning invalidates every existing save.
 */
namespace VoxelBlockIds
{
	constexpr uint16 Air		= 0;
	constexpr uint16 Grass		= 1;
	constexpr uint16 Dirt		= 2;
	constexpr uint16 Stone		= 3;
	constexpr uint16 Sand		= 4;
	constexpr uint16 Gravel		= 5;
	constexpr uint16 Wood		= 6;
	constexpr uint16 Concrete	= 7;
	constexpr uint16 Road		= 8;
	constexpr uint16 Brick		= 9;
	constexpr uint16 Glass		= 10;

	/** Number of ids in the default palette. Reserved ids above this are free. */
	constexpr int32 DefaultCount = 11;

	/** Highest id the uint16 field can hold. */
	constexpr uint16 MaxBlockId = 65535;
}

/** Human-readable state names for the debug HUD and logs. */
namespace VoxelChunkState
{
	inline const TCHAR* ToString(EVoxelChunkState State)
	{
		switch (State)
		{
		case EVoxelChunkState::Unloaded:		return TEXT("Unloaded");
		case EVoxelChunkState::Queued:			return TEXT("Queued");
		case EVoxelChunkState::Generating:		return TEXT("Generating");
		case EVoxelChunkState::Generated:		return TEXT("Generated");
		case EVoxelChunkState::Meshing:			return TEXT("Meshing");
		case EVoxelChunkState::Meshed:			return TEXT("Meshed");
		case EVoxelChunkState::CollisionReady:	return TEXT("CollisionReady");
		case EVoxelChunkState::Visible:			return TEXT("Visible");
		case EVoxelChunkState::Unloading:		return TEXT("Unloading");
		case EVoxelChunkState::Failed:			return TEXT("Failed");
		default:								return TEXT("Unknown");
		}
	}

	/** True when the chunk holds allocated block data. */
	inline bool HoldsBlockData(EVoxelChunkState State)
	{
		return State >= EVoxelChunkState::Generated && State <= EVoxelChunkState::Visible;
	}

	/** True when a worker task currently owns the chunk and it must not be touched. */
	inline bool IsWorkerOwned(EVoxelChunkState State)
	{
		return State == EVoxelChunkState::Generating || State == EVoxelChunkState::Meshing;
	}

	/** True when the chunk is safe to release without cancelling in-flight work. */
	inline bool CanUnloadSafely(EVoxelChunkState State)
	{
		return !IsWorkerOwned(State) && State != EVoxelChunkState::Unloading;
	}
}
