// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Vehicle/BCUVehicleDamageComponent.h"

#include "Vehicle/BCUBaseVehicle.h"
#include "World/City/BCUCityStreamer.h"
#include "NiagaraComponent.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"
#include "NiagaraFunctionLibrary.h"
#include "NiagaraSystem.h"

UBCUVehicleDamageComponent::UBCUVehicleDamageComponent()
{
	PrimaryComponentTick.bCanEverTick = true;
	PrimaryComponentTick.TickInterval = 0.1f; // damage visuals do not need 60 Hz
}

void UBCUVehicleDamageComponent::BeginPlay() { Super::BeginPlay(); }

void UBCUVehicleDamageComponent::Initialise(float InMaxHealth)
{
	MaxHealth = FMath::Max(1.0f, InMaxHealth);
	Health = MaxHealth;
	EngineDamage = 0.0f;
	SuspensionDamage = 0.0f;
	BodyDeformation = 0.0f;
	bExploded = false;
	FireTimer = 0.0f;
}

void UBCUVehicleDamageComponent::Shutdown()
{
	if (SmokeFX) { SmokeFX->Deactivate(); }
	if (FireFX) { FireFX->Deactivate(); }
}

EBCUDamageZone UBCUVehicleDamageComponent::ClassifyZone(const FVector& LocalPoint) const
{
	const float Ax = FMath::Abs(LocalPoint.X);
	const float Ay = FMath::Abs(LocalPoint.Y);

	if (LocalPoint.Z > 60.0f && Ax < Ay * 0.6f) { return EBCUDamageZone::Roof; }
	if (LocalPoint.Z < -20.0f) { return EBCUDamageZone::Underside; }
	if (Ax > Ay) { return LocalPoint.X > 0.0f ? EBCUDamageZone::Front : EBCUDamageZone::Rear; }
	return LocalPoint.Y > 0.0f ? EBCUDamageZone::Right : EBCUDamageZone::Left;
}

void UBCUVehicleDamageComponent::ApplyImpact(float Damage, const FVector& WorldPoint,
	const FVector& WorldNormal, AActor* Causer)
{
	if (Damage <= 0.0f || IsWrecked()) { return; }

	Health = FMath::Max(0.0f, Health - Damage);

	const ABCUBaseVehicle* Vehicle = Cast<ABCUBaseVehicle>(GetOwner());
	const FVector LocalPoint = Vehicle
		? Vehicle->GetActorTransform().InverseTransformPosition(WorldPoint)
		: WorldPoint;
	const EBCUDamageZone Zone = ClassifyZone(LocalPoint);

	// Zone-weighted consequences: a front hit damages the engine, a side hit
	// damages nothing critical, an underside hit damages the suspension.
	switch (Zone)
	{
	case EBCUDamageZone::Front:
	case EBCUDamageZone::Rear:
		EngineDamage = FMath::Min(1.0f, EngineDamage + Damage / (MaxHealth * 0.9f));
		break;
	case EBCUDamageZone::Underside:
		SuspensionDamage = FMath::Min(1.0f, SuspensionDamage + Damage / (MaxHealth * 0.7f));
		break;
	default:
		break;
	}

	BodyDeformation = FMath::Min(1.0f, BodyDeformation + Damage / MaxHealth);

	// Cosmetic-first destruction: pop voxel panels off the body instead of
	// deforming the collision hull, so a wrecked car still drives.
	if (GetHealthFraction() < PanelPopThreshold)
	{
		PopPanels(Zone, FMath::Clamp(FMath::RoundToInt(Damage / 60.0f), 1, 12));
	}

	if (Health <= ExplosionHealth && !bExploded)
	{
		Explode();
	}

	UpdateEffects();
	(void)WorldNormal; (void)Causer;
}

void UBCUVehicleDamageComponent::PopPanels(EBCUDamageZone Zone, int32 Count)
{
	ABCUCityStreamer* Streamer = nullptr;
	for (TActorIterator<ABCUCityStreamer> It(GetWorld()); It; ++It) { Streamer = *It; break; }
	if (!Streamer) { return; }

	const AActor* Owner = GetOwner();
	if (!Owner) { return; }

	// Remove a small sphere of voxels on the hit side. Destructible voxels only,
	// so a car cannot chew a hole through a skyscraper's structure.
	FVector Offset = FVector::ZeroVector;
	switch (Zone)
	{
	case EBCUDamageZone::Front:		Offset = Owner->GetActorForwardVector() * 180.0f; break;
	case EBCUDamageZone::Rear:		Offset = -Owner->GetActorForwardVector() * 180.0f; break;
	case EBCUDamageZone::Left:		Offset = -Owner->GetActorRightVector() * 110.0f; break;
	case EBCUDamageZone::Right:		Offset = Owner->GetActorRightVector() * 110.0f; break;
	case EBCUDamageZone::Roof:		Offset = FVector(0.0f, 0.0f, 120.0f); break;
	case EBCUDamageZone::Underside:	Offset = FVector(0.0f, 0.0f, -80.0f); break;
	default: break;
	}

	Streamer->DestroyVoxelsInRadius(Owner->GetActorLocation() + Offset,
		float(Count) * 12.0f, /*bOnlyDestructible=*/false);
}

