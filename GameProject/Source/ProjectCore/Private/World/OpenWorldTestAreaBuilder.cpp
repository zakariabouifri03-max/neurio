// Copyright GameProject. All rights reserved. Original content only.

#include "World/OpenWorldTestAreaBuilder.h"

#include "Components/LightComponent.h"
#include "Core/GameProjectLog.h"
#include "Core/GameProjectTags.h"
#include "Engine/DirectionalLight.h"
#include "Engine/ExponentialHeightFog.h"
#include "Engine/SkyAtmosphere.h"
#include "Engine/SkyLight.h"
#include "Engine/World.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerStart.h"
#include "Interaction/InteractableTestActor.h"
#include "Voxel/VoxelWorldManager.h"

AOpenWorldTestAreaBuilder::AOpenWorldTestAreaBuilder()
{
	PrimaryActorTick.bCanEverTick = false;

	// Infrastructure, not content: keep it anchored so nobody nudges it by accident.
	bLockLocation = true;
}

void AOpenWorldTestAreaBuilder::BeginPlay()
{
	Super::BeginPlay();
	BuildTestArea();
}

void AOpenWorldTestAreaBuilder::BuildTestArea()
{
	if (!GetWorld())
	{
		return;
	}

	if (bIsBuilt)
	{
		return;
	}
	bIsBuilt = true;

	EnsureVoxelWorld();

	if (bSpawnDefaultLighting)
	{
		EnsureLighting();
	}
	if (bSpawnPlayerStart)
	{
		EnsurePlayerStart();
	}
	if (bSpawnTestInteractables)
	{
		SpawnTestInteractables();
	}

	UE_LOG(LogWorld, Log, TEXT("Test area built: %d actor(s) created by this builder."), SpawnedActors.Num());
}

void AOpenWorldTestAreaBuilder::EnsureVoxelWorld()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	for (TActorIterator<AVoxelWorldManager> It(World); It; ++It)
	{
		VoxelWorldManager = *It;
		break;
	}

	if (VoxelWorldManager)
	{
		UE_LOG(LogWorld, Log, TEXT("Found existing voxel world manager '%s'."), *VoxelWorldManager->GetName());
	}
	else
	{
		// The game mode normally creates this; building it here too means an empty
		// level opened directly in PIE still produces a voxel world.
		VoxelWorldManager = World->SpawnActor<AVoxelWorldManager>(AVoxelWorldManager::StaticClass(), FTransform::Identity);
		SpawnedActors.Add(VoxelWorldManager);
		UE_LOG(LogWorld, Log, TEXT("Spawned voxel world manager from the test area builder."));
	}
}

void AOpenWorldTestAreaBuilder::EnsureLighting()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	// An authored level brings its own sky. Only fill the gaps, never replace.
	const bool bHasDirectionalLight = TActorIterator<ADirectionalLight>(World) != nullptr;
	const bool bHasSkyLight = TActorIterator<ASkyLight>(World) != nullptr;
	const bool bHasAtmosphere = TActorIterator<ASkyAtmosphere>(World) != nullptr;

	if (!bHasDirectionalLight)
	{
		FActorSpawnParameters Params;
		Params.ObjectFlags |= RF_Transient;
		Params.Name = TEXT("GameProjectSun");

		ADirectionalLight* Sun = World->SpawnActor<ADirectionalLight>(ADirectionalLight::StaticClass(), FTransform::Identity, Params);
		if (Sun)
		{
			// A low-ish sun angle is what makes blocky terrain read as geometry
			// instead of flat colour: long shadows define every voxel edge.
			Sun->SetActorRotation(FRotator(-48.0f, 35.0f, 0.0f));
#if WITH_EDITOR
			Sun->SetActorLabel(TEXT("GameProject_Sun"));
#endif

			if (ULightComponent* Light = Sun->GetLightComponent())
			{
				Light->SetIntensity(6.0f);
				Light->SetLightColor(FLinearColor(1.0f, 0.96f, 0.88f));
			}
			SpawnedActors.Add(Sun);
		}
	}

	if (!bHasSkyLight)
	{
		FActorSpawnParameters Params;
		Params.ObjectFlags |= RF_Transient;
		Params.Name = TEXT("GameProjectSkyLight");

		ASkyLight* SkyLight = World->SpawnActor<ASkyLight>(ASkyLight::StaticClass(), FTransform::Identity, Params);
		if (SkyLight)
		{
			if (ULightComponent* Light = SkyLight->GetLightComponent())
			{
				Light->SetIntensity(1.0f);
			}
			SpawnedActors.Add(SkyLight);
		}
	}

	if (!bHasAtmosphere)
	{
		FActorSpawnParameters Params;
		Params.ObjectFlags |= RF_Transient;
		Params.Name = TEXT("GameProjectSkyAtmosphere");

		if (ASkyAtmosphere* Atmosphere = World->SpawnActor<ASkyAtmosphere>(ASkyAtmosphere::StaticClass(), FTransform::Identity, Params))
		{
			SpawnedActors.Add(Atmosphere);
		}
	}

	if (TActorIterator<AExponentialHeightFog>(World) == nullptr)
	{
		FActorSpawnParameters Params;
		Params.ObjectFlags |= RF_Transient;
		Params.Name = TEXT("GameProjectHeightFog");

		if (AExponentialHeightFog* Fog = World->SpawnActor<AExponentialHeightFog>(AExponentialHeightFog::StaticClass(), FTransform::Identity, Params))
		{
			Fog->SetActorLocation(FVector(0.0f, 0.0f, -2000.0f));
			SpawnedActors.Add(Fog);
		}
	}
}

