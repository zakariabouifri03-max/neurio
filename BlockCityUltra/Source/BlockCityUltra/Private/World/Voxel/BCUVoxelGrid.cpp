// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "World/Voxel/BCUVoxelGrid.h"



DEFINE_LOG_CATEGORY_STATIC(LogBCUVoxel, Log, All);

UBCUVoxelGrid::UBCUVoxelGrid()
{
	MaterialSet = nullptr;
}

void UBCUVoxelGrid::Initialise(const FIntVector& InChunkDimensions, const FIntVector& InChunkCount,
	const FBCUCellCoord& InCellCoord, float InVoxelScaleCm)
{
	ChunkDimensions = InChunkDimensions;
	ChunkCount = InChunkCount;
	CellCoord = InCellCoord;
	VoxelScaleCm = FMath::Max(1.0f, InVoxelScaleCm);

	Chunks.Empty();
	Chunks.Reserve(InChunkCount.X * InChunkCount.Y * FMath::Max(1, InChunkCount.Z));
}

//═══════════════════════════════════════════════════════════════════════════════
// Chunk access
//═══════════════════════════════════════════════════════════════════════════════

FBCUVoxelChunk* UBCUVoxelGrid::GetChunk(const FIntVector& ChunkCoord)
{
	return Chunks.Find(ChunkCoord);
}

const FBCUVoxelChunk* UBCUVoxelGrid::GetChunk(const FIntVector& ChunkCoord) const
{
	return Chunks.Find(ChunkCoord);
}

FBCUVoxelChunk* UBCUVoxelGrid::GetOrCreateChunk(const FIntVector& ChunkCoord)
{
	if (FBCUVoxelChunk* Existing = Chunks.Find(ChunkCoord))
	{
		return Existing;
	}

	// Reject out-of-range chunks rather than silently growing forever: a bug in
	// the generator would otherwise eat all 32 GB of system RAM.
	if (ChunkCoord.X < 0 || ChunkCoord.Y < 0 || ChunkCoord.Z < 0
		|| ChunkCoord.X >= ChunkCount.X || ChunkCoord.Y >= ChunkCount.Y || ChunkCoord.Z >= ChunkCount.Z)
	{
		return nullptr;
	}

	FBCUVoxelChunk& New = Chunks.Add(ChunkCoord);
	New.Allocate(ChunkDimensions, ChunkCoord * ChunkDimensions);
	New.Bounds = FBox(
		VoxelToWorld(New.Origin),
		VoxelToWorld(New.Origin + ChunkDimensions));
	return &New;
}

//═══════════════════════════════════════════════════════════════════════════════
// Voxel access
//═══════════════════════════════════════════════════════════════════════════════

void UBCUVoxelGrid::SetVoxel(const FIntVector& GridPosition, const FBCUVoxel& Voxel, bool bMarkDirty)
{
	FBCUVoxelChunk* Chunk = GetOrCreateChunk(ChunkCoordOf(GridPosition));
	if (!Chunk)
	{
		return;
	}

	const FIntVector Local = LocalOf(GridPosition, ChunkCoordOf(GridPosition));
	if (!Chunk->Contains(Local.X, Local.Y, Local.Z))
	{
		return;
	}

	FBCUVoxel& Target = Chunk->MutableAt(Local.X, Local.Y, Local.Z);
	if (Target == Voxel)
	{
		return; // no work, no dirty flag — matters when re-generating a cell
	}

	Target = Voxel;

	if (bMarkDirty)
	{
		Chunk->bDirty = true;

		// Mark neighbours dirty when we touched a chunk border, otherwise a
		// face that became hidden/visible across the seam is never re-meshed.
		const FIntVector ChunkCoord = ChunkCoordOf(GridPosition);
		if (Local.X == 0)							{ if (auto* C = Chunks.Find(ChunkCoord - FIntVector(1, 0, 0))) { C->bDirty = true; } }
		else if (Local.X == ChunkDimensions.X - 1)	{ if (auto* C = Chunks.Find(ChunkCoord + FIntVector(1, 0, 0))) { C->bDirty = true; } }
		if (Local.Y == 0)							{ if (auto* C = Chunks.Find(ChunkCoord - FIntVector(0, 1, 0))) { C->bDirty = true; } }
		else if (Local.Y == ChunkDimensions.Y - 1)	{ if (auto* C = Chunks.Find(ChunkCoord + FIntVector(0, 1, 0))) { C->bDirty = true; } }
		if (Local.Z == 0)							{ if (auto* C = Chunks.Find(ChunkCoord - FIntVector(0, 0, 1))) { C->bDirty = true; } }
		else if (Local.Z == ChunkDimensions.Z - 1)	{ if (auto* C = Chunks.Find(ChunkCoord + FIntVector(0, 0, 1))) { C->bDirty = true; } }
	}
}

