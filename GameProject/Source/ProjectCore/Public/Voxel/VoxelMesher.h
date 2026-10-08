// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "Voxel/VoxelBlockPalette.h"
#include "Voxel/VoxelChunkData.h"
#include "Voxel/VoxelCoordinates.h"
#include "Voxel/VoxelCoreTypes.h"
#include "VoxelMesher.generated.h"

/**
 * VOXEL CORE - MESH GENERATION
 *
 * Two meshers share one interface, IVoxelMesher:
 *
 *   FVoxelCulledMesher - one quad per exposed face, with per-vertex ambient
 *     occlusion and directional face shading. This is what makes a blocky world
 *     look like geometry instead of a coloured grid: every edge catches light, and
 *     corners go dark where blocks meet. Used for near chunks.
 *
 *   FVoxelGreedyMesher - coplanar, identical faces merged into large rectangles.
 *     Far fewer triangles and vertices, so far terrain costs almost nothing to
 *     draw. Per-vertex AO is not possible on a merged quad, which is why mesher
 *     mode and LOD are the same dial rather than two independent ones.
 *
 * Face culling is not optional in either: a face shared by two opaque blocks is
 * never emitted. On solid terrain that removes roughly five sixths of all quads.
 *
 * Both meshers are stateless singletons and take their input by const reference, so
 * any number of them can run concurrently on different chunks.
 */

/** Per-face geometry tables. Fixed order, indexed by EVoxelFace. */
namespace VoxelMeshTables
{
	struct FFaceGeometry
	{
		/** World-space normal (unit, axis aligned). */
		FIntVector Normal;

		/** Which world axis the face is perpendicular to: 0 = X, 1 = Y, 2 = Z. */
		int32 AxisIndex;

		/** +1 for the positive face, -1 for the negative one. */
		int32 AxisSign;

		/** The two in-plane axes, U then V. */
		int32 UAxis;
		int32 VAxis;

		/**
		 * The four corners of the face, as offsets from the block's minimum corner,
		 * wound clockwise when seen from outside. UE is left handed and treats
		 * clockwise as front facing, so this order renders without a flip.
		 */
		FIntVector Corners[4];

		/** UV correction so no face samples its tile mirrored. */
		bool bFlipU;
		bool bFlipV;

		/**
		 * Directional shading multiplier. Even with a flat texture and a single light,
		 * giving the top face full brightness and the sides less is what reads as
		 * "solid" - the same trick the whole block-game genre is built on.
		 */
		float Shading;
	};

	/** Accessor. Index is clamped, so a bad EVoxelFace can never read out of bounds. */
	const FFaceGeometry& GetFace(EVoxelFace Face);

	inline EVoxelFace Opposite(EVoxelFace Face)
	{
		switch (Face)
		{
		case EVoxelFace::XNeg: return EVoxelFace::XPos;
		case EVoxelFace::XPos: return EVoxelFace::XNeg;
		case EVoxelFace::YNeg: return EVoxelFace::YPos;
		case EVoxelFace::YPos: return EVoxelFace::YNeg;
		case EVoxelFace::ZNeg: return EVoxelFace::ZPos;
		case EVoxelFace::ZPos: return EVoxelFace::ZNeg;
		default:			   return EVoxelFace::Count;
		}
	}

	/** The neighbour offset for a face, i.e. where to look for the occluder. */
	inline FIntVector FaceOffset(EVoxelFace Face)
	{
		const FFaceGeometry& Geo = GetFace(Face);
		return Geo.Normal;
	}

	/** Maps a face's corner (U, V) pair to atlas UVs inside Rect, honouring flips. */
	inline FVector2D CornerUV(const FFaceGeometry& Geo, const FVoxelAtlasRect& Rect, int32 U, int32 V)
	{
		const float Fu = Geo.bFlipU ? (1.0f - static_cast<float>(U)) : static_cast<float>(U);
		const float Fv = Geo.bFlipV ? (1.0f - static_cast<float>(V)) : static_cast<float>(V);

		return FVector2D(
			Rect.UMin + Rect.Width() * Fu,
			Rect.VMin + Rect.Height() * Fv);
	}

