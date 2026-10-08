// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "Voxel/VoxelCoreTypes.h"
#include "VoxelBlockPalette.generated.h"

/** Material slot indices used by the default palette. */
namespace VoxelMaterialSlots
{
	/** Opaque atlas material: terrain, buildings, roads. The vast majority of quads. */
	constexpr uint8 Opaque = 0;

	/** Masked/translucent material: glass, water, foliage. */
	constexpr uint8 Transparent = 1;

	/** Emissive material: lamps, signs, screens. */
	constexpr uint8 Emissive = 2;

	constexpr int32 NumDefaultSlots = 3;
}

/**
 * A rectangle in atlas UV space.
 *
 * The mesher only ever sees resolved UVs, never tile indices or atlas dimensions.
 * That keeps the atlas layout (a decision about textures) completely out of mesh
 * generation (a decision about geometry), so either can change without the other.
 */
USTRUCT(BlueprintType)
struct FVoxelAtlasRect
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	float UMin = 0.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	float VMin = 0.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	float UMax = 1.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	float VMax = 1.0f;

	/**
	 * Builds the UV rect for one tile of a square atlas.
	 *
	 * @param Padding  Fraction of a tile shaved off every edge. Non-zero padding is
	 *                 what stops neighbouring tiles bleeding into each other once
	 *                 mipmaps are generated - without it, a sand block three tiles
	 *                 from grass grows a green fringe at distance.
	 */
	static FVoxelAtlasRect FromTile(int32 TileIndex, int32 TilesPerAxis, float Padding = 0.0f)
	{
		FVoxelAtlasRect Rect;
		if (TilesPerAxis <= 0)
		{
			return Rect;
		}

		const int32 SafeIndex = FMath::Max(0, TileIndex);
		const int32 Column = SafeIndex % TilesPerAxis;
		const int32 Row = SafeIndex / TilesPerAxis;

		const float TileSize = 1.0f / static_cast<float>(TilesPerAxis);
		const float Pad = FMath::Clamp(Padding, 0.0f, 0.25f) * TileSize;

		Rect.UMin = Column * TileSize + Pad;
		Rect.VMin = Row * TileSize + Pad;
		Rect.UMax = (Column + 1) * TileSize - Pad;
		Rect.VMax = (Row + 1) * TileSize - Pad;
		return Rect;
	}

	float Width() const { return FMath::Max(0.0f, UMax - UMin); }
	float Height() const { return FMath::Max(0.0f, VMax - VMin); }
};

/** Per-face UVs for a block. Three entries cover every cube face. */
USTRUCT(BlueprintType)
struct FVoxelBlockUVs
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	FVoxelAtlasRect Top;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	FVoxelAtlasRect Side;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	FVoxelAtlasRect Bottom;

	/** Sets all three at once - the common case for uniform blocks like stone. */
	void SetAll(const FVoxelAtlasRect& Rect)
	{
		Top = Rect;
		Side = Rect;
		Bottom = Rect;
	}

	const FVoxelAtlasRect& ForFace(EVoxelFace Face) const
	{
		// UE is Z-up: ZPos is the top of the block, ZNeg its underside.
		switch (Face)
		{
		case EVoxelFace::ZPos: return Top;
		case EVoxelFace::ZNeg: return Bottom;
		default:			   return Side;
		}
	}
};

/**
 * Everything the generator and mesher need to know about one block type, as plain
 * data. This is a value-copyable snapshot: a worker task gets its own, so a
 * designer editing a block definition in the editor cannot change the meaning of a
 * chunk halfway through meshing it.
 */
