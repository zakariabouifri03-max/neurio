// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "World/Voxel/BCUVoxelMesher.h"

#include "World/Voxel/BCUVoxelGrid.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInterface.h"
#include "RenderingThread.h"
#include "StaticMeshResources.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUMesher, Log, All);

double FBCUVoxelMesher::LastBuildTimeMs = 0.0;
int32 FBCUVoxelMesher::LastQuadsSaved = 0;

namespace
{
	/** One entry of the greedy-merge mask. */
	struct FFaceMaskEntry
	{
		uint8 Material = 0;
		uint8 Palette = 0;
		uint8 Flags = 0;
		uint8 Shade = 255;
		int8 Orientation = 0;   // +1 = facing along +Axis, -1 = facing along -Axis, 0 = no face

		FORCEINLINE bool operator==(const FFaceMaskEntry& Other) const
		{
			return Material == Other.Material && Palette == Other.Palette
				&& Flags == Other.Flags && Shade == Other.Shade
				&& Orientation == Other.Orientation;
		}

		FORCEINLINE bool IsEmpty() const { return Orientation == 0; }
	};

	FORCEINLINE bool IsOpaque(const FBCUVoxel& Voxel)
	{
		return !Voxel.IsEmpty() && (Voxel.Flags & (FBCUVoxel::FLAG_Translucent | FBCUVoxel::FLAG_Masked)) == 0;
	}

	FORCEINLINE bool BlocksFace(const FBCUVoxel& Self, const FBCUVoxel& Neighbour)
	{
		if (Neighbour.IsEmpty())
		{
			return false;
		}
		// A translucent/masked neighbour does not hide our face, but two
		// identical translucent voxels do not need an internal face either.
		if (!IsOpaque(Neighbour))
		{
			return Self.Material == Neighbour.Material && Self.PaletteIndex == Neighbour.PaletteIndex;
		}
		return true;
	}
}

//═══════════════════════════════════════════════════════════════════════════════
// Classification
//═══════════════════════════════════════════════════════════════════════════════

EBCUMeshSection FBCUVoxelMesher::ClassifyVoxel(const FBCUVoxel& Voxel)
{
	if (Voxel.IsEmissive())
	{
		return EBCUMeshSection::Emissive;
	}
	if (Voxel.IsMasked())
	{
		return EBCUMeshSection::Masked;
	}
	if (Voxel.IsTranslucent())
	{
		return EBCUMeshSection::Translucent;
	}
	return EBCUMeshSection::Opaque;
}

//═══════════════════════════════════════════════════════════════════════════════
// Quad emission
//═══════════════════════════════════════════════════════════════════════════════

