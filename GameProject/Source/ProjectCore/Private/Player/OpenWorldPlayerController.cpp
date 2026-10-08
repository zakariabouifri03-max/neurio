// Copyright GameProject. All rights reserved. Original content only.

#include "Player/OpenWorldPlayerController.h"

#include "Core/GameProjectBlueprintLibrary.h"
#include "Core/GameProjectLog.h"
#include "Core/GameProjectSettings.h"
#include "Blueprint/UserWidget.h"
#include "Debug/GameProjectDebugSubsystem.h"
#include "Debug/GameProjectDebugTypes.h"
#include "EnhancedInputComponent.h"
#include "EnhancedInputSubsystems.h"
#include "Engine/LocalPlayer.h"
#include "GameFramework/GameInstance.h"
#include "GameFramework/Pawn.h"
#include "Input/OpenWorldInputBootstrap.h"
#include "Input/OpenWorldInputConfig.h"
#include "InputAction.h"
#include "InputMappingContext.h"
#include "Interaction/OpenWorldInteractionComponent.h"
#include "Player/OpenWorldPlayerCharacter.h"
#include "ProjectCore.h"
#include "Save/GameProjectSaveSubsystem.h"
#include "Settings/GameProjectSettingsSubsystem.h"
#include "UI/OpenWorldHUDComponent.h"

AOpenWorldPlayerController::AOpenWorldPlayerController()
{
	PrimaryActorTick.bCanEverTick = false;

	bShowMouseCursor = false;
	bEnableClickEvents = false;
	bEnableTouchOverEvents = false;
	bEnableMouseOverEvents = false;

	HUDComponent = CreateDefaultSubobject<UOpenWorldHUDComponent>(TEXT("HUDComponent"));
}

void AOpenWorldPlayerController::BeginPlay()
{
	Super::BeginPlay();

	SetInputMode(FInputModeGameOnly());

	ResolveInputConfig();
	ApplyInputMappingContexts(true);
	RefreshInteractKeyHint();

	UE_LOG(LogPlayer, Log, TEXT("PlayerController BeginPlay: input config '%s' (%s)."),
		*GetNameSafe(InputConfig), InputConfig && InputConfig->IsFullyAuthored() ? TEXT("authored assets") : TEXT("runtime fallback"));
}

void AOpenWorldPlayerController::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	ApplyInputMappingContexts(false);
	Super::EndPlay(EndPlayReason);
}

void AOpenWorldPlayerController::SetupInputComponent()
{
	Super::SetupInputComponent();

	UEnhancedInputComponent* EnhancedInput = Cast<UEnhancedInputComponent>(InputComponent);
	if (!EnhancedInput)
	{
		// Not a fatal error, but nothing will respond to input until
		// DefaultInput.ini points DefaultInputComponentClass at EnhancedInputComponent.
		UE_LOG(LogGameProjectError, Error,
			TEXT("InputComponent is '%s', expected UEnhancedInputComponent. Check DefaultInput.ini."),
			*GetNameSafe(InputComponent));
		return;
	}

	BindInputActions();
}

void AOpenWorldPlayerController::OnPossess(APawn* InPawn)
{
	Super::OnPossess(InPawn);

	if (HUDComponent)
	{
		HUDComponent->RefreshPawnBinding();
	}
}

void AOpenWorldPlayerController::OnUnPossess()
{
	if (HUDComponent)
	{
		HUDComponent->RefreshPawnBinding();
	}

	Super::OnUnPossess();
}

AOpenWorldPlayerCharacter* AOpenWorldPlayerController::GetPlayerCharacter() const
{
	return Cast<AOpenWorldPlayerCharacter>(GetPawn());
}

