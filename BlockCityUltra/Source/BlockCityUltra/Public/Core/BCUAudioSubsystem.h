// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "BCUAudioSubsystem.generated.h"

class USoundBase;
class USoundMix;
class UAudioComponent;

/** Music state driven by the wanted level, mission and time of day. */
UENUM(BlueprintType)
enum class EBCUMusicState : uint8
{
	Exploration		UMETA(DisplayName = "Exploration"),
	Driving			UMETA(DisplayName = "Driving"),
	Night			UMETA(DisplayName = "Night Cruise"),
	Tension			UMETA(DisplayName = "Tension"),
	Pursuit			UMETA(DisplayName = "Pursuit"),
	Mission			UMETA(DisplayName = "Mission"),
	Menu			UMETA(DisplayName = "Menu")
};

/** Radio stations. All original music; nothing licensed from a real artist. */
USTRUCT(BlueprintType)
struct FBCURadioStation
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Audio")
	FName StationId = NAME_None;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Audio")
	FText StationName;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Audio")
	FText Genre;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Audio")
	TArray<TSoftObjectPtr<USoundBase>> Tracks;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Audio")
	TArray<TSoftObjectPtr<USoundBase>> IdentsAndAds;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Audio")
	FLinearColor BrandColor = FLinearColor::White;
};

/**
 * Music, radio, ambience, dialogue and mix control.
 *
 * The pursuit score is a layered loop whose stems fade in with the wanted level
 * and pursuer proximity, so the music reacts instead of just restarting.
 */
UCLASS(config = Game, Blueprintable)
class BLOCKCITYULTRA_API UBCUAudioSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	UFUNCTION(BlueprintCallable, Category = "BCU|Audio|Mix")
	void SetMasterVolume(float Value);

	UFUNCTION(BlueprintCallable, Category = "BCU|Audio|Mix")
	void SetMusicVolume(float Value);

	UFUNCTION(BlueprintCallable, Category = "BCU|Audio|Mix")
	void SetEffectsVolume(float Value);

	UFUNCTION(BlueprintCallable, Category = "BCU|Audio|Mix")
	void SetDialogueVolume(float Value);

	UFUNCTION(BlueprintCallable, Category = "BCU|Audio|Mix")
	void SetRadioVolume(float Value);

	UFUNCTION(BlueprintPure, Category = "BCU|Audio|Mix")
	float GetMasterVolume() const { return MasterVolume; }

	UFUNCTION(BlueprintCallable, Category = "BCU|Audio|Music")
	void SetMusicState(EBCUMusicState State, float CrossfadeSeconds = 2.0f);

	UFUNCTION(BlueprintPure, Category = "BCU|Audio|Music")
	EBCUMusicState GetMusicState() const { return MusicState; }

	/** 0..1 pursuit pressure from UBCUWantedComponent. Fades in the pursuit stems. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Audio|Music")
	void SetPursuitPressure(float Pressure);

	UFUNCTION(BlueprintCallable, Category = "BCU|Audio|Radio")
	void RegisterStations(const TArray<FBCURadioStation>& Stations);

	UFUNCTION(BlueprintCallable, Category = "BCU|Audio|Radio")
	void NextRadioStation();

	UFUNCTION(BlueprintCallable, Category = "BCU|Audio|Radio")
	void SetRadioStation(FName StationId);

	UFUNCTION(BlueprintCallable, Category = "BCU|Audio|Radio")
	void TurnRadioOff();

	UFUNCTION(BlueprintPure, Category = "BCU|Audio|Radio")
	const TArray<FBCURadioStation>& GetStations() const { return Stations; }

	UFUNCTION(BlueprintPure, Category = "BCU|Audio|Radio")
	FText GetCurrentStationName() const;

	UFUNCTION(BlueprintPure, Category = "BCU|Audio|Radio")
	FText GetCurrentTrackName() const;

	UFUNCTION(BlueprintCallable, Category = "BCU|Audio|Dialogue")
	void PlayDialogue(FName LineId, AActor* Speaker);

	UFUNCTION(BlueprintCallable, Category = "BCU|Audio|Ambience")
	void SetDistrictAmbience(FName DistrictId, USoundBase* Loop);

protected:
	UPROPERTY(EditAnywhere, config, Category = "BCU|Audio")
	TArray<FBCURadioStation> Stations;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Audio")
	TObjectPtr<USoundMix> DefaultSoundMix;

	UPROPERTY(Transient) TObjectPtr<UAudioComponent> MusicComponent;
	UPROPERTY(Transient) TObjectPtr<UAudioComponent> RadioComponent;
	UPROPERTY(Transient) TObjectPtr<UAudioComponent> AmbienceComponent;

	EBCUMusicState MusicState = EBCUMusicState::Exploration;
	float MasterVolume = 1.0f;
	float MusicVolume = 0.75f;
	float EffectsVolume = 1.0f;
	float DialogueVolume = 1.0f;
	float RadioVolume = 0.8f;
	float PursuitPressure = 0.0f;
	int32 CurrentStationIndex = 0;
	bool bRadioOn = true;

	void ApplyMix();
	void UpdateMusicLayering(float DeltaSeconds);
};