void UBCUVoxelGrid::SetVoxel(const FIntVector& GridPosition, EBCUVoxelMaterial Material, uint8 PaletteIndex)
{
	FBCUVoxel Voxel;
	Voxel.Material = static_cast<uint8>(Material);
	Voxel.PaletteIndex = PaletteIndex;

	// Derive the flags from the material traits so callers never have to.
	if (MaterialSet)
	{
		if (const FBCUVoxelMaterialTraits* Found = MaterialSet->FindTraits(Material))
		{
			if (Found->EmissiveIntensity > 0.0f)
			{
				Voxel.Flags |= FBCUVoxel::FLAG_Emissive;
			}
			if (!Found->bNaniteCompatible)
			{
				Voxel.Flags |= (Material == EBCUVoxelMaterial::LeavesGreen
					|| Material == EBCUVoxelMaterial::LeavesAutumn
					|| Material == EBCUVoxelMaterial::LeavesPine
					|| Material == EBCUVoxelMaterial::Flowers)
					? FBCUVoxel::FLAG_Masked
					: FBCUVoxel::FLAG_Translucent;
			}
			if (Found->WetnessResponse > 0.5f)
			{
				Voxel.Flags |= FBCUVoxel::FLAG_Wetness;
			}
		}
	}

	SetVoxel(GridPosition, Voxel);
}

FBCUVoxel UBCUVoxelGrid::GetVoxel(const FIntVector& GridPosition) const
{
	const FBCUVoxelChunk* Chunk = GetChunk(ChunkCoordOf(GridPosition));
	if (!Chunk)
	{
		return FBCUVoxel();
	}

	const FIntVector Local = LocalOf(GridPosition, ChunkCoordOf(GridPosition));
	return Chunk->At(Local.X, Local.Y, Local.Z);
}

bool UBCUVoxelGrid::IsEmpty(const FIntVector& GridPosition) const
{
	return GetVoxel(GridPosition).IsEmpty();
}

void UBCUVoxelGrid::ClearVoxel(const FIntVector& GridPosition)
{
	SetVoxel(GridPosition, FBCUVoxel());
}

//═══════════════════════════════════════════════════════════════════════════════
// Bulk operations
//═══════════════════════════════════════════════════════════════════════════════

void UBCUVoxelGrid::FillBox(const FBox& BoundsInVoxels, EBCUVoxelMaterial Material,
	uint8 PaletteIndex, uint8 Flags, uint8 Shade)
{
	const FIntVector Min(BoundsInVoxels.Min);
	const FIntVector Max(BoundsInVoxels.Max);

	FBCUVoxel Voxel;
	Voxel.Material = static_cast<uint8>(Material);
	Voxel.PaletteIndex = PaletteIndex;
	Voxel.Flags = Flags;
	Voxel.Shade = Shade;

	// Touch each chunk once instead of once per voxel: a 40-storey tower fill
	// goes from ~400k hash lookups to ~12.
	for (int32 Z = Min.Z; Z <= Max.Z; ++Z)
	{
		for (int32 Y = Min.Y; Y <= Max.Y; ++Y)
		{
			for (int32 X = Min.X; X <= Max.X; ++X)
			{
				const FIntVector Pos(X, Y, Z);
				const FIntVector ChunkCoord = ChunkCoordOf(Pos);
				FBCUVoxelChunk* Chunk = GetOrCreateChunk(ChunkCoord);
				if (!Chunk)
				{
					continue;
				}

				const FIntVector Local = LocalOf(Pos, ChunkCoord);
				if (!Chunk->Contains(Local.X, Local.Y, Local.Z))
				{
					continue;
				}

				Chunk->MutableAt(Local.X, Local.Y, Local.Z) = Voxel;
			}
		}
	}

	// Everything we touched is dirty.
	for (int32 Z = Min.Z; Z <= Max.Z; Z += ChunkDimensions.Z)
	{
		for (int32 Y = Min.Y; Y <= Max.Y; Y += ChunkDimensions.Y)
		{
			for (int32 X = Min.X; X <= Max.X; X += ChunkDimensions.X)
			{
				if (FBCUVoxelChunk* Chunk = Chunks.Find(ChunkCoordOf(FIntVector(X, Y, Z))))
				{
					Chunk->bDirty = true;
				}
			}
		}
	}
}

