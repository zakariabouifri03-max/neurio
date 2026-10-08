// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "GameplayTagContainer.h"
#include "GameFramework/SaveGame.h"
#include "Core/GameProjectTypes.h"
#include "Settings/GameProjectSettingsTypes.h"
#include "SaveGameProject.generated.h"

/** One inventory entry. Generic on purpose: items are a later phase. */
USTRUCT(BlueprintType)
struct FGameProjectInventoryItem
{
	GENERATED_BODY()

	/** Item identifier - an asset primary id or a gameplay tag, decided by the item phase. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Inventory")
	FName ItemId = NAME_None;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Inventory", meta = (ClampMin = "0"))
	int32 Quantity = 0;

	/** Free-form per-instance data (durability, mods, tint...). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Inventory")
	TMap<FName, float> NumericAttributes;
};

/** A mission's persisted progress. */
USTRUCT(BlueprintType)
struct FGameProjectMissionRecord
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Mission")
	FName MissionId = NAME_None;

	/** 0 = not started, 1 = active, 2 = completed, 3 = failed. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Mission", meta = (ClampMin = "0", ClampMax = "3"))
	int32 Status = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Mission")
	FName ActiveObjectiveId = NAME_None;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Mission")
	TMap<FName, int32> Counters;
};

/** A vehicle the player owns. */
USTRUCT(BlueprintType)
struct FGameProjectOwnedVehicle
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Vehicle")
	FName VehicleId = NAME_None;

	/** Where it was last left, so it can be respawned in the world. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Vehicle")
	FTransform LastTransform = FTransform::Identity;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Vehicle")
	TMap<FName, float> Upgrades;
};

/** A safehouse / owned property. */
USTRUCT(BlueprintType)
struct FGameProjectSafehouse
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Safehouse")
	FName SafehouseId = NAME_None;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Safehouse")
	FVector WorldLocation = FVector::ZeroVector;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Safehouse")
	bool bUnlocked = false;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Safehouse")
	FGameplayTagContainer Flags;
};

/**
 * The persisted world state that is NOT reproducible from a seed.
 *
 * Voxel terrain is regenerated from (Seed, WorldGenerationSettings, ChunkCoord),
 * so only player-made edits are stored here. This is what keeps a save file for a
 * world the size of a city down to kilobytes instead of gigabytes.
 */
USTRUCT(BlueprintType)
struct FGameProjectWorldSaveData
{
	GENERATED_BODY()

	/** World flags from AGameProjectGameState (tag -> int). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "World")
	TArray<FGameProjectWorldFlag> WorldFlags;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "World")
	double TimeOfDaySeconds = 28800.0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "World")
	int32 DayIndex = 0;

	/**
	 * Voxel modifications, opaque to this struct. Stored as a byte blob so the
	 * voxel system owns its own encoding and can change it (RLE, palette, delta)
	 * without touching the save layout or invalidating existing files.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "World|Voxel")
	TArray<uint8> VoxelModificationBlob;

	/** Version of the voxel blob encoding, so old saves stay readable. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "World|Voxel")
	int32 VoxelBlobVersion = 0;

	/** Generation settings the world was created with. Changing these invalidates terrain. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "World|Voxel")
	int32 WorldSeed = 0;
};

/**
 * The save object.
 *
 * Versioning contract: SaveVersion is written first and never removed. New data
 * is always appended as a new UPROPERTY with a SaveGame specifier, so older files
 * simply leave it at its default. Anything that must be *transformed* on load
 * goes in MigrateFrom(), never in a constructor.
 */
UCLASS(BlueprintType)
class PROJECTCORE_API USaveGameProject : public USaveGame
{
	GENERATED_BODY()

public:
	USaveGameProject();

	/** Layout version. Bumped only with a matching MigrateFrom step. */
	UPROPERTY(BlueprintReadOnly, SaveGame, Category = "Meta")
	int32 SaveVersion = 0;

	UPROPERTY(BlueprintReadOnly, SaveGame, Category = "Meta")
	FDateTime SavedUtc = FDateTime::MinValue();

	UPROPERTY(BlueprintReadOnly, SaveGame, Category = "Meta")
	FString BuildConfiguration;

	/** Free-form extension bag: a new system can persist a scalar here without a layout change. */
	UPROPERTY(BlueprintReadWrite, SaveGame, Category = "Meta")
	TMap<FName, float> NumericValues;

	UPROPERTY(BlueprintReadWrite, SaveGame, Category = "Meta")
	TMap<FName, FString> StringValues;

	// ------------------------------------------------------------- player
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Player")
	FGameProjectPlayerProfile Profile;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Player")
	FTransform PlayerTransform = FTransform::Identity;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Player")
	float Health = 100.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Player")
	float Armor = 0.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Player")
	int32 Money = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Player", meta = (ClampMin = "0", ClampMax = "5"))
	int32 WantedLevel = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Player")
	double TotalPlayTimeSeconds = 0.0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Player")
	TArray<FGameProjectInventoryItem> Inventory;

	// ------------------------------------------------------------- world
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "World")
	FGameProjectWorldSaveData World;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "World")
	FName LastLoadedLevel = NAME_None;

	// ------------------------------------------------------------- progression
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Progression")
	TArray<FGameProjectMissionRecord> Missions;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Progression")
	TArray<FGameProjectOwnedVehicle> OwnedVehicles;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Progression")
	TArray<FGameProjectSafehouse> Safehouses;

	// ------------------------------------------------------------- options
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Settings")
	FGameProjectUserSettings Settings;

	// ------------------------------------------------------------- helpers
	UFUNCTION(BlueprintCallable, Category = "GameProject|Save")
	float GetNumericValue(FName Key, float DefaultValue = 0.0f) const;

	UFUNCTION(BlueprintCallable, Category = "GameProject|Save")
	void SetNumericValue(FName Key, float Value);

	/**
	 * Applies any transformation needed to bring an older layout up to the current
	 * one. Called immediately after load, before any contributor reads data.
	 * @return false when the file is too old to be usable at all.
	 */
	bool MigrateFrom(int32 LoadedVersion);

	/** True when the file came from a build whose layout we can still read. */
	static bool IsVersionSupported(int32 LoadedVersion);
};
