// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/WorldSubsystem.h"
#include "BCUTimeOfDaySystem.generated.h"

class ADirectionalLight;
class ASkyLight;
class AExponentialHeightFog;
class ASkyAtmosphere;
class AVolumetricCloud;
class UDirectionalLightComponent;
class USkyLightComponent;
class USkyAtmosphereComponent;
class UCurveFloat;
class UCurveLinearColor;
struct FBCUCellCoord;

DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnBCUHourChanged, int32, NewHour);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnBCUDaylightChanged, float, DaylightFactor);

/**
 * Drives the sun, sky atmosphere, sky light, volumetric fog, exposure and every
 * "night" behaviour in the game (streetlights, lit windows, headlight auto-on,
 * police spotlight searches, nightlife pedestrian density).
 *
 * The system is a WorldSubsystem so it exists before any actor ticks and so
 * both the player and every AI system read the *same* clock.
 *
 * Lighting is authored as curves in the editor (CR_SunIntensity,
 * CLC_SunColor, CLC_SkyColor, CLC_HorizonColor, CR_FogDensity) so the sunrise
 * and sunset can be art-directed rather than derived. Where a curve is missing
 * the system falls back to a physically motivated approximation, so the project
 * runs with zero assets in place.
 */
UCLASS(config = Game, Blueprintable)
class BLOCKCITYULTRA_API UBCUTimeOfDaySystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()

public:
	//~ USubsystem / FTickableGameObject
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override;
	virtual bool IsTickableInEditor() const override { return true; }
	//~ End

	// ── Time control ────────────────────────────────────────────────────────
	/** 0..1 fraction of a day (0 = midnight). */
	UFUNCTION(BlueprintCallable, Category = "BCU|Time")
	void SetTimeOfDay(float NewTimeOfDay);

	UFUNCTION(BlueprintPure, Category = "BCU|Time")
	float GetTimeOfDay() const { return TimeOfDay; }

	/** Hours 0..23.999 — convenient for missions ("meet me at 22:00"). */
	UFUNCTION(BlueprintCallable, Category = "BCU|Time")
	void SetHour(float Hour);

	UFUNCTION(BlueprintPure, Category = "BCU|Time")
	float GetHour() const { return TimeOfDay * 24.0f; }

	UFUNCTION(BlueprintPure, Category = "BCU|Time")
	int32 GetHourInt() const { return FMath::FloorToInt(GetHour()); }

	UFUNCTION(BlueprintPure, Category = "BCU|Time")
	FString GetClockString() const;

	/** Advances the clock without changing the day length. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Time")
	void AdvanceTime(float Hours);

	/** Freezes the clock for a mission, a cutscene or a photograph. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Time")
	void SetAutoAdvance(bool bEnabled);

	UFUNCTION(BlueprintPure, Category = "BCU|Time")
	bool IsAutoAdvancing() const { return bAutoAdvance; }

	/** Length of one in-game day in real minutes. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, config, Category = "BCU|Time", meta = (ClampMin = "1.0"))
	float DayLengthMinutes = 24.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, config, Category = "BCU|Time", meta = (ClampMin = "0.0", ClampMax = "24.0"))
	float StartHour = 8.5f;

	/** Real-world latitude/longitude drive the sun's elevation + azimuth so
	 *  sunrise is not always due east at the same angle. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, config, Category = "BCU|Time")
	float Latitude = 41.5f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, config, Category = "BCU|Time")
	float Longitude = -87.9f;

	/** Days since the epoch of the save (drives season + moon phase). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Time")
	int32 DayNumber = 1;

	// ── Derived lighting state (read by weather, AI, materials) ─────────────
	/** 0 = full night, 1 = full day. Drives streetlights and lit windows. */
	UFUNCTION(BlueprintPure, Category = "BCU|Time|Lighting")
	float GetDaylightFactor() const;

	UFUNCTION(BlueprintPure, Category = "BCU|Time|Lighting")
	bool IsNight() const { return GetDaylightFactor() < 0.28f; }

	UFUNCTION(BlueprintPure, Category = "BCU|Time|Lighting")
	bool IsGoldenHour() const;

	UFUNCTION(BlueprintPure, Category = "BCU|Time|Lighting")
	FVector GetSunDirection() const;

	UFUNCTION(BlueprintPure, Category = "BCU|Time|Lighting")
	float GetSunElevationDegrees() const;

	UFUNCTION(BlueprintPure, Category = "BCU|Time|Lighting")
	FLinearColor GetSunColor() const;

	UFUNCTION(BlueprintPure, Category = "BCU|Time|Lighting")
	FLinearColor GetSkyColor() const;

	UFUNCTION(BlueprintPure, Category = "BCU|Time|Lighting")
	float GetSunIntensityLux() const;

	/** Night lighting intensity multiplier for the city's emissive materials. */
	UFUNCTION(BlueprintPure, Category = "BCU|Time|Lighting")
	float GetNightLightingIntensity() const;

	// ── Actor bindings (set by BP_BCUTimeOfDay or auto-found) ───────────────
	UFUNCTION(BlueprintCallable, Category = "BCU|Time|Binding")
	void BindSkyActors(ADirectionalLight* Sun, ASkyLight* Sky, AExponentialHeightFog* Fog,
		ASkyAtmosphere* Atmosphere, AVolumetricCloud* Clouds);

	/** Finds the sky actors in the current level automatically. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Time|Binding")
	void AutoBindSkyActors();

	// ── Curves (optional; sensible fallbacks when unset) ────────────────────
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Time|Curves")
	TObjectPtr<UCurveFloat> SunIntensityCurve;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Time|Curves")
	TObjectPtr<UCurveLinearColor> SunColorCurve;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Time|Curves")
	TObjectPtr<UCurveLinearColor> SkyColorCurve;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Time|Curves")
	TObjectPtr<UCurveLinearColor> HorizonColorCurve;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Time|Curves")
	TObjectPtr<UCurveFloat> FogDensityCurve;

	UPROPERTY(BlueprintAssignable, Category = "BCU|Time")
	FOnBCUHourChanged OnHourChanged;

	UPROPERTY(BlueprintAssignable, Category = "BCU|Time")
	FOnBCUDaylightChanged OnDaylightChanged;

	/** Called by ABCUGameState when the authoritative clock replicates. */
	void SetTimeOfDayFromNetwork(float NewTimeOfDay);

protected:
	UPROPERTY(Transient)
	TObjectPtr<ADirectionalLight> SunLight;

	UPROPERTY(Transient)
	TObjectPtr<ASkyLight> SkyLight;

	UPROPERTY(Transient)
	TObjectPtr<AExponentialHeightFog> HeightFog;

	UPROPERTY(Transient)
	TObjectPtr<ASkyAtmosphere> Atmosphere;

	UPROPERTY(Transient)
	TObjectPtr<AVolumetricCloud> Clouds;

	float TimeOfDay = 8.5f / 24.0f;
	bool bAutoAdvance = true;
	bool bNetworkDriven = false;
	int32 LastBroadcastHour = -1;
	float LastBroadcastDaylight = -1.0f;

	void ApplySun();
	void ApplySkyLight();
	void ApplyFog();
	void ApplyAtmosphere();
	void ComputeSunAngles(float& OutElevationDeg, float& OutAzimuthDeg) const;
};
