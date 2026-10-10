// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/PlayerController.h"
#include "BCUPlayerController.generated.h"

class UInputMappingContext;
class UInputAction;
class UBCUCameraSystem;
class ABCUBaseVehicle;
class ABCUPlayerCharacter;
class UBCUInteractionComponent;
struct FInputActionValue;

UENUM(BlueprintType)
enum class EBCUControlContext : uint8
{
	OnFoot		UMETA(DisplayName = "On Foot"),
	Driving		UMETA(DisplayName = "Driving"),
	UI			UMETA(DisplayName = "UI / Paused"),
	Cinematic	UMETA(DisplayName = "Cinematic")
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnBCUControlContextChanged, EBCUControlContext, NewContext, EBCUControlContext, OldContext);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnBCUVehicleChanged, ABCUBaseVehicle*, Vehicle);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnBCUUIToggleRequested, FName, PanelId, bool, bOpen);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnBCURespawnFadeRequested, float, Duration, bool, bWasArrested);

/**
 * The only place that owns input for BLOCK CITY ULTRA.
 *
 * Input is Enhanced Input and *context swapped*: IMC_OnFoot while walking,
 * IMC_Driving while in a vehicle, IMC_UI over both when a menu is open.
 * Swapping contexts here (rather than per-pawn) means a vehicle entered while
 * a menu is open still gets the right mapping when the menu closes.
 */
UCLASS(Blueprintable)
class BLOCKCITYULTRA_API ABCUPlayerController : public APlayerController
{
	GENERATED_BODY()

public:
	ABCUPlayerController();

	//~ APlayerController
	virtual void BeginPlay() override;
	virtual void SetupInputComponent() override;
	virtual void OnPossess(APawn* InPawn) override;
	virtual void OnUnPossess() override;
	virtual void Tick(float DeltaSeconds) override;
	virtual void PlayerTick(float DeltaTime) override;
	virtual void SetPause(bool bPaused) override;
	//~ End APlayerController

	/** Convenience accessor for the possessed BCU pawn. */
	UFUNCTION(BlueprintPure, Category = "BCU|Controller")
	ABCUPlayerCharacter* GetBCUPawn() const;

	// ── Vehicle entry / exit ────────────────────────────────────────────────
	/** Enters the given vehicle (seats are resolved by the vehicle itself). */
	UFUNCTION(BlueprintCallable, Category = "BCU|Controller|Vehicle")
	bool EnterVehicle(ABCUBaseVehicle* Vehicle, int32 SeatIndex = 0);

	/** Exits the current vehicle; bForce ignores the "safe to exit" check. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Controller|Vehicle")
	void ExitVehicleIfDriving(bool bForce = false);

	/** The vehicle the player currently drives, or nullptr. */
	UFUNCTION(BlueprintPure, Category = "BCU|Controller|Vehicle")
	ABCUBaseVehicle* GetDrivenVehicle() const { return DrivenVehicle; }

	UPROPERTY(BlueprintAssignable, Category = "BCU|Controller|Vehicle")
	FOnBCUVehicleChanged OnVehicleChanged;

	// ── Control contexts ────────────────────────────────────────────────────
	UFUNCTION(BlueprintCallable, Category = "BCU|Controller|Input")
	void SetControlContext(EBCUControlContext NewContext);

	UFUNCTION(BlueprintPure, Category = "BCU|Controller|Input")
	EBCUControlContext GetControlContext() const { return CurrentContext; }

	UPROPERTY(BlueprintAssignable, Category = "BCU|Controller|Input")
	FOnBCUControlContextChanged OnControlContextChanged;

	/** HUD opens/closes the named panel (Map, Phone, Inventory, Pause). */
	UPROPERTY(BlueprintAssignable, Category = "BCU|Controller|UI")
	FOnBCUUIToggleRequested OnUIToggleRequested;

	/** HUD plays the fade + WASTED/BUSTED card. */
	UPROPERTY(BlueprintAssignable, Category = "BCU|Controller|UI")
	FOnBCURespawnFadeRequested OnRespawnFadeRequested;

	// ── UI toggles (bound in IMC_UI) ────────────────────────────────────────
	UFUNCTION(BlueprintCallable, Category = "BCU|Controller|UI")
	void ToggleMap();

	UFUNCTION(BlueprintCallable, Category = "BCU|Controller|UI")
	void TogglePhone();

	UFUNCTION(BlueprintCallable, Category = "BCU|Controller|UI")
	void ToggleInventory();

	UFUNCTION(BlueprintCallable, Category = "BCU|Controller|UI")
	void TogglePauseMenu();

	UFUNCTION(BlueprintPure, Category = "BCU|Controller|UI")
	bool IsAnyMenuOpen() const { return bAnyMenuOpen; }

