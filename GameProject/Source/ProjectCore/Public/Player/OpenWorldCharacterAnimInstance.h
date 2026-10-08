// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "Animation/AnimInstance.h"
#include "Player/OpenWorldPlayerCharacter.h"
#include "OpenWorldCharacterAnimInstance.generated.h"

/**
 * Animation data source for the player.
 *
 * Phase 01 ships no skeleton or animation assets, so nothing uses this yet - but
 * the anim graph contract is written now, because the alternative is a Phase 03
 * animator discovering that speed, gait and grounded state are not exposed and
 * having to change the character to get them.
 *
 * NativeUpdateAnimation does the (cheap) work; the Blueprint child only reads
 * these values. That is the standard split and it keeps the anim graph free of
 * pawn-casting nodes.
 */
UCLASS()
class PROJECTCORE_API UOpenWorldCharacterAnimInstance : public UAnimInstance
{
	GENERATED_BODY()

public:
	//~ Begin UAnimInstance
	virtual void NativeInitializeAnimation() override;
	virtual void NativeUpdateAnimation(float DeltaSeconds) override;
	//~ End UAnimInstance

	/** Cached on initialise; refreshed only if the pawn changes. */
	UPROPERTY(BlueprintReadOnly, Category = "GameProject|Animation")
	TObjectPtr<AOpenWorldPlayerCharacter> OwnerCharacter;

	UPROPERTY(BlueprintReadOnly, Category = "GameProject|Animation")
	float Speed = 0.0f;

	/** Horizontal speed only, so a jump does not read as a sprint. */
	UPROPERTY(BlueprintReadOnly, Category = "GameProject|Animation")
	float HorizontalSpeed = 0.0f;

	UPROPERTY(BlueprintReadOnly, Category = "GameProject|Animation")
	float VerticalSpeed = 0.0f;

	UPROPERTY(BlueprintReadOnly, Category = "GameProject|Animation")
	bool bIsInAir = false;

	UPROPERTY(BlueprintReadOnly, Category = "GameProject|Animation")
	bool bIsCrouching = false;

	UPROPERTY(BlueprintReadOnly, Category = "GameProject|Animation")
	bool bIsSprinting = false;

	UPROPERTY(BlueprintReadOnly, Category = "GameProject|Animation")
	EOpenWorldGait Gait = EOpenWorldGait::Run;

	/** -1..1 strafe, for a strafe blend space. */
	UPROPERTY(BlueprintReadOnly, Category = "GameProject|Animation")
	float Strafe = 0.0f;

	/** Yaw delta between movement direction and facing, for turn-in-place. */
	UPROPERTY(BlueprintReadOnly, Category = "GameProject|Animation")
	float DirectionAngle = 0.0f;
};
