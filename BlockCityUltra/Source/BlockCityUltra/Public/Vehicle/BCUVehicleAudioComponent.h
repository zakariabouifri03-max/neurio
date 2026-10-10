// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "Vehicle/BCUVehicleDefinition.h"
#include "BCUVehicleAudioComponent.generated.h"

class UAudioComponent;
class USoundBase;

UENUM(BlueprintType)
enum class EBCUVehicleUISound : uint8
{
	Enter			UMETA(DisplayName = "Enter"),
	Exit			UMETA(DisplayName = "Exit"),
	ExitRefused		UMETA(DisplayName = "Exit Refused"),
	Ignition		UMETA(DisplayName = "Ignition"),
	Handbrake		UMETA(DisplayName = "Handbrake"),
	GearShift		UMETA(DisplayName = "Gear Shift"),
	Boost			UMETA(DisplayName = "Boost"),
	Alarm			UMETA(DisplayName = "Alarm"),
	ImpactLight		UMETA(DisplayName = "Light Impact"),
	ImpactHeavy		UMETA(DisplayName = "Heavy Impact")
};

/**
 * Engine, tyre, wind, siren and UI audio for one vehicle.
 *
 * The engine is a layered loop (idle + load) whose pitch tracks RPM and whose
 * crossfade tracks throttle, which is what makes a voxel car sound like a real
 * engine rather than a sample being replayed.
 */
UCLASS(ClassGroup = (BCU), meta = (BlueprintSpawnableComponent))
class BLOCKCITYULTRA_API UBCUVehicleAudioComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UBCUVehicleAudioComponent();

	virtual void BeginPlay() override;
	virtual void TickComponent(float DeltaTime, ELevelTick TickType,
		FActorComponentTickFunction* ThisTickFunction) override;

	void Initialise(UBCUVehicleDefinition* InDefinition);
	void Shutdown();

	/** Called every frame by the vehicle with live telemetry. */
	void UpdateEngine(float RPM, float Throttle, float SpeedKmh, bool bDrifting);

	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|Audio")
	void PlayHorn();

	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|Audio")
	void SetSirenActive(bool bActive);

	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|Audio")
	void PlayUISound(EBCUVehicleUISound Sound);

	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|Audio")
	void PlayTyreSkid(float Intensity);

	UFUNCTION(BlueprintCallable, Category = "BCU|Vehicle|Audio")
	void PlayImpact(float Severity);

	/** Distance-based ducking so 120 traffic cars do not deafen the player. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Vehicle|Audio")
	float MaxAudibleDistanceCm = 90000.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Vehicle|Audio", meta = (ClampMin = "0.0", ClampMax = "2.0"))
	float MasterVolumeScale = 1.0f;

protected:
	UPROPERTY(Transient) TObjectPtr<UAudioComponent> IdleAudio;
	UPROPERTY(Transient) TObjectPtr<UAudioComponent> LoadAudio;
	UPROPERTY(Transient) TObjectPtr<UAudioComponent> TyreAudio;
	UPROPERTY(Transient) TObjectPtr<UAudioComponent> WindAudio;
	UPROPERTY(Transient) TObjectPtr<UAudioComponent> SirenAudio;
	UPROPERTY(Transient) TObjectPtr<UBCUVehicleDefinition> Definition;

	float SmoothedRPM = 0.0f;
	float SmoothedThrottle = 0.0f;
	float SkidIntensity = 0.0f;
	float HornCooldown = 0.0f;

	UAudioComponent* SpawnLoop(USoundBase* Sound, float Volume);
};
