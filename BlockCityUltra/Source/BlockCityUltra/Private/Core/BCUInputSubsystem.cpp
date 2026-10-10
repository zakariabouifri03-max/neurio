// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Core/BCUInputSubsystem.h"

#include "EnhancedInputSubsystems.h"
#include "InputMappingContext.h"
#include "GameFramework/PlayerController.h"
#include "Kismet/GameplayStatics.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUInput, Log, All);

void UBCUInputSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	EnsureDefaultBindings();
}

void UBCUInputSubsystem::Deinitialize() { Super::Deinitialize(); }

void UBCUInputSubsystem::EnsureDefaultBindings()
{
	if (Bindings.Num() > 0) { return; }

	auto Add = [this](const TCHAR* Id, const TCHAR* Display, const FKey& Primary,
		const FKey& Gamepad, const TCHAR* Category)
	{
		FBCUInputBinding Binding;
		Binding.ActionId = FName(Id);
		Binding.DisplayName = FText::FromString(Display);
		Binding.PrimaryKey = Primary;
		Binding.GamepadKey = Gamepad;
		Binding.Category = FName(Category);
		Binding.UserPrimaryKey = Primary;
		Bindings.Add(Binding);
	};

	Add(TEXT("Move"), TEXT("Move"), EKeys::W, EKeys::Gamepad_LeftY, TEXT("On Foot"));
	Add(TEXT("Look"), TEXT("Look"), EKeys::MouseXY2D, EKeys::Gamepad_RightX, TEXT("On Foot"));
	Add(TEXT("Jump"), TEXT("Jump"), EKeys::SpaceBar, EKeys::Gamepad_FaceButton_Bottom, TEXT("On Foot"));
	Add(TEXT("Sprint"), TEXT("Sprint"), EKeys::LeftShift, EKeys::Gamepad_LeftThumbstick, TEXT("On Foot"));
	Add(TEXT("EnterVehicle"), TEXT("Enter / Exit Vehicle"), EKeys::F, EKeys::Gamepad_FaceButton_Left, TEXT("Vehicle"));
	Add(TEXT("Interact"), TEXT("Interact"), EKeys::E, EKeys::Gamepad_FaceButton_Right, TEXT("General"));
	Add(TEXT("Throttle"), TEXT("Throttle"), EKeys::W, EKeys::Gamepad_RightTriggerAxis, TEXT("Vehicle"));
	Add(TEXT("Brake"), TEXT("Brake / Reverse"), EKeys::S, EKeys::Gamepad_LeftTriggerAxis, TEXT("Vehicle"));
	Add(TEXT("Steer"), TEXT("Steer"), EKeys::MouseXY2D, EKeys::Gamepad_LeftX, TEXT("Vehicle"));
	Add(TEXT("Handbrake"), TEXT("Handbrake"), EKeys::SpaceBar, EKeys::Gamepad_FaceButton_Right, TEXT("Vehicle"));
	Add(TEXT("Horn"), TEXT("Horn"), EKeys::H, EKeys::Gamepad_DPad_Up, TEXT("Vehicle"));
	Add(TEXT("CameraMode"), TEXT("Camera Mode"), EKeys::C, EKeys::Gamepad_Special_Right, TEXT("Vehicle"));
	Add(TEXT("LookBack"), TEXT("Look Back"), EKeys::Q, EKeys::Gamepad_RightThumbstick, TEXT("Vehicle"));
	Add(TEXT("Map"), TEXT("Map"), EKeys::M, EKeys::Gamepad_Special_Left, TEXT("UI"));
	Add(TEXT("Phone"), TEXT("Phone"), EKeys::Tab, EKeys::Gamepad_DPad_Down, TEXT("UI"));
	Add(TEXT("Inventory"), TEXT("Inventory"), EKeys::I, EKeys::Gamepad_DPad_Left, TEXT("UI"));
	Add(TEXT("Pause"), TEXT("Pause Menu"), EKeys::Escape, EKeys::Gamepad_Special_Right, TEXT("UI"));
}

TArray<FBCUInputBinding> UBCUInputSubsystem::GetBindingsInCategory(FName Category) const
{
	TArray<FBCUInputBinding> Result;
	for (const FBCUInputBinding& Binding : Bindings)
	{
		if (Binding.Category == Category) { Result.Add(Binding); }
	}
	return Result;
}

bool UBCUInputSubsystem::RebindAction(FName ActionId, int32 SlotIndex, const FKey& NewKey)
{
	// Reject a key already bound to a different action in the same context, so
	// the player cannot accidentally make "brake" and "map" the same button.
	for (const FBCUInputBinding& Other : Bindings)
	{
		if (Other.ActionId == ActionId) { continue; }
		if (Other.UserPrimaryKey == NewKey || Other.SecondaryKey == NewKey) { return false; }
	}

	const int32 Index = Bindings.IndexOfByPredicate(
		[ActionId](const FBCUInputBinding& O) { return O.ActionId == ActionId; });
	if (Index == INDEX_NONE) { return false; }

	if (SlotIndex == 0) { Bindings[Index].UserPrimaryKey = NewKey; }
	else { Bindings[Index].UserSecondaryKey = NewKey; }

	ApplyBindings();
	UE_LOG(LogBCUInput, Log, TEXT("Rebound %s slot %d → %s"), *ActionId.ToString(), SlotIndex, *NewKey.ToString());
	return true;
}

void UBCUInputSubsystem::ResetBindingsToDefault()
{
	for (FBCUInputBinding& Binding : Bindings)
	{
		Binding.UserPrimaryKey = Binding.PrimaryKey;
		Binding.UserSecondaryKey = Binding.SecondaryKey;
	}
	ApplyBindings();
}

void UBCUInputSubsystem::ApplyBindings()
{
	const APlayerController* PC = UGameplayStatics::GetPlayerController(this, 0);
	if (!PC) { return; }

	UEnhancedInputLocalPlayerSubsystem* Subsystem =
		ULocalPlayer::GetSubsystem<UEnhancedInputLocalPlayerSubsystem>(PC->GetLocalPlayer());
	if (!Subsystem) { return; }

	// Rebuild every mapping context from the binding table. Doing it here (one
	// place) is what keeps the options menu, a save load and a fresh boot in
	// agreement about what every key does.
	for (const UInputMappingContext* Context : Subsystem->GetAppliedInputMappingContexts())
	{
		if (!Context) { continue; }

		for (const FEnhancedActionKeyMapping& Mapping : Context->GetMappings())
		{
			const FBCUInputBinding* Binding = Bindings.FindByPredicate(
				[&Mapping](const FBCUInputBinding& O)
				{
					return Mapping.Action && O.ActionId == Mapping.Action->GetFName();
				});

			if (!Binding) { continue; }

			// A const context cannot be edited at runtime; the subsystem instead
			// applies an override mapping on top of it.
			Subsystem->AddPlayerMappedKey(Binding->UserPrimaryKey);
		}
	}
}

void UBCUInputSubsystem::SetMouseSensitivity(float Value) { MouseSensitivity = FMath::Clamp(Value, 0.05f, 4.0f); }
void UBCUInputSubsystem::SetGamepadSensitivity(float Value) { GamepadSensitivity = FMath::Clamp(Value, 0.05f, 4.0f); }
void UBCUInputSubsystem::SetInvertLookY(bool bInvert) { bInvertLookY = bInvert; }
