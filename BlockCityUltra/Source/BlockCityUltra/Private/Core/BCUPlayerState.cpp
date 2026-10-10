// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Core/BCUPlayerState.h"

#include "Net/UnrealNetwork.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUPlayerState, Log, All);

ABCUPlayerState::ABCUPlayerState()
{
	PrimaryActorTick.bCanEverTick = false;
	bReplicates = true;
}

void ABCUPlayerState::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);

	DOREPLIFETIME(ABCUPlayerState, Cash);
	DOREPLIFETIME(ABCUPlayerState, Reputation);
	DOREPLIFETIME(ABCUPlayerState, WantedLevel);
	DOREPLIFETIME(ABCUPlayerState, CurrentDistrict);
	DOREPLIFETIME(ABCUPlayerState, ActiveVehicleId);
	DOREPLIFETIME(ABCUPlayerState, MissionsCompleted);
	DOREPLIFETIME(ABCUPlayerState, TotalDistanceDrivenKm);
}

void ABCUPlayerState::AddCash(int32 Amount, EBCUCashReason Reason)
{
	if (Amount <= 0)
	{
		return;
	}

	Cash = FMath::Clamp(Cash + Amount, 0, TNumericLimits<int32>::Max());
	OnRep_Cash();

	UE_LOG(LogBCUPlayerState, Log, TEXT("+$%d (%s) → $%d"), Amount,
		*UEnum::GetValueAsString(Reason).RightChop(16), Cash);
}

bool ABCUPlayerState::SpendCash(int32 Amount, EBCUCashReason Reason)
{
	if (Amount < 0 || Cash < Amount)
	{
		return false;
	}

	Cash -= Amount;
	OnRep_Cash();

	UE_LOG(LogBCUPlayerState, Log, TEXT("-$%d (%s) → $%d"), Amount,
		*UEnum::GetValueAsString(Reason).RightChop(16), Cash);
	return true;
}

void ABCUPlayerState::AddReputation(int32 Amount)
{
	Reputation = FMath::Max(0, Reputation + Amount);
	OnRep_Reputation();
}

void ABCUPlayerState::SetWantedLevel(int32 NewLevel)
{
	NewLevel = FMath::Clamp(NewLevel, 0, 6);
	if (NewLevel == WantedLevel)
	{
		return;
	}

	WantedLevel = NewLevel;
	OnRep_WantedLevel();
}

void ABCUPlayerState::NoteMissionCompleted()
{
	MissionsCompleted++;
}

void ABCUPlayerState::NoteDistanceDriven(float Kilometres)
{
	TotalDistanceDrivenKm += FMath::Max(0.0f, Kilometres);
}

FText ABCUPlayerState::GetFormattedCash() const
{
	return FText::AsNumber(Cash);
}

void ABCUPlayerState::OnRep_Cash()
{
	// HUD listens to the player state directly; nothing to push here.
}

void ABCUPlayerState::OnRep_Reputation()
{
}

void ABCUPlayerState::OnRep_WantedLevel()
{
	UE_LOG(LogBCUPlayerState, Verbose, TEXT("Wanted level now %d"), WantedLevel);
}
