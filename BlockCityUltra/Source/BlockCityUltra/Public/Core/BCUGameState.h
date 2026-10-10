// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/GameStateBase.h"
#include "BCUGameState.generated.h"

class UBCUTimeOfDaySystem;
class UBCUWeatherSystem;

UENUM(BlueprintType)
enum class EBCUWorldRegion : uint8
{
	None			UMETA(DisplayName = "Nowhere"),
	Downtown		UMETA(DisplayName = "Downtown — Foundry Heights"),
	Residential		UMETA(DisplayName = "Residential — Rowan Park"),
	Luxury			UMETA(DisplayName = "Luxury — Marbella Row"),
	Industrial		UMETA(DisplayName = "Industrial — Ironside Docks"),
	Airport			UMETA(DisplayName = "Airport — Calder International"),
	Highway			UMETA(DisplayName = "Highways & Tunnels"),
	Countryside		UMETA(DisplayName = "Countryside — Ashfall Basin"),
	Commercial		UMETA(DisplayName = "Commercial — Neon Mile"),
	Wilderness		UMETA(DisplayName = "Wilderness — Granite Ridge")
};

/**
 * Replicated world-level state that every subsystem reads instead of talking
 * to each other directly: time of day, weather, the district the player is
 * currently inside, and the World Partition streaming warm-up status.
 */
UCLASS(Blueprintable)
class BLOCKCITYULTRA_API ABCUGameState : public AGameStateBase
{
	GENERATED_BODY()

public:
	ABCUGameState();

	/** Normalised 0..1 time of day (0 = midnight). Replicated. */
	UPROPERTY(BlueprintReadOnly, ReplicatedUsing = OnRep_TimeOfDay, Category = "BCU|State")
	float TimeOfDay = 8.5f / 24.0f;

	/** Current weather intensity 0..1 (rain/storm amount). Replicated. */
	UPROPERTY(BlueprintReadOnly, ReplicatedUsing = OnRep_Weather, Category = "BCU|State")
	float WeatherIntensity = 0.0f;

	/** Surface wetness 0..1 — drives puddles and road reflections. */
	UPROPERTY(BlueprintReadOnly, Replicated, Category = "BCU|State")
	float SurfaceWetness = 0.0f;

	/** District the local player is currently inside. */
	UPROPERTY(BlueprintReadOnly, ReplicatedUsing = OnRep_CurrentDistrict, Category = "BCU|State")
	EBCUWorldRegion CurrentDistrict = EBCUWorldRegion::None;

	/** True once the initial World Partition cell set has finished loading. */
	UFUNCTION(BlueprintPure, Category = "BCU|State|Streaming")
	bool IsInitialStreamingComplete() const { return bInitialStreamingComplete; }

	/** Number of city cells currently resident in memory. */
	UFUNCTION(BlueprintPure, Category = "BCU|State|Streaming")
	int32 GetResidentCellCount() const { return ResidentCellCount; }

	UFUNCTION(BlueprintCallable, Category = "BCU|State|Streaming")
	void SetResidentCellCount(int32 NewCount);

	UFUNCTION(BlueprintCallable, Category = "BCU|State|Streaming")
	void MarkInitialStreamingComplete();

	/** True between 0.22 and 0.30 / 0.72 and 0.80 of the day (streetlights on). */
	UFUNCTION(BlueprintPure, Category = "BCU|State")
	bool IsNight() const;

	/** Convenience for shaders/UI: 0 = night, 1 = full day. */
	UFUNCTION(BlueprintPure, Category = "BCU|State")
	float GetDaylightFactor() const;

protected:
	virtual void GetLifetimeReplicatedProps(TArray<FLifetimeProperty>& OutLifetimeProps) const override;

	UFUNCTION()
	void OnRep_TimeOfDay();

	UFUNCTION()
	void OnRep_Weather();

	UFUNCTION()
	void OnRep_CurrentDistrict();

	UPROPERTY(BlueprintReadOnly, Category = "BCU|State|Streaming")
	bool bInitialStreamingComplete = false;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|State|Streaming")
	int32 ResidentCellCount = 0;

	/** Sunrise/sunset windows used by IsNight (fraction of day). */
	UPROPERTY(EditAnywhere, config, Category = "BCU|State")
	float NightStartFraction = 0.79f;

	UPROPERTY(EditAnywhere, config, Category = "BCU|State")
	float NightEndFraction = 0.24f;
};
