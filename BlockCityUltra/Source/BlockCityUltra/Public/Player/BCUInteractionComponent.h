// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "BCUInteractionComponent.generated.h"

class ABCUBaseVehicle;

UENUM(BlueprintType)
enum class EBCUInteractionKind : uint8
{
	None			UMETA(DisplayName = "None"),
	EnterVehicle	UMETA(DisplayName = "Enter Vehicle"),
	Door			UMETA(DisplayName = "Door / Interior"),
	NPC				UMETA(DisplayName = "Talk"),
	Shop			UMETA(DisplayName = "Shop"),
	Garage			UMETA(DisplayName = "Garage"),
	Safehouse		UMETA(DisplayName = "Safehouse (save)"),
	PayAndSpray		UMETA(DisplayName = "Respray"),
	MissionGiver	UMETA(DisplayName = "Mission"),
	Pickup			UMETA(DisplayName = "Pickup"),
	FuelPump		UMETA(DisplayName = "Fuel"),
	ATM				UMETA(DisplayName = "ATM"),
	VendingMachine	UMETA(DisplayName = "Vending Machine")
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnBCUFocusChanged, AActor*, NewFocus, EBCUInteractionKind, Kind);

/**
 * What the player is looking at, and what pressing E/F would do.
 *
 * Runs one sphere sweep + one line trace per frame (not per candidate), scores
 * the results, and publishes a single "focused" actor. The HUD prompt reads
 * that; nothing else in the game does its own proximity search.
 */
UCLASS(ClassGroup = (BCU), meta = (BlueprintSpawnableComponent))
class BLOCKCITYULTRA_API UBCUInteractionComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UBCUInteractionComponent();

	virtual void BeginPlay() override;

	/** Called from the controller tick. */
	void UpdateFocus(float DeltaSeconds);

	/** Activates the focused interaction (E/F press). */
	UFUNCTION(BlueprintCallable, Category = "BCU|Interaction")
	void ActivateFocused();

	UFUNCTION(BlueprintPure, Category = "BCU|Interaction")
	AActor* GetFocusedActor() const { return FocusedActor; }

	UFUNCTION(BlueprintPure, Category = "BCU|Interaction")
	EBCUInteractionKind GetFocusedKind() const { return FocusedKind; }

	UFUNCTION(BlueprintPure, Category = "BCU|Interaction")
	FText GetPromptText() const { return PromptText; }

	UFUNCTION(BlueprintPure, Category = "BCU|Interaction")
	bool HasFocus() const { return FocusedActor != nullptr; }

	UPROPERTY(BlueprintAssignable, Category = "BCU|Interaction")
	FOnBCUFocusChanged OnFocusChanged;

	/** Reach in cm for on-foot interaction. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Interaction", meta = (ClampMin = "50.0"))
	float InteractionRadius = 420.0f;

	/** Cone half-angle in degrees: things outside the view cone are ignored. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Interaction", meta = (ClampMin = "5.0", ClampMax = "90.0"))
	float ViewConeDegrees = 55.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Interaction")
	bool bRequireLineOfSight = true;

protected:
	UPROPERTY(Transient)
	TObjectPtr<AActor> FocusedActor;

	EBCUInteractionKind FocusedKind = EBCUInteractionKind::None;
	FText PromptText;
	float UpdateTimer = 0.0f;

	EBCUInteractionKind ClassifyActor(AActor* Actor) const;
	FText PromptForKind(EBCUInteractionKind Kind, AActor* Actor) const;
	float ScoreCandidate(AActor* Actor, const FVector& EyeLocation, const FVector& ViewDirection) const;
	void SetFocus(AActor* NewFocus, EBCUInteractionKind Kind);
};