	/** Ambient occlusion brightness ramp, indexed by AO level 0 (darkest) .. 3 (none). */
	inline float AmbientOcclusionBrightness(int32 AOLevel)
	{
		static const float Ramp[4] = { 0.44f, 0.64f, 0.82f, 1.00f };
		return Ramp[FMath::Clamp(AOLevel, 0, 3)];
	}
}

/** Why a mesh build failed. No strings in the core, so diagnostics stay an enum. */
UENUM(BlueprintType)
enum class EVoxelMeshError : uint8
{
	None				UMETA(DisplayName = "None"),
	InvalidDimensions	UMETA(DisplayName = "Invalid Dimensions"),
	NoBlockData			UMETA(DisplayName = "No Block Data"),
	EmptyPalette		UMETA(DisplayName = "Empty Palette"),
	SectionOverflow		UMETA(DisplayName = "Section Overflow")
};

/** One draw section: a set of quads sharing one material slot. */
USTRUCT(BlueprintType)
struct FVoxelMeshSection
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Voxel")
	int32 MaterialSlotIndex = 0;

	TArray<FVector> Vertices;
	TArray<int32> Triangles;
	TArray<FVector> Normals;
	TArray<FVector2D> UVs;
	TArray<FColor> Colors;

	/** Local-space bounds, relative to the chunk's minimum corner. */
	UPROPERTY(BlueprintReadOnly, Category = "Voxel")
	FBox Bounds = FBox(ForceInit);

	UPROPERTY(BlueprintReadOnly, Category = "Voxel")
	int32 FaceCount = 0;

	bool IsEmpty() const { return Vertices.Num() == 0 || Triangles.Num() == 0; }
	void Reset();
	void Reserve(int32 ExpectedFaces);

	SIZE_T GetAllocatedBytes() const;
};

/** Collision is a separate, simpler output: positions and indices, nothing else. */
USTRUCT(BlueprintType)
struct FVoxelCollisionMesh
{
	GENERATED_BODY()

	TArray<FVector> Vertices;
	TArray<int32> Triangles;

	UPROPERTY(BlueprintReadOnly, Category = "Voxel")
	FBox Bounds = FBox(ForceInit);

	UPROPERTY(BlueprintReadOnly, Category = "Voxel")
	EVoxelMeshError Error = EVoxelMeshError::None;

	bool IsEmpty() const { return Vertices.Num() == 0 || Triangles.Num() == 0; }
	void Reset();
	SIZE_T GetAllocatedBytes() const;
};

/** Full result of a visual mesh build, plus the statistics the debug HUD reports. */
USTRUCT(BlueprintType)
struct FVoxelMeshResult
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "Voxel")
	TArray<FVoxelMeshSection> Sections;

	UPROPERTY(BlueprintReadOnly, Category = "Voxel")
	FBox Bounds = FBox(ForceInit);

	UPROPERTY(BlueprintReadOnly, Category = "Voxel")
	EVoxelMeshError Error = EVoxelMeshError::None;

	UPROPERTY(BlueprintReadOnly, Category = "Voxel")
	int32 TotalFaces = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Voxel")
	int32 TotalVertices = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Voxel")
	int32 TotalTriangles = 0;

	/** Milliseconds spent in the mesher itself. Reported by the debug overlay. */
	UPROPERTY(BlueprintReadOnly, Category = "Voxel")
	double GenerationTimeMs = 0.0;

	/** Faces that culling removed. Shown in the debug HUD to prove culling works. */
	UPROPERTY(BlueprintReadOnly, Category = "Voxel")
	int32 CulledFaces = 0;

	bool IsValid() const { return Error == EVoxelMeshError::None; }
	void Reset();
	SIZE_T GetAllocatedBytes() const;
};

/**
 * Read-only block access for the mesher.
 *
 * An interface rather than a concrete type for two reasons: it lets the mesher work
 * from either a live chunk plus its neighbours (game thread, editing) or from a
 * detached snapshot (worker thread, generation), and it is the seam a Phase 03
 * mesh-decimation pass plugs into without touching mesher internals.
 */
