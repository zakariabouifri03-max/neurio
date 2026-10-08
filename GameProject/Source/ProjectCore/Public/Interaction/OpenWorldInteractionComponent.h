// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "ProjectCore.h"
#include "Components/ActorComponent.h"
#include "Engine/EngineTypes.h"
#include "Interaction/InteractionTypes.h"
#include "OpenWorldInteractionComponent.generated.h"

class AActor;
class UOpenWorldCameraRigComponent;
class APawn;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnInteractionFocusChanged, AActor*, NewFocus, const FInteractionPrompt&, Prompt);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_ThreeParams(FOnInteractionExecuted, AActor*, Target, bool, bSuccess, EInteractionResult, Result);

/**
 * Finds what the player is looking at and runs the interaction.
 *
 * Performance notes that matter at open-world scale:
 *  - Scanning runs on a timer (default 20 Hz), not on Tick. A per-frame trace for
 *    a UI prompt is pure waste, and every streamed NPC will eventually own one of
 *    these components.
 *  - The camera rig pointer is cached once at BeginPlay, so there is no actor or
 *    component search per scan.
 *  - Focus changes are edge-triggered: nothing is broadcast while the player
 *    keeps looking at the same object.
 */
UCLASS(ClassGroup = (GameProject), meta = (BlueprintSpawnableComponent, DisplayName = "Open World Interaction"))
class PROJECTCORE_API UOpenWorldInteractionComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UOpenWorldInteractionComponent();

	//~ Begin UActorComponent
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
	//~ End UActorComponent

	/** Trace distance in cm. Defaults to UGameProjectSettings when <= 0. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Interaction", meta = (ClampMin = "-1.0", ClampMax = "10000.0"))
	float TraceDistance = -1.0f;

	/** >0 uses a sphere trace, which is far more forgiving for small objects. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Interaction", meta = (ClampMin = "-1.0", ClampMax = "200.0"))
	float TraceRadius = -1.0f;

	/** Seconds between probes. Defaults to UGameProjectSettings when <= 0. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Interaction", meta = (ClampMin = "-1.0", ClampMax = "1.0"))
	float ScanInterval = -1.0f;

	/**
	 * Trace channel. ECC_MAX means "inherit UGameProjectSettings::InteractionTraceChannel",
	 * which is the normal case; override per component only for special probes.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Interaction", meta = (DisplayName = "Trace Channel (ECC_MAX = project default)"))
	TEnumAsByte<ECollisionChannel> TraceChannel = ECC_MAX;

	/** Maximum hits examined per probe. Bounds the worst case in dense scenes. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "Interaction", meta = (ClampMin = "1", ClampMax = "32"))
	int32 MaxProbeHits = 8;

	/** Trace from the camera (true) or from the pawn's eye position (false). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Interaction")
	bool bTraceFromCamera = true;

	/** Filters out everything tagged with one of these (e.g. Interaction.Category.Disabled). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Interaction")
	FGameplayTagContainer IgnoredCategoryTags;

	/** The object the player is currently able to interact with. */
	UPROPERTY(BlueprintReadOnly, Category = "Interaction")
	TObjectPtr<AActor> FocusedInteractable;

	/** Prompt for the focused object; bIsValid is false when nothing is focused. */
	UPROPERTY(BlueprintReadOnly, Category = "Interaction")
	FInteractionPrompt CurrentPrompt;

	/** Fired when focus changes. The HUD binds to this and nothing else. */
	UPROPERTY(BlueprintAssignable, Category = "Interaction")
	FOnInteractionFocusChanged OnFocusChanged;

	/** Fired after an interaction attempt resolves. */
	UPROPERTY(BlueprintAssignable, Category = "Interaction")
	FOnInteractionExecuted OnInteractionExecuted;

	// ------------------------------------------------------------- API
	/** Starts the scan timer. Cheap to call repeatedly. */
	UFUNCTION(BlueprintCallable, Category = "GameProject|Interaction")
	void StartScanning();

	UFUNCTION(BlueprintCallable, Category = "GameProject|Interaction")
	void StopScanning();

	/** Runs one probe immediately (used by debug commands and tests). */
	UFUNCTION(BlueprintCallable, Category = "GameProject|Interaction")
	void ScanNow();

	/** Attempts to interact with the focused object. */
	UFUNCTION(BlueprintCallable, Category = "GameProject|Interaction")
	EInteractionResult TryInteract();

	/** True while a hold-to-interact is charging. */
	UFUNCTION(BlueprintPure, Category = "GameProject|Interaction")
	bool IsHoldInteractionPending() const { return HoldElapsedSeconds > 0.0f; }

	UFUNCTION(BlueprintPure, Category = "GameProject|Interaction")
	float GetHoldProgress() const;

	/** Aborts a hold-to-interact in progress (called on input release). */
	UFUNCTION(BlueprintCallable, Category = "GameProject|Interaction")
	void CancelHold();

#if GAMEPROJECT_WITH_DEBUG_TOOLS
	/** Toggles the trace visualisation without touching any other debug state. */
	UFUNCTION(BlueprintCallable, Category = "GameProject|Debug")
	void SetDrawDebugTrace(bool bEnabled);

	bool IsDrawingDebugTrace() const { return bDrawDebugTrace; }
#endif

protected:
	/** Resolves the probe ray for this frame. */
	bool BuildProbeRay(FVector& OutOrigin, FVector& OutDirection) const;

	/** Runs the probe, updates focus, and advances any hold-to-interact. */
	void PerformScan();

	/** Chooses the best candidate among the hits, honouring occluders. */
	AActor* SelectBestCandidate(const TArray<FHitResult>& Hits, FInteractionContext& OutContext) const;

	void SetFocus(AActor* NewFocus, const FInteractionContext& Context);
	void ClearFocus();

	/** Builds the prompt from the focused actor, or an invalid prompt when null. */
	FInteractionPrompt BuildPrompt(const AActor* Target) const;

	/** Cached at BeginPlay so scans never search the world or the component list. */
	UPROPERTY(Transient)
	TObjectPtr<UOpenWorldCameraRigComponent> CachedCameraRig;

	UPROPERTY(Transient)
	TObjectPtr<APawn> CachedOwnerPawn;

	FTimerHandle ScanTimerHandle;

	float ResolvedTraceDistance = 400.0f;
	float ResolvedTraceRadius = 12.0f;
	float ResolvedScanInterval = 0.05f;
	TEnumAsByte<ECollisionChannel> ResolvedTraceChannel = ECC_Visibility;

	/** Last probe endpoints, kept for debug drawing and for tests. */
	FVector LastProbeStart = FVector::ZeroVector;
	FVector LastProbeEnd = FVector::ZeroVector;
	FInteractionContext LastContext;

	float HoldElapsedSeconds = 0.0f;
	float RequiredHoldSeconds = 0.0f;

#if GAMEPROJECT_WITH_DEBUG_TOOLS
	bool bDrawDebugTrace = false;
#endif
};
