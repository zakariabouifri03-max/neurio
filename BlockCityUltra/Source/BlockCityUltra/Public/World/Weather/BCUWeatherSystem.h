// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "BCUWeatherSystem.generated.h"

class UNiagaraComponent;
class UNiagaraSystem;
class UAudioComponent;
class USoundBase;
class UBCUTimeOfDaySystem;
class UMaterialParameterCollection;
class UPostProcessComponent;

UENUM(BlueprintType)
enum class EBCUWeather : uint8
{
	Clear			UMETA(DisplayName = "Clear"),
	PartlyCloudy	UMETA(DisplayName = "Partly Cloudy"),
	Overcast		UMETA(DisplayName = "Overcast"),
	LightRain		UMETA(DisplayName = "Light Rain"),
	HeavyRain		UMETA(DisplayName = "Heavy Rain"),
	Thunderstorm	UMETA(DisplayName = "Thunderstorm"),
	Fog				UMETA(DisplayName = "Dense Fog"),
	Wind			UMETA(DisplayName = "High Wind"),
	Heatwave		UMETA(DisplayName = "Heatwave"),
	Snow			UMETA(DisplayName = "Snow")
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnBCUWeatherChanged, EBCUWeather, NewWeather, EBCUWeather, OldWeather);

/**
 * Weather + surface wetness.
 *
 * The wetness value is the single most important output: it drives road
 * reflectivity, puddle decals, tyre spray, the specular response of every voxel
 * material, and how far pedestrians will walk to find cover. It is published to
 * a Material Parameter Collection so all materials read one scalar instead of
 * each running their own simulation.
 */
