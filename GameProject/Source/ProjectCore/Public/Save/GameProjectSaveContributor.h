// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "UObject/Interface.h"
#include "GameProjectSaveContributor.generated.h"

class USaveGameProject;

UINTERFACE(BlueprintType, meta = (DisplayName = "GameProject Save Contributor"))
class UGameProjectSaveContributor : public UInterface
{
	GENERATED_BODY()
};

/**
 * Implemented by any system that has something to persist.
 *
 * This is the single most important piece of save-system scalability in the
 * project. UGameProjectSaveSubsystem knows nothing about missions, vehicles,
 * voxels or the economy: it walks its contributor list and asks each one to
 * write into / read out of the save object. Phase 03+ therefore adds persistence
 * by implementing this interface - never by editing the save subsystem.
 *
 * Ordering is explicit (SavePriority) because "world state before player state"
 * style dependencies will appear as soon as missions can move objects.
 */
class PROJECTCORE_API IGameProjectSaveContributor
{
	GENERATED_BODY()

public:
	/** Unique key for this contributor's section. Must be stable across builds. */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Save")
	FName GetSaveContributorId() const;

	/** Lower runs first. */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Save")
	int32 GetSavePriority() const;
	virtual int32 GetSavePriority_Implementation() const { return 100; }

	/** Write this system's state into the save object. */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Save")
	void WriteSaveData(USaveGameProject& SaveGame) const;

	/** Read this system's state back out. Called after the save object is loaded. */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Save")
	void ReadSaveData(const USaveGameProject& SaveGame);

	/** True when this contributor currently has anything worth writing. */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Save")
	bool HasSaveData() const;
	virtual bool HasSaveData_Implementation() const { return true; }
};
