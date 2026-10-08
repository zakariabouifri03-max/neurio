// Copyright GameProject. All rights reserved. Original content only.

#include "Voxel/VoxelMesher.h"

// ===========================================================================
// Face tables
// ===========================================================================
namespace VoxelMeshTables
{
	const FFaceGeometry& GetFace(EVoxelFace Face)
	{
		// Ordered to match EVoxelFace exactly. Corner windings are clockwise seen
		// from outside the block, which is front facing in UE's left handed space,
		// so no triangle ever needs flipping at draw time.
		static const FFaceGeometry Faces[static_cast<int32>(EVoxelFace::Count)] =
		{
			// XNeg
			{
				FIntVector(-1, 0, 0), 0, -1, /*U*/ 1, /*V*/ 2,
				{ FIntVector(0, 0, 0), FIntVector(0, 1, 0), FIntVector(0, 1, 1), FIntVector(0, 0, 1) },
				false, false, 0.72f
			},
			// XPos
			{
				FIntVector(1, 0, 0), 0, 1, /*U*/ 1, /*V*/ 2,
				{ FIntVector(1, 0, 0), FIntVector(1, 0, 1), FIntVector(1, 1, 1), FIntVector(1, 1, 0) },
				true, false, 0.82f
			},
			// YNeg
			{
				FIntVector(0, -1, 0), 1, -1, /*U*/ 0, /*V*/ 2,
				{ FIntVector(0, 0, 0), FIntVector(0, 0, 1), FIntVector(1, 0, 1), FIntVector(1, 0, 0) },
				true, false, 0.78f
			},
			// YPos
			{
				FIntVector(0, 1, 0), 1, 1, /*U*/ 0, /*V*/ 2,
				{ FIntVector(0, 1, 0), FIntVector(1, 1, 0), FIntVector(1, 1, 1), FIntVector(0, 1, 1) },
				false, false, 0.88f
			},
			// ZNeg
			{
				FIntVector(0, 0, -1), 2, -1, /*U*/ 0, /*V*/ 1,
				{ FIntVector(0, 0, 0), FIntVector(1, 0, 0), FIntVector(1, 1, 0), FIntVector(0, 1, 0) },
				false, true, 0.55f
			},
			// ZPos
			{
				FIntVector(0, 0, 1), 2, 1, /*U*/ 0, /*V*/ 1,
				{ FIntVector(0, 0, 1), FIntVector(0, 1, 1), FIntVector(1, 1, 1), FIntVector(1, 0, 1) },
				false, false, 1.00f
			}
		};

		const int32 Index = static_cast<int32>(Face);
		return Faces[(Index >= 0 && Index < static_cast<int32>(EVoxelFace::Count)) ? Index : 0];
	}
}

// ===========================================================================
// Result containers
// ===========================================================================
void FVoxelMeshSection::Reset()
{
	Vertices.Reset();
	Triangles.Reset();
	Normals.Reset();
	UVs.Reset();
	Colors.Reset();
	Bounds = FBox(ForceInit);
	FaceCount = 0;
}

void FVoxelMeshSection::Reserve(int32 ExpectedFaces)
{
	const int32 Expected = FMath::Max(0, ExpectedFaces);
	Vertices.Reserve(Expected * 4);
	Triangles.Reserve(Expected * 6);
	Normals.Reserve(Expected * 4);
	UVs.Reserve(Expected * 4);
	Colors.Reserve(Expected * 4);
}

SIZE_T FVoxelMeshSection::GetAllocatedBytes() const
{
	SIZE_T Bytes = 0;
	Bytes += static_cast<SIZE_T>(Vertices.Num() + Vertices.GetSlack()) * sizeof(FVector);
	Bytes += static_cast<SIZE_T>(Triangles.Num() + Triangles.GetSlack()) * sizeof(int32);
	Bytes += static_cast<SIZE_T>(Normals.Num() + Normals.GetSlack()) * sizeof(FVector);
	Bytes += static_cast<SIZE_T>(UVs.Num() + UVs.GetSlack()) * sizeof(FVector2D);
	Bytes += static_cast<SIZE_T>(Colors.Num() + Colors.GetSlack()) * sizeof(FColor);
	return Bytes;
}

void FVoxelCollisionMesh::Reset()
{
	Vertices.Reset();
	Triangles.Reset();
	Bounds = FBox(ForceInit);
	Error = EVoxelMeshError::None;
}

SIZE_T FVoxelCollisionMesh::GetAllocatedBytes() const
{
	return static_cast<SIZE_T>(Vertices.Num() + Vertices.GetSlack()) * sizeof(FVector)
		+ static_cast<SIZE_T>(Triangles.Num() + Triangles.GetSlack()) * sizeof(int32);
}

void FVoxelMeshResult::Reset()
{
	Sections.Reset();
	Bounds = FBox(ForceInit);
	Error = EVoxelMeshError::None;
	TotalFaces = 0;
	TotalVertices = 0;
	TotalTriangles = 0;
	CulledFaces = 0;
	GenerationTimeMs = 0.0;
}

SIZE_T FVoxelMeshResult::GetAllocatedBytes() const
{
	SIZE_T Bytes = 0;
	for (const FVoxelMeshSection& Section : Sections)
	{
		Bytes += Section.GetAllocatedBytes();
	}
	return Bytes;
}

// ===========================================================================
// FVoxelBlockSnapshot
// ===========================================================================
FVoxelBlockSnapshot::FVoxelBlockSnapshot(const FVoxelChunkData& Chunk)
	: Coord(Chunk.Coord)
	, Dims(Chunk.Dims)
{
	// One flat copy. A worker thread reading this can never observe a half written
	// chunk, because the game thread is the only writer and it wrote before the
	// task was queued.
	Blocks = Chunk.Blocks;
}

