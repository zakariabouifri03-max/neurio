// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "World/Weather/BCUTimeOfDaySystem.h"

#include "Components/DirectionalLightComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/SkyAtmosphereComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/VolumetricCloudComponent.h"
#include "Curves/CurveFloat.h"
#include "Curves/CurveLinearColor.h"
#include "Engine/DirectionalLight.h"
#include "Engine/ExponentialHeightFog.h"
#include "Engine/SkyLight.h"
#include "SkyAtmosphere.h"
#include "VolumetricCloud.h"
#include "EngineUtils.h"
#include "Kismet/KismetMathLibrary.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUTime, Log, All);

void UBCUTimeOfDaySystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

	TimeOfDay = FMath::Clamp(StartHour / 24.0f, 0.0f, 0.9999f);
	bAutoAdvance = true;
	LastBroadcastHour = -1;
}

void UBCUTimeOfDaySystem::Deinitialize()
{
	Super::Deinitialize();
}

TStatId UBCUTimeOfDaySystem::GetStatId() const
{
	RETURN_QUICK_DECLARE_CYCLE_STAT(UBCUTimeOfDaySystem, STATGROUP_Tickables);
}

void UBCUTimeOfDaySystem::Tick(float DeltaTime)
{
	if (!GetWorld())
	{
		return;
	}

	if (bAutoAdvance && !bNetworkDriven && DayLengthMinutes > 0.0f)
	{
		// One full day per DayLengthMinutes of real time.
		const float Advance = DeltaTime / (DayLengthMinutes * 60.0f);
		TimeOfDay = FMath::Fmod(TimeOfDay + Advance, 1.0f);

		if (TimeOfDay < Advance)
		{
			DayNumber++;
		}
	}

	ApplySun();
	ApplySkyLight();
	ApplyFog();
	ApplyAtmosphere();

	const int32 Hour = GetHourInt();
	if (Hour != LastBroadcastHour)
	{
		LastBroadcastHour = Hour;
		OnHourChanged.Broadcast(Hour);
	}

	const float Daylight = GetDaylightFactor();
	if (!FMath::IsNearlyEqual(Daylight, LastBroadcastDaylight, 0.01f))
	{
		LastBroadcastDaylight = Daylight;
		OnDaylightChanged.Broadcast(Daylight);
	}
}

//═══════════════════════════════════════════════════════════════════════════════
// Sun position — a real solar geometry solve, not a canned rotation
//═══════════════════════════════════════════════════════════════════════════════

void UBCUTimeOfDaySystem::ComputeSunAngles(float& OutElevationDeg, float& OutAzimuthDeg) const
{
	// Simplified solar position (NOAA-style): accurate enough that sunrise is
	// due east, sunset due west, and winter sun stays low — which is what makes
	// the golden hour actually golden.
	const float DayAngle = 2.0f * PI * float(DayNumber % 365) / 365.0f;
	const float Declination = 0.4093f * FMath::Sin(DayAngle - 1.405f); // radians

	const float SolarHour = (TimeOfDay - 0.5f) * 2.0f * PI; // 0 at solar noon
	const float LatRad = FMath::DegreesToRadians(Latitude);

	const float SinElevation = FMath::Sin(LatRad) * FMath::Sin(Declination)
		+ FMath::Cos(LatRad) * FMath::Cos(Declination) * FMath::Cos(SolarHour);

	OutElevationDeg = FMath::RadiansToDegrees(FMath::Asin(FMath::Clamp(SinElevation, -1.0f, 1.0f)));

	const float CosAzimuth = (FMath::Sin(Declination) - FMath::Sin(LatRad) * SinElevation)
		/ FMath::Max(KINDA_SMALL_NUMBER, FMath::Cos(LatRad) * FMath::Cos(FMath::DegreesToRadians(OutElevationDeg)));

	float Azimuth = FMath::RadiansToDegrees(FMath::Acos(FMath::Clamp(CosAzimuth, -1.0f, 1.0f)));
	if (SolarHour > 0.0f)
	{
		Azimuth = 360.0f - Azimuth; // afternoon: sun in the west
	}

	OutAzimuthDeg = Azimuth;
}