class IVoxelBlockSource
{
public:
	virtual ~IVoxelBlockSource() = default;

	virtual const FVoxelDimensions& GetDimensions() const = 0;
	virtual const FVoxelChunkCoord& GetChunkCoord() const = 0;

	/** Chunk-local read. Out of range returns air. */
	virtual FVoxelBlock GetLocalBlock(int32 X, int32 Y, int32 Z) const = 0;

	/** Absolute voxel read; may resolve into a neighbouring chunk. */
	virtual FVoxelBlock GetBlockAtVoxel(const FIntVector& Voxel) const = 0;

	/** True when the neighbour's data is known, so its faces can be culled against. */
	virtual bool IsNeighbourAvailable(const FVoxelChunkCoord& Coord) const = 0;
};

/**
 * A detached copy of one chunk plus the four one-block-thick border slabs it needs.
 *
 * This is what makes async meshing safe. A worker thread gets its own snapshot, so
 * it never reads a chunk the game thread is editing, and the game thread never
 * waits on a worker. Copying the slabs instead of whole neighbour chunks matters:
 * at 32x32x128 a full chunk is 512 KB, while the four slabs together are 64 KB.
 */
class FVoxelBlockSnapshot : public IVoxelBlockSource
{
public:
	FVoxelBlockSnapshot() = default;

	/** Builds a snapshot from a chunk. Neighbour slabs are added by AddBorderSlab. */
	explicit FVoxelBlockSnapshot(const FVoxelChunkData& Chunk);

	/**
	 * Supplies the bordering slice of a neighbouring chunk.
	 * @param Face  Which side of this chunk the neighbour sits on (XNeg/XPos/YNeg/YPos).
	 * @param Slab  One block thick, ordered along (U, V) of that face, bottom to top.
	 */
	void AddBorderSlab(EVoxelFace Face, TArray<FVoxelBlock>&& Slab);

	void MarkBorderUnavailable(EVoxelFace Face);

	// IVoxelBlockSource
	virtual const FVoxelDimensions& GetDimensions() const override { return Dims; }
	virtual const FVoxelChunkCoord& GetChunkCoord() const override { return Coord; }
	virtual FVoxelBlock GetLocalBlock(int32 X, int32 Y, int32 Z) const override;
	virtual FVoxelBlock GetBlockAtVoxel(const FIntVector& Voxel) const override;
	virtual bool IsNeighbourAvailable(const FVoxelChunkCoord& NeighbourCoord) const override;

	bool IsEmpty() const { return Blocks.Num() == 0; }
	SIZE_T GetAllocatedBytes() const;

	/** Number of blocks in one border slab for these dimensions. */
	static int32 BorderSlabSize(EVoxelFace Face, const FVoxelDimensions& Dims);

	/** Extracts the slab of Chunk that borders Face, from the neighbour's perspective. */
	static TArray<FVoxelBlock> ExtractBorderSlab(const FVoxelChunkData& Chunk, EVoxelFace Face);

private:
	FVoxelChunkCoord Coord;
	FVoxelDimensions Dims;
	TArray<FVoxelBlock> Blocks;

	/** Indexed by EVoxelFace (only XNeg, XPos, YNeg, YPos are used). */
	TArray<FVoxelBlock> BorderSlabs[static_cast<int32>(EVoxelFace::Count)];
	bool bBorderAvailable[static_cast<int32>(EVoxelFace::Count)] = { false, false, false, false, false, false };
};

