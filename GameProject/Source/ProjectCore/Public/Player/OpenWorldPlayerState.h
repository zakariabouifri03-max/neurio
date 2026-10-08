// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerState.h"
#include "Save/GameProjectSaveContributor.h"
#include "OpenWorldPlayerState.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnPlayerMoneyChanged, int32, OldMoney, int32, NewMoney);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnPlayerWantedLevelChanged, int32, OldWantedLevel, int32, NewWantedLevel);

/**
 * Per-player, replicated, survives pawn death/respawn.
 *
 * Money and wanted level live here rather than on the character because they are
 * properties of the *player*, not of the body they currently occupy - a rule that
 * becomes load-bearing the moment the player can leave a vehicle or respawn.
 *
 * Phase 01 exposes storage, replication and change events only. No economy, no
 * crime model, no cooldown timers: those systems will read and write these values
 * without this class needing to know they exist.
 */
UCLASS()
class PROJECTCORE_API AOpenWorldPlayerState : public APlayerState, public IGameProjectSaveContributor
{
	GENERATED_BODY()

public:
	AOpenWorldPlayerState();

	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;

	//~ Begin IGameProjectSaveContributor
	virtual FName GetSaveContributorId_Implementation() const override { return TEXT("PlayerState"); }
	virtual int32 GetSavePriority_Implementation() const override { return 10; }
	virtual void WriteSaveData_Implementation(USaveGameProject& SaveGame) const override;
	virtual void ReadSaveData_Implementation(const USaveGameProject& SaveGame) override;
	//~ End IGameProjectSaveContributor

	// ------------------------------------------------------------- money
	UFUNCTION(BlueprintPure, Category = "GameProject|Player")
	int32 GetMoney() const { return Money; }

	/** Returns false (and changes nothing) when the player cannot afford it. */
	UFUNCTION(BlueprintCallable, Category = "GameProject|Player")
	bool TrySpendMoney(int32 Amount);

	UFUNCTION(BlueprintCallable, Category = "GameProject|Player")
	void AddMoney(int32 Amount);

	UFUNCTION(BlueprintCallable, Category = "GameProject|Player")
	void SetMoney(int32 NewMoney);

	UPROPERTY(BlueprintAssignable, Category = "GameProject|Player")
	FOnPlayerMoneyChanged OnMoneyChanged;

	// ------------------------------------------------------------- wanted level
	UFUNCTION(BlueprintPure, Category = "GameProject|Player")
	int32 GetWantedLevel() const { return WantedLevel; }

	UFUNCTION(BlueprintCallable, Category = "GameProject|Player")
	void SetWantedLevel(int32 NewWantedLevel);

	UFUNCTION(BlueprintCallable, Category = "GameProject|Player")
	void AddWantedLevel(int32 Delta);

	UPROPERTY(BlueprintAssignable, Category = "GameProject|Player")
	FOnPlayerWantedLevelChanged OnWantedLevelChanged;

	/** Upper bound of the wanted scale. Data, not a literal, so design can retune it. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "GameProject|Player", meta = (ClampMin = "1", ClampMax = "10"))
	int32 MaxWantedLevel = 5;

protected:
	/** Walks world -> game instance -> subsystem. Null before BeginPlay and in commandlets. */
	UGameProjectSaveSubsystem* FindSaveSubsystem() const;

	UFUNCTION()
	void OnRep_Money();

	UFUNCTION()
	void OnRep_WantedLevel();

	UPROPERTY(ReplicatedUsing = OnRep_Money, BlueprintReadOnly, Category = "GameProject|Player")
	int32 Money = 0;

	UPROPERTY(ReplicatedUsing = OnRep_WantedLevel, BlueprintReadOnly, Category = "GameProject|Player")
	int32 WantedLevel = 0;

	/** Previous values, so replication callbacks can fire a proper old/new event. */
	int32 LastBroadcastMoney = 0;
	int32 LastBroadcastWantedLevel = 0;
};
