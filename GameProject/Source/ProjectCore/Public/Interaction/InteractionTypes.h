// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "GameplayTagContainer.h"
#include "InteractionTypes.generated.h"

class AActor;

/** Outcome of an interaction attempt. Lets callers react without string compares. */
UENUM(BlueprintType)
enum class EInteractionResult : uint8
{
	Success				UMETA(DisplayName = "Success"),
	Refused				UMETA(DisplayName = "Refused by target"),
	NothingFocused		UMETA(DisplayName = "Nothing focused"),
	OutOfRange			UMETA(DisplayName = "Out of range"),
	AlreadyInProgress	UMETA(DisplayName = "Already in progress")
};

/**
 * What the UI should show while an interactable is focused.
 *
 * The UI never invents this text and the gameplay code never formats a string
 * like "Press E to ...": the prompt carries the verb and the category, and the
 * widget decides how to present it (key glyph, controller glyph, hold ring).
 * That is what keeps the HUD replaceable.
 */
USTRUCT(BlueprintType)
struct FInteractionPrompt
{
	GENERATED_BODY()

	/** e.g. "Open", "Talk to", "Enter", "Buy". */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Prompt")
	FText ActionVerb;

	/** e.g. "Wooden Door", "Shop Keeper". Shown as the object name. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Prompt")
	FText TargetName;

	/** Optional extra line, e.g. a price or a requirement. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Prompt")
	FText DetailText;

	/** Category tag, so the HUD can pick an icon without knowing the actor type. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Prompt")
	FGameplayTag Category;

	/** >0 means the player must hold the key; the HUD shows a progress ring. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Prompt", meta = (ClampMin = "0.0"))
	float HoldDuration = 0.0f;

	UPROPERTY(BlueprintReadOnly, Category = "Prompt")
	bool bIsValid = false;

	void Reset()
	{
		ActionVerb = FText::GetEmpty();
		TargetName = FText::GetEmpty();
		DetailText = FText::GetEmpty();
		Category = FGameplayTag();
		HoldDuration = 0.0f;
		bIsValid = false;
	}
};

/** Everything an interactable is told about who interacted with it, and how. */
USTRUCT(BlueprintType)
struct FInteractionContext
{
	GENERATED_BODY()

	/** Who triggered the interaction (usually the player character). */
	UPROPERTY(BlueprintReadOnly, Category = "Interaction")
	TObjectPtr<AActor> Instigator = nullptr;

	/** The object that was interacted with. */
	UPROPERTY(BlueprintReadOnly, Category = "Interaction")
	TObjectPtr<AActor> Target = nullptr;

	UPROPERTY(BlueprintReadOnly, Category = "Interaction")
	FVector HitLocation = FVector::ZeroVector;

	UPROPERTY(BlueprintReadOnly, Category = "Interaction")
	FVector HitNormal = FVector::ZeroVector;

	/** Distance from the probe origin to the hit, in cm. */
	UPROPERTY(BlueprintReadOnly, Category = "Interaction")
	float Distance = 0.0f;

	/**
	 * Reserved for future phases: which input/ability triggered this (context
	 * menu, mission script, vehicle). Empty in Phase 01.
	 */
	UPROPERTY(BlueprintReadWrite, Category = "Interaction")
	FGameplayTag SourceTag;
};