int32 FVoxelBlockSnapshot::BorderSlabSize(EVoxelFace Face, const FVoxelDimensions& Dims)
{
	switch (Face)
	{
	case EVoxelFace::XNeg:
	case EVoxelFace::XPos: return Dims.SizeY * Dims.SizeZ;
	case EVoxelFace::YNeg:
	case EVoxelFace::YPos: return Dims.SizeX * Dims.SizeZ;
	default:			   return 0; // Z is not chunked in Phase 02: chunks are full-height columns.
	}
}

TArray<FVoxelBlock> FVoxelBlockSnapshot::ExtractBorderSlab(const FVoxelChunkData& Chunk, EVoxelFace Face)
{
	// Returns the layer of Chunk that lies on the given side. The manager asks for
	// VoxelMeshTables::Opposite(Face) so that a chunk receives its neighbour's
	// inward facing layer, which is the one that can hide its border faces.
	const FVoxelDimensions& Dims = Chunk.Dims;
	TArray<FVoxelBlock> Slab;

	if (!Chunk.IsAllocated())
	{
		return Slab;
	}

	switch (Face)
	{
	case EVoxelFace::XNeg:
	case EVoxelFace::XPos:
	{
		const int32 X = (Face == EVoxelFace::XPos) ? Dims.SizeX - 1 : 0;
		Slab.SetNumUninitialized(Dims.SizeY * Dims.SizeZ);

		int32 Write = 0;
		for (int32 Z = 0; Z < Dims.SizeZ; ++Z)
		{
			for (int32 Y = 0; Y < Dims.SizeY; ++Y)
			{
				Slab[Write++] = Chunk.GetBlock(X, Y, Z);
			}
		}
		break;
	}
	case EVoxelFace::YNeg:
	case EVoxelFace::YPos:
	{
		const int32 Y = (Face == EVoxelFace::YPos) ? Dims.SizeY - 1 : 0;
		Slab.SetNumUninitialized(Dims.SizeX * Dims.SizeZ);

		int32 Write = 0;
		for (int32 Z = 0; Z < Dims.SizeZ; ++Z)
		{
			for (int32 X = 0; X < Dims.SizeX; ++X)
			{
				Slab[Write++] = Chunk.GetBlock(X, Y, Z);
			}
		}
		break;
	}
	default:
		break;
	}

	return Slab;
}

void FVoxelBlockSnapshot::AddBorderSlab(EVoxelFace Face, TArray<FVoxelBlock>&& Slab)
{
	const int32 Index = static_cast<int32>(Face);
	if (Index < 0 || Index >= static_cast<int32>(EVoxelFace::Count))
	{
		return;
	}

	const int32 Expected = BorderSlabSize(Face, Dims);
	if (Expected <= 0 || Slab.Num() != Expected)
	{
		// A wrongly sized slab would be read out of bounds later. Refuse it here,
		// loudly, rather than producing a chunk with holes in its borders.
		bBorderAvailable[Index] = false;
		BorderSlabs[Index].Reset();
		return;
	}

	BorderSlabs[Index] = MoveTemp(Slab);
	bBorderAvailable[Index] = true;
}

void FVoxelBlockSnapshot::MarkBorderUnavailable(EVoxelFace Face)
{
	const int32 Index = static_cast<int32>(Face);
	if (Index >= 0 && Index < static_cast<int32>(EVoxelFace::Count))
	{
		bBorderAvailable[Index] = false;
		BorderSlabs[Index].Reset();
	}
}

FVoxelBlock FVoxelBlockSnapshot::GetLocalBlock(int32 X, int32 Y, int32 Z) const
{
	if (X < 0 || X >= Dims.SizeX || Y < 0 || Y >= Dims.SizeY || Z < 0 || Z >= Dims.SizeZ)
	{
		return FVoxelBlock::MakeAir();
	}

	const int32 Index = (Z * Dims.SizeY + Y) * Dims.SizeX + X;
	return Blocks.IsValidIndex(Index) ? Blocks[Index] : FVoxelBlock::MakeAir();
}

FVoxelBlock FVoxelBlockSnapshot::GetBlockAtVoxel(const FIntVector& Voxel) const
{
	// Plain subtraction, deliberately NOT VoxelToLocal: FloorMod would wrap a
	// coordinate above the column back down to z=0 and hand back a block from the
	// wrong end of the chunk. That reads as a solid "sky ceiling" capping every
	// chunk, and it is invisible in any test that only looks inside the chunk.
	const FIntVector Origin = VoxelCoordinates::ChunkToVoxel(Coord, Dims);
	const FIntVector Local = Voxel - Origin;

	if (VoxelCoordinates::IsInsideChunk(Local, Dims))
	{
		return GetLocalBlock(Local.X, Local.Y, Local.Z);
	}

	// Above or below the column there is nothing: chunks are full-height columns.
	if (Local.Z < 0 || Local.Z >= Dims.SizeZ)
	{
		return FVoxelBlock::MakeAir();
	}

	const FVoxelChunkCoord VoxelChunk = VoxelCoordinates::VoxelToChunk(Voxel, Dims);
	const int32 DeltaX = VoxelChunk.X - Coord.X;
	const int32 DeltaY = VoxelChunk.Y - Coord.Y;

	// Diagonal neighbours are never supplied: a face only ever occludes through one
	// of the four cardinal sides, so asking for a corner would be a bug elsewhere.
	if (DeltaX != 0 && DeltaY != 0)
	{
		return FVoxelBlock::MakeAir();
	}

	EVoxelFace Face;
	if (DeltaX < 0)		{ Face = EVoxelFace::XNeg; }
	else if (DeltaX > 0){ Face = EVoxelFace::XPos; }
	else if (DeltaY < 0){ Face = EVoxelFace::YNeg; }
	else				{ Face = EVoxelFace::YPos; }

	const int32 FaceIndex = static_cast<int32>(Face);
	if (!bBorderAvailable[FaceIndex])
	{
		return FVoxelBlock::MakeAir();
	}

	// Slabs are stored (Z, U) ordered, matching ExtractBorderSlab. The in-plane
	// coordinate is already in range here, because a non-zero delta on one axis
	// means the other axis is inside this chunk.
	const TArray<FVoxelBlock>& Slab = BorderSlabs[FaceIndex];
	const bool bXFace = (Face == EVoxelFace::XNeg || Face == EVoxelFace::XPos);
	const int32 SlabU = bXFace ? Local.Y : Local.X;
	const int32 SlabStride = bXFace ? Dims.SizeY : Dims.SizeX;
	const int32 SlabIndex = Local.Z * SlabStride + SlabU;

	return Slab.IsValidIndex(SlabIndex) ? Slab[SlabIndex] : FVoxelBlock::MakeAir();
}

