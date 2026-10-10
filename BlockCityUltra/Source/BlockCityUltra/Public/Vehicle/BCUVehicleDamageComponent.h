// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "BCUVehicleDamageComponent.generated.h"

class UNiagaraComponent;
class ABCUBaseVehicle;

UENUM(BlueprintType)
enum class EBCUDamageZone : uint8
{
	Front		UMETA(DisplayName = "Front"),
	Rear		UMETA(DisplayName = "Rear"),
	Left		UMETA(DisplayName = "Left Side"),
	Right		UMETA(DisplayName = "Right Side"),
	Roof		UMETA(DisplayName = "Roof"),
	Underside	UMETA(DisplayName = "Underside")
};

/**
 * Cosmetic-first destruction: voxel panels pop off the body, glass crazes,
 * lights break, smoke then fire then explosion. Nothing here changes the
 * collision hull, so a wrecked car still drives (badly) — which is the rule
 * that makes ramming a viable police tactic instead of an instant kill.
 */
UCLASS(ClassGroup = (BCU), meta = (BlueprintSpawnableComponent))
class BLOCKCITYULTRA_API UBCUVehicleDamageComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UBCUVehicleDamageComponent();

	virtual void BeginPlay() override;
	virtual void TickComponent(float DeltaTime, ELevelTick TickType,
		FActorComponentTickFunction* ThisTickFunction) override;

	void Initialise(float InMaxHealth);
	void Shutdown();

	/** Applies an impact at a world point with a surface normal. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|Damage")
	void ApplyImpact(float Damage, const FVector& WorldPoint, const FVector& WorldNormal, AActor* Causer);

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|Damage")
	float GetHealthFraction() const { return MaxHealth > 0.0f ? FMath::Clamp(Health / MaxHealth, 0.0f, 1.0f) : 0.0f; }

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|Damage")
	bool IsWrecked() const { return Health <= 0.0f; }

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|Damage")
	bool IsEngineDamaged() const { return EngineDamage > 0.5f; }

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|Damage")
	float GetPerformancePenalty() const;

	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|Damage")
	void Repair(float Amount);

	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|Damage")
	void RepairFully();

	/** Which panel group pops off at a given damage threshold. */
	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|Damage")
	EBCUDamageZone ClassifyZone(const FVector& LocalPoint) const;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Vehicle|Damage")
	float PanelPopThreshold = 0.72f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Vehicle|Damage")
	float SmokeThreshold = 0.45f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Vehicle|Damage")
	float FireThreshold = 0.18f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Vehicle|Damage")
	float ExplosionHealth = 0.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Damage")
	TArray<TSoftObjectPtr<UStaticMesh>> DetachablePanels;

protected:
	UPROPERTY(Transient) TObjectPtr<UNiagaraComponent> SmokeFX;
	UPROPERTY(Transient) TObjectPtr<UNiagaraComponent> FireFX;

	float Health = 1000.0f;
	float MaxHealth = 1000.0f;
	float EngineDamage = 0.0f;
	float SuspensionDamage = 0.0f;
	float BodyDeformation = 0.0f;
	float FireTimer = 0.0f;
	bool bExploded = false;

	void UpdateEffects();
	void PopPanels(EBCUDamageZone Zone, int32 Count);
	void Explode();
};
