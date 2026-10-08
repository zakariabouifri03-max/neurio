// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameModeBase.h"
#include "GameProjectGameMode.generated.h"

class AOpenWorldTestAreaBuilder;
class AVoxelWorldManager;

/**
 * Authoritative rules for a running game session.
 *
 * Scoped on purpose: the GameMode only decides *which* classes play which role
 * and makes sure the world services exist. It owns no gameplay rules. Systems
 * that would otherwise be tempting to put here (missions, wanted level,
 * economy, traffic) belong in their own managers/subsystems so this class never
 * grows into the classic 4000-line GameMode.
 */
UCLASS()
class PROJECTCORE_API AGameProjectGameMode : public AGameModeBase
{
	GENERATED_BODY()

public:
	AGameProjectGameMode();

	//~ Begin AGameModeBase
	virtual void InitGame(const FString& MapName, const FString& Options, FString& ErrorMessage) override;
	virtual void BeginPlay() override;
	virtual AActor* ChoosePlayerStart_Implementation(AController* Player) override;
	//~ End AGameModeBase

	/** Spawns the test-area builder if the level does not already contain one. */
	UFUNCTION(BlueprintCallable, Category = "GameProject|World")
	AOpenWorldTestAreaBuilder* EnsureTestAreaBuilder();

	/** Spawns the voxel world manager if the level does not already contain one. */
	UFUNCTION(BlueprintCallable, Category = "GameProject|World")
	AVoxelWorldManager* EnsureVoxelWorldManager();

	/**
	 * When true the GameMode creates missing world services on BeginPlay. Handy in
	 * PIE with an empty level; turn it off once the map authors these actors
	 * directly (which is how a shipped World Partition map should do it).
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "GameProject|World")
	bool bAutoCreateWorldServices = true;

protected:
	/** Idempotent world-service bootstrap. Safe to call more than once. */
	void EnsureWorldServices();

	/** Cached so we do not run an actor iterator every frame. */
	UPROPERTY(Transient)
	TObjectPtr<AOpenWorldTestAreaBuilder> TestAreaBuilder;

	UPROPERTY(Transient)
	TObjectPtr<AVoxelWorldManager> VoxelWorldManager;

	bool bWorldServicesCreated = false;
};