void UBCUVehicleDamageComponent::UpdateEffects()
{
	const float Fraction = GetHealthFraction();
	AActor* Owner = GetOwner();
	if (!Owner) { return; }

	if (Fraction < SmokeThreshold && !SmokeFX)
	{
		SmokeFX = UNiagaraFunctionLibrary::SpawnSystemAttached(
			LoadObject<UNiagaraSystem>(nullptr, TEXT("/Game/VFX/NS_VehicleSmoke.NS_VehicleSmoke")),
			Owner->GetRootComponent(), NAME_None, FVector(90.0f, 0.0f, 60.0f),
			FRotator::ZeroRotator, EAttachLocation::KeepRelativeOffset, false);
	}
	else if (Fraction >= SmokeThreshold && SmokeFX)
	{
		SmokeFX->Deactivate();
	}

	if (Fraction < FireThreshold && !FireFX)
	{
		FireFX = UNiagaraFunctionLibrary::SpawnSystemAttached(
			LoadObject<UNiagaraSystem>(nullptr, TEXT("/Game/VFX/NS_VehicleFire.NS_VehicleFire")),
			Owner->GetRootComponent(), NAME_None, FVector(90.0f, 0.0f, 50.0f),
			FRotator::ZeroRotator, EAttachLocation::KeepRelativeOffset, false);
	}
	else if (Fraction >= FireThreshold && FireFX)
	{
		FireFX->Deactivate();
	}
}

void UBCUVehicleDamageComponent::Explode()
{
	if (bExploded) { return; }
	bExploded = true;

	AActor* Owner = GetOwner();
	if (!Owner) { return; }

	// Radial damage to anything nearby (including the player), plus the voxel
	// crater that makes an explosion leave a permanent mark on the city.
	UGameplayStatics::ApplyRadialDamageWithFalloff(
		GetWorld(), 220.0f, 40.0f, Owner->GetActorLocation(),
		200.0f, 900.0f, 0.55f, nullptr, TArray<AActor*>{ Owner }, Owner);

	for (TActorIterator<ABCUCityStreamer> It(GetWorld()); It; ++It)
	{
		(*It)->DestroyVoxelsInRadius(Owner->GetActorLocation() + FVector(0.0f, 0.0f, -60.0f), 220.0f);
		break;
	}

	if (SmokeFX) { SmokeFX->Deactivate(); }
	if (FireFX) { FireFX->Deactivate(); }

	FireTimer = 12.0f; // burn for a while, then go dark
}

void UBCUVehicleDamageComponent::TickComponent(float DeltaTime, ELevelTick TickType,
	FActorComponentTickFunction* ThisTickFunction)
{
	Super::TickComponent(DeltaTime, TickType, ThisTickFunction);

	if (FireTimer > 0.0f)
	{
		FireTimer -= DeltaTime;
		if (FireTimer <= 0.0f && FireFX)
		{
			FireFX->Deactivate();
		}
	}
}

float UBCUVehicleDamageComponent::GetPerformancePenalty() const
{
	// Engine damage costs power; suspension damage costs grip. Both are
	// multiplicative on the vehicle's definition values.
	return FMath::Clamp(1.0f - (EngineDamage * 0.55f + SuspensionDamage * 0.30f), 0.25f, 1.0f);
}

void UBCUVehicleDamageComponent::Repair(float Amount)
{
	if (Amount <= 0.0f) { return; }

	Health = FMath::Min(MaxHealth, Health + Amount);

	const float RepairedFraction = Amount / MaxHealth;
	EngineDamage = FMath::Max(0.0f, EngineDamage - RepairedFraction);
	SuspensionDamage = FMath::Max(0.0f, SuspensionDamage - RepairedFraction);
	BodyDeformation = FMath::Max(0.0f, BodyDeformation - RepairedFraction);

	UpdateEffects();
}

void UBCUVehicleDamageComponent::RepairFully()
{
	Repair(MaxHealth);
	bExploded = false;
	FireTimer = 0.0f;
	UpdateEffects();
}