FVector UBCUTimeOfDaySystem::GetSunDirection() const
{
	float Elevation, Azimuth;
	ComputeSunAngles(Elevation, Azimuth);

	const FVector Direction = UKismetMathLibrary::GetDirectionFromRotation(
		FRotator(-Elevation, Azimuth, 0.0f));
	return Direction.GetSafeNormal();
}

float UBCUTimeOfDaySystem::GetSunElevationDegrees() const
{
	float Elevation, Azimuth;
	ComputeSunAngles(Elevation, Azimuth);
	return Elevation;
}

float UBCUTimeOfDaySystem::GetDaylightFactor() const
{
	// Cosine ramp centred on the horizon: 0 below -6° (civil twilight), 1 above
	// +8°. Matches how fast a real street feels like it is getting dark.
	const float Elevation = GetSunElevationDegrees();
	const float T = FMath::Clamp((Elevation + 6.0f) / 14.0f, 0.0f, 1.0f);
	return 0.5f - 0.5f * FMath::Cos(T * PI);
}

bool UBCUTimeOfDaySystem::IsGoldenHour() const
{
	const float Elevation = GetSunElevationDegrees();
	return Elevation > -2.0f && Elevation < 9.0f;
}

FLinearColor UBCUTimeOfDaySystem::GetSunColor() const
{
	if (SunColorCurve)
	{
		return SunColorCurve->GetLinearColorValue(GetHour());
	}

	// Fallback: warm at the horizon, neutral-white at noon. Blue-shift never
	// goes below ~1800 K, which is where a sunset stops looking like a filter.
	const float Elevation = GetSunElevationDegrees();
	const float T = FMath::Clamp((Elevation + 2.0f) / 45.0f, 0.0f, 1.0f);

	const FLinearColor Horizon(1.00f, 0.42f, 0.16f);
	const FLinearColor Noon(1.00f, 0.97f, 0.92f);
	return FLinearColor::LerpUsingHSV(Horizon, Noon, T);
}

FLinearColor UBCUTimeOfDaySystem::GetSkyColor() const
{
	if (SkyColorCurve)
	{
		return SkyColorCurve->GetLinearColorValue(GetHour());
	}

	const float Daylight = GetDaylightFactor();
	const FLinearColor Night(0.012f, 0.020f, 0.045f);
	const FLinearColor Twilight(0.20f, 0.16f, 0.30f);
	const FLinearColor Day(0.28f, 0.48f, 0.82f);

	if (Daylight < 0.5f)
	{
		return FLinearColor::LerpUsingHSV(Night, Twilight, Daylight * 2.0f);
	}
	return FLinearColor::LerpUsingHSV(Twilight, Day, (Daylight - 0.5f) * 2.0f);
}

float UBCUTimeOfDaySystem::GetSunIntensityLux() const
{
	if (SunIntensityCurve)
	{
		return SunIntensityCurve->GetFloatValue(GetHour());
	}

	// ~100k lux at noon, ~1 lux at civil twilight, 0 below the horizon.
	const float Elevation = GetSunElevationDegrees();
	const float AirMass = FMath::Max(0.0f, FMath::Sin(FMath::DegreesToRadians(FMath::Max(0.0f, Elevation))));
	return 118000.0f * FMath::Pow(AirMass, 0.62f);
}

float UBCUTimeOfDaySystem::GetNightLightingIntensity() const
{
	// Streetlights and interior lights come *up* as daylight goes down, but with
	// a lag so dusk reads as "lights switching on" rather than a crossfade.
	const float Daylight = GetDaylightFactor();
	return FMath::Clamp(1.0f - Daylight * 1.35f, 0.0f, 1.0f);
}

FString UBCUTimeOfDaySystem::GetClockString() const
{
	const float HourF = GetHour();
	const int32 H = FMath::FloorToInt(HourF);
	const int32 M = FMath::FloorToInt(FMath::Fmod(HourF, 1.0f) * 60.0f);
	return FString::Printf(TEXT("%02d:%02d"), H, M);
}

