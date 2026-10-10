// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "World/Voxel/BCUVoxelTypes.h"

namespace BCUVoxelDefaults
{
	struct FEntry
	{
		EBCUVoxelMaterial Material;
		FLinearColor Color;
		float Roughness;
		float Metallic;
		float Emissive;
		float Wetness;
		bool bNanite;
	};

	static const FEntry Table[] =
	{
		// Structural
		{ EBCUVoxelMaterial::Concrete,			FLinearColor(0.62f, 0.61f, 0.58f), 0.86f, 0.00f, 0.0f, 1.10f, true  },
		{ EBCUVoxelMaterial::ConcreteDirty,		FLinearColor(0.47f, 0.45f, 0.41f), 0.92f, 0.00f, 0.0f, 1.20f, true  },
		{ EBCUVoxelMaterial::BrickRed,			FLinearColor(0.46f, 0.21f, 0.17f), 0.82f, 0.00f, 0.0f, 1.00f, true  },
		{ EBCUVoxelMaterial::BrickBrown,		FLinearColor(0.38f, 0.27f, 0.20f), 0.84f, 0.00f, 0.0f, 1.00f, true  },
		{ EBCUVoxelMaterial::Sandstone,			FLinearColor(0.76f, 0.67f, 0.51f), 0.80f, 0.00f, 0.0f, 0.90f, true  },
		{ EBCUVoxelMaterial::Stone,				FLinearColor(0.50f, 0.50f, 0.51f), 0.85f, 0.00f, 0.0f, 1.00f, true  },
		{ EBCUVoxelMaterial::Granite,			FLinearColor(0.34f, 0.34f, 0.36f), 0.55f, 0.02f, 0.0f, 0.70f, true  },
		{ EBCUVoxelMaterial::Marble,			FLinearColor(0.88f, 0.87f, 0.84f), 0.22f, 0.00f, 0.0f, 0.40f, true  },

		// Metals
		{ EBCUVoxelMaterial::Steel,				FLinearColor(0.44f, 0.46f, 0.48f), 0.38f, 0.92f, 0.0f, 0.60f, true  },
		{ EBCUVoxelMaterial::SteelRusted,		FLinearColor(0.36f, 0.22f, 0.14f), 0.78f, 0.62f, 0.0f, 1.10f, true  },
		{ EBCUVoxelMaterial::Aluminium,			FLinearColor(0.72f, 0.73f, 0.74f), 0.30f, 0.95f, 0.0f, 0.50f, true  },
		{ EBCUVoxelMaterial::Chrome,			FLinearColor(0.90f, 0.91f, 0.92f), 0.08f, 1.00f, 0.0f, 0.30f, true  },
		{ EBCUVoxelMaterial::Copper,			FLinearColor(0.63f, 0.36f, 0.22f), 0.34f, 0.95f, 0.0f, 0.70f, true  },
		{ EBCUVoxelMaterial::Corrugated,		FLinearColor(0.52f, 0.53f, 0.54f), 0.55f, 0.88f, 0.0f, 0.80f, true  },

		// Glass / emissive — translucent & masked entries are NOT Nanite-safe.
		{ EBCUVoxelMaterial::GlassClear,		FLinearColor(0.82f, 0.90f, 0.95f), 0.05f, 0.00f, 0.0f, 0.20f, false },
		{ EBCUVoxelMaterial::GlassTinted,		FLinearColor(0.20f, 0.26f, 0.30f), 0.08f, 0.10f, 0.0f, 0.20f, false },
		{ EBCUVoxelMaterial::GlassReflective,	FLinearColor(0.42f, 0.55f, 0.62f), 0.04f, 0.35f, 0.0f, 0.15f, false },
		{ EBCUVoxelMaterial::WindowLit,			FLinearColor(1.00f, 0.94f, 0.78f), 0.20f, 0.00f, 8.0f, 0.10f, false },
		{ EBCUVoxelMaterial::WindowLitWarm,		FLinearColor(1.00f, 0.82f, 0.55f), 0.20f, 0.00f, 12.0f, 0.10f, false },
		{ EBCUVoxelMaterial::WindowLitCool,		FLinearColor(0.72f, 0.86f, 1.00f), 0.20f, 0.00f, 9.0f, 0.10f, false },
		{ EBCUVoxelMaterial::NeonPink,			FLinearColor(1.00f, 0.20f, 0.62f), 0.30f, 0.00f, 45.0f, 0.10f, false },
		{ EBCUVoxelMaterial::NeonCyan,			FLinearColor(0.20f, 0.95f, 1.00f), 0.30f, 0.00f, 45.0f, 0.10f, false },
		{ EBCUVoxelMaterial::NeonAmber,			FLinearColor(1.00f, 0.68f, 0.18f), 0.30f, 0.00f, 40.0f, 0.10f, false },
		{ EBCUVoxelMaterial::NeonWhite,			FLinearColor(1.00f, 1.00f, 1.00f), 0.30f, 0.00f, 38.0f, 0.10f, false },
		{ EBCUVoxelMaterial::LightFixture,		FLinearColor(1.00f, 0.98f, 0.90f), 0.25f, 0.00f, 60.0f, 0.10f, true  },

		// Ground / road
		{ EBCUVoxelMaterial::Asphalt,			FLinearColor(0.11f, 0.11f, 0.12f), 0.90f, 0.00f, 0.0f, 1.40f, true  },
		{ EBCUVoxelMaterial::AsphaltWorn,		FLinearColor(0.18f, 0.17f, 0.17f), 0.94f, 0.00f, 0.0f, 1.30f, true  },
		{ EBCUVoxelMaterial::ConcretePaving,	FLinearColor(0.56f, 0.55f, 0.53f), 0.88f, 0.00f, 0.0f, 1.10f, true  },
		{ EBCUVoxelMaterial::TactilePaving,		FLinearColor(0.72f, 0.60f, 0.20f), 0.80f, 0.00f, 0.0f, 1.00f, true  },
		{ EBCUVoxelMaterial::RoadLineWhite,		FLinearColor(0.86f, 0.86f, 0.84f), 0.70f, 0.00f, 0.0f, 0.90f, true  },
		{ EBCUVoxelMaterial::RoadLineYellow,	FLinearColor(0.88f, 0.70f, 0.14f), 0.70f, 0.00f, 0.0f, 0.90f, true  },
		{ EBCUVoxelMaterial::Crosswalk,			FLinearColor(0.84f, 0.84f, 0.82f), 0.72f, 0.00f, 0.0f, 0.90f, true  },
		{ EBCUVoxelMaterial::ManholeCover,		FLinearColor(0.24f, 0.24f, 0.25f), 0.55f, 0.85f, 0.0f, 0.80f, true  },
		{ EBCUVoxelMaterial::KerbStone,			FLinearColor(0.60f, 0.59f, 0.57f), 0.86f, 0.00f, 0.0f, 1.00f, true  },
		{ EBCUVoxelMaterial::Gravel,			FLinearColor(0.42f, 0.40f, 0.38f), 0.95f, 0.00f, 0.0f, 0.60f, true  },
		{ EBCUVoxelMaterial::RailTrack,			FLinearColor(0.40f, 0.38f, 0.35f), 0.42f, 0.90f, 0.0f, 0.70f, true  },
		{ EBCUVoxelMaterial::RubberMat,			FLinearColor(0.08f, 0.08f, 0.09f), 0.97f, 0.00f, 0.0f, 0.50f, true  },

		// Nature
		{ EBCUVoxelMaterial::Grass,				FLinearColor(0.22f, 0.42f, 0.18f), 0.92f, 0.00f, 0.0f, 0.90f, true  },
		{ EBCUVoxelMaterial::GrassDry,			FLinearColor(0.52f, 0.46f, 0.24f), 0.94f, 0.00f, 0.0f, 0.80f, true  },
		{ EBCUVoxelMaterial::Dirt,				FLinearColor(0.28f, 0.21f, 0.15f), 0.95f, 0.00f, 0.0f, 1.10f, true  },
		{ EBCUVoxelMaterial::Mud,				FLinearColor(0.19f, 0.15f, 0.11f), 0.70f, 0.00f, 0.0f, 1.50f, true  },
		{ EBCUVoxelMaterial::Sand,				FLinearColor(0.80f, 0.72f, 0.55f), 0.96f, 0.00f, 0.0f, 0.70f, true  },
		{ EBCUVoxelMaterial::Rock,				FLinearColor(0.36f, 0.35f, 0.34f), 0.90f, 0.00f, 0.0f, 0.80f, true  },
		{ EBCUVoxelMaterial::Snow,				FLinearColor(0.92f, 0.94f, 0.97f), 0.60f, 0.00f, 0.0f, 0.30f, true  },
		{ EBCUVoxelMaterial::Ice,				FLinearColor(0.78f, 0.88f, 0.95f), 0.10f, 0.00f, 0.0f, 0.10f, false },
		{ EBCUVoxelMaterial::Water,				FLinearColor(0.06f, 0.22f, 0.32f), 0.02f, 0.00f, 0.0f, 0.00f, false },
		{ EBCUVoxelMaterial::TreeTrunk,			FLinearColor(0.26f, 0.18f, 0.12f), 0.92f, 0.00f, 0.0f, 1.00f, true  },
		{ EBCUVoxelMaterial::LeavesGreen,		FLinearColor(0.18f, 0.38f, 0.16f), 0.88f, 0.00f, 0.0f, 0.70f, false },
		{ EBCUVoxelMaterial::LeavesAutumn,		FLinearColor(0.66f, 0.36f, 0.12f), 0.88f, 0.00f, 0.0f, 0.70f, false },
		{ EBCUVoxelMaterial::LeavesPine,		FLinearColor(0.11f, 0.26f, 0.16f), 0.90f, 0.00f, 0.0f, 0.70f, false },
		{ EBCUVoxelMaterial::Flowers,			FLinearColor(0.78f, 0.32f, 0.48f), 0.86f, 0.00f, 0.0f, 0.80f, false },

		// Interior / props
		{ EBCUVoxelMaterial::PlasterWhite,		FLinearColor(0.86f, 0.85f, 0.82f), 0.90f, 0.00f, 0.0f, 0.90f, true  },
		{ EBCUVoxelMaterial::WoodOak,			FLinearColor(0.52f, 0.36f, 0.21f), 0.68f, 0.00f, 0.0f, 1.00f, true  },
		{ EBCUVoxelMaterial::WoodDark,			FLinearColor(0.24f, 0.16f, 0.10f), 0.66f, 0.00f, 0.0f, 1.00f, true  },
		{ EBCUVoxelMaterial::Tile,				FLinearColor(0.82f, 0.84f, 0.85f), 0.18f, 0.00f, 0.0f, 0.30f, true  },
		{ EBCUVoxelMaterial::Carpet,			FLinearColor(0.34f, 0.20f, 0.22f), 0.98f, 0.00f, 0.0f, 1.20f, true  },
		{ EBCUVoxelMaterial::Fabric,			FLinearColor(0.40f, 0.42f, 0.48f), 0.94f, 0.00f, 0.0f, 1.10f, true  },
		{ EBCUVoxelMaterial::PaintedRed,		FLinearColor(0.62f, 0.12f, 0.12f), 0.62f, 0.00f, 0.0f, 1.00f, true  },
		{ EBCUVoxelMaterial::PaintedBlue,		FLinearColor(0.12f, 0.26f, 0.58f), 0.62f, 0.00f, 0.0f, 1.00f, true  },
		{ EBCUVoxelMaterial::PaintedYellow,		FLinearColor(0.86f, 0.72f, 0.16f), 0.62f, 0.00f, 0.0f, 1.00f, true  },
		{ EBCUVoxelMaterial::PaintedGreen,		FLinearColor(0.14f, 0.44f, 0.22f), 0.62f, 0.00f, 0.0f, 1.00f, true  },
		{ EBCUVoxelMaterial::PaintedGrey,		FLinearColor(0.40f, 0.40f, 0.41f), 0.66f, 0.00f, 0.0f, 1.00f, true  },
		{ EBCUVoxelMaterial::PaintedWhite,		FLinearColor(0.88f, 0.88f, 0.87f), 0.60f, 0.00f, 0.0f, 1.00f, true  },
	};
}