UOpenWorldInputConfig* AOpenWorldPlayerController::ResolveInputConfig()
{
	if (InputConfig)
	{
		return InputConfig;
	}

	const TSoftObjectPtr<UOpenWorldInputConfig>& Source = InputConfigOverride.IsNull()
		? UGameProjectSettings::Get().InputConfig
		: InputConfigOverride;

	if (UOpenWorldInputConfig* Authored = UGameProjectBlueprintLibrary::ResolveSoftObject(Source, TEXT("input config")))
	{
		if (Authored->ResolveAssets())
		{
			InputConfig = Authored;
			return InputConfig;
		}
		UE_LOG(LogGameProjectInput, Warning, TEXT("Authored input config '%s' is incomplete; building a runtime fallback."), *Authored->GetName());
	}

	// Outer is this controller, so the synthesised IMC/IA objects are reachable
	// through a UPROPERTY chain and survive garbage collection.
	UOpenWorldInputConfig* Runtime = NewObject<UOpenWorldInputConfig>(this);
	FOpenWorldInputBootstrap::Populate(*Runtime, /*bIncludeGamepad*/ true);
	InputConfig = Runtime;
	return InputConfig;
}

void AOpenWorldPlayerController::ApplyInputMappingContexts(bool bAdd)
{
	if (!InputConfig)
	{
		return;
	}

	const ULocalPlayer* LocalPlayer = GetLocalPlayer();
	UEnhancedInputLocalPlayerSubsystem* Subsystem = ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(LocalPlayer);
	if (!Subsystem)
	{
		return;
	}

	for (const TObjectPtr<UInputMappingContext>& Context : InputConfig->GetResolvedMappingContexts())
	{
		if (!Context)
		{
			continue;
		}

		if (bAdd)
		{
			Subsystem->AddMappingContext(Context, InputConfig->GetMappingPriority(Context));
		}
		else
		{
			Subsystem->RemoveMappingContext(Context);
		}
	}
}

void AOpenWorldPlayerController::BindInputActions()
{
	UEnhancedInputComponent* EnhancedInput = Cast<UEnhancedInputComponent>(InputComponent);
	if (!EnhancedInput)
	{
		return;
	}

	UOpenWorldInputConfig* Config = ResolveInputConfig();
	if (!Config)
	{
		return;
	}

	// Rebinding after a config swap must not stack duplicate handlers.
	EnhancedInput->ClearActionEventBindings();

	struct FBinding
	{
		EGameProjectInputAction Role;
		ETriggerEvent Trigger;
		void (AOpenWorldPlayerController::*Handler)(const FInputActionValue&);
	};

	// Move/Look fire every frame while actuated (Triggered) and once on release
	// (Completed) - the Completed binding is what zeroes the input.
	const FBinding Bindings[] = {
		{ EGameProjectInputAction::Move,     ETriggerEvent::Triggered, &AOpenWorldPlayerController::OnMoveInputTriggered },
		{ EGameProjectInputAction::Move,     ETriggerEvent::Completed, &AOpenWorldPlayerController::OnMoveInputCompleted },
		{ EGameProjectInputAction::Look,     ETriggerEvent::Triggered, &AOpenWorldPlayerController::OnLookInputTriggered },
		{ EGameProjectInputAction::Look,     ETriggerEvent::Completed, &AOpenWorldPlayerController::OnLookInputCompleted },
		{ EGameProjectInputAction::Jump,     ETriggerEvent::Started,   &AOpenWorldPlayerController::OnJumpStarted },
		{ EGameProjectInputAction::Jump,     ETriggerEvent::Completed, &AOpenWorldPlayerController::OnJumpCompleted },
		{ EGameProjectInputAction::Sprint,   ETriggerEvent::Started,   &AOpenWorldPlayerController::OnSprintStarted },
		{ EGameProjectInputAction::Sprint,   ETriggerEvent::Completed, &AOpenWorldPlayerController::OnSprintCompleted },
		{ EGameProjectInputAction::Crouch,   ETriggerEvent::Triggered, &AOpenWorldPlayerController::OnCrouchTriggered },
		{ EGameProjectInputAction::Interact, ETriggerEvent::Triggered, &AOpenWorldPlayerController::OnInteractTriggered },
		{ EGameProjectInputAction::OpenMap,  ETriggerEvent::Triggered, &AOpenWorldPlayerController::OnOpenMapTriggered },
	};

	int32 BoundCount = 0;
	for (const FBinding& Binding : Bindings)
	{
		if (const UInputAction* Action = Config->GetAction(Binding.Role))
		{
			EnhancedInput->BindAction(Action, Binding.Trigger, this, Binding.Handler);
			++BoundCount;
		}
	}

	UE_LOG(LogGameProjectInput, Log, TEXT("Bound %d/%d enhanced input actions."), BoundCount, UE_ARRAY_COUNT(Bindings));
}

