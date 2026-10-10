// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "World/City/BCUCellActor.h"

#include "World/City/BCUDistrictDataAsset.h"
#include "World/City/BCUCityStreamer.h"
#include "Components/HierarchicalInstancedStaticMeshComponent.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUCell, Log, All);

ABCUCellActor::ABCUCellActor()
{
	PrimaryActorTick.bCanEverTick = false;
	bReplicates = false;
	SetCanBeDamaged(false);
	SetActorEnableCollision(true);

#if WITH_EDITORONLY_DATA
	// Cells are runtime-generated: World Partition must not try to source-load
	// them or include them in a build.
	bIsSpatiallyLoaded = false;
	HLODLayerName = NAME_None;
#endif

	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));

	auto MakeMesh = [this](const TCHAR* Name)
	{
		UStaticMeshComponent* Comp = CreateDefaultSubobject<UStaticMeshComponent>(Name);
		Comp->SetupAttachment(RootComponent);
		Comp->SetMobility(EComponentMobility::Static);
		Comp->SetCollisionProfileName(TEXT("BCU_Voxel"));
		Comp->SetGenerateOverlapEvents(false);
		Comp->SetCanEverAffectNavigation(true);
		Comp->bAffectDynamicIndirectLighting = true;
		Comp->bCastFarShadow = true;
		Comp->SetHiddenInGame(false);
		return Comp;
	};

	OpaqueMesh = MakeMesh(TEXT("OpaqueMesh"));
	MaskedMesh = MakeMesh(TEXT("MaskedMesh"));
	TranslucentMesh = MakeMesh(TEXT("TranslucentMesh"));
	EmissiveMesh = MakeMesh(TEXT("EmissiveMesh"));
	HLODMesh = MakeMesh(TEXT("HLODMesh"));

	// Masked geometry (foliage, grating) is not Nanite-compatible.
	MaskedMesh->SetCastShadow(true);
	MaskedMesh->bAffectDynamicIndirectLighting = false;

	// Translucent glass must not write to the depth prepass or Lumen loses the
	// interior reflections behind it.
	TranslucentMesh->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
	TranslucentMesh->SetCastShadow(false);
	TranslucentMesh->bAffectDynamicIndirectLighting = false;
	TranslucentMesh->SetRenderInMainPass(true);

	// Emissive windows/neon: no shadow, full bloom response.
	EmissiveMesh->SetCastShadow(false);
	EmissiveMesh->bAffectDynamicIndirectLighting = true;

	HLODMesh->SetMobility(EComponentMobility::Static);
	HLODMesh->SetCollisionEnabled(ECollisionEnabled::QueryOnly);
	HLODMesh->SetVisibility(false);
	HLODMesh->SetCastShadow(true);

	PropInstances = CreateDefaultSubobject<UHierarchicalInstancedStaticMeshComponent>(TEXT("PropInstances"));
	PropInstances->SetupAttachment(RootComponent);
	PropInstances->SetMobility(EComponentMobility::Static);
	PropInstances->SetCollisionProfileName(TEXT("BCU_Voxel"));
	PropInstances->SetCullDistances(20000.0f, 180000.0f);
	PropInstances->SetNumCustomDataFloats(2.0f); // material index + flags
	PropInstances->bEnableDensityScaling = true;
	PropInstances->SetEnableAutoClustering(true);
}

UStaticMeshComponent* ABCUCellActor::ComponentForSection(EBCUMeshSection Section) const
{
	switch (Section)
	{
	case EBCUMeshSection::Opaque:			return OpaqueMesh;
	case EBCUMeshSection::Masked:			return MaskedMesh;
	case EBCUMeshSection::Translucent:		return TranslucentMesh;
	case EBCUMeshSection::Emissive:			return EmissiveMesh;
	default:								return OpaqueMesh;
	}
}

void ABCUCellActor::SetSectionMesh(EBCUMeshSection Section, UStaticMesh* Mesh,
	const FVector& WorldOrigin, bool bEnableNanite)
{
	UStaticMeshComponent* Comp = ComponentForSection(Section);
	if (!Comp || !Mesh)
	{
		return;
	}

	Comp->SetStaticMesh(Mesh);
	Comp->SetWorldLocation(WorldOrigin);
	Comp->SetRelativeLocation(FVector::ZeroVector);

	// Only the opaque cluster gets Nanite; see Docs/05 §2 for why the other
	// three sections must stay on the classic path.
	FMeshNaniteSettings NaniteSettings = Comp->GetNaniteSettings();
	NaniteSettings.bEnabled = bEnableNanite && Section == EBCUMeshSection::Opaque;
	Comp->SetNaniteSettings(NaniteSettings);

	Comp->MarkRenderStateDirty();
	Comp->MarkCollisionDirty();
}

