// Copyright GameProject. All rights reserved. Original content only.

#include "Player/OpenWorldCameraRigComponent.h"

#include "Camera/CameraComponent.h"
#include "Core/GameProjectLog.h"
#include "GameFramework/SpringArmComponent.h"

UOpenWorldCameraRigComponent::UOpenWorldCameraRigComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
	PrimaryComponentTick.bStartWithTickEnabled = false; // Enabled only while animating.
	bAutoActivate = true;

	SpringArm = CreateDefaultSubobject<USpringArmComponent>(TEXT("SpringArm"));
	SpringArm->SetupAttachment(this);
	SpringArm->TargetArmLength = 400.0f;
	SpringArm->SocketOffset = FVector(0.0f, 55.0f, 45.0f);
	SpringArm->bUsePawnControlRotation = true;
	SpringArm->bInheritPitch = false;
	SpringArm->bInheritYaw = false;
	SpringArm->bInheritRoll = false;
	SpringArm->bDoCollisionTest = true;
	SpringArm->ProbeChannel = ECC_Camera;
	SpringArm->ProbeSize = 12.0f;
	SpringArm->bEnableCameraLag = false;
	SpringArm->bEnableCameraRotationLag = false;

	Camera = CreateDefaultSubobject<UCameraComponent>(TEXT("Camera"));
	Camera->SetupAttachment(SpringArm, USpringArmComponent::SocketName);
	Camera->bUsePawnControlRotation = false;
	Camera->FieldOfView = 90.0f;
	Camera->bFindCameraComponentWhenViewTarget = true;
	Camera->SetRelativeLocationAndRotation(FVector::ZeroVector, FRotator::ZeroRotator);

	Modes.SetNum(1); // Default mode, authored values below.
	Modes[0].ModeId = TEXT("Default");

	AppliedArmLength = Modes[0].ArmLength;
	AppliedFieldOfView = Modes[0].FieldOfView;
}

void UOpenWorldCameraRigComponent::BeginPlay()
{
	Super::BeginPlay();

	if (Modes.Num() == 0)
	{
		Modes.AddDefaulted();
		UE_LOG(LogPlayer, Warning, TEXT("Camera rig had no modes; added an empty default."));
	}

	ActiveModeIndex = 0;
	ModeStack.Reset();
	ModeStack.Add(Modes[0].ModeId);

	CurrentPose = Modes[0];
	BlendTarget = Modes[0];
	ApplyModeInstant(Modes[0]);
	RefreshTickState();
}

void UOpenWorldCameraRigComponent::TickComponent(float DeltaTime, ELevelTick TickType, FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	// Gait bonus is always interpolating toward its target, even outside a mode
	// blend, so sprint FOV kicks in and out smoothly.
	if (!FMath::IsNearlyEqual(CurrentGaitFOVBonus, TargetGaitFOVBonus) ||
		!FMath::IsNearlyEqual(CurrentGaitArmBonus, TargetGaitArmBonus))
	{
		const float Alpha = FMath::Clamp(DeltaTime * GaitBlendSpeed, 0.0f, 1.0f);
		CurrentGaitFOVBonus = FMath::Lerp(CurrentGaitFOVBonus, TargetGaitFOVBonus, Alpha);
		CurrentGaitArmBonus = FMath::Lerp(CurrentGaitArmBonus, TargetGaitArmBonus, Alpha);
		ApplyModeInstant(bIsBlending ? BlendTarget : CurrentPose);
	}

	if (bIsBlending)
	{
		UpdateBlend(DeltaTime);
	}

	RefreshTickState();
}

int32 UOpenWorldCameraRigComponent::FindModeIndex(FName ModeId) const
{
	return Modes.IndexOfByPredicate([ModeId](const FOpenWorldCameraMode& Mode)
	{
		return Mode.ModeId == ModeId;
	});
}

const FOpenWorldCameraMode& UOpenWorldCameraRigComponent::GetActiveMode() const
{
	const int32 Index = Modes.IsValidIndex(ActiveModeIndex) ? ActiveModeIndex : 0;
	return Modes.IsValidIndex(Index) ? Modes[Index] : Modes[0];
}

FName UOpenWorldCameraRigComponent::GetActiveModeId() const
{
	return GetActiveMode().ModeId;
}

bool UOpenWorldCameraRigComponent::SetMode(FName ModeId)
{
	const int32 Index = FindModeIndex(ModeId);
	if (Index == INDEX_NONE)
	{
		UE_LOG(LogPlayer, Warning, TEXT("Camera mode '%s' is not defined on rig '%s'."), *ModeId.ToString(), *GetNameSafe(GetOwner()));
		return false;
	}

	ActiveModeIndex = Index;
	ModeStack.Reset();
	ModeStack.Add(ModeId);

	BeginBlendTo(Modes[Index]);
	return true;
}

bool UOpenWorldCameraRigComponent::PushMode(FName ModeId)
{
	const int32 Index = FindModeIndex(ModeId);
	if (Index == INDEX_NONE)
	{
		UE_LOG(LogPlayer, Warning, TEXT("Cannot push unknown camera mode '%s'."), *ModeId.ToString());
		return false;
	}

	// Re-pushing the current mode is a no-op; it would otherwise grow the stack
	// forever if a system pushes on every focus event.
	if (ModeStack.Num() > 0 && ModeStack.Last() == ModeId)
	{
		return true;
	}

	ModeStack.Add(ModeId);
	ActiveModeIndex = Index;
	BeginBlendTo(Modes[Index]);
	return true;
}