void FBCUVoxelMesher::EmitQuad(
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
	float AO00, float AO10, float AO11, float AO01)
{
	const int32 BaseIndex = OutMesh.Positions.Num();

	// Tangent basis: for axis-aligned quads the tangent is always AxisU and the
	// bitangent AxisV, with a sign that depends on the normal direction so the
	// material's normal map is not mirrored on half the city.
	const float BitangentSign = (Normal.Z < 0.0f || Normal.Y < 0.0f) ? -1.0f : 1.0f;
	const FVector4f Tangent(AxisU, BitangentSign);

	const FVector3f P0 = Origin;
	const FVector3f P1 = Origin + AxisU * SizeU;
	const FVector3f P2 = Origin + AxisU * SizeU + AxisV * SizeV;
	const FVector3f P3 = Origin + AxisV * SizeV;

	OutMesh.Positions.Add(P0);
	OutMesh.Positions.Add(P1);
	OutMesh.Positions.Add(P2);
	OutMesh.Positions.Add(P3);

	for (int32 i = 0; i < 4; ++i)
	{
		OutMesh.Normals.Add(Normal);
		OutMesh.Tangents.Add(Tangent);
	}

	// Per-vertex AO baked into the alpha-free colour channel; the material
	// multiplies it, which is what makes voxel corners read as solid geometry.
	const float AO[4] = { AO00, AO10, AO11, AO01 };
	for (int32 i = 0; i < 4; ++i)
	{
		const float Factor = AO[i];
		OutMesh.Colors.Add(FColor(
			uint8(FMath::Clamp(Color.R * Factor, 0.f, 255.f)),
			uint8(FMath::Clamp(Color.G * Factor, 0.f, 255.f)),
			uint8(FMath::Clamp(Color.B * Factor, 0.f, 255.f)),
			Color.A));
	}

	// UV0 tiles the surface texture at 1 tile per metre regardless of merge
	// size, so a merged 12-voxel wall does not get one stretched texture.
	const float TilesPerMetre = 1.0f;
	OutMesh.UV0.Add(FVector2f(0.0f, 0.0f));
	OutMesh.UV0.Add(FVector2f(SizeU * TilesPerMetre / 100.0f, 0.0f));
	OutMesh.UV0.Add(FVector2f(SizeU * TilesPerMetre / 100.0f, SizeV * TilesPerMetre / 100.0f));
	OutMesh.UV0.Add(FVector2f(0.0f, SizeV * TilesPerMetre / 100.0f));

	// UV1 carries the material index and flags so a single layered material can
	// branch per voxel without a texture lookup.
	for (int32 i = 0; i < 4; ++i)
	{
		OutMesh.UV1.Add(FVector2f(MaterialIndex, FlagsPacked));
	}

	// Flip the winding when the quad faces backwards so both sides are CCW.
	if (BitangentSign < 0.0f)
	{
		OutMesh.Indices.Add(BaseIndex + 0);
		OutMesh.Indices.Add(BaseIndex + 2);
		OutMesh.Indices.Add(BaseIndex + 1);
		OutMesh.Indices.Add(BaseIndex + 0);
		OutMesh.Indices.Add(BaseIndex + 3);
		OutMesh.Indices.Add(BaseIndex + 2);
	}
	else
	{
		OutMesh.Indices.Add(BaseIndex + 0);
		OutMesh.Indices.Add(BaseIndex + 1);
		OutMesh.Indices.Add(BaseIndex + 2);
		OutMesh.Indices.Add(BaseIndex + 0);
		OutMesh.Indices.Add(BaseIndex + 2);
		OutMesh.Indices.Add(BaseIndex + 3);
	}

	OutMesh.QuadCount++;

	for (const FVector3f& P : { P0, P1, P2, P3 })
	{
		OutMesh.Bounds += FVector(P);
	}
}

//═══════════════════════════════════════════════════════════════════════════════
// Greedy merge
//═══════════════════════════════════════════════════════════════════════════════

