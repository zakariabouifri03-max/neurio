// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "World/Weather/BCUWeatherSystem.h"

#include "World/Weather/BCUTimeOfDaySystem.h"
#include "Components/AudioComponent.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/VolumetricCloudComponent.h"
#include "Engine/ExponentialHeightFog.h"
#include "Engine/SkyLight.h"
#include "Materials/MaterialParameterCollection.h"
#include "Materials/MaterialParameterCollectionInstance.h"
#include "NiagaraComponent.h"
#include "NiagaraFunctionLibrary.h"
#include "NiagaraSystem.h"
#include "Sound/SoundBase.h"
#include "VolumetricCloud.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUWeather, Log, All);

void UBCUWeatherSystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

	CurrentWeather = DefaultWeather;
	TargetWeather = DefaultWeather;
	Intensity = 0.0f;
	TargetIntensity = 0.0f;
	CloudCover = CloudCoverForWeather(DefaultWeather);
	TargetCloudCover = CloudCover;
	SurfaceWetness = (DefaultWeather == EBCUWeather::LightRain || DefaultWeather == EBCUWeather::HeavyRain) ? 0.6f : 0.0f;

	const int32 Seed = FPlatformProcess::GetProcessId();
	TimeUntilNextChange = FMath::FRandRange(WeatherChangeMinMinutes, WeatherChangeMaxMinutes) * 60.0f;
	LightningTimer = LightningIntervalSeconds;
	(void)Seed;

	ResolvedWeatherParameters = WeatherParameters.LoadSynchronous();
	CreateComponents();
}

void UBCUWeatherSystem::Deinitialize()
{
	if (RainComponent)	{ RainComponent->DestroyComponent(); }
	if (SnowComponent)	{ SnowComponent->DestroyComponent(); }
	if (LightningComponent) { LightningComponent->DestroyComponent(); }
	if (RainAudio)		{ RainAudio->DestroyComponent(); }
	if (WindAudio)		{ WindAudio->DestroyComponent(); }

	Super::Deinitialize();
}

TStatId UBCUWeatherSystem::GetStatId() const
{
	RETURN_QUICK_DECLARE_CYCLE_STAT(UBCUWeatherSystem, STATGROUP_Tickables);
}

void UBCUWeatherSystem::Tick(float DeltaTime)
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	UpdateWeatherSelection(DeltaTime);
	UpdateTransition(DeltaTime);
	UpdateWetness(DeltaTime);
	UpdateLightning(DeltaTime);
	UpdateComponents();
	PublishToMaterialParameters();
	ApplyToSkyAndFog();
}

void UBCUWeatherSystem::CreateComponents()
{
	AActor* Owner = UGameplayStatics::GetActorOfClass(GetWorld(), APawn::StaticClass());

	if (UNiagaraSystem* Rain = RainEffect.LoadSynchronous())
	{
		RainComponent = UNiagaraFunctionLibrary::SpawnSystemAttached(
			Rain, Owner ? Owner->GetRootComponent() : nullptr, NAME_None,
			FVector::ZeroVector, FRotator::ZeroRotator,
			EAttachLocation::KeepRelativeOffset, /*bAutoDestroy=*/false);
		if (RainComponent)
		{
			RainComponent->SetAutoActivate(false);
			RainComponent->SetAbsolute(false, false, false);
		}
	}

	if (UNiagaraSystem* Snow = SnowEffect.LoadSynchronous())
	{
		SnowComponent = UNiagaraFunctionLibrary::SpawnSystemAttached(
			Snow, Owner ? Owner->GetRootComponent() : nullptr, NAME_None,
			FVector::ZeroVector, FRotator::ZeroRotator,
			EAttachLocation::KeepRelativeOffset, /*bAutoDestroy=*/false);
		if (SnowComponent)
		{
			SnowComponent->SetAutoActivate(false);
		}
	}

	if (UNiagaraSystem* Lightning = LightningEffect.LoadSynchronous())
	{
		LightningComponent = UNiagaraFunctionLibrary::SpawnSystemAttached(
			Lightning, Owner ? Owner->GetRootComponent() : nullptr, NAME_None,
			FVector::ZeroVector, FRotator::ZeroRotator,
			EAttachLocation::KeepRelativeOffset, /*bAutoDestroy=*/false);
		if (LightningComponent)
		{
			LightningComponent->SetAutoActivate(false);
		}
	}

	if (USoundBase* RainSound = RainLoopSound.LoadSynchronous())
	{
		RainAudio = UGameplayStatics::SpawnSound2D(GetWorld(), RainSound, 0.0f);
		if (RainAudio)
		{
			RainAudio->SetVolumeMultiplier(0.0f);
			RainAudio->bAutoDestroy = false;
		}
	}

	if (USoundBase* WindSound = WindLoopSound.LoadSynchronous())
	{
		WindAudio = UGameplayStatics::SpawnSound2D(GetWorld(), WindSound, 0.0f);
		if (WindAudio)
		{
			WindAudio->SetVolumeMultiplier(0.0f);
			WindAudio->bAutoDestroy = false;
		}
	}
}

