// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/SaveGame.h"
#include "Graphics/BCUGraphicsSubsystem.h"
#include "Core/BCUPlayerState.h"
#include "Vehicle/BCUVehicleDefinition.h"
#include "BCUSaveGame.generated.h"

class ABCUPlayerController;

/** One car in the player's garage, with its live customisation. */
USTRUCT(BlueprintType)
struct FBCUSavedVehicle
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	FName VehicleId = NAME_None;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	FLinearColor PaintColor = FLinearColor::White;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	uint8 PaintFinish = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	FName WheelStyle = TEXT("Stock");

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	FName DecalId = NAME_None;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	FName BodyKitId = NAME_None;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	int32 EngineLevel = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	int32 HandlingLevel = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	int32 BrakeLevel = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	float HealthFraction = 1.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	float OdometerKm = 0.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	float FuelLitres = 60.0f;

	/** Where the car was left in the world (so it is still there on reload). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	FVector ParkedLocation = FVector::ZeroVector;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	FRotator ParkedRotation = FRotator::ZeroRotator;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	bool bParkedInGarage = false;
};

/** One owned property: safehouse, garage, business, or a car spot. */
USTRUCT(BlueprintType)
struct FBCUSavedProperty
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	FName PropertyId = NAME_None;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	int32 UpgradeLevel = 0;

	/** Passive income per in-game day (businesses only). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	int32 DailyIncome = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	double PurchaseTimestamp = 0.0;
};

/** Persistent player profile. One per save slot. */
USTRUCT(BlueprintType)
struct FBCUPlayerProfile
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	FString ProfileName = TEXT("Player One");

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	int32 Cash = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	int32 Reputation = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	FName ActiveCharacterId = TEXT("Protagonist_A");

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	FName OutfitId = TEXT("Default");

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	FLinearColor SkinColor = FLinearColor(0.78f, 0.60f, 0.47f);

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	TArray<FName> UnlockedCosmetics;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	TArray<FBCUSavedVehicle> Garage;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	TArray<FBCUSavedProperty> Properties;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	TArray<FName> CompletedMissions;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	TArray<FName> FailedMissions;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	TArray<FName> DiscoveredDistricts;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	TArray<FName> CollectedPickups;

	/** Inventory: weapons, consumables, key items. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	TMap<FName, int32> Inventory;

	// ── Stats ───────────────────────────────────────────────────────────────
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save|Stats")
	float PlayTimeSeconds = 0.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save|Stats")
	float DistanceDrivenKm = 0.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save|Stats")
	float DistanceWalkedKm = 0.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save|Stats")
	int32 VehiclesStolen = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save|Stats")
	int32 TimesArrested = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save|Stats")
	int32 TimesWasted = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save|Stats")
	int32 HighestWantedLevel = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save|Stats")
	int32 RacesWon = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save|Stats")
	int32 HeistsCompleted = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save|Stats")
	float LongestStuntJumpM = 0.0f;
};

/** The save file itself. */
UCLASS(BlueprintType)
class BLOCKCITYULTRA_API UBCUSaveGame : public USaveGame
{
	GENERATED_BODY()

public:
	/** Bumped whenever the layout changes; older saves are migrated or rejected. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	int32 SaveVersion = 7;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	FString BuildVersion = TEXT("0.9.0-slice");

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	FDateTime SavedAtUtc;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	FText SaveDescription;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	FBCUPlayerProfile Profile;

	/** World state at save time. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	FBCUCitySeed CitySeed;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	float TimeOfDay = 8.5f / 24.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	int32 DayNumber = 1;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	uint8 Weather = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	float SurfaceWetness = 0.0f;

	/** Where the player was standing (and in which district). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	FVector PlayerLocation = FVector::ZeroVector;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	FRotator PlayerRotation = FRotator::ZeroRotator;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	FName PlayerDistrict = TEXT("FoundryHeights");

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	int32 WantedLevel = 0;

	/** Video options, saved with the profile so a new slot keeps them. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	FBCUGraphicsSettings Graphics;

	/** Audio options. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	float MasterVolume = 1.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	float MusicVolume = 0.75f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	float EffectsVolume = 1.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	float DialogueVolume = 1.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Save")
	float RadioVolume = 0.8f;

	/** True when the save is corrupt or from a newer build. */
	UPROPERTY(Transient, BlueprintReadOnly, Category = "BCU|Save")
	bool bIsValid = true;

