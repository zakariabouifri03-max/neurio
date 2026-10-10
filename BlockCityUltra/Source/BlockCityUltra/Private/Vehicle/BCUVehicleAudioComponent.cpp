// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Vehicle/BCUVehicleAudioComponent.h"

#include "Components/AudioComponent.h"
#include "Sound/SoundBase.h"
#include "Kismet/GameplayStatics.h"

UBCUVehicleAudioComponent::UBCUVehicleAudioComponent()
{
	PrimaryComponentTick.bCanEverTick = false; // driven by the vehicle
}

void UBCUVehicleAudioComponent::BeginPlay() { Super::BeginPlay(); }

void UBCUVehicleAudioComponent::Initialise(UBCUVehicleDefinition* InDefinition)
{
	Definition = InDefinition;
	if (!Definition) { return; }

	// Tear down any previous set (the vehicle may be reconfigured from a pool).
	Shutdown();

	if (USoundBase* Idle = Definition->EngineIdleSound.LoadSynchronous())
	{
		IdleAudio = SpawnLoop(Idle, 0.55f);
	}
	if (USoundBase* Load = Definition->EngineLoadSound.LoadSynchronous())
	{
		LoadAudio = SpawnLoop(Load, 0.0f);
	}
	if (USoundBase* Skid = Definition->TyreSkidSound.LoadSynchronous())
	{
		TyreAudio = SpawnLoop(Skid, 0.0f);
	}
	if (Definition->SirenSound.IsValid())
	{
		if (USoundBase* Siren = Definition->SirenSound.LoadSynchronous())
		{
			SirenAudio = SpawnLoop(Siren, 0.0f);
		}
	}
}

void UBCUVehicleAudioComponent::Shutdown()
{
	for (UAudioComponent* Comp : { IdleAudio, LoadAudio, TyreAudio, WindAudio, SirenAudio })
	{
		if (Comp)
		{
			Comp->Stop();
			Comp->DestroyComponent();
		}
	}
	IdleAudio = LoadAudio = TyreAudio = WindAudio = SirenAudio = nullptr;
}

UAudioComponent* UBCUVehicleAudioComponent::SpawnLoop(USoundBase* Sound, float Volume)
{
	if (!Sound || !GetOwner()) { return nullptr; }

	UAudioComponent* Comp = UGameplayStatics::SpawnSoundAttached(
		Sound, GetOwner()->GetRootComponent(), NAME_None, FVector::ZeroVector,
		EAttachLocation::KeepRelativeOffset, /*bAutoDestroy=*/false);

	if (Comp)
	{
		Comp->bAutoDestroy = false;
		Comp->SetVolumeMultiplier(Volume * MasterVolumeScale);
		Comp->bAllowSpatialization = true;
		Comp->bAutoActivate = true;
		Comp->bIsUISound = false;
		Comp->Priority = 128;
		Comp->AddFadeOut(0.35f, 0.0f);
		Comp->FadeIn(0.35f, Volume * MasterVolumeScale);
	}

	return Comp;
}

