// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "AI/BCUTrafficComponent.h"

#include "AI/BCUTrafficSubsystem.h"
#include "Vehicle/BCUBaseVehicle.h"

UBCUTrafficComponent::UBCUTrafficComponent()
{
	// Ticked by the owning vehicle (which is ticked by the subsystem at the
	// right rate for its simulation tier), not by the component tick.
	PrimaryComponentTick.bCanEverTick = false;
}

void UBCUTrafficComponent::Initialise(UBCUTrafficSubsystem* InTraffic)
{
	Traffic = InTraffic;
	Vehicle = Cast<ABCUBaseVehicle>(GetOwner());
	Behaviour = EBCUTrafficBehaviour::FollowLane;
	SimulationTier = 0;
	JunctionTimer = 0.0f;
	DangerTimer = 0.0f;
}

void UBCUTrafficComponent::TickTraffic(float DeltaSeconds)
{
	if (!Vehicle) { Vehicle = Cast<ABCUBaseVehicle>(GetOwner()); }
	if (!Vehicle || SimulationTier >= 2) { return; }

	UpdateBehaviour(DeltaSeconds);
	ExecuteBehaviour(DeltaSeconds);
}

void UBCUTrafficComponent::UpdateBehaviour(float DeltaSeconds)
{
	// Danger reaction has priority over everything and decays with time.
	if (DangerTimer > 0.0f)
	{
		DangerTimer -= DeltaSeconds;
		if (DangerTimer <= 0.0f)
		{
			Behaviour = EBCUTrafficBehaviour::FollowLane;
		}
		return;
	}

	// Pull over for an emergency vehicle with its siren on: a small rule that
	// makes the city feel like it responds to the player's pursuit.
	if (Traffic)
	{
		const TArray<FBCUTrafficAgent>& Agents = Traffic->GetAgents();
		for (const FBCUTrafficAgent& Other : Agents)
		{
			if (!Other.Vehicle || Other.Vehicle == Vehicle) { continue; }

			const bool bEmergency = Other.Vehicle->GetDefinition()
				&& Other.Vehicle->GetDefinition()->IsEmergencyVehicle();
			if (!bEmergency) { continue; }

			if (Other.Vehicle->GetVehicleState() == EBCUVehicleState::Siren
				&& FVector::Dist(Other.Vehicle->GetActorLocation(), Vehicle->GetActorLocation()) < 45000.0f)
			{
				Behaviour = EBCUTrafficBehaviour::Yield;
				return;
			}
		}
	}

	// A stopped car ahead means queue, not overtake.
	if (Behaviour == EBCUTrafficBehaviour::Yield)
	{
		JunctionTimer -= DeltaSeconds;
		if (JunctionTimer <= 0.0f) { Behaviour = EBCUTrafficBehaviour::FollowLane; }
	}
}

void UBCUTrafficComponent::ExecuteBehaviour(float DeltaSeconds)
{
	switch (Behaviour)
	{
	case EBCUTrafficBehaviour::Yield:
	case EBCUTrafficBehaviour::Pullover:
		// Ease to the right-hand edge and stop.
		Vehicle->SetAIThrottle(0.0f);
		Vehicle->SetAIBrake(0.55f);
		Vehicle->SetAISteer(0.28f);
		break;

	case EBCUTrafficBehaviour::Flee:
	case EBCUTrafficBehaviour::Evade:
		// Full throttle away from the danger location.
		{
			const FVector Away = (Vehicle->GetActorLocation() - DangerLocation).GetSafeNormal2D();
			const float YawError = FMath::Clamp(
				FMath::FindDeltaAngleDegrees(Vehicle->GetActorRotation().Yaw, Away.Rotation().Yaw) / 40.0f,
				-1.0f, 1.0f);

			Vehicle->SetAIThrottle(1.0f);
			Vehicle->SetAISteer(-YawError);
			Vehicle->SetAIBrake(0.0f);
		}
		break;

	case EBCUTrafficBehaviour::StopAtJunction:
		Vehicle->SetAIThrottle(0.0f);
		Vehicle->SetAIBrake(0.8f);
		JunctionTimer = FMath::FRandRange(0.8f, 2.4f) / FMath::Max(0.2f, DriverSkill);
		Behaviour = EBCUTrafficBehaviour::Yield;
		break;

	case EBCUTrafficBehaviour::Parked:
		Vehicle->SetAIThrottle(0.0f);
		Vehicle->SetAIBrake(1.0f);
		Vehicle->SetAIWantsHandbrake(true);
		break;

	case EBCUTrafficBehaviour::FollowLane:
	case EBCUTrafficBehaviour::Cruise:
	default:
		// Lane following itself lives in the subsystem (it owns the lane graph);
		// this component only layers behaviour on top of it.
		break;
	}

	(void)DeltaSeconds;
}

void UBCUTrafficComponent::ResumeRoute()
{
	Behaviour = EBCUTrafficBehaviour::FollowLane;
	DangerTimer = 0.0f;
	JunctionTimer = 0.0f;

	if (Vehicle)
	{
		Vehicle->SetAIBrake(0.0f);
		Vehicle->SetAIWantsHandbrake(false);
	}
}

void UBCUTrafficComponent::ReactToDanger(const FVector& DangerLocation_, float RadiusCm)
{
	if (!Vehicle) { return; }

	const float Distance = FVector::Dist(Vehicle->GetActorLocation(), DangerLocation_);
	if (Distance > RadiusCm) { return; }

	DangerLocation = DangerLocation_;

	// Close danger → flee. Far danger → pull over and watch.
	const bool bClose = Distance < RadiusCm * 0.35f;
	Behaviour = bClose ? EBCUTrafficBehaviour::Flee : EBCUTrafficBehaviour::Pullover;
	DangerTimer = bClose ? FMath::FRandRange(6.0f, 14.0f) : FMath::FRandRange(3.0f, 8.0f);

	// Braver drivers keep going; timid ones bail immediately.
	if (DriverAggression > 0.75f && !bClose)
	{
		Behaviour = EBCUTrafficBehaviour::FollowLane;
		DangerTimer = 0.0f;
	}

	// Honk once so the player hears the city react.
	if (bClose && !Vehicle->IsWrecked())
	{
		Vehicle->PlayHorn();
	}
}

void UBCUTrafficComponent::YieldToEmergency()
{
	Behaviour = EBCUTrafficBehaviour::Yield;
	JunctionTimer = FMath::FRandRange(4.0f, 9.0f);
}