void FBCUVoxelMesher::MergeAlongAxis(
	const FBCUVoxelChunk& Chunk,
	int32 AxisIndex,
	const UBCUVoxelMaterialSet* MaterialSet,
	const FBCUMeshOptions& Options,
	TMap<EBCUMeshSection, FBCUVoxelMeshData>& OutSections)
{
	const FIntVector Dims = Chunk.Dimensions;
	const int32 DimsArray[3] = { Dims.X, Dims.Y, Dims.Z };

	const int32 AxisU = (AxisIndex + 1) % 3;
	const int32 AxisV = (AxisIndex + 2) % 3;

	const int32 CountAxis = DimsArray[AxisIndex];
	const int32 CountU = DimsArray[AxisU];
	const int32 CountV = DimsArray[AxisV];

	TArray<FFaceMaskEntry> Mask;
	Mask.SetNumUninitialized(CountU * CountV);

	const float Scale = Options.VoxelScaleCm;

	// Iterate one slice at a time along the axis. Each slice produces at most
	// CountU*CountV faces in each direction, which the greedy pass collapses.
	for (int32 Slice = 0; Slice <= CountAxis; ++Slice)
	{
		// ── 1. Build the mask for this slice ────────────────────────────────
		int32 MaskIndex = 0;
		for (int32 V = 0; V < CountV; ++V)
		{
			for (int32 U = 0; U < CountU; ++U, ++MaskIndex)
			{
				int32 Pos[3];
				Pos[AxisIndex] = Slice;
				Pos[AxisU] = U;
				Pos[AxisV] = V;

				const FBCUVoxel& Current = Chunk.At(Pos[0], Pos[1], Pos[2]);

				int32 BackPos[3] = { Pos[0], Pos[1], Pos[2] };
				BackPos[AxisIndex] = Slice - 1;
				const FBCUVoxel& Back = (Slice > 0) ? Chunk.At(BackPos[0], BackPos[1], BackPos[2]) : FBCUVoxel();

				FFaceMaskEntry& Entry = Mask[MaskIndex];
				Entry = FFaceMaskEntry();

				if (Options.bExcludeInteriors && Current.IsInteriorOnly() && Back.IsInteriorOnly())
				{
					continue;
				}

				const bool bCurrentSolid = !Current.IsEmpty();
				const bool bBackSolid = !Back.IsEmpty();

				if (bCurrentSolid && !BlocksFace(Current, Back))
				{
					// Face of Current pointing towards -Axis.
					const FBCUVoxel& Source = Current;
					Entry.Material = Source.Material;
					Entry.Palette = Source.PaletteIndex;
					Entry.Flags = Source.Flags;
					Entry.Shade = Source.Shade;
					Entry.Orientation = -1;
				}
				else if (bBackSolid && !BlocksFace(Back, Current))
				{
					// Face of Back pointing towards +Axis.
					const FBCUVoxel& Source = Back;
					Entry.Material = Source.Material;
					Entry.Palette = Source.PaletteIndex;
					Entry.Flags = Source.Flags;
					Entry.Shade = Source.Shade;
					Entry.Orientation = +1;
				}
			}
		}

		// ── 2. Greedy merge the mask into rectangles ────────────────────────
		MaskIndex = 0;
		for (int32 V = 0; V < CountV; ++V)
		{
			for (int32 U = 0; U < CountU; )
			{
				const FFaceMaskEntry& Seed = Mask[MaskIndex];
				if (Seed.IsEmpty())
				{
					U++;
					MaskIndex++;
					continue;
				}

				// Extend along U while the mask entries are identical.
				int32 Width = 1;
				while (U + Width < CountU && Mask[MaskIndex + Width] == Seed)
				{
					Width++;
				}

				// Extend along V.
				int32 Height = 1;
				bool bDone = false;
				while (!bDone && V + Height < CountV)
				{
					for (int32 K = 0; K < Width; ++K)
					{
						const int32 TestIndex = MaskIndex + Height * CountU + K;
						if (!(Mask[TestIndex] == Seed))
						{
							bDone = true;
							break;
						}
					}
					if (!bDone)
					{
						Height++;
					}
				}

				// ── 3. Emit the merged quad ────────────────────────────────
				FBCUVoxel Face;
				Face.Material = Seed.Material;
				Face.PaletteIndex = Seed.Palette;
				Face.Flags = Seed.Flags;
				Face.Shade = Seed.Shade;

				const EBCUMeshSection Section = ClassifyVoxel(Face);
				FBCUVoxelMeshData& Mesh = OutSections.FindOrAdd(Section);

				// World-space quad basis. Axes are the plain unit vectors so a
				// voxel at (X,Y,Z) maps unambiguously to cm in world space.
				const FVector AxisDir[3] = { FVector(1, 0, 0), FVector(0, 1, 0), FVector(0, 0, 1) };
				const FVector3f NormalDir(AxisDir[AxisIndex] * float(Seed.Orientation));

				int32 WorldPos[3];
				WorldPos[AxisIndex] = Slice;
				WorldPos[AxisU] = U;
				WorldPos[AxisV] = V;

				const FVector3f Origin(
					(Chunk.Origin.X + WorldPos[0]) * Scale,
					(Chunk.Origin.Y + WorldPos[1]) * Scale,
					(Chunk.Origin.Z + WorldPos[2]) * Scale);

				const FVector3f DirU(AxisDir[AxisU]);
				const FVector3f DirV(AxisDir[AxisV]);
				const float SizeU = Width * Scale;
				const float SizeV = Height * Scale;

				// Colour = material base × palette tint × baked shade.
				FLinearColor Linear = FLinearColor::White;
				float MaterialIndex = float(Face.Material);
				if (MaterialSet)
				{
					Linear = MaterialSet->ResolveColor(Face);
				}

				const FColor Packed = Linear.ToFColor(/*bSRGB=*/false);
				const float FlagsPacked = float(Face.Flags);

				const float AO = float(Face.Shade) / 255.0f;
				EmitQuad(Mesh, Origin, DirU, DirV, SizeU, SizeV, NormalDir, Packed,
					MaterialIndex, FlagsPacked, FVector2f(1.0f, 1.0f), AO, AO, AO, AO);

				// Quads saved: naive would emit Width*Height.
				const int32 NaiveQuads = Width * Height;
				if (NaiveQuads > 1)
				{
					Mesh.QuadsSaved += NaiveQuads - 1;
				}

				// Clear the merged region from the mask.
				for (int32 DV = 0; DV < Height; ++DV)
				{
					for (int32 DU = 0; DU < Width; ++DU)
					{
						Mask[MaskIndex + DV * CountU + DU] = FFaceMaskEntry();
					}
				}

				U += Width;
				MaskIndex += Width;
			}
		}
	}
}

