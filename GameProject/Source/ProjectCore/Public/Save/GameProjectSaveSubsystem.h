// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "Settings/GameProjectSettingsTypes.h"
#include "GameProjectSaveSubsystem.generated.h"

class USaveGameProject;
class UObject;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnGameProjectSaveFinished, int32, SaveSlot, bool, bSuccess);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnGameProjectLoadFinished, int32, SaveSlot, bool, bSuccess);

/**
 * Save/load orchestration.
 *
 * Two rules keep this class from rotting as the game grows:
 *  1. It never knows what is inside a save. Systems implement
 *     IGameProjectSaveContributor and write their own sections.
 *  2. It never blocks the game thread on disk. Writes go through the engine's
 *     async save path; the synchronous path exists only for shutdown and tests.
 */
UCLASS()
class PROJECTCORE_API UGameProjectSaveSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	//~ Begin USubsystem
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;
	//~ End USubsystem

	static UGameProjectSaveSubsystem* Get(const UObject* WorldContextObject);

	// ------------------------------------------------------------- slots
	/** Slot name for a numbered game save. */
	UFUNCTION(BlueprintPure, Category = "GameProject|Save")
	static FString GetSlotNameForIndex(int32 SaveSlot);

	UFUNCTION(BlueprintPure, Category = "GameProject|Save")
	bool DoesSlotExist(int32 SaveSlot) const;

	UFUNCTION(BlueprintPure, Category = "GameProject|Save")
	bool DoesNamedSlotExist(const FString& SlotName) const;

	// ------------------------------------------------------------- save / load
	/** Asynchronous by default; blocks only when bForceSynchronous is set. */
	UFUNCTION(BlueprintCallable, Category = "GameProject|Save")
	bool SaveToSlot(int32 SaveSlot, bool bForceSynchronous = false);

	UFUNCTION(BlueprintCallable, Category = "GameProject|Save")
	bool LoadFromSlot(int32 SaveSlot);

	UFUNCTION(BlueprintCallable, Category = "GameProject|Save")
	bool DeleteSlot(int32 SaveSlot);

	/** Writes the current in-memory save object without collecting new data. */
	UFUNCTION(BlueprintCallable, Category = "GameProject|Save")
	bool SaveNamedSlot(const FString& SlotName, bool bForceSynchronous = false);

	/** The last collected save object. Valid between Collect and Apply. */
	UFUNCTION(BlueprintPure, Category = "GameProject|Save")
	USaveGameProject* GetCurrentSaveGame() const { return CurrentSaveGame; }

	// ------------------------------------------------------------- settings slot
	/** Settings live in their own slot so options survive a new game. */
	bool SaveSettingsToSlot(const TCHAR* SlotName, const FGameProjectUserSettings& Settings);
	bool TryLoadSettingsFromSlot(const TCHAR* SlotName, FGameProjectUserSettings& OutSettings) const;

	// ------------------------------------------------------------- contributors
	/**
	 * Registers a system that has state to persist. Callers must unregister (or be
	 * destroyed) - the subsystem holds weak references, so a dead contributor is
	 * skipped instead of dangling.
	 */
	UFUNCTION(BlueprintCallable, Category = "GameProject|Save")
	void RegisterContributor(UObject* Contributor);

	UFUNCTION(BlueprintCallable, Category = "GameProject|Save")
	void UnregisterContributor(UObject* Contributor);

	/** Collects from every live contributor into CurrentSaveGame. */
	UFUNCTION(BlueprintCallable, Category = "GameProject|Save")
	void CollectSaveData();

	/** Pushes CurrentSaveGame out to every live contributor. */
	UFUNCTION(BlueprintCallable, Category = "GameProject|Save")
	void ApplySaveData();

	UPROPERTY(BlueprintAssignable, Category = "GameProject|Save")
	FOnGameProjectSaveFinished OnSaveFinished;

	UPROPERTY(BlueprintAssignable, Category = "GameProject|Save")
	FOnGameProjectLoadFinished OnLoadFinished;

	/** True between the start of a load and ApplySaveData completing. */
	UFUNCTION(BlueprintPure, Category = "GameProject|Save")
	bool IsLoading() const { return bIsLoading; }

protected:
	/** Re-sorts the contributor list by IGameProjectSaveContributor::GetSavePriority. */
	void RebuildSortedContributors();

	UPROPERTY(Transient)
	TObjectPtr<USaveGameProject> CurrentSaveGame;

	UPROPERTY(Transient)
	TArray<TWeakObjectPtr<UObject>> Contributors;

	/** Cached sort order so Collect/Apply never re-sort on the hot path. */
	TArray<TWeakObjectPtr<UObject>> SortedContributors;

	bool bContributorsDirty = false;
	bool bIsLoading = false;
	int32 PendingSaveSlot = -1;
	int32 PendingLoadSlot = -1;
};