USTRUCT(BlueprintType)
struct FVoxelBlockProperties
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	uint16 BlockId = 0;

	/** Full cube, cross, custom or nothing. Decides whether the mesher emits quads. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	EVoxelBlockMeshBehaviour MeshBehaviour = EVoxelBlockMeshBehaviour::FullCube;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	EVoxelBlockCollisionType CollisionType = EVoxelBlockCollisionType::Solid;

	/** Opaque blocks hide the faces of their neighbours. Glass does not. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	bool bOpaque = true;

	/** Solid blocks block movement and are what "is there ground here" means. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	bool bSolid = true;

	/** Emitted into the opaque material slot or the transparent one. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel", meta = (ClampMin = "0", ClampMax = "7"))
	uint8 MaterialSlotIndex = VoxelMaterialSlots::Opaque;

	/** Index into the project's physical-surface list, resolved by the UObject layer. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	uint8 SurfaceTypeIndex = 0;

	/** Seconds-ish effort to break. Used by interaction/mining in a later phase. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	float Hardness = 1.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	FVoxelBlockUVs UVs;

	/**
	 * Multiplied into the vertex colour. A tint of (255,255,255) leaves the texture
	 * untouched; anything else recolours it, which is how one grass texture becomes
	 * grassland, forest and swamp variants without three textures.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	FColor Tint = FColor::White;

	/** True when this block contributes any geometry at all. */
	bool IsRenderable() const { return MeshBehaviour == EVoxelBlockMeshBehaviour::FullCube; }

	bool IsCollidable() const { return CollisionType != EVoxelBlockCollisionType::None; }

	/** Air: nothing rendered, nothing collided, never hides a neighbour's face. */
	static FVoxelBlockProperties MakeAir()
	{
		FVoxelBlockProperties Props;
		Props.BlockId = 0;
		Props.MeshBehaviour = EVoxelBlockMeshBehaviour::None;
		Props.CollisionType = EVoxelBlockCollisionType::None;
		Props.bOpaque = false;
		Props.bSolid = false;
		Props.Hardness = 0.0f;
		return Props;
	}
};

/**
 * The runtime block table: a flat array indexed directly by BlockId.
 *
 * O(1), branch-free lookup with no map and no UObject dereference - the mesher asks
 * about a block for every face it considers, so this is the hottest lookup in the
 * engine. UVoxelBlockRegistry (the data asset) builds one of these once and hands
 * copies to worker tasks.
 */
USTRUCT(BlueprintType)
struct FVoxelBlockPalette
{
	GENERATED_BODY()

	TArray<FVoxelBlockProperties> Blocks;

	int32 Num() const { return Blocks.Num(); }
	bool Contains(uint16 BlockId) const { return Blocks.IsValidIndex(BlockId); }

	/** Never returns null and never asserts: an invalid id degrades to air. */
	const FVoxelBlockProperties& Get(uint16 BlockId) const
	{
		static const FVoxelBlockProperties AirProps = FVoxelBlockProperties::MakeAir();
		return Blocks.IsValidIndex(BlockId) ? Blocks[BlockId] : AirProps;
	}

	/**
	 * Grows the table so BlockId is addressable, filling the new gaps with air.
	 *
	 * Deliberately uses SetNum and not SetNumZeroed: SetNumZeroed memsets the whole
	 * array, which would silently convert every block the palette already knew about
	 * into a zeroed struct - and a zeroed FVoxelBlockProperties has MeshBehaviour
	 * FullCube, i.e. air that renders. Growing by appending keeps existing entries.
	 */
	FVoxelBlockProperties& AddOrGet(uint16 BlockId)
	{
		const int32 Required = static_cast<int32>(BlockId) + 1;
		if (Blocks.Num() < Required)
		{
			const int32 OldNum = Blocks.Num();
			Blocks.SetNum(Required);
			for (int32 Index = OldNum; Index < Blocks.Num(); ++Index)
			{
				Blocks[Index] = FVoxelBlockProperties::MakeAir();
				Blocks[Index].BlockId = static_cast<uint16>(Index);
			}
		}
		return Blocks[BlockId];
	}

	SIZE_T GetAllocatedBytes() const
	{
		return static_cast<SIZE_T>(Blocks.Num() + Blocks.GetSlack()) * sizeof(FVoxelBlockProperties);
	}
};
