// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "BCUVoxelTypes.generated.h"

/**
 * Voxel materials. 6 bits are stored per voxel, so the ceiling is 64.
 *
 * Each entry maps to a physically based material layer in
 * M_VoxelSurface (see Docs/04_ART_DIRECTION.md §3): base colour, roughness,
 * metallic, normal detail, weathering mask and wetness response. The voxel
 * *aesthetic* therefore comes from real cubic geometry, while the *rendering*
 * stays fully PBR — which is the whole point of the art direction.
 */
UENUM(BlueprintType, meta = (Bitflags, UseEnumValuesAsMaskValuesInEditor = "true"))
enum class EBCUVoxelMaterial : uint8
{
	None				= 0			UMETA(DisplayName = "None"),

	// ── Structural ───────────────────────────────────────────────────────
	Concrete			= 1			UMETA(DisplayName = "Concrete"),
	ConcreteDirty		= 2			UMETA(DisplayName = "Stained Concrete"),
	BrickRed			= 3			UMETA(DisplayName = "Red Brick"),
	BrickBrown			= 4			UMETA(DisplayName = "Brown Brick"),
	Sandstone			= 5			UMETA(DisplayName = "Sandstone"),
	Stone				= 6			UMETA(DisplayName = "Stone"),
	Granite				= 7			UMETA(DisplayName = "Granite"),
	Marble				= 8			UMETA(DisplayName = "Marble"),

	// ── Metals ───────────────────────────────────────────────────────────
	Steel				= 9			UMETA(DisplayName = "Steel"),
	SteelRusted			= 10		UMETA(DisplayName = "Rusted Steel"),
	Aluminium			= 11		UMETA(DisplayName = "Aluminium"),
	Chrome				= 12		UMETA(DisplayName = "Chrome"),
	Copper				= 13		UMETA(DisplayName = "Copper"),
	Corrugated			= 14		UMETA(DisplayName = "Corrugated Iron"),

	// ── Glass / emissive ─────────────────────────────────────────────────
	GlassClear			= 15		UMETA(DisplayName = "Clear Glass"),
	GlassTinted			= 16		UMETA(DisplayName = "Tinted Glass"),
	GlassReflective		= 17		UMETA(DisplayName = "Curtain-Wall Glass"),
	WindowLit			= 18		UMETA(DisplayName = "Lit Window"),
	WindowLitWarm		= 19		UMETA(DisplayName = "Lit Window (Warm)"),
	WindowLitCool		= 20		UMETA(DisplayName = "Lit Window (Cool)"),
	NeonPink			= 21		UMETA(DisplayName = "Neon Pink"),
	NeonCyan			= 22		UMETA(DisplayName = "Neon Cyan"),
	NeonAmber			= 23		UMETA(DisplayName = "Neon Amber"),
	NeonWhite			= 24		UMETA(DisplayName = "Neon White"),
	LightFixture		= 25		UMETA(DisplayName = "Light Fixture"),

	// ── Ground / road ────────────────────────────────────────────────────
	Asphalt				= 26		UMETA(DisplayName = "Asphalt"),
	AsphaltWorn			= 27		UMETA(DisplayName = "Worn Asphalt"),
	ConcretePaving		= 28		UMETA(DisplayName = "Paving Slab"),
	TactilePaving		= 29		UMETA(DisplayName = "Tactile Paving"),
	RoadLineWhite		= 30		UMETA(DisplayName = "White Road Line"),
	RoadLineYellow		= 31		UMETA(DisplayName = "Yellow Road Line"),
	Crosswalk			= 32		UMETA(DisplayName = "Crosswalk"),
	ManholeCover		= 33		UMETA(DisplayName = "Manhole"),
	KerbStone			= 34		UMETA(DisplayName = "Kerb"),
	Gravel				= 35		UMETA(DisplayName = "Gravel"),
	RailTrack			= 36		UMETA(DisplayName = "Rail"),
	RubberMat			= 37		UMETA(DisplayName = "Rubber Matting"),