void UOpenWorldCameraRigComponent::PopMode()
{
	if (ModeStack.Num() <= 1)
	{
		return; // Never pop below the base mode.
	}

	ModeStack.Pop();
	const int32 Index = FindModeIndex(ModeStack.Last());
	if (Index != INDEX_NONE)
	{
		ActiveModeIndex = Index;
		BeginBlendTo(Modes[Index]);
	}
}

void UOpenWorldCameraRigComponent::SetGaitCameraBonus(float FieldOfViewBonus, float ArmLengthBonus)
{
	TargetGaitFOVBonus = FieldOfViewBonus;
	TargetGaitArmBonus = ArmLengthBonus;
	RefreshTickState();
}

void UOpenWorldCameraRigComponent::ApplyModeInstant(const FOpenWorldCameraMode& Mode)
{
	if (!SpringArm || !Camera)
	{
		return;
	}

	CurrentPose = Mode;

	AppliedArmLength = FMath::Max(0.0f, Mode.ArmLength + CurrentGaitArmBonus);
	AppliedFieldOfView = FMath::Clamp(Mode.FieldOfView + CurrentGaitFOVBonus, 10.0f, 170.0f);

	SpringArm->TargetArmLength = AppliedArmLength;
	SpringArm->SocketOffset = Mode.SocketOffset;
	SpringArm->bDoCollisionTest = Mode.bDoCollisionTest;
	SpringArm->ProbeSize = Mode.CollisionProbeSize;
	SpringArm->bUsePawnControlRotation = Mode.bUsePawnControlRotation;
	SpringArm->bEnableCameraLag = Mode.bEnableCameraLag;
	SpringArm->CameraLagSpeed = Mode.CameraLagSpeed;
	SpringArm->bEnableCameraRotationLag = Mode.bEnableCameraRotationLag;
	SpringArm->CameraRotationLagSpeed = Mode.CameraRotationLagSpeed;

	Camera->SetRelativeLocation(Mode.CameraOffset);
	Camera->SetFieldOfView(AppliedFieldOfView);
}

void UOpenWorldCameraRigComponent::BeginBlendTo(const FOpenWorldCameraMode& Mode)
{
	BlendFrom = CurrentPose;
	BlendTarget = Mode;
	BlendDuration = FMath::Max(0.0f, Mode.BlendTime);

	if (BlendDuration <= KINDA_SMALL_NUMBER)
	{
		bIsBlending = false;
		ApplyModeInstant(Mode);
	}
	else
	{
		bIsBlending = true;
		BlendTimeRemaining = BlendDuration;
	}

	RefreshTickState();
}

void UOpenWorldCameraRigComponent::UpdateBlend(float DeltaTime)
{
	BlendTimeRemaining = FMath::Max(0.0f, BlendTimeRemaining - DeltaTime);
	const float Alpha = BlendDuration > KINDA_SMALL_NUMBER
		? FMath::Clamp(1.0f - (BlendTimeRemaining / BlendDuration), 0.0f, 1.0f)
		: 1.0f;

	// Ease-out: camera moves settle instead of stopping dead, which is what makes
	// third person cameras feel expensive rather than cheap.
	const float EasedAlpha = FMath::InterpEaseOut(0.0f, 1.0f, Alpha, 2.0f);

	FOpenWorldCameraMode Interpolated = BlendTarget;
	Interpolated.ArmLength = FMath::Lerp(BlendFrom.ArmLength, BlendTarget.ArmLength, EasedAlpha);
	Interpolated.FieldOfView = FMath::Lerp(BlendFrom.FieldOfView, BlendTarget.FieldOfView, EasedAlpha);
	Interpolated.SocketOffset = FVector::Lerp(BlendFrom.SocketOffset, BlendTarget.SocketOffset, EasedAlpha);
	Interpolated.CameraOffset = FVector::Lerp(BlendFrom.CameraOffset, BlendTarget.CameraOffset, EasedAlpha);
	Interpolated.CollisionProbeSize = FMath::Lerp(BlendFrom.CollisionProbeSize, BlendTarget.CollisionProbeSize, EasedAlpha);

	ApplyModeInstant(Interpolated);

	if (BlendTimeRemaining <= KINDA_SMALL_NUMBER)
	{
		bIsBlending = false;
		ApplyModeInstant(BlendTarget);
	}
}

FVector UOpenWorldCameraRigComponent::GetCameraWorldLocation() const
{
	return Camera ? Camera->GetComponentLocation() : GetComponentLocation();
}

FVector UOpenWorldCameraRigComponent::GetCameraForwardVector() const
{
	return Camera ? Camera->GetForwardVector() : GetForwardVector();
}

void UOpenWorldCameraRigComponent::RefreshTickState()
{
	const bool bWantsTick = bIsBlending
		|| !FMath::IsNearlyEqual(CurrentGaitFOVBonus, TargetGaitFOVBonus)
		|| !FMath::IsNearlyEqual(CurrentGaitArmBonus, TargetGaitArmBonus);

	if (IsComponentTickEnabled() != bWantsTick)
	{
		SetComponentTickEnabled(bWantsTick);
	}
}
