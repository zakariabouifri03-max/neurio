// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Pawn.h"
#include "Police/BCUPoliceSubsystem.h"
#include "BCUPoliceUnit.generated.h"

class ABCUBaseVehicle;
class UBCUVehicleDefinition;
class USpotLightComponent;
class UArrowComponent;
class UBehaviorTreeComponent;
class UBlackboardComponent;
class UAIPerceptionComponent;

UENUM(BlueprintType)
enum class EBCUPoliceTactic : uint8
{
	Follow			UMETA(DisplayName = "Follow"),
	Intercept		UMETA(DisplayName = "Cut Off"),
	Ram				UMETA(DisplayName = "Ram"),
	BoxIn			UMETA(DisplayName = "Box In"),
	Roadblock		UMETA(DisplayName = "Roadblock"),
	SearchGrid		UMETA(DisplayName = "Search Grid"),
	OnFootPursuit	UMETA(DisplayName = "On Foot Pursuit")
};

UENUM(BlueprintType)
enum class EBCUPoliceShout : uint8
{
	StopVehicle			UMETA(DisplayName = "Stop the vehicle!"),
	GetOnTheGround		UMETA(DisplayName = "Get on the ground!"),
	LastWarning			UMETA(DisplayName = "Last warning!"),
	LostThem			UMETA(DisplayName = "We lost them."),
	RequestBackup		UMETA(DisplayName = "Requesting backup."),
	UnitsResponding		UMETA(DisplayName = "Units responding."),
	SuspectInCustody	UMETA(DisplayName = "Suspect in custody."),
	ClearScene			UMETA(DisplayName = "Scene is clear.")
};

/**
 * One police unit. Owns a vehicle, a driver, and a pursuit tactic.
 *
 * The unit is a Pawn (not a Character) so it can be possessed by AI and so a
 * player could, in a future co-op mode, be the officer. The vehicle it drives
 * is a normal ABCUBaseVehicle, which means police cars are enterable,
 * stealable and destructible exactly like civilian traffic.
 */
UCLASS(Blueprintable)
class BLOCKCITYULTRA_API ABCUPoliceUnit : public APawn
{
	GENERATED_BODY()

public:
	ABCUPoliceUnit();

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;
	virtual void Destroyed() override;

	/** Sets up the unit: subsystem back-reference, car, aggressiveness. */
	void Initialise(UBCUPoliceSubsystem* InSubsystem, UBCUVehicleDefinition* VehicleDef, int32 ForWantedLevel);

	/** New orders from dispatch. */
	void SetOrders(const FBCUDispatchOrder& NewOrders);

	/** Per-frame AI. bFullRate is false when distance-LOD'd. */
	void TickUnit(float DeltaSeconds, bool bFullRate);

	/** Stop pursuing and return to patrol (or despawn). */
	void StandDown();

	UFUNCTION(BlueprintPure, Category = "BCU|Police|Unit")
	bool IsIdle() const { return Orders.Phase == EBCUPursuitPhase::None; }

	UFUNCTION(BlueprintPure, Category = "BCU|Police|Unit")
	ABCUBaseVehicle* GetVehicle() const { return PoliceVehicle; }

	UFUNCTION(BlueprintPure, Category = "BCU|Police|Unit")
	EBCUPoliceTactic GetCurrentTactic() const { return Tactic; }

	/** Line of sight to a target — uses the voxel grid, so it is exact. */
	bool HasLineOfSightTo(const AActor* Target) const;

	/** Siren + lightbar on/off. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Police|Unit")
	void SetSirenActive(bool bActive);

	/** Megaphone / "stop the vehicle" bark — played on approach. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Police|Unit")
	void PlayShout(EBCUPoliceShout Shout);

protected:
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Police|Unit|Components")
	TObjectPtr<USceneComponent> Root;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "BCU|Police|Unit|Components")
	TObjectPtr<USpotLightComponent> Searchlight;

	UPROPERTY(Transient)
	TObjectPtr<UBCUPoliceSubsystem> Police;

	UPROPERTY(Transient)
	TObjectPtr<ABCUBaseVehicle> PoliceVehicle;

	UPROPERTY(Transient)
	TObjectPtr<UBCUVehicleDefinition> VehicleDefinition;

	UPROPERTY(Transient)
	TObjectPtr<UBehaviorTreeComponent> BehaviorTreeComponent;

	UPROPERTY(Transient)
	TObjectPtr<UBlackboardComponent> Blackboard;

	FBCUDispatchOrder Orders;
	EBCUPoliceTactic Tactic = EBCUPoliceTactic::Follow;
	int32 AssignedWantedLevel = 0;
	float SearchAngle = 0.0f;
	float SearchRadius = 0.0f;
	float ShoutCooldown = 0.0f;
	float RamCooldown = 0.0f;
	float Throttle = 0.0f;
	float Steer = 0.0f;
	float Brake = 0.0f;

	/** Predictive intercept: aim at where the target will be, not where it is. */
	FVector ComputeInterceptPoint(const FVector& TargetLocation, const FVector& TargetVelocity, float SpeedLimit) const;

	void ChooseTactic(float DistanceToTarget);
	void DriveTowards(const FVector& Target, float DeltaSeconds, float DesiredSpeedKmh);
	void ExecuteSearchGrid(float DeltaSeconds);
	void ExecuteRam(float DeltaSeconds, const FVector& TargetLocation);
	void ExecuteBoxIn(float DeltaSeconds, const FVector& TargetLocation, const FVector& TargetVelocity);
	void SpawnPoliceVehicle();
};
