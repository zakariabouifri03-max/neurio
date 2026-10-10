// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Core/BCUGameMode.h"

#include "Core/BCUPlayerController.h"
#include "Player/BCUPlayerCharacter.h"
#include "Mission/BCUMissionSubsystem.h"
#include "Police/BCUPoliceSubsystem.h"
#include "Player/BCUEconomySubsystem.h"
#include "Player/BCUSaveGame.h"
#include "EngineUtils.h"
#include "GameFramework/PlayerStart.h"
#include "GameFramework/PlayerController.h"
#include "Kismet/GameplayStatics.h"
#include "Components/SphereComponent.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUGameMode, Log, All);

ABCUGameMode::ABCUGameMode()
{
	DefaultPawnClass = ABCUPlayerCharacter::StaticClass();
	PlayerControllerClass = ABCUPlayerController::StaticClass();
	GameStateClass = ABCUGameState::StaticClass();
	PlayerStateClass = ABCUPlayerState::StaticClass();
	HUDClass = nullptr;                    // UMG only — no legacy AHUD.
	bUseSeamlessTravel = false;            // World Partition, not travel.
	SpectatorClass = nullptr;
	ReplaySpectatorPlayerControllerClass = ABCUPlayerController::StaticClass();

	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickInterval = 0.25f; // cheap: only autosave / difficulty pulse
	PrimaryActorTick.bStartWithTickEnabled = true;
}

void ABCUGameMode::InitGame(const FString& MapName, const FString& Options, FString& ErrorMessage)
{
	Super::InitGame(MapName, Options, ErrorMessage);

	if (UGameplayStatics::HasOption(OptionsString, TEXT("Difficulty")))
	{
		DifficultyLevel = FMath::Clamp(
			FCString::Atoi(*UGameplayStatics::ParseOption(OptionsString, TEXT("Difficulty"))), 0, 3);
	}

	UE_LOG(LogBCUGameMode, Log, TEXT("InitGame map=%s difficulty=%d"), *MapName, DifficultyLevel);
}

void ABCUGameMode::BeginPlay()
{
	Super::BeginPlay();

	UWorld* World = GetWorld();
	if (!World)
	{
		return;
	}

	MissionSubsystem = World->GetSubsystem<UBCUMissionSubsystem>();
	EconomySubsystem = World->GetSubsystem<UBCUEconomySubsystem>();
	PoliceSubsystem = World->GetSubsystem<UBCUPoliceSubsystem>();
}

void ABCUGameMode::StartPlay()
{
	Super::StartPlay();

	// Difficulty is a session-wide multiplier; push it once into the subsystems
	// that need it so they never have to reach back into the game mode.
	if (PoliceSubsystem)
	{
		PoliceSubsystem->SetAggressionMultiplier(GetPoliceAggressionMultiplier());
	}

	if (MissionSubsystem)
	{
		MissionSubsystem->SetRewardMultiplier(GetRewardMultiplier());
	}

	UE_LOG(LogBCUGameMode, Log, TEXT("BLOCK CITY ULTRA session started (reward x%.2f, police x%.2f)"),
		GetRewardMultiplier(), GetPoliceAggressionMultiplier());
}

void ABCUGameMode::PostLogin(APlayerController* NewPlayer)
{
	Super::PostLogin(NewPlayer);

	if (const ABCUPlayerController* BCUPC = Cast<ABCUPlayerController>(NewPlayer))
	{
		// Restore the persistent profile (money, garage, owned property,
		// completed missions) before the player can act on the world.
		if (UBCUSaveGameSystem* SaveSubsystem =
				GetGameInstance() ? GetGameInstance()->GetSubsystem<UBCUSaveGameSystem>() : nullptr)
		{
			SaveSubsystem->ApplyToPlayer(BCUPC);
		}
	}
}

void ABCUGameMode::Logout(AController* Exiting)
{
	if (const ABCUPlayerController* BCUPC = Cast<ABCUPlayerController>(Exiting))
	{
		if (UBCUSaveGameSystem* SaveSubsystem =
				GetGameInstance() ? GetGameInstance()->GetSubsystem<UBCUSaveGameSystem>() : nullptr)
		{
			SaveSubsystem->CaptureFromPlayer(BCUPC);
		}
	}

	Super::Logout(Exiting);
}

