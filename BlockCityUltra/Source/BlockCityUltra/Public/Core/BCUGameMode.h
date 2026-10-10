// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "BCUGameMode.generated.h"

class AController;
class ABCUPlayerController;
class ABCUPlayerCharacter;
class UBCUMissionSubsystem;
class UBCUEconomySubsystem;
class UBCUPoliceSubsystem;

/**
 * Top-level session rules for a BLOCK CITY ULTRA world.
 *
 * Responsibilities
 *  - pick the player start (tagged spawn points: BCUSpawnPoint actors)
 *  - own the respawn / busted policy (hospital vs. police station)
 *  - bridge PostLogin into the mission, economy and police subsystems
 *  - expose the difficulty + autosave policy for the whole session
 *
 * Blueprint subclass: /Game/Blueprints/Core/BP_BCUGameMode
 */
UCLASS(config = Game, Blueprintable)
class BLOCKCITYULTRA_API ABCUGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	ABCUGameMode();

	//~ Begin AGameModeBase
	virtual void InitGame(const FString& MapName, const FString& Options, FString& ErrorMessage) override;
	virtual void StartPlay() override;
	virtual void PostLogin(APlayerController* NewPlayer) override;
	virtual void Logout(AController* Exiting) override;
	virtual AActor* ChoosePlayerStart_Implementation(AController* Player) override;
	virtual UClass* GetDefaultPawnClassForController_Implementation(AController* InController) override;
	//~ End AGameModeBase

	/**
	 * Respawns the local player after a WASTED or BUSTED event.
	 * @param bWasArrested true → police-station spawn + confiscated contraband.
	 */
	UFUNCTION(BlueprintCallable, Category = "BCU|GameMode|Respawn")
	void RespawnPlayer(bool bWasArrested);

	/** Teleports the player to a named spawn point tag. */
	UFUNCTION(BlueprintCallable, Category = "BCU|GameMode|Respawn")
	bool TeleportPlayerToTag(FName SpawnTag, bool bKeepVehicle = false);

	/** Cash penalty applied on death. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|GameMode|Respawn", config)
	int32 CashLostOnDeath = 250;

	/** Cash penalty applied on arrest. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|GameMode|Respawn", config)
	int32 CashLostOnArrest = 400;

	/** Length of the fade-to-black used by RespawnPlayer. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|GameMode|Respawn", config)
	float RespawnFadeSeconds = 1.6f;

	/** Spawn tag used when a mission does not request a specific one. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|GameMode|Respawn", config)
	FName DefaultSpawnTag = TEXT("BCU.Spawn.PlayerHome");

	/** 0..3 — scales wanted decay, police aggression and mission rewards. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|GameMode|Difficulty", config, meta = (ClampMin = "0", ClampMax = "3"))
	int32 DifficultyLevel = 1;

	/** Global reward multiplier derived from DifficultyLevel. */
	UFUNCTION(BlueprintPure, Category = "BCU|GameMode|Difficulty")
	float GetRewardMultiplier() const;

	/** Global police-aggression multiplier derived from DifficultyLevel. */
	UFUNCTION(BlueprintPure, Category = "BCU|GameMode|Difficulty")
	float GetPoliceAggressionMultiplier() const;

protected:
	virtual void BeginPlay() override;

	/** Cached subsystems (resolved once in StartPlay). */
	UPROPERTY(Transient)
	TObjectPtr<UBCUMissionSubsystem> MissionSubsystem;

	UPROPERTY(Transient)
	TObjectPtr<UBCUEconomySubsystem> EconomySubsystem;

	UPROPERTY(Transient)
	TObjectPtr<UBCUPoliceSubsystem> PoliceSubsystem;

	/** Resolves the nearest spawn actor carrying the given tag. */
	FVector FindSpawnLocationForTag(FName Tag, FRotator& OutRotation) const;

	/** True while the respawn fade is playing (blocks double-respawn). */
	bool bRespawnInProgress = false;
};
