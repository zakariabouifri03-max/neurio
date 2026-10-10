// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "World/Voxel/BCUVoxelTypes.h"
#include "BCUVoxelGrid.generated.h"

class UBCUVoxelMaterialSet;
struct FBCUVoxelMeshData;

/** A chunk is the unit of meshing, streaming and dirty-marking. */
USTRUCT(BlueprintType)
struct FBCUVoxelChunk
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "BCU|Voxel")
	FIntVector Origin = FIntVector::ZeroValue;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|Voxel")
	FIntVector Dimensions = FIntVector(64, 64, 96);

	/** X + Dimensions.X * (Y + Dimensions.Y * Z) */
	TArray<FBCUVoxel> Voxels;

	/** Set when a voxel changed and the mesh must be rebuilt. */
	bool bDirty = true;

	/** Bounding box in world space, valid once Dimensions/Origin are set. */
	FBox Bounds = FBox(ForceInit);

	FORCEINLINE int32 Index(int32 X, int32 Y, int32 Z) const
	{
		return X + Dimensions.X * (Y + Dimensions.Y * Z);
	}

	FORCEINLINE bool Contains(int32 X, int32 Y, int32 Z) const
	{
		return X >= 0 && Y >= 0 && Z >= 0
			&& X < Dimensions.X && Y < Dimensions.Y && Z < Dimensions.Z;
	}

	FORCEINLINE int32 Num() const { return Dimensions.X * Dimensions.Y * Dimensions.Z; }

	FORCEINLINE const FBCUVoxel& At(int32 X, int32 Y, int32 Z) const
	{
		static const FBCUVoxel Empty;
		if (!Contains(X, Y, Z))
		{
			return Empty;
		}
		return Voxels[Index(X, Y, Z)];
	}

	FORCEINLINE FBCUVoxel& MutableAt(int32 X, int32 Y, int32 Z)
	{
		return Voxels[Index(X, Y, Z)];
	}

	void Allocate(const FIntVector& InDimensions, const FIntVector& InOrigin)
	{
		Dimensions = InDimensions;
		Origin = InOrigin;
		Voxels.SetNumZeroed(Num());
		bDirty = true;
	}
};

/**
 * Sparse voxel storage for one city cell (default 256 m × 256 m × 240 m).
 *
 * Why a chunk grid and not one giant array: a 200 km² city at 25 cm voxels is
 * ~3.2 × 10^12 voxels. We only store chunks that contain something, mesh them
 * independently, and stream them in/out with World Partition.
 *
 * Thread safety: Set/Get are safe to call from the async city-generation task
 * as long as the caller owns the grid (UBCUCityGenerator does — one grid per
 * worker job, merged back on the game thread).
 */
UCLASS(BlueprintType, meta = (DisplayName = "BCU Voxel Grid"))
class BLOCKCITYULTRA_API UBCUVoxelGrid : public UObject
{
	GENERATED_BODY()

public:
	UBCUVoxelGrid();

	/** Allocates a sparse grid covering ExtentChunks chunks in each direction. */
	void Initialise(const FIntVector& ChunkDimensions, const FIntVector& ChunkCount,
		const FBCUCellCoord& CellCoord, float InVoxelScaleCm);

	// ── Voxel access (chunk-local coordinates resolved internally) ──────────
	void SetVoxel(const FIntVector& GridPosition, const FBCUVoxel& Voxel, bool bMarkDirty = true);
	void SetVoxel(const FIntVector& GridPosition, EBCUVoxelMaterial Material, uint8 PaletteIndex = 0);
	FBCUVoxel GetVoxel(const FIntVector& GridPosition) const;
	bool IsEmpty(const FIntVector& GridPosition) const;
	void ClearVoxel(const FIntVector& GridPosition);

	/** Fills an axis-aligned box — the workhorse of the building generator. */
	void FillBox(const FBox& BoundsInVoxels, EBCUVoxelMaterial Material, uint8 PaletteIndex = 0,
		uint8 Flags = 0, uint8 Shade = 255);