void UBCUWeatherSystem::UpdateWeatherSelection(float DeltaTime)
{
	if (!bAutoWeather || TransitionRemaining > 0.0f)
	{
		return;
	}

	TimeUntilNextChange -= DeltaTime;
	if (TimeUntilNextChange > 0.0f)
	{
		return;
	}

	// Markov-ish selection: the next weather is biased towards staying similar,
	// so the city gets long clear stretches punctuated by real storms instead of
	// flickering between extremes every few minutes.
	static const EBCUWeather Table[] =
	{
		EBCUWeather::Clear, EBCUWeather::PartlyCloudy, EBCUWeather::Overcast,
		EBCUWeather::LightRain, EBCUWeather::HeavyRain, EBCUWeather::Thunderstorm,
		EBCUWeather::Fog, EBCUWeather::Wind, EBCUWeather::Heatwave, EBCUWeather::Snow
	};

	const int32 CurrentIndex = int32(CurrentWeather);
	int32 NextIndex = CurrentIndex;
	const float Roll = FMath::FRand();

	if (Roll < 0.45f)
	{
		NextIndex = CurrentIndex; // persist
	}
	else if (Roll < 0.80f)
	{
		NextIndex = FMath::Clamp(CurrentIndex + (FMath::RandBool() ? 1 : -1), 0, UE_ARRAY_COUNT(Table) - 1);
	}
	else
	{
		NextIndex = FMath::RandRange(0, UE_ARRAY_COUNT(Table) - 1);
	}

	const EBCUWeather Next = Table[NextIndex];
	const float TransitionSeconds = FMath::FRandRange(20.0f, 60.0f);

	SetWeather(Next, TransitionSeconds);
	TimeUntilNextChange = FMath::FRandRange(WeatherChangeMinMinutes, WeatherChangeMaxMinutes) * 60.0f;
}

void UBCUWeatherSystem::SetWeather(EBCUWeather NewWeather, float TransitionSeconds)
{
	if (NewWeather == TargetWeather && TransitionRemaining <= 0.0f)
	{
		return;
	}

	const EBCUWeather Old = CurrentWeather;
	TargetWeather = NewWeather;
	TargetIntensity = IntensityForWeather(NewWeather, FPlatformProcess::GetProcessId());
	TargetCloudCover = CloudCoverForWeather(NewWeather);
	TransitionDuration = FMath::Max(0.1f, TransitionSeconds);
	TransitionRemaining = TransitionDuration;

	WindSpeedKmh = (NewWeather == EBCUWeather::Wind) ? FMath::FRandRange(45.0f, 85.0f)
		: (NewWeather == EBCUWeather::Thunderstorm) ? FMath::FRandRange(30.0f, 55.0f)
		: FMath::FRandRange(4.0f, 18.0f);
	WindDirection = FVector2D(FMath::FRandRange(-1.0f, 1.0f), FMath::FRandRange(-1.0f, 1.0f)).GetSafeNormal();

	UE_LOG(LogBCUWeather, Log, TEXT("Weather %d → %d over %.0f s (intensity %.2f, cloud %.2f)"),
		static_cast<int32>(Old), static_cast<int32>(NewWeather), TransitionSeconds, TargetIntensity, TargetCloudCover);
}

