// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "BCUHealthComponent.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE(FOnBCUHealthDepleted);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnBCUHealthChanged, float, NewHealth, float, MaxHealth);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnBCUDamaged, float, Amount);

/**
 * Health, armour and regen. Shared by the player, pedestrians and police so
 * every "can this die?" question has one answer.
 */
UCLASS(ClassGroup = (BCU), meta = (BlueprintSpawnableComponent))
class BLOCKCITYULTRA_API UBCUHealthComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UBCUHealthComponent();

	virtual void BeginPlay() override;
	virtual void TickComponent(float DeltaTime, ELevelTick TickType,
		FActorComponentTickFunction* ThisTickFunction) override;

	UFUNCTION(BlueprintCallable, Category = "BCU|Health")
	void SetMaxHealth(float NewMax);

	UFUNCTION(BlueprintCallable, Category = "BCU|Health")
	void ApplyDamage(float Amount, const FVector& Impulse = FVector::ZeroVector);

	UFUNCTION(BlueprintCallable, Category = "BCU|Health")
	void Heal(float Amount);

	UFUNCTION(BlueprintCallable, Category = "BCU|Health")
	void Revive();

	UFUNCTION(BlueprintPure, Category = "BCU|Health")
	float GetHealth() const { return Health; }

	UFUNCTION(BlueprintPure, Category = "BCU|Health")
	float GetMaxHealth() const { return MaxHealth; }

	UFUNCTION(BlueprintPure, Category = "BCU|Health")
	float GetHealthFraction() const { return MaxHealth > 0.0f ? FMath::Clamp(Health / MaxHealth, 0.0f, 1.0f) : 0.0f; }

	UFUNCTION(BlueprintPure, Category = "BCU|Health")
	bool IsDowned() const { return Health <= 0.0f; }

	UFUNCTION(BlueprintPure, Category = "BCU|Health")
	float GetArmour() const { return Armour; }

	UFUNCTION(BlueprintCallable, Category = "BCU|Health")
	void SetArmour(float Value) { Armour = FMath::Clamp(Value, 0.0f, MaxArmour); }

	/** Regeneration starts after this many seconds without damage. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Health", meta = (ClampMin = "0.0"))
	float RegenDelaySeconds = 8.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Health", meta = (ClampMin = "0.0"))
	float RegenPerSecond = 3.5f;

	/** Fraction of health regen restores to (0.4 = never above 40% without a medic). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Health", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float RegenCeilingFraction = 0.4f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Health")
	float MaxArmour = 100.0f;

	UPROPERTY(BlueprintAssignable, Category = "BCU|Health")
	FOnBCUHealthDepleted OnHealthDepleted;

	UPROPERTY(BlueprintAssignable, Category = "BCU|Health")
	FOnBCUHealthChanged OnHealthChanged;

	UPROPERTY(BlueprintAssignable, Category = "BCU|Health")
	FOnBCUDamaged OnDamaged;

protected:
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Health")
	float MaxHealth = 100.0f;

	UPROPERTY(BlueprintReadOnly, Transient, Category = "BCU|Health")
	float Health = 100.0f;

	UPROPERTY(BlueprintReadOnly, Transient, Category = "BCU|Health")
	float Armour = 0.0f;

	float TimeSinceDamage = 0.0f;
};