bool FVoxelBlockSnapshot::IsNeighbourAvailable(const FVoxelChunkCoord& NeighbourCoord) const
{
	if (NeighbourCoord == Coord)
	{
		return true;
	}

	const int32 DeltaX = NeighbourCoord.X - Coord.X;
	const int32 DeltaY = NeighbourCoord.Y - Coord.Y;

	if (DeltaX != 0 && DeltaY != 0)
	{
		return false;
	}
	if (DeltaX == 0 && DeltaY == 0)
	{
		return true;
	}

	EVoxelFace Face;
	if (DeltaX < 0)		{ Face = EVoxelFace::XNeg; }
	else if (DeltaX > 0){ Face = EVoxelFace::XPos; }
	else if (DeltaY < 0){ Face = EVoxelFace::YNeg; }
	else				{ Face = EVoxelFace::YPos; }

	return bBorderAvailable[static_cast<int32>(Face)];
}

SIZE_T FVoxelBlockSnapshot::GetAllocatedBytes() const
{
	SIZE_T Bytes = static_cast<SIZE_T>(Blocks.Num() + Blocks.GetSlack()) * sizeof(FVoxelBlock);
	for (int32 Index = 0; Index < static_cast<int32>(EVoxelFace::Count); ++Index)
	{
		Bytes += static_cast<SIZE_T>(BorderSlabs[Index].Num() + BorderSlabs[Index].GetSlack()) * sizeof(FVoxelBlock);
	}
	return Bytes;
}

// ===========================================================================
// Shared internals
// ===========================================================================
namespace
{
	FORCEINLINE int32 DimComponent(const FVoxelDimensions& Dims, int32 Axis)
	{
		switch (Axis)
		{
		case 0:  return Dims.SizeX;
		case 1:  return Dims.SizeY;
		default: return Dims.SizeZ;
		}
	}

	FORCEINLINE int32 GetComponent(const FIntVector& V, int32 Axis)
	{
		switch (Axis)
		{
		case 0:  return V.X;
		case 1:  return V.Y;
		default: return V.Z;
		}
	}

	FORCEINLINE void AddToComponent(FIntVector& V, int32 Axis, int32 Delta)
	{
		switch (Axis)
		{
		case 0:  V.X += Delta; break;
		case 1:  V.Y += Delta; break;
		default: V.Z += Delta; break;
		}
	}

	FORCEINLINE FColor ScaleColor(const FColor& In, float Scale)
	{
		const float Clamped = FMath::Max(0.0f, Scale);
		return FColor(
			static_cast<uint8>(FMath::Clamp(FMath::RoundToInt(In.R * Clamped), 0, 255)),
			static_cast<uint8>(FMath::Clamp(FMath::RoundToInt(In.G * Clamped), 0, 255)),
			static_cast<uint8>(FMath::Clamp(FMath::RoundToInt(In.B * Clamped), 0, 255)),
			In.A);
	}

	/** Which question the pass is asking about a block: "do I draw it" or "do I collide with it". */
	enum class EVoxelFacePass : uint8
	{
		Visual,
		Collision
	};

	/**
	 * Everything the face tests need, gathered once per mesh build.
	 *
	 * Holding the source and palette by pointer is safe here because both are owned
	 * by the calling task and outlive the build; nothing in this file writes to them.
	 */
	struct FMesherContext
	{
		const IVoxelBlockSource* Source = nullptr;
		const FVoxelBlockPalette* Palette = nullptr;
		const FVoxelMesherSettings* Settings = nullptr;
		FVoxelDimensions Dims;
		FIntVector ChunkOrigin = FIntVector(0, 0, 0);
		EVoxelFacePass Pass = EVoxelFacePass::Visual;

		struct FSample
		{
			uint16 BlockId = 0;
			bool bEmits = false;
			bool bOccludes = false;
			/** False when the position lives in a neighbour whose data is unknown. */
			bool bKnown = true;
		};

		FSample SampleAt(const FIntVector& Voxel) const
		{
			FSample Result;

			const FVoxelChunkCoord VoxelChunk = VoxelCoordinates::VoxelToChunk(Voxel, Dims);
			if (VoxelChunk != Source->GetChunkCoord() && !Source->IsNeighbourAvailable(VoxelChunk))
			{
				// Unknown neighbour. Treating it as air draws the border face, which is
				// always the safe answer: a missing face is a hole you can see through
				// the world, an extra face is a quad nobody notices.
				Result.bKnown = false;
				Result.bOccludes = Settings->bAssumeOutsideSolid;
				return Result;
			}

			const FVoxelBlock Block = Source->GetBlockAtVoxel(Voxel);
			const FVoxelBlockProperties& Props = Palette->Get(Block.BlockId);

			Result.BlockId = Block.BlockId;
			Result.bEmits = (Pass == EVoxelFacePass::Visual) ? Props.IsRenderable() : Props.IsCollidable();
			Result.bOccludes = (Pass == EVoxelFacePass::Visual) ? Props.bOpaque : Props.bSolid;
			return Result;
		}

		bool IsOccluderAt(const FIntVector& Voxel) const
		{
			return SampleAt(Voxel).bOccludes;
		}

