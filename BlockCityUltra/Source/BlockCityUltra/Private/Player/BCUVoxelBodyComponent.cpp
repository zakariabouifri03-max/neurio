// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Player/BCUVoxelBodyComponent.h"

#include "Components/InstancedStaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "UObject/ConstructorHelpers.h"

UBCUVoxelBodyComponent::UBCUVoxelBodyComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
	PrimaryComponentTick.TickInterval = 0.0f;
	GetDefaultHumanoidParts(Parts);
}

void UBCUVoxelBodyComponent::GetDefaultHumanoidParts(TArray<FBCUBodyPart>& OutParts)
{
	OutParts.Reset();

	// A 9-part humanoid at 6 cm voxels is ~1.8 m tall and ~1.4k triangles: the
	// blocky silhouette the art direction wants, at pedestrian-crowd cost.
	auto Add = [&OutParts](const TCHAR* Name, int32 W, int32 H, int32 D,
		const FVector& Loc, int32 Slot, const TCHAR* Bone)
	{
		FBCUBodyPart Part;
		Part.PartName = FName(Name);
		Part.VoxelDimensions = FIntVector(W, H, D);
		Part.VoxelSizeCm = 6.0f;
		Part.RestLocation = Loc;
		Part.PaletteSlot = Slot;
		Part.FollowBone = FName(Bone);
		OutParts.Add(Part);
	};

	Add(TEXT("Head"),		4, 4, 4, FVector(0, 0, 168), 0, TEXT("head"));
	Add(TEXT("Torso"),		8, 4, 10, FVector(0, 0, 122), 1, TEXT("spine_02"));
	Add(TEXT("Hips"),		8, 4, 4, FVector(0, 0, 96), 2, TEXT("pelvis"));
	Add(TEXT("ArmUpper_L"),	3, 3, 7, FVector(-22, 0, 132), 1, TEXT("upperarm_l"));
	Add(TEXT("ArmUpper_R"),	3, 3, 7, FVector(22, 0, 132), 1, TEXT("upperarm_r"));
	Add(TEXT("ArmLower_L"),	3, 3, 7, FVector(-22, 0, 92), 0, TEXT("lowerarm_l"));
	Add(TEXT("ArmLower_R"),	3, 3, 7, FVector(22, 0, 92), 0, TEXT("lowerarm_r"));
	Add(TEXT("LegUpper_L"),	3, 3, 9, FVector(-12, 0, 62), 2, TEXT("thigh_l"));
	Add(TEXT("LegUpper_R"),	3, 3, 9, FVector(12, 0, 62), 2, TEXT("thigh_r"));
	Add(TEXT("LegLower_L"),	3, 3, 9, FVector(-12, 0, 14), 2, TEXT("calf_l"));
	Add(TEXT("LegLower_R"),	3, 3, 9, FVector(12, 0, 14), 2, TEXT("calf_r"));
	Add(TEXT("Shoe_L"),		3, 4, 2, FVector(-12, 2, 3), 3, TEXT("foot_l"));
	Add(TEXT("Shoe_R"),		3, 4, 2, FVector(12, 2, 3), 3, TEXT("foot_r"));
}

void UBCUVoxelBodyComponent::BeginPlay()
{
	Super::BeginPlay();
	BuildBody();
}

void UBCUVoxelBodyComponent::EnsureCubeMesh()
{
	if (CubeMesh) { return; }

	// One shared unit cube for every body part of every character in the city.
	CubeMesh = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
	if (!CubeMesh)
	{
		CubeMesh = NewObject<UStaticMesh>(this);
	}
}

FLinearColor UBCUVoxelBodyComponent::ColorForSlot(int32 Slot) const
{
	switch (Slot)
	{
	case 0: return SkinColor;
	case 1: return ShirtColor;
	case 2: return TrouserColor;
	case 3: return ShoeColor;
	default: return FLinearColor::White;
	}
}

