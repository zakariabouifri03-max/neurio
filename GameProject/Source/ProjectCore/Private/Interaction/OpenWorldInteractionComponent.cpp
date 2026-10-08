// Copyright GameProject. All rights reserved. Original content only.

#include "Interaction/OpenWorldInteractionComponent.h"

#include "Core/GameProjectLog.h"
#include "Core/GameProjectTags.h"
#include "CollisionQueryParams.h"
#include "Core/GameProjectSettings.h"
#include "DrawDebugHelpers.h"
#include "Engine/World.h"
#include "GameFramework/Pawn.h"
#include "GameFramework/PlayerController.h"
#include "Camera/PlayerCameraManager.h"
#include "Interaction/Interactable.h"
#include "Player/OpenWorldCameraRigComponent.h"
#include "TimerManager.h"

UOpenWorldInteractionComponent::UOpenWorldInteractionComponent()
{
	// Timer-driven on purpose: a UI prompt does not need a per-frame trace.
	PrimaryComponentTick.bCanEverTick = false;
	SetIsReplicatedByDefault(false);
}

void UOpenWorldInteractionComponent::BeginPlay()
{
	Super::BeginPlay();

	const UGameProjectSettings& Settings = UGameProjectSettings::Get();
	ResolvedTraceDistance = (TraceDistance > 0.0f) ? TraceDistance : Settings.InteractionTraceDistance;
	ResolvedTraceRadius = (TraceRadius >= 0.0f) ? TraceRadius : Settings.InteractionTraceRadius;
	ResolvedScanInterval = (ScanInterval > 0.0f) ? ScanInterval : Settings.InteractionScanInterval;

	ResolvedTraceChannel = (TraceChannel == ECC_MAX)
		? static_cast<ECollisionChannel>(Settings.InteractionTraceChannel.GetValue())
		: static_cast<ECollisionChannel>(TraceChannel.GetValue());

	CachedOwnerPawn = Cast<APawn>(GetOwner());
	if (CachedOwnerPawn)
	{
		// Cache the rig once. Searching for it per scan would be exactly the kind of
		// per-frame lookup this component exists to avoid.
		CachedCameraRig = CachedOwnerPawn->FindComponentByClass<UOpenWorldCameraRigComponent>();
	}

	StartScanning();
}

void UOpenWorldInteractionComponent::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	StopScanning();

	if (FocusedInteractable)
	{
		IInteractable::Execute_OnInteractionFocusLost(FocusedInteractable, CachedOwnerPawn);
	}
	CachedCameraRig = nullptr;
	CachedOwnerPawn = nullptr;

	Super::EndPlay(EndPlayReason);
}

void UOpenWorldInteractionComponent::StartScanning()
{
	UWorld* World = GetWorld();
	if (!World || ResolvedScanInterval <= 0.0f)
	{
		return;
	}

	if (!ScanTimerHandle.IsValid())
	{
		World->GetTimerManager().SetTimer(ScanTimerHandle, this,
			&UOpenWorldInteractionComponent::PerformScan, ResolvedScanInterval, /*bLoop*/ true);
	}
}

void UOpenWorldInteractionComponent::StopScanning()
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(ScanTimerHandle);
	}
	ScanTimerHandle.Invalidate();
	CancelHold();
	ClearFocus();
}

bool UOpenWorldInteractionComponent::BuildProbeRay(FVector& OutOrigin, FVector& OutDirection) const
{
	if (bTraceFromCamera)
	{
		if (CachedCameraRig)
		{
			OutOrigin = CachedCameraRig->GetCameraWorldLocation();
			OutDirection = CachedCameraRig->GetCameraForwardVector();
			return true;
		}

		if (const APlayerController* PC = CachedOwnerPawn ? Cast<APlayerController>(CachedOwnerPawn->GetController()) : nullptr)
		{
			if (const APlayerCameraManager* CameraManager = PC->PlayerCameraManager)
			{
				OutOrigin = CameraManager->GetCameraLocation();
				OutDirection = CameraManager->GetCameraRotation().Vector();
				return true;
			}
		}
	}

	if (CachedOwnerPawn)
	{
		OutOrigin = CachedOwnerPawn->GetPawnViewLocation();
		OutDirection = CachedOwnerPawn->GetViewRotation().Vector();
		return true;
	}

	return false;
}