	// ── Respawn plumbing used by the game mode ──────────────────────────────
	/** Plays the fade, flips the WASTED/BUSTED card and unpossesses. */
	void PlayRespawnFade(float Duration, bool bWasArrested);

	/** Brings the pawn back to life with full health at its current location. */
	void ReviveAndUnpossessVehicle();

	/** Hard-teleport used by the game mode's tagged spawn points. */
	bool TeleportToLocation(const FVector& Location, const FRotator& Rotation);

	/** Spawn tag requested by a mission, consumed on the next respawn. */
	void RequestPendingSpawnTag(FName Tag) { PendingSpawnTag = Tag; }
	FName GetPendingSpawnTag() const { return PendingSpawnTag; }

protected:
	// ── Enhanced Input assets (assigned in BP_BCUPlayerController) ──────────
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "BCU|Controller|Input")
	TObjectPtr<UInputMappingContext> OnFootMappingContext;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "BCU|Controller|Input")
	TObjectPtr<UInputMappingContext> DrivingMappingContext;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "BCU|Controller|Input")
	TObjectPtr<UInputMappingContext> UIMappingContext;

	/** Highest priority — always resident so Escape works everywhere. */
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "BCU|Controller|Input")
	TObjectPtr<UInputMappingContext> GlobalMappingContext;

	// On foot
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "BCU|Controller|Input|Actions")
	TObjectPtr<UInputAction> IA_Move;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "BCU|Controller|Input|Actions")
	TObjectPtr<UInputAction> IA_Look;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "BCU|Controller|Input|Actions")
	TObjectPtr<UInputAction> IA_Jump;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "BCU|Controller|Input|Actions")
	TObjectPtr<UInputAction> IA_Sprint;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "BCU|Controller|Input|Actions")
	TObjectPtr<UInputAction> IA_EnterVehicle;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "BCU|Controller|Input|Actions")
	TObjectPtr<UInputAction> IA_Interact;

	// Driving
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "BCU|Controller|Input|Actions")
	TObjectPtr<UInputAction> IA_Throttle;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "BCU|Controller|Input|Actions")
	TObjectPtr<UInputAction> IA_Steer;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "BCU|Controller|Input|Actions")
	TObjectPtr<UInputAction> IA_Brake;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "BCU|Controller|Input|Actions")
	TObjectPtr<UInputAction> IA_Handbrake;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "BCU|Controller|Input|Actions")
	TObjectPtr<UInputAction> IA_ExitVehicle;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "BCU|Controller|Input|Actions")
	TObjectPtr<UInputAction> IA_Horn;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "BCU|Controller|Input|Actions")
	TObjectPtr<UInputAction> IA_CameraMode;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "BCU|Controller|Input|Actions")
	TObjectPtr<UInputAction> IA_LookBack;

	// UI
	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "BCU|Controller|Input|Actions")
	TObjectPtr<UInputAction> IA_Map;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "BCU|Controller|Input|Actions")
	TObjectPtr<UInputAction> IA_Phone;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "BCU|Controller|Input|Actions")
	TObjectPtr<UInputAction> IA_Inventory;

	UPROPERTY(EditDefaultsOnly, BlueprintReadOnly, Category = "BCU|Controller|Input|Actions")
	TObjectPtr<UInputAction> IA_Pause;

	// ── Input handlers ──────────────────────────────────────────────────────
	void OnMove(const FInputActionValue& Value);
	void OnLook(const FInputActionValue& Value);
	void OnSprintStarted();
	void OnSprintEnded();
	void OnEnterVehiclePressed();
	void OnInteractPressed();
	void OnThrottle(const FInputActionValue& Value);
	void OnSteer(const FInputActionValue& Value);
	void OnBrake(const FInputActionValue& Value);
	void OnHandbrakeStarted();
	void OnHandbrakeEnded();
	void OnExitVehiclePressed();
	void OnHornPressed();
	void OnCameraModePressed();
	void OnLookBackStarted();
	void OnLookBackEnded();

	void BindOnFootActions(UEnhancedInputComponent* EIC);
	void BindDrivingActions(UEnhancedInputComponent* EIC);
	void BindUIActions(UEnhancedInputComponent* EIC);
	void ClearActionBindings(UEnhancedInputComponent* EIC);

	// ── State ───────────────────────────────────────────────────────────────
	UPROPERTY(Transient)
	TObjectPtr<ABCUBaseVehicle> DrivenVehicle;

	EBCUControlContext CurrentContext = EBCUControlContext::OnFoot;
	bool bAnyMenuOpen = false;
	FName PendingSpawnTag = NAME_None;

	/** Interaction raycast budget: nearest enterable vehicle / NPC / door. */
	UPROPERTY(Transient)
	TObjectPtr<UBCUInteractionComponent> Interaction;

private:
	void SwapMappingContextsFor(EBCUControlContext NewContext);
	void BroadcastUIToggle(const FName& PanelId);
};
