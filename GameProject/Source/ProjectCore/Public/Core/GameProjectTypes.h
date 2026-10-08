// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "GameplayTagContainer.h"
#include "GameProjectTypes.generated.h"

/**
 * Persistent identity of the local player. Lives on the GameInstance so it
 * survives level travel (which a streamed open world does constantly).
 */
USTRUCT(BlueprintType)
struct FGameProjectPlayerProfile
{
	GENERATED_BODY()

	/** Stable id used to key save slots, stats and (later) cloud profiles. */
	UPROPERTY(BlueprintReadOnly, SaveGame, Category = "Profile")
	FGuid ProfileId;

	UPROPERTY(BlueprintReadWrite, SaveGame, Category = "Profile")
	FString DisplayName = TEXT("Player");

	UPROPERTY(BlueprintReadOnly, SaveGame, Category = "Profile")
	FDateTime CreatedUtc = FDateTime::MinValue();

	UPROPERTY(BlueprintReadWrite, SaveGame, Category = "Profile")
	FDateTime LastPlayedUtc = FDateTime::MinValue();

	/** Accumulated play time for this session only; the save holds the lifetime total. */
	UPROPERTY(BlueprintReadOnly, Category = "Profile")
	double SessionPlayTimeSeconds = 0.0;

	bool IsValidProfile() const { return ProfileId.IsValid(); }

	void EnsureValid()
	{
		if (!ProfileId.IsValid())
		{
			ProfileId = FGuid::NewGuid();
			CreatedUtc = FDateTime::UtcNow();
		}
	}
};

/**
 * Non-persistent per-run state. Kept in one struct so new session data does not
 * mean new members (and new initialisation order bugs) on the GameInstance.
 */
USTRUCT(BlueprintType)
struct FGameProjectSessionState
{
	GENERATED_BODY()

	/** Save slot this session is bound to (-1 == untitled/no slot yet). */
	UPROPERTY(BlueprintReadOnly, Category = "Session")
	int32 ActiveSaveSlot = -1;

	UPROPERTY(BlueprintReadOnly, Category = "Session")
	bool bIsLoadingSave = false;

	UPROPERTY(BlueprintReadOnly, Category = "Session")
	bool bHasLoadedSaveThisSession = false;

	/** Set once the world services (voxel manager, test area) exist. */
	UPROPERTY(BlueprintReadOnly, Category = "Session")
	bool bWorldServicesReady = false;

	UPROPERTY(BlueprintReadOnly, Category = "Session")
	FDateTime SessionStartedUtc = FDateTime::UtcNow();
};

/** One named world flag. Missions/wanted/story state attach here later. */
USTRUCT(BlueprintType)
struct FGameProjectWorldFlag
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "WorldFlag")
	FGameplayTag Tag;

	UPROPERTY(BlueprintReadWrite, Category = "WorldFlag")
	int32 Value = 0;
};