		/**
		 * Same question, asked in chunk-local coordinates.
		 *
		 * The overwhelming majority of samples land inside the chunk, and for those
		 * this is a bounds test plus one array read - no chunk-coordinate division,
		 * no neighbour lookup. Only border samples take the slow path. Mesher cost is
		 * dominated by these samples, so the split is worth the extra function.
		 */
		FSample SampleAtLocal(const FIntVector& Local) const
		{
			if (VoxelCoordinates::IsInsideChunk(Local, Dims))
			{
				const FVoxelBlock Block = Source->GetLocalBlock(Local.X, Local.Y, Local.Z);
				const FVoxelBlockProperties& Props = Palette->Get(Block.BlockId);

				FSample Result;
				Result.BlockId = Block.BlockId;
				Result.bEmits = (Pass == EVoxelFacePass::Visual) ? Props.IsRenderable() : Props.IsCollidable();
				Result.bOccludes = (Pass == EVoxelFacePass::Visual) ? Props.bOpaque : Props.bSolid;
				return Result;
			}

			return SampleAt(ChunkOrigin + Local);
		}

		bool IsOccluderAtLocal(const FIntVector& Local) const
		{
			return SampleAtLocal(Local).bOccludes;
		}
	};

	/** The face for one axis and direction. Greedy merging iterates axes, not faces. */
	FORCEINLINE EVoxelFace FaceForAxis(int32 AxisIndex, int32 AxisSign)
	{
		switch (AxisIndex)
		{
		case 0:  return (AxisSign > 0) ? EVoxelFace::XPos : EVoxelFace::XNeg;
		case 1:  return (AxisSign > 0) ? EVoxelFace::YPos : EVoxelFace::YNeg;
		default: return (AxisSign > 0) ? EVoxelFace::ZPos : EVoxelFace::ZNeg;
		}
	}

	/** One cell of a greedy merge mask. */
	struct FFaceMaskCell
	{
		uint16 BlockId = 0;

		/** +1: positive face of the block below the slice. -1: negative face of the block above. 0: no face. */
		int8 Dir = 0;

		bool IsSet() const { return Dir != 0; }
		bool operator==(const FFaceMaskCell& Other) const { return BlockId == Other.BlockId && Dir == Other.Dir; }
	};

	/**
	 * Keeps one open section per material slot and starts a new section when the
	 * current one passes the vertex budget, so no single section grows unbounded.
	 */
	struct FSectionBuilder
	{
		TArray<FVoxelMeshSection>& Sections;
		const FVoxelMesherSettings& Settings;
		TArray<int32> OpenIndexBySlot;

		FSectionBuilder(TArray<FVoxelMeshSection>& InSections, const FVoxelMesherSettings& InSettings)
			: Sections(InSections)
			, Settings(InSettings)
		{
			OpenIndexBySlot.Init(INDEX_NONE, 8);
		}

		FVoxelMeshSection& Get(int32 SlotIndex, int32 VerticesToAdd)
		{
			if (!OpenIndexBySlot.IsValidIndex(SlotIndex))
			{
				OpenIndexBySlot.SetNumZeroed(SlotIndex + 1);
				for (int32 Index = 0; Index < OpenIndexBySlot.Num(); ++Index)
				{
					OpenIndexBySlot[Index] = INDEX_NONE;
				}
			}

			int32& OpenIndex = OpenIndexBySlot[SlotIndex];
			const int32 Limit = FMath::Max(256, Settings.MaxVerticesPerSection);

			if (OpenIndex != INDEX_NONE && Sections[OpenIndex].Vertices.Num() + VerticesToAdd <= Limit)
			{
				return Sections[OpenIndex];
			}

			Sections.AddDefaulted();
			OpenIndex = Sections.Num() - 1;
			Sections[OpenIndex].MaterialSlotIndex = SlotIndex;
			return Sections[OpenIndex];
		}

		void DropEmptySections()
		{
			for (int32 Index = Sections.Num() - 1; Index >= 0; --Index)
			{
				if (Sections[Index].IsEmpty())
				{
					Sections.RemoveAtSwap(Index);
				}
			}
		}
	};

	/**
	 * Fills OutMask for the boundary between SliceIndex and SliceIndex+1 along one axis.
	 *
	 * A single slice can carry faces in BOTH directions: the positive face of the
	 * block below the boundary and the negative face of the block above it. That is
	 * why callers iterate three axes rather than six faces - walking six faces tests
	 * every boundary twice and emits every quad twice.
	 */
	void BuildFaceMask(const FMesherContext& Ctx, const VoxelMeshTables::FFaceGeometry& Geo,
		int32 SliceIndex, TArray<FFaceMaskCell>& OutMask)
	{
		const FVoxelDimensions& Dims = Ctx.Dims;
		const int32 SizeU = DimComponent(Dims, Geo.UAxis);
		const int32 SizeV = DimComponent(Dims, Geo.VAxis);

		const int32 Count = SizeU * SizeV;
		if (OutMask.Num() != Count)
		{
			OutMask.SetNumZeroed(Count);
		}
		else
		{
			for (FFaceMaskCell& Cell : OutMask)
			{
				Cell.BlockId = 0;
				Cell.Dir = 0;
			}
		}

		// The world bottom is never reachable, so its faces are pure waste. Slice -1 on
		// the Z axis is that plane, and only negative faces can appear on it.
		if (Ctx.Settings->bCullWorldBottomFace && Geo.AxisIndex == 2 && SliceIndex < 0)
		{
			return;
		}

		int32 CellIndex = 0;
		for (int32 Iv = 0; Iv < SizeV; ++Iv)
		{
			for (int32 Iu = 0; Iu < SizeU; ++Iu, ++CellIndex)
			{
				FIntVector Below(0, 0, 0);
				FIntVector Above(0, 0, 0);

				AddToComponent(Below, Geo.UAxis, Iu);
				AddToComponent(Below, Geo.VAxis, Iv);
				AddToComponent(Below, Geo.AxisIndex, SliceIndex);

				AddToComponent(Above, Geo.UAxis, Iu);
				AddToComponent(Above, Geo.VAxis, Iv);
				AddToComponent(Above, Geo.AxisIndex, SliceIndex + 1);

				const FMesherContext::FSample A = Ctx.SampleAtLocal(Below);
				const FMesherContext::FSample B = Ctx.SampleAtLocal(Above);

				// Two adjacent panes of the same non-opaque block (a glass wall) should
				// not draw the face between them: it is invisible from outside and only
				// doubles the transparent overdraw.
				const bool bSameTransparentPair = Ctx.Settings->bCullIdenticalTransparentNeighbours
					&& A.bKnown && B.bKnown
					&& A.BlockId != 0 && A.BlockId == B.BlockId && !A.bOccludes;

				if (bSameTransparentPair)
				{
					continue;
				}

				if (A.bEmits && !B.bOccludes)
				{
					OutMask[CellIndex].BlockId = A.BlockId;
					OutMask[CellIndex].Dir = 1;
				}
				else if (B.bEmits && !A.bOccludes)
				{
					OutMask[CellIndex].BlockId = B.BlockId;
					OutMask[CellIndex].Dir = -1;
				}
			}
		}
	}

