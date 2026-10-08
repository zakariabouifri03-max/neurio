// Copyright GameProject. All rights reserved. Original content only.

#include "Player/OpenWorldCharacterAnimInstance.h"

#include "Core/GameProjectLog.h"
#include "GameFramework/CharacterMovementComponent.h"

void UOpenWorldCharacterAnimInstance::NativeInitializeAnimation()
{
	Super::NativeInitializeAnimation();

	OwnerCharacter = Cast<AOpenWorldPlayerCharacter>(TryGetPawnOwner());
	if (!OwnerCharacter)
	{
		UE_LOG(LogPlayer, Verbose, TEXT("OpenWorldCharacterAnimInstance initialised on a non-player pawn."));
	}
}

void UOpenWorldCharacterAnimInstance::NativeUpdateAnimation(float DeltaSeconds)
{
	Super::NativeUpdateAnimation(DeltaSeconds);

	if (DeltaSeconds <= 0.0f)
	{
		return;
	}

	// The pawn can change under a reused anim instance (respawn, possess), so this
	// is a null check plus an assignment - not a per-frame search.
	if (!OwnerCharacter)
	{
		OwnerCharacter = Cast<AOpenWorldPlayerCharacter>(TryGetPawnOwner());
		if (!OwnerCharacter)
		{
			return;
		}
	}

	const FVector Velocity = OwnerCharacter->GetVelocity();
	const UCharacterMovementComponent* Movement = OwnerCharacter->GetCharacterMovement();

	Speed = Velocity.Size();
	HorizontalSpeed = OwnerCharacter->GetHorizontalSpeed();
	VerticalSpeed = Velocity.Z;
	bIsInAir = Movement ? Movement->IsFalling() : false;
	bIsCrouching = OwnerCharacter->bIsCrouched;
	Gait = OwnerCharacter->GetCurrentGait();
	bIsSprinting = (Gait == EOpenWorldGait::Sprint);

	if (Movement && HorizontalSpeed > KINDA_SMALL_NUMBER)
	{
		// Decompose velocity into the pawn's local frame: this is exactly the pair of
		// values a strafe blend space wants, computed once per frame instead of in
		// three separate anim graph nodes.
		const FVector LocalVelocity = OwnerCharacter->GetActorTransform().InverseTransformVectorNoScale(Velocity);
		Strafe = FMath::Clamp(LocalVelocity.Y / FMath::Max(HorizontalSpeed, KINDA_SMALL_NUMBER), -1.0f, 1.0f);
		DirectionAngle = FMath::RadiansToDegrees(FMath::Atan2(LocalVelocity.Y, LocalVelocity.X));
	}
	else
	{
		Strafe = 0.0f;
		DirectionAngle = 0.0f;
	}
}