//═══════════════════════════════════════════════════════════════════════════════
// Public entry points
//═══════════════════════════════════════════════════════════════════════════════

void FBCUVoxelMesher::BuildChunkMesh(
	const FBCUVoxelChunk& Chunk,
	const UBCUVoxelMaterialSet* MaterialSet,
	const FBCUMeshOptions& Options,
	TMap<EBCUMeshSection, FBCUVoxelMeshData>& OutSections)
{
	const double StartTime = FPlatformTime::Seconds();

	OutSections.Reset();
	for (int32 Axis = 0; Axis < 3; ++Axis)
	{
		MergeAlongAxis(Chunk, Axis, MaterialSet, Options, OutSections);
	}

	int32 TotalSaved = 0;
	for (const TPair<EBCUMeshSection, FBCUVoxelMeshData>& Pair : OutSections)
	{
		TotalSaved += Pair.Value.QuadsSaved;
	}

	LastBuildTimeMs = (FPlatformTime::Seconds() - StartTime) * 1000.0;
	LastQuadsSaved = TotalSaved;
}

void FBCUVoxelMesher::BuildGridMesh(
	const UBCUVoxelGrid* Grid,
	const FBCUMeshOptions& Options,
	TMap<EBCUMeshSection, FBCUVoxelMeshData>& OutSections)
{
	if (!Grid)
	{
		return;
	}

	OutSections.Reset();

	TArray<FIntVector> Dirty; // unused here: the editor preview always rebuilds
	Grid->GetDirtyChunks(Dirty);

	FBCUMeshOptions ChunkOptions = Options;
	ChunkOptions.VoxelScaleCm = Grid->GetVoxelScaleCm();

	// Iterate every chunk (not just dirty ones) — BuildGridMesh is the
	// whole-of-cell path used by the HLOD bake and the editor preview.
	for (int32 Z = 0; Z < Grid->GetChunkCount().Z; ++Z)
	{
		for (int32 Y = 0; Y < Grid->GetChunkCount().Y; ++Y)
		{
			for (int32 X = 0; X < Grid->GetChunkCount().X; ++X)
			{
				if (const FBCUVoxelChunk* Chunk = Grid->GetChunk(FIntVector(X, Y, Z)))
				{
					TMap<EBCUMeshSection, FBCUVoxelMeshData> Local;
					BuildChunkMesh(*Chunk, Grid->MaterialSet, ChunkOptions, Local);

					for (TPair<EBCUMeshSection, FBCUVoxelMeshData>& Pair : Local)
					{
						FBCUVoxelMeshData& Dest = OutSections.FindOrAdd(Pair.Key);
						const int32 Base = Dest.Positions.Num();

						Dest.Positions.Append(Pair.Value.Positions);
						Dest.Normals.Append(Pair.Value.Normals);
						Dest.Tangents.Append(Pair.Value.Tangents);
						Dest.Colors.Append(Pair.Value.Colors);
						Dest.UV0.Append(Pair.Value.UV0);
						Dest.UV1.Append(Pair.Value.UV1);

						for (int32 Index : Pair.Value.Indices)
						{
							Dest.Indices.Add(Base + Index);
						}

						Dest.Bounds += Pair.Value.Bounds;
						Dest.QuadCount += Pair.Value.QuadCount;
						Dest.QuadsSaved += Pair.Value.QuadsSaved;
					}
				}
			}
		}
	}
}

