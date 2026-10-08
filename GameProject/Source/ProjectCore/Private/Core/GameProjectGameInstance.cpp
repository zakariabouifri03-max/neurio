// Copyright GameProject. All rights reserved. Original content only.

#include "Core/GameProjectGameInstance.h"

#include "Core/GameProjectLog.h"
#include "Core/GameProjectSettings.h"
#include "Save/GameProjectSaveSubsystem.h"
#include "Settings/GameProjectSettingsSubsystem.h"

UGameProjectGameInstance::UGameProjectGameInstance()
{
	SessionStartSeconds = FPlatformTime::Seconds();
}

void UGameProjectGameInstance::Init()
{
	Super::Init();

	PlayerProfile.EnsureValid();
	SessionState = FGameProjectSessionState();
	SessionState.SessionStartedUtc = FDateTime::UtcNow();

	// Settings must be applied before the first level renders, otherwise the player
	// sees one frame at the wrong resolution/quality.
	if (UGameProjectSettingsSubsystem* SettingsSubsystem = GetSubsystem<UGameProjectSettingsSubsystem>())
	{
		SettingsSubsystem->LoadAndApply();
	}

	if (UGameProjectSettings::Get().bEnableVerboseLogging)
	{
		LogGameCore.SetVerbosity(ELogVerbosity::Verbose);
		LogVoxel.SetVerbosity(ELogVerbosity::Verbose);
		LogWorld.SetVerbosity(ELogVerbosity::Verbose);
		LogPlayer.SetVerbosity(ELogVerbosity::Verbose);
		LogInteraction.SetVerbosity(ELogVerbosity::Verbose);
	}

	UE_LOG(LogGameCore, Log, TEXT("GameProject GameInstance initialised. Profile=%s"), *PlayerProfile.ProfileId.ToString(EGuidFormats::Digits));
	OnSessionStarted.Broadcast(SessionState);
}

void UGameProjectGameInstance::Shutdown()
{
	PlayerProfile.SessionPlayTimeSeconds = FPlatformTime::Seconds() - SessionStartSeconds;
	UE_LOG(LogGameCore, Log, TEXT("GameProject GameInstance shutting down after %.1fs."), PlayerProfile.SessionPlayTimeSeconds);

	Super::Shutdown();
}

void UGameProjectGameInstance::ReturnToMainMenu()
{
	// Phase 01 has no menu map; persist before travelling so nothing is lost.
	SaveGame(SessionState.ActiveSaveSlot);
	Super::ReturnToMainMenu();
}

void UGameProjectGameInstance::SetPlayerDisplayName(const FString& NewDisplayName)
{
	PlayerProfile.DisplayName = NewDisplayName.Left(32);
	PlayerProfile.LastPlayedUtc = FDateTime::UtcNow();
}

void UGameProjectGameInstance::NotifyWorldServicesReady(bool bReady)
{
	if (SessionState.bWorldServicesReady == bReady)
	{
		return;
	}

	SessionState.bWorldServicesReady = bReady;
	UE_LOG(LogGameCore, Verbose, TEXT("World services ready = %s"), bReady ? TEXT("true") : TEXT("false"));
}

bool UGameProjectGameInstance::SaveGame(int32 SaveSlot)
{
	UGameProjectSaveSubsystem* SaveSubsystem = GetSubsystem<UGameProjectSaveSubsystem>();
	return SaveSubsystem && SaveSubsystem->SaveToSlot(SaveSlot);
}

bool UGameProjectGameInstance::LoadGame(int32 SaveSlot)
{
	UGameProjectSaveSubsystem* SaveSubsystem = GetSubsystem<UGameProjectSaveSubsystem>();
	if (!SaveSubsystem)
	{
		return false;
	}

	SessionState.bIsLoadingSave = true;
	const bool bLoaded = SaveSubsystem->LoadFromSlot(SaveSlot);
	SessionState.bIsLoadingSave = false;
	SessionState.bHasLoadedSaveThisSession = bLoaded;

	if (bLoaded)
	{
		SessionState.ActiveSaveSlot = SaveSlot;
		OnSaveSlotLoaded.Broadcast(SaveSlot);
	}
	return bLoaded;
}

bool UGameProjectGameInstance::DoesSaveGameExist(int32 SaveSlot) const
{
	const UGameProjectSaveSubsystem* SaveSubsystem = GetSubsystem<UGameProjectSaveSubsystem>();
	return SaveSubsystem && SaveSubsystem->DoesSlotExist(SaveSlot);
}

void UGameProjectGameInstance::ApplyProfileFromSave(const FGameProjectPlayerProfile& LoadedProfile)
{
	PlayerProfile = LoadedProfile;
	PlayerProfile.EnsureValid();
	PlayerProfile.LastPlayedUtc = FDateTime::UtcNow();
}
