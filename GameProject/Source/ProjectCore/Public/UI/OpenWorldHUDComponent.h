// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "Interaction/InteractionTypes.h"
#include "OpenWorldHUDComponent.generated.h"

class UOpenWorldHUDWidget;
class AActor;
class APlayerController;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnPlayerHUDCreated, UOpenWorldHUDWidget*, HUDWidget);

/**
 * Glue between gameplay systems and the HUD widget.
 *
 * Lives on the player controller rather than the widget so that:
 *  - the widget stays purely presentational (it never queries the world),
 *  - swapping WBP_PlayerHUD for another class is a config change, not a refactor,
 *  - refresh cost is controlled here, on a timer, instead of by whatever
 *    UUserWidget::Tick a designer might enable by accident.
 */
UCLASS(ClassGroup = (GameProject), meta = (BlueprintSpawnableComponent, DisplayName = "Open World HUD"))
class PROJECTCORE_API UOpenWorldHUDComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UOpenWorldHUDComponent();

	//~ Begin UActorComponent
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
	//~ End UActorComponent

	/** Overrides UGameProjectSettings::PlayerHUDWidgetClass for this controller. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "GameProject|HUD")
	TSoftClassPtr<UOpenWorldHUDWidget> HUDWidgetClassOverride;

	/** Seconds between debug/vitals refreshes. Prompts are event driven and instant. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "GameProject|HUD", meta = (ClampMin = "0.05", ClampMax = "2.0"))
	float RefreshInterval = 0.25f;

	/** Key label used in the prompt sentence, e.g. "E". */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "GameProject|HUD")
	FString InteractKeyHint = TEXT("E");

	UFUNCTION(BlueprintPure, Category = "GameProject|HUD")
	UOpenWorldHUDWidget* GetHUDWidget() const { return HUDWidget; }

	/** Creates and adds the widget. Safe to call twice. */
	UFUNCTION(BlueprintCallable, Category = "GameProject|HUD")
	bool CreateHUDWidget();

	UFUNCTION(BlueprintCallable, Category = "GameProject|HUD")
	void DestroyHUDWidget();

	/** Pushed by the interaction component's focus delegate - immediate, not polled. */
	UFUNCTION(BlueprintCallable, Category = "GameProject|HUD")
	void HandleInteractionFocusChanged(AActor* NewFocus, const FInteractionPrompt& Prompt);

	/** Forces a refresh of the polled sections (debug text, vitals, money). */
	UFUNCTION(BlueprintCallable, Category = "GameProject|HUD")
	void RefreshPolledSections();

	/**
	 * Re-binds to whatever pawn the owning controller currently possesses.
	 * Called on possess/unpossess so the HUD follows the player into a vehicle or
	 * a different body without the controller knowing any widget details.
	 */
	UFUNCTION(BlueprintCallable, Category = "GameProject|HUD")
	void RefreshPawnBinding();

	UPROPERTY(BlueprintAssignable, Category = "GameProject|HUD")
	FOnPlayerHUDCreated OnHUDCreated;

protected:
	void HandleInteractionFocusChangedInternal(AActor* NewFocus, const FInteractionPrompt& Prompt);

	/** Subscribes to whatever the current pawn exposes. Called on possession change. */
	void BindPawn(APlayerController& OwnerController);
	void UnbindPawn();

	UPROPERTY(Transient)
	TObjectPtr<UOpenWorldHUDWidget> HUDWidget;

	UPROPERTY(Transient)
	TObjectPtr<AActor> BoundPawn;

	FInteractionPrompt LastPrompt;
	FTimerHandle RefreshTimerHandle;
};
