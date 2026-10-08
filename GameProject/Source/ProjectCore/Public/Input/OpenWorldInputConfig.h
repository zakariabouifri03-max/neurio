// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "OpenWorldInputConfig.generated.h"

class UInputAction;
class UInputMappingContext;

/**
 * Role-based handle on a player input action.
 *
 * Gameplay code asks for a *role* ("Interact"), never for a specific asset.
 * That is what lets the whole input layer be re-authored, rebound or localised
 * without touching a single gameplay class - and what lets gamepad/mobile
 * contexts be layered on later without code changes.
 */
UENUM(BlueprintType)
enum class EGameProjectInputAction : uint8
{
	Move		UMETA(DisplayName = "Move"),
	Look		UMETA(DisplayName = "Look"),
	Jump		UMETA(DisplayName = "Jump"),
	Sprint		UMETA(DisplayName = "Sprint"),
	Crouch		UMETA(DisplayName = "Crouch"),
	Interact	UMETA(DisplayName = "Interact"),
	OpenMap		UMETA(DisplayName = "Open Map"),

	MAX			UMETA(Hidden)
};

/**
 * Designer-facing Enhanced Input configuration.
 *
 * Soft references on purpose: the mapping contexts are only loaded when a player
 * controller actually needs them, which keeps them out of the startup critical
 * path and out of memory on a dedicated server.
 */
UCLASS(BlueprintType, meta = (DisplayName = "Open World Input Config"))
class PROJECTCORE_API UOpenWorldInputConfig : public UDataAsset
{
	GENERATED_BODY()

public:
	UOpenWorldInputConfig();

	// ------------------------------------------------------- authored assets
	/** Keyboard + mouse context. Required. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mapping Contexts")
	TSoftObjectPtr<UInputMappingContext> PlayerMappingContext;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mapping Contexts", meta = (ClampMin = "0", ClampMax = "100"))
	int32 PlayerMappingPriority = 10;

	/** Optional gamepad context; layered under the keyboard/mouse one. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mapping Contexts")
	TSoftObjectPtr<UInputMappingContext> GamepadMappingContext;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Mapping Contexts", meta = (ClampMin = "0", ClampMax = "100"))
	int32 GamepadMappingPriority = 5;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Actions")
	TSoftObjectPtr<UInputAction> MoveAction;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Actions")
	TSoftObjectPtr<UInputAction> LookAction;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Actions")
	TSoftObjectPtr<UInputAction> JumpAction;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Actions")
	TSoftObjectPtr<UInputAction> SprintAction;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Actions")
	TSoftObjectPtr<UInputAction> CrouchAction;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Actions")
	TSoftObjectPtr<UInputAction> InteractAction;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Actions")
	TSoftObjectPtr<UInputAction> OpenMapAction;

	/** Crouch is a toggle by default (single-player third person convention). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Behaviour")
	bool bCrouchIsToggle = true;

	/** Invert vertical look. Read at bind time so it can be driven from settings. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Behaviour")
	bool bInvertLookY = false;

	// ------------------------------------------------------- runtime API
	/**
	 * Resolves every soft reference into the hard-referenced caches below.
	 * Called once per player controller possession; safe to call repeatedly.
	 * @return true when at least the player mapping context and all actions resolved.
	 */
	bool ResolveAssets();

	/** True when nothing had to be synthesised at runtime. */
	bool IsFullyAuthored() const { return bFullyAuthored; }

	UFUNCTION(BlueprintPure, Category = "GameProject|Input")
	UInputAction* GetAction(EGameProjectInputAction Action) const;

	UFUNCTION(BlueprintPure, Category = "GameProject|Input")
	const TArray<TObjectPtr<UInputMappingContext>>& GetResolvedMappingContexts() const { return ResolvedMappingContexts; }

	UFUNCTION(BlueprintPure, Category = "GameProject|Input")
	int32 GetMappingPriority(const UInputMappingContext* Context) const;

	/** Used by the runtime fallback builder (see OpenWorldInputBootstrap.h). */
	void SetRuntimeFallback(UInputMappingContext* PlayerContext, UInputMappingContext* GamepadContext, const TMap<EGameProjectInputAction, TObjectPtr<UInputAction>>& Actions);

private:
	/**
	 * Hard references. Soft pointers do not keep an object alive, so anything we
	 * resolved (or synthesised) is cached here to survive garbage collection.
	 */
	UPROPERTY(Transient)
	TArray<TObjectPtr<UInputMappingContext>> ResolvedMappingContexts;

	UPROPERTY(Transient)
	TMap<EGameProjectInputAction, TObjectPtr<UInputAction>> ResolvedActions;

	UPROPERTY(Transient)
	TObjectPtr<UInputMappingContext> ResolvedPlayerContext;

	UPROPERTY(Transient)
	TObjectPtr<UInputMappingContext> ResolvedGamepadContext;

	bool bFullyAuthored = true;
	bool bAssetsResolved = false;
};