void AOpenWorldTestAreaBuilder::EnsurePlayerStart()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	if (TActorIterator<APlayerStart>(World) != nullptr)
	{
		return;
	}

	FActorSpawnParameters Params;
	Params.ObjectFlags |= RF_Transient;
	Params.Name = TEXT("GameProjectPlayerStart");

	APlayerStart* Start = World->SpawnActor<APlayerStart>(APlayerStart::StaticClass(),
		FTransform(FRotator::ZeroRotator, PlayerStartLocation), Params);

	if (Start)
	{
#if WITH_EDITOR
		Start->SetActorLabel(TEXT("GameProject_PlayerStart"));
#endif
		SpawnedActors.Add(Start);
		UE_LOG(LogWorld, Log, TEXT("Spawned PlayerStart at %d,%d,%d."),
			FMath::RoundToInt32(PlayerStartLocation.X), FMath::RoundToInt32(PlayerStartLocation.Y), FMath::RoundToInt32(PlayerStartLocation.Z));
	}
}

void AOpenWorldTestAreaBuilder::SpawnTestInteractables()
{
	UWorld* World = GetWorld();
	if (!World || TestInteractableCount <= 0)
	{
		return;
	}

	// A spread of categories rather than four identical doors: the HUD prompt shows
	// the category, so this exercises the tag plumbing end to end.
	struct FTestInteractableSpec
	{
		const TCHAR* Name;
		const TCHAR* Verb;
		FGameplayTag (*Category)();
		bool bDestroyOnInteract;
	};

	const FTestInteractableSpec Specs[] = {
		{ TEXT("GameProject_TestDoor"),    TEXT("Open"),      &GameProjectTags::InteractionCategoryDoor,     false },
		{ TEXT("GameProject_TestPickup"),  TEXT("Pick up"),   &GameProjectTags::InteractionCategoryPickup,   true },
		{ TEXT("GameProject_TestShop"),    TEXT("Browse"),    &GameProjectTags::InteractionCategoryShop,     false },
		{ TEXT("GameProject_TestSavePoint"), TEXT("Save"),    &GameProjectTags::InteractionCategorySavePoint,false },
	};

	FActorSpawnParameters Params;
	Params.ObjectFlags |= RF_Transient;

	for (int32 Index = 0; Index < TestInteractableCount; ++Index)
	{
		const FTestInteractableSpec& Spec = Specs[Index % UE_ARRAY_COUNT(Specs)];

		Params.Name = FName(*FString::Printf(TEXT("%s_%d"), Spec.Name, Index));

		const FVector Location = PlayerStartLocation
			+ FVector(400.0f, (Index - (TestInteractableCount - 1) * 0.5f) * TestInteractableSpacing, 0.0f);

		AInteractableTestActor* Interactable = World->SpawnActor<AInteractableTestActor>(
			AInteractableTestActor::StaticClass(), FTransform(FRotator::ZeroRotator, Location), Params);

		if (!Interactable)
		{
			UE_LOG(LogWorld, Warning, TEXT("Failed to spawn test interactable %d."), Index);
			continue;
		}

		Interactable->InteractionTags.Reset();
		Interactable->InteractionTags.AddTag(Spec.Category());
		Interactable->ActionVerb = FText::FromString(Spec.Verb);
		Interactable->TargetName = FText::FromString(FString(Spec.Name).RightChop(FString(TEXT("GameProject_Test")).Len()));
		Interactable->bDestroyOnInteract = Spec.bDestroyOnInteract;
		Interactable->OpenAngle = Spec.bDestroyOnInteract ? 0.0f : 90.0f;

		SpawnedActors.Add(Interactable);
	}

	UE_LOG(LogWorld, Log, TEXT("Spawned %d test interactable(s)."), TestInteractableCount);
}