const FBCUVoxelMaterialTraits* UBCUVoxelMaterialSet::FindTraits(EBCUVoxelMaterial Material) const
{
	const uint8 Wanted = static_cast<uint8>(Material);
	for (const FBCUVoxelMaterialTraits& Entry : Traits)
	{
		if (static_cast<uint8>(Entry.Material) == Wanted)
		{
			return &Entry;
		}
	}
	return nullptr;
}

FLinearColor UBCUVoxelMaterialSet::ResolveColor(const FBCUVoxel& Voxel) const
{
	const EBCUVoxelMaterial Material = static_cast<EBCUVoxelMaterial>(Voxel.Material);
	FLinearColor Color = FLinearColor::White;

	if (const FBCUVoxelMaterialTraits* Found = FindTraits(Material))
	{
		Color = Found->BaseColor;
	}

	if (Voxel.PaletteIndex > 0)
	{
		// Palettes multiply rather than replace, so a single "Brick" material
		// can produce a whole street of differently aged facades for free.
		Color *= (Palettes.IsValidIndex(Voxel.PaletteIndex)
			? Palettes[Voxel.PaletteIndex].Get(0)
			: FLinearColor::White);
	}

	// Baked shade hint multiplies into vertex colour for cheap AO.
	const float ShadeFactor = float(Voxel.Shade) / 255.0f;
	return Color * FLinearColor(ShadeFactor, ShadeFactor, ShadeFactor, 1.0f);
}