	/**
	 * Greedy rectangle merging over a mask, shared by the greedy visual mesher and
	 * by both collision builds. Written once so the three cannot drift apart.
	 */
	template <typename EmitFunc>
	void ForEachMergedRect(int32 SizeU, int32 SizeV, const TArray<FFaceMaskCell>& Mask,
		TArray<uint8>& VisitedScratch, EmitFunc&& Emit)
	{
		const int32 Count = SizeU * SizeV;
		if (VisitedScratch.Num() != Count)
		{
			VisitedScratch.SetNumZeroed(Count);
		}
		else
		{
			FMemory::Memzero(VisitedScratch.GetData(), Count);
		}

		for (int32 Iv = 0; Iv < SizeV; ++Iv)
		{
			int32 Iu = 0;
			while (Iu < SizeU)
			{
				const int32 StartIndex = Iv * SizeU + Iu;
				const FFaceMaskCell Cell = Mask[StartIndex];

				if (!Cell.IsSet() || VisitedScratch[StartIndex] != 0)
				{
					++Iu;
					continue;
				}

				// Grow along U first...
				int32 Width = 1;
				while (Iu + Width < SizeU)
				{
					const int32 Index = StartIndex + Width;
					if (VisitedScratch[Index] != 0 || !(Mask[Index] == Cell))
					{
						break;
					}
					++Width;
				}

				// ...then down V while the whole run still matches.
				int32 Height = 1;
				bool bCanGrow = true;
				while (bCanGrow && Iv + Height < SizeV)
				{
					const int32 RowStart = (Iv + Height) * SizeU + Iu;
					for (int32 K = 0; K < Width; ++K)
					{
						if (VisitedScratch[RowStart + K] != 0 || !(Mask[RowStart + K] == Cell))
						{
							bCanGrow = false;
							break;
						}
					}
					if (bCanGrow)
					{
						++Height;
					}
				}

				for (int32 Dv = 0; Dv < Height; ++Dv)
				{
					for (int32 Du = 0; Du < Width; ++Du)
					{
						VisitedScratch[(Iv + Dv) * SizeU + Iu + Du] = 1;
					}
				}

				Emit(Iu, Iv, Width, Height, Cell);

				Iu += Width;
			}
		}
	}

	void InitContext(FMesherContext& Ctx, const IVoxelBlockSource& Source, const FVoxelBlockPalette& Palette,
		const FVoxelMesherSettings& Settings, EVoxelFacePass Pass)
	{
		Ctx.Source = &Source;
		Ctx.Palette = &Palette;
		Ctx.Settings = &Settings;
		Ctx.Dims = Source.GetDimensions();
		Ctx.ChunkOrigin = VoxelCoordinates::ChunkToVoxel(Source.GetChunkCoord(), Ctx.Dims);
		Ctx.Pass = Pass;
	}

	/** Shared greedy collision build: both meshers produce identical collision. */
	void BuildGreedyCollision(const IVoxelBlockSource& Source, const FVoxelBlockPalette& Palette,
		const FVoxelMesherSettings& Settings, FVoxelCollisionMesh& OutResult)
	{
		OutResult.Reset();

		FMesherContext Ctx;
		InitContext(Ctx, Source, Palette, Settings, EVoxelFacePass::Collision);

		if (!Ctx.Dims.IsValid())
		{
			OutResult.Error = EVoxelMeshError::InvalidDimensions;
			return;
		}
		if (Palette.Num() == 0)
		{
			OutResult.Error = EVoxelMeshError::EmptyPalette;
			return;
		}

		const float BlockSize = Ctx.Dims.BlockWorldSize;

		TArray<FFaceMaskCell> Mask;
		TArray<uint8> Visited;

		for (int32 Axis = 0; Axis < 3; ++Axis)
		{
			const VoxelMeshTables::FFaceGeometry& Geo = VoxelMeshTables::GetFace(FaceForAxis(Axis, 1));

			const int32 SizeD = DimComponent(Ctx.Dims, Geo.AxisIndex);
			const int32 SizeU = DimComponent(Ctx.Dims, Geo.UAxis);
			const int32 SizeV = DimComponent(Ctx.Dims, Geo.VAxis);

			for (int32 Slice = -1; Slice < SizeD; ++Slice)
			{
				BuildFaceMask(Ctx, Geo, Slice, Mask);

				ForEachMergedRect(SizeU, SizeV, Mask, Visited,
					[&](int32 U0, int32 V0, int32 Width, int32 Height, const FFaceMaskCell& Cell)
					{
						// The cell's direction decides which of the two faces on this
						// boundary it is, and therefore which way the quad must wind.
						const VoxelMeshTables::FFaceGeometry& CellGeo =
							VoxelMeshTables::GetFace(FaceForAxis(Axis, Cell.Dir));

						const int32 Plane = Slice + 1;
						const int32 BaseVertex = OutResult.Vertices.Num();

						for (int32 Corner = 0; Corner < 4; ++Corner)
						{
							// Replace the unit corner offsets with the merged rectangle's
							// extents. Because the winding comes from the same table the
							// visual mesher uses, merged quads face the right way too.
							const int32 U = (GetComponent(CellGeo.Corners[Corner], CellGeo.UAxis) != 0) ? Width : 0;
							const int32 V = (GetComponent(CellGeo.Corners[Corner], CellGeo.VAxis) != 0) ? Height : 0;

							FIntVector Local(0, 0, 0);
							AddToComponent(Local, CellGeo.AxisIndex, Plane);
							AddToComponent(Local, CellGeo.UAxis, U0 + U);
							AddToComponent(Local, CellGeo.VAxis, V0 + V);

							const FVector Position(
								static_cast<double>(Local.X) * BlockSize,
								static_cast<double>(Local.Y) * BlockSize,
								static_cast<double>(Local.Z) * BlockSize);

							OutResult.Vertices.Add(Position);
							OutResult.Bounds += Position;
						}

						OutResult.Triangles.Add(BaseVertex + 0);
						OutResult.Triangles.Add(BaseVertex + 1);
						OutResult.Triangles.Add(BaseVertex + 2);
						OutResult.Triangles.Add(BaseVertex + 0);
						OutResult.Triangles.Add(BaseVertex + 2);
						OutResult.Triangles.Add(BaseVertex + 3);
					});
			}
		}
	}
}

