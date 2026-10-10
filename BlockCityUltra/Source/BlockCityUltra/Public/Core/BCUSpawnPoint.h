// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "GameFramework/PlayerStart.h"
#include "BCUSpawnPoint.generated.h"

UENUM(BlueprintType)
enum class EBCUSpawnKind : uint8
{
	PlayerHome		UMETA(DisplayName = "Player Home"),
	Hospital		UMETA(DisplayName = "Hospital (respawn)"),
	PoliceStation	UMETA(DisplayName = "Police Station (busted)"),
	Garage			UMETA(DisplayName = "Garage"),
	Mission			UMETA(DisplayName = "Mission Start"),
	PolicePatrol	UMETA(DisplayName = "Police Patrol"),
	Traffic			UMETA(DisplayName = "Traffic Spawn"),
	HeliPad			UMETA(DisplayName = "Heli Pad")
};

/**
 * Tagged spawn point used by the game mode, mission system, police dispatch
 * and traffic subsystem. Cheaper and clearer than searching for PlayerStarts
 * with gameplay tags across a 200 km² World Partition map.
 *
 * Place instances in a level (they are HLOD-excluded and never rendered).
 */
UCLASS(Blueprintable, meta = (DisplayName = "BCU Spawn Point"))
class BLOCKCITYULTRA_API ABCUSpawnPoint : public APlayerStart
{
	GENERATED_BODY()

public:
	ABCUSpawnPoint();

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Spawn")
	EBCUSpawnKind Kind = EBCUSpawnKind::Mission;

	/** Exact tag match, e.g. "BCU.Spawn.Hospital". */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Spawn")
	TArray<FName> SpawnTags;

	/** Lower is chosen first. Randomised slightly by the caller. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Spawn", meta = (ClampMin = "0.0"))
	float SpawnPriority = 1.0f;

	/** District this spawn belongs to (used for police response zoning). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Spawn")
	FName DistrictName = TEXT("Downtown");

	/** If true the spawn is only used at night (patrol routes, nightlife). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Spawn")
	bool bNightOnly = false;

	UFUNCTION(BlueprintPure, Category = "BCU|Spawn")
	bool MatchesTag(FName Tag) const;

	UFUNCTION(BlueprintPure, Category = "BCU|Spawn")
	float GetSpawnPriority() const;

protected:
	virtual void BeginPlay() override;
};
