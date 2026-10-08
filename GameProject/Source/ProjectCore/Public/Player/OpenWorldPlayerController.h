// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "InputActionValue.h"
#include "OpenWorldPlayerController.generated.h"

class UOpenWorldHUDComponent;
class UOpenWorldInputConfig;
class AOpenWorldPlayerCharacter;
class UInputMappingContext;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnMapToggleRequested, bool, bShouldOpen);

/**
 * Owns input routing, the HUD and developer commands.
 *
 * Input is bound here rather than on the character so the same bindings keep
 * working when the possessed pawn changes - a vehicle, a drone or a different
 * character in a later phase. The handlers are virtual for exactly that reason:
 * a subclass can reroute them without re-binding anything.
 *
 * The controller owns no movement maths. It scales raw device input by the
 * player's sensitivity setting and hands a direction to the pawn; the pawn
 * decides what that means physically.
 */
UCLASS()
class PROJECTCORE_API AOpenWorldPlayerController : public APlayerController
{
	GENERATED_BODY()

public:
	AOpenWorldPlayerController();

	//~ Begin AActor / APlayerController
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
	virtual void SetupInputComponent() override;
	virtual void OnPossess(APawn* InPawn) override;
	virtual void OnUnPossess() override;
	//~ End AActor / APlayerController

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
	TObjectPtr<UOpenWorldHUDComponent> HUDComponent;

	/** Resolved at BeginPlay; either the authored asset or a runtime-built fallback. */
	UPROPERTY(Transient, BlueprintReadOnly, Category = "GameProject|Input")
	TObjectPtr<UOpenWorldInputConfig> InputConfig;

	/** Overrides UGameProjectSettings::InputConfig for this controller only. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "GameProject|Input")
	TSoftObjectPtr<UOpenWorldInputConfig> InputConfigOverride;

	/** Fired when the player asks for the map. The map screen itself is a later phase. */
	UPROPERTY(BlueprintAssignable, Category = "GameProject|UI")
	FOnMapToggleRequested OnMapToggleRequested;

	UFUNCTION(BlueprintPure, Category = "GameProject|Player")
	AOpenWorldPlayerCharacter* GetPlayerCharacter() const;

	/** Registers or removes the player's input mapping contexts. */
	UFUNCTION(BlueprintCallable, Category = "GameProject|Input")
	void ApplyInputMappingContexts(bool bAdd);

	// ------------------------------------------------------------- dev commands
	/** `DebugToggle FPS` / `DebugToggle VoxelVisualisation` / `DebugToggle All`. */
	UFUNCTION(Exec, BlueprintCallable, Category = "GameProject|Debug")
	void DebugToggle(const FString& ChannelName);

	UFUNCTION(Exec, BlueprintCallable, Category = "GameProject|Debug")
	void DebugOff();

	UFUNCTION(Exec, BlueprintCallable, Category = "GameProject|Save")
	void SaveSlot(int32 Slot);

	UFUNCTION(Exec, BlueprintCallable, Category = "GameProject|Save")
	void LoadSlot(int32 Slot);

protected:
	// ------------------------------------------------------------- input handlers
	/** Virtual so a future vehicle controller can reroute without rebinding. */
	virtual void OnMoveInputTriggered(const FInputActionValue& Value);
	virtual void OnMoveInputCompleted(const FInputActionValue& Value);
	virtual void OnLookInputTriggered(const FInputActionValue& Value);
	virtual void OnLookInputCompleted(const FInputActionValue& Value);
	virtual void OnJumpStarted(const FInputActionValue& Value);
	virtual void OnJumpCompleted(const FInputActionValue& Value);
	virtual void OnSprintStarted(const FInputActionValue& Value);
	virtual void OnSprintCompleted(const FInputActionValue& Value);
	virtual void OnCrouchTriggered(const FInputActionValue& Value);
	virtual void OnInteractTriggered(const FInputActionValue& Value);
	virtual void OnOpenMapTriggered(const FInputActionValue& Value);

	/** Resolves the authored config or synthesises the runtime fallback. */
	UOpenWorldInputConfig* ResolveInputConfig();

	/** Binds every action the config resolved. Missing actions are skipped, not fatal. */
	void BindInputActions();

	/** Human-readable key for the interact prompt, taken from the active mapping. */
	void RefreshInteractKeyHint();

	bool bMapOpen = false;
};
