// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Vehicle/BCUVehicleCustomisationComponent.h"

#include "Vehicle/BCUBaseVehicle.h"
#include "Vehicle/BCUVehicleDefinition.h"
#include "Components/PointLightComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Materials/MaterialInstanceDynamic.h"

UBCUVehicleCustomisationComponent::UBCUVehicleCustomisationComponent()
{
	PrimaryComponentTick.bCanEverTick = false;
}

void UBCUVehicleCustomisationComponent::BeginPlay() { Super::BeginPlay(); }

void UBCUVehicleCustomisationComponent::Initialise(ABCUBaseVehicle* InVehicle)
{
	Vehicle = InVehicle;
	PaintMID = nullptr;
	TrimMID = nullptr;

	if (Vehicle && Vehicle->GetDefinition())
	{
		PaintColor = Vehicle->PaintColor;
		WheelStyleId = Vehicle->WheelStyle;
		EngineLevel = Vehicle->EngineLevel;
		HandlingLevel = Vehicle->HandlingLevel;
		BrakeLevel = Vehicle->BrakeLevel;
	}
}

void UBCUVehicleCustomisationComponent::EnsurePaintMID()
{
	if (PaintMID || !Vehicle) { return; }

	UBCUVehicleDefinition* Def = Vehicle->GetDefinition();
	if (!Def) { return; }

	// One MID per vehicle, shared by every painted surface. Changing paint is
	// therefore a single SetVectorParameterValue, never a mesh rebuild.
	if (UMaterialInterface* Base = Def->PaintMaterial.LoadSynchronous())
	{
		PaintMID = UMaterialInstanceDynamic::Create(Base, Vehicle);
		if (Vehicle->VoxelBody) { Vehicle->VoxelBody->SetMaterial(0, PaintMID); }
	}

	if (UMaterialInterface* TrimBase = Def->TrimMaterial.LoadSynchronous())
	{
		TrimMID = UMaterialInstanceDynamic::Create(TrimBase, Vehicle);
		if (Vehicle->VoxelBody && Vehicle->VoxelBody->GetNumMaterials() > 1)
		{
			Vehicle->VoxelBody->SetMaterial(1, TrimMID);
		}
	}
}

void UBCUVehicleCustomisationComponent::ApplyPaint(const FLinearColor& Color)
{
	PaintColor = Color;
	EnsurePaintMID();

	if (PaintMID)
	{
		PaintMID->SetVectorParameterValue(TEXT("BaseColor"), Color);

		// Finish drives roughness/metallic/clearcoat so a matte wrap and a
		// chrome bumper read differently under the same Lumen sky.
		float Roughness = 0.28f, Metallic = 0.55f, Clearcoat = 1.0f, Flake = 0.25f;
		switch (Finish)
		{
		case EBCUPaintFinish::Matte:	Roughness = 0.82f; Metallic = 0.10f; Clearcoat = 0.05f; Flake = 0.0f; break;
		case EBCUPaintFinish::Metallic:	Roughness = 0.22f; Metallic = 0.85f; Clearcoat = 1.0f; Flake = 0.75f; break;
		case EBCUPaintFinish::Pearl:	Roughness = 0.14f; Metallic = 0.35f; Clearcoat = 1.0f; Flake = 1.0f; break;
		case EBCUPaintFinish::Chrome:	Roughness = 0.03f; Metallic = 1.0f; Clearcoat = 0.0f; Flake = 0.0f; break;
		case EBCUPaintFinish::Candy:	Roughness = 0.10f; Metallic = 0.20f; Clearcoat = 1.0f; Flake = 0.5f; break;
		case EBCUPaintFinish::Rust:		Roughness = 0.94f; Metallic = 0.30f; Clearcoat = 0.0f; Flake = 0.0f; break;
		case EBCUPaintFinish::Gloss:
		default:						break;
		}

		PaintMID->SetScalarParameterValue(TEXT("Roughness"), Roughness);
		PaintMID->SetScalarParameterValue(TEXT("Metallic"), Metallic);
		PaintMID->SetScalarParameterValue(TEXT("Clearcoat"), Clearcoat);
		PaintMID->SetScalarParameterValue(TEXT("Flake"), Flake);
	}

	if (Vehicle) { Vehicle->PaintColor = Color; }
}

void UBCUVehicleCustomisationComponent::ApplyFinish(EBCUPaintFinish NewFinish)
{
	Finish = NewFinish;
	ApplyPaint(PaintColor); // re-pushes the roughness/metallic set
}