	// ── Nature ───────────────────────────────────────────────────────────
	Grass				= 38		UMETA(DisplayName = "Grass"),
	GrassDry			= 39		UMETA(DisplayName = "Dry Grass"),
	Dirt				= 40		UMETA(DisplayName = "Dirt"),
	Mud					= 41		UMETA(DisplayName = "Mud"),
	Sand				= 42		UMETA(DisplayName = "Sand"),
	Rock				= 43		UMETA(DisplayName = "Rock"),
	Snow				= 44		UMETA(DisplayName = "Snow"),
	Ice					= 45		UMETA(DisplayName = "Ice"),
	Water				= 46		UMETA(DisplayName = "Water"),
	TreeTrunk			= 47		UMETA(DisplayName = "Tree Trunk"),
	LeavesGreen			= 48		UMETA(DisplayName = "Leaves"),
	LeavesAutumn		= 49		UMETA(DisplayName = "Autumn Leaves"),
	LeavesPine			= 50		UMETA(DisplayName = "Pine Needles"),
	Flowers				= 51		UMETA(DisplayName = "Flower Bed"),

	// ── Interior / props ─────────────────────────────────────────────────
	PlasterWhite		= 52		UMETA(DisplayName = "Plaster"),
	WoodOak				= 53		UMETA(DisplayName = "Oak"),
	WoodDark			= 54		UMETA(DisplayName = "Dark Wood"),
	Tile				= 55		UMETA(DisplayName = "Ceramic Tile"),
	Carpet				= 56		UMETA(DisplayName = "Carpet"),
	Fabric				= 57		UMETA(DisplayName = "Fabric"),
	PaintedRed			= 58		UMETA(DisplayName = "Painted Red"),
	PaintedBlue			= 59		UMETA(DisplayName = "Painted Blue"),
	PaintedYellow		= 60		UMETA(DisplayName = "Painted Yellow"),
	PaintedGreen		= 61		UMETA(DisplayName = "Painted Green"),
	PaintedGrey			= 62		UMETA(DisplayName = "Painted Grey"),
	PaintedWhite		= 63		UMETA(DisplayName = "Painted White")
};

/** 4 bytes per voxel. 2M voxels per chunk budget = 8 MB of raw data. */
USTRUCT(BlueprintType)
struct FBCUVoxel
{
	GENERATED_BODY()

	/** Material index — see EBCUVoxelMaterial. */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|Voxel")
	uint8 Material = 0;

	/** Per-voxel tint index into the palette (0 = use the material colour). */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|Voxel")
	uint8 PaletteIndex = 0;

	/**
	 * Bit 0 = emissive (windows, neon)
	 * Bit 1 = translucent (glass, water, ice)
	 * Bit 2 = masked  (leaves, grating — excluded from Nanite, see Docs/05)
	 * Bit 3 = destructible (pops off on impact instead of cracking)
	 * Bit 4 = climbable (ladders, fire escapes)
	 * Bit 5 = interior-only (culled from the exterior HLOD)
	 * Bit 6 = wetness-reactive (puddles form here first)
	 * Bit 7 = reserved
	 */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|Voxel")
	uint8 Flags = 0;

	/** Ambient-occlusion / baked-darkness hint, 0..255 (255 = fully lit). */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|Voxel")
	uint8 Shade = 255;

	static const uint8 FLAG_Emissive		= 1 << 0;
	static const uint8 FLAG_Translucent		= 1 << 1;
	static const uint8 FLAG_Masked			= 1 << 2;
	static const uint8 FLAG_Destructible	= 1 << 3;
	static const uint8 FLAG_Climbable		= 1 << 4;
	static const uint8 FLAG_InteriorOnly	= 1 << 5;
	static const uint8 FLAG_Wetness			= 1 << 6;

	FORCEINLINE bool IsEmpty() const { return Material == 0; }
	FORCEINLINE bool IsEmissive() const { return (Flags & FLAG_Emissive) != 0; }
	FORCEINLINE bool IsTranslucent() const { return (Flags & FLAG_Translucent) != 0; }
	FORCEINLINE bool IsMasked() const { return (Flags & FLAG_Masked) != 0; }
	FORCEINLINE bool IsDestructible() const { return (Flags & FLAG_Destructible) != 0; }
	FORCEINLINE bool IsClimbable() const { return (Flags & FLAG_Climbable) != 0; }
	FORCEINLINE bool IsInteriorOnly() const { return (Flags & FLAG_InteriorOnly) != 0; }

	FORCEINLINE bool operator==(const FBCUVoxel& Other) const
	{
		return Material == Other.Material && PaletteIndex == Other.PaletteIndex
			&& Flags == Other.Flags && Shade == Other.Shade;
	}
};

