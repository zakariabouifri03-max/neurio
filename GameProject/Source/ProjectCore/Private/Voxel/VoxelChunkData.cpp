// Copyright GameProject. All rights reserved. Original content only.

#include "Voxel/VoxelChunkData.h"

// ---------------------------------------------------------------------------
// FVoxelChunkModification
// ---------------------------------------------------------------------------
void FVoxelChunkModification::AddEdit(int32 LocalIndex, const FVoxelBlock& Block)
{
	if (LocalIndex < 0)
	{
		return;
	}

	// Edits stay index-sorted. That makes Pack() deterministic (the same set of
	// edits always produces byte-identical output, so saves are comparable and
	// diffable) and makes HasEdit a binary search instead of a scan.
	int32 InsertAt = Edits.Num();
	for (int32 Index = 0; Index < Edits.Num(); ++Index)
	{
		if (Edits[Index].LocalIndex == LocalIndex)
		{
			// Overwriting the same voxel twice is one edit, not two.
			Edits[Index].Block = Block;
			PackedBytes.Reset();
			return;
		}
		if (Edits[Index].LocalIndex > LocalIndex)
		{
			InsertAt = Index;
			break;
		}
	}

	FVoxelBlockEdit Edit;
	Edit.LocalIndex = LocalIndex;
	Edit.Block = Block;
	Edits.Insert(Edit, InsertAt);
	PackedBytes.Reset();
}

bool FVoxelChunkModification::HasEdit(int32 LocalIndex) const
{
	for (const FVoxelBlockEdit& Edit : Edits)
	{
		if (Edit.LocalIndex == LocalIndex)
		{
			return true;
		}
	}
	return false;
}

void FVoxelChunkModification::Pack()
{
	// Layout (little endian, 8 bytes per edit):
	//   [0..3] int32  LocalIndex
	//   [4..5] uint16 BlockId
	//   [6]    uint8  Meta
	//   [7]    uint8  Flags
	// Prefixed by a 4-byte edit count. Fixed width on purpose: a varint/RLE scheme
	// is a Phase 03 optimisation, and a fixed layout cannot be mis-parsed by a
	// partially written file.
	PackedBytes.Reset(Edits.Num() * 8 + 4);

	const int32 Count = Edits.Num();
	PackedBytes.Append(reinterpret_cast<const uint8*>(&Count), sizeof(int32));

	for (const FVoxelBlockEdit& Edit : Edits)
	{
		const int32 Index = Edit.LocalIndex;
		const uint16 Id = Edit.Block.BlockId;
		const uint8 Meta = Edit.Block.Meta;
		const uint8 Flags = Edit.Block.Flags;

		PackedBytes.Append(reinterpret_cast<const uint8*>(&Index), sizeof(int32));
		PackedBytes.Append(reinterpret_cast<const uint8*>(&Id), sizeof(uint16));
		PackedBytes.Add(Meta);
		PackedBytes.Add(Flags);
	}
}

bool FVoxelChunkModification::Unpack()
{
	Edits.Reset();

	constexpr int32 HeaderSize = sizeof(int32);
	constexpr int32 EditSize = 8;

	if (PackedBytes.Num() < HeaderSize)
	{
		return PackedBytes.Num() == 0; // An empty blob legitimately means "no edits".
	}

	int32 Count = 0;
	FMemory::Memcpy(&Count, PackedBytes.GetData(), HeaderSize);

	if (Count < 0 || PackedBytes.Num() < HeaderSize + Count * EditSize)
	{
		// Truncated or corrupt. Refuse rather than read past the end: silently
		// reconstructing half a chunk is how worlds get corrupted permanently.
		PackedBytes.Reset();
		return false;
	}

	Edits.Reserve(Count);
	for (int32 Index = 0; Index < Count; ++Index)
	{
		const uint8* Source = PackedBytes.GetData() + HeaderSize + Index * EditSize;

		FVoxelBlockEdit Edit;
		FMemory::Memcpy(&Edit.LocalIndex, Source, sizeof(int32));
		FMemory::Memcpy(&Edit.Block.BlockId, Source + 4, sizeof(uint16));
		Edit.Block.Meta = Source[6];
		Edit.Block.Flags = Source[7];

		if (Edit.LocalIndex < 0)
		{
			Edits.Reset();
			PackedBytes.Reset();
			return false;
		}

		Edits.Add(Edit);
	}

	return true;
}

// ---------------------------------------------------------------------------
// FVoxelChunkData
// ---------------------------------------------------------------------------
void FVoxelChunkData::Allocate(const FVoxelChunkCoord& InCoord, const FVoxelDimensions& InDims)
{
	Coord = InCoord;

	if (!InDims.IsValid())
	{
		Dims = FVoxelDimensions();
		Blocks.Reset();
		MaxUsedZ = -1;
		MinUsedZ = -1;
		return;
	}

	Dims = InDims;

	const int32 Required = Dims.NumBlocks();
	if (Blocks.Num() != Required)
	{
		// SetNumZeroed on FVoxelBlock gives BlockId 0 == air, which is exactly the
		// default we want, and avoids running a constructor per element.
		Blocks.SetNumZeroed(Required);
	}
	else
	{
		FMemory::Memzero(Blocks.GetData(), Required * sizeof(FVoxelBlock));
	}

	MaxUsedZ = -1;
	MinUsedZ = -1;
	Modifications.Edits.Reset();
	Modifications.PackedBytes.Reset();
}

void FVoxelChunkData::Release()
{
	Blocks.Empty();
	MaxUsedZ = -1;
	MinUsedZ = -1;
	State = FVoxelChunkState();
	Modifications.Edits.Empty();
	Modifications.PackedBytes.Empty();
}