void AOpenWorldPlayerController::RefreshInteractKeyHint()
{
	if (!HUDComponent || !InputConfig)
	{
		return;
	}

	const UInputAction* InteractAction = InputConfig->GetAction(EGameProjectInputAction::Interact);
	if (!InteractAction)
	{
		return;
	}

	// Take the first key mapped to Interact in the highest-priority context, so the
	// prompt shows what this player will actually press rather than a hardcoded "E".
	for (const TObjectPtr<UInputMappingContext>& Context : InputConfig->GetResolvedMappingContexts())
	{
		if (!Context)
		{
			continue;
		}

		for (const FEnhancedActionKeyMapping& Mapping : Context->GetMappings())
		{
			if (Mapping.Action == InteractAction && Mapping.Key.IsValid())
			{
				HUDComponent->InteractKeyHint = Mapping.Key.GetDisplayName().ToString();
				return;
			}
		}
	}
}

// ------------------------------------------------------------------ handlers
void AOpenWorldPlayerController::OnMoveInputTriggered(const FInputActionValue& Value)
{
	if (AOpenWorldPlayerCharacter* Character = GetPlayerCharacter())
	{
		Character->ApplyMoveInput(Value.Get<FVector2D>());
	}
}

void AOpenWorldPlayerController::OnMoveInputCompleted(const FInputActionValue& Value)
{
	(void)Value; // The Completed payload is the *last* value, which is non-zero.
	if (AOpenWorldPlayerCharacter* Character = GetPlayerCharacter())
	{
		Character->ApplyMoveInput(FVector2D::ZeroVector);
	}
}

void AOpenWorldPlayerController::OnLookInputTriggered(const FInputActionValue& Value)
{
	AOpenWorldPlayerCharacter* Character = GetPlayerCharacter();
	if (!Character)
	{
		return;
	}

	// Sensitivity is applied here, at the input boundary, so the pawn receives a
	// value that already means "degrees" and never has to know about options.
	FVector2D Look = Value.Get<FVector2D>();

	if (const UGameProjectSettingsSubsystem* Settings = UGameProjectSettingsSubsystem::Get(this))
	{
		Look *= Settings->GetLookSensitivityScale();
	}

	Character->ApplyLookInput(Look);
}

void AOpenWorldPlayerController::OnLookInputCompleted(const FInputActionValue& Value)
{
	(void)Value; // Mouse look has no residual state to clear.
}

void AOpenWorldPlayerController::OnJumpStarted(const FInputActionValue& Value)
{
	(void)Value;
	if (AOpenWorldPlayerCharacter* Character = GetPlayerCharacter())
	{
		Character->StartJump();
	}
}

void AOpenWorldPlayerController::OnJumpCompleted(const FInputActionValue& Value)
{
	(void)Value;
	if (AOpenWorldPlayerCharacter* Character = GetPlayerCharacter())
	{
		Character->StopJump();
	}
}

void AOpenWorldPlayerController::OnSprintStarted(const FInputActionValue& Value)
{
	(void)Value;
	if (AOpenWorldPlayerCharacter* Character = GetPlayerCharacter())
	{
		Character->SetSprintHeld(true);
	}
}

void AOpenWorldPlayerController::OnSprintCompleted(const FInputActionValue& Value)
{
	(void)Value;
	if (AOpenWorldPlayerCharacter* Character = GetPlayerCharacter())
	{
		Character->SetSprintHeld(false);
	}
}

void AOpenWorldPlayerController::OnCrouchTriggered(const FInputActionValue& Value)
{
	(void)Value;
	if (AOpenWorldPlayerCharacter* Character = GetPlayerCharacter())
	{
		Character->ToggleCrouch();
	}
}

