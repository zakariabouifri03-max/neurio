// Copyright GameProject. All rights reserved. Original content only.

#include "Player/OpenWorldPlayerState.h"

#include "Core/GameProjectLog.h"
#include "Engine/World.h"
#include "Net/UnrealNetwork.h"
#include "Save/GameProjectSaveSubsystem.h"
#include "Save/SaveGameProject.h"

AOpenWorldPlayerState::AOpenWorldPlayerState()
{
	PrimaryActorTick.bCanEverTick = false;
	bReplicates = true;
}

void AOpenWorldPlayerState::BeginPlay()
{
	Super::BeginPlay();

	// Self-registration is what keeps the save subsystem ignorant of player state.
	if (UGameProjectSaveSubsystem* SaveSubsystem = FindSaveSubsystem())
	{
		SaveSubsystem->RegisterContributor(this);
	}
}

void AOpenWorldPlayerState::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	if (UGameProjectSaveSubsystem* SaveSubsystem = FindSaveSubsystem())
	{
		SaveSubsystem->UnregisterContributor(this);
	}

	Super::EndPlay(EndPlayReason);
}

UGameProjectSaveSubsystem* AOpenWorldPlayerState::FindSaveSubsystem() const
{
	const UWorld* World = GetWorld();
	const UGameInstance* GameInstance = World ? World->GetGameInstance() : nullptr;
	return GameInstance ? GameInstance->GetSubsystem<UGameProjectSaveSubsystem>() : nullptr;
}

void AOpenWorldPlayerState::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);

	DOREPLIFETIME(AOpenWorldPlayerState, Money);
	DOREPLIFETIME(AOpenWorldPlayerState, WantedLevel);
}

void AOpenWorldPlayerState::WriteSaveData_Implementation(USaveGameProject& SaveGame) const
{
	SaveGame.Money = Money;
	SaveGame.WantedLevel = WantedLevel;
}

void AOpenWorldPlayerState::ReadSaveData_Implementation(const USaveGameProject& SaveGame)
{
	Money = SaveGame.Money;
	WantedLevel = FMath::Clamp(SaveGame.WantedLevel, 0, MaxWantedLevel);

	LastBroadcastMoney = Money;
	LastBroadcastWantedLevel = WantedLevel;

	UE_LOG(LogPlayer, Log, TEXT("PlayerState restored from save: money=%d wanted=%d"), Money, WantedLevel);
}

bool AOpenWorldPlayerState::TrySpendMoney(int32 Amount)
{
	if (Amount <= 0)
	{
		return false;
	}
	if (Money < Amount)
	{
		return false;
	}

	SetMoney(Money - Amount);
	return true;
}

void AOpenWorldPlayerState::AddMoney(int32 Amount)
{
	SetMoney(Money + Amount);
}

void AOpenWorldPlayerState::SetMoney(int32 NewMoney)
{
	const int32 Clamped = FMath::Max(0, NewMoney);
	if (Clamped == Money)
	{
		return;
	}

	const int32 Previous = Money;
	Money = Clamped;

	if (HasAuthority())
	{
		// Broadcast locally as well as through OnRep: on a listen server the
		// authority never receives its own replication callback.
		OnMoneyChanged.Broadcast(Previous, Money);
		LastBroadcastMoney = Money;
	}
}

void AOpenWorldPlayerState::SetWantedLevel(int32 NewWantedLevel)
{
	const int32 Clamped = FMath::Clamp(NewWantedLevel, 0, MaxWantedLevel);
	if (Clamped == WantedLevel)
	{
		return;
	}

	const int32 Previous = WantedLevel;
	WantedLevel = Clamped;

	if (HasAuthority())
	{
		OnWantedLevelChanged.Broadcast(Previous, WantedLevel);
		LastBroadcastWantedLevel = WantedLevel;
	}
}

void AOpenWorldPlayerState::AddWantedLevel(int32 Delta)
{
	SetWantedLevel(WantedLevel + Delta);
}

void AOpenWorldPlayerState::OnRep_Money()
{
	if (Money != LastBroadcastMoney)
	{
		const int32 Previous = LastBroadcastMoney;
		LastBroadcastMoney = Money;
		OnMoneyChanged.Broadcast(Previous, Money);
	}
}

void AOpenWorldPlayerState::OnRep_WantedLevel()
{
	if (WantedLevel != LastBroadcastWantedLevel)
	{
		const int32 Previous = LastBroadcastWantedLevel;
		LastBroadcastWantedLevel = WantedLevel;
		OnWantedLevelChanged.Broadcast(Previous, WantedLevel);
	}
}
