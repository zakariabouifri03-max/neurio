// Copyright GameProject. All rights reserved. Original content only.

#include "Core/GameProjectGameState.h"

#include "Core/GameProjectBlueprintLibrary.h"
#include "Core/GameProjectLog.h"
#include "Core/GameProjectSettings.h"
#include "Net/UnrealNetwork.h"

AGameProjectGameState::AGameProjectGameState()
{
	PrimaryActorTick.bCanEverTick = true;
	// The clock is paused in Phase 01, so we never actually tick. Enabling it is
	// driven from BeginPlay by UGameProjectSettings::bWorldTimeAdvances.
	PrimaryActorTick.bStartWithTickEnabled = false;
	PrimaryActorTick.TickInterval = 0.0f;
	bReplicates = true;
}

void AGameProjectGameState::BeginPlay()
{
	Super::BeginPlay();

	const UGameProjectSettings& Settings = UGameProjectSettings::Get();
	TimeOfDaySeconds = Settings.WorldTimeStartSeconds;
	DayIndex = 0;

	const bool bAdvance = Settings.bWorldTimeAdvances && HasAuthority();
	SetActorTickEnabled(bAdvance);

	UE_LOG(LogWorld, Log, TEXT("GameState BeginPlay: time=%.0fs day=%d advancing=%s"),
		TimeOfDaySeconds, DayIndex, bAdvance ? TEXT("true") : TEXT("false"));
}

void AGameProjectGameState::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	AdvanceWorldTime(DeltaSeconds);
}

void AGameProjectGameState::AdvanceWorldTime(float DeltaSeconds)
{
	const UGameProjectSettings& Settings = UGameProjectSettings::Get();
	const double DayLength = FMath::Max(Settings.WorldTimeDayLengthSeconds, 60.0);

	// A "day" of DayLength real seconds is mapped onto 86400 in-game seconds.
	const double InGameSecondsPerRealSecond = 86400.0 / DayLength;
	TimeOfDaySeconds += static_cast<double>(DeltaSeconds) * InGameSecondsPerRealSecond;

	if (TimeOfDaySeconds >= 86400.0)
	{
		TimeOfDaySeconds = FMath::Fmod(TimeOfDaySeconds, 86400.0);
		++DayIndex;
	}

	OnWorldTimeChanged.Broadcast(TimeOfDaySeconds, DayIndex);
}

void AGameProjectGameState::GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const
{
	Super::GetLifetimeReplicatedProps(OutLifetimeProps);

	DOREPLIFETIME(AGameProjectGameState, TimeOfDaySeconds);
	DOREPLIFETIME(AGameProjectGameState, DayIndex);
	DOREPLIFETIME(AGameProjectGameState, WorldFlags);
}

void AGameProjectGameState::OnRep_TimeOfDaySeconds()
{
	OnWorldTimeChanged.Broadcast(TimeOfDaySeconds, DayIndex);
}

void AGameProjectGameState::OnRep_WorldFlags()
{
	// Per-flag delegates are fired from SetWorldFlag on the authority; clients get a
	// coarse "something changed" so late phases can diff if they need to.
	for (const FGameProjectWorldFlag& Flag : WorldFlags)
	{
		OnWorldFlagChanged.Broadcast(Flag.Tag, Flag.Value);
	}
}

FString AGameProjectGameState::GetFormattedTimeOfDay() const
{
	return UGameProjectBlueprintLibrary::FormatTimeOfDay(TimeOfDaySeconds);
}

float AGameProjectGameState::GetDayPhase() const
{
	return static_cast<float>(TimeOfDaySeconds / 86400.0);
}

void AGameProjectGameState::SetTimeOfDaySeconds(double NewTimeOfDaySeconds)
{
	TimeOfDaySeconds = FMath::Clamp(NewTimeOfDaySeconds, 0.0, 86399.999);
	OnWorldTimeChanged.Broadcast(TimeOfDaySeconds, DayIndex);
}

int32 AGameProjectGameState::FindFlagIndex(FGameplayTag FlagTag) const
{
	return WorldFlags.IndexOfByPredicate([FlagTag](const FGameProjectWorldFlag& Candidate)
	{
		return Candidate.Tag == FlagTag;
	});
}

int32 AGameProjectGameState::GetWorldFlag(FGameplayTag FlagTag) const
{
	const int32 Index = FindFlagIndex(FlagTag);
	return Index == INDEX_NONE ? 0 : WorldFlags[Index].Value;
}

bool AGameProjectGameState::HasWorldFlag(FGameplayTag FlagTag) const
{
	return FindFlagIndex(FlagTag) != INDEX_NONE;
}

void AGameProjectGameState::SetWorldFlag(FGameplayTag FlagTag, int32 NewValue)
{
	if (!FlagTag.IsValid())
	{
		return;
	}

	const int32 Index = FindFlagIndex(FlagTag);
	if (Index != INDEX_NONE)
	{
		if (WorldFlags[Index].Value == NewValue)
		{
			return; // No change, no broadcast, no replication traffic.
		}
		WorldFlags[Index].Value = NewValue;
	}
	else
	{
		FGameProjectWorldFlag& NewFlag = WorldFlags.AddDefaulted_GetRef();
		NewFlag.Tag = FlagTag;
		NewFlag.Value = NewValue;
	}

	UE_LOG(LogWorld, Verbose, TEXT("WorldFlag '%s' -> %d"), *FlagTag.ToString(), NewValue);
	OnWorldFlagChanged.Broadcast(FlagTag, NewValue);
}

void AGameProjectGameState::AddToWorldFlag(FGameplayTag FlagTag, int32 Delta)
{
	SetWorldFlag(FlagTag, GetWorldFlag(FlagTag) + Delta);
}

void AGameProjectGameState::SetWorldFlags(const TArray<FGameProjectWorldFlag>& NewFlags)
{
	WorldFlags = NewFlags;
	for (const FGameProjectWorldFlag& Flag : WorldFlags)
	{
		OnWorldFlagChanged.Broadcast(Flag.Tag, Flag.Value);
	}
}
