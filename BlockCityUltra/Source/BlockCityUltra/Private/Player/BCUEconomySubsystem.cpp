// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Player/BCUEconomySubsystem.h"

#include "Core/BCUPlayerState.h"
#include "Vehicle/BCUVehicleSubsystem.h"
#include "Kismet/GameplayStatics.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUEconomy, Log, All);

void UBCUEconomySubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

	Cash = StartingCash;
	Reputation = StartingReputation;

	if (RankNames.Num() == 0)
	{
		RankNames = {
			FText::FromString(TEXT("Street Nobody")),
			FText::FromString(TEXT("Errand Runner")),
			FText::FromString(TEXT("Wheelman")),
			FText::FromString(TEXT("Crew Regular")),
			FText::FromString(TEXT("Made Name")),
			FText::FromString(TEXT("District Boss")),
			FText::FromString(TEXT("City Legend"))
		};
	}
}

void UBCUEconomySubsystem::Deinitialize() { Super::Deinitialize(); }

TStatId UBCUEconomySubsystem::GetStatId() const
{
	RETURN_QUICK_DECLARE_CYCLE_STAT(UBCUEconomySubsystem, STATGROUP_Tickables);
}

void UBCUEconomySubsystem::Tick(float DeltaTime)
{
	if (OwnedProperties.Num() == 0) { return; }

	IncomeTimer += DeltaTime;
	if (IncomeTimer >= PropertyIncomeIntervalMinutes * 60.0f)
	{
		IncomeTimer = 0.0f;
		PayPropertyIncome();
	}
}

ABCUPlayerState* UBCUEconomySubsystem::GetPlayerState() const
{
	const APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0);
	return PC ? PC->GetPlayerState<ABCUPlayerState>() : nullptr;
}

int32 UBCUEconomySubsystem::GetCash() const
{
	// The player state is authoritative in multiplayer; the subsystem value is
	// the single-player source of truth. Prefer the state when it exists.
	if (const ABCUPlayerState* PS = GetPlayerState()) { return PS->GetCash(); }
	return Cash;
}

int32 UBCUEconomySubsystem::GetReputation() const
{
	if (const ABCUPlayerState* PS = GetPlayerState()) { return PS->GetReputation(); }
	return Reputation;
}

void UBCUEconomySubsystem::AddCash(int32 Amount, EBCUCashReason Reason)
{
	if (Amount <= 0) { return; }

	Cash = FMath::Max(0, Cash + Amount);
	if (ABCUPlayerState* PS = GetPlayerState()) { PS->AddCash(Amount, Reason); }

	OnCashChanged.Broadcast(GetCash(), Reason);
	UE_LOG(LogBCUEconomy, Log, TEXT("+$%d (%s) → $%d"), Amount,
		*UEnum::GetValueAsString(Reason).RightChop(16), GetCash());
}

bool UBCUEconomySubsystem::SpendCash(int32 Amount, EBCUCashReason Reason)
{
	if (Amount < 0 || GetCash() < Amount) { return false; }

	Cash = FMath::Max(0, Cash - Amount);
	if (ABCUPlayerState* PS = GetPlayerState()) { PS->SpendCash(Amount, Reason); }

	OnCashChanged.Broadcast(GetCash(), Reason);
	UE_LOG(LogBCUEconomy, Log, TEXT("-$%d (%s) → $%d"), Amount,
		*UEnum::GetValueAsString(Reason).RightChop(16), GetCash());
	return true;
}

void UBCUEconomySubsystem::AddReputation(int32 Amount)
{
	Reputation = FMath::Max(0, Reputation + Amount);
	if (ABCUPlayerState* PS = GetPlayerState()) { PS->AddReputation(Amount); }
	OnReputationChanged.Broadcast(GetReputation());
}

FText UBCUEconomySubsystem::GetRankName() const
{
	if (RankNames.Num() == 0) { return FText::GetEmpty(); }

	int32 Rank = 0;
	for (int32 i = 0; i < RankThresholds.Num() && i < RankNames.Num(); ++i)
	{
		if (GetReputation() >= RankThresholds[i]) { Rank = i; }
	}

	return RankNames[FMath::Clamp(Rank, 0, RankNames.Num() - 1)];
}

// ── Shops ─────────────────────────────────────────────────────────────────────

void UBCUEconomySubsystem::RegisterShopItems(const TArray<FBCUShopItem>& Items)
{
	for (const FBCUShopItem& Item : Items)
	{
		const int32 Existing = ShopCatalogue.IndexOfByPredicate(
			[&Item](const FBCUShopItem& O) { return O.ItemId == Item.ItemId; });
		if (Existing != INDEX_NONE) { ShopCatalogue[Existing] = Item; }
		else { ShopCatalogue.Add(Item); }
	}
}

TArray<FBCUShopItem> UBCUEconomySubsystem::GetShopItems(EBCUShopCategory Category, FName DistrictId) const
{
	TArray<FBCUShopItem> Result;

	for (const FBCUShopItem& Item : ShopCatalogue)
	{
		if (Item.Category != Category) { continue; }
		if (Item.RequiredReputation > GetReputation()) { continue; }
		if (Item.DistrictRestriction.Num() > 0 && !Item.DistrictRestriction.Contains(DistrictId)) { continue; }

		Result.Add(Item);
	}

	return Result;
}

int32 UBCUEconomySubsystem::GetItemPrice(FName ItemId) const
{
	for (const FBCUShopItem& Item : ShopCatalogue)
	{
		if (Item.ItemId == ItemId) { return Item.Price; }
	}
	return 0;
}

bool UBCUEconomySubsystem::CanAfford(FName ItemId) const
{
	const int32 Price = GetItemPrice(ItemId);
	return Price > 0 && GetCash() >= Price;
}