// ===========================================================================
// Ambient occlusion
// ===========================================================================
namespace
{
	/**
	 * Classic three-sample vertex AO.
	 *
	 * For a corner of a face, the two blocks flanking the corner and the one on the
	 * diagonal decide how much sky reaches that vertex. Counting them rather than
	 * tracing anything is what makes AO cheap enough to bake per chunk: three array
	 * reads per vertex, no light transport, no per-frame cost at all afterwards.
	 */
	int32 ComputeVertexAO(const FMesherContext& Ctx, const FIntVector& LocalPos,
		const VoxelMeshTables::FFaceGeometry& Geo, int32 CornerIndex)
	{
		const FIntVector Outside = LocalPos + Geo.Normal;

		// Which way this corner sits relative to the face's centre decides which two
		// neighbours flank it: a corner at U=1 is shaded by the block at U+1.
		const int32 Du = (GetComponent(Geo.Corners[CornerIndex], Geo.UAxis) != 0) ? 1 : -1;
		const int32 Dv = (GetComponent(Geo.Corners[CornerIndex], Geo.VAxis) != 0) ? 1 : -1;

		FIntVector Side1 = Outside;
		AddToComponent(Side1, Geo.UAxis, Du);

		FIntVector Side2 = Outside;
		AddToComponent(Side2, Geo.VAxis, Dv);

		FIntVector Diagonal = Outside;
		AddToComponent(Diagonal, Geo.UAxis, Du);
		AddToComponent(Diagonal, Geo.VAxis, Dv);

		const bool bSide1 = Ctx.IsOccluderAtLocal(Side1);
		const bool bSide2 = Ctx.IsOccluderAtLocal(Side2);

		if (bSide1 && bSide2)
		{
			// Both flanks blocked: the corner is enclosed no matter what the diagonal
			// does. Short circuiting here also removes the asymmetric-darkening
			// artefact that appears when the diagonal is counted alone.
			return 0;
		}

		const int32 Blockers = (bSide1 ? 1 : 0) + (bSide2 ? 1 : 0) + (Ctx.IsOccluderAtLocal(Diagonal) ? 1 : 0);
		return 3 - Blockers;
	}

	FORCEINLINE FVector FaceNormalVector(const VoxelMeshTables::FFaceGeometry& Geo)
	{
		return FVector(static_cast<double>(Geo.Normal.X), static_cast<double>(Geo.Normal.Y), static_cast<double>(Geo.Normal.Z));
	}
}

