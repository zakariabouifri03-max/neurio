// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "Voxel/VoxelCoreTypes.h"

/**
 * VOXEL CORE - COORDINATE MATH
 *
 * The single source of truth for every conversion between the four coordinate
 * spaces in the project:
 *
 *   world space (cm, double)  <->  voxel space (integer block index)
 *                               <->  chunk space (integer chunk index)
 *                               <->  chunk-local space (0..Size-1)
 *
 * Two rules make this correct at open-world scale:
 *
 *  1. Division always FLOORS. C++ integer division truncates toward zero, which
 *     silently produces mirrored, wrong chunk indices for every negative
 *     coordinate - the classic bug that makes a voxel world break the moment the
 *     player walks west or south of the origin. FloorDiv/FloorMod below are exact
 *     for all four sign combinations.
 *
 *  2. World -> voxel goes through double precision. UE5 world positions are
 *     already doubles (large world coordinates); converting through float would
 *     lose whole blocks tens of kilometres from the origin.
 *
 * Header-only and inline so the mesher's inner loops pay no call overhead, and so
 * the whole file can be compiled and unit tested outside the engine
 * (see Development/Test/VoxelCoreTests).
 */
namespace VoxelCoordinates
{
	/** Exact floor division for any sign combination. */
	inline int32 FloorDiv(int32 A, int32 B)
	{
		const int32 Quotient = A / B;
		const int32 Remainder = A % B;

		// Only needs correcting when the remainder's sign disagrees with the
		// divisor's: that is exactly the case where C++ rounded toward zero instead
		// of down (e.g. -1 / 32 == 0, but the floor is -1).
		return (Remainder != 0 && ((Remainder < 0) != (B < 0))) ? Quotient - 1 : Quotient;
	}

	/** Exact floor remainder: result is always in [0, |B|). */
	inline int32 FloorMod(int32 A, int32 B)
	{
		return A - FloorDiv(A, B) * B;
	}

	/** Shift equivalents, valid only for a positive power-of-two divisor. */
	inline int32 FloorDivShift(int32 A, int32 Log2Divisor)
	{
		// An arithmetic right shift rounds toward negative infinity, which is floor.
		return A >> Log2Divisor;
	}

	inline int32 FloorModShift(int32 A, int32 Log2Divisor)
	{
		return A & ((1 << Log2Divisor) - 1);
	}

	inline int32 FloorLog2(int32 Value)
	{
		int32 Result = 0;
		while (Value > 1)
		{
			Value >>= 1;
			++Result;
		}
		return Result;
	}

	// ---------------------------------------------------------------- world <-> voxel
	/** World position -> the voxel that contains it. Floors, so negative works. */
	inline FIntVector WorldToVoxel(const FVector& WorldPosition, float BlockWorldSize)
	{
		// Double division: see rule 2 above.
		const double Scale = (BlockWorldSize > KINDA_SMALL_NUMBER) ? static_cast<double>(BlockWorldSize) : 1.0;
		return FIntVector(
			FMath::FloorToInt(static_cast<double>(WorldPosition.X) / Scale),
			FMath::FloorToInt(static_cast<double>(WorldPosition.Y) / Scale),
			FMath::FloorToInt(static_cast<double>(WorldPosition.Z) / Scale));
	}

	/** Voxel -> the minimum corner of that block in world space. */
	inline FVector VoxelToWorld(const FIntVector& Voxel, float BlockWorldSize)
	{
		return FVector(
			static_cast<double>(Voxel.X) * BlockWorldSize,
			static_cast<double>(Voxel.Y) * BlockWorldSize,
			static_cast<double>(Voxel.Z) * BlockWorldSize);
	}

	/** Voxel -> the centre of that block in world space. */
	inline FVector VoxelToWorldCenter(const FIntVector& Voxel, float BlockWorldSize)
	{
		const double Half = BlockWorldSize * 0.5;
		return FVector(
			static_cast<double>(Voxel.X) * BlockWorldSize + Half,
			static_cast<double>(Voxel.Y) * BlockWorldSize + Half,
			static_cast<double>(Voxel.Z) * BlockWorldSize + Half);
	}

	inline FBox VoxelWorldBounds(const FIntVector& Voxel, float BlockWorldSize)
	{
		const FVector Min = VoxelToWorld(Voxel, BlockWorldSize);
		return FBox(Min, Min + FVector(BlockWorldSize));
	}

	// ---------------------------------------------------------------- voxel <-> chunk
	inline FVoxelChunkCoord VoxelToChunk(const FIntVector& Voxel, const FVoxelDimensions& Dims)
	{
		return FVoxelChunkCoord(FloorDiv(Voxel.X, Dims.SizeX), FloorDiv(Voxel.Y, Dims.SizeY));
	}

	inline FIntVector ChunkToVoxel(const FVoxelChunkCoord& Coord, const FVoxelDimensions& Dims)
	{
		// The minimum voxel of the chunk. Z is not chunked in Phase 02: a chunk is a
		// full-height column, which is what a terrain-first world wants.
		return FIntVector(Coord.X * Dims.SizeX, Coord.Y * Dims.SizeY, 0);
	}