bool UBCUEconomySubsystem::PurchaseItem(FName ItemId, FName DistrictId)
{
	const FBCUShopItem* Found = ShopCatalogue.FindByPredicate(
		[ItemId](const FBCUShopItem& O) { return O.ItemId == ItemId; });

	if (!Found) { return false; }
	if (Found->RequiredReputation > GetReputation()) { return false; }
	if (Found->DistrictRestriction.Num() > 0 && !Found->DistrictRestriction.Contains(DistrictId)) { return false; }
	if (Found->StockRemaining == 0) { return false; }
	if (!SpendCash(Found->Price, EBCUCashReason::Purchase)) { return false; }

	if (Found->UnlockId.IsValid())
	{
		switch (Found->Category)
		{
		case EBCUShopCategory::Vehicles:		UnlockVehicle(Found->UnlockId); break;
		case EBCUShopCategory::Property:		UnlockProperty(Found->UnlockId); break;
		case EBCUShopCategory::Clothing:
		case EBCUShopCategory::Customisation:	UnlockCosmetic(Found->UnlockId); break;
		default:								AddItem(Found->UnlockId); break;
		}
	}
	else
	{
		AddItem(ItemId);
	}

	if (Found->StockRemaining > 0)
	{
		ShopCatalogue[ShopCatalogue.IndexOfByPredicate(
			[ItemId](const FBCUShopItem& O) { return O.ItemId == ItemId; })].StockRemaining--;
	}

	return true;
}

// ── Unlocks ───────────────────────────────────────────────────────────────────

void UBCUEconomySubsystem::UnlockVehicle(FName VehicleId)
{
	UnlockedIds.AddUnique(VehicleId);
	if (UBCUVehicleSubsystem* Vehicles = GetWorld()->GetSubsystem<UBCUVehicleSubsystem>())
	{
		Vehicles->GrantVehicle(VehicleId);
	}
}

void UBCUEconomySubsystem::UnlockProperty(FName PropertyId)
{
	UnlockedIds.AddUnique(PropertyId);
	OwnedProperties.AddUnique(PropertyId);
}

void UBCUEconomySubsystem::UnlockCosmetic(FName CosmeticId)
{
	UnlockedIds.AddUnique(CosmeticId);
}

bool UBCUEconomySubsystem::HasUnlocked(FName Id) const
{
	return UnlockedIds.Contains(Id);
}

// ── Property ──────────────────────────────────────────────────────────────────

bool UBCUEconomySubsystem::PurchaseProperty(FName PropertyId, int32 Price, int32 DailyIncome)
{
	if (!SpendCash(Price, EBCUCashReason::Purchase)) { return false; }

	OwnedProperties.AddUnique(PropertyId);
	PropertyIncome.Add(PropertyId, FMath::Max(0, DailyIncome));
	UnlockedIds.AddUnique(PropertyId);

	UE_LOG(LogBCUEconomy, Log, TEXT("Purchased property %s for $%d (income $%d/day)"),
		*PropertyId.ToString(), Price, DailyIncome);
	return true;
}

bool UBCUEconomySubsystem::UpgradeProperty(FName PropertyId, int32 Cost)
{
	if (!OwnedProperties.Contains(PropertyId)) { return false; }
	if (!SpendCash(Cost, EBCUCashReason::Purchase)) { return false; }

	// Each upgrade raises income by 25%.
	const int32 Current = PropertyIncome.Contains(PropertyId) ? PropertyIncome[PropertyId] : 0;
	PropertyIncome.Add(PropertyId, FMath::RoundToInt(float(Current) * 1.25f) + 50);
	return true;
}

int32 UBCUEconomySubsystem::GetTotalDailyPropertyIncome() const
{
	int32 Total = 0;
	for (const TPair<FName, int32>& Pair : PropertyIncome) { Total += Pair.Value; }
	return Total;
}

void UBCUEconomySubsystem::PayPropertyIncome()
{
	// Interval is in in-game minutes; scale the daily income by the fraction of
	// a day that has actually passed.
	const float FractionOfDay = PropertyIncomeIntervalMinutes / (24.0f * 60.0f);
	const int32 Payout = FMath::RoundToInt(float(GetTotalDailyPropertyIncome()) * FractionOfDay);

	if (Payout > 0)
	{
		AddCash(Payout, EBCUCashReason::PropertyIncome);
	}
}

// ── Inventory ─────────────────────────────────────────────────────────────────

void UBCUEconomySubsystem::AddItem(FName ItemId, int32 Count)
{
	if (!ItemId.IsValid() || Count <= 0) { return; }

	int32& Existing = Inventory.FindOrAdd(ItemId);
	Existing += Count;
}

bool UBCUEconomySubsystem::RemoveItem(FName ItemId, int32 Count)
{
	int32* Existing = Inventory.Find(ItemId);
	if (!Existing || *Existing < Count) { return false; }

	*Existing -= Count;
	if (*Existing <= 0) { Inventory.Remove(ItemId); }
	return true;
}

int32 UBCUEconomySubsystem::GetItemCount(FName ItemId) const
{
	const int32* Found = Inventory.Find(ItemId);
	return Found ? *Found : 0;
}

TArray<FName> UBCUEconomySubsystem::GetInventoryIds() const
{
	TArray<FName> Ids;
	Inventory.GetKeys(Ids);
	return Ids;
}

FString UBCUEconomySubsystem::GetEconomyStats() const
{
	return FString::Printf(TEXT("cash=$%d rep=%d items=%d props=%d unlocks=%d income=$%d/day"),
		GetCash(), GetReputation(), Inventory.Num(), OwnedProperties.Num(),
		UnlockedIds.Num(), GetTotalDailyPropertyIncome());
}