bool UBCUVoxelMaterialSet::IsNaniteCompatible(EBCUVoxelMaterial Material) const
{
	if (const FBCUVoxelMaterialTraits* Found = FindTraits(Material))
	{
		return Found->bNaniteCompatible;
	}

	// Unknown materials default to the safe (non-Nanite) path.
	return false;
}

void UBCUVoxelMaterialSet::EnsureDefaults()
{
	if (Traits.Num() > 0)
	{
		return;
	}

	Traits.Reserve(UE_ARRAY_COUNT(BCUVoxelDefaults::Table));
	for (const BCUVoxelDefaults::FEntry& Entry : BCUVoxelDefaults::Table)
	{
		FBCUVoxelMaterialTraits New;
		New.Material = Entry.Material;
		New.BaseColor = Entry.Color;
		New.Roughness = Entry.Roughness;
		New.Metallic = Entry.Metallic;
		New.EmissiveIntensity = Entry.Emissive;
		New.WetnessResponse = Entry.Wetness;
		New.bNaniteCompatible = Entry.bNanite;
		New.bCastsShadow = (Entry.Material != EBCUVoxelMaterial::Water);
		Traits.Add(New);
	}

	if (Palettes.Num() == 0)
	{
		FBCUVoxelPalette Facades;
		Facades.PaletteName = TEXT("FacadeAges");
		Facades.Colors = {
			FLinearColor::White,
			FLinearColor(1.00f, 0.97f, 0.92f),
			FLinearColor(0.93f, 0.92f, 0.90f),
			FLinearColor(0.84f, 0.83f, 0.80f),
			FLinearColor(0.72f, 0.71f, 0.68f),
			FLinearColor(0.61f, 0.59f, 0.55f),
		};
		Palettes.Add(Facades);

		FBCUVoxelPalette Neon;
		Neon.PaletteName = TEXT("NeonSignage");
		Neon.Colors = {
			FLinearColor(1.00f, 0.25f, 0.60f),
			FLinearColor(0.25f, 0.90f, 1.00f),
			FLinearColor(1.00f, 0.75f, 0.20f),
			FLinearColor(0.45f, 1.00f, 0.55f),
			FLinearColor(0.70f, 0.45f, 1.00f),
			FLinearColor(1.00f, 1.00f, 1.00f),
		};
		Palettes.Add(Neon);
	}
}
