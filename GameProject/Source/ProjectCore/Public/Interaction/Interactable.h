// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "UObject/Interface.h"
#include "GameplayTagContainer.h"
#include "Interaction/InteractionTypes.h"
#include "Interactable.generated.h"

class AActor;

UINTERFACE(BlueprintType, Blueprintable, meta = (DisplayName = "Interactable"))
class UInteractable : public UInterface
{
	GENERATED_BODY()
};

/**
 * The contract every interactable thing in the game implements: doors, vehicles,
 * shops, NPCs, furniture, mission objects, pickups, buildings.
 *
 * Design rules that keep this scalable:
 *  - The interactable decides *whether* it can be used and *what happens*; the
 *    interaction component only decides *what is focused*. Neither knows the
 *    other's concrete type, so new interactable kinds never touch the player.
 *  - Everything is a BlueprintNativeEvent, so designers can author new
 *    interactables entirely in Blueprint while C++ systems keep working.
 *  - Focus gain/loss hooks exist so an object can highlight itself, play a sound
 *    or face the player without polling.
 */
class PROJECTCORE_API IInteractable
{
	GENERATED_BODY()

public:
	/** Whether the interaction is currently available to this instigator. */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Interaction")
	bool CanInteract(const AActor* Instigator) const;
	virtual bool CanInteract_Implementation(const AActor* Instigator) const { return true; }

	/** Performs the interaction. Return false to report a refusal to the UI. */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Interaction")
	bool Interact(const FInteractionContext& Context);
	virtual bool Interact_Implementation(const FInteractionContext& Context) { return false; }

	/** What the HUD should display while this object is focused. */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Interaction")
	FInteractionPrompt GetInteractionPrompt(const AActor* Instigator) const;

	/** Higher wins when several interactables are inside the probe volume. */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Interaction")
	float GetInteractionPriority() const;
	virtual float GetInteractionPriority_Implementation() const { return 0.0f; }

	/** Category tags (Interaction.Category.*), used for HUD icons and filtering. */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Interaction")
	FGameplayTagContainer GetInteractionTags() const;

	/** Called by the interaction component when this object becomes the focus. */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Interaction")
	void OnInteractionFocusGained(const AActor* Instigator);
	virtual void OnInteractionFocusGained_Implementation(const AActor* Instigator) {}

	/** Called when focus moves away (or the instigator stops looking at it). */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Interaction")
	void OnInteractionFocusLost(const AActor* Instigator);
	virtual void OnInteractionFocusLost_Implementation(const AActor* Instigator) {}

	/**
	 * True when this object should hide other interactables behind it. A large
	 * shop building, for example, returns false so the door inside it can still be
	 * focused through the doorway.
	 */
	UFUNCTION(BlueprintNativeEvent, BlueprintCallable, Category = "Interaction")
	bool IsInteractionOccluder() const;
	virtual bool IsInteractionOccluder_Implementation() const { return true; }

	// ------------------------------------------------------------- helpers
	/** Cheap "does this actor speak Interactable?" test. No allocation, no reflection walk. */
	static bool Implements(const AActor* Actor)
	{
		return Actor && Actor->GetClass() && Actor->GetClass()->ImplementsInterface(UInteractable::StaticClass());
	}
};