// ===========================================================================
// FVoxelCulledMesher
// ===========================================================================
void FVoxelCulledMesher::GenerateVisualMesh(const IVoxelBlockSource& Source, const FVoxelBlockPalette& Palette,
	const FVoxelMesherSettings& Settings, FVoxelMeshResult& OutResult) const
{
	OutResult.Reset();
	const double StartTime = FPlatformTime::Seconds();

	FMesherContext Ctx;
	InitContext(Ctx, Source, Palette, Settings, EVoxelFacePass::Visual);

	if (!Ctx.Dims.IsValid())
	{
		OutResult.Error = EVoxelMeshError::InvalidDimensions;
		OutResult.GenerationTimeMs = (FPlatformTime::Seconds() - StartTime) * 1000.0;
		return;
	}
	if (Palette.Num() == 0)
	{
		OutResult.Error = EVoxelMeshError::EmptyPalette;
		OutResult.GenerationTimeMs = (FPlatformTime::Seconds() - StartTime) * 1000.0;
		return;
	}

	FSectionBuilder Builder(OutResult.Sections, Settings);

	const float BlockSize = Ctx.Dims.BlockWorldSize;
	const bool bUseAO = Settings.bEnableAmbientOcclusion;

	for (int32 Z = 0; Z < Ctx.Dims.SizeZ; ++Z)
	{
		for (int32 Y = 0; Y < Ctx.Dims.SizeY; ++Y)
		{
			for (int32 X = 0; X < Ctx.Dims.SizeX; ++X)
			{
				const FVoxelBlock Block = Source.GetLocalBlock(X, Y, Z);
				if (Block.BlockId == 0)
				{
					continue;
				}

				const FVoxelBlockProperties& Props = Palette.Get(Block.BlockId);
				if (!Props.IsRenderable())
				{
					continue;
				}

				const FIntVector LocalPos(X, Y, Z);

				for (int32 FaceIndex = 0; FaceIndex < static_cast<int32>(EVoxelFace::Count); ++FaceIndex)
				{
					const EVoxelFace Face = static_cast<EVoxelFace>(FaceIndex);
					const VoxelMeshTables::FFaceGeometry& Geo = VoxelMeshTables::GetFace(Face);

					if (Settings.bCullWorldBottomFace && Face == EVoxelFace::ZNeg && Z == 0)
					{
						++OutResult.CulledFaces;
						continue;
					}

					const FMesherContext::FSample Neighbour = Ctx.SampleAtLocal(LocalPos + Geo.Normal);

					const bool bSameTransparentPair = Settings.bCullIdenticalTransparentNeighbours
						&& Neighbour.bKnown && Neighbour.BlockId == Block.BlockId && !Props.bOpaque;

					// THE face culling test. A face shared with anything opaque is never
					// emitted, which is what keeps a solid hillside from costing six
					// quads per block.
					if (Neighbour.bOccludes || bSameTransparentPair)
					{
						++OutResult.CulledFaces;
						continue;
					}

					const FVoxelAtlasRect& Rect = Props.UVs.ForFace(Face);
					const float FaceShade = Settings.bEnableFaceShading ? Geo.Shading : 1.0f;
					const FVector Normal = FaceNormalVector(Geo);

					FVector Positions[4];
					FVector2D TexCoords[4];
					FColor Colors[4];
					int32 AOLevels[4];

					for (int32 Corner = 0; Corner < 4; ++Corner)
					{
						AOLevels[Corner] = bUseAO ? ComputeVertexAO(Ctx, LocalPos, Geo, Corner) : 3;

						const float Brightness = VoxelMeshTables::AmbientOcclusionBrightness(AOLevels[Corner]) * FaceShade;
						Colors[Corner] = Settings.bEmitVertexColors ? ScaleColor(Props.Tint, Brightness) : FColor::White;

						TexCoords[Corner] = VoxelMeshTables::CornerUV(Geo, Rect,
							GetComponent(Geo.Corners[Corner], Geo.UAxis),
							GetComponent(Geo.Corners[Corner], Geo.VAxis));

						const FIntVector CornerLocal = LocalPos + Geo.Corners[Corner];
						Positions[Corner] = FVector(
							static_cast<double>(CornerLocal.X) * BlockSize,
							static_cast<double>(CornerLocal.Y) * BlockSize,
							static_cast<double>(CornerLocal.Z) * BlockSize);
					}

					FVoxelMeshSection& Section = Builder.Get(Props.MaterialSlotIndex, 4);
					const int32 BaseVertex = Section.Vertices.Num();

					for (int32 Corner = 0; Corner < 4; ++Corner)
					{
						Section.Vertices.Add(Positions[Corner]);
						Section.Normals.Add(Normal);
						Section.UVs.Add(TexCoords[Corner]);
						Section.Colors.Add(Colors[Corner]);

						Section.Bounds += Positions[Corner];
						OutResult.Bounds += Positions[Corner];
					}

					// Choose the quad diagonal that runs between the two brighter
					// vertices. Without this, interpolation across the dark diagonal
					// produces a visible crease on every AO'd corner.
					if (AOLevels[0] + AOLevels[2] > AOLevels[1] + AOLevels[3])
					{
						Section.Triangles.Add(BaseVertex + 0);
						Section.Triangles.Add(BaseVertex + 1);
						Section.Triangles.Add(BaseVertex + 2);
						Section.Triangles.Add(BaseVertex + 0);
						Section.Triangles.Add(BaseVertex + 2);
						Section.Triangles.Add(BaseVertex + 3);
					}
					else
					{
						Section.Triangles.Add(BaseVertex + 1);
						Section.Triangles.Add(BaseVertex + 2);
						Section.Triangles.Add(BaseVertex + 3);
						Section.Triangles.Add(BaseVertex + 1);
						Section.Triangles.Add(BaseVertex + 3);
						Section.Triangles.Add(BaseVertex + 0);
					}

					++Section.FaceCount;
					++OutResult.TotalFaces;
				}
			}
		}
	}

	Builder.DropEmptySections();

	for (const FVoxelMeshSection& Section : OutResult.Sections)
	{
		OutResult.TotalVertices += Section.Vertices.Num();
		OutResult.TotalTriangles += Section.Triangles.Num() / 3;
	}

	OutResult.GenerationTimeMs = (FPlatformTime::Seconds() - StartTime) * 1000.0;
}

void FVoxelCulledMesher::GenerateCollisionMesh(const IVoxelBlockSource& Source, const FVoxelBlockPalette& Palette,
	const FVoxelMesherSettings& Settings, FVoxelCollisionMesh& OutResult) const
{
	// Collision is always merged, even for the AO mesher: fewer, larger triangles
	// cook faster and trace faster, and collision has no use for per-vertex shading.
	BuildGreedyCollision(Source, Palette, Settings, OutResult);
}

