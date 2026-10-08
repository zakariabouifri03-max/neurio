// Copyright GameProject. All rights reserved. Original content only.

#include "Input/OpenWorldInputBootstrap.h"

#include "Core/GameProjectLog.h"
#include "InputAction.h"
#include "InputActionValue.h"
#include "InputCoreTypes.h"
#include "InputMappingContext.h"
#include "InputModifiers.h"
#include "InputTriggers.h"

namespace
{
	/**
	 * One-shot builder for a single key mapping.
	 *
	 * UInputMappingContext::MapKey returns a reference into its mapping array, and
	 * the next MapKey call can reallocate that array. Using this as a temporary
	 * expression keeps the reference's lifetime to one statement, which removes an
	 * entire class of use-after-realloc bug.
	 */
	class FKeyMappingBuilder
	{
	public:
		FKeyMappingBuilder(UInputMappingContext& InContext, const UInputAction* InAction, const FKey& InKey)
			: Mapping(InContext.MapKey(InAction, InKey))
		{
		}

		FKeyMappingBuilder& Trigger(UInputTrigger* InTrigger)
		{
			if (InTrigger) { Mapping.Triggers.Add(InTrigger); }
			return *this;
		}

		FKeyMappingBuilder& Modifier(UInputModifier* InModifier)
		{
			if (InModifier) { Mapping.Modifiers.Add(InModifier); }
			return *this;
		}

		/** Moves a promoted 1D key value from X onto Y (used for W/S and the vertical sticks). */
		FKeyMappingBuilder& SwizzleXY(UObject& Outer)
		{
			UInputModifierSwizzleAxis* Swizzle = NewObject<UInputModifierSwizzleAxis>(&Outer);
			Swizzle->Order = EInputAxisSwizzle::YXZ;
			return Modifier(Swizzle);
		}

		FKeyMappingBuilder& Scale(UObject& Outer, float X, float Y)
		{
			UInputModifierScalar* Scalar = NewObject<UInputModifierScalar>(&Outer);
			Scalar->Scalar = FVector(X, Y, 1.0f);
			return Modifier(Scalar);
		}

		FKeyMappingBuilder& DeadZone(UObject& Outer, float LowerThreshold)
		{
			UInputModifierDeadZone* Zone = NewObject<UInputModifierDeadZone>(&Outer);
			Zone->Type = EDeadZoneType::Radial;
			Zone->LowerThreshold = LowerThreshold;
			Zone->UpperThreshold = 1.0f;
			return Modifier(Zone);
		}

	private:
		FEnhancedActionKeyMapping& Mapping;
	};

	constexpr float GamepadDeadZone = 0.2f;
}

UInputAction* FOpenWorldInputBootstrap::CreateAction(UObject& Outer, const TCHAR* AssetName, EInputActionValueType ValueType)
{
	UInputAction* Action = NewObject<UInputAction>(&Outer, FName(AssetName), RF_Public | RF_Transient);
	Action->ValueType = ValueType;
	Action->bConsumeInput = true;
	Action->bTriggerWhenPaused = false;
	return Action;
}

UInputMappingContext* FOpenWorldInputBootstrap::CreateMappingContext(UObject& Outer, const TCHAR* AssetName)
{
	return NewObject<UInputMappingContext>(&Outer, FName(AssetName), RF_Public | RF_Transient);
}

UInputMappingContext* FOpenWorldInputBootstrap::BuildKeyboardMouse(UObject& Outer, const TMap<EGameProjectInputAction, TObjectPtr<UInputAction>>& Actions)
{
	const UInputAction* Move = Actions.FindRef(EGameProjectInputAction::Move);
	const UInputAction* Look = Actions.FindRef(EGameProjectInputAction::Look);
	const UInputAction* Jump = Actions.FindRef(EGameProjectInputAction::Jump);
	const UInputAction* Sprint = Actions.FindRef(EGameProjectInputAction::Sprint);
	const UInputAction* Crouch = Actions.FindRef(EGameProjectInputAction::Crouch);
	const UInputAction* Interact = Actions.FindRef(EGameProjectInputAction::Interact);
	const UInputAction* OpenMap = Actions.FindRef(EGameProjectInputAction::OpenMap);

	UInputMappingContext* IMC = CreateMappingContext(Outer, TEXT("IMC_Player"));

	// Shared trigger instances: one per semantic, reused by every mapping.
	UInputTrigger* Pressed = NewObject<UInputTriggerPressed>(&Outer);
	UInputTrigger* Down = NewObject<UInputTriggerDown>(&Outer);

	// Move convention: value.X = right, value.Y = forward.
	// A keyboard key is promoted to (1, 0, 0), so W/S must swizzle onto Y and
	// S/A must be negated. Arrow keys mirror WASD for convenient testing.
	FKeyMappingBuilder(*IMC, Move, EKeys::W).SwizzleXY(Outer);
	FKeyMappingBuilder(*IMC, Move, EKeys::S).SwizzleXY(Outer).Scale(Outer, 1.0f, -1.0f);
	FKeyMappingBuilder(*IMC, Move, EKeys::A).Scale(Outer, -1.0f, 1.0f);
	FKeyMappingBuilder(*IMC, Move, EKeys::D);
	FKeyMappingBuilder(*IMC, Move, EKeys::Up).SwizzleXY(Outer);
	FKeyMappingBuilder(*IMC, Move, EKeys::Down).SwizzleXY(Outer).Scale(Outer, 1.0f, -1.0f);
	FKeyMappingBuilder(*IMC, Move, EKeys::Left).Scale(Outer, -1.0f, 1.0f);
	FKeyMappingBuilder(*IMC, Move, EKeys::Right);

	// Look: MouseX already lands on X (yaw). MouseY is swizzled onto Y (pitch) and
	// negated so pushing the mouse forward looks up.
	FKeyMappingBuilder(*IMC, Look, EKeys::MouseX);
	FKeyMappingBuilder(*IMC, Look, EKeys::MouseY).SwizzleXY(Outer).Scale(Outer, 1.0f, -1.0f);

	// Jump uses a held trigger so the character receives both edges: Started begins
	// the jump and Completed stops it (variable jump height with no extra code).
	FKeyMappingBuilder(*IMC, Jump, EKeys::SpaceBar).Trigger(Down);
	FKeyMappingBuilder(*IMC, Sprint, EKeys::LeftShift).Trigger(Down);
	FKeyMappingBuilder(*IMC, Sprint, EKeys::RightShift).Trigger(Down);
	FKeyMappingBuilder(*IMC, Crouch, EKeys::C).Trigger(Pressed);
	FKeyMappingBuilder(*IMC, Crouch, EKeys::LeftControl).Trigger(Pressed);
	FKeyMappingBuilder(*IMC, Interact, EKeys::E).Trigger(Pressed);
	FKeyMappingBuilder(*IMC, Interact, EKeys::F).Trigger(Pressed);
	FKeyMappingBuilder(*IMC, OpenMap, EKeys::M).Trigger(Pressed);
	FKeyMappingBuilder(*IMC, OpenMap, EKeys::Tab).Trigger(Pressed);

	return IMC;
}