void UBCUVoxelGrid::CarveBox(const FBox& BoundsInVoxels, float WallThickness)
{
	const FIntVector Min(BoundsInVoxels.Min);
	const FIntVector Max(BoundsInVoxels.Max);
	const float T = FMath::Max(0.0f, WallThickness);

	for (int32 Z = Min.Z; Z <= Max.Z; ++Z)
	{
		for (int32 Y = Min.Y; Y <= Max.Y; ++Y)
		{
			for (int32 X = Min.X; X <= Max.X; ++X)
			{
				const bool bInterior =
					X > Min.X + T && X < Max.X - T &&
					Y > Min.Y + T && Y < Max.Y - T &&
					Z > Min.Z + T && Z < Max.Z - T;

				if (bInterior)
				{
					ClearVoxel(FIntVector(X, Y, Z));
				}
			}
		}
	}
}

void UBCUVoxelGrid::CarveCylinder(const FVector& CentreInVoxels, float Radius, float HalfHeight, bool bHollow)
{
	const float RadiusSq = Radius * Radius;
	const int32 MinZ = FMath::FloorToInt(CentreInVoxels.Z - HalfHeight);
	const int32 MaxZ = FMath::CeilToInt(CentreInVoxels.Z + HalfHeight);
	const int32 MinX = FMath::FloorToInt(CentreInVoxels.X - Radius);
	const int32 MaxX = FMath::CeilToInt(CentreInVoxels.X + Radius);
	const int32 MinY = FMath::FloorToInt(CentreInVoxels.Y - Radius);
	const int32 MaxY = FMath::CeilToInt(CentreInVoxels.Y + Radius);

	for (int32 Z = MinZ; Z <= MaxZ; ++Z)
	{
		for (int32 Y = MinY; Y <= MaxY; ++Y)
		{
			for (int32 X = MinX; X <= MaxX; ++X)
			{
				const float DX = X - CentreInVoxels.X;
				const float DY = Y - CentreInVoxels.Y;
				const float DistSq = DX * DX + DY * DY;

				const bool bInside = DistSq <= RadiusSq;
				const bool bShell = DistSq >= (Radius - 1.0f) * (Radius - 1.0f);

				if (bHollow ? (bInside && bShell) : bInside)
				{
					ClearVoxel(FIntVector(X, Y, Z));
				}
			}
		}
	}
}

void UBCUVoxelGrid::FillCylinder(const FVector& CentreInVoxels, float Radius, float HalfHeight,
	EBCUVoxelMaterial Material, uint8 PaletteIndex)
{
	const float RadiusSq = Radius * Radius;
	const int32 MinZ = FMath::FloorToInt(CentreInVoxels.Z - HalfHeight);
	const int32 MaxZ = FMath::CeilToInt(CentreInVoxels.Z + HalfHeight);
	const int32 MinX = FMath::FloorToInt(CentreInVoxels.X - Radius);
	const int32 MaxX = FMath::CeilToInt(CentreInVoxels.X + Radius);
	const int32 MinY = FMath::FloorToInt(CentreInVoxels.Y - Radius);
	const int32 MaxY = FMath::CeilToInt(CentreInVoxels.Y + Radius);

	FBCUVoxel Voxel;
	Voxel.Material = static_cast<uint8>(Material);
	Voxel.PaletteIndex = PaletteIndex;

	for (int32 Z = MinZ; Z <= MaxZ; ++Z)
	{
		for (int32 Y = MinY; Y <= MaxY; ++Y)
		{
			for (int32 X = MinX; X <= MaxX; ++X)
			{
				const float DX = X - CentreInVoxels.X;
				const float DY = Y - CentreInVoxels.Y;
				if (DX * DX + DY * DY <= RadiusSq)
				{
					SetVoxel(FIntVector(X, Y, Z), Voxel, /*bMarkDirty=*/false);
				}
			}
		}
	}

	MarkAllChunksDirty();
}

void UBCUVoxelGrid::Stamp(const UBCUVoxelGrid* Source, const FIntVector& OffsetInVoxels)
{
	if (!Source)
	{
		return;
	}

	for (const TPair<FIntVector, FBCUVoxelChunk>& Pair : Source->Chunks)
	{
		const FBCUVoxelChunk& SrcChunk = Pair.Value;
		const FIntVector SrcOrigin = SrcChunk.Origin;

		for (int32 Z = 0; Z < SrcChunk.Dimensions.Z; ++Z)
		{
			for (int32 Y = 0; Y < SrcChunk.Dimensions.Y; ++Y)
			{
				for (int32 X = 0; X < SrcChunk.Dimensions.X; ++X)
				{
					const FBCUVoxel& Voxel = SrcChunk.Voxels[SrcChunk.Index(X, Y, Z)];
					if (Voxel.IsEmpty())
					{
						continue;
					}

					SetVoxel(SrcOrigin + FIntVector(X, Y, Z) + OffsetInVoxels, Voxel, /*bMarkDirty=*/false);
				}
			}
		}
	}

	MarkAllChunksDirty();
}

