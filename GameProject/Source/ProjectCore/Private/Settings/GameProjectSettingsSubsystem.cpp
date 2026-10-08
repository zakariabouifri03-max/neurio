// Copyright GameProject. All rights reserved. Original content only.

#include "Settings/GameProjectSettingsSubsystem.h"

#include "Core/GameProjectBlueprintLibrary.h"
#include "Core/GameProjectLog.h"
#include "Engine/Engine.h"
#include "Engine/GameInstance.h"
#include "Engine/World.h"
#include "GameFramework/GameUserSettings.h"
#include "Kismet/GameplayStatics.h"
#include "Save/GameProjectSaveSubsystem.h"
#include "Sound/SoundClass.h"
#include "Sound/SoundMix.h"

const TCHAR* UGameProjectSettingsSubsystem::SettingsSlotName = TEXT("GameProjectSettings");

void UGameProjectSettingsSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	CurrentSettings = FGameProjectUserSettings();
}

void UGameProjectSettingsSubsystem::Deinitialize()
{
	PersistSettings();
	Super::Deinitialize();
}

UGameProjectSettingsSubsystem* UGameProjectSettingsSubsystem::Get(const UObject* WorldContextObject)
{
	if (!WorldContextObject || !GEngine)
	{
		return nullptr;
	}

	const UWorld* World = GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull);
	const UGameInstance* GameInstance = World ? World->GetGameInstance() : nullptr;
	return GameInstance ? GameInstance->GetSubsystem<UGameProjectSettingsSubsystem>() : nullptr;
}

void UGameProjectSettingsSubsystem::LoadAndApply()
{
	bIsApplying = true;

	// Order matters: the standalone settings slot is the authority for options, but
	// a loaded game save may carry a newer copy (the player changed options in-game
	// and then saved). UGameProjectSaveSubsystem resolves that ordering for us.
	if (UGameInstance* GameInstance = GetGameInstance())
	{
		if (UGameProjectSaveSubsystem* SaveSubsystem = GameInstance->GetSubsystem<UGameProjectSaveSubsystem>())
		{
			FGameProjectUserSettings Loaded;
			if (SaveSubsystem->TryLoadSettingsFromSlot(SettingsSlotName, Loaded))
			{
				CurrentSettings = Loaded;
				UE_LOG(LogGameProjectSettings, Log, TEXT("Loaded persisted user settings (version %d)."), Loaded.SettingsVersion);
			}
		}
	}

	ApplyGraphicsSettings();
	ApplyAudioSettings();

	bIsApplying = false;
	BroadcastChanged();
}

bool UGameProjectSettingsSubsystem::PersistSettings()
{
	UGameInstance* GameInstance = GetGameInstance();
	if (!GameInstance)
	{
		return false;
	}

	UGameProjectSaveSubsystem* SaveSubsystem = GameInstance->GetSubsystem<UGameProjectSaveSubsystem>();
	if (!SaveSubsystem)
	{
		return false;
	}

	return SaveSubsystem->SaveSettingsToSlot(SettingsSlotName, CurrentSettings);
}

void UGameProjectSettingsSubsystem::SetSettings(const FGameProjectUserSettings& NewSettings)
{
	CurrentSettings = NewSettings;
	ApplyGraphicsSettings();
	ApplyAudioSettings();
	BroadcastChanged();
}

void UGameProjectSettingsSubsystem::SetOverallQuality(int32 QualityLevel)
{
	CurrentSettings.Graphics.OverallQuality = QualityLevel;
	ApplyGraphicsSettings();
	BroadcastChanged();
}

void UGameProjectSettingsSubsystem::SetResolution(FIntPoint NewResolution, int32 InWindowMode)
{
	CurrentSettings.Graphics.Resolution = NewResolution;
	CurrentSettings.Graphics.WindowMode = FMath::Clamp(InWindowMode, 0, 2);
	ApplyGraphicsSettings();
	BroadcastChanged();
}

void UGameProjectSettingsSubsystem::SetVSync(bool bEnabled)
{
	CurrentSettings.Graphics.bVSync = bEnabled;
	ApplyGraphicsSettings();
	BroadcastChanged();
}

void UGameProjectSettingsSubsystem::SetFrameRateLimit(float Limit)
{
	CurrentSettings.Graphics.FrameRateLimit = FMath::Max(0.0f, Limit);
	ApplyGraphicsSettings();
	BroadcastChanged();
}

