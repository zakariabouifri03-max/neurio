// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "Blueprint/UserWidget.h"
#include "Interaction/InteractionTypes.h"
#include "OpenWorldHUDWidget.generated.h"

class UTextBlock;
class UProgressBar;
class UWidget;
class USizeBox;

/**
 * Native base class for WBP_PlayerHUD.
 *
 * The contract between C++ and UMG is the point of this class:
 *  - Widgets are bound *optionally*, so a designer can rebuild the whole HUD
 *    layout, rename containers or ship a completely different WBP as long as the
 *    widget names below exist. A missing widget degrades to "not shown", never to
 *    a Blueprint compile error - which is what keeps the UI replaceable.
 *  - Every value has both a C++ setter (used by the HUD component) and a
 *    BlueprintImplementableEvent hook, so animated/fancy presentation can be added
 *    in UMG without touching C++.
 *
 * Phase 01 only feeds the interaction prompt and the debug text. The remaining
 * setters exist and are wired, so the moment a widget is named in the WBP the
 * value appears - no code change required.
 */
UCLASS(Abstract = false, meta = (DisplayName = "Open World HUD"))
class PROJECTCORE_API UOpenWorldHUDWidget : public UUserWidget
{
	GENERATED_BODY()

public:
	// ------------------------------------------------------------- bound widgets
	/** Optional on purpose - see the class comment. */
	UPROPERTY(BlueprintReadOnly, Category = "GameProject|HUD", meta = (BindWidgetOptional))
	TObjectPtr<UTextBlock> Text_InteractionPrompt;

	UPROPERTY(BlueprintReadOnly, Category = "GameProject|HUD", meta = (BindWidgetOptional))
	TObjectPtr<UTextBlock> Text_DebugInfo;

	UPROPERTY(BlueprintReadOnly, Category = "GameProject|HUD", meta = (BindWidgetOptional))
	TObjectPtr<UProgressBar> ProgressBar_Health;

	UPROPERTY(BlueprintReadOnly, Category = "GameProject|HUD", meta = (BindWidgetOptional))
	TObjectPtr<UProgressBar> ProgressBar_Armor;

	UPROPERTY(BlueprintReadOnly, Category = "GameProject|HUD", meta = (BindWidgetOptional))
	TObjectPtr<UTextBlock> Text_Money;

	UPROPERTY(BlueprintReadOnly, Category = "GameProject|HUD", meta = (BindWidgetOptional))
	TObjectPtr<UTextBlock> Text_WantedLevel;

	UPROPERTY(BlueprintReadOnly, Category = "GameProject|HUD", meta = (BindWidgetOptional))
	TObjectPtr<UTextBlock> Text_MissionObjective;

	UPROPERTY(BlueprintReadOnly, Category = "GameProject|HUD", meta = (BindWidgetOptional))
	TObjectPtr<UWidget> Widget_Minimap;

	// ------------------------------------------------------------- C++ setters
	/** Shows or hides the interaction prompt. Empty prompt == hidden. */
	UFUNCTION(BlueprintCallable, Category = "GameProject|HUD")
	void SetInteractionPrompt(const FInteractionPrompt& Prompt, const FString& KeyHint);

	UFUNCTION(BlueprintCallable, Category = "GameProject|HUD")
	void SetDebugText(const FString& DebugText);

	UFUNCTION(BlueprintCallable, Category = "GameProject|HUD")
	void SetHealth(float Health01);

	UFUNCTION(BlueprintCallable, Category = "GameProject|HUD")
	void SetArmor(float Armor01);

	UFUNCTION(BlueprintCallable, Category = "GameProject|HUD")
	void SetMoney(int32 Money);

	UFUNCTION(BlueprintCallable, Category = "GameProject|HUD")
	void SetWantedLevel(int32 WantedLevel);

	UFUNCTION(BlueprintCallable, Category = "GameProject|HUD")
	void SetMissionObjective(const FText& ObjectiveText);

	/** Minimap visibility is driven separately so it can fade with the game state. */
	UFUNCTION(BlueprintCallable, Category = "GameProject|HUD")
	void SetMinimapVisible(bool bVisible);

	// ------------------------------------------------------------- UMG hooks
	/** Override in Blueprint for animated presentation (damage flash, money roll-up...). */
	UFUNCTION(BlueprintImplementableEvent, Category = "GameProject|HUD")
	void OnInteractionPromptChanged(const FInteractionPrompt& Prompt, const FString& KeyHint);

	UFUNCTION(BlueprintImplementableEvent, Category = "GameProject|HUD")
	void OnDebugTextChanged(const FString& DebugText);

	UFUNCTION(BlueprintImplementableEvent, Category = "GameProject|HUD")
	void OnWantedLevelChanged(int32 WantedLevel);

protected:
	/** Last values, so identical updates never touch Slate. */
	FString CachedPromptKey;
	FString CachedDebugText;
	int32 CachedMoney = INT_MIN;
	int32 CachedWantedLevel = -1;
};
