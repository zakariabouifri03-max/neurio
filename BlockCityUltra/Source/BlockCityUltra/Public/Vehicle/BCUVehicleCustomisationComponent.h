// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "BCUVehicleCustomisationComponent.generated.h"

class ABCUBaseVehicle;
class UBCUVehicleDefinition;
class UMaterialInstanceDynamic;

/** Paint finish — changes the clearcoat/flake response of the paint material. */
UENUM(BlueprintType)
enum class EBCUPaintFinish : uint8
{
	Gloss		UMETA(DisplayName = "Gloss"),
	Matte		UMETA(DisplayName = "Matte"),
	Metallic	UMETA(DisplayName = "Metallic"),
	Pearl		UMETA(DisplayName = "Pearlescent"),
	Chrome		UMETA(DisplayName = "Chrome"),
	Candy		UMETA(DisplayName = "Candy"),
	Rust		UMETA(DisplayName = "Rust Bucket"),
	Custom		UMETA(DisplayName = "Custom Livery")
};

/**
 * Live customisation: paint, finish, wheels, decals, body kits, neon underglow
 * and the three performance upgrade tracks. All of it is material parameters +
 * instanced voxel panels, so changing a car costs no mesh rebuild.
 */
UCLASS(ClassGroup = (BCU), meta = (BlueprintSpawnableComponent))
class BLOCKCITYULTRA_API UBCUVehicleCustomisationComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UBCUVehicleCustomisationComponent();

	virtual void BeginPlay() override;

	void Initialise(ABCUBaseVehicle* InVehicle);

	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|Customisation")
	void ApplyPaint(const FLinearColor& Color);

	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|Customisation")
	void ApplyFinish(EBCUPaintFinish Finish);

	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|Customisation")
	void ApplyWheelStyle(FName StyleId);

	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|Customisation")
	void ApplyDecal(FName DecalId);

	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|Customisation")
	void ApplyBodyKit(FName KitId);

	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|Customisation")
	void SetUnderglow(bool bEnabled, const FLinearColor& Color);

	/** 0..5 each. Recomputes torque, grip and brake curves. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|Customisation")
	void ApplyUpgradeLevels(int32 EngineLevel, int32 HandlingLevel, int32 BrakeLevel);

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|Customisation")
	float GetEngineMultiplier() const;

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|Customisation")
	float GetHandlingMultiplier() const;

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|Customisation")
	float GetBrakeMultiplier() const;

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|Customisation")
	const FLinearColor& GetPaintColor() const { return PaintColor; }

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|Customisation")
	EBCUPaintFinish GetFinish() const { return Finish; }

protected:
	UPROPERTY(Transient) TObjectPtr<ABCUBaseVehicle> Vehicle;
	UPROPERTY(Transient) TObjectPtr<UMaterialInstanceDynamic> PaintMID;
	UPROPERTY(Transient) TObjectPtr<UMaterialInstanceDynamic> TrimMID;

	FLinearColor PaintColor = FLinearColor(0.72f, 0.09f, 0.11f);
	EBCUPaintFinish Finish = EBCUPaintFinish::Gloss;
	FName WheelStyleId = TEXT("Stock");
	FName DecalId = NAME_None;
	FName BodyKitId = NAME_None;
	bool bUnderglowOn = false;
	FLinearColor UnderglowColor = FLinearColor(0.1f, 0.6f, 1.0f);
	int32 EngineLevel = 0;
	int32 HandlingLevel = 0;
	int32 BrakeLevel = 0;

	void EnsurePaintMID();
};
