// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "BCUTrafficComponent.generated.h"

class ABCUBaseVehicle;
class UBCUTrafficSubsystem;

UENUM(BlueprintType)
enum class EBCUTrafficBehaviour : uint8
{
	Cruise			UMETA(DisplayName = "Cruise"),
	FollowLane		UMETA(DisplayName = "Follow Lane"),
	StopAtJunction	UMETA(DisplayName = "Stop At Junction"),
	Yield			UMETA(DisplayName = "Yield"),
	Evade			UMETA(DisplayName = "Evade Player"),
	Pullover		UMETA(DisplayName = "Pull Over"),
	Parked			UMETA(DisplayName = "Parked"),
	Flee			UMETA(DisplayName = "Flee")
};

/**
 * Per-vehicle traffic behaviour. Attached by UBCUTrafficSubsystem to pooled
 * cars; costs one component, not a separate blueprint per traffic vehicle.
 */
UCLASS(ClassGroup = (BCU), meta = (BlueprintSpawnableComponent))
class BLOCKCITYULTRA_API UBCUTrafficComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UBCUTrafficComponent();

	void Initialise(UBCUTrafficSubsystem* InTraffic);

	/** Driven by the vehicle tick (not the component tick) so the subsystem
	 *  controls the update rate per simulation tier. */
	void TickTraffic(float DeltaSeconds);

	/** 0 = full rate + physics, 1 = kinematic 3 Hz, 2 = frozen. */
	void SetSimulationTier(int32 Tier) { SimulationTier = FMath::Clamp(Tier, 0, 2); }

	UFUNCTION(BlueprintPure, Category = "BCU|Traffic")
	EBCUTrafficBehaviour GetBehaviour() const { return Behaviour; }

	/** Resumes the route after the player gets out of a stolen traffic car. */
	void ResumeRoute();
	bool ShouldResumeAfterExit() const { return Behaviour != EBCUTrafficBehaviour::Parked; }

	/** Reacts to a nearby gunshot/explosion: pull over or flee. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Traffic")
	void ReactToDanger(const FVector& DangerLocation, float RadiusCm);

	/** Pulls over to let an emergency vehicle through. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Traffic")
	void YieldToEmergency();

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Traffic")
	float DriverAggression = 0.5f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Traffic")
	float DriverSkill = 0.6f;

protected:
	UPROPERTY(Transient) TObjectPtr<UBCUTrafficSubsystem> Traffic;
	UPROPERTY(Transient) TObjectPtr<ABCUBaseVehicle> Vehicle;

	EBCUTrafficBehaviour Behaviour = EBCUTrafficBehaviour::Cruise;
	int32 SimulationTier = 0;
	float JunctionTimer = 0.0f;
	float DangerTimer = 0.0f;
	FVector DangerLocation = FVector::ZeroVector;

	void UpdateBehaviour(float DeltaSeconds);
	void ExecuteBehaviour(float DeltaSeconds);
};
