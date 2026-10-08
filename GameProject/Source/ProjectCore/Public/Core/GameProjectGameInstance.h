// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "Engine/GameInstance.h"
#include "Core/GameProjectTypes.h"
#include "GameProjectGameInstance.generated.h"

class UGameProjectSaveSubsystem;
class UGameProjectSettingsSubsystem;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnGameProjectSaveSlotLoaded, int32, SaveSlot);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnGameProjectSessionStarted, const FGameProjectSessionState&, SessionState);

/**
 * Root coordinator for everything that must outlive a single level.
 *
 * Deliberately thin. Each responsibility lives in a UGameInstanceSubsystem
 * (save, settings, debug) so that adding NPCs, missions, vehicles or an economy
 * later means *adding a subsystem* - not editing this class. Subsystems are
 * created/destroyed by the engine around Init/Shutdown and are reachable from
 * anywhere through their own static Get() helpers.
 */
UCLASS()
class PROJECTCORE_API UGameProjectGameInstance : public UGameInstance
{
	GENERATED_BODY()

public:
	UGameProjectGameInstance();

	//~ Begin UGameInstance
	virtual void Init() override;
	virtual void Shutdown() override;
	virtual void ReturnToMainMenu() override;
	//~ End UGameInstance

	/** Profile of the local player. Valid for the whole lifetime of the process. */
	UFUNCTION(BlueprintPure, Category = "GameProject|Profile")
	const FGameProjectPlayerProfile& GetPlayerProfile() const { return PlayerProfile; }

	UFUNCTION(BlueprintCallable, Category = "GameProject|Profile")
	void SetPlayerDisplayName(const FString& NewDisplayName);

	UFUNCTION(BlueprintPure, Category = "GameProject|Session")
	const FGameProjectSessionState& GetSessionState() const { return SessionState; }

	UFUNCTION(BlueprintPure, Category = "GameProject|Session")
	int32 GetActiveSaveSlot() const { return SessionState.ActiveSaveSlot; }

	/** Called by the game mode once world services (voxel manager, test area) exist. */
	UFUNCTION(BlueprintCallable, Category = "GameProject|Session")
	void NotifyWorldServicesReady(bool bReady);

	/**
	 * Convenience wrappers. Real work is in UGameProjectSaveSubsystem; these exist
	 * so Blueprint and game-code call sites stay short and stable.
	 */
	UFUNCTION(BlueprintCallable, Category = "GameProject|Save")
	bool SaveGame(int32 SaveSlot);

	UFUNCTION(BlueprintCallable, Category = "GameProject|Save")
	bool LoadGame(int32 SaveSlot);

	UFUNCTION(BlueprintPure, Category = "GameProject|Save")
	bool DoesSaveGameExist(int32 SaveSlot) const;

	/** Broadcast after a save slot has been applied to the running world. */
	UPROPERTY(BlueprintAssignable, Category = "GameProject|Save")
	FOnGameProjectSaveSlotLoaded OnSaveSlotLoaded;

	UPROPERTY(BlueprintAssignable, Category = "GameProject|Session")
	FOnGameProjectSessionStarted OnSessionStarted;

private:
	/** Applies a loaded profile onto the running instance and stamps session time. */
	void ApplyProfileFromSave(const FGameProjectPlayerProfile& LoadedProfile);

	friend class UGameProjectSaveSubsystem;

	UPROPERTY(Transient)
	FGameProjectPlayerProfile PlayerProfile;

	UPROPERTY(Transient)
	FGameProjectSessionState SessionState;

	/** Cached at Init so Shutdown does not need a world. */
	double SessionStartSeconds = 0.0;
};