UInputMappingContext* FOpenWorldInputBootstrap::BuildGamepad(UObject& Outer, const TMap<EGameProjectInputAction, TObjectPtr<UInputAction>>& Actions)
{
	const UInputAction* Move = Actions.FindRef(EGameProjectInputAction::Move);
	const UInputAction* Look = Actions.FindRef(EGameProjectInputAction::Look);
	const UInputAction* Jump = Actions.FindRef(EGameProjectInputAction::Jump);
	const UInputAction* Sprint = Actions.FindRef(EGameProjectInputAction::Sprint);
	const UInputAction* Crouch = Actions.FindRef(EGameProjectInputAction::Crouch);
	const UInputAction* Interact = Actions.FindRef(EGameProjectInputAction::Interact);
	const UInputAction* OpenMap = Actions.FindRef(EGameProjectInputAction::OpenMap);

	UInputMappingContext* IMC = CreateMappingContext(Outer, TEXT("IMC_Gamepad"));

	UInputTrigger* Pressed = NewObject<UInputTriggerPressed>(&Outer);
	UInputTrigger* Down = NewObject<UInputTriggerDown>(&Outer);

	FKeyMappingBuilder(*IMC, Move, EKeys::Gamepad_LeftX).DeadZone(Outer, GamepadDeadZone);
	FKeyMappingBuilder(*IMC, Move, EKeys::Gamepad_LeftY).SwizzleXY(Outer).DeadZone(Outer, GamepadDeadZone);
	FKeyMappingBuilder(*IMC, Look, EKeys::Gamepad_RightX).DeadZone(Outer, GamepadDeadZone);
	FKeyMappingBuilder(*IMC, Look, EKeys::Gamepad_RightY).SwizzleXY(Outer).Scale(Outer, 1.0f, -1.0f).DeadZone(Outer, GamepadDeadZone);

	FKeyMappingBuilder(*IMC, Jump, EKeys::Gamepad_FaceButton_Bottom).Trigger(Down);
	FKeyMappingBuilder(*IMC, Sprint, EKeys::Gamepad_LeftShoulder).Trigger(Down);
	FKeyMappingBuilder(*IMC, Crouch, EKeys::Gamepad_FaceButton_Right).Trigger(Pressed);
	FKeyMappingBuilder(*IMC, Interact, EKeys::Gamepad_FaceButton_Left).Trigger(Pressed);
	FKeyMappingBuilder(*IMC, OpenMap, EKeys::Gamepad_Special_Right).Trigger(Pressed);

	// D-pad is left free on purpose: future phases use it for the weapon/wheel UI.
	return IMC;
}

void FOpenWorldInputBootstrap::Populate(UOpenWorldInputConfig& Config, bool bIncludeGamepad)
{
	TMap<EGameProjectInputAction, TObjectPtr<UInputAction>> Actions;
	Actions.Add(EGameProjectInputAction::Move, CreateAction(Config, TEXT("IA_Move"), EInputActionValueType::Axis2D));
	Actions.Add(EGameProjectInputAction::Look, CreateAction(Config, TEXT("IA_Look"), EInputActionValueType::Axis2D));
	Actions.Add(EGameProjectInputAction::Jump, CreateAction(Config, TEXT("IA_Jump"), EInputActionValueType::Boolean));
	Actions.Add(EGameProjectInputAction::Sprint, CreateAction(Config, TEXT("IA_Sprint"), EInputActionValueType::Boolean));
	Actions.Add(EGameProjectInputAction::Crouch, CreateAction(Config, TEXT("IA_Crouch"), EInputActionValueType::Boolean));
	Actions.Add(EGameProjectInputAction::Interact, CreateAction(Config, TEXT("IA_Interact"), EInputActionValueType::Boolean));
	Actions.Add(EGameProjectInputAction::OpenMap, CreateAction(Config, TEXT("IA_OpenMap"), EInputActionValueType::Boolean));

	UInputMappingContext* PlayerContext = BuildKeyboardMouse(Config, Actions);
	UInputMappingContext* GamepadContext = bIncludeGamepad ? BuildGamepad(Config, Actions) : nullptr;

	Config.SetRuntimeFallback(PlayerContext, GamepadContext, Actions);

	UE_LOG(LogGameProjectInput, Log, TEXT("Runtime input fallback built (%s gamepad)."),
		bIncludeGamepad ? TEXT("with") : TEXT("without"));
}