void UBCUWeatherSystem::TriggerStorm(bool bInstant)
{
	SetWeather(EBCUWeather::Thunderstorm, bInstant ? 0.5f : 30.0f);
	if (bInstant)
	{
		Intensity = TargetIntensity;
		CloudCover = TargetCloudCover;
		SurfaceWetness = FMath::Max(SurfaceWetness, 0.7f);
		TransitionRemaining = 0.0f;
		OnWeatherChanged.Broadcast(CurrentWeather, CurrentWeather);
	}
}

void UBCUWeatherSystem::SetSurfaceWetness(float Value)
{
	SurfaceWetness = FMath::Clamp(Value, 0.0f, 1.0f);
}

void UBCUWeatherSystem::UpdateTransition(float DeltaTime)
{
	if (TransitionRemaining <= 0.0f)
	{
		return;
	}

	TransitionRemaining = FMath::Max(0.0f, TransitionRemaining - DeltaTime);
	const float Alpha = 1.0f - (TransitionRemaining / TransitionDuration);
	const float Eased = FMath::InterpEaseInOut(0.0f, 1.0f, Alpha, 2.0f);

	Intensity = FMath::Lerp(Intensity, TargetIntensity, Eased * DeltaTime * 2.0f);
	CloudCover = FMath::Lerp(CloudCover, TargetCloudCover, Eased * DeltaTime * 2.0f);

	if (TransitionRemaining <= 0.0f)
	{
		Intensity = TargetIntensity;
		CloudCover = TargetCloudCover;
		const EBCUWeather Old = CurrentWeather;
		CurrentWeather = TargetWeather;

		if (Old != CurrentWeather)
		{
			OnWeatherChanged.Broadcast(CurrentWeather, Old);
		}
	}
}

void UBCUWeatherSystem::UpdateWetness(float DeltaTime)
{
	const float MinutesDelta = DeltaTime / 60.0f;

	const bool bWetting = (CurrentWeather == EBCUWeather::LightRain
		|| CurrentWeather == EBCUWeather::HeavyRain
		|| CurrentWeather == EBCUWeather::Thunderstorm
		|| TargetWeather == EBCUWeather::LightRain
		|| TargetWeather == EBCUWeather::HeavyRain
		|| TargetWeather == EBCUWeather::Thunderstorm);

	if (bWetting)
	{
		SurfaceWetness = FMath::Min(1.0f, SurfaceWetness + RainWetnessPerMinute * MinutesDelta * FMath::Max(0.2f, Intensity));
	}
	else
	{
		// Drying is slower in shade and at night; faster in sun and wind.
		float DryRate = WetnessDryRatePerMinute;

		if (UBCUTimeOfDaySystem* TOD = GetWorld()->GetSubsystem<UBCUTimeOfDaySystem>())
		{
			DryRate *= FMath::Lerp(0.35f, 2.2f, TOD->GetDaylightFactor());
		}
		DryRate *= FMath::Lerp(0.7f, 1.8f, FMath::Clamp(WindSpeedKmh / 60.0f, 0.0f, 1.0f));

		SurfaceWetness = FMath::Max(0.0f, SurfaceWetness - DryRate * MinutesDelta);
	}
}