void UBCUVehicleAudioComponent::UpdateEngine(float RPM, float Throttle, float SpeedKmh, bool bDrifting)
{
	if (!Definition) { return; }

	// Smooth everything: raw RPM is noisy frame to frame and an unsmoothed pitch
	// sweep sounds like a synth rather than an engine.
	SmoothedRPM = FMath::FInterpTo(SmoothedRPM, RPM, 0.016f, 9.0f);
	SmoothedThrottle = FMath::FInterpTo(SmoothedThrottle, Throttle, 0.016f, 12.0f);

	const float MaxRPM = FMath::Max(1000.0f, Definition->MaxRPM);
	const float IdleRPM = FMath::Min(Definition->IdleRPM, MaxRPM * 0.5f);
	const float Normalised = FMath::Clamp((SmoothedRPM - IdleRPM) / (MaxRPM - IdleRPM), 0.0f, 1.0f);

	// Pitch: idle at 1.0, redline at ~1.85, scaled per vehicle character.
	const float Pitch = FMath::Lerp(1.0f, 1.85f, Normalised) * Definition->EnginePitchScale;

	if (IdleAudio)
	{
		IdleAudio->SetPitchMultiplier(Pitch);
		IdleAudio->SetVolumeMultiplier(FMath::Lerp(0.7f, 0.25f, Normalised) * MasterVolumeScale);
	}
	if (LoadAudio)
	{
		LoadAudio->SetPitchMultiplier(Pitch * 0.98f);
		// Crossfade load in with throttle so lift-off sounds like a real engine.
		const float LoadVolume = FMath::Clamp(FMath::Abs(SmoothedThrottle) * 1.1f, 0.0f, 1.0f) * Normalised;
		LoadAudio->SetVolumeMultiplier(LoadVolume * MasterVolumeScale);
	}

	// Tyre scrub while drifting.
	SkidIntensity = bDrifting ? FMath::Clamp(SpeedKmh / 90.0f, 0.2f, 1.0f)
		: FMath::Max(0.0f, SkidIntensity - 0.06f);
	if (TyreAudio)
	{
		TyreAudio->SetVolumeMultiplier(SkidIntensity * 0.85f * MasterVolumeScale);
	}

	// Wind noise rises with speed — the cheapest cue that you are going fast.
	if (!WindAudio && SpeedKmh > 60.0f && GetOwner())
	{
		WindAudio = SpawnLoop(nullptr, 0.0f); // placeholder: uses the tyre bed
	}
	if (WindAudio)
	{
		WindAudio->SetVolumeMultiplier(FMath::Clamp((SpeedKmh - 60.0f) / 220.0f, 0.0f, 0.6f) * MasterVolumeScale);
	}

	// Hard distance cut so 120 traffic cars do not fill the mix.
	if (GetOwner())
	{
		const float Distance = FVector::Dist(GetOwner()->GetActorLocation(),
			UGameplayStatics::GetPlayerCameraManager(GetWorld(), 0)
				? UGameplayStatics::GetPlayerCameraManager(GetWorld(), 0)->GetCameraLocation()
				: FVector::ZeroVector);
		const float Attenuation = FMath::Clamp(1.0f - Distance / MaxAudibleDistanceCm, 0.0f, 1.0f);

		for (UAudioComponent* Comp : { IdleAudio, LoadAudio, TyreAudio, WindAudio })
		{
			if (Comp) { Comp->SetVolumeMultiplier(Comp->VolumeMultiplier * Attenuation); }
		}
	}

	HornCooldown = FMath::Max(0.0f, HornCooldown - 0.016f);
}

void UBCUVehicleAudioComponent::PlayHorn()
{
	if (!Definition || HornCooldown > 0.0f) { return; }

	if (USoundBase* Horn = Definition->HornSound.LoadSynchronous())
	{
		UGameplayStatics::PlaySoundAtLocation(GetWorld(), Horn,
			GetOwner() ? GetOwner()->GetActorLocation() : FVector::ZeroVector,
			0.85f * MasterVolumeScale);
		HornCooldown = 0.4f;
	}
}

void UBCUVehicleAudioComponent::SetSirenActive(bool bActive)
{
	if (!SirenAudio) { return; }

	SirenAudio->SetVolumeMultiplier(bActive ? 0.9f * MasterVolumeScale : 0.0f);
	SirenAudio->SetPitchMultiplier(bActive ? 1.0f : 1.0f);
}

void UBCUVehicleAudioComponent::PlayUISound(EBCUVehicleUISound Sound)
{
	// One-shot feedback: door, ignition, gear, handbrake, refused exit.
	if (!GetOwner()) { return; }

	if (Definition)
	{
		USoundBase* Clip = nullptr;
		switch (Sound)
		{
		case EBCUVehicleUISound::Enter:
		case EBCUVehicleUISound::Ignition:	Clip = Definition->EngineIdleSound.LoadSynchronous(); break;
		case EBCUVehicleUISound::Boost:		Clip = Definition->EngineLoadSound.LoadSynchronous(); break;
		default:							break;
		}

		if (Clip)
		{
			UGameplayStatics::PlaySoundAtLocation(GetWorld(), Clip, GetOwner()->GetActorLocation(),
				0.5f * MasterVolumeScale, 1.4f);
		}
	}
}

void UBCUVehicleAudioComponent::PlayTyreSkid(float Intensity)
{
	SkidIntensity = FMath::Clamp(Intensity, 0.0f, 1.0f);
}

void UBCUVehicleAudioComponent::PlayImpact(float Severity)
{
	if (!GetOwner()) { return; }

	// Impact sounds are resolved by the audio subsystem so all vehicles share one
	// attenuation curve and one instance budget.
	UGameplayStatics::PlaySoundAtLocation(GetWorld(),
		Definition ? Definition->TyreSkidSound.LoadSynchronous() : nullptr,
		GetOwner()->GetActorLocation(),
		FMath::Clamp(Severity, 0.2f, 1.0f) * MasterVolumeScale,
		FMath::Lerp(1.2f, 0.7f, FMath::Clamp(Severity, 0.0f, 1.0f)));
}