/** Material trait lookup — used by the mesher and the wetness system. */
USTRUCT(BlueprintType)
struct FBCUVoxelMaterialTraits
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Voxel")
	EBCUVoxelMaterial Material = EBCUVoxelMaterial::None;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Voxel")
	FLinearColor BaseColor = FLinearColor::White;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Voxel", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float Roughness = 0.7f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Voxel", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float Metallic = 0.0f;

	/** Emissive luminance in nits; 0 for non-emissive materials. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Voxel", meta = (ClampMin = "0.0"))
	float EmissiveIntensity = 0.0f;

	/** How strongly rain darkens this material and forms puddles. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Voxel", meta = (ClampMin = "0.0", ClampMax = "2.0"))
	float WetnessResponse = 1.0f;

	/** True when the material must be excluded from Nanite (masked/translucent). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Voxel")
	bool bNaniteCompatible = true;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Voxel")
	bool bCastsShadow = true;
};

/** A palette lets one voxel material index express many colours cheaply. */
USTRUCT(BlueprintType)
struct FBCUVoxelPalette
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Voxel")
	FName PaletteName = TEXT("Default");

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Voxel")
	TArray<FLinearColor> Colors;

	/** Returns Colors[Index] or a deterministic hash-based grey. */
	FLinearColor Get(int32 Index) const
	{
		if (Colors.IsValidIndex(Index))
		{
			return Colors[Index];
		}

		const float Hash = FMath::Fractional(float(Index) * 0.6180339887f);
		return FLinearColor(0.45f + 0.35f * Hash, 0.45f + 0.3f * (1.0f - Hash), 0.45f + 0.2f * Hash, 1.0f);
	}
};

/** Per-voxel data asset: material traits + palettes, shared by the whole city. */
UCLASS(BlueprintType, meta = (DisplayName = "BCU Voxel Material Set"))
class BLOCKCITYULTRA_API UBCUVoxelMaterialSet : public UDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Voxel")
	TArray<FBCUVoxelMaterialTraits> Traits;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Voxel")
	TArray<FBCUVoxelPalette> Palettes;

	/** The master layered material applied to every generated voxel mesh. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Voxel")
	TSoftObjectPtr<class UMaterialInterface> VoxelSurfaceMaterial;

	/** Separate material for masked/translucent voxels (Nanite-incompatible). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Voxel")
	TSoftObjectPtr<class UMaterialInterface> VoxelMaskedMaterial;

	/** Emissive pass for windows and neon. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Voxel")
	TSoftObjectPtr<class UMaterialInterface> VoxelEmissiveMaterial;

	const FBCUVoxelMaterialTraits* FindTraits(EBCUVoxelMaterial Material) const;
	FLinearColor ResolveColor(const FBCUVoxel& Voxel) const;
	bool IsNaniteCompatible(EBCUVoxelMaterial Material) const;

	/** Builds the default 63-entry trait table if the designer left it empty. */
	void EnsureDefaults();
};

/** Integer cell coordinates in the city grid (used by the streamer). */
USTRUCT(BlueprintType)
struct FBCUCellCoord
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	int32 X = 0;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City")
	int32 Y = 0;

	FBCUCellCoord() = default;
	FBCUCellCoord(int32 InX, int32 InY) : X(InX), Y(InY) {}

	friend FORCEINLINE uint32 GetTypeHash(const FBCUCellCoord& Coord)
	{
		return HashCombine(::GetTypeHash(Coord.X), ::GetTypeHash(Coord.Y));
	}

	friend bool operator==(const FBCUCellCoord& A, const FBCUCellCoord& B)
	{
		return A.X == B.X && A.Y == B.Y;
	}

	friend bool operator!=(const FBCUCellCoord& A, const FBCUCellCoord& B)
	{
		return !(A == B);
	}

	FString ToString() const { return FString::Printf(TEXT("(%d,%d)"), X, Y); }
};

/** Deterministic, serialisable city seed. Same seed → same city, everywhere. */
USTRUCT(BlueprintType)
struct FBCUCitySeed
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|City")
	int32 Seed = 20260710;

	/** Layout density 0..1 — suburbs vs. downtown block size. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|City", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float Density = 0.62f;

	/** Verticality 0..1 — how tall the skyline is allowed to get. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|City", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float Verticality = 0.7f;

	/** 0..1 — how much nature intrudes on the grid (parks, river, forest). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|City", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float Nature = 0.35f;

	FString ToString() const
	{
		return FString::Printf(TEXT("seed=%d density=%.2f verticality=%.2f nature=%.2f"),
			Seed, Density, Verticality, Nature);
	}
};