UCLASS(config = Game, Blueprintable)
class BLOCKCITYULTRA_API UBCUWeatherSystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override;

	// ── State ───────────────────────────────────────────────────────────────
	UFUNCTION(BlueprintPure, Category = "BCU|Weather")
	EBCUWeather GetWeather() const { return CurrentWeather; }

	/** 0..1 — how hard it is raining/snowing right now. */
	UFUNCTION(BlueprintPure, Category = "BCU|Weather")
	float GetIntensity() const { return Intensity; }

	/** 0..1 — how wet every surface is. Decays slowly after rain stops. */
	UFUNCTION(BlueprintPure, Category = "BCU|Weather")
	float GetSurfaceWetness() const { return SurfaceWetness; }

	/** 0..1 — cloud cover. Feeds the sky light and the volumetric cloud. */
	UFUNCTION(BlueprintPure, Category = "BCU|Weather")
	float GetCloudCover() const { return CloudCover; }

	UFUNCTION(BlueprintPure, Category = "BCU|Weather")
	float GetWindSpeedKmh() const { return WindSpeedKmh; }

	UFUNCTION(BlueprintPure, Category = "BCU|Weather")
	FVector2D GetWindDirection2D() const { return WindDirection; }

	UFUNCTION(BlueprintPure, Category = "BCU|Weather")
	float GetFogDensity() const { return FogDensity; }

	/** True for ~0.25 s after each lightning strike. */
	UFUNCTION(BlueprintPure, Category = "BCU|Weather")
	bool IsLightningFlashing() const { return LightningFlashRemaining > 0.0f; }

	// ── Control ─────────────────────────────────────────────────────────────
	UFUNCTION(BlueprintCallable, Category = "BCU|Weather")
	void SetWeather(EBCUWeather NewWeather, float TransitionSeconds = 25.0f);

	/** Forces an immediate storm — used by missions and by `bcu.weather` cheat. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Weather")
	void TriggerStorm(bool bInstant = false);

	UFUNCTION(BlueprintCallable, Category = "BCU|Weather")
	void SetAutoWeather(bool bEnabled) { bAutoWeather = bEnabled; }

	/** Sets wetness directly (puddle persistence after a scripted rain). */
	UFUNCTION(BlueprintCallable, Category = "BCU|Weather")
	void SetSurfaceWetness(float Value);

	/** Called by ABCUGameState on replication. */
	void SetIntensityFromNetwork(float NewIntensity);

	UPROPERTY(BlueprintAssignable, Category = "BCU|Weather")
	FOnBCUWeatherChanged OnWeatherChanged;

	// ── Tuning ──────────────────────────────────────────────────────────────
	UPROPERTY(EditAnywhere, config, Category = "BCU|Weather")
	EBCUWeather DefaultWeather = EBCUWeather::Clear;

	UPROPERTY(EditAnywhere, config, Category = "BCU|Weather", meta = (ClampMin = "1.0"))
	float WeatherChangeMinMinutes = 6.0f;

	UPROPERTY(EditAnywhere, config, Category = "BCU|Weather", meta = (ClampMin = "2.0"))
	float WeatherChangeMaxMinutes = 18.0f;

	UPROPERTY(EditAnywhere, config, Category = "BCU|Weather", meta = (ClampMin = "0.0"))
	float WetnessDryRatePerMinute = 0.12f;

	UPROPERTY(EditAnywhere, config, Category = "BCU|Weather", meta = (ClampMin = "0.0"))
	float RainWetnessPerMinute = 0.55f;

	UPROPERTY(EditAnywhere, config, Category = "BCU|Weather", meta = (ClampMin = "0.0"))
	float LightningIntervalSeconds = 9.0f;

	// ── Assets ──────────────────────────────────────────────────────────────
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Weather|Assets")
	TSoftObjectPtr<UNiagaraSystem> RainEffect;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Weather|Assets")
	TSoftObjectPtr<UNiagaraSystem> SnowEffect;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Weather|Assets")
	TSoftObjectPtr<UNiagaraSystem> SplashEffect;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Weather|Assets")
	TSoftObjectPtr<UNiagaraSystem> LightningEffect;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Weather|Assets")
	TSoftObjectPtr<USoundBase> RainLoopSound;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Weather|Assets")
	TSoftObjectPtr<USoundBase> ThunderSound;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Weather|Assets")
	TSoftObjectPtr<USoundBase> WindLoopSound;

	/** MPC_Weather: Wetness, RainIntensity, CloudCover, FogDensity, Lightning. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Weather|Assets")
	TSoftObjectPtr<UMaterialParameterCollection> WeatherParameters;

	/** Puddle decal material instanced across the road network. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Weather|Assets")
	TSoftObjectPtr<UMaterialInterface> PuddleDecalMaterial;

	/** Post process used for the rain-on-lens and wet-screen look. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Weather|Assets")
	TSoftObjectPtr<class UMaterialInterface> ScreenRainMaterial;

protected:
	EBCUWeather CurrentWeather = EBCUWeather::Clear;
	EBCUWeather TargetWeather = EBCUWeather::Clear;
	float Intensity = 0.0f;
	float TargetIntensity = 0.0f;
	float SurfaceWetness = 0.0f;
	float CloudCover = 0.1f;
	float TargetCloudCover = 0.1f;
	float WindSpeedKmh = 8.0f;
	FVector2D WindDirection = FVector2D(1.0f, 0.0f);
	float FogDensity = 0.0f;
	float TransitionRemaining = 0.0f;
	float TransitionDuration = 1.0f;
	float TimeUntilNextChange = 600.0f;
	float LightningTimer = 0.0f;
	float LightningFlashRemaining = 0.0f;
	bool bAutoWeather = true;

	UPROPERTY(Transient)
	TObjectPtr<UNiagaraComponent> RainComponent;

	UPROPERTY(Transient)
	TObjectPtr<UNiagaraComponent> SnowComponent;

	UPROPERTY(Transient)
	TObjectPtr<UNiagaraComponent> LightningComponent;

	UPROPERTY(Transient)
	TObjectPtr<UAudioComponent> RainAudio;

	UPROPERTY(Transient)
	TObjectPtr<UAudioComponent> WindAudio;

	UPROPERTY(Transient)
	TObjectPtr<UMaterialParameterCollection> ResolvedWeatherParameters;

	void CreateComponents();
	void UpdateWeatherSelection(float DeltaTime);
	void UpdateTransition(float DeltaTime);
	void UpdateWetness(float DeltaTime);
	void UpdateLightning(float DeltaTime);
	void UpdateComponents();
	void PublishToMaterialParameters();
	void ApplyToSkyAndFog();
	static float IntensityForWeather(EBCUWeather Weather, int32 Seed);
	static float CloudCoverForWeather(EBCUWeather Weather);
};
