// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Player/BCUInteractionComponent.h"

#include "Vehicle/BCUBaseVehicle.h"
#include "AI/BCUNPCCharacter.h"
#include "Camera/CameraComponent.h"
#include "GameFramework/PlayerController.h"
#include "Kismet/GameplayStatics.h"

UBCUInteractionComponent::UBCUInteractionComponent()
{
	PrimaryComponentTick.bCanEverTick = false; // driven by the controller tick
}

void UBCUInteractionComponent::BeginPlay()
{
	Super::BeginPlay();
}

void UBCUInteractionComponent::UpdateFocus(float DeltaSeconds)
{
	UpdateTimer += DeltaSeconds;
	if (UpdateTimer < 0.08f) { return; } // ~12 Hz is plenty for a prompt
	UpdateTimer = 0.0f;

	const AActor* Owner = GetOwner();
	const APawn* OwnerPawn = Cast<APawn>(Owner);
	if (!OwnerPawn) { return; }

	const APlayerController* PC = Cast<APlayerController>(OwnerPawn->GetController());
	if (!PC) { return; }

	FVector EyeLocation;
	FRotator EyeRotation;
	PC->GetPlayerViewPoint(EyeLocation, EyeRotation);
	const FVector ViewDirection = EyeRotation.Vector();

	// One overlap, then score. Cheaper than iterating the world and precise
	// enough that the prompt never flickers between two cars.
	TArray<FOverlapResult> Overlaps;
	FCollisionQueryParams Params(SCENE_QUERY_STAT(BCUInteract), false, Owner);

	GetWorld()->OverlapMultiByChannel(Overlaps,
		EyeLocation + ViewDirection * (InteractionRadius * 0.5f),
		FQuat::Identity, ECC_Visibility,
		FCollisionShape::MakeSphere(InteractionRadius * 0.6f), Params);

	AActor* Best = nullptr;
	EBCUInteractionKind BestKind = EBCUInteractionKind::None;
	float BestScore = TNumericLimits<float>::Lowest();

	for (const FOverlapResult& Overlap : Overlaps)
	{
		AActor* Candidate = Overlap.GetActor();
		if (!Candidate || Candidate == Owner) { continue; }

		const EBCUInteractionKind Kind = ClassifyActor(Candidate);
		if (Kind == EBCUInteractionKind::None) { continue; }

		const float Score = ScoreCandidate(Candidate, EyeLocation, ViewDirection);
		if (Score <= KINDA_SMALL_NUMBER) { continue; }

		if (Score > BestScore)
		{
			BestScore = Score;
			Best = Candidate;
			BestKind = Kind;
		}
	}

	// Hysteresis: keep the current focus unless a candidate clearly beats it.
	if (FocusedActor && Best != FocusedActor && BestScore < 1.35f)
	{
		const float CurrentScore = ScoreCandidate(FocusedActor, EyeLocation, ViewDirection);
		if (CurrentScore > 0.4f * BestScore)
		{
			return;
		}
	}

	SetFocus(Best, BestKind);
}

EBCUInteractionKind UBCUInteractionComponent::ClassifyActor(AActor* Actor) const
{
	if (!Actor) { return EBCUInteractionKind::None; }

	if (Actor->IsA(ABCUBaseVehicle::StaticClass()))
	{
		const ABCUBaseVehicle* Vehicle = CastChecked<ABCUBaseVehicle>(Actor);
		return Vehicle->HasDriver() ? EBCUInteractionKind::None : EBCUInteractionKind::EnterVehicle;
	}

	if (const ABCUNPCCharacter* NPC = Cast<ABCUNPCCharacter>(Actor))
	{
		if (NPC->OfferedMissionId.IsValid()) { return EBCUInteractionKind::MissionGiver; }
		if (NPC->ShopId.IsValid()) { return EBCUInteractionKind::Shop; }
		if (NPC->Role == EBCUNPCRole::Mechanic) { return EBCUInteractionKind::Garage; }
		return EBCUInteractionKind::NPC;
	}

	// Tagged level actors are the cheapest way to author interactables.
	if (Actor->ActorHasTag(TEXT("BCU.Interact.Door")))		{ return EBCUInteractionKind::Door; }
	if (Actor->ActorHasTag(TEXT("BCU.Interact.Safehouse")))	{ return EBCUInteractionKind::Safehouse; }
	if (Actor->ActorHasTag(TEXT("BCU.Interact.Respray")))	{ return EBCUInteractionKind::PayAndSpray; }
	if (Actor->ActorHasTag(TEXT("BCU.Interact.Fuel")))		{ return EBCUInteractionKind::FuelPump; }
	if (Actor->ActorHasTag(TEXT("BCU.Interact.ATM")))		{ return EBCUInteractionKind::ATM; }
	if (Actor->ActorHasTag(TEXT("BCU.Interact.Vending")))	{ return EBCUInteractionKind::VendingMachine; }
	if (Actor->ActorHasTag(TEXT("BCU.Interact.Pickup")))	{ return EBCUInteractionKind::Pickup; }
	if (Actor->ActorHasTag(TEXT("BCU.Interact.Garage")))	{ return EBCUInteractionKind::Garage; }

	return EBCUInteractionKind::None;
}

