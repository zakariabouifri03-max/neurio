// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Player/BCUHealthComponent.h"

UBCUHealthComponent::UBCUHealthComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
	PrimaryComponentTick.TickInterval = 0.1f;
	SetIsReplicatedByDefault(true);
}

void UBCUHealthComponent::BeginPlay()
{
	Super::BeginPlay();
	Health = MaxHealth;
}

void UBCUHealthComponent::TickComponent(float DeltaTime, ELevelTick TickType,
	FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	if (IsDowned()) { return; }

	TimeSinceDamage += DeltaTime;

	// Regen only up to the ceiling: full recovery requires a medic or a
	// safehouse, which gives those systems a reason to exist.
	if (TimeSinceDamage > RegenDelaySeconds && RegenPerSecond > 0.0f)
	{
		const float Ceiling = MaxHealth * RegenCeilingFraction;
		if (Health < Ceiling)
		{
			Health = FMath::Min(Ceiling, Health + RegenPerSecond * DeltaTime);
			OnHealthChanged.Broadcast(Health, MaxHealth);
		}
	}
}

void UBCUHealthComponent::SetMaxHealth(float NewMax)
{
	MaxHealth = FMath::Max(1.0f, NewMax);
	Health = FMath::Min(Health, MaxHealth);
}

void UBCUHealthComponent::ApplyDamage(float Amount, const FVector& Impulse)
{
	if (Amount <= 0.0f || IsDowned()) { return; }

	TimeSinceDamage = 0.0f;

	// Armour absorbs first, then bleeds through at 50%.
	float Remaining = Amount;
	if (Armour > 0.0f)
	{
		const float Absorbed = FMath::Min(Armour, Remaining * 0.65f);
		Armour -= Absorbed;
		Remaining -= Absorbed;
	}

	Health = FMath::Max(0.0f, Health - Remaining);
	OnDamaged.Broadcast(Remaining);
	OnHealthChanged.Broadcast(Health, MaxHealth);

	// Push the owner a little on heavy hits so impacts read physically.
	if (Impulse.SizeSquared() > KINDA_SMALL_NUMBER)
	{
		if (UPrimitiveComponent* Root = GetOwner()
				? Cast<UPrimitiveComponent>(GetOwner()->GetRootComponent()) : nullptr)
		{
			Root->AddImpulse(Impulse * Remaining * 0.6f, /*bVelChange=*/false);
		}
	}

	if (Health <= 0.0f)
	{
		OnHealthDepleted.Broadcast();
	}
}

void UBCUHealthComponent::Heal(float Amount)
{
	if (Amount <= 0.0f || IsDowned()) { return; }

	Health = FMath::Min(MaxHealth, Health + Amount);
	OnHealthChanged.Broadcast(Health, MaxHealth);
}

void UBCUHealthComponent::Revive()
{
	Health = MaxHealth;
	Armour = 0.0f;
	TimeSinceDamage = 0.0f;
	OnHealthChanged.Broadcast(Health, MaxHealth);
}
