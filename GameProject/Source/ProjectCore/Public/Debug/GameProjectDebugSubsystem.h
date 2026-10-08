// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "Debug/GameProjectDebugTypes.h"
#include "GameProjectDebugSubsystem.generated.h"

/**
 * Non-dynamic on purpose: C++ systems append their debug section directly, with
 * no UObject and no reflection cost, and there is exactly one text block on
 * screen no matter how many systems are running.
 */
DECLARE_MULTICAST_DELEGATE_TwoParams(FGameProjectDebugTextProvider, const UObject* /*WorldContext*/, FString& /*OutText*/);

/**
 * Central on/off switch for every debug visualisation in the project.
 *
 * The class always exists so call sites never need #ifdefs, but every method is a
 * no-op in Shipping and Test builds (see the .cpp). That satisfies "debug
 * features must be disabled in shipping builds" without scattering preprocessor
 * conditionals through gameplay code.
 */
UCLASS()
class PROJECTCORE_API UGameProjectDebugSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	//~ Begin USubsystem
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	//~ End USubsystem

	static UGameProjectDebugSubsystem* Get(const UObject* WorldContextObject);

	// ------------------------------------------------------------- channels
	UFUNCTION(BlueprintPure, Category = "GameProject|Debug")
	bool IsChannelEnabled(EGameProjectDebugChannel Channel) const;

	UFUNCTION(BlueprintCallable, Category = "GameProject|Debug")
	void SetChannelEnabled(EGameProjectDebugChannel Channel, bool bEnabled);

	UFUNCTION(BlueprintCallable, Category = "GameProject|Debug")
	void ToggleChannel(EGameProjectDebugChannel Channel);

	UFUNCTION(BlueprintCallable, Category = "GameProject|Debug")
	void EnableAllChannels();

	UFUNCTION(BlueprintCallable, Category = "GameProject|Debug")
	void DisableAllChannels();

	UFUNCTION(BlueprintPure, Category = "GameProject|Debug")
	int32 GetEnabledChannelMask() const { return EnabledChannels; }

	/** Human-readable list of active channels, for the HUD and for bug reports. */
	UFUNCTION(BlueprintPure, Category = "GameProject|Debug")
	FString GetEnabledChannelsText() const;

	// ------------------------------------------------------------- engine views
	/** stat fps / stat unit. */
	UFUNCTION(BlueprintCallable, Category = "GameProject|Debug")
	void SetFPSDisplayEnabled(bool bEnabled);

	/** Engine collision rendering (show Collision). */
	UFUNCTION(BlueprintCallable, Category = "GameProject|Debug")
	void SetCollisionVisualisationEnabled(bool bEnabled);

	/** Convenience: dumps a snapshot of debug state to the log. */
	UFUNCTION(BlueprintCallable, Category = "GameProject|Debug")
	void DumpDebugStateToLog() const;

	// ------------------------------------------------------------- text providers
	/**
	 * Systems add a section of debug text here instead of drawing it themselves,
	 * so there is exactly one on-screen text block and one refresh cost.
	 * Handle-based: unregister with the returned handle.
	 */
	FDelegateHandle RegisterDebugTextProvider(FGameProjectDebugTextProvider::FDelegate Provider);
	void UnregisterDebugTextProvider(FDelegateHandle Handle);

	/** Builds the full multi-line debug text for the current world. */
	FString BuildDebugText(const UObject* WorldContext) const;

	/** One-shot on-screen line, keyed so callers can overwrite their own message. */
	void AddOnScreenMessage(const UObject* WorldContext, int32 Key, const FString& Message, float DurationSeconds = 0.0f, FColor Color = FColor::Cyan);

protected:
	FGameProjectDebugTextProvider TextProviders;

	/** Bitmask of EGameProjectDebugChannel. */
	int32 EnabledChannels = 0;

	bool bFPSEnabled = false;
	bool bCollisionVisEnabled = false;

	/** Applies the Project Settings startup flags once, at initialisation. */
	void ApplyStartupSettings();

	/** Runs the engine console command behind a channel toggle. */
	void ExecuteConsoleCommand(const UObject* WorldContext, const TCHAR* Command) const;
};