AActor* ABCUGameMode::ChoosePlayerStart_Implementation(AController* Player)
{
	// Prefer a tagged BCU spawn point over a raw PlayerStart so the player can
	// be dropped into a specific district (garage, safehouse, mission start).
	FName WantedTag = DefaultSpawnTag;
	if (const ABCUPlayerController* BCUPC = Cast<ABCUPlayerController>(Player))
	{
		if (BCUPC->GetPendingSpawnTag().IsValid())
		{
			WantedTag = BCUPC->GetPendingSpawnTag();
		}
	}

	FRotator SpawnRotation = FRotator::ZeroRotator;
	const FVector SpawnLocation = FindSpawnLocationForTag(WantedTag, SpawnRotation);
	if (!SpawnLocation.IsNearlyZero())
	{
		return nullptr; // TeleportPlayerToTag handles placement after possess.
	}

	return Super::ChoosePlayerStart_Implementation(Player);
}

UClass* ABCUGameMode::GetDefaultPawnClassForController_Implementation(AController* InController)
{
	return DefaultPawnClass;
}

FVector ABCUGameMode::FindSpawnLocationForTag(FName Tag, FRotator& OutRotation) const
{
	UWorld* World = GetWorld();
	if (!World || !Tag.IsValid())
	{
		return FVector::ZeroVector;
	}

	FVector Best = FVector::ZeroVector;
	float BestScore = TNumericLimits<float>::Max();

	for (TActorIterator<ABCUSpawnPoint> It(World); It; ++It)
	{
		ABCUSpawnPoint* Spawn = *It;
		if (!Spawn || !Spawn->MatchesTag(Tag))
		{
			continue;
		}

		const float Score = Spawn->GetSpawnPriority();
		if (Score < BestScore)
		{
			BestScore = Score;
			Best = Spawn->GetActorLocation();
			OutRotation = Spawn->GetActorRotation();
		}
	}

	return Best;
}

bool ABCUGameMode::TeleportPlayerToTag(FName SpawnTag, bool bKeepVehicle)
{
	ABCUPlayerController* PC = Cast<ABCUPlayerController>(
		UGameplayStatics::GetPlayerController(this, 0));
	if (!PC)
	{
		return false;
	}

	FRotator SpawnRotation = FRotator::ZeroRotator;
	const FVector SpawnLocation = FindSpawnLocationForTag(SpawnTag, SpawnRotation);
	if (SpawnLocation.IsNearlyZero())
	{
		UE_LOG(LogBCUGameMode, Warning, TEXT("No spawn point tagged '%s'"), *SpawnTag.ToString());
		return false;
	}

	if (!bKeepVehicle)
	{
		PC->ExitVehicleIfDriving(/*bForce=*/true);
	}

	return PC->TeleportToLocation(SpawnLocation, SpawnRotation);
}

void ABCUGameMode::RespawnPlayer(bool bWasArrested)
{
	if (bRespawnInProgress)
	{
		return;
	}

	ABCUPlayerController* PC = Cast<ABCUPlayerController>(
		UGameplayStatics::GetPlayerController(this, 0));
	if (!PC)
	{
		return;
	}

	bRespawnInProgress = true;

	// 1) Apply the penalty through the economy subsystem so it is one source
	//    of truth for money and gets a UI toast + save-game dirty flag.
	const int32 Penalty = bWasArrested ? CashLostOnArrest : CashLostOnDeath;
	if (EconomySubsystem)
	{
		EconomySubsystem->SpendCash(Penalty, bWasArrested
			? EBCUCashReason::ArrestFine
			: EBCUCashReason::MedicalBill);
	}

	// 2) Clear the wanted state (arrest) or leave a "hospital" flag (death).
	if (PoliceSubsystem && bWasArrested)
	{
		PoliceSubsystem->ClearWantedLevel(/*bArrested=*/true);
	}

	// 3) Respawn at the right facility, then fade back in.
	const FName RespawnTag = bWasArrested
		? FName(TEXT("BCU.Spawn.PoliceStation"))
		: FName(TEXT("BCU.Spawn.Hospital"));

	FTimerHandle FadeHandle;
	GetWorldTimerManager().SetTimer(FadeHandle, FTimerDelegate::CreateWeakLambda(this, [this, PC, RespawnTag]()
	{
		if (!PC)
		{
			bRespawnInProgress = false;
			return;
		}

		PC->ReviveAndUnpossessVehicle();
		TeleportPlayerToTag(RespawnTag, /*bKeepVehicle=*/false);
		bRespawnInProgress = false;
	}), RespawnFadeSeconds * 0.5f, /*bLoop=*/false);

	PC->PlayRespawnFade(RespawnFadeSeconds, bWasArrested);
}

float ABCUGameMode::GetRewardMultiplier() const
{
	static const float Table[4] = { 1.35f, 1.0f, 0.8f, 0.65f };
	return Table[FMath::Clamp(DifficultyLevel, 0, 3)];
}

float ABCUGameMode::GetPoliceAggressionMultiplier() const
{
	static const float Table[4] = { 0.6f, 1.0f, 1.45f, 2.0f };
	return Table[FMath::Clamp(DifficultyLevel, 0, 3)];
}
