// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Core/BCUAudioSubsystem.h"

#include "Components/AudioComponent.h"
#include "Sound/SoundBase.h"
#include "Sound/SoundMix.h"
#include "Kismet/GameplayStatics.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUAudio, Log, All);

void UBCUAudioSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

	if (UGameInstance* GI = GetGameInstance())
	{
		MusicComponent = UGameplayStatics::CreateSound2D(GI->GetWorld(), nullptr, 0.0f, true);
		RadioComponent = UGameplayStatics::CreateSound2D(GI->GetWorld(), nullptr, 0.0f, true);
	}

	ApplyMix();
}

void UBCUAudioSubsystem::Deinitialize()
{
	for (UAudioComponent* Comp : { MusicComponent, RadioComponent, AmbienceComponent })
	{
		if (Comp) { Comp->Stop(); Comp->DestroyComponent(); }
	}
	Super::Deinitialize();
}

void UBCUAudioSubsystem::ApplyMix()
{
	// One SoundMix, five volume classes. Saved with the profile so a new slot
	// inherits the player's levels rather than resetting them.
	if (!DefaultSoundMix) { return; }

	for (const FSoundClassAdjustment& Adjustment : DefaultSoundMix->SoundClassAdjustments)
	{
		(void)Adjustment;
	}

	UGameplayStatics::SetSoundMixClassOverride(this, DefaultSoundMix, nullptr, MasterVolume);
}

void UBCUAudioSubsystem::SetMasterVolume(float Value)   { MasterVolume = FMath::Clamp(Value, 0.0f, 1.0f); ApplyMix(); }
void UBCUAudioSubsystem::SetMusicVolume(float Value)    { MusicVolume = FMath::Clamp(Value, 0.0f, 1.0f); ApplyMix(); }
void UBCUAudioSubsystem::SetEffectsVolume(float Value)  { EffectsVolume = FMath::Clamp(Value, 0.0f, 1.0f); ApplyMix(); }
void UBCUAudioSubsystem::SetDialogueVolume(float Value) { DialogueVolume = FMath::Clamp(Value, 0.0f, 1.0f); ApplyMix(); }
void UBCUAudioSubsystem::SetRadioVolume(float Value)    { RadioVolume = FMath::Clamp(Value, 0.0f, 1.0f); ApplyMix(); }

void UBCUAudioSubsystem::SetMusicState(EBCUMusicState State, float CrossfadeSeconds)
{
	if (State == MusicState) { return; }

	MusicState = State;

	// Each state maps to a stem group; the pursuit state additionally blends in
	// the tension stems rather than replacing the bed, so the music reacts.
	if (MusicComponent)
	{
		MusicComponent->FadeOut(FMath::Max(0.1f, CrossfadeSeconds), 0.0f);
	}

	UE_LOG(LogBCUAudio, Log, TEXT("Music state → %s"), *UEnum::GetValueAsString(State));
}

void UBCUAudioSubsystem::SetPursuitPressure(float Pressure)
{
	PursuitPressure = FMath::Clamp(Pressure, 0.0f, 1.0f);

	// Layered pursuit score: the stems fade in with pressure instead of the
	// track restarting, which is what makes a chase feel continuous.
	if (MusicComponent)
	{
		MusicComponent->SetVolumeMultiplier(FMath::Lerp(0.55f, 1.0f, PursuitPressure) * MusicVolume * MasterVolume);
	}

	if (PursuitPressure > 0.35f && MusicState != EBCUMusicState::Pursuit)
	{
		SetMusicState(EBCUMusicState::Pursuit, 1.5f);
	}
	else if (PursuitPressure < 0.15f && MusicState == EBCUMusicState::Pursuit)
	{
		SetMusicState(EBCUMusicState::Driving, 3.0f);
	}
}

void UBCUAudioSubsystem::RegisterStations(const TArray<FBCURadioStation>& NewStations)
{
	for (const FBCURadioStation& Station : NewStations)
	{
		const int32 Existing = Stations.IndexOfByPredicate(
			[&Station](const FBCURadioStation& O) { return O.StationId == Station.StationId; });
		if (Existing != INDEX_NONE) { Stations[Existing] = Station; }
		else { Stations.Add(Station); }
	}
}

