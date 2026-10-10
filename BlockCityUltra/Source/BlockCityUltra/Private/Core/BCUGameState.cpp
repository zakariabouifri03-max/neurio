// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Core/BCUGameState.h"

#include "Net/UnrealNetwork.h"
#include "World/Weather/BCUTimeOfDaySystem.h"
#include "World/Weather/BCUWeatherSystem.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUGameState, Log, All);

ABCUGameState::ABCUGameState()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickInterval = 0.5f;
	bReplicates = true;
}

void ABCUGameState::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);

	DOREPLIFETIME(ABCUGameState, TimeOfDay);
	DOREPLIFETIME(ABCUGameState, WeatherIntensity);
	DOREPLIFETIME(ABCUGameState, SurfaceWetness);
	DOREPLIFETIME(ABCUGameState, CurrentDistrict);
}

void ABCUGameState::OnRep_TimeOfDay()
{
	// Push into the local time-of-day system so the sun, sky and streetlight
	// channels stay in sync with the authoritative (server) clock.
	if (UWorld* World = GetWorld())
	{
		if (UBCUTimeOfDaySystem* TOD = World->GetSubsystem<UBCUTimeOfDaySystem>())
		{
			TOD->SetTimeOfDayFromNetwork(TimeOfDay);
		}
	}
}

void ABCUGameState::OnRep_Weather()
{
	if (UWorld* World = GetWorld())
	{
		if (UBCUWeatherSystem* Weather = World->GetSubsystem<UBCUWeatherSystem>())
		{
			Weather->SetIntensityFromNetwork(WeatherIntensity);
		}
	}
}

void ABCUGameState::OnRep_CurrentDistrict()
{
	UE_LOG(LogBCUGameState, Verbose, TEXT("Player entered district %d"), static_cast<int32>(CurrentDistrict));
}

void ABCUGameState::SetResidentCellCount(int32 NewCount)
{
	ResidentCellCount = NewCount;
}

void ABCUGameState::MarkInitialStreamingComplete()
{
	if (!bInitialStreamingComplete)
	{
		bInitialStreamingComplete = true;
		UE_LOG(LogBCUGameState, Log, TEXT("Initial World Partition streaming complete (%d cells resident)"),
			ResidentCellCount);
	}
}

bool ABCUGameState::IsNight() const
{
	// Wraps midnight: night spans NightStartFraction..1.0 and 0.0..NightEndFraction.
	if (NightStartFraction > NightEndFraction)
	{
		return TimeOfDay >= NightStartFraction || TimeOfDay <= NightEndFraction;
	}

	return TimeOfDay >= NightStartFraction && TimeOfDay <= NightEndFraction;
}

float ABCUGameState::GetDaylightFactor() const
{
	// Smooth ramp across the two twilight windows so streetlights fade rather
	// than pop. Uses a cosine ease so sunrise and sunset feel symmetric.
	const float DawnCentre = NightEndFraction;
	const float DuskCentre = NightStartFraction;
	const float HalfWidth = 0.035f;

	const float DawnT = FMath::Clamp((TimeOfDay - (DawnCentre - HalfWidth)) / (2.0f * HalfWidth), 0.f, 1.f);
	const float DuskT = FMath::Clamp(((DuskCentre + HalfWidth) - TimeOfDay) / (2.0f * HalfWidth), 0.f, 1.f);

	const float Raw = FMath::Min(DawnT, DuskT);
	return 0.5f - 0.5f * FMath::Cos(Raw * PI);
}