/** Knobs for one mesh build. Copied into the task, never read from a global. */
USTRUCT(BlueprintType)
struct FVoxelMesherSettings
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	EVoxelMesherMode Mode = EVoxelMesherMode::CulledFaces;

	/** Per-vertex AO. Ignored in Greedy mode: a merged quad has no per-block corners. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	bool bEnableAmbientOcclusion = true;

	/** Directional per-face shading (top brightest, bottom darkest). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	bool bEnableFaceShading = true;

	/** Bake the block's tint into vertex colours. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	bool bEmitVertexColors = true;

	/**
	 * When true, faces on the chunk's outer boundary are culled as if a solid block
	 * were there. Only correct when the chunk is fully enclosed by loaded neighbours;
	 * used as an optimisation for interior chunks. Default false means "the neighbour
	 * is air until proven otherwise", which never hides a face that should be seen.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	bool bAssumeOutsideSolid = false;

	/**
	 * The bottom of the world column is never visible from below in normal play.
	 * Culling it removes one full quad layer per chunk for free.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	bool bCullWorldBottomFace = true;

	/**
	 * Suppresses the face between two adjacent blocks of the same non-opaque id, so a
	 * glass wall draws its outer surfaces only instead of every internal pane.
	 * Merging in greedy mode is always restricted to identical block ids.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel")
	bool bCullIdenticalTransparentNeighbours = true;

	/**
	 * A section is closed and a new one started past this vertex count. Very large
	 * sections are slow to rebuild after a single block edit; very small ones cost
	 * draw calls. 8192 vertices (2048 quads) is a good middle ground.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Voxel", meta = (ClampMin = "256", ClampMax = "65536"))
	int32 MaxVerticesPerSection = 8192;
};

/** The mesher contract. Both built-in meshers are stateless and thread safe. */
class IVoxelMesher
{
public:
	virtual ~IVoxelMesher() = default;

	virtual EVoxelMesherMode GetMode() const = 0;
	virtual const TCHAR* GetName() const = 0;

	/** Builds render geometry: positions, indices, normals, UVs, vertex colours. */
	virtual void GenerateVisualMesh(
		const IVoxelBlockSource& Source,
		const FVoxelBlockPalette& Palette,
		const FVoxelMesherSettings& Settings,
		FVoxelMeshResult& OutResult) const = 0;

	/** Builds collision geometry. Always merged: collision wants few, large triangles. */
	virtual void GenerateCollisionMesh(
		const IVoxelBlockSource& Source,
		const FVoxelBlockPalette& Palette,
		const FVoxelMesherSettings& Settings,
		FVoxelCollisionMesh& OutResult) const = 0;
};

/** Per-face quads with ambient occlusion. The default, highest quality mesher. */
class FVoxelCulledMesher : public IVoxelMesher
{
public:
	virtual EVoxelMesherMode GetMode() const override { return EVoxelMesherMode::CulledFaces; }
	virtual const TCHAR* GetName() const override { return TEXT("CulledFaces"); }

	virtual void GenerateVisualMesh(
		const IVoxelBlockSource& Source,
		const FVoxelBlockPalette& Palette,
		const FVoxelMesherSettings& Settings,
		FVoxelMeshResult& OutResult) const override;

	virtual void GenerateCollisionMesh(
		const IVoxelBlockSource& Source,
		const FVoxelBlockPalette& Palette,
		const FVoxelMesherSettings& Settings,
		FVoxelCollisionMesh& OutResult) const override;
};

/** Coplanar face merging. Lowest triangle count, used for distant chunks. */
class FVoxelGreedyMesher : public IVoxelMesher
{
public:
	virtual EVoxelMesherMode GetMode() const override { return EVoxelMesherMode::Greedy; }
	virtual const TCHAR* GetName() const override { return TEXT("Greedy"); }

	virtual void GenerateVisualMesh(
		const IVoxelBlockSource& Source,
		const FVoxelBlockPalette& Palette,
		const FVoxelMesherSettings& Settings,
		FVoxelMeshResult& OutResult) const override;

	virtual void GenerateCollisionMesh(
		const IVoxelBlockSource& Source,
		const FVoxelBlockPalette& Palette,
		const FVoxelMesherSettings& Settings,
		FVoxelCollisionMesh& OutResult) const override;
};

/**
 * THE documented enable point for meshing strategy.
 *
 * Nothing else in the project picks a mesher. Streaming decides a chunk's LOD, the
 * LOD decides the mode, this decides the implementation - one line to change when a
 * third mesher (decimated, impostor, Nanite-backed) arrives in a later phase.
 */
namespace VoxelMesherFactory
{
	const IVoxelMesher& Get(EVoxelMesherMode Mode);
	const IVoxelMesher& GetForLOD(EVoxelChunkLOD LOD);
}
