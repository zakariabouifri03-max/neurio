// Copyright GameProject. All rights reserved. Original content only.

#include "UI/OpenWorldHUDWidget.h"

#include "Components/ProgressBar.h"
#include "Components/SlateWrapperTypes.h"
#include "Components/TextBlock.h"
#include "Core/GameProjectLog.h"

void UOpenWorldHUDWidget::SetInteractionPrompt(const FInteractionPrompt& Prompt, const FString& KeyHint)
{
	// A stable cache key means holding the crosshair on a door produces zero Slate
	// work after the first frame, which is the common case.
	const FString Key = Prompt.bIsValid
		? FString::Printf(TEXT("%s|%s|%s|%d"), *Prompt.ActionVerb.ToString(), *Prompt.TargetName.ToString(),
			*Prompt.DetailText.ToString(), Prompt.HoldDuration > 0.0f ? 1 : 0)
		: FString();

	if (Key == CachedPromptKey)
	{
		return;
	}
	CachedPromptKey = Key;

	if (Text_InteractionPrompt)
	{
		if (Prompt.bIsValid)
		{
			// "Press [E] Open - Wooden Door". The HUD owns the sentence structure so
			// localisation lives in one place instead of in every interactable.
			const FString Line = KeyHint.IsEmpty()
				? FString::Printf(TEXT("%s - %s"), *Prompt.ActionVerb.ToString(), *Prompt.TargetName.ToString())
				: FString::Printf(TEXT("Press [%s] %s - %s"), *KeyHint, *Prompt.ActionVerb.ToString(), *Prompt.TargetName.ToString());

			Text_InteractionPrompt->SetText(FText::FromString(Line));
			Text_InteractionPrompt->SetVisibility(ESlateVisibility::HitTestInvisible);
		}
		else
		{
			Text_InteractionPrompt->SetText(FText::GetEmpty());
			Text_InteractionPrompt->SetVisibility(ESlateVisibility::Collapsed);
		}
	}

	OnInteractionPromptChanged(Prompt, KeyHint);
}

void UOpenWorldHUDWidget::SetDebugText(const FString& DebugText)
{
	if (DebugText == CachedDebugText)
	{
		return;
	}
	CachedDebugText = DebugText;

	if (Text_DebugInfo)
	{
		Text_DebugInfo->SetText(FText::FromString(DebugText));
		Text_DebugInfo->SetVisibility(DebugText.IsEmpty() ? ESlateVisibility::Collapsed : ESlateVisibility::HitTestInvisible);
	}

	OnDebugTextChanged(DebugText);
}

void UOpenWorldHUDWidget::SetHealth(float Health01)
{
	if (ProgressBar_Health)
	{
		ProgressBar_Health->SetPercent(FMath::Clamp(Health01, 0.0f, 1.0f));
	}
}

void UOpenWorldHUDWidget::SetArmor(float Armor01)
{
	if (ProgressBar_Armor)
	{
		ProgressBar_Armor->SetPercent(FMath::Clamp(Armor01, 0.0f, 1.0f));
	}
}

void UOpenWorldHUDWidget::SetMoney(int32 Money)
{
	if (Money == CachedMoney)
	{
		return;
	}
	CachedMoney = Money;

	if (Text_Money)
	{
		Text_Money->SetText(FText::AsNumber(Money));
	}
}

void UOpenWorldHUDWidget::SetWantedLevel(int32 WantedLevel)
{
	const int32 Clamped = FMath::Clamp(WantedLevel, 0, 5);
	if (Clamped == CachedWantedLevel)
	{
		return;
	}
	CachedWantedLevel = Clamped;

	if (Text_WantedLevel)
	{
		// Stars are a placeholder representation, not final art.
		FString Stars;
		for (int32 Index = 0; Index < Clamped; ++Index)
		{
			Stars += TEXT("*");
		}
		Text_WantedLevel->SetText(FText::FromString(Stars.IsEmpty() ? TEXT("-") : Stars));
		Text_WantedLevel->SetVisibility(Clamped > 0 ? ESlateVisibility::HitTestInvisible : ESlateVisibility::Collapsed);
	}

	OnWantedLevelChanged(Clamped);
}

void UOpenWorldHUDWidget::SetMissionObjective(const FText& ObjectiveText)
{
	if (Text_MissionObjective)
	{
		Text_MissionObjective->SetText(ObjectiveText);
		Text_MissionObjective->SetVisibility(ObjectiveText.IsEmpty() ? ESlateVisibility::Collapsed : ESlateVisibility::HitTestInvisible);
	}
}

void UOpenWorldHUDWidget::SetMinimapVisible(bool bVisible)
{
	if (Widget_Minimap)
	{
		Widget_Minimap->SetVisibility(bVisible ? ESlateVisibility::HitTestInvisible : ESlateVisibility::Collapsed);
	}
}
