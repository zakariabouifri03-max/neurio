// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "Voxel/VoxelCoordinates.h"
#include "Voxel/VoxelCoreTypes.h"
#include "VoxelChunkData.generated.h"

/**
 * Mutable bookkeeping for one chunk.
 *
 * Split out from FVoxelChunkData so the block array (bulk memory, touched by
 * worker threads) and the lifecycle flags (touched by the game thread) are not
 * interleaved - the manager can read and write state while a worker owns the
 * blocks, without racing on the same cache lines.
 */
USTRUCT(BlueprintType)
struct FVoxelChunkState
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Voxel")
	EVoxelChunkState State = EVoxelChunkState::Unloaded;

	UPROPERTY(BlueprintReadOnly, Category = "Voxel")
	EVoxelChunkLOD LOD = EVoxelChunkLOD::Full;

	/** Block data changed since the mesh was built. */
	UPROPERTY(BlueprintReadOnly, Category = "Voxel")
	bool bMeshDirty = false;

	/** Mesh changed since collision was cooked. */
	UPROPERTY(BlueprintReadOnly, Category = "Voxel")
	bool bCollisionDirty = false;

	/** All four horizontal neighbours are Generated (or better), so borders are exact. */
	UPROPERTY(BlueprintReadOnly, Category = "Voxel")
	bool bHasAllNeighbours = false;

	/** Render components are currently visible. */
	UPROPERTY(BlueprintReadOnly, Category = "Voxel")
	bool bVisible = false;

	/** Incremented whenever a worker task is cancelled, so late results are dropped. */
	uint32 TaskToken = 0;
};

/** One player-made change to a generated chunk. */
USTRUCT(BlueprintType)
struct FVoxelBlockEdit
{
	GENERATED_BODY()

	/** Flat index inside the chunk (see VoxelCoordinates::LocalToIndex). */
	UPROPERTY(BlueprintReadOnly, Category = "Voxel")
	int32 LocalIndex = INDEX_NONE;

	UPROPERTY(BlueprintReadOnly, Category = "Voxel")
	FVoxelBlock Block;
};

/**
 * All edits made to one chunk, packed for persistence.
 *
 * Generated terrain is never stored: it is reproducible from
 * (Seed, FWorldGenerationSettings, ChunkCoord). Only the delta is saved, which is
 * what makes a save file for a continent-sized world a few hundred kilobytes
 * instead of terabytes.
 */
USTRUCT(BlueprintType)
struct FVoxelChunkModification
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Voxel")
	FVoxelChunkCoord Coord;

	/** Sorted, de-duplicated edits relative to freshly generated terrain. */
	TArray<FVoxelBlockEdit> Edits;

	/** Packed form, ready for the save blob. 8 bytes per edit, index-sorted. */
	TArray<uint8> PackedBytes;

	void AddEdit(int32 LocalIndex, const FVoxelBlock& Block);
	bool HasEdit(int32 LocalIndex) const;

	/** Serialises Edits into PackedBytes. Deterministic: same edits -> same bytes. */
	void Pack();

	/** Inverse of Pack. @return false on truncated or corrupt input. */
	bool Unpack();
};

/**
 * VOXEL CORE - CHUNK DATA
 *
 * A chunk is a full-height column of blocks: SizeX * SizeY * SizeZ of them, held
 * in one flat contiguous array. One allocation, one index formula, no pointers
 * per block, and no UObject anywhere near it.
 *
 * Memory is the thing to watch: at the recommended 32x32x128 that is 131,072
 * blocks = 512 KB per chunk. See GetAllocatedBytes() and the manager's memory
 * statistics; the streaming distances in FVoxelStreamingSettings exist to keep
 * the resident set bounded.
 */
USTRUCT(BlueprintType)
struct FVoxelChunkData
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Voxel")
	FVoxelChunkCoord Coord;

	UPROPERTY(BlueprintReadOnly, Category = "Voxel")
	FVoxelDimensions Dims;

	/** Bulk block storage. Never a UPROPERTY: reflecting 131k elements is pure cost. */
	TArray<FVoxelBlock> Blocks;

	/** Highest Z containing a non-air block, or -1 when the chunk is entirely air. */
	int32 MaxUsedZ = -1;

	/** Lowest Z containing a non-air block, or -1 when the chunk is entirely air. */
	int32 MinUsedZ = -1;

	FVoxelChunkState State;

	/** Player edits, kept in sync with Blocks so the save only writes deltas. */
	FVoxelChunkModification Modifications;

	// ------------------------------------------------------------------ lifetime
	/** (Re)allocates the block array filled with air. Cheap for an already-sized chunk. */
	void Allocate(const FVoxelChunkCoord& InCoord, const FVoxelDimensions& InDims);

	/** Frees block memory. Used on unload so resident memory tracks the view distance. */
	void Release();

	/** Fills with air without reallocating. */
	void ClearBlocks();

	bool IsAllocated() const { return Blocks.Num() == Dims.NumBlocks() && Dims.IsValid(); }

	// ------------------------------------------------------------------ access
	/** Out-of-range reads return air instead of asserting: the mesher probes neighbours. */
	FVoxelBlock GetBlock(int32 X, int32 Y, int32 Z) const;
	FVoxelBlock GetBlock(const FIntVector& Local) const;
	uint16 GetBlockId(int32 X, int32 Y, int32 Z) const;

	/** @return false when the coordinate is outside the chunk. */
	bool SetBlock(int32 X, int32 Y, int32 Z, const FVoxelBlock& Block, bool bRecordModification = true);
	bool SetBlock(const FIntVector& Local, const FVoxelBlock& Block, bool bRecordModification = true);

	/** Reads/writes by absolute voxel coordinate. */
	FVoxelBlock GetBlockAtVoxel(const FIntVector& Voxel) const;
	bool SetBlockAtVoxel(const FIntVector& Voxel, const FVoxelBlock& Block, bool bRecordModification = true);

	bool ContainsVoxel(const FIntVector& Voxel) const;

	// ------------------------------------------------------------------ queries
	bool IsEmpty() const { return MaxUsedZ < 0; }

	/** True when every block equals BlockId. Lets the mesher skip whole chunks. */
	bool IsUniform(uint16 BlockId) const;

	void RecomputeUsedRange();

	SIZE_T GetAllocatedBytes() const;

	FVector GetWorldMin() const { return VoxelCoordinates::ChunkToWorld(Coord, Dims); }
	FBox GetWorldBounds() const { return VoxelCoordinates::ChunkWorldBounds(Coord, Dims); }

	FIntVector LocalToVoxel(const FIntVector& Local) const { return VoxelCoordinates::LocalToVoxel(Local, Coord, Dims); }
	FIntVector VoxelToLocal(const FIntVector& Voxel) const { return VoxelCoordinates::VoxelToLocal(Voxel, Coord, Dims); }
};