void UBCUVoxelGrid::GetDirtyChunks(TArray<FIntVector>& OutDirtyChunks) const
{
	OutDirtyChunks.Reset();
	for (const TPair<FIntVector, FBCUVoxelChunk>& Pair : Chunks)
	{
		if (Pair.Value.bDirty)
		{
			OutDirtyChunks.Add(Pair.Key);
		}
	}
}

void UBCUVoxelGrid::MarkChunkClean(const FIntVector& ChunkCoord)
{
	if (FBCUVoxelChunk* Chunk = Chunks.Find(ChunkCoord))
	{
		Chunk->bDirty = false;
	}
}

void UBCUVoxelGrid::MarkAllChunksDirty()
{
	for (TPair<FIntVector, FBCUVoxelChunk>& Pair : Chunks)
	{
		Pair.Value.bDirty = true;
	}
}

int32 UBCUVoxelGrid::GetNonEmptyVoxelCount() const
{
	int32 Count = 0;
	for (const TPair<FIntVector, FBCUVoxelChunk>& Pair : Chunks)
	{
		for (const FBCUVoxel& Voxel : Pair.Value.Voxels)
		{
			if (!Voxel.IsEmpty())
			{
				Count++;
			}
		}
	}
	return Count;
}

//═══════════════════════════════════════════════════════════════════════════════
// Spatial queries
//═══════════════════════════════════════════════════════════════════════════════

int32 UBCUVoxelGrid::GetHeightAt(int32 X, int32 Y) const
{
	for (int32 Z = ChunkCount.Z * ChunkDimensions.Z - 1; Z >= 0; --Z)
	{
		if (!IsEmpty(FIntVector(X, Y, Z)))
		{
			return Z;
		}
	}
	return INDEX_NONE;
}

bool UBCUVoxelGrid::ContainsMaterialNear(const FIntVector& Centre, float Radius,
	EBCUVoxelMaterial Material) const
{
	const int32 R = FMath::CeilToInt(Radius);
	const uint8 Wanted = static_cast<uint8>(Material);

	for (int32 Z = Centre.Z - R; Z <= Centre.Z + R; ++Z)
	{
		for (int32 Y = Centre.Y - R; Y <= Centre.Y + R; ++Y)
		{
			for (int32 X = Centre.X - R; X <= Centre.X + R; ++X)
			{
				if (GetVoxel(FIntVector(X, Y, Z)).Material == Wanted)
				{
					return true;
				}
			}
		}
	}

	return false;
}

