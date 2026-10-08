// Copyright GameProject. All rights reserved. Original content only.

#include "Interaction/InteractableTestActor.h"

#include "Components/StaticMeshComponent.h"
#include "Core/GameProjectBlueprintLibrary.h"
#include "Core/GameProjectLog.h"
#include "Core/GameProjectTags.h"
#include "Engine/StaticMesh.h"

AInteractableTestActor::AInteractableTestActor()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.bStartWithTickEnabled = false; // Only while the door animates.

	Hinge = CreateDefaultSubobject<USceneComponent>(TEXT("Hinge"));
	RootComponent = Hinge;
	Hinge->SetMobility(EComponentMobility::Static);

	Mesh = CreateDefaultSubobject<UStaticMeshComponent>(TEXT("Mesh"));
	Mesh->SetupAttachment(Hinge);
	Mesh->SetMobility(EComponentMobility::Movable);
	Mesh->SetCollisionEnabled(ECollisionEnabled::QueryAndPhysics);
	Mesh->SetCollisionProfileName(TEXT("InteractableActor"));
	Mesh->SetGenerateOverlapEvents(false);

	ActionVerb = FText::FromString(TEXT("Open"));
	TargetName = FText::FromString(TEXT("Test Door"));
}

void AInteractableTestActor::BeginPlay()
{
	Super::BeginPlay();

	// Tags are resolved at BeginPlay rather than in the constructor: the gameplay
	// tag registry is not guaranteed to be populated while CDOs are constructed.
	if (InteractionTags.IsEmpty())
	{
		InteractionTags.AddTag(GameProjectTags::InteractionCategoryDoor());
	}

	EnsurePlaceholderVisuals();
	SetDoorTickEnabled(false);
}

void AInteractableTestActor::EnsurePlaceholderVisuals()
{
	if (Mesh->GetStaticMesh())
	{
		Mesh->SetRelativeLocation(HingeOffset);
		Mesh->SetRelativeScale3D(FVector(BlockSize / 100.0f, BlockSize / 100.0f, BlockSize / 100.0f));
		return;
	}

	if (UStaticMesh* Cube = UGameProjectBlueprintLibrary::GetPlaceholderCubeMesh())
	{
		Mesh->SetStaticMesh(Cube);
		Mesh->SetRelativeLocation(HingeOffset);
		// The engine cube is 100 units on a side, so this scales it to BlockSize.
		Mesh->SetRelativeScale3D(FVector(BlockSize / 100.0f));
	}
	else
	{
		UE_LOG(LogInteraction, Warning, TEXT("InteractableTestActor '%s' has no mesh and no engine cube fallback."), *GetName());
	}
}

void AInteractableTestActor::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	UpdateDoorAnimation(DeltaSeconds);
}

void AInteractableTestActor::UpdateDoorAnimation(float DeltaSeconds)
{
	const float TargetAngle = bIsOpen ? OpenAngle : 0.0f;
	if (FMath::IsNearlyEqual(CurrentHingeAngle, TargetAngle, 0.01f))
	{
		CurrentHingeAngle = TargetAngle;
		Hinge->SetRelativeRotation(FRotator(0.0f, CurrentHingeAngle, 0.0f));
		SetDoorTickEnabled(false);
		return;
	}

	CurrentHingeAngle = FMath::FixedTurn(CurrentHingeAngle, TargetAngle, OpenSpeed * DeltaSeconds);
	Hinge->SetRelativeRotation(FRotator(0.0f, CurrentHingeAngle, 0.0f));
}

void AInteractableTestActor::SetDoorTickEnabled(bool bEnabled)
{
	if (PrimaryActorTick.IsTickFunctionEnabled() != bEnabled)
	{
		PrimaryActorTick.SetTickFunctionEnable(bEnabled);
	}
}

bool AInteractableTestActor::CanInteract_Implementation(const AActor* Instigator) const
{
	// A door is always usable while enabled: opening and closing are the same verb.
	return bInteractionEnabled;
}

bool AInteractableTestActor::Interact_Implementation(const FInteractionContext& Context)
{
	if (!bInteractionEnabled)
	{
		return false;
	}

	++InteractionCount;
	bIsOpen = !bIsOpen;

	// Only the hinge animates, so ticking resumes for the duration of the swing.
	SetDoorTickEnabled(true);

	UE_LOG(LogInteraction, Log, TEXT("TestInteractable '%s' used by '%s' (count=%d, open=%s)"),
		*GetName(), *GetNameSafe(Context.Instigator), InteractionCount, bIsOpen ? TEXT("yes") : TEXT("no"));

	OnInteracted.Broadcast(Context.Instigator, InteractionCount);

	if (bDestroyOnInteract)
	{
		SetLifeSpan(0.01f);
	}
	return true;
}

FInteractionPrompt AInteractableTestActor::GetInteractionPrompt_Implementation(const AActor* Instigator) const
{
	FInteractionPrompt Prompt;
	// A real door reads "Close" once it is open; the prompt is built per focus, so
	// the HUD never has to be told about state changes.
	Prompt.ActionVerb = (bIsOpen && OpenAngle > 0.0f) ? FText::FromString(TEXT("Close")) : ActionVerb;
	Prompt.TargetName = TargetName;
	Prompt.DetailText = DetailText;
	Prompt.Category = InteractionTags.IsEmpty() ? FGameplayTag() : InteractionTags.First();
	Prompt.bIsValid = bInteractionEnabled;
	return Prompt;
}

float AInteractableTestActor::GetInteractionPriority_Implementation() const
{
	return InteractionPriority;
}

FGameplayTagContainer AInteractableTestActor::GetInteractionTags_Implementation() const
{
	return InteractionTags;
}

void AInteractableTestActor::OnInteractionFocusGained_Implementation(const AActor* Instigator)
{
	UE_LOG(LogInteraction, Verbose, TEXT("Focus gained on '%s'."), *GetName());
}

void AInteractableTestActor::OnInteractionFocusLost_Implementation(const AActor* Instigator)
{
	UE_LOG(LogInteraction, Verbose, TEXT("Focus lost on '%s'."), *GetName());
}

bool AInteractableTestActor::IsInteractionOccluder_Implementation() const
{
	return bBlocksInteractionProbe;
}

void AInteractableTestActor::SetInteractionEnabled(bool bEnabled)
{
	bInteractionEnabled = bEnabled;
}