	/** Hollows a box (interior carving), leaving walls of WallThickness. */
	void CarveBox(const FBox& BoundsInVoxels, float WallThickness = 1.0f);

	/** Carves a cylinder — used for silos, chimneys, tunnels, pillars. */
	void CarveCylinder(const FVector& CentreInVoxels, float Radius, float HalfHeight, bool bHollow);

	/** Fills a cylinder. */
	void FillCylinder(const FVector& CentreInVoxels, float Radius, float HalfHeight,
		EBCUVoxelMaterial Material, uint8 PaletteIndex = 0);

	/** Sums a smaller grid into this one at an offset (building placement). */
	void Stamp(const UBCUVoxelGrid* Source, const FIntVector& OffsetInVoxels);

	// ── Chunk management ────────────────────────────────────────────────────
	FBCUVoxelChunk* GetChunk(const FIntVector& ChunkCoord);
	const FBCUVoxelChunk* GetChunk(const FIntVector& ChunkCoord) const;
	FBCUVoxelChunk* GetOrCreateChunk(const FIntVector& ChunkCoord);
	void GetDirtyChunks(TArray<FIntVector>& OutDirtyChunks) const;
	void MarkChunkClean(const FIntVector& ChunkCoord);
	void MarkAllChunksDirty();

	int32 GetChunkCount() const { return Chunks.Num(); }
	int32 GetNonEmptyVoxelCount() const;

	// ── Spatial queries ─────────────────────────────────────────────────────
	/** Highest non-empty voxel Z at (X,Y), or INDEX_NONE. */
	int32 GetHeightAt(int32 X, int32 Y) const;

	/** True when any voxel within Radius of Centre matches Material. */
	bool ContainsMaterialNear(const FIntVector& Centre, float Radius, EBCUVoxelMaterial Material) const;

	/** DDA voxel raycast. Returns true on hit; OutPosition is the hit voxel. */
	bool LineTrace(const FVector& StartInVoxels, const FVector& EndInVoxels,
		FIntVector& OutHitVoxel, FIntVector& OutNormal, float& OutDistance) const;

	/** Flood-fills a connected region (used for interior detection). */
	void FloodFillRegion(const FIntVector& Start, TArray<FIntVector>& OutRegion, int32 MaxVoxels = 8192) const;

	// ── Coordinate helpers ──────────────────────────────────────────────────
	FIntVector WorldToVoxel(const FVector& WorldPosition) const;
	FVector VoxelToWorld(const FIntVector& VoxelPosition) const;
	FVector GetCellWorldOrigin() const;

	UFUNCTION(BlueprintPure, Category = "BCU|Voxel")
	float GetVoxelScaleCm() const { return VoxelScaleCm; }

	UFUNCTION(BlueprintPure, Category = "BCU|Voxel")
	FBCUCellCoord GetCellCoord() const { return CellCoord; }

	const FIntVector& GetChunkDimensions() const { return ChunkDimensions; }
	const FIntVector& GetChunkCount() const { return ChunkCount; }

	/** Material set used when meshing (colours, traits, Nanite compatibility). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Voxel")
	TObjectPtr<UBCUVoxelMaterialSet> MaterialSet;

protected:
	UPROPERTY()
	FBCUCellCoord CellCoord;

	FIntVector ChunkDimensions = FIntVector(64, 64, 96);
	FIntVector ChunkCount = FIntVector(4, 4, 1);
	float VoxelScaleCm = 25.0f;

	TMap<FIntVector, FBCUVoxelChunk> Chunks;

	FORCEINLINE FIntVector ChunkCoordOf(const FIntVector& GridPosition) const
	{
		return FIntVector(
			FMath::FloorToInt(float(GridPosition.X) / ChunkDimensions.X),
			FMath::FloorToInt(float(GridPosition.Y) / ChunkDimensions.Y),
			FMath::FloorToInt(float(GridPosition.Z) / ChunkDimensions.Z));
	}

	FORCEINLINE FIntVector LocalOf(const FIntVector& GridPosition, const FIntVector& ChunkCoord) const
	{
		return GridPosition - ChunkCoord * ChunkDimensions;
	}
};
