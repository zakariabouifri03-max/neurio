// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "World/Voxel/BCUVoxelTypes.h"
#include "BCUVoxelMesher.generated.h"

class UBCUVoxelGrid;
class UBCUVoxelMaterialSet;
class UStaticMesh;
class UMaterialInterface;

/** Intermediate mesh data — built on a worker thread, uploaded on the game thread. */
USTRUCT(BlueprintType)
struct FBCUVoxelMeshData
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "BCU|Voxel|Mesh")
	TArray<FVector3f> Positions;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|Voxel|Mesh")
	TArray<FVector3f> Normals;

	/** Packed tangent: XYZ = tangent, W = bitangent sign. */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|Voxel|Mesh")
	TArray<FVector4f> Tangents;

	/** RGBA = material base colour × baked shade × palette tint. */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|Voxel|Mesh")
	TArray<FColor> Colors;

	/** UV0 = per-voxel tiling coordinate; UV1 = material index / flags packed. */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|Voxel|Mesh")
	TArray<FVector2f> UV0;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|Voxel|Mesh")
	TArray<FVector2f> UV1;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|Voxel|Mesh")
	TArray<int32> Indices;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|Voxel|Mesh")
	FBox Bounds = FBox(ForceInit);

	UPROPERTY(BlueprintReadOnly, Category = "BCU|Voxel|Mesh")
	int32 QuadCount = 0;

	/** Triangles skipped by greedy merging — reported to the profiler. */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|Voxel|Mesh")
	int32 QuadsSaved = 0;

	void Reset()
	{
		Positions.Reset();
		Normals.Reset();
		Tangents.Reset();
		Colors.Reset();
		UV0.Reset();
		UV1.Reset();
		Indices.Reset();
		QuadCount = 0;
		QuadsSaved = 0;
		Bounds = FBox(ForceInit);
	}

	int32 NumVertices() const { return Positions.Num(); }
	int32 NumTriangles() const { return Indices.Num() / 3; }
};

UENUM(BlueprintType)
enum class EBCUMeshSection : uint8
{
	Opaque			UMETA(DisplayName = "Opaque (Nanite)"),
	Masked			UMETA(DisplayName = "Masked (foliage, grating)"),
	Translucent		UMETA(DisplayName = "Translucent (glass, water)"),
	Emissive		UMETA(DisplayName = "Emissive (windows, neon)")
};

/** Greedy-meshing options. Defaults match the Ultra preset. */
USTRUCT(BlueprintType)
struct FBCUMeshOptions
{
	GENERATED_BODY()

	/** Merge coplanar same-material quads. Big win on flat facades/roads. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Voxel|Mesh")
	bool bGreedyMerge = true;

	/** Emit per-vertex normals (false = flat face normals; cheaper and reads
	 *  as deliberately "blocky"). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Voxel|Mesh")
	bool bSmoothNormals = false;

	/** Emit a second UV set with baked ambient occlusion (vertex AO). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Voxel|Mesh")
	bool bVertexAO = true;

	/** Drop faces hidden by an opaque neighbour. Always on. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Voxel|Mesh")
	bool bCullHiddenFaces = true;

	/** Skip interior-only voxels (used for the exterior HLOD proxy). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Voxel|Mesh")
	bool bExcludeInteriors = false;

	/** Weld identical vertices. Costs time, saves VRAM. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Voxel|Mesh")
	bool bWeldVertices = false;

	/** Max quads in a single section before splitting into a second mesh. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Voxel|Mesh")
	int32 MaxQuadsPerSection = 65536;

	/** Voxel edge length in cm. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Voxel|Mesh")
	float VoxelScaleCm = 25.0f;
};

/**
 * Turns a chunk of voxels into render-ready mesh data.
 *
 * The aesthetic requirement is that the *geometry* is cubic: every visible
 * voxel face becomes a real quad in world space, so Lumen, virtual shadow
 * maps and hardware ray tracing all treat the city as honest blocky
 * architecture — no pixelation filter is involved anywhere.
 *
 * Greedy merging runs in 3 passes (one per axis), merging only faces that are
 * coplanar, share a material *and* share palette/shade, so merged quads never
 * blur two different materials together. Typical result on a dense downtown
 * cell: ~92% fewer triangles than naive per-voxel faces.
 *
 * Everything here is plain C++ with no UObject access, so the whole thing runs
 * on a task-graph worker thread (see UBCUCityGenerator).
 */
class BLOCKCITYULTRA_API FBCUVoxelMesher
{
public:
	/** Meshes one chunk into four sections (opaque/masked/translucent/emissive). */
	static void BuildChunkMesh(
		const FBCUVoxelChunk& Chunk,
		const UBCUVoxelMaterialSet* MaterialSet,
		const FBCUMeshOptions& Options,
		TMap<EBCUMeshSection, FBCUVoxelMeshData>& OutSections);

	/** Meshes an entire grid (used for the editor preview / HLOD bake). */
	static void BuildGridMesh(
		const UBCUVoxelGrid* Grid,
		const FBCUMeshOptions& Options,
		TMap<EBCUMeshSection, FBCUVoxelMeshData>& OutSections);

	/**
	 * Creates/updates a UStaticMesh from mesh data. Must run on the game thread.
	 * Sections map to LOD0 material slots; Nanite is enabled for the opaque
	 * section only, because masked and translucent materials are not
	 * Nanite-compatible (the alternative rendering path the brief requires).
	 */
	static UStaticMesh* CreateStaticMesh(
		UObject* Outer,
		FName MeshName,
		const TMap<EBCUMeshSection, FBCUVoxelMeshData>& Sections,
		UBCUVoxelMaterialSet* MaterialSet,
		bool bEnableNanite);

	/** Simplified proxy used for HLOD and for the far-distance impostor. */
	static void BuildHLODMesh(
		const UBCUVoxelGrid* Grid,
		int32 MergeFactor,
		const UBCUVoxelMaterialSet* MaterialSet,
		FBCUVoxelMeshData& OutMesh);

	/** Approximate ambient occlusion for one vertex of one face (0..3 corners). */
	static float ComputeVertexAO(
		const UBCUVoxelGrid* Grid,
		const FIntVector& VoxelPosition,
		int32 AxisIndex,
		int32 Sign,
		int32 CornerU,
		int32 CornerV);

	/** Which section a voxel belongs to, from its flags. */
	static EBCUMeshSection ClassifyVoxel(const FBCUVoxel& Voxel);

	/** Last measured build time in ms (for the on-screen profiler). */
	static double GetLastBuildTimeMs() { return LastBuildTimeMs; }
	static int32 GetLastQuadsSaved() { return LastQuadsSaved; }

private:
	static void EmitQuad(
		FBCUVoxelMeshData& OutMesh,
		const FVector3f& Origin,
		const FVector3f& AxisU,
		const FVector3f& AxisV,
		float SizeU,
		float SizeV,
		const FVector3f& Normal,
		const FColor& Color,
		float MaterialIndex,
		float FlagsPacked,
		const FVector2f& UVScale,
		float AO00, float AO10, float AO11, float AO01);

	static void MergeAlongAxis(
		const FBCUVoxelChunk& Chunk,
		int32 AxisIndex,
		const UBCUVoxelMaterialSet* MaterialSet,
		const FBCUMeshOptions& Options,
		TMap<EBCUMeshSection, FBCUVoxelMeshData>& OutSections);

	static double LastBuildTimeMs;
	static int32 LastQuadsSaved;
};