void UBCUWeatherSystem::UpdateLightning(float DeltaTime)
{
	LightningFlashRemaining = FMath::Max(0.0f, LightningFlashRemaining - DeltaTime);

	if (CurrentWeather != EBCUWeather::Thunderstorm)
	{
		LightningTimer = LightningIntervalSeconds;
		return;
	}

	LightningTimer -= DeltaTime;
	if (LightningTimer > 0.0f)
	{
		return;
	}

	// Strike: a bright flash, a delayed thunder clap, and a reset with jitter so
	// the rhythm never feels metronomic.
	LightningFlashRemaining = 0.22f + FMath::FRandRange(0.0f, 0.18f);
	LightningTimer = LightningIntervalSeconds * FMath::FRandRange(0.4f, 2.2f) / FMath::Max(0.2f, Intensity);

	if (LightningComponent)
	{
		LightningComponent->Activate(true);
	}

	if (USoundBase* Thunder = ThunderSound.LoadSynchronous())
	{
		const float Delay = FMath::FRandRange(0.4f, 2.6f);
		FTimerHandle Handle;
		GetWorld()->GetTimerManager().SetTimer(Handle, FTimerDelegate::CreateWeakLambda(this, [this, Thunder]()
		{
			UGameplayStatics::PlaySound2D(GetWorld(), Thunder, 0.85f, FMath::FRandRange(0.9f, 1.1f));
		}), Delay, false);
	}
}

void UBCUWeatherSystem::UpdateComponents()
{
	const bool bRaining = Intensity > 0.05f
		&& (CurrentWeather == EBCUWeather::LightRain || CurrentWeather == EBCUWeather::HeavyRain
			|| CurrentWeather == EBCUWeather::Thunderstorm || TargetWeather == EBCUWeather::Thunderstorm);
	const bool bSnowing = Intensity > 0.05f && (CurrentWeather == EBCUWeather::Snow || TargetWeather == EBCUWeather::Snow);

	if (RainComponent)
	{
		RainComponent->SetVisibility(bRaining, true);
		if (bRaining && !RainComponent->IsActive()) { RainComponent->Activate(true); }
		else if (!bRaining && RainComponent->IsActive()) { RainComponent->Deactivate(); }
	}

	if (SnowComponent)
	{
		SnowComponent->SetVisibility(bSnowing, true);
		if (bSnowing && !SnowComponent->IsActive()) { SnowComponent->Activate(true); }
		else if (!bSnowing && SnowComponent->IsActive()) { SnowComponent->Deactivate(); }
	}

	if (RainAudio)
	{
		RainAudio->SetVolumeMultiplier(bRaining ? FMath::Lerp(0.15f, 1.0f, Intensity) : 0.0f);
	}
	if (WindAudio)
	{
		WindAudio->SetVolumeMultiplier(FMath::Clamp(WindSpeedKmh / 90.0f, 0.0f, 0.8f));
	}
}

void UBCUWeatherSystem::PublishToMaterialParameters()
{
	if (!ResolvedWeatherParameters)
	{
		ResolvedWeatherParameters = WeatherParameters.LoadSynchronous();
	}
	if (!ResolvedWeatherParameters)
	{
		return;
	}

	UMaterialParameterCollectionInstance* MPC =
		GetWorld()->GetParameterCollectionInstance(ResolvedWeatherParameters);
	if (!MPC)
	{
		return;
	}

	// One scalar each: every wet-road, puddle and glass material in the project
	// reads these instead of running its own logic.
	MPC->SetScalarParameterValue(TEXT("Wetness"), SurfaceWetness);
	MPC->SetScalarParameterValue(TEXT("RainIntensity"), Intensity);
	MPC->SetScalarParameterValue(TEXT("CloudCover"), CloudCover);
	MPC->SetScalarParameterValue(TEXT("FogDensity"), FogDensity);
	MPC->SetScalarParameterValue(TEXT("Lightning"), LightningFlashRemaining > 0.0f ? 1.0f : 0.0f);
	MPC->SetScalarParameterValue(TEXT("WindSpeed"), WindSpeedKmh / 100.0f);
	MPC->SetVectorParameterValue(TEXT("WindDirection"), FVector(WindDirection.X, WindDirection.Y, 0.0f));
}

