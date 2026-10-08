// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameStateBase.h"
#include "Core/GameProjectTypes.h"
#include "GameProjectGameState.generated.h"

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnGameProjectWorldTimeChanged, double, TimeOfDaySeconds, int32, DayIndex);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnGameProjectWorldFlagChanged, FGameplayTag, FlagTag, int32, NewValue);

/**
 * Replicated, world-scoped state that every client needs to agree on.
 *
 * Phase 01 keeps two primitives here and nothing else:
 *  - a world clock (paused by default; day/night is a later phase), and
 *  - a tagged integer flag bag for global world state.
 *
 * The flag bag is the important piece for scalability: missions, story beats,
 * "bridge is open", "shop robbed" etc. can all be expressed as
 * GameplayTag -> int without ever editing this class. That is what keeps the
 * GameMode/GameState pair from turning into the project's junk drawer.
 */
UCLASS()
class PROJECTCORE_API AGameProjectGameState : public AGameStateBase
{
	GENERATED_BODY()

public:
	AGameProjectGameState();

	//~ Begin AActor
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;
	//~ End AActor

	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;

	// ------------------------------------------------------------- world clock
	/** Seconds since midnight, 0..86400. Replicated. */
	UFUNCTION(BlueprintPure, Category = "GameProject|WorldTime")
	double GetTimeOfDaySeconds() const { return TimeOfDaySeconds; }

	/** 0-based day counter. Replicated. */
	UFUNCTION(BlueprintPure, Category = "GameProject|WorldTime")
	int32 GetDayIndex() const { return DayIndex; }

	UFUNCTION(BlueprintPure, Category = "GameProject|WorldTime")
	FString GetFormattedTimeOfDay() const;

	/** Normalised 0..1 progress through the day - handy for sun angle later. */
	UFUNCTION(BlueprintPure, Category = "GameProject|WorldTime")
	float GetDayPhase() const;

	UFUNCTION(BlueprintCallable, Category = "GameProject|WorldTime")
	void SetTimeOfDaySeconds(double NewTimeOfDaySeconds);

	UPROPERTY(BlueprintAssignable, Category = "GameProject|WorldTime")
	FOnGameProjectWorldTimeChanged OnWorldTimeChanged;

	// ------------------------------------------------------------- world flags
	UFUNCTION(BlueprintPure, Category = "GameProject|WorldState")
	int32 GetWorldFlag(FGameplayTag FlagTag) const;

	UFUNCTION(BlueprintCallable, Category = "GameProject|WorldState")
	void SetWorldFlag(FGameplayTag FlagTag, int32 NewValue);

	UFUNCTION(BlueprintCallable, Category = "GameProject|WorldState")
	void AddToWorldFlag(FGameplayTag FlagTag, int32 Delta);

	UFUNCTION(BlueprintPure, Category = "GameProject|WorldState")
	bool HasWorldFlag(FGameplayTag FlagTag) const;

	UPROPERTY(BlueprintAssignable, Category = "GameProject|WorldState")
	FOnGameProjectWorldFlagChanged OnWorldFlagChanged;

	/** Snapshot of all flags, used by the save system. */
	UFUNCTION(BlueprintPure, Category = "GameProject|WorldState")
	const TArray<FGameProjectWorldFlag>& GetWorldFlags() const { return WorldFlags; }

	UFUNCTION(BlueprintCallable, Category = "GameProject|WorldState")
	void SetWorldFlags(const TArray<FGameProjectWorldFlag>& NewFlags);

protected:
	UFUNCTION()
	void OnRep_TimeOfDaySeconds();

	UFUNCTION()
	void OnRep_WorldFlags();

	/** Advances the clock only when the project asks for it. */
	void AdvanceWorldTime(float DeltaSeconds);

	UPROPERTY(ReplicatedUsing = OnRep_TimeOfDaySeconds, BlueprintReadOnly, Category = "GameProject|WorldTime")
	double TimeOfDaySeconds = 28800.0;

	UPROPERTY(Replicated, BlueprintReadOnly, Category = "GameProject|WorldTime")
	int32 DayIndex = 0;

	UPROPERTY(ReplicatedUsing = OnRep_WorldFlags, BlueprintReadOnly, Category = "GameProject|WorldState")
	TArray<FGameProjectWorldFlag> WorldFlags;

	int32 FindFlagIndex(FGameplayTag FlagTag) const;
};