//═══════════════════════════════════════════════════════════════════════════════
// Applying to the sky actors
//═══════════════════════════════════════════════════════════════════════════════

void UBCUTimeOfDaySystem::BindSkyActors(ADirectionalLight* Sun, ASkyLight* Sky,
	AExponentialHeightFog* Fog, ASkyAtmosphere* InAtmosphere, AVolumetricCloud* InClouds)
{
	SunLight = Sun;
	SkyLight = Sky;
	HeightFog = Fog;
	Atmosphere = InAtmosphere;
	Clouds = InClouds;

	UE_LOG(LogBCUTime, Log, TEXT("Sky actors bound (sun=%d sky=%d fog=%d atmo=%d cloud=%d)"),
		Sun ? 1 : 0, Sky ? 1 : 0, Fog ? 1 : 0, InAtmosphere ? 1 : 0, InClouds ? 1 : 0);
}

void UBCUTimeOfDaySystem::AutoBindSkyActors()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	for (TActorIterator<ADirectionalLight> It(World); It; ++It)
	{
		if ((*It)->GetLightComponent()->IsA(UDirectionalLightComponent::StaticClass()))
		{
			SunLight = *It;
			break;
		}
	}
	for (TActorIterator<ASkyLight> It(World); It; ++It)			{ SkyLight = *It; break; }
	for (TActorIterator<AExponentialHeightFog> It(World); It; ++It)	{ HeightFog = *It; break; }
	for (TActorIterator<ASkyAtmosphere> It(World); It; ++It)		{ Atmosphere = *It; break; }
	for (TActorIterator<AVolumetricCloud> It(World); It; ++It)		{ Clouds = *It; break; }

	if (!SunLight)
	{
		UE_LOG(LogBCUTime, Warning, TEXT("No DirectionalLight found — the sun will not move."));
	}
}

void UBCUTimeOfDaySystem::ApplySun()
{
	if (!SunLight)
	{
		return;
	}

	UDirectionalLightComponent* Light = SunLight->GetLightComponent();
	if (!Light)
	{
		return;
	}

	float Elevation, Azimuth;
	ComputeSunAngles(Elevation, Azimuth);

	SunLight->SetActorRotation(FRotator(-Elevation, Azimuth, 0.0f));

	// Intensity in lux so Lumen's physical light units behave; below the
	// horizon the light is disabled entirely rather than dimmed to nothing
	// (a disabled light costs no shadow-map update at all).
	const float Lux = GetSunIntensityLux();
	Light->SetIntensity(Lux);
	Light->SetIntensityUnits(ELightUnits::Lux);
	Light->SetLightColor(GetSunColor().ToFColor(true));
	Light->SetVisibility(Lux > 1.0f, true);
	Light->SetCastShadows(Lux > 1.0f);

	// Atmospheric/volumetric sun shafts get stronger near the horizon.
	const float HorizonBias = 1.0f - FMath::Clamp(FMath::Abs(Elevation) / 45.0f, 0.0f, 1.0f);
	Light->SetVolumetricScatteringIntensity(FMath::Lerp(0.4f, 2.4f, HorizonBias));
}

void UBCUTimeOfDaySystem::ApplySkyLight()
{
	if (!SkyLight)
	{
		return;
	}

	USkyLightComponent* Light = SkyLight->GetLightComponent();
	if (!Light)
	{
		return;
	}

	// Real-time capture keeps the sky light honest as the sun moves and as the
	// weather system adds cloud cover.
	Light->SetMobility(EComponentMobility::Movable);
	Light->SourceType = ESkyLightSourceType::SLS_SpecifiedCubemap;
	Light->bRealTimeCapture = true;
	Light->RealTimeCaptureUpdateType = ESkyLightRealtimeCaptureUpdateType::EveryFrame;
	Light->CubemapResolutionScale = GetDaylightFactor() > 0.5f ? 1.0f : 0.5f;

	const float Daylight = GetDaylightFactor();
	Light->SetIntensity(FMath::Lerp(0.06f, 6.5f, Daylight));
	Light->SetLightColor(GetSkyColor().ToFColor(true));
}