void UBCUWeatherSystem::ApplyToSkyAndFog()
{
	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	// Fog density comes from the weather type; the time-of-day system multiplies
	// it by its own day/night curve so the two never fight.
	switch (CurrentWeather)
	{
	case EBCUWeather::Fog:			FogDensity = FMath::Lerp(FogDensity, 0.085f, 0.05f); break;
	case EBCUWeather::Overcast:		FogDensity = FMath::Lerp(FogDensity, 0.030f, 0.05f); break;
	case EBCUWeather::HeavyRain:	FogDensity = FMath::Lerp(FogDensity, 0.045f, 0.05f); break;
	case EBCUWeather::Thunderstorm:	FogDensity = FMath::Lerp(FogDensity, 0.055f, 0.05f); break;
	case EBCUWeather::Heatwave:		FogDensity = FMath::Lerp(FogDensity, 0.010f, 0.05f); break;
	default:						FogDensity = FMath::Lerp(FogDensity, 0.014f, 0.05f); break;
	}

	for (TActorIterator<AExponentialHeightFog> It(World); It; ++It)
	{
		if (UExponentialHeightFogComponent* Fog = (*It)->GetComponent())
		{
			Fog->SetFogDensity(FMath::Max(Fog->FogDensity, FogDensity));
			Fog->SetFogInscatteringColor(FLinearColor::LerpUsingHSV(
				FLinearColor(0.55f, 0.58f, 0.62f), FLinearColor(0.30f, 0.32f, 0.36f), CloudCover));
		}
	}

	// Cloud cover darkens the sky light and thickens the volumetric cloud.
	for (TActorIterator<ASkyLight> It(World); It; ++It)
	{
		if (USkyLightComponent* Sky = (*It)->GetLightComponent())
		{
			Sky->SetIntensity(FMath::Lerp(6.5f, 1.1f, CloudCover) *
				FMath::Lerp(1.0f, 0.35f, 1.0f - GetWorld()->GetSubsystem<UBCUTimeOfDaySystem>()->GetDaylightFactor() * 0.0f));
		}
	}

	for (TActorIterator<AVolumetricCloud> It(World); It; ++It)
	{
		if (UVolumetricCloudComponent* Cloud = (*It)->FindComponentByClass<UVolumetricCloudComponent>())
		{
			Cloud->SetCoverageAmount(CloudCover);
			Cloud->SetTracingStartMaxDistanceKm(FMath::Lerp(30.0f, 8.0f, CloudCover));
		}
	}
}

void UBCUWeatherSystem::SetIntensityFromNetwork(float NewIntensity)
{
	Intensity = FMath::Clamp(NewIntensity, 0.0f, 1.0f);
	TargetIntensity = Intensity;
	TransitionRemaining = 0.0f;
	bAutoWeather = false; // authoritative
}

float UBCUWeatherSystem::IntensityForWeather(EBCUWeather Weather, int32 Seed)
{
	const float Jitter = float(Seed % 100) / 400.0f; // ±0.25 of variety
	switch (Weather)
	{
	case EBCUWeather::LightRain:	return FMath::Clamp(0.28f + Jitter, 0.0f, 1.0f);
	case EBCUWeather::HeavyRain:	return FMath::Clamp(0.78f + Jitter, 0.0f, 1.0f);
	case EBCUWeather::Thunderstorm:	return FMath::Clamp(0.95f + Jitter, 0.0f, 1.0f);
	case EBCUWeather::Snow:			return FMath::Clamp(0.55f + Jitter, 0.0f, 1.0f);
	case EBCUWeather::Overcast:		return 0.0f;
	default:						return 0.0f;
	}
}

float UBCUWeatherSystem::CloudCoverForWeather(EBCUWeather Weather)
{
	switch (Weather)
	{
	case EBCUWeather::Clear:		return 0.06f;
	case EBCUWeather::PartlyCloudy:	return 0.38f;
	case EBCUWeather::Overcast:		return 0.86f;
	case EBCUWeather::LightRain:	return 0.78f;
	case EBCUWeather::HeavyRain:	return 0.94f;
	case EBCUWeather::Thunderstorm:	return 1.00f;
	case EBCUWeather::Fog:			return 0.70f;
	case EBCUWeather::Wind:			return 0.55f;
	case EBCUWeather::Heatwave:		return 0.03f;
	case EBCUWeather::Snow:			return 0.90f;
	default:						return 0.2f;
	}
}
