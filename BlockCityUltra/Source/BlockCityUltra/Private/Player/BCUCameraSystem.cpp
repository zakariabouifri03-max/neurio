// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Player/BCUCameraSystem.h"

#include "Player/BCUPlayerCharacter.h"
#include "Vehicle/BCUBaseVehicle.h"
#include "Camera/CameraComponent.h"
#include "Camera/CameraShakeBase.h"
#include "GameFramework/PlayerController.h"
#include "GameFramework/SpringArmComponent.h"

UBCUCameraSystem::UBCUCameraSystem()
{
	PrimaryComponentTick.bCanEverTick = true;
	PrimaryComponentTick.TickGroup = TG_PostPhysics; // read settled transforms
}

void UBCUCameraSystem::BeginPlay()
{
	Super::BeginPlay();
	CurrentFOV = FootFOV;
	CurrentBoomLength = FootBoomLength;
}

void UBCUCameraSystem::TickComponent(float DeltaTime, ELevelTick TickType,
	FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);
	TickCamera(DeltaTime);
}

void UBCUCameraSystem::TickCamera(float DeltaSeconds)
{
	if (!FollowCamera) { return; }

	switch (ActiveContext)
	{
	case EBCUControlContext::Driving:	SolveDriving(DeltaSeconds); break;
	case EBCUControlContext::Cinematic: break; // Sequencer owns the camera
	default:							SolveOnFoot(DeltaSeconds); break;
	}

	// Impact shake decays exponentially so a big hit never leaves a wobble.
	if (ShakeRemaining > 0.0f)
	{
		ShakeRemaining = FMath::Max(0.0f, ShakeRemaining - DeltaSeconds);
		if (ShakeRemaining <= 0.0f && ImpactShakeClass)
		{
			FollowCamera->SetFieldOfView(CurrentFOV);
		}
	}
}

void UBCUCameraSystem::SolveOnFoot(float DeltaSeconds)
{
	if (!Boom) { return; }

	Boom->TargetArmLength = FMath::FInterpTo(Boom->TargetArmLength, FootBoomLength, DeltaSeconds, 6.0f);
	Boom->SocketOffset = FMath::VInterpTo(Boom->SocketOffset, FootSocketOffset, DeltaSeconds, 6.0f);
	Boom->CameraLagSpeed = FootCameraLagSpeed;
	Boom->CameraRotationLagSpeed = 9.0f;
	Boom->bDoCollisionTest = true;

	CurrentFOV = FMath::FInterpTo(CurrentFOV, FootFOV, DeltaSeconds, 8.0f);
	FollowCamera->SetFieldOfView(CurrentFOV);

	if (bLookBack)
	{
		FollowCamera->SetRelativeRotation(FRotator(0.0f, 180.0f, 0.0f));
	}
	else
	{
		FollowCamera->SetRelativeRotation(FRotator::ZeroRotator);
	}
}

void UBCUCameraSystem::SolveDriving(float DeltaSeconds)
{
	if (!Boom || !ViewTarget) { return; }

	const float SpeedFraction = GetVehicleSpeedFraction();

	// Pull back and widen the FOV with speed. This is the single cheapest way to
	// make 300 km/h feel dangerous without motion blur doing all the work.
	const float TargetBoom = FMath::Lerp(ChaseBoomLengthMin, ChaseBoomLengthMax, SpeedFraction);
	const float TargetFOV = FMath::Lerp(ChaseFOVMin, ChaseFOVMax, SpeedFraction);

	Boom->TargetArmLength = FMath::FInterpTo(Boom->TargetArmLength, TargetBoom, DeltaSeconds, 4.0f);
	Boom->SocketOffset = FMath::VInterpTo(Boom->SocketOffset,
		FVector(0.0f, 0.0f, ChaseHeightOffset), DeltaSeconds, 4.0f);
	Boom->CameraLagSpeed = FMath::Lerp(ChaseCameraLagSpeed, ChaseCameraLagSpeed * 0.55f, SpeedFraction);
	Boom->CameraRotationLagSpeed = 5.0f;
	Boom->bDoCollisionTest = true;
	Boom->ProbeSize = 20.0f;

	CurrentFOV = FMath::FInterpTo(CurrentFOV, TargetFOV, DeltaSeconds, 5.0f);
	FollowCamera->SetFieldOfView(CurrentFOV);

	// Lean into corners: lateral acceleration rolls the camera a few degrees.
	if (const ABCUBaseVehicle* Vehicle = Cast<ABCUBaseVehicle>(ViewTarget))
	{
		const FVector LocalAccel = Vehicle->GetActorTransform().InverseTransformVectorNoScale(
			Vehicle->GetVelocity() - Vehicle->GetActorForwardVector() * Vehicle->GetVelocity().Size());
		const float LateralG = FMath::Clamp(LocalAccel.Y / 980.0f, -1.0f, 1.0f);
		const float TargetRoll = -LateralG * CornerLeanDegrees;

		Boom->SetRelativeRotation(FMath::RInterpTo(Boom->GetRelativeRotation(),
			FRotator(0.0f, 0.0f, TargetRoll), DeltaSeconds, 4.0f));
	}

	if (bLookBack)
	{
		FollowCamera->SetRelativeRotation(FRotator(0.0f, 180.0f, 0.0f));
	}
	else
	{
		FollowCamera->SetRelativeRotation(FRotator::ZeroRotator);
	}
}

