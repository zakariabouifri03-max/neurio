// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "Core/BCUPlayerState.h"
#include "BCUEconomySubsystem.generated.h"

class UBCUVehicleSubsystem;
class UBCUMissionSubsystem;

UENUM(BlueprintType)
enum class EBCUShopCategory : uint8
{
	None			UMETA(DisplayName = "None"),
	Clothing		UMETA(DisplayName = "Clothing"),
	Weapons			UMETA(DisplayName = "Weapons"),
	Vehicles		UMETA(DisplayName = "Vehicle Dealership"),
	Customisation	UMETA(DisplayName = "Customisation"),
	Property		UMETA(DisplayName = "Property"),
	Food			UMETA(DisplayName = "Food & Drink"),
	Consumables		UMETA(DisplayName = "Consumables"),
	Fuel			UMETA(DisplayName = "Fuel"),
	Repair			UMETA(DisplayName = "Repair")
};

/** One purchasable thing. */
USTRUCT(BlueprintType)
struct FBCUShopItem
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Economy")
	FName ItemId = NAME_None;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Economy")
	FText DisplayName;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Economy")
	EBCUShopCategory Category = EBCUShopCategory::None;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Economy", meta = (ClampMin = "0"))
	int32 Price = 0;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Economy", meta = (ClampMin = "0"))
	int32 ResaleValue = 0;

	/** Reputation needed before the item appears. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Economy")
	int32 RequiredReputation = 0;

	/** Mission that must be complete before the item appears. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Economy")
	FName RequiredMission = NAME_None;

	/** Only sold in these districts (local colour, price variation). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Economy")
	TArray<FName> DistrictRestriction;

	/** Vehicle / property / cosmetic this item unlocks. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Economy")
	FName UnlockId = NAME_None;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Economy")
	int32 StockRemaining = -1; // -1 = unlimited
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnBCUCashChanged, int32, NewCash, EBCUCashReason, Reason);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnBCUReputationChanged, int32, NewReputation);

/**
 * Money, reputation, shops, property income and progression gates.
 *
 * Single source of truth for cash: every system that spends or earns goes
 * through here, so the HUD, the save file and the audit log can never disagree.
 */
UCLASS(config = Game, Blueprintable)
class BLOCKCITYULTRA_API UBCUEconomySubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override;

	// ── Cash ────────────────────────────────────────────────────────────────
	UFUNCTION(BlueprintCallable, Category = "BCU|Economy")
	void AddCash(int32 Amount, EBCUCashReason Reason);

	UFUNCTION(BlueprintCallable, Category = "BCU|Economy")
	bool SpendCash(int32 Amount, EBCUCashReason Reason);

	UFUNCTION(BlueprintPure, Category = "BCU|Economy")
	int32 GetCash() const;

	UFUNCTION(BlueprintCallable, Category = "BCU|Economy")
	void AddReputation(int32 Amount);

	UFUNCTION(BlueprintPure, Category = "BCU|Economy")
	int32 GetReputation() const;

	/** Rank name for the current reputation (Street Nobody → City Legend). */
	UFUNCTION(BlueprintPure, Category = "BCU|Economy")
	FText GetRankName() const;

	UPROPERTY(BlueprintAssignable, Category = "BCU|Economy")
	FOnBCUCashChanged OnCashChanged;

	UPROPERTY(BlueprintAssignable, Category = "BCU|Economy")
	FOnBCUReputationChanged OnReputationChanged;

	// ── Shops ───────────────────────────────────────────────────────────────
	UFUNCTION(BlueprintCallable, Category = "BCU|Economy|Shop")
	void RegisterShopItems(const TArray<FBCUShopItem>& Items);

	UFUNCTION(BlueprintCallable, Category = "BCU|Economy|Shop")
	TArray<FBCUShopItem> GetShopItems(EBCUShopCategory Category, FName DistrictId) const;

	UFUNCTION(BlueprintCallable, Category = "BCU|Economy|Shop")
	bool PurchaseItem(FName ItemId, FName DistrictId);

	UFUNCTION(BlueprintPure, Category = "BCU|Economy|Shop")
	bool CanAfford(FName ItemId) const;

	UFUNCTION(BlueprintPure, Category = "BCU|Economy|Shop")
	int32 GetItemPrice(FName ItemId) const;

	// ── Unlocks ─────────────────────────────────────────────────────────────
	UFUNCTION(BlueprintCallable, Category = "BCU|Economy|Unlock")
	void UnlockVehicle(FName VehicleId);

	UFUNCTION(BlueprintCallable, Category = "BCU|Economy|Unlock")
	void UnlockProperty(FName PropertyId);

	UFUNCTION(BlueprintCallable, Category = "BCU|Economy|Unlock")
	void UnlockCosmetic(FName CosmeticId);

	UFUNCTION(BlueprintPure, Category = "BCU|Economy|Unlock")
	bool HasUnlocked(FName Id) const;

	// ── Property ────────────────────────────────────────────────────────────
	/** Buys a property; income starts accruing from the next tick. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Economy|Property")
	bool PurchaseProperty(FName PropertyId, int32 Price, int32 DailyIncome);

	UFUNCTION(BlueprintPure, Category = "BCU|Economy|Property")
	int32 GetTotalDailyPropertyIncome() const;

	/** Upgrades a property, raising its income. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Economy|Property")
	bool UpgradeProperty(FName PropertyId, int32 Cost);

	// ── Inventory ───────────────────────────────────────────────────────────
	UFUNCTION(BlueprintCallable, Category = "BCU|Economy|Inventory")
	void AddItem(FName ItemId, int32 Count = 1);

	UFUNCTION(BlueprintCallable, Category = "BCU|Economy|Inventory")
	bool RemoveItem(FName ItemId, int32 Count = 1);

	UFUNCTION(BlueprintPure, Category = "BCU|Economy|Inventory")
	int32 GetItemCount(FName ItemId) const;

	UFUNCTION(BlueprintPure, Category = "BCU|Economy|Inventory")
	TArray<FName> GetInventoryIds() const;

	// ── Tuning ──────────────────────────────────────────────────────────────
	UPROPERTY(EditAnywhere, config, Category = "BCU|Economy")
	int32 StartingCash = 2500;

	UPROPERTY(EditAnywhere, config, Category = "BCU|Economy")
	int32 StartingReputation = 0;

	/** In-game minutes between property income payouts. */
	UPROPERTY(EditAnywhere, config, Category = "BCU|Economy", meta = (ClampMin = "1.0"))
	float PropertyIncomeIntervalMinutes = 30.0f;

	/** Reputation thresholds for each rank. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Economy")
	TArray<int32> RankThresholds = { 0, 250, 750, 1800, 4000, 9000, 20000 };

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Economy")
	TArray<FText> RankNames;

	UFUNCTION(BlueprintPure, Category = "BCU|Economy|Debug")
	FString GetEconomyStats() const;

protected:
	UPROPERTY(Transient)
	TArray<FBCUShopItem> ShopCatalogue;

	UPROPERTY(Transient)
	TMap<FName, int32> Inventory;

	UPROPERTY(Transient)
	TArray<FName> UnlockedIds;

	UPROPERTY(Transient)
	TArray<FName> OwnedProperties;

	UPROPERTY(Transient)
	TMap<FName, int32> PropertyIncome;

	int32 Cash = 0;
	int32 Reputation = 0;
	float IncomeTimer = 0.0f;

	void PayPropertyIncome();
	ABCUPlayerState* GetPlayerState() const;
};