UStaticMesh* FBCUVoxelMesher::CreateStaticMesh(
	UObject* Outer,
	FName MeshName,
	const TMap<EBCUMeshSection, FBCUVoxelMeshData>& Sections,
	UBCUVoxelMaterialSet* MaterialSet,
	bool bEnableNanite)
{
	check(IsInGameThread());

	if (Sections.Num() == 0)
	{
		return nullptr;
	}

	UStaticMesh* Mesh = NewObject<UStaticMesh>(Outer ? Outer : GetTransientPackage(), MeshName,
		RF_Public | RF_Standalone | RF_Transient);
	if (!Mesh)
	{
		return nullptr;
	}

	Mesh->AddSourceModel();
	FStaticMeshSourceModel& SourceModel = Mesh->GetSourceModel(0);
	SourceModel.BuildSettings.bRecomputeNormals = false;   // we emit exact ones
	SourceModel.BuildSettings.bRecomputeTangents = false;
	SourceModel.BuildSettings.bUseMikkTSpace = true;
	SourceModel.BuildSettings.bUseFullPrecisionUVs = true;
	SourceModel.BuildSettings.bGenerateLightmapUVs = false; // Lumen, not baked lightmaps
	SourceModel.BuildSettings.bUseHighPrecisionTangentBasis = true;

	// Nanite: enabled for the opaque section. Masked/translucent sections fall
	// back to the traditional renderer — see Docs/05_RENDERING_AND_NANITE.md.
	Mesh->SetNaniteSettings(FMeshNaniteSettings());
	{
		FMeshNaniteSettings NaniteSettings = Mesh->GetNaniteSettings();
		NaniteSettings.bEnabled = bEnableNanite;
		NaniteSettings.bKeepPercentOfTriangles = 100.0f;
		NaniteSettings.PositionPrecision = EStaticMeshPositionPrecision::Auto;
		Mesh->SetNaniteSettings(NaniteSettings);
	}

	int32 SectionIndex = 0;

	for (const TPair<EBCUMeshSection, FBCUVoxelMeshData>& Pair : Sections)
	{
		const FBCUVoxelMeshData& Data = Pair.Value;
		if (Data.Positions.Num() == 0)
		{
			continue;
		}

		FMeshDescription* SectionDescription = new FMeshDescription();
		FStaticMeshAttributes SectionAttributes(*SectionDescription);
		SectionAttributes.Register();

		TVertexAttributesRef<FVector3f> VertexPositions = SectionAttributes.GetVertexPositions();
		TVertexAttributesRef<FVector3f> VertexNormals = SectionAttributes.GetVertexNormals();
		TVertexAttributesRef<FVector4f> VertexTangents = SectionAttributes.GetVertexTangents();
		TVertexAttributesRef<FColor> VertexColors = SectionAttributes.GetVertexColors();
		TVertexAttributesRef<FVector2f> UV0 = SectionAttributes.GetSourceUVs(0);
		TVertexAttributesRef<FVector2f> UV1 = SectionAttributes.GetSourceUVs(1);

		const int32 VertexCount = Data.Positions.Num();
		TArray<FVertexID> VertexIDs;
		VertexIDs.Reserve(VertexCount);

		for (int32 i = 0; i < VertexCount; ++i)
		{
			const FVertexID NewVertex = SectionDescription->CreateVertex();
			VertexPositions[NewVertex] = Data.Positions[i];
			VertexNormals[NewVertex] = Data.Normals[i];
			VertexTangents[NewVertex] = Data.Tangents[i];
			VertexColors[NewVertex] = Data.Colors[i];
			UV0[NewVertex] = Data.UV0[i];
			UV1[NewVertex] = Data.UV1[i];
			VertexIDs.Add(NewVertex);
		}

		SectionDescription->CreatePolygonGroup(UMaterialInterface::GetDefaultMaterial(MD_Surface));

		const int32 TriangleCount = Data.Indices.Num() / 3;
		for (int32 t = 0; t < TriangleCount; ++t)
		{
			TArray<FVertexID> TriangleVertices;
			TriangleVertices.Add(VertexIDs[Data.Indices[t * 3 + 0]]);
			TriangleVertices.Add(VertexIDs[Data.Indices[t * 3 + 1]]);
			TriangleVertices.Add(VertexIDs[Data.Indices[t * 3 + 2]]);
			SectionDescription->AddTriangle(TriangleVertices, TArray<FMeshTriangleID>(), 0);
		}

		Mesh->SetMeshDescription(SectionIndex++, SectionDescription);
	}

	Mesh->SetNumSourceModels(SectionIndex);
	Mesh->CreateRenderState();
	Mesh->PostEditChange();

	UE_LOG(LogBCUMesher, Verbose, TEXT("Built %s: %d sections, nanite=%d"),
		*MeshName.ToString(), SectionIndex, bEnableNanite ? 1 : 0);

	return Mesh;
}

