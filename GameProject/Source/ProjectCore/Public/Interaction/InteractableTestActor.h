// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Interaction/Interactable.h"
#include "InteractableTestActor.generated.h"

class UStaticMeshComponent;
class USceneComponent;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnTestInteractableUsed, AActor*, Instigator, int32, InteractionCount);

/**
 * Phase 01 reference implementation of IInteractable.
 *
 * It exists to prove the framework end to end (focus -> prompt -> HUD -> execute
 * -> feedback) and to give future interactables a small, readable example to
 * copy. It deliberately does not know anything about the player: it only reacts
 * to the FInteractionContext it is handed.
 *
 * Default behaviour is a door-style swing, because that exercises the two things
 * every real interactable will need: a state toggle and a visible response.
 */
UCLASS()
class PROJECTCORE_API AInteractableTestActor : public AActor, public IInteractable
{
	GENERATED_BODY()

public:
	AInteractableTestActor();

	//~ Begin AActor
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;
	//~ End AActor

	//~ Begin IInteractable
	virtual bool CanInteract_Implementation(const AActor* Instigator) const override;
	virtual bool Interact_Implementation(const FInteractionContext& Context) override;
	virtual FInteractionPrompt GetInteractionPrompt_Implementation(const AActor* Instigator) const override;
	virtual float GetInteractionPriority_Implementation() const override;
	virtual FGameplayTagContainer GetInteractionTags_Implementation() const override;
	virtual void OnInteractionFocusGained_Implementation(const AActor* Instigator) override;
	virtual void OnInteractionFocusLost_Implementation(const AActor* Instigator) override;
	virtual bool IsInteractionOccluder_Implementation() const override;
	//~ End IInteractable

	// ------------------------------------------------------------- designer data
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Interaction")
	FText ActionVerb;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Interaction")
	FText TargetName;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Interaction")
	FText DetailText;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Interaction")
	FGameplayTagContainer InteractionTags;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Interaction")
	float InteractionPriority = 0.0f;

	/** False makes the object visible but inert (locked door, closed shop). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Interaction")
	bool bInteractionEnabled = true;

	/** Lets the probe see through this actor to interactables behind it. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Interaction")
	bool bBlocksInteractionProbe = true;

	/** Removes the actor after a successful interaction (pickups use this). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Interaction|Behaviour")
	bool bDestroyOnInteract = false;

	// ------------------------------------------------------------- door behaviour
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Door", meta = (ClampMin = "0.0", ClampMax = "180.0"))
	float OpenAngle = 90.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Door", meta = (ClampMin = "1.0"))
	float OpenSpeed = 220.0f;

	/** Offset of the mesh from the hinge, so the swing looks like a door and not a spin. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Door")
	FVector HingeOffset = FVector(50.0f, 0.0f, 0.0f);

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Door")
	float BlockSize = 100.0f;

	// ------------------------------------------------------------- runtime state
	UPROPERTY(BlueprintReadOnly, Category = "Interaction|State")
	int32 InteractionCount = 0;

	UPROPERTY(BlueprintReadOnly, Category = "Interaction|State")
	bool bIsOpen = false;

	UPROPERTY(BlueprintAssignable, Category = "Interaction|State")
	FOnTestInteractableUsed OnInteracted;

	/** Set to false in Blueprint to test the "refused" path in the HUD. */
	UFUNCTION(BlueprintCallable, Category = "GameProject|Interaction")
	void SetInteractionEnabled(bool bEnabled);

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
	TObjectPtr<USceneComponent> Hinge;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
	TObjectPtr<UStaticMeshComponent> Mesh;

protected:
	/** Drives the swing. Tick is enabled only while the door is actually moving. */
	void UpdateDoorAnimation(float DeltaSeconds);
	void SetDoorTickEnabled(bool bEnabled);
	void EnsurePlaceholderVisuals();

	float CurrentHingeAngle = 0.0f;
};
