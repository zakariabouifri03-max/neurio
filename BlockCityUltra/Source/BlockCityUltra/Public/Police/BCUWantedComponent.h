// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "BCUWantedComponent.generated.h"

class UBCUPoliceSubsystem;

/**
 * Per-pawn cache of the wanted meter. The subsystem is authoritative; this
 * component exists so the HUD and AI can ask "am I wanted?" without walking the
 * subsystem list, and so a future co-op partner can have its own level.
 */
UCLASS(ClassGroup = (BCU), meta = (BlueprintSpawnableComponent))
class BLOCKCITYULTRA_API UBCUWantedComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UBCUWantedComponent();

	virtual void BeginPlay() override;
	virtual void TickComponent(float DeltaTime, ELevelTick TickType,
		FActorComponentTickFunction* ThisTickFunction) override;

	UFUNCTION(BlueprintPure, Category = "BCU|Police|Wanted")
	int32 GetWantedLevel() const { return CachedWantedLevel; }

	UFUNCTION(BlueprintPure, Category = "BCU|Police|Wanted")
	bool IsWanted() const { return CachedWantedLevel > 0; }

	UFUNCTION(BlueprintPure, Category = "BCU|Police|Wanted")
	bool IsBeingPursued() const { return bBeingPursued; }

	/** 0..1 blend of wanted level and pursuer proximity — drives music + HUD. */
	UFUNCTION(BlueprintPure, Category = "BCU|Police|Wanted")
	float GetPursuitPressure() const { return PursuitPressure; }

private:
	UPROPERTY(Transient)
	TObjectPtr<UBCUPoliceSubsystem> Police;

	int32 CachedWantedLevel = 0;
	bool bBeingPursued = false;
	float PursuitPressure = 0.0f;
	float PollTimer = 0.0f;
};
