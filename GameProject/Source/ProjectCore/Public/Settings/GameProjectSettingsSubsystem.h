// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "Settings/GameProjectSettingsTypes.h"
#include "GameProjectSettingsSubsystem.generated.h"

class USoundMix;
class USoundClass;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnGameProjectSettingsChanged, const FGameProjectUserSettings&, Settings);

/**
 * Owns the player's options and is the only place that talks to
 * UGameUserSettings / the audio device.
 *
 * Separated from UGameProjectSettings (which is *project* config, shipped in the
 * ini) on purpose: one is authored by developers, the other by players, and they
 * have completely different lifetimes and persistence rules.
 */
UCLASS()
class PROJECTCORE_API UGameProjectSettingsSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	/** Slot name used for the standalone settings file (independent of game saves). */
	static const TCHAR* SettingsSlotName;

	//~ Begin USubsystem
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;
	//~ End USubsystem

	/** Convenience accessor from anywhere with a world context. */
	static UGameProjectSettingsSubsystem* Get(const UObject* WorldContextObject);

	/** Loads persisted settings (settings slot, then active game save) and applies them. */
	UFUNCTION(BlueprintCallable, Category = "GameProject|Settings")
	void LoadAndApply();

	/** Writes settings to the standalone slot. Called on change and on shutdown. */
	UFUNCTION(BlueprintCallable, Category = "GameProject|Settings")
	bool PersistSettings();

	UFUNCTION(BlueprintPure, Category = "GameProject|Settings")
	const FGameProjectUserSettings& GetSettings() const { return CurrentSettings; }

	UFUNCTION(BlueprintCallable, Category = "GameProject|Settings")
	void SetSettings(const FGameProjectUserSettings& NewSettings);

	// ------------------------------------------------------------- graphics
	UFUNCTION(BlueprintCallable, Category = "GameProject|Settings|Graphics")
	void SetOverallQuality(int32 QualityLevel);

	UFUNCTION(BlueprintCallable, Category = "GameProject|Settings|Graphics")
	void SetResolution(FIntPoint NewResolution, int32 InWindowMode);

	UFUNCTION(BlueprintCallable, Category = "GameProject|Settings|Graphics")
	void SetVSync(bool bEnabled);

	UFUNCTION(BlueprintCallable, Category = "GameProject|Settings|Graphics")
	void SetFrameRateLimit(float Limit);

	// ------------------------------------------------------------- audio
	UFUNCTION(BlueprintCallable, Category = "GameProject|Settings|Audio")
	void SetMasterVolume(float Volume01);

	// ------------------------------------------------------------- input
	/** Read by the player controller every look event. Cheap: no lookup, no allocation. */
	UFUNCTION(BlueprintPure, Category = "GameProject|Settings|Input")
	float GetMouseSensitivity() const { return CurrentSettings.Input.MouseSensitivity; }

	UFUNCTION(BlueprintPure, Category = "GameProject|Settings|Input")
	float GetCameraSensitivity() const { return CurrentSettings.Input.CameraSensitivity; }

	UFUNCTION(BlueprintPure, Category = "GameProject|Settings|Input")
	float GetLookSensitivityScale() const;

	UFUNCTION(BlueprintPure, Category = "GameProject|Settings|Input")
	bool IsLookYInverted() const { return CurrentSettings.Input.bInvertLookY; }

	UFUNCTION(BlueprintCallable, Category = "GameProject|Settings|Input")
	void SetMouseSensitivity(float Sensitivity);

	/** Fired after any change has been applied, so the UI can refresh in one place. */
	UPROPERTY(BlueprintAssignable, Category = "GameProject|Settings")
	FOnGameProjectSettingsChanged OnSettingsChanged;

	/**
	 * Optional sound mix/class used to implement master volume. When unset, volume
	 * changes are stored but not applied - Phase 01 ships no audio assets, and a
	 * missing-asset error every startup would be worse than doing nothing.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "GameProject|Settings|Audio")
	TSoftObjectPtr<USoundMix> MasterSoundMix;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "GameProject|Settings|Audio")
	TSoftObjectPtr<USoundClass> MasterSoundClass;

protected:
	void ApplyGraphicsSettings();
	void ApplyAudioSettings();
	void BroadcastChanged();

	UPROPERTY(Transient)
	FGameProjectUserSettings CurrentSettings;

	bool bIsApplying = false;
};