void FBCUVoxelMesher::BuildHLODMesh(
	const UBCUVoxelGrid* Grid,
	int32 MergeFactor,
	const UBCUVoxelMaterialSet* MaterialSet,
	FBCUVoxelMeshData& OutMesh)
{
	if (!Grid)
	{
		return;
	}

	OutMesh.Reset();

	// Downsample by MergeFactor and mesh the result: a 4×4×4 downsample of a
	// dense downtown cell gives a recognisable silhouette at ~1/64 the cost,
	// which is exactly what a World Partition HLOD layer wants.
	const int32 Factor = FMath::Clamp(MergeFactor, 1, 16);
	const float Scale = Grid->GetVoxelScaleCm() * Factor;

	const FIntVector ChunkCount = Grid->GetChunkCount();
	const FIntVector ChunkDims = Grid->GetChunkDimensions();

	for (int32 CZ = 0; CZ < ChunkCount.Z; ++CZ)
	{
		for (int32 CY = 0; CY < ChunkCount.Y; ++CY)
		{
			for (int32 CX = 0; CX < ChunkCount.X; ++CX)
			{
				const FBCUVoxelChunk* Chunk = Grid->GetChunk(FIntVector(CX, CY, CZ));
				if (!Chunk)
				{
					continue;
				}

				// Bucket the chunk into Factor³ cells; a bucket is solid if any
				// of its voxels are solid (conservative — never punches holes).
				const int32 BX = FMath::CeilToInt(float(ChunkDims.X) / Factor);
				const int32 BY = FMath::CeilToInt(float(ChunkDims.Y) / Factor);
				const int32 BZ = FMath::CeilToInt(float(ChunkDims.Z) / Factor);

				TArray<FBCUVoxel> Buckets;
				Buckets.SetNumZeroed(BX * BY * BZ);

				for (int32 Z = 0; Z < ChunkDims.Z; ++Z)
				{
					for (int32 Y = 0; Y < ChunkDims.Y; ++Y)
					{
						for (int32 X = 0; X < ChunkDims.X; ++X)
						{
							const FBCUVoxel& Voxel = Chunk->At(X, Y, Z);
							if (Voxel.IsEmpty())
							{
								continue;
							}

							const int32 Index = (X / Factor) + BX * ((Y / Factor) + BY * (Z / Factor));
							FBCUVoxel& Bucket = Buckets[Index];
							if (Bucket.IsEmpty())
							{
								Bucket = Voxel;
							}
							else if (Voxel.IsEmissive())
							{
								// Lit windows must survive the downsample or a
								// night-time HLOD city looks dead.
								Bucket = Voxel;
							}
						}
					}
				}

				// Emit the bucketed chunk as coarse quads.
				FBCUVoxelChunk Coarse;
				Coarse.Allocate(FIntVector(BX, BY, BZ), Chunk->Origin / Factor);
				Coarse.Voxels = MoveTemp(Buckets);

				FBCUMeshOptions Options;
				Options.bGreedyMerge = true;
				Options.bVertexAO = false;
				Options.VoxelScaleCm = Scale;
				Options.bExcludeInteriors = true;

				TMap<EBCUMeshSection, FBCUVoxelMeshData> Local;
				BuildChunkMesh(Coarse, MaterialSet, Options, Local);

				for (TPair<EBCUMeshSection, FBCUVoxelMeshData>& Pair : Local)
				{
					const int32 Base = OutMesh.Positions.Num();
					OutMesh.Positions.Append(Pair.Value.Positions);
					OutMesh.Normals.Append(Pair.Value.Normals);
					OutMesh.Tangents.Append(Pair.Value.Tangents);
					OutMesh.Colors.Append(Pair.Value.Colors);
					OutMesh.UV0.Append(Pair.Value.UV0);
					OutMesh.UV1.Append(Pair.Value.UV1);

					for (int32 Index : Pair.Value.Indices)
					{
						OutMesh.Indices.Add(Base + Index);
					}

					OutMesh.Bounds += Pair.Value.Bounds;
					OutMesh.QuadCount += Pair.Value.QuadCount;
				}
			}
		}
	}
}