	// ---------------------------------------------------------------- world <-> chunk
	inline FVoxelChunkCoord WorldToChunk(const FVector& WorldPosition, const FVoxelDimensions& Dims)
	{
		return VoxelToChunk(WorldToVoxel(WorldPosition, Dims.BlockWorldSize), Dims);
	}

	inline FVector ChunkToWorld(const FVoxelChunkCoord& Coord, const FVoxelDimensions& Dims)
	{
		return VoxelToWorld(ChunkToVoxel(Coord, Dims), Dims.BlockWorldSize);
	}

	inline FVector ChunkToWorldCenter(const FVoxelChunkCoord& Coord, const FVoxelDimensions& Dims)
	{
		const FVector Min = ChunkToWorld(Coord, Dims);
		return Min + FVector(Dims.WorldSizeX() * 0.5, Dims.WorldSizeY() * 0.5, Dims.WorldSizeZ() * 0.5);
	}

	inline FBox ChunkWorldBounds(const FVoxelChunkCoord& Coord, const FVoxelDimensions& Dims)
	{
		const FVector Min = ChunkToWorld(Coord, Dims);
		const FVector Max = Min + FVector(Dims.WorldSizeX(), Dims.WorldSizeY(), Dims.WorldSizeZ());
		return FBox(Min, Max);
	}

	/** True when a world position falls inside this chunk's horizontal+vertical extent. */
	inline bool ChunkContainsWorldPosition(const FVoxelChunkCoord& Coord, const FVector& WorldPosition, const FVoxelDimensions& Dims)
	{
		return ChunkWorldBounds(Coord, Dims).IsInside(WorldPosition);
	}

	// ---------------------------------------------------------------- voxel <-> local
	/** Voxel -> chunk-local coordinate, always in [0, Size). */
	inline FIntVector VoxelToLocal(const FIntVector& Voxel, const FVoxelChunkCoord& Coord, const FVoxelDimensions& Dims)
	{
		return FIntVector(
			FloorMod(Voxel.X, Dims.SizeX),
			FloorMod(Voxel.Y, Dims.SizeY),
			FloorMod(Voxel.Z, Dims.SizeZ));
	}

	/** Chunk-local -> voxel. */
	inline FIntVector LocalToVoxel(const FIntVector& Local, const FVoxelChunkCoord& Coord, const FVoxelDimensions& Dims)
	{
		const FIntVector Origin = ChunkToVoxel(Coord, Dims);
		return Origin + Local;
	}

	/**
	 * Chunk-local -> flat array index (X fastest, then Y, then Z).
	 * Returns INDEX_NONE for out-of-range input instead of corrupting memory.
	 */
	inline int32 LocalToIndex(const FIntVector& Local, const FVoxelDimensions& Dims)
	{
		if (Local.X < 0 || Local.X >= Dims.SizeX ||
			Local.Y < 0 || Local.Y >= Dims.SizeY ||
			Local.Z < 0 || Local.Z >= Dims.SizeZ)
		{
			return INDEX_NONE;
		}

		return (Local.Z * Dims.SizeY + Local.Y) * Dims.SizeX + Local.X;
	}

	inline FIntVector IndexToLocal(int32 Index, const FVoxelDimensions& Dims)
	{
		const int32 PerLayer = Dims.NumBlocksPerLayer();
		if (Index < 0 || PerLayer <= 0 || Index >= Dims.NumBlocks())
		{
			return FIntVector(INDEX_NONE, INDEX_NONE, INDEX_NONE);
		}

		const int32 Z = Index / PerLayer;
		const int32 Remainder = Index - Z * PerLayer;
		const int32 Y = Remainder / Dims.SizeX;
		const int32 X = Remainder - Y * Dims.SizeX;
		return FIntVector(X, Y, Z);
	}

	inline bool IsInsideChunk(const FIntVector& Local, const FVoxelDimensions& Dims)
	{
		return Local.X >= 0 && Local.X < Dims.SizeX
			&& Local.Y >= 0 && Local.Y < Dims.SizeY
			&& Local.Z >= 0 && Local.Z < Dims.SizeZ;
	}

	/** Bounds check for a voxel against the whole world column height. */
	inline bool IsValidVoxelZ(int32 Z, const FVoxelDimensions& Dims)
	{
		return Z >= 0 && Z < Dims.SizeZ;
	}

	/**
	 * The 26 neighbour offsets plus the zero offset, in a fixed order.
	 * Indexed 0..26 with 13 == self; the mesher and the AO sampler both use it so
	 * neighbour order is consistent everywhere in the codebase.
	 */
	inline const FIntVector& NeighbourOffset(int32 Index)
	{
		// Built once, on first use. Static local keeps it out of global init order.
		static const TArray<FIntVector> Offsets = []()
		{
			TArray<FIntVector> Result;
			Result.Reserve(27);
			for (int32 Z = -1; Z <= 1; ++Z)
			{
				for (int32 Y = -1; Y <= 1; ++Y)
				{
					for (int32 X = -1; X <= 1; ++X)
					{
						Result.Add(FIntVector(X, Y, Z));
					}
				}
			}
			return Result;
		}();

		return Offsets[FMath::Clamp(Index, 0, 26)];
	}

	/** Index of self (0,0,0) in NeighbourOffset. */
	constexpr int32 NeighbourSelfIndex = 13;
}
