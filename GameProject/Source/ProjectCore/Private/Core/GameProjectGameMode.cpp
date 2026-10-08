// Copyright GameProject. All rights reserved. Original content only.

#include "Core/GameProjectGameMode.h"

#include "Core/GameProjectBlueprintLibrary.h"
#include "Core/GameProjectGameInstance.h"
#include "Core/GameProjectGameState.h"
#include "Core/GameProjectLog.h"
#include "Core/GameProjectSettings.h"
#include "EngineUtils.h"
#include "GameFramework/GameStateBase.h"
#include "Player/OpenWorldPlayerCharacter.h"
#include "Player/OpenWorldPlayerController.h"
#include "Player/OpenWorldPlayerState.h"
#include "Voxel/VoxelWorldManager.h"
#include "World/OpenWorldTestAreaBuilder.h"

AGameProjectGameMode::AGameProjectGameMode()
{
	// C++ defaults so the project is playable with zero authored assets. A Blueprint
	// child (BP_GameProjectGameMode) can override any of these without touching code.
	DefaultPawnClass = AOpenWorldPlayerCharacter::StaticClass();
	PlayerControllerClass = AOpenWorldPlayerController::StaticClass();
	GameStateClass = AGameProjectGameState::StaticClass();
	PlayerStateClass = AOpenWorldPlayerState::StaticClass();
	HUDClass = nullptr; // The HUD is a UMG widget managed by the player controller.
	SpectatorClass = nullptr;

	PrimaryActorTick.bCanEverTick = false;
	bUseSeamlessTravel = false;
}

void AGameProjectGameMode::InitGame(const FString& MapName, const FString& Options, FString& ErrorMessage)
{
	Super::InitGame(MapName, Options, ErrorMessage);

	UE_LOG(LogGameCore, Log, TEXT("InitGame map='%s' options='%s'"), *MapName, *Options);
}

void AGameProjectGameMode::BeginPlay()
{
	Super::BeginPlay();

	if (bAutoCreateWorldServices)
	{
		EnsureWorldServices();
	}
}

AActor* AGameProjectGameMode::ChoosePlayerStart_Implementation(AController* Player)
{
	AActor* PlayerStart = Super::ChoosePlayerStart_Implementation(Player);

	// An empty/PIE level frequently has no PlayerStart at all. Falling back to the
	// origin keeps "open the project and press Play" working instead of spawning
	// the pawn in the void and triggering a fall-out-of-world recovery.
	if (!PlayerStart)
	{
		UE_LOG(LogGameCore, Verbose, TEXT("No PlayerStart found; spawning at world origin."));
	}
	return PlayerStart;
}

AOpenWorldTestAreaBuilder* AGameProjectGameMode::EnsureTestAreaBuilder()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return nullptr;
	}

	if (!TestAreaBuilder)
	{
		for (TActorIterator<AOpenWorldTestAreaBuilder> It(World); It; ++It)
		{
			TestAreaBuilder = *It;
			break;
		}
	}

	if (!TestAreaBuilder)
	{
		const UGameProjectSettings& Settings = UGameProjectSettings::Get();
		TSubclassOf<AOpenWorldTestAreaBuilder> BuilderClass = Settings.DefaultTestWorldBuilderClass.LoadSynchronous();
		if (!BuilderClass)
		{
			BuilderClass = AOpenWorldTestAreaBuilder::StaticClass();
		}

		FActorSpawnParameters SpawnParams;
		SpawnParams.ObjectFlags |= RF_Transient;
		SpawnParams.Name = TEXT("GameProjectTestAreaBuilder");
		TestAreaBuilder = World->SpawnActor<AOpenWorldTestAreaBuilder>(BuilderClass, FTransform::Identity, SpawnParams);

		UE_LOG(LogWorld, Log, TEXT("Spawned test area builder (%s)."),
			TestAreaBuilder ? *TestAreaBuilder->GetClass()->GetName() : TEXT("failed"));
	}

	return TestAreaBuilder;
}

AVoxelWorldManager* AGameProjectGameMode::EnsureVoxelWorldManager()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return nullptr;
	}

	if (!VoxelWorldManager)
	{
		for (TActorIterator<AVoxelWorldManager> It(World); It; ++It)
		{
			VoxelWorldManager = *It;
			break;
		}
	}

	if (!VoxelWorldManager)
	{
		const UGameProjectSettings& Settings = UGameProjectSettings::Get();
		TSubclassOf<AVoxelWorldManager> ManagerClass = Settings.VoxelWorldManagerClass.LoadSynchronous();
		if (!ManagerClass)
		{
			ManagerClass = AVoxelWorldManager::StaticClass();
		}

		FActorSpawnParameters SpawnParams;
		SpawnParams.ObjectFlags |= RF_Transient;
		SpawnParams.Name = TEXT("GameProjectVoxelWorldManager");
		VoxelWorldManager = World->SpawnActor<AVoxelWorldManager>(ManagerClass, FTransform::Identity, SpawnParams);

		UE_LOG(LogVoxel, Log, TEXT("Spawned voxel world manager (%s)."),
			VoxelWorldManager ? *VoxelWorldManager->GetClass()->GetName() : TEXT("failed"));
	}

	return VoxelWorldManager;
}

void AGameProjectGameMode::EnsureWorldServices()
{
	if (bWorldServicesCreated)
	{
		return;
	}
	bWorldServicesCreated = true;

	// Order matters: the test area builder places the voxel manager's content and
	// needs the manager to exist first.
	AVoxelWorldManager* Manager = EnsureVoxelWorldManager();
	AOpenWorldTestAreaBuilder* Builder = EnsureTestAreaBuilder();

	if (UGameProjectGameInstance* GameInstance = Cast<UGameProjectGameInstance>(GetGameInstance()))
	{
		GameInstance->NotifyWorldServicesReady(Manager != nullptr);
	}

	UE_LOG(LogGameCore, Log, TEXT("World services ready (VoxelManager=%s, TestArea=%s)."),
		Manager ? TEXT("yes") : TEXT("no"), Builder ? TEXT("yes") : TEXT("no"));
}