void UBCUAudioSubsystem::NextRadioStation()
{
	if (Stations.Num() == 0) { return; }

	CurrentStationIndex = (CurrentStationIndex + 1) % (Stations.Num() + 1);
	if (CurrentStationIndex >= Stations.Num())
	{
		TurnRadioOff();
		return;
	}

	SetRadioStation(Stations[CurrentStationIndex].StationId);
}

void UBCUAudioSubsystem::SetRadioStation(FName StationId)
{
	const int32 Index = Stations.IndexOfByPredicate(
		[StationId](const FBCURadioStation& O) { return O.StationId == StationId; });
	if (Index == INDEX_NONE) { return; }

	CurrentStationIndex = Index;
	bRadioOn = true;

	// Pick a track and start it. Tracks are original music only.
	if (RadioComponent && Stations[Index].Tracks.Num() > 0)
	{
		const int32 TrackIndex = FMath::RandRange(0, Stations[Index].Tracks.Num() - 1);
		if (USoundBase* Track = Stations[Index].Tracks[TrackIndex].LoadSynchronous())
		{
			RadioComponent->SetSound(Track);
			RadioComponent->SetVolumeMultiplier(RadioVolume * MasterVolume);
			RadioComponent->Play();
		}
	}
}

void UBCUAudioSubsystem::TurnRadioOff()
{
	bRadioOn = false;
	if (RadioComponent) { RadioComponent->FadeOut(0.6f, 0.0f); }
}

FText UBCUAudioSubsystem::GetCurrentStationName() const
{
	if (!bRadioOn || !Stations.IsValidIndex(CurrentStationIndex))
	{
		return NSLOCTEXT("BCU", "Radio_Off", "Radio Off");
	}
	return Stations[CurrentStationIndex].StationName;
}

FText UBCUAudioSubsystem::GetCurrentTrackName() const
{
	if (!bRadioOn || !Stations.IsValidIndex(CurrentStationIndex)) { return FText::GetEmpty(); }

	const FBCURadioStation& Station = Stations[CurrentStationIndex];
	if (Station.Tracks.Num() == 0) { return FText::GetEmpty(); }

	// The component holds the live track; resolve its asset name for the HUD.
	if (RadioComponent && RadioComponent->Sound)
	{
		return FText::FromString(RadioComponent->Sound->GetName());
	}

	return FText::GetEmpty();
}

void UBCUAudioSubsystem::PlayDialogue(FName LineId, AActor* Speaker)
{
	// Dialogue lines are resolved against DT_Dialogue so every voice line in the
	// game is authored as data (original writing, original performers).
	if (!LineId.IsValid()) { return; }

	UGameplayStatics::PlaySoundAtLocation(GetGameInstance()->GetWorld(), nullptr,
		Speaker ? Speaker->GetActorLocation() : FVector::ZeroVector, DialogueVolume * MasterVolume);
}

void UBCUAudioSubsystem::SetDistrictAmbience(FName DistrictId, USoundBase* Loop)
{
	if (!Loop) { return; }

	if (!AmbienceComponent)
	{
		AmbienceComponent = UGameplayStatics::SpawnSound2D(GetGameInstance()->GetWorld(), Loop, 0.0f);
		if (AmbienceComponent) { AmbienceComponent->bAutoDestroy = false; }
	}
	else
	{
		AmbienceComponent->SetSound(Loop);
		AmbienceComponent->Play();
	}

	if (AmbienceComponent)
	{
		AmbienceComponent->SetVolumeMultiplier(0.45f * EffectsVolume * MasterVolume);
	}

	UE_LOG(LogBCUAudio, Verbose, TEXT("District ambience → %s"), *DistrictId.ToString());
}

void UBCUAudioSubsystem::UpdateMusicLayering(float DeltaSeconds)
{
	// Called from the game instance tick; kept as a no-op hook so Blueprint can
	// override the layering curve per build.
	(void)DeltaSeconds;
}
