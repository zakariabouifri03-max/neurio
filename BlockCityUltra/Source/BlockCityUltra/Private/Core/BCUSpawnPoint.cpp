// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Core/BCUSpawnPoint.h"

#include "Core/BCUGameState.h"
#include "Kismet/GameplayStatics.h"

ABCUSpawnPoint::ABCUSpawnPoint()
{
	PrimaryActorTick.bCanEverTick = false;
	bIsEditorOnlyActor = false;
	bHidden = true;
#if WITH_EDITORONLY_DATA
	bIsSpatiallyLoaded = true;
	HLODLayerName = NAME_None; // never part of a city HLOD cluster
#endif
}

void ABCUSpawnPoint::BeginPlay()
{
	Super::BeginPlay();

	// Traffic/patrol spawns register themselves with the owning subsystem so
	// dispatch does not have to iterate the world on every call.
	switch (Kind)
	{
	case EBCUSpawnKind::PolicePatrol:
	case EBCUSpawnKind::Traffic:
		// Registered by UBCUTrafficSubsystem / UBCUPoliceSubsystem during
		// their own Initialise, which run after all actors BeginPlay.
		break;
	default:
		break;
	}
}

bool ABCUSpawnPoint::MatchesTag(FName Tag) const
{
	if (!Tag.IsValid())
	{
		return false;
	}

	if (SpawnTags.Contains(Tag))
	{
		return true;
	}

	// Fall back to the kind so designers can tag by category only, e.g.
	// "BCU.Spawn.Hospital" matches every hospital spawn point.
	const FString TagString = Tag.ToString();
	switch (Kind)
	{
	case EBCUSpawnKind::Hospital:		return TagString.Contains(TEXT("Hospital"));
	case EBCUSpawnKind::PoliceStation:	return TagString.Contains(TEXT("PoliceStation"));
	case EBCUSpawnKind::Garage:			return TagString.Contains(TEXT("Garage"));
	case EBCUSpawnKind::PlayerHome:		return TagString.Contains(TEXT("PlayerHome"));
	default:							return false;
	}
}

float ABCUSpawnPoint::GetSpawnPriority() const
{
	float Priority = SpawnPriority;

	if (bNightOnly)
	{
		const ABCUGameState* State = UGameplayStatics::GetGameState<ABCUGameState>(this);
		if (!State || !State->IsNight())
		{
			// Effectively disabled during the day without removing it.
			Priority += 1.0e6f;
		}
	}

	return Priority;
}
