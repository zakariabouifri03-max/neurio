// Copyright GameProject. All rights reserved. Original content only.

#include "UI/OpenWorldHUDComponent.h"

#include "Blueprint/UserWidget.h"
#include "Core/GameProjectBlueprintLibrary.h"
#include "Core/GameProjectLog.h"
#include "Core/GameProjectSettings.h"
#include "Debug/GameProjectDebugSubsystem.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "Interaction/OpenWorldInteractionComponent.h"
#include "Player/OpenWorldPlayerCharacter.h"
#include "Player/OpenWorldPlayerState.h"
#include "TimerManager.h"
#include "UI/OpenWorldHUDWidget.h"

UOpenWorldHUDComponent::UOpenWorldHUDComponent()
{
	PrimaryComponentTick.bCanEverTick = false; // Timer driven.
}

void UOpenWorldHUDComponent::BeginPlay()
{
	Super::BeginPlay();

	CreateHUDWidget();

	RefreshPawnBinding();

	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().SetTimer(RefreshTimerHandle, this,
			&UOpenWorldHUDComponent::RefreshPolledSections, FMath::Max(0.05f, RefreshInterval), /*bLoop*/ true);
	}
}

void UOpenWorldHUDComponent::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (UWorld* World = GetWorld())
	{
		World->GetTimerManager().ClearTimer(RefreshTimerHandle);
	}
	UnbindPawn();
	DestroyHUDWidget();

	Super::EndPlay(EndPlayReason);
}

bool UOpenWorldHUDComponent::CreateHUDWidget()
{
	if (HUDWidget)
	{
		return true;
	}

	APlayerController* PC = Cast<APlayerController>(GetOwner());
	if (!PC)
	{
		return false;
	}

	TSubclassOf<UOpenWorldHUDWidget> WidgetClass = HUDWidgetClassOverride.LoadSynchronous();
	if (!WidgetClass)
	{
		WidgetClass = UGameProjectSettings::Get().PlayerHUDWidgetClass.LoadSynchronous();
	}

	if (!WidgetClass)
	{
		// Not an error: a project with no authored HUD yet still runs. Everything
		// downstream null-checks, so gameplay is unaffected.
		UE_LOG(LogGameProjectUI, Log, TEXT("No HUD widget class assigned; HUD disabled. Assign GameProjectSettings::PlayerHUDWidgetClass."));
		return false;
	}

	HUDWidget = CreateWidget<UOpenWorldHUDWidget>(PC, WidgetClass);
	if (!HUDWidget)
	{
		UE_LOG(LogGameProjectUI, Error, TEXT("CreateWidget failed for class '%s'."), *WidgetClass->GetName());
		return false;
	}

	HUDWidget->AddToViewport();
	UE_LOG(LogGameProjectUI, Log, TEXT("HUD widget '%s' created and added to viewport."), *WidgetClass->GetName());

	OnHUDCreated.Broadcast(HUDWidget);
	return true;
}

void UOpenWorldHUDComponent::DestroyHUDWidget()
{
	if (HUDWidget)
	{
		HUDWidget->RemoveFromParent();
		HUDWidget = nullptr;
	}
}

void UOpenWorldHUDComponent::RefreshPawnBinding()
{
	if (APlayerController* PC = Cast<APlayerController>(GetOwner()))
	{
		BindPawn(*PC);
	}
}

void UOpenWorldHUDComponent::BindPawn(APlayerController& OwnerController)
{
	UnbindPawn();

	APawn* Pawn = OwnerController.GetPawn();
	AOpenWorldPlayerCharacter* Character = Cast<AOpenWorldPlayerCharacter>(Pawn);
	if (!Character)
	{
		return;
	}

	BoundPawn = Character;

	// The interaction component is the authority on focus; we only mirror it into
	// the widget. No polling, no per-frame trace.
	if (UOpenWorldInteractionComponent* Interaction = Character->Interaction)
	{
		Interaction->OnFocusChanged.AddDynamic(this, &UOpenWorldHUDComponent::HandleInteractionFocusChanged);
		HandleInteractionFocusChangedInternal(Interaction->FocusedInteractable, Interaction->CurrentPrompt);
	}
}

void UOpenWorldHUDComponent::UnbindPawn()
{
	if (AOpenWorldPlayerCharacter* Character = Cast<AOpenWorldPlayerCharacter>(BoundPawn.Get()))
	{
		if (Character->Interaction)
		{
			Character->Interaction->OnFocusChanged.RemoveDynamic(this, &UOpenWorldHUDComponent::HandleInteractionFocusChanged);
		}
	}
	BoundPawn = nullptr;
}

void UOpenWorldHUDComponent::HandleInteractionFocusChanged(AActor* NewFocus, const FInteractionPrompt& Prompt)
{
	HandleInteractionFocusChangedInternal(NewFocus, Prompt);
}

void UOpenWorldHUDComponent::HandleInteractionFocusChangedInternal(AActor* NewFocus, const FInteractionPrompt& Prompt)
{
	(void)NewFocus;
	LastPrompt = Prompt;

	if (HUDWidget)
	{
		HUDWidget->SetInteractionPrompt(Prompt, Prompt.bIsValid ? InteractKeyHint : FString());
	}
}

void UOpenWorldHUDComponent::RefreshPolledSections()
{
	if (!HUDWidget)
	{
		// The widget may have been created after BeginPlay (e.g. the class was
		// streamed in); keep trying, cheaply.
		CreateHUDWidget();
		if (!HUDWidget)
		{
			return;
		}
	}

	// Debug text first: it is the only section that can be expensive, and the
	// subsystem returns an empty string immediately when no channel is enabled.
	if (const UGameProjectDebugSubsystem* Debug = UGameProjectDebugSubsystem::Get(this))
	{
		HUDWidget->SetDebugText(Debug->BuildDebugText(this));
	}

	if (const AOpenWorldPlayerCharacter* Character = Cast<AOpenWorldPlayerCharacter>(BoundPawn.Get()))
	{
		HUDWidget->SetHealth(Character->MaxHealth > 0.0f ? Character->Health / Character->MaxHealth : 0.0f);
		HUDWidget->SetArmor(Character->MaxArmor > 0.0f ? Character->Armor / Character->MaxArmor : 0.0f);
	}

	APawn* Pawn = Cast<APawn>(BoundPawn.Get());
	if (const AOpenWorldPlayerState* PlayerState = Pawn ? Cast<AOpenWorldPlayerState>(Pawn->GetPlayerState()) : nullptr)
	{
		HUDWidget->SetMoney(PlayerState->GetMoney());
		HUDWidget->SetWantedLevel(PlayerState->GetWantedLevel());
	}
}