void AOpenWorldPlayerController::OnInteractTriggered(const FInputActionValue& Value)
{
	(void)Value;
	if (AOpenWorldPlayerCharacter* Character = GetPlayerCharacter())
	{
		Character->RequestInteract();
	}
}

void AOpenWorldPlayerController::OnOpenMapTriggered(const FInputActionValue& Value)
{
	(void)Value;
	bMapOpen = !bMapOpen;

	// The map screen is a later phase; the request is already plumbed so that phase
	// only has to bind to this delegate.
	OnMapToggleRequested.Broadcast(bMapOpen);
	UE_LOG(LogPlayer, Log, TEXT("Map toggle requested: %s"), bMapOpen ? TEXT("open") : TEXT("closed"));
}

// ------------------------------------------------------------------ dev commands
void AOpenWorldPlayerController::DebugToggle(const FString& ChannelName)
{
	UGameProjectDebugSubsystem* Debug = UGameProjectDebugSubsystem::Get(this);
	if (!Debug)
	{
		return;
	}

	if (ChannelName.IsEmpty() || ChannelName.Equals(TEXT("Help"), ESearchCase::IgnoreCase))
	{
		const UEnum* Enum = StaticEnum<EGameProjectDebugChannel>();
		FString Available;
		if (Enum)
		{
			for (int32 Index = 0; Index < Enum->NumEnums() - 1; ++Index)
			{
				const int64 Value = Enum->GetValueByIndex(Index);
				if (Value != 0)
				{
					Available += Enum->GetNameStringByIndex(Index) + TEXT(" ");
				}
			}
		}
		UE_LOG(LogGameProjectDebug, Log, TEXT("DebugToggle channels: %s| All | Off"), *Available.TrimEnd());
		return;
	}

	if (ChannelName.Equals(TEXT("All"), ESearchCase::IgnoreCase))
	{
		Debug->EnableAllChannels();
		return;
	}

	if (ChannelName.Equals(TEXT("Off"), ESearchCase::IgnoreCase) || ChannelName.Equals(TEXT("None"), ESearchCase::IgnoreCase))
	{
		Debug->DisableAllChannels();
		return;
	}

	const UEnum* Enum = StaticEnum<EGameProjectDebugChannel>();
	const int64 Value = Enum ? Enum->GetValueByNameString(ChannelName) : static_cast<int64>(INDEX_NONE);
	if (Value == static_cast<int64>(INDEX_NONE) || Value == 0)
	{
		UE_LOG(LogGameProjectDebug, Warning, TEXT("Unknown debug channel '%s'. Try 'DebugToggle Help'."), *ChannelName);
		return;
	}

	Debug->ToggleChannel(static_cast<EGameProjectDebugChannel>(Value));
}

void AOpenWorldPlayerController::DebugOff()
{
	if (UGameProjectDebugSubsystem* Debug = UGameProjectDebugSubsystem::Get(this))
	{
		Debug->DisableAllChannels();
	}
}

void AOpenWorldPlayerController::SaveSlot(int32 Slot)
{
	UGameProjectSaveSubsystem* SaveSubsystem = UGameProjectSaveSubsystem::Get(this);
	if (!SaveSubsystem)
	{
		return;
	}

	const bool bSaved = SaveSubsystem->SaveToSlot(Slot, /*bForceSynchronous*/ true);
	ClientMessage(bSaved
		? FString::Printf(TEXT("Saved slot %d."), Slot)
		: FString::Printf(TEXT("Save to slot %d FAILED."), Slot));
}

void AOpenWorldPlayerController::LoadSlot(int32 Slot)
{
	UGameProjectSaveSubsystem* SaveSubsystem = UGameProjectSaveSubsystem::Get(this);
	if (!SaveSubsystem)
	{
		return;
	}

	const bool bLoaded = SaveSubsystem->LoadFromSlot(Slot);
	ClientMessage(bLoaded
		? FString::Printf(TEXT("Loaded slot %d."), Slot)
		: FString::Printf(TEXT("Load of slot %d FAILED."), Slot));
}