void UBCUVoxelBodyComponent::BuildBody()
{
	AActor* Owner = GetOwner();
	if (!Owner) { return; }

	EnsureCubeMesh();

	if (!InstanceComponent)
	{
		InstanceComponent = NewObject<UInstancedStaticMeshComponent>(Owner, TEXT("VoxelBodyInstances"));
		if (!InstanceComponent) { return; }

		InstanceComponent->SetupAttachment(Owner->GetRootComponent());
		InstanceComponent->RegisterComponent();
	}

	InstanceComponent->ClearInstances();
	InstanceComponent->SetStaticMesh(CubeMesh);
	InstanceComponent->SetMobility(EComponentMobility::Movable);
	InstanceComponent->SetCollisionEnabled(ECollisionEnabled::NoCollision); // capsule owns collision
	InstanceComponent->SetCastShadow(true);
	InstanceComponent->SetNumCustomDataFloats(1.0f);

	if (UMaterialInterface* Mat = BodyMaterial.LoadSynchronous())
	{
		InstanceComponent->SetMaterial(0, Mat);
	}

	for (int32 i = 0; i < Parts.Num(); ++i)
	{
		const FBCUBodyPart& Part = Parts[i];

		// One unit cube scaled to the part's voxel box. The per-instance colour
		// goes into custom data slot 0 as a packed index, which the layered
		// body material decodes — so one material serves every outfit.
		const FVector Scale(
			Part.VoxelDimensions.X * Part.VoxelSizeCm / 100.0f,
			Part.VoxelDimensions.Y * Part.VoxelSizeCm / 100.0f,
			Part.VoxelDimensions.Z * Part.VoxelSizeCm / 100.0f);

		const FTransform Transform(FRotator::ZeroRotator,
			bSeated ? SeatedTransform.TransformPosition(Part.RestLocation) : Part.RestLocation,
			Scale);

		const int32 InstanceIndex = InstanceComponent->AddInstance(Transform);
		if (InstanceIndex != INDEX_NONE)
		{
			// Pack the palette slot into the blue channel of custom data 0.
			const float Packed = float(Part.PaletteSlot) / 3.0f;
			InstanceComponent->SetCustomDataValue(InstanceIndex, 0, Packed, /*bMarkRenderStateDirty=*/false);
		}
	}

	InstanceComponent->MarkRenderStateDirty();
}

void UBCUVoxelBodyComponent::ApplyOutfit(FName OutfitId)
{
	// Outfit presets live in DT_CharacterCustomisation; the game mode resolves
	// the palette and pushes it here so this component never touches data assets.
	if (!OutfitId.IsValid()) { return; }

	const uint32 Hash = FCrc::MemCrc32(TCHAR_TO_ANSI(*OutfitId.ToString()));

	// Deterministic fallback palette: gives every NPC a distinct look with zero
	// authored content, which is what makes a crowd feel populated.
	SkinColor = FLinearColor(0.45f + 0.45f * float(Hash % 7u) / 7.0f,
		0.30f + 0.40f * float((Hash >> 3) % 7u) / 7.0f,
		0.22f + 0.45f * float((Hash >> 6) % 7u) / 7.0f);
	ShirtColor = FLinearColor(0.10f + 0.75f * float((Hash >> 9) % 11u) / 11.0f,
		0.10f + 0.75f * float((Hash >> 13) % 11u) / 11.0f,
		0.10f + 0.75f * float((Hash >> 17) % 11u) / 11.0f);
	TrouserColor = FLinearColor(0.08f + 0.30f * float((Hash >> 21) % 5u) / 5.0f,
		0.08f + 0.30f * float((Hash >> 24) % 5u) / 5.0f,
		0.10f + 0.32f * float((Hash >> 27) % 5u) / 5.0f);
	ShoeColor = FLinearColor(0.05f, 0.05f, 0.06f);

	BuildBody();
}

void UBCUVoxelBodyComponent::SetPalette(const FLinearColor& Skin, const FLinearColor& Shirt,
	const FLinearColor& Trousers, const FLinearColor& Shoes)
{
	SkinColor = Skin;
	ShirtColor = Shirt;
	TrouserColor = Trousers;
	ShoeColor = Shoes;
	BuildBody();
}

void UBCUVoxelBodyComponent::SetSeatedPose(const FTransform& SeatTransform)
{
	if (!bSeated) { bSeated = true; }
	SeatedTransform = SeatTransform;

	// Seated pose: legs forward, arms on the wheel. Rebuilding is cheap (13
	// instances) and only happens once per vehicle entry/exit.
	for (FBCUBodyPart& Part : Parts)
	{
		if (Part.PartName == TEXT("LegUpper_L") || Part.PartName == TEXT("LegUpper_R"))
		{
			Part.RestLocation = FVector(Part.RestLocation.X, 26.0f, 66.0f);
		}
		else if (Part.PartName == TEXT("LegLower_L") || Part.PartName == TEXT("LegLower_R"))
		{
			Part.RestLocation = FVector(Part.RestLocation.X, 52.0f, 46.0f);
		}
		else if (Part.PartName == TEXT("ArmLower_L") || Part.PartName == TEXT("ArmLower_R"))
		{
			Part.RestLocation = FVector(Part.RestLocation.X * 0.8f, 34.0f, 112.0f);
		}
	}

	BuildBody();
}

void UBCUVoxelBodyComponent::SetStandingPose()
{
	bSeated = false;
	SeatedTransform = FTransform::Identity;

	GetDefaultHumanoidParts(Parts);
	BuildBody();
}