void ABCUCellActor::SetNaniteEnabled(bool bEnabled)
{
	for (UStaticMeshComponent* Comp : { OpaqueMesh, MaskedMesh, TranslucentMesh, EmissiveMesh, HLODMesh })
	{
		if (!Comp)
		{
			continue;
		}

		FMeshNaniteSettings Settings = Comp->GetNaniteSettings();
		Settings.bEnabled = bEnabled && (Comp == OpaqueMesh || Comp == HLODMesh);
		Comp->SetNaniteSettings(Settings);
	}
}

void ABCUCellActor::SetDistanceFieldOcclusion(bool bEnabled)
{
	for (UStaticMeshComponent* Comp : { OpaqueMesh, HLODMesh })
	{
		if (Comp)
		{
			// Affect-distance-field GI so a generated tower occludes skylight
			// exactly like a hand-authored one.
			Comp->bAffectDistanceFieldLighting = bEnabled;
			Comp->MarkRenderStateDirty();
		}
	}
}

void ABCUCellActor::SetCellResident(bool bResident)
{
	const bool bVisible = bResident;
	for (UStaticMeshComponent* Comp : { OpaqueMesh, MaskedMesh, TranslucentMesh, EmissiveMesh })
	{
		if (Comp)
		{
			Comp->SetVisibility(bVisible, true);
			Comp->SetHiddenInGame(!bVisible);
		}
	}

	if (PropInstances)
	{
		PropInstances->SetVisibility(bVisible, true);
	}
}

void ABCUCellActor::SetHLODVisible(bool bVisible)
{
	if (HLODMesh)
	{
		HLODMesh->SetVisibility(bVisible, true);
		HLODMesh->SetHiddenInGame(!bVisible);
	}
}

void ABCUCellActor::SetFullDetailVisible(bool bVisible)
{
	for (UStaticMeshComponent* Comp : { OpaqueMesh, MaskedMesh, TranslucentMesh, EmissiveMesh })
	{
		if (Comp)
		{
			Comp->SetVisibility(bVisible, true);
		}
	}

	if (PropInstances)
	{
		PropInstances->SetVisibility(bVisible, true);
	}
}

void ABCUCellActor::SetDebugMode(EBCUCityDebugMode Mode)
{
	const bool bWireframe = (Mode == EBCUCityDebugMode::ChunkWireframe);
	for (UStaticMeshComponent* Comp : { OpaqueMesh, MaskedMesh, TranslucentMesh, EmissiveMesh })
	{
		if (Comp)
		{
			Comp->bOverrideWireframeColor = (Mode != EBCUCityDebugMode::None);
			Comp->WireframeColor = (Mode == EBCUCityDebugMode::LODColors)
				? FLinearColor(0.1f, 0.9f, 0.2f)
				: FLinearColor(0.9f, 0.6f, 0.1f);
			Comp->SetRenderCustomDepth(bWireframe);
		}
	}
}

void ABCUCellActor::DestroyCell()
{
	for (UStaticMeshComponent* Comp : { OpaqueMesh, MaskedMesh, TranslucentMesh, EmissiveMesh, HLODMesh })
	{
		if (Comp)
		{
			Comp->SetStaticMesh(nullptr);
			Comp->DestroyRenderState_Concurrent();
		}
	}

	if (PropInstances)
	{
		PropInstances->ClearInstances();
	}

	UE_LOG(LogBCUCell, Verbose, TEXT("Cell %s destroyed"), *Coord.ToString());
}

int32 ABCUCellActor::GetTriangleCount() const
{
	int32 Total = 0;
	for (UStaticMeshComponent* Comp : { OpaqueMesh, MaskedMesh, TranslucentMesh, EmissiveMesh })
	{
		if (Comp && Comp->GetStaticMesh())
		{
			const UStaticMesh* Mesh = Comp->GetStaticMesh();
			Total += Mesh->GetNumTriangles(0);
		}
	}
	return Total;
}