bool UBCUVoxelGrid::LineTrace(const FVector& StartInVoxels, const FVector& EndInVoxels,
	FIntVector& OutHitVoxel, FIntVector& OutNormal, float& OutDistance) const
{
	// Amanatides & Woo voxel DDA. Exact, branch-light and independent of the
	// voxel count — the same cost for a 2 m probe or a 400 m sightline.
	FIntVector Current(StartInVoxels);
	const FVector Direction = EndInVoxels - StartInVoxels;

	if (Direction.IsNearlyZero())
	{
		return false;
	}

	const FIntVector Step(
		Direction.X > 0.0f ? 1 : (Direction.X < 0.0f ? -1 : 0),
		Direction.Y > 0.0f ? 1 : (Direction.Y < 0.0f ? -1 : 0),
		Direction.Z > 0.0f ? 1 : (Direction.Z < 0.0f ? -1 : 0));

	const FVector InvDir(
		FMath::IsNearlyZero(Direction.X) ? TNumericLimits<float>::Max() : 1.0f / FMath::Abs(Direction.X),
		FMath::IsNearlyZero(Direction.Y) ? TNumericLimits<float>::Max() : 1.0f / FMath::Abs(Direction.Y),
		FMath::IsNearlyZero(Direction.Z) ? TNumericLimits<float>::Max() : 1.0f / FMath::Abs(Direction.Z));

	const FVector Boundary(
		Step.X > 0 ? FMath::CeilToFloat(StartInVoxels.X) : FMath::FloorToFloat(StartInVoxels.X),
		Step.Y > 0 ? FMath::CeilToFloat(StartInVoxels.Y) : FMath::FloorToFloat(StartInVoxels.Y),
		Step.Z > 0 ? FMath::CeilToFloat(StartInVoxels.Z) : FMath::FloorToFloat(StartInVoxels.Z));

	FVector TMax(
		FMath::Abs(Boundary.X - StartInVoxels.X) * InvDir.X,
		FMath::Abs(Boundary.Y - StartInVoxels.Y) * InvDir.Y,
		FMath::Abs(Boundary.Z - StartInVoxels.Z) * InvDir.Z);

	const FVector TDelta(InvDir);
	const float MaxDistance = Direction.Size();

	OutNormal = FIntVector::ZeroValue;

	for (int32 Iteration = 0; Iteration < 4096; ++Iteration)
	{
		if (!IsEmpty(Current))
		{
			OutHitVoxel = Current;
			OutDistance = FMath::Min(MaxDistance,
				FMath::Max(0.0f, FMath::Min(FMath::Min(TMax.X - TDelta.X, TMax.Y - TDelta.Y), TMax.Z - TDelta.Z) * MaxDistance));
			return true;
		}

		if (TMax.X < TMax.Y && TMax.X < TMax.Z)
		{
			if (TMax.X > MaxDistance) { break; }
			Current.X += Step.X;
			TMax.X += TDelta.X;
			OutNormal = FIntVector(-Step.X, 0, 0);
		}
		else if (TMax.Y < TMax.Z)
		{
			if (TMax.Y > MaxDistance) { break; }
			Current.Y += Step.Y;
			TMax.Y += TDelta.Y;
			OutNormal = FIntVector(0, -Step.Y, 0);
		}
		else
		{
			if (TMax.Z > MaxDistance) { break; }
			Current.Z += Step.Z;
			TMax.Z += TDelta.Z;
			OutNormal = FIntVector(0, 0, -Step.Z);
		}
	}

	return false;
}

void UBCUVoxelGrid::FloodFillRegion(const FIntVector& Start, TArray<FIntVector>& OutRegion, int32 MaxVoxels) const
{
	OutRegion.Reset();

	if (!IsEmpty(Start))
	{
		return;
	}

	TArray<FIntVector> Queue;
	Queue.Reserve(MaxVoxels);
	Queue.Add(Start);

	TSet<FIntVector> Visited;
	Visited.Reserve(MaxVoxels);
	Visited.Add(Start);

	static const FIntVector Neighbours[6] =
	{
		FIntVector(1, 0, 0), FIntVector(-1, 0, 0),
		FIntVector(0, 1, 0), FIntVector(0, -1, 0),
		FIntVector(0, 0, 1), FIntVector(0, 0, -1)
	};

	int32 Head = 0;
	while (Head < Queue.Num() && OutRegion.Num() < MaxVoxels)
	{
		const FIntVector Current = Queue[Head++];
		OutRegion.Add(Current);

		for (const FIntVector& Offset : Neighbours)
		{
			const FIntVector Next = Current + Offset;
			if (Visited.Contains(Next) || !IsEmpty(Next))
			{
				continue;
			}

			Visited.Add(Next);
			Queue.Add(Next);
		}
	}
}

//═══════════════════════════════════════════════════════════════════════════════
// Coordinates
//═══════════════════════════════════════════════════════════════════════════════

FIntVector UBCUVoxelGrid::WorldToVoxel(const FVector& WorldPosition) const
{
	const FVector Origin = GetCellWorldOrigin();
	return FIntVector(
		FMath::FloorToInt((WorldPosition.X - Origin.X) / VoxelScaleCm),
		FMath::FloorToInt((WorldPosition.Y - Origin.Y) / VoxelScaleCm),
		FMath::FloorToInt((WorldPosition.Z - Origin.Z) / VoxelScaleCm));
}

FVector UBCUVoxelGrid::VoxelToWorld(const FIntVector& VoxelPosition) const
{
	const FVector Origin = GetCellWorldOrigin();
	return Origin + FVector(
		VoxelPosition.X * VoxelScaleCm,
		VoxelPosition.Y * VoxelScaleCm,
		VoxelPosition.Z * VoxelScaleCm);
}

FVector UBCUVoxelGrid::GetCellWorldOrigin() const
{
	// City cell size is fixed by the streamer (256 m = 25600 cm). Keeping the
	// constant here avoids a circular dependency on UBCUCityStreamer.
	static const float CellSizeCm = 25600.0f;
	return FVector(CellCoord.X * CellSizeCm, CellCoord.Y * CellSizeCm, 0.0f);
}