float UBCUCameraSystem::GetVehicleSpeedFraction() const
{
	const ABCUBaseVehicle* Vehicle = Cast<ABCUBaseVehicle>(ViewTarget);
	const float SpeedKmh = Vehicle ? Vehicle->GetSpeedKmh() : 0.0f;
	return FMath::Clamp(SpeedKmh / FMath::Max(1.0f, SpeedReferenceKmh), 0.0f, 1.0f);
}

void UBCUCameraSystem::AddLookInput(const FVector2D& LookDelta)
{
	PendingLook += LookDelta;
}

void UBCUCameraSystem::SetViewTarget(AActor* NewTarget)
{
	ViewTarget = NewTarget;

	if (Boom && NewTarget)
	{
		Boom->AttachToComponent(NewTarget->GetRootComponent(),
			FAttachmentTransformRules::KeepRelativeTransform);
	}
}

void UBCUCameraSystem::SetCameraModeFor(EBCUControlContext Context)
{
	ActiveContext = Context;

	switch (Context)
	{
	case EBCUControlContext::Driving:
		SetCameraMode(EBCUCameraMode::Chase);
		break;
	case EBCUControlContext::Cinematic:
		SetCameraMode(EBCUCameraMode::Cinematic);
		break;
	case EBCUControlContext::OnFoot:
	default:
		SetCameraMode(EBCUCameraMode::ThirdPerson);
		break;
	}
}

void UBCUCameraSystem::CycleCameraMode()
{
	static const EBCUCameraMode Cycle[] =
	{
		EBCUCameraMode::ThirdPerson, EBCUCameraMode::CloseThird,
		EBCUCameraMode::FirstPerson, EBCUCameraMode::TopDown
	};

	int32 Index = 0;
	for (int32 i = 0; i < UE_ARRAY_COUNT(Cycle); ++i)
	{
		if (Cycle[i] == CurrentMode) { Index = i; break; }
	}

	SetCameraMode(Cycle[(Index + 1) % UE_ARRAY_COUNT(Cycle)]);
}

void UBCUCameraSystem::SetCameraMode(EBCUCameraMode Mode)
{
	CurrentMode = Mode;

	switch (Mode)
	{
	case EBCUCameraMode::FirstPerson:
		FootBoomLength = 0.0f;
		FootSocketOffset = FVector(0.0f, 0.0f, 82.0f);
		break;
	case EBCUCameraMode::CloseThird:
		FootBoomLength = 260.0f;
		FootSocketOffset = FVector(0.0f, 38.0f, 62.0f);
		break;
	case EBCUCameraMode::TopDown:
		FootBoomLength = 900.0f;
		FootSocketOffset = FVector(0.0f, 0.0f, 200.0f);
		break;
	case EBCUCameraMode::ThirdPerson:
	default:
		FootBoomLength = 420.0f;
		FootSocketOffset = FVector(0.0f, 48.0f, 62.0f);
		break;
	}
}

void UBCUCameraSystem::SetLookBack(bool bActive)
{
	bLookBack = bActive;
}

void UBCUCameraSystem::NotifyLanding()
{
	// A landing punch: brief FOV dip reads as weight without a full shake.
	if (FollowCamera)
	{
		CurrentFOV = FMath::Max(70.0f, CurrentFOV - 4.0f);
		FollowCamera->SetFieldOfView(CurrentFOV);
	}
}

void UBCUCameraSystem::NotifyVehicleExit()
{
	CurrentFOV = FootFOV;
	CurrentBoomLength = FootBoomLength;
	if (Boom) { Boom->SetRelativeRotation(FRotator::ZeroRotator); }
}

void UBCUCameraSystem::NotifyImpact(float Severity)
{
	ShakeRemaining = FMath::Clamp(Severity, 0.0f, 1.0f) * 0.5f;

	if (ImpactShakeClass)
	{
		if (APlayerController* PC = Cast<APlayerController>(GetOwner()))
		{
			PC->ClientStartCameraShake(ImpactShakeClass, FMath::Clamp(Severity, 0.2f, 1.5f));
		}
	}
}