void UBCUTimeOfDaySystem::ApplyFog()
{
	if (!HeightFog)
	{
		return;
	}

	UExponentialHeightFogComponent* Fog = HeightFog->GetComponent();
	if (!Fog)
	{
		return;
	}

	float BaseDensity = 0.02f;
	if (FogDensityCurve)
	{
		BaseDensity = FogDensityCurve->GetFloatValue(GetHour());
	}
	else
	{
		// Thicker fog at night and dawn (radiation fog) — the classic look.
		const float Daylight = GetDaylightFactor();
		BaseDensity = FMath::Lerp(0.055f, 0.012f, Daylight);
	}

	Fog->SetFogDensity(BaseDensity);
	Fog->SetFogInscatteringColor(GetSkyColor());
	Fog->SetFogHeightFalloff(0.14f);
	Fog->SetStartDistance(0.0f);

	// Volumetric fog is driven by the graphics preset (bcu.weather.VolumetricFog);
	// here we only tune the scattering so the sun shaft is visible at dusk.
	Fog->SetVolumetricFogScatteringDistribution(FMath::Lerp(0.2f, 0.55f, GetDaylightFactor()));
	Fog->SetVolumetricFogExtinctionScale(FMath::Lerp(1.6f, 0.9f, GetDaylightFactor()));
	Fog->SetDirectionalInscatteringColor(GetSunColor());
	Fog->SetDirectionalInscatteringExponent(6.0f);
	Fog->SetDirectionalInscatteringStartDistance(30000.0f);
}

void UBCUTimeOfDaySystem::ApplyAtmosphere()
{
	if (Atmosphere)
	{
		USkyAtmosphereComponent* Atmo = Atmosphere->GetRootComponent()
			? Atmosphere->FindComponentByClass<USkyAtmosphereComponent>() : nullptr;
		if (Atmo)
		{
			// Rayleigh/Mie stay physical; only the planet rotation follows the clock.
			Atmo->SetPlanetRadius(6371.0f);
			Atmo->AtmosphereHeight = 60.0f;
			Atmo->SetGroundAlbedo(GetDaylightFactor() > 0.5f ? 0.28f : 0.14f);
		}
	}

	if (Clouds)
	{
		UVolumetricCloudComponent* Cloud = Clouds->FindComponentByClass<UVolumetricCloudComponent>();
		if (Cloud)
		{
			// Time of day only nudges cloud drift; density belongs to the weather
			// system, which owns the whole sky's moisture budget.
			Cloud->SetCloudBaseAltitudeKm(1.6f);
			Cloud->SetCloudBaseHeightKm(0.9f);
		}
	}
}

//═══════════════════════════════════════════════════════════════════════════════
// Setters
//═══════════════════════════════════════════════════════════════════════════════

void UBCUTimeOfDaySystem::SetTimeOfDay(float NewTimeOfDay)
{
	TimeOfDay = FMath::Fmod(FMath::Max(0.0f, NewTimeOfDay), 1.0f);
	bNetworkDriven = false;
}

void UBCUTimeOfDaySystem::SetTimeOfDayFromNetwork(float NewTimeOfDay)
{
	TimeOfDay = FMath::Fmod(FMath::Max(0.0f, NewTimeOfDay), 1.0f);
	// Authoritative clock: stop the local advance so we do not drift from it.
	bNetworkDriven = true;
}

void UBCUTimeOfDaySystem::SetHour(float Hour)
{
	SetTimeOfDay(FMath::Fmod(Hour, 24.0f) / 24.0f);
}

void UBCUTimeOfDaySystem::AdvanceTime(float Hours)
{
	SetTimeOfDay(TimeOfDay + Hours / 24.0f);
}

void UBCUTimeOfDaySystem::SetAutoAdvance(bool bEnabled)
{
	bAutoAdvance = bEnabled;
}