float FBCUVoxelMesher::ComputeVertexAO(
	const UBCUVoxelGrid* Grid,
	const FIntVector& VoxelPosition,
	int32 AxisIndex,
	int32 Sign,
	int32 CornerU,
	int32 CornerV)
{
	if (!Grid)
	{
		return 1.0f;
	}

	const int32 AxisU = (AxisIndex + 1) % 3;
	const int32 AxisV = (AxisIndex + 2) % 3;

	int32 Offset[3] = { 0, 0, 0 };
	Offset[AxisIndex] = Sign;
	const FIntVector FaceVoxel = VoxelPosition + FIntVector(Offset[0], Offset[1], Offset[2]);

	int32 DirU[3] = { 0, 0, 0 };
	DirU[AxisU] = CornerU;
	int32 DirV[3] = { 0, 0, 0 };
	DirV[AxisV] = CornerV;

	const FIntVector Side1 = FaceVoxel + FIntVector(DirU[0], DirU[1], DirU[2]);
	const FIntVector Side2 = FaceVoxel + FIntVector(DirV[0], DirV[1], DirV[2]);
	const FIntVector Corner = FaceVoxel + FIntVector(DirU[0] + DirV[0], DirU[1] + DirV[1], DirU[2] + DirV[2]);

	const bool bSide1 = !Grid->IsEmpty(Side1);
	const bool bSide2 = !Grid->IsEmpty(Side2);
	const bool bCorner = !Grid->IsEmpty(Corner);

	// Classic 3-tap AO: if both sides are solid the corner is fully occluded.
	int32 Occlusion;
	if (bSide1 && bSide2)
	{
		Occlusion = 3;
	}
	else
	{
		Occlusion = (bSide1 ? 1 : 0) + (bSide2 ? 1 : 0) + (bCorner ? 1 : 0);
	}

	static const float AOTable[4] = { 1.00f, 0.82f, 0.66f, 0.52f };
	return AOTable[FMath::Clamp(Occlusion, 0, 3)];
}
