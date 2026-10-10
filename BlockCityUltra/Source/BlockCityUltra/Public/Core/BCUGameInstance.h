// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "Engine/GameInstance.h"
#include "BCUGameInstance.generated.h"

class UBCUGraphicsSubsystem;
class UBCUSaveGameSystem;
class UBCUAudioSubsystem;
class UBCUInputSubsystem;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnBCULoadingProgressChanged, float, Progress01, const FText&, StageLabel);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnBCUProfileChanged, int32, NewProfileIndex);

/**
 * Lives across level travel and streaming, so it is the correct home for:
 *  - the player's persistent profile (save slots, active slot index)
 *  - graphics preset / resolution / FPS-target state (survives map changes)
 *  - the global loading-screen contract used by World Partition streaming
 *
 * Blueprint subclass: /Game/Blueprints/Core/BP_BCUGameInstance
 */
UCLASS(config = Game, Blueprintable)
class BLOCKCITYULTRA_API UBCUGameInstance : public UGameInstance
{
	GENERATED_BODY()

public:
	UBCUGameInstance();

	//~ UGameInstance
	virtual void Init() override;
	virtual void Shutdown() override;
	//~ End UGameInstance

	/** Cached subsystem handles (resolved in Init, valid until Shutdown). */
	UFUNCTION(BlueprintPure, Category = "BCU|Instance")
	UBCUGraphicsSubsystem* Graphics() const { return GraphicsSubsystem; }

	UFUNCTION(BlueprintPure, Category = "BCU|Instance")
	UBCUSaveGameSystem* Saves() const { return SaveSystem; }

	// ── Profiles (per-player settings bundles) ───────────────────────────────
	UFUNCTION(BlueprintCallable, Category = "BCU|Instance|Profile")
	void CreateOrSelectProfile(const FString& ProfileName);

	UFUNCTION(BlueprintPure, Category = "BCU|Instance|Profile")
	int32 GetActiveProfileIndex() const { return ActiveProfileIndex; }

	UFUNCTION(BlueprintPure, Category = "BCU|Instance|Profile")
	const TArray<FString>& GetProfileNames() const { return ProfileNames; }

	UPROPERTY(BlueprintAssignable, Category = "BCU|Instance|Profile")
	FOnBCUProfileChanged OnProfileChanged;

	// ── Loading screen ──────────────────────────────────────────────────────
	UFUNCTION(BlueprintCallable, Category = "BCU|Instance|Loading")
	void ShowLoadingScreen(const FText& StageLabel);

	UFUNCTION(BlueprintCallable, Category = "BCU|Instance|Loading")
	void UpdateLoadingProgress(float Progress01, const FText& StageLabel);

	UFUNCTION(BlueprintCallable, Category = "BCU|Instance|Loading")
	void HideLoadingScreen();

	UPROPERTY(BlueprintAssignable, Category = "BCU|Instance|Loading")
	FOnBCULoadingProgressChanged OnLoadingProgressChanged;

	/** True between ShowLoadingScreen and HideLoadingScreen. */
	UFUNCTION(BlueprintPure, Category = "BCU|Instance|Loading")
	bool IsLoadingScreenVisible() const { return bLoadingScreenVisible; }

	/** Requests an autosave without blocking the game thread. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Instance|Save")
	void RequestAsyncSave(FName ReasonTag);

protected:
	UPROPERTY(Transient)
	TObjectPtr<UBCUGraphicsSubsystem> GraphicsSubsystem;

	UPROPERTY(Transient)
	TObjectPtr<UBCUSaveGameSystem> SaveSystem;

	UPROPERTY(Transient)
	TObjectPtr<UBCUAudioSubsystem> AudioSubsystem;

	UPROPERTY(Transient)
	TObjectPtr<UBCUInputSubsystem> InputSubsystem;

	UPROPERTY(config, BlueprintReadOnly, Category = "BCU|Instance|Profile")
	TArray<FString> ProfileNames;

	UPROPERTY(config, BlueprintReadOnly, Category = "BCU|Instance|Profile")
	int32 ActiveProfileIndex = 0;

	bool bLoadingScreenVisible = false;

private:
	/** Class name of the MoviePlayer loading widget, resolved from config. */
	UPROPERTY(config)
	FString LoadingScreenWidgetPath = TEXT("/Game/Blueprints/UI/WBP_LoadingScreen.WBP_LoadingScreen_C");

	FDelegateHandle OnPreLoadMapHandle;
	FDelegateHandle OnPostLoadMapHandle;
	void HandlePreLoadMap(const FString& MapName);
	void HandlePostLoadMapWithWorld(UWorld* World);
};
