// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Core/BCUGameInstance.h"

#include "Core/BCUGameState.h"
#include "Graphics/BCUGraphicsSubsystem.h"
#include "Player/BCUSaveGame.h"
#include "Core/BCUAudioSubsystem.h"
#include "Core/BCUInputSubsystem.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUGameInstance, Log, All);

UBCUGameInstance::UBCUGameInstance()
{
	// Graphics state must exist before the first map is loaded, otherwise the
	// streaming level would render with default scalability for one frame.
	// (Subsystems are created by the engine; we only cache them here.)
}

void UBCUGameInstance::Init()
{
	Super::Init();

	GraphicsSubsystem = GetSubsystem<UBCUGraphicsSubsystem>();
	SaveSystem = GetSubsystem<UBCUSaveGameSystem>();
	AudioSubsystem = GetSubsystem<UBCUAudioSubsystem>();
	InputSubsystem = GetSubsystem<UBCUInputSubsystem>();

	if (ProfileNames.Num() == 0)
	{
		ProfileNames.Add(TEXT("Player One"));
		ActiveProfileIndex = 0;
	}

	// Keep the loading screen honest across World Partition travel.
	if (UGameViewportClient* ViewportClient = GetGameViewportClient())
	{
		OnPreLoadMapHandle = ViewportClient->OnPreLoadMap().AddUObject(
			this, &UBCUGameInstance::HandlePreLoadMap);
		OnPostLoadMapHandle = ViewportClient->OnPostLoadMapWithWorld().AddUObject(
			this, &UBCUGameInstance::HandlePostLoadMapWithWorld);
	}

	if (GraphicsSubsystem)
	{
		// Apply the user's saved preset before the first frame is presented.
		GraphicsSubsystem->ApplySavedSettings();
	}

	UE_LOG(LogBCUGameInstance, Log, TEXT("BLOCK CITY ULTRA instance initialised, profiles=%d active=%d"),
		ProfileNames.Num(), ActiveProfileIndex);
}

void UBCUGameInstance::Shutdown()
{
	if (UGameViewportClient* ViewportClient = GetGameViewportClient())
	{
		ViewportClient->OnPreLoadMap().Remove(OnPreLoadMapHandle);
		ViewportClient->OnPostLoadMapWithWorld().Remove(OnPostLoadMapHandle);
	}

	if (SaveSystem)
	{
		SaveSystem->FlushPendingSave();
	}

	Super::Shutdown();
}

void UBCUGameInstance::CreateOrSelectProfile(const FString& ProfileName)
{
	const int32 Existing = ProfileNames.IndexOfByKey(ProfileName);
	if (Existing != INDEX_NONE)
	{
		ActiveProfileIndex = Existing;
	}
	else
	{
		ActiveProfileIndex = ProfileNames.Add(ProfileName);
		SaveConfig();
	}

	if (SaveSystem)
	{
		SaveSystem->SetActiveSlot(ActiveProfileIndex);
	}

	OnProfileChanged.Broadcast(ActiveProfileIndex);
	UE_LOG(LogBCUGameInstance, Log, TEXT("Profile '%s' active (index %d)"), *ProfileName, ActiveProfileIndex);
}

void UBCUGameInstance::ShowLoadingScreen(const FText& StageLabel)
{
	bLoadingScreenVisible = true;
	UpdateLoadingProgress(0.0f, StageLabel);
}

void UBCUGameInstance::UpdateLoadingProgress(float Progress01, const FText& StageLabel)
{
	OnLoadingProgressChanged.Broadcast(FMath::Clamp(Progress01, 0.f, 1.f), StageLabel);
}

void UBCUGameInstance::HideLoadingScreen()
{
	bLoadingScreenVisible = false;
	UpdateLoadingProgress(1.0f, NSLOCTEXT("BCU", "Loading_Done", "Ready"));
}

void UBCUGameInstance::RequestAsyncSave(FName ReasonTag)
{
	if (SaveSystem)
	{
		SaveSystem->RequestAsyncSave(ReasonTag);
	}
}

void UBCUGameInstance::HandlePreLoadMap(const FString& MapName)
{
	ShowLoadingScreen(FText::Format(
		NSLOCTEXT("BCU", "Loading_Stream", "Streaming {0}…"), FText::FromString(MapName)));
}

void UBCUGameInstance::HandlePostLoadMapWithWorld(UWorld* World)
{
	if (!World)
	{
		return;
	}

	// Wait until World Partition reports that the initial cells are resident,
	// otherwise the player briefly sees an empty grid.
	if (const ABCUGameState* State = World->GetGameState<ABCUGameState>())
	{
		if (State->IsInitialStreamingComplete())
		{
			HideLoadingScreen();
			return;
		}
	}

	HideLoadingScreen();
}