// ===========================================================================
// FVoxelGreedyMesher
// ===========================================================================
void FVoxelGreedyMesher::GenerateVisualMesh(const IVoxelBlockSource& Source, const FVoxelBlockPalette& Palette,
	const FVoxelMesherSettings& Settings, FVoxelMeshResult& OutResult) const
{
	OutResult.Reset();
	const double StartTime = FPlatformTime::Seconds();

	FMesherContext Ctx;
	InitContext(Ctx, Source, Palette, Settings, EVoxelFacePass::Visual);

	if (!Ctx.Dims.IsValid())
	{
		OutResult.Error = EVoxelMeshError::InvalidDimensions;
		OutResult.GenerationTimeMs = (FPlatformTime::Seconds() - StartTime) * 1000.0;
		return;
	}
	if (Palette.Num() == 0)
	{
		OutResult.Error = EVoxelMeshError::EmptyPalette;
		OutResult.GenerationTimeMs = (FPlatformTime::Seconds() - StartTime) * 1000.0;
		return;
	}

	FSectionBuilder Builder(OutResult.Sections, Settings);

	const float BlockSize = Ctx.Dims.BlockWorldSize;

	// Reused across every slice of every face: one chunk build allocates these once
	// instead of six times per slice.
	TArray<FFaceMaskCell> Mask;
	TArray<uint8> Visited;

	for (int32 Axis = 0; Axis < 3; ++Axis)
	{
		const VoxelMeshTables::FFaceGeometry& Geo = VoxelMeshTables::GetFace(FaceForAxis(Axis, 1));

		const int32 SizeD = DimComponent(Ctx.Dims, Geo.AxisIndex);
		const int32 SizeU = DimComponent(Ctx.Dims, Geo.UAxis);
		const int32 SizeV = DimComponent(Ctx.Dims, Geo.VAxis);

		for (int32 Slice = -1; Slice < SizeD; ++Slice)
		{
			BuildFaceMask(Ctx, Geo, Slice, Mask);

			const int32 Plane = Slice + 1;

			ForEachMergedRect(SizeU, SizeV, Mask, Visited,
				[&](int32 U0, int32 V0, int32 Width, int32 Height, const FFaceMaskCell& Cell)
				{
					const EVoxelFace Face = FaceForAxis(Axis, Cell.Dir);
					const VoxelMeshTables::FFaceGeometry& CellGeo = VoxelMeshTables::GetFace(Face);
					const FVector Normal = FaceNormalVector(CellGeo);

					const FVoxelBlockProperties& Props = Palette.Get(Cell.BlockId);
					const FVoxelAtlasRect& Rect = Props.UVs.ForFace(Face);

					// Greedy merging trades per-vertex AO for rectangle count. Face
					// shading and tint survive because both are constant across a merged
					// quad - every cell in it shares a block id and a direction.
					const float Brightness = Settings.bEnableFaceShading ? CellGeo.Shading : 1.0f;
					const FColor Color = Settings.bEmitVertexColors ? ScaleColor(Props.Tint, Brightness) : FColor::White;

					FVoxelMeshSection& Section = Builder.Get(Props.MaterialSlotIndex, 4);
					const int32 BaseVertex = Section.Vertices.Num();

					for (int32 Corner = 0; Corner < 4; ++Corner)
					{
						const int32 U = (GetComponent(CellGeo.Corners[Corner], CellGeo.UAxis) != 0) ? Width : 0;
						const int32 V = (GetComponent(CellGeo.Corners[Corner], CellGeo.VAxis) != 0) ? Height : 0;

						FIntVector Local(0, 0, 0);
						AddToComponent(Local, CellGeo.AxisIndex, Plane);
						AddToComponent(Local, CellGeo.UAxis, U0 + U);
						AddToComponent(Local, CellGeo.VAxis, V0 + V);

						const FVector Position(
							static_cast<double>(Local.X) * BlockSize,
							static_cast<double>(Local.Y) * BlockSize,
							static_cast<double>(Local.Z) * BlockSize);

						// One texture tile per block spanned, so a merged 8x4 quad shows
						// 32 tiles rather than one stretched smear. This is also why
						// greedy mode wants a texture array or an unpadded atlas: a
						// padded tile cannot be repeated exactly.
						const float URepeat = CellGeo.bFlipU ? static_cast<float>(Width - U) : static_cast<float>(U);
						const float VRepeat = CellGeo.bFlipV ? static_cast<float>(Height - V) : static_cast<float>(V);

						const FVector2D TexCoord(
							Rect.UMin + Rect.Width() * URepeat,
							Rect.VMin + Rect.Height() * VRepeat);

						Section.Vertices.Add(Position);
						Section.Normals.Add(Normal);
						Section.UVs.Add(TexCoord);
						Section.Colors.Add(Color);

						Section.Bounds += Position;
						OutResult.Bounds += Position;
					}

					Section.Triangles.Add(BaseVertex + 0);
					Section.Triangles.Add(BaseVertex + 1);
					Section.Triangles.Add(BaseVertex + 2);
					Section.Triangles.Add(BaseVertex + 0);
					Section.Triangles.Add(BaseVertex + 2);
					Section.Triangles.Add(BaseVertex + 3);

					// A merged quad stands in for Width*Height individual faces, so the
					// statistics report both numbers: quads emitted and faces replaced.
					const int32 RepresentedFaces = Width * Height;
					Section.FaceCount += RepresentedFaces;
					OutResult.TotalFaces += RepresentedFaces;
					OutResult.CulledFaces += RepresentedFaces - 1;
				});
		}
	}

	Builder.DropEmptySections();

	for (const FVoxelMeshSection& Section : OutResult.Sections)
	{
		OutResult.TotalVertices += Section.Vertices.Num();
		OutResult.TotalTriangles += Section.Triangles.Num() / 3;
	}

	OutResult.GenerationTimeMs = (FPlatformTime::Seconds() - StartTime) * 1000.0;
}

void FVoxelGreedyMesher::GenerateCollisionMesh(const IVoxelBlockSource& Source, const FVoxelBlockPalette& Palette,
	const FVoxelMesherSettings& Settings, FVoxelCollisionMesh& OutResult) const
{
	BuildGreedyCollision(Source, Palette, Settings, OutResult);
}

// ===========================================================================
// Factory
// ===========================================================================
namespace VoxelMesherFactory
{
	const IVoxelMesher& Get(EVoxelMesherMode Mode)
	{
		// Stateless singletons: meshers hold no per-chunk data, so sharing them costs
		// nothing and removes an allocation per chunk build.
		static const FVoxelCulledMesher CulledMesher;
		static const FVoxelGreedyMesher GreedyMesher;

		return (Mode == EVoxelMesherMode::Greedy)
			? static_cast<const IVoxelMesher&>(GreedyMesher)
			: static_cast<const IVoxelMesher&>(CulledMesher);
	}

	const IVoxelMesher& GetForLOD(EVoxelChunkLOD LOD)
	{
		switch (LOD)
		{
		case EVoxelChunkLOD::Full:		return Get(EVoxelMesherMode::CulledFaces);
		case EVoxelChunkLOD::Simplified:return Get(EVoxelMesherMode::Greedy);
		case EVoxelChunkLOD::LowDetail:	return Get(EVoxelMesherMode::Greedy);
		default:						return Get(EVoxelMesherMode::CulledFaces);
		}
	}
}
