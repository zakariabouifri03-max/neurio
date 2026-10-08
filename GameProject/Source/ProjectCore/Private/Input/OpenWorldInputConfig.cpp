// Copyright GameProject. All rights reserved. Original content only.

#include "Input/OpenWorldInputConfig.h"

#include "Core/GameProjectBlueprintLibrary.h"
#include "Core/GameProjectLog.h"
#include "InputAction.h"
#include "InputMappingContext.h"

UOpenWorldInputConfig::UOpenWorldInputConfig()
{
	ResolvedMappingContexts.Reserve(2);
}

bool UOpenWorldInputConfig::ResolveAssets()
{
	if (bAssetsResolved)
	{
		return ResolvedMappingContexts.Num() > 0;
	}
	bAssetsResolved = true;
	bFullyAuthored = true;

	ResolvedMappingContexts.Reset();

	ResolvedPlayerContext = UGameProjectBlueprintLibrary::ResolveSoftObject(PlayerMappingContext, TEXT("IMC_Player"));
	if (ResolvedPlayerContext)
	{
		ResolvedMappingContexts.Add(ResolvedPlayerContext);
	}

	ResolvedGamepadContext = UGameProjectBlueprintLibrary::ResolveSoftObject(GamepadMappingContext, TEXT("IMC_Gamepad"));
	if (ResolvedGamepadContext)
	{
		ResolvedMappingContexts.Add(ResolvedGamepadContext);
	}

	struct FActionEntry
	{
		EGameProjectInputAction Role;
		const TSoftObjectPtr<UInputAction>* Source;
		const TCHAR* Name;
	};

	const FActionEntry Entries[] = {
		{ EGameProjectInputAction::Move,     &MoveAction,     TEXT("IA_Move") },
		{ EGameProjectInputAction::Look,     &LookAction,     TEXT("IA_Look") },
		{ EGameProjectInputAction::Jump,     &JumpAction,     TEXT("IA_Jump") },
		{ EGameProjectInputAction::Sprint,   &SprintAction,   TEXT("IA_Sprint") },
		{ EGameProjectInputAction::Crouch,   &CrouchAction,   TEXT("IA_Crouch") },
		{ EGameProjectInputAction::Interact, &InteractAction, TEXT("IA_Interact") },
		{ EGameProjectInputAction::OpenMap,  &OpenMapAction,  TEXT("IA_OpenMap") },
	};

	ResolvedActions.Reset();
	for (const FActionEntry& Entry : Entries)
	{
		UInputAction* Action = UGameProjectBlueprintLibrary::ResolveSoftObject(*Entry.Source, Entry.Name);
		if (!Action)
		{
			bFullyAuthored = false;
			UE_LOG(LogGameProjectInput, Warning, TEXT("Input config '%s' is missing %s."), *GetName(), Entry.Name);
			continue;
		}
		ResolvedActions.Add(Entry.Role, Action);
	}

	if (ResolvedMappingContexts.Num() == 0)
	{
		bFullyAuthored = false;
	}

	return ResolvedMappingContexts.Num() > 0 && ResolvedActions.Num() == static_cast<int32>(EGameProjectInputAction::MAX);
}

UInputAction* UOpenWorldInputConfig::GetAction(EGameProjectInputAction Action) const
{
	const TObjectPtr<UInputAction>* Found = ResolvedActions.Find(Action);
	return Found ? Found->Get() : nullptr;
}

int32 UOpenWorldInputConfig::GetMappingPriority(const UInputMappingContext* Context) const
{
	if (Context == ResolvedGamepadContext)
	{
		return GamepadMappingPriority;
	}
	return PlayerMappingPriority;
}

void UOpenWorldInputConfig::SetRuntimeFallback(UInputMappingContext* PlayerContext, UInputMappingContext* GamepadContext, const TMap<EGameProjectInputAction, TObjectPtr<UInputAction>>& Actions)
{
	ResolvedPlayerContext = PlayerContext;
	ResolvedGamepadContext = GamepadContext;
	ResolvedActions = Actions;

	ResolvedMappingContexts.Reset();
	if (ResolvedPlayerContext)
	{
		ResolvedMappingContexts.Add(ResolvedPlayerContext);
	}
	if (ResolvedGamepadContext)
	{
		ResolvedMappingContexts.Add(ResolvedGamepadContext);
	}

	bAssetsResolved = true;
	bFullyAuthored = false;

	UE_LOG(LogGameProjectInput, Log,
		TEXT("Built runtime fallback input: %d mapping context(s), %d action(s). Keyboard/mouse are live; author IMC_Player + IA_* assets to replace this."),
		ResolvedMappingContexts.Num(), ResolvedActions.Num());
}