void UBCUVehicleCustomisationComponent::ApplyWheelStyle(FName StyleId)
{
	WheelStyleId = StyleId;
	if (!Vehicle) { return; }

	Vehicle->WheelStyle = StyleId;

	// Wheel style changes rim material + profile, which is a mesh difference, so
	// it goes through the subsystem's cache rather than a parameter.
	EnsurePaintMID();
	if (TrimMID)
	{
		const bool bChrome = (StyleId == TEXT("Chrome"));
		TrimMID->SetScalarParameterValue(TEXT("Metallic"), bChrome ? 1.0f : 0.72f);
		TrimMID->SetScalarParameterValue(TEXT("Roughness"), bChrome ? 0.04f : 0.30f);
	}
}

void UBCUVehicleCustomisationComponent::ApplyDecal(FName NewDecalId)
{
	DecalId = NewDecalId;
	EnsurePaintMID();

	if (PaintMID)
	{
		// Decals are a texture-array index in the paint material, so a decal swap
		// never rebuilds the mesh.
		const float Index = (DecalId == NAME_None) ? 0.0f
			: float(FCrc::MemCrc32(TCHAR_TO_ANSI(*DecalId.ToString())) % 16 + 1);
		PaintMID->SetScalarParameterValue(TEXT("DecalIndex"), Index);
	}
}

void UBCUVehicleCustomisationComponent::ApplyBodyKit(FName KitId)
{
	BodyKitId = KitId;

	// Body kits are instanced voxel add-ons (spoiler, splitter, skirts) parented
	// to the body component, so a kit swap is an instance-array change.
	if (!Vehicle || !Vehicle->VoxelBody) { return; }

	Vehicle->VoxelBody->SetScalarParameterValueOnMaterials(TEXT("BodyKitIndex"),
		float(KitId == NAME_None ? 0 : FCrc::MemCrc32(TCHAR_TO_ANSI(*KitId.ToString())) % 8));
}

void UBCUVehicleCustomisationComponent::SetUnderglow(bool bEnabled, const FLinearColor& Color)
{
	bUnderglowOn = bEnabled;
	UnderglowColor = Color;

	if (!Vehicle) { return; }

	// Reuse the taillight point light as the underglow source: one light, moved
	// under the floor, which costs nothing extra in the light budget.
	if (UPointLightComponent* Glow = Vehicle->TaillightGlow)
	{
		if (bEnabled)
		{
			Glow->SetRelativeLocation(FVector(0.0f, 0.0f, -34.0f));
			Glow->SetLightColor(Color.ToFColor(true));
			Glow->SetIntensity(2600.0f);
			Glow->SetAttenuationRadius(700.0f);
		}
		else
		{
			Glow->SetRelativeLocation(FVector(-96.0f, 0.0f, 56.0f));
			Glow->SetLightColor(FColor(255, 16, 10));
			Glow->SetIntensity(0.0f);
		}
	}
}

void UBCUVehicleCustomisationComponent::ApplyUpgradeLevels(int32 NewEngineLevel, int32 NewHandlingLevel, int32 NewBrakeLevel)
{
	EngineLevel = FMath::Clamp(NewEngineLevel, 0, 5);
	HandlingLevel = FMath::Clamp(NewHandlingLevel, 0, 5);
	BrakeLevel = FMath::Clamp(NewBrakeLevel, 0, 5);

	if (!Vehicle) { return; }

	Vehicle->EngineLevel = EngineLevel;
	Vehicle->HandlingLevel = HandlingLevel;
	Vehicle->BrakeLevel = BrakeLevel;

	// Re-apply the definition through Chaos with the upgrade multipliers folded
	// in. This is the only place performance upgrades touch physics, so the
	// numbers in the garage UI are always the numbers the car actually has.
	if (UBCUVehicleDefinition* Def = Vehicle->GetDefinition())
	{
		Def->PeakTorqueNm *= GetEngineMultiplier();
		Def->BrakeTorqueNm *= GetBrakeMultiplier();
		for (FBCUWheelSpec& Wheel : Def->Wheels)
		{
			Wheel.TyreFrictionScale *= GetHandlingMultiplier();
		}
		Vehicle->ConfigureFromDefinition(Def);
	}
}

float UBCUVehicleCustomisationComponent::GetEngineMultiplier() const
{
	return 1.0f + float(EngineLevel) * 0.085f; // +8.5% per level, +42.5% at max
}

float UBCUVehicleCustomisationComponent::GetHandlingMultiplier() const
{
	return 1.0f + float(HandlingLevel) * 0.055f;
}

float UBCUVehicleCustomisationComponent::GetBrakeMultiplier() const
{
	return 1.0f + float(BrakeLevel) * 0.07f;
}