void FVoxelChunkData::ClearBlocks()
{
	if (Blocks.Num() > 0)
	{
		FMemory::Memzero(Blocks.GetData(), Blocks.Num() * sizeof(FVoxelBlock));
	}
	MaxUsedZ = -1;
	MinUsedZ = -1;
}

FVoxelBlock FVoxelChunkData::GetBlock(int32 X, int32 Y, int32 Z) const
{
	if (X < 0 || X >= Dims.SizeX || Y < 0 || Y >= Dims.SizeY || Z < 0 || Z >= Dims.SizeZ)
	{
		return FVoxelBlock::MakeAir();
	}

	const int32 Index = (Z * Dims.SizeY + Y) * Dims.SizeX + X;
	return Blocks.IsValidIndex(Index) ? Blocks[Index] : FVoxelBlock::MakeAir();
}

FVoxelBlock FVoxelChunkData::GetBlock(const FIntVector& Local) const
{
	return GetBlock(Local.X, Local.Y, Local.Z);
}

uint16 FVoxelChunkData::GetBlockId(int32 X, int32 Y, int32 Z) const
{
	return GetBlock(X, Y, Z).BlockId;
}

bool FVoxelChunkData::SetBlock(int32 X, int32 Y, int32 Z, const FVoxelBlock& Block, bool bRecordModification)
{
	if (!IsAllocated())
	{
		return false;
	}
	if (X < 0 || X >= Dims.SizeX || Y < 0 || Y >= Dims.SizeY || Z < 0 || Z >= Dims.SizeZ)
	{
		return false;
	}

	const int32 Index = (Z * Dims.SizeY + Y) * Dims.SizeX + X;
	if (Blocks[Index] == Block)
	{
		return true; // Not a change: no dirty flags, no rebuild, no edit recorded.
	}

	Blocks[Index] = Block;

	if (!Block.IsAir())
	{
		MaxUsedZ = FMath::Max(MaxUsedZ, Z);
		MinUsedZ = (MinUsedZ < 0) ? Z : FMath::Min(MinUsedZ, Z);
	}
	else if (Z == MaxUsedZ || Z == MinUsedZ)
	{
		// Removing a block at the top or bottom of the used range can shrink it.
		// Recomputing is O(n) but this only happens on an actual boundary edit.
		RecomputeUsedRange();
	}

	if (bRecordModification)
	{
		Modifications.AddEdit(Index, Block);
	}

	State.bMeshDirty = true;
	State.bCollisionDirty = true;
	return true;
}

bool FVoxelChunkData::SetBlock(const FIntVector& Local, const FVoxelBlock& Block, bool bRecordModification)
{
	return SetBlock(Local.X, Local.Y, Local.Z, Block, bRecordModification);
}

bool FVoxelChunkData::ContainsVoxel(const FIntVector& Voxel) const
{
	if (VoxelCoordinates::VoxelToChunk(Voxel, Dims) != Coord)
	{
		return false;
	}

	// Chunk coordinates only cover X and Y, so a voxel far above the column would
	// otherwise pass this test and then be wrapped back into range by FloorMod -
	// reading a block from the wrong end of the chunk. The column is finite; the
	// world above and below it is air.
	return Voxel.Z >= 0 && Voxel.Z < Dims.SizeZ;
}

FVoxelBlock FVoxelChunkData::GetBlockAtVoxel(const FIntVector& Voxel) const
{
	if (!ContainsVoxel(Voxel))
	{
		return FVoxelBlock::MakeAir();
	}
	return GetBlock(VoxelCoordinates::VoxelToLocal(Voxel, Coord, Dims));
}

bool FVoxelChunkData::SetBlockAtVoxel(const FIntVector& Voxel, const FVoxelBlock& Block, bool bRecordModification)
{
	if (!ContainsVoxel(Voxel))
	{
		return false;
	}
	return SetBlock(VoxelCoordinates::VoxelToLocal(Voxel, Coord, Dims), Block, bRecordModification);
}

bool FVoxelChunkData::IsUniform(uint16 BlockId) const
{
	if (!IsAllocated())
	{
		return false;
	}

	// MaxUsedZ makes the common case (an all-air chunk) a single comparison.
	if (BlockId == 0)
	{
		return MaxUsedZ < 0;
	}

	for (const FVoxelBlock& Block : Blocks)
	{
		if (Block.BlockId != BlockId)
		{
			return false;
		}
	}
	return true;
}

void FVoxelChunkData::RecomputeUsedRange()
{
	MaxUsedZ = -1;
	MinUsedZ = -1;

	const int32 PerLayer = Dims.NumBlocksPerLayer();
	for (int32 Z = 0; Z < Dims.SizeZ; ++Z)
	{
		const int32 LayerStart = Z * PerLayer;
		bool bLayerHasBlock = false;

		for (int32 Index = LayerStart; Index < LayerStart + PerLayer; ++Index)
		{
			if (!Blocks[Index].IsAir())
			{
				bLayerHasBlock = true;
				break;
			}
		}

		if (bLayerHasBlock)
		{
			MinUsedZ = (MinUsedZ < 0) ? Z : MinUsedZ;
			MaxUsedZ = Z;
		}
	}
}

SIZE_T FVoxelChunkData::GetAllocatedBytes() const
{
	SIZE_T Bytes = static_cast<SIZE_T>(Blocks.GetSlack() + Blocks.Num()) * sizeof(FVoxelBlock);
	Bytes += static_cast<SIZE_T>(Modifications.Edits.Num()) * sizeof(FVoxelBlockEdit);
	Bytes += static_cast<SIZE_T>(Modifications.PackedBytes.Num());
	return Bytes;
}
