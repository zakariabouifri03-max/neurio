// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Character.h"
#include "GameplayTagContainer.h"
#include "OpenWorldPlayerCharacter.generated.h"

class UOpenWorldCameraRigComponent;
class UOpenWorldInteractionComponent;
class UOpenWorldStreamingSourceComponent;
class UOpenWorldMovementSettings;
class UStaticMeshComponent;
class USpringArmComponent;

/** On-foot movement gait. Drives speed, rotation rate and camera feel. */
UENUM(BlueprintType)
enum class EOpenWorldGait : uint8
{
	Walk	UMETA(DisplayName = "Walk"),
	Run		UMETA(DisplayName = "Run"),
	Sprint	UMETA(DisplayName = "Sprint"),
	Crouch	UMETA(DisplayName = "Crouch")
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnPlayerGaitChanged, EOpenWorldGait, PreviousGait, EOpenWorldGait, NewGait);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnPlayerVitalsChanged, float, Health, float, Armor);

/**
 * The on-foot player pawn.
 *
 * Composition over inheritance, deliberately:
 *  - camera behaviour lives in UOpenWorldCameraRigComponent
 *  - what the player is looking at lives in UOpenWorldInteractionComponent
 *  - World Partition streaming presence lives in UOpenWorldStreamingSourceComponent
 *  - all tuning lives in UOpenWorldMovementSettings (a data asset)
 *
 * What is left here is only what a pawn must own: applying input, gait state and
 * vitals. That is what lets Phase 02+ add a drivable vehicle pawn without this
 * class changing at all - the controller keeps its bindings and simply routes
 * them to whichever pawn it possesses.
 *
 * This class adds no Tick of its own. Everything is event driven; the inherited
 * ACharacter tick still runs the engine's own movement/animation work.
 */
UCLASS()
class PROJECTCORE_API AOpenWorldPlayerCharacter : public ACharacter
{
	GENERATED_BODY()

public:
	AOpenWorldPlayerCharacter();

	//~ Begin AActor / APawn / ACharacter
	virtual void BeginPlay() override;
	virtual void PossessedBy(AController* NewController) override;
	virtual void Landed(const FHitResult& Hit) override;
	virtual void FellOutOfWorld(const class UClass* DamageType) override;
	virtual void Crouch(bool bClientSimulation = false) override;
	virtual void UnCrouch(bool bClientSimulation = false) override;
	//~ End AActor / APawn / ACharacter

	// ------------------------------------------------------------- input entry points
	/**
	 * All of these are called by AOpenWorldPlayerController from Enhanced Input
	 * handlers. They are public so a Blueprint controller or a replay system can
	 * drive the same pawn without reaching into private state.
	 */
	UFUNCTION(BlueprintCallable, Category = "GameProject|Player|Input")
	void ApplyMoveInput(const FVector2D& AxisValue);

	UFUNCTION(BlueprintCallable, Category = "GameProject|Player|Input")
	void ApplyLookInput(const FVector2D& AxisValue);

	UFUNCTION(BlueprintCallable, Category = "GameProject|Player|Input")
	void StartJump();

	UFUNCTION(BlueprintCallable, Category = "GameProject|Player|Input")
	void StopJump();

	UFUNCTION(BlueprintCallable, Category = "GameProject|Player|Input")
	void SetSprintHeld(bool bHeld);

	UFUNCTION(BlueprintCallable, Category = "GameProject|Player|Input")
	void ToggleCrouch();

	UFUNCTION(BlueprintCallable, Category = "GameProject|Player|Input")
	void RequestInteract();

	// ------------------------------------------------------------- state
	UFUNCTION(BlueprintPure, Category = "GameProject|Player")
	EOpenWorldGait GetCurrentGait() const { return CurrentGait; }

	UFUNCTION(BlueprintPure, Category = "GameProject|Player")
	bool IsSprintHeld() const { return bSprintHeld; }

	UFUNCTION(BlueprintPure, Category = "GameProject|Player")
	float GetHorizontalSpeed() const;

	/** Tags describing the current locomotion state, for animation/UI/AI queries. */
	UFUNCTION(BlueprintPure, Category = "GameProject|Player")
	FGameplayTagContainer GetPlayerStateTags() const;

	UPROPERTY(BlueprintAssignable, Category = "GameProject|Player")
	FOnPlayerGaitChanged OnGaitChanged;

	// ------------------------------------------------------------- vitals (foundation only)
	/**
	 * Health and armour are plain values in Phase 01 - no damage pipeline, no
	 * attributes, no gameplay abilities. They exist so the HUD, the save game and
	 * the player state all agree on where these numbers live before combat lands.
	 */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "GameProject|Player|Vitals", meta = (ClampMin = "0.0"))
	float Health = 100.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "GameProject|Player|Vitals", meta = (ClampMin = "0.0"))
	float MaxHealth = 100.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "GameProject|Player|Vitals", meta = (ClampMin = "0.0"))
	float Armor = 0.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "GameProject|Player|Vitals", meta = (ClampMin = "0.0"))
	float MaxArmor = 100.0f;

	UFUNCTION(BlueprintCallable, Category = "GameProject|Player|Vitals")
	void SetHealth(float NewHealth);

	UFUNCTION(BlueprintCallable, Category = "GameProject|Player|Vitals")
	void SetArmor(float NewArmor);

	UPROPERTY(BlueprintAssignable, Category = "GameProject|Player|Vitals")
	FOnPlayerVitalsChanged OnVitalsChanged;

	// ------------------------------------------------------------- components
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
	TObjectPtr<UOpenWorldCameraRigComponent> CameraRig;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
	TObjectPtr<UOpenWorldInteractionComponent> Interaction;

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
	TObjectPtr<UOpenWorldStreamingSourceComponent> StreamingSource;

	/**
	 * Blocky stand-in used when no skeletal mesh is assigned, so a code-only
	 * checkout still shows a visible character. Removed from play as soon as a real
	 * mesh is authored - it is a development aid, not the character.
	 */
	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Components")
	TObjectPtr<UStaticMeshComponent> PlaceholderBody;

	/** Resolved once per possession; held here so the asset stays referenced. */
	UPROPERTY(Transient)
	TObjectPtr<const UOpenWorldMovementSettings> MovementSettings;

	/** Physical surface under the feet - the hook future footsteps/impacts use. */
	UFUNCTION(BlueprintPure, Category = "GameProject|Player")
	EPhysicalSurface GetCurrentGroundSurfaceType() const;

protected:
	/** Picks the gait from current intent and applies it to movement + camera. */
	void UpdateGait();

	/** Applies the data asset's non-gait values once, on possession. */
	void ApplyMovementBaseSettings();

	void UpdatePlayerStateTags();
	void EnsurePlaceholderVisuals();

	/**
	 * Last known-good ground position, refreshed on BeginPlay and on Landed.
	 * Event driven on purpose - a "safe position" tracker that ticks every frame
	 * would be the most expensive line in the class for the rarest event.
	 */
	FVector LastSafeLocation = FVector::ZeroVector;

	UPROPERTY(Transient)
	FGameplayTagContainer PlayerStateTags;

	EOpenWorldGait CurrentGait = EOpenWorldGait::Run;
	FVector2D PendingMoveInput = FVector2D::ZeroVector;
	bool bSprintHeld = false;
	bool bHasMoveInput = false;
};
