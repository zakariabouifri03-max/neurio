// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerState.h"
#include "BCUPlayerState.generated.h"

UENUM(BlueprintType)
enum class EBCUCashReason : uint8
{
	MissionReward	UMETA(DisplayName = "Mission Reward"),
	RacePrize		UMETA(DisplayName = "Race Prize"),
	DeliveryPay		UMETA(DisplayName = "Delivery Pay"),
	HeistCut		UMETA(DisplayName = "Heist Cut"),
	PropertyRent	UMETA(DisplayName = "Property Income"),
	VehicleSale		UMETA(DisplayName = "Vehicle Sale"),
	MedicalBill		UMETA(DisplayName = "Medical Bill"),
	ArrestFine		UMETA(DisplayName = "Arrest Fine"),
	VehiclePurchase	UMETA(DisplayName = "Vehicle Purchase"),
	PropertyPurchaseUMETA(DisplayName = "Property Purchase"),
	Customisation	UMETA(DisplayName = "Customisation"),
	Shop			UMETA(DisplayName = "Shop"),
	Bribe			UMETA(DisplayName = "Bribe"),
	Other			UMETA(DisplayName = "Other")
};

/**
 * Replicated per-player state. Keeps the *authoritative* copy of the profile
 * (cash, reputation, wanted level, owned vehicles) so co-op/debug sessions
 * show correct HUD numbers even before the save file is written.
 */
UCLASS(Blueprintable)
class BLOCKCITYULTRA_API ABCUPlayerState : public APlayerState
{
	GENERATED_BODY()

public:
	ABCUPlayerState();

	UPROPERTY(BlueprintReadOnly, ReplicatedUsing = OnRep_Cash, Category = "BCU|Player", meta = (ClampMin = "0"))
	int32 Cash = 0;

	UPROPERTY(BlueprintReadOnly, ReplicatedUsing = OnRep_Reputation, Category = "BCU|Player")
	int32 Reputation = 0;

	UPROPERTY(BlueprintReadOnly, ReplicatedUsing = OnRep_WantedLevel, Category = "BCU|Player", meta = (ClampMin = "0", ClampMax = "6"))
	int32 WantedLevel = 0;

	UPROPERTY(BlueprintReadOnly, Replicated, Category = "BCU|Player")
	FName CurrentDistrict = TEXT("Downtown");

	UPROPERTY(BlueprintReadOnly, Replicated, Category = "BCU|Player")
	FName ActiveVehicleId = NAME_None;

	UPROPERTY(BlueprintReadOnly, Replicated, Category = "BCU|Player")
	int32 MissionsCompleted = 0;

	UPROPERTY(BlueprintReadOnly, Replicated, Category = "BCU|Player")
	float TotalDistanceDrivenKm = 0.0f;

	UFUNCTION(BlueprintCallable, Category = "BCU|Player")
	void AddCash(int32 Amount, EBCUCashReason Reason);

	UFUNCTION(BlueprintCallable, Category = "BCU|Player")
	bool SpendCash(int32 Amount, EBCUCashReason Reason);

	UFUNCTION(BlueprintCallable, Category = "BCU|Player")
	void AddReputation(int32 Amount);

	UFUNCTION(BlueprintCallable, Category = "BCU|Player")
	void SetWantedLevel(int32 NewLevel);

	UFUNCTION(BlueprintCallable, Category = "BCU|Player")
	void NoteMissionCompleted();

	UFUNCTION(BlueprintCallable, Category = "BCU|Player")
	void NoteDistanceDriven(float Kilometres);

	UFUNCTION(BlueprintPure, Category = "BCU|Player")
	FText GetFormattedCash() const;

protected:
	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;

	UFUNCTION()
	void OnRep_Cash();

	UFUNCTION()
	void OnRep_Reputation();

	UFUNCTION()
	void OnRep_WantedLevel();
};