	UPROPERTY(Transient, BlueprintReadOnly, Category = "BCU|Save")
	FText ValidationMessage;

	/** Validates + migrates an older save in place. */
	bool ValidateAndMigrate();
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnBCUSaveCompleted, bool, bSuccess);

/**
 * Save-slot management. One subsystem, eight slots, async writes so a save
 * never hitches a pursuit.
 */
UCLASS(config = Game, Blueprintable)
class BLOCKCITYULTRA_API UBCUSaveGameSystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	UFUNCTION(BlueprintCallable, Category = "BCU|Save")
	bool SaveToSlot(int32 SlotIndex, const FText& Description);

	UFUNCTION(BlueprintCallable, Category = "BCU|Save")
	bool LoadFromSlot(int32 SlotIndex);

	UFUNCTION(BlueprintCallable, Category = "BCU|Save")
	bool DeleteSlot(int32 SlotIndex);

	/** Metadata for the load screen without deserialising the whole save. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Save")
	bool GetSlotInfo(int32 SlotIndex, FText& OutDescription, FDateTime& OutSavedAt,
		int32& OutCash, int32& OutReputation, int32& OutMissions) const;

	UFUNCTION(BlueprintPure, Category = "BCU|Save")
	int32 GetMaxSlots() const { return MaxSaveSlots; }

	/** Requests a non-blocking autosave. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Save")
	void RequestAsyncSave(FName ReasonTag);

	/** Blocks until a pending async save finishes (called on shutdown). */
	void FlushPendingSave();

	UFUNCTION(BlueprintPure, Category = "BCU|Save")
	bool IsSavePending() const { return bSavePending; }

	/** The loaded save, or a transient default before the first load. */
	UFUNCTION(BlueprintPure, Category = "BCU|Save")
	UBCUSaveGame* GetCurrentSave() const { return CurrentSave; }

	UFUNCTION(BlueprintPure, Category = "BCU|Save")
	FBCUPlayerProfile& GetProfile();

	UFUNCTION(BlueprintCallable, Category = "BCU|Save")
	void SetActiveSlot(int32 SlotIndex);

	UFUNCTION(BlueprintPure, Category = "BCU|Save")
	int32 GetActiveSlot() const { return ActiveSlot; }

	/** Pushes the loaded profile into a player controller after login. */
	void ApplyToPlayer(const ABCUPlayerController* PC);

	/** Captures live player state into the profile before saving. */
	void CaptureFromPlayer(const ABCUPlayerController* PC);

	UPROPERTY(BlueprintAssignable, Category = "BCU|Save")
	FOnBCUSaveCompleted OnSaveCompleted;

	UPROPERTY(EditAnywhere, config, Category = "BCU|Save")
	FString DefaultSaveSlotName = TEXT("BCU_SAVE");

	UPROPERTY(EditAnywhere, config, Category = "BCU|Save", meta = (ClampMin = "1", ClampMax = "32"))
	int32 MaxSaveSlots = 8;

	UPROPERTY(EditAnywhere, config, Category = "BCU|Save", meta = (ClampMin = "30.0"))
	float AutoSaveIntervalSeconds = 180.0f;

	UPROPERTY(EditAnywhere, config, Category = "BCU|Save")
	bool bAutoSaveOnMissionComplete = true;

	UPROPERTY(EditAnywhere, config, Category = "BCU|Save")
	bool bAutoSaveOnPropertyPurchase = true;

protected:
	UPROPERTY(Transient)
	TObjectPtr<UBCUSaveGame> CurrentSave;

	int32 ActiveSlot = 0;
	bool bSavePending = false;
	FName PendingSaveReason = NAME_None;

	FString SlotName(int32 Index) const;
	void PerformAsyncSave();
};