float UBCUInteractionComponent::ScoreCandidate(AActor* Actor, const FVector& EyeLocation,
	const FVector& ViewDirection) const
{
	const FVector ToActor = Actor->GetActorLocation() - EyeLocation;
	const float Distance = ToActor.Size();
	if (Distance > InteractionRadius || Distance < KINDA_SMALL_NUMBER) { return 0.0f; }

	// Must be inside the view cone.
	const float Dot = FVector::DotProduct(ViewDirection, ToActor.GetSafeNormal());
	const float MinDot = FMath::Cos(FMath::DegreesToRadians(ViewConeDegrees));
	if (Dot < MinDot) { return 0.0f; }

	// Optional line of sight: a car behind a wall must not be enterable.
	if (bRequireLineOfSight)
	{
		FHitResult Hit;
		FCollisionQueryParams Params(SCENE_QUERY_STAT(BCUInteractLOS), false, GetOwner());
		if (GetWorld()->LineTraceSingleByChannel(Hit, EyeLocation, Actor->GetActorLocation(),
				ECC_Visibility, Params)
			&& Hit.GetActor() != Actor)
		{
			return 0.0f;
		}
	}

	// Prefer central over near, so the prompt locks onto what the player means.
	const float Centrality = (Dot - MinDot) / FMath::Max(KINDA_SMALL_NUMBER, 1.0f - MinDot);
	const float Proximity = 1.0f - (Distance / InteractionRadius);
	return Centrality * 1.6f + Proximity;
}

FText UBCUInteractionComponent::PromptForKind(EBCUInteractionKind Kind, AActor* Actor) const
{
	switch (Kind)
	{
	case EBCUInteractionKind::EnterVehicle:
	{
		const ABCUBaseVehicle* Vehicle = Cast<ABCUBaseVehicle>(Actor);
		return FText::Format(
			NSLOCTEXT("BCU", "Prompt_Enter", "Enter {0}"),
			Vehicle && Vehicle->GetDefinition()
				? Vehicle->GetDefinition()->DisplayName
				: FText::FromString(TEXT("vehicle")));
	}
	case EBCUInteractionKind::Door:			return NSLOCTEXT("BCU", "Prompt_Door", "Enter");
	case EBCUInteractionKind::NPC:			return NSLOCTEXT("BCU", "Prompt_Talk", "Talk");
	case EBCUInteractionKind::Shop:			return NSLOCTEXT("BCU", "Prompt_Shop", "Browse store");
	case EBCUInteractionKind::Garage:		return NSLOCTEXT("BCU", "Prompt_Garage", "Open garage");
	case EBCUInteractionKind::Safehouse:	return NSLOCTEXT("BCU", "Prompt_Save", "Save and rest");
	case EBCUInteractionKind::PayAndSpray:	return NSLOCTEXT("BCU", "Prompt_Respray", "Respray vehicle");
	case EBCUInteractionKind::MissionGiver:	return NSLOCTEXT("BCU", "Prompt_Mission", "Talk");
	case EBCUInteractionKind::Pickup:		return NSLOCTEXT("BCU", "Prompt_Pickup", "Pick up");
	case EBCUInteractionKind::FuelPump:		return NSLOCTEXT("BCU", "Prompt_Fuel", "Refuel");
	case EBCUInteractionKind::ATM:			return NSLOCTEXT("BCU", "Prompt_ATM", "Withdraw cash");
	case EBCUInteractionKind::VendingMachine: return NSLOCTEXT("BCU", "Prompt_Vending", "Buy a drink");
	default:								return FText::GetEmpty();
	}
}

void UBCUInteractionComponent::SetFocus(AActor* NewFocus, EBCUInteractionKind Kind)
{
	if (NewFocus == FocusedActor && Kind == FocusedKind) { return; }

	FocusedActor = NewFocus;
	FocusedKind = Kind;
	PromptText = PromptForKind(Kind, NewFocus);

	OnFocusChanged.Broadcast(NewFocus, Kind);
}

void UBCUInteractionComponent::ActivateFocused()
{
	if (!FocusedActor) { return; }

	APawn* OwnerPawn = Cast<APawn>(GetOwner());
	if (!OwnerPawn) { return; }

	switch (FocusedKind)
	{
	case EBCUInteractionKind::EnterVehicle:
		if (const APlayerController* PC = Cast<APlayerController>(OwnerPawn->GetController()))
		{
			// The controller owns vehicle entry so the input-context swap
			// happens in exactly one place.
			if (ABCUBaseVehicle* Vehicle = Cast<ABCUBaseVehicle>(FocusedActor))
			{
				Cast<ABCUPlayerController>(const_cast<APlayerController*>(PC))
					->EnterVehicle(Vehicle, 0);
			}
		}
		break;

	case EBCUInteractionKind::NPC:
	case EBCUInteractionKind::MissionGiver:
	case EBCUInteractionKind::Shop:
		if (ABCUNPCCharacter* NPC = Cast<ABCUNPCCharacter>(FocusedActor))
		{
			NPC->Interact(OwnerPawn);
		}
		break;

	default:
		// Tagged world actors (doors, ATMs, pumps) implement IBCUInteractable or
		// listen to the focus delegate from Blueprint.
		break;
	}
}