void UGameProjectSettingsSubsystem::SetMasterVolume(float Volume01)
{
	CurrentSettings.Audio.MasterVolume = FMath::Clamp(Volume01, 0.0f, 1.0f);
	ApplyAudioSettings();
	BroadcastChanged();
}

void UGameProjectSettingsSubsystem::SetMouseSensitivity(float Sensitivity)
{
	CurrentSettings.Input.MouseSensitivity = FMath::Clamp(Sensitivity, 0.05f, 5.0f);
	BroadcastChanged();
}

float UGameProjectSettingsSubsystem::GetLookSensitivityScale() const
{
	// One multiply instead of a branch per axis; inversion is folded in so callers
	// never have to remember to apply it.
	const float Base = CurrentSettings.Input.MouseSensitivity * CurrentSettings.Input.CameraSensitivity;
	return CurrentSettings.Input.bInvertLookY ? -Base : Base;
}

void UGameProjectSettingsSubsystem::ApplyGraphicsSettings()
{
	UGameUserSettings* UserSettings = GEngine ? GEngine->GetGameUserSettings() : nullptr;
	if (!UserSettings)
	{
		return;
	}

	const FGameProjectGraphicsSettings& Graphics = CurrentSettings.Graphics;

	if (Graphics.OverallQuality >= 0)
	{
		UserSettings->SetOverallScalabilityLevel(Graphics.OverallQuality);
	}
	if (Graphics.ViewDistanceQuality >= 0)
	{
		UserSettings->SetViewDistanceQuality(Graphics.ViewDistanceQuality);
	}
	if (Graphics.ShadowQuality >= 0)
	{
		UserSettings->SetShadowQuality(Graphics.ShadowQuality);
	}

	if (!Graphics.Resolution.IsZero())
	{
		UserSettings->SetScreenResolution(Graphics.Resolution);
	}

	UserSettings->SetFullscreenMode(static_cast<EWindowMode::Type>(FMath::Clamp(Graphics.WindowMode, 0, 2)));
	UserSettings->SetVSyncEnabled(Graphics.bVSync);

	if (Graphics.FrameRateLimit > 0.0f)
	{
		UserSettings->SetFrameRateLimit(Graphics.FrameRateLimit);
	}
	else
	{
		// 0 means "uncapped": honour whatever t.MaxFPS is set to instead of forcing
		// a value the platform may not like.
		UserSettings->SetFrameRateLimit(0.0f);
	}

	// bCheckForCommandLineOverrides=false so a -ResX command line still wins in a
	// development build, which is what testers expect.
	UserSettings->ApplySettings(/*bCheckForCommandLineOverrides*/ false);

	UE_LOG(LogGameProjectSettings, Log, TEXT("Applied graphics settings (quality=%d, %dx%d, windowMode=%d, vsync=%s)."),
		Graphics.OverallQuality, Graphics.Resolution.X, Graphics.Resolution.Y, Graphics.WindowMode,
		Graphics.bVSync ? TEXT("on") : TEXT("off"));
}

void UGameProjectSettingsSubsystem::ApplyAudioSettings()
{
	USoundMix* SoundMix = UGameProjectBlueprintLibrary::ResolveSoftObject(MasterSoundMix, TEXT("master sound mix"));
	USoundClass* SoundClass = UGameProjectBlueprintLibrary::ResolveSoftObject(MasterSoundClass, TEXT("master sound class"));

	if (!SoundMix || !SoundClass)
	{
		// No audio assets authored yet. Store the value, apply nothing, log once.
		static bool bLoggedMissingAudio = false;
		if (!bLoggedMissingAudio)
		{
			bLoggedMissingAudio = true;
			UE_LOG(LogGameProjectSettings, Verbose,
				TEXT("Master volume stored but not applied: assign MasterSoundMix/MasterSoundClass to enable audio settings."));
		}
		return;
	}

	UGameplayStatics::SetSoundMixClassOverride(GetGameInstance(), SoundMix, SoundClass, CurrentSettings.Audio.MasterVolume, 1.0f, 0.0f, /*bApplyToChildren*/ true);
}

void UGameProjectSettingsSubsystem::BroadcastChanged()
{
	if (!bIsApplying)
	{
		PersistSettings();
	}
	OnSettingsChanged.Broadcast(CurrentSettings);
}