AActor* UOpenWorldInteractionComponent::SelectBestCandidate(const TArray<FHitResult>& Hits, FInteractionContext& OutContext) const
{
	AActor* BestActor = nullptr;
	float BestPriority = -FLT_MAX;
	float BestDistance = FLT_MAX;

	// Hits arrive sorted by distance. Walk outward and stop at the first blocking
	// object that is not interactable: that is a wall between the player and
	// whatever is behind it.
	for (const FHitResult& Hit : Hits)
	{
		AActor* HitActor = Hit.GetActor();
		if (!HitActor || HitActor == CachedOwnerPawn)
		{
			continue;
		}

		const bool bIsInteractable = IInteractable::Implements(HitActor);
		if (!bIsInteractable)
		{
			break; // Occluded.
		}

		const float Distance = FVector::Dist(LastProbeStart, Hit.ImpactPoint);
		const float Priority = IInteractable::Execute_GetInteractionPriority(HitActor);

		FGameplayTagContainer Tags = IInteractable::Execute_GetInteractionTags(HitActor);
		if (IgnoredCategoryTags.Num() > 0 && Tags.HasAny(IgnoredCategoryTags))
		{
			continue;
		}

		if (!IInteractable::Execute_CanInteract(HitActor, CachedOwnerPawn))
		{
			// Still an occluder: a locked door should not let you interact with the
			// shelf behind it.
			if (IInteractable::Execute_IsInteractionOccluder(HitActor))
			{
				break;
			}
			continue;
		}

		if (Priority > BestPriority + KINDA_SMALL_NUMBER ||
			(FMath::IsNearlyEqual(Priority, BestPriority) && Distance < BestDistance))
		{
			BestActor = HitActor;
			BestPriority = Priority;
			BestDistance = Distance;

			OutContext.Instigator = CachedOwnerPawn;
			OutContext.Target = HitActor;
			OutContext.HitLocation = Hit.ImpactPoint;
			OutContext.HitNormal = Hit.ImpactNormal;
			OutContext.Distance = Distance;
		}

		if (!IInteractable::Execute_IsInteractionOccluder(HitActor))
		{
			continue; // Transparent to the probe; keep looking further out.
		}
	}

	return BestActor;
}

void UOpenWorldInteractionComponent::PerformScan()
{
	FVector Origin, Direction;
	if (!BuildProbeRay(Origin, Direction))
	{
		ClearFocus();
		return;
	}

	Direction = Direction.GetSafeNormal();
	if (Direction.IsNearlyZero())
	{
		ClearFocus();
		return;
	}

	LastProbeStart = Origin;
	LastProbeEnd = Origin + Direction * ResolvedTraceDistance;

	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	FCollisionQueryParams QueryParams(SCENE_QUERY_STAT(GameProjectInteraction), /*bTraceComplex*/ false, CachedOwnerPawn);
	QueryParams.bReturnPhysicalMaterial = true; // Future footsteps/impact FX need this.

	TArray<FHitResult> Hits;
	Hits.Reserve(MaxProbeHits);

	if (ResolvedTraceRadius > 0.0f)
	{
		World->SweepMultiByChannel(Hits, Origin, LastProbeEnd, FQuat::Identity, ResolvedTraceChannel,
			FCollisionShape::MakeSphere(ResolvedTraceRadius), QueryParams);
	}
	else
	{
		World->LineTraceMultiByChannel(Hits, Origin, LastProbeEnd, ResolvedTraceChannel, QueryParams);
	}

	FInteractionContext Context;
	AActor* Best = SelectBestCandidate(Hits, Context);

#if GAMEPROJECT_WITH_DEBUG_TOOLS
	if (bDrawDebugTrace)
	{
		const FColor LineColor = Best ? FColor::Green : FColor::Red;
		DrawDebugLine(World, Origin, LastProbeEnd, LineColor, false, 0.0f, 0, 1.5f);
		if (Best && Context.HitLocation != FVector::ZeroVector)
		{
			DrawDebugPoint(World, Context.HitLocation, 12.0f, FColor::Yellow, false, 0.0f, 0);
		}
	}
#endif

	// Advance a pending hold only while the same target stays focused.
	if (Best && Best == FocusedInteractable && HoldElapsedSeconds > 0.0f && RequiredHoldSeconds > 0.0f)
	{
		HoldElapsedSeconds += ResolvedScanInterval;
		if (HoldElapsedSeconds >= RequiredHoldSeconds)
		{
			TryInteract();
		}
		return;
	}

	if (Best != FocusedInteractable)
	{
		SetFocus(Best, Context);
	}
	else if (Best)
	{
		LastContext = Context; // Keep hit info fresh for the eventual interaction.
	}
}

FInteractionPrompt UOpenWorldInteractionComponent::BuildPrompt(const AActor* Target) const
{
	if (!Target)
	{
		return FInteractionPrompt();
	}

	FInteractionPrompt Prompt = IInteractable::Execute_GetInteractionPrompt(Target, CachedOwnerPawn);
	Prompt.bIsValid = true;
	if (!Prompt.Category.IsValid())
	{
		const FGameplayTagContainer Tags = IInteractable::Execute_GetInteractionTags(Target);
		Prompt.Category = Tags.HasTag(GameProjectTags::InteractionCategoryPickup())
			? GameProjectTags::InteractionCategoryPickup()
			: FGameplayTag();
	}
	return Prompt;
}

void UOpenWorldInteractionComponent::SetFocus(AActor* NewFocus, const FInteractionContext& Context)
{
	if (NewFocus == FocusedInteractable)
	{
		return;
	}

	if (FocusedInteractable)
	{
		IInteractable::Execute_OnInteractionFocusLost(FocusedInteractable, CachedOwnerPawn);
	}

	CancelHold();

	FocusedInteractable = NewFocus;
	LastContext = Context;
	CurrentPrompt = BuildPrompt(NewFocus);

	if (FocusedInteractable)
	{
		IInteractable::Execute_OnInteractionFocusGained(FocusedInteractable, CachedOwnerPawn);
		UE_LOG(LogInteraction, Verbose, TEXT("Focus -> %s"), *FocusedInteractable->GetName());
	}

	// Edge-triggered: the HUD only hears about real changes.
	OnFocusChanged.Broadcast(FocusedInteractable, CurrentPrompt);
}

void UOpenWorldInteractionComponent::ClearFocus()
{
	if (!FocusedInteractable && !CurrentPrompt.bIsValid)
	{
		return;
	}
	SetFocus(nullptr, FInteractionContext());
}

EInteractionResult UOpenWorldInteractionComponent::TryInteract()
{
	AActor* Target = FocusedInteractable;
	if (!Target)
	{
		OnInteractionExecuted.Broadcast(nullptr, false, EInteractionResult::NothingFocused);
		return EInteractionResult::NothingFocused;
	}

	const FInteractionPrompt Prompt = BuildPrompt(Target);
	if (Prompt.HoldDuration > 0.0f && HoldElapsedSeconds <= 0.0f)
	{
		// Start charging; PerformScan completes it while focus is held.
		RequiredHoldSeconds = Prompt.HoldDuration;
		HoldElapsedSeconds = KINDA_SMALL_NUMBER;
		OnInteractionExecuted.Broadcast(Target, false, EInteractionResult::AlreadyInProgress);
		return EInteractionResult::AlreadyInProgress;
	}

	if (!IInteractable::Execute_CanInteract(Target, CachedOwnerPawn))
	{
		LastContext.Target = Target;
		OnInteractionExecuted.Broadcast(Target, false, EInteractionResult::Refused);
		return EInteractionResult::Refused;
	}

	LastContext.Instigator = CachedOwnerPawn;
	LastContext.Target = Target;

	const bool bSuccess = IInteractable::Execute_Interact(Target, LastContext);
	HoldElapsedSeconds = 0.0f;
	RequiredHoldSeconds = 0.0f;

	UE_LOG(LogInteraction, Log, TEXT("Interact '%s' -> %s"), *Target->GetName(), bSuccess ? TEXT("success") : TEXT("refused"));

	OnInteractionExecuted.Broadcast(Target, bSuccess, bSuccess ? EInteractionResult::Success : EInteractionResult::Refused);
	return bSuccess ? EInteractionResult::Success : EInteractionResult::Refused;
}

void UOpenWorldInteractionComponent::CancelHold()
{
	HoldElapsedSeconds = 0.0f;
	RequiredHoldSeconds = 0.0f;
}

float UOpenWorldInteractionComponent::GetHoldProgress() const
{
	if (RequiredHoldSeconds <= 0.0f)
	{
		return 0.0f;
	}
	return FMath::Clamp(HoldElapsedSeconds / RequiredHoldSeconds, 0.0f, 1.0f);
}

#if GAMEPROJECT_WITH_DEBUG_TOOLS
void UOpenWorldInteractionComponent::SetDrawDebugTrace(bool bEnabled)
{
	bDrawDebugTrace = bEnabled;
	UE_LOG(LogInteraction, Log, TEXT("Interaction trace visualisation: %s"), bEnabled ? TEXT("on") : TEXT("off"));
}
#endif
