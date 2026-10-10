// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/HUD.h"
#include "BCUPlayerHUD.generated.h"

class UUserWidget;
class UCanvasRenderTarget2D;
class UBCUMissionSubsystem;
class UBCUPoliceSubsystem;

/**
 * Root of the in-game UI. C++ owns the minimap render target and the data
 * plumbing; every visual (bars, prompts, map screen) is a UMG Blueprint that
 * binds to the properties below, so UI iteration never needs a recompile.
 */
UCLASS(Blueprintable)
class BLOCKCITYULTRA_API ABCUPlayerHUD : public AHUD
{
	GENERATED_BODY()

public:
	ABCUPlayerHUD();

	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;

	/** Widgets created in Blueprint and registered back here. */
	UFUNCTION(BlueprintCallable, Category = "BCU|HUD")
	void RegisterWidget(FName WidgetId, UUserWidget* Widget);

	UFUNCTION(BlueprintCallable, Category = "BCU|HUD")
	void ToggleWidget(FName WidgetId, bool bForceState = false, bool bOpen = true);

	UFUNCTION(BlueprintPure, Category = "BCU|HUD")
	UUserWidget* GetWidget(FName WidgetId) const;

	// ── Minimap ─────────────────────────────────────────────────────────────
	/** The minimap draws the city, roads, blips and the GPS route into this
	 *  target, which the UMG minimap widget displays as a brush. */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|HUD|Minimap")
	TObjectPtr<UCanvasRenderTarget2D> MinimapTarget;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|HUD|Minimap")
	int32 MinimapResolution = 512;

	/** World extent covered by the minimap, in cm. Zoomed in while driving fast. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|HUD|Minimap")
	float MinimapWorldExtentCm = 90000.0f;

	/** Redraws the minimap. Called at ~20 Hz, not every frame. */
	UFUNCTION(BlueprintCallable, Category = "BCU|HUD|Minimap")
	void RedrawMinimap();

	/** Blips the UMG minimap draws: missions, police, garages, properties. */
	UFUNCTION(BlueprintPure, Category = "BCU|HUD|Minimap")
	TArray<FVector2D> GetMinimapBlips() const;

	// ── GPS route ───────────────────────────────────────────────────────────
	UFUNCTION(BlueprintPure, Category = "BCU|HUD|GPS")
	TArray<FVector2D> GetGPSScreenRoute() const;

	UFUNCTION(BlueprintPure, Category = "BCU|HUD|GPS")
	bool HasActiveRoute() const { return GPSRoute.Num() > 0; }

	UFUNCTION(BlueprintCallable, Category = "BCU|HUD|GPS")
	void RefreshGPSRoute();

	UFUNCTION(BlueprintCallable, Category = "BCU|HUD|GPS")
	void ClearGPSRoute();

	/** Distance to the next waypoint in metres, for the HUD readout. */
	UFUNCTION(BlueprintPure, Category = "BCU|HUD|GPS")
	float GetDistanceToWaypointM() const;

	/** Turn instruction: -1 left, 0 straight, +1 right. */
	UFUNCTION(BlueprintPure, Category = "BCU|HUD|GPS")
	int32 GetNextTurnDirection() const;

	// ── Live readouts bound by the UMG widgets ──────────────────────────────
	UFUNCTION(BlueprintPure, Category = "BCU|HUD|Readouts")
	float GetHealthFraction() const;

	UFUNCTION(BlueprintPure, Category = "BCU|HUD|Readouts")
	int32 GetCash() const;

	UFUNCTION(BlueprintPure, Category = "BCU|HUD|Readouts")
	int32 GetWantedLevel() const;

	UFUNCTION(BlueprintPure, Category = "BCU|HUD|Readouts")
	FText GetClockText() const;

	UFUNCTION(BlueprintPure, Category = "BCU|HUD|Readouts")
	FText GetDistrictText() const;

	UFUNCTION(BlueprintPure, Category = "BCU|HUD|Readouts")
	FText GetCurrentObjectiveText() const;

	UFUNCTION(BlueprintPure, Category = "BCU|HUD|Readouts")
	float GetSpeedKmh() const;

	UFUNCTION(BlueprintPure, Category = "BCU|HUD|Readouts")
	int32 GetCurrentGear() const;

	UFUNCTION(BlueprintPure, Category = "BCU|HUD|Readouts")
	FText GetRadioStationText() const;

	// ── Transient messages ──────────────────────────────────────────────────
	UFUNCTION(BlueprintCallable, Category = "BCU|HUD|Messages")
	void ShowToast(const FText& Message, float DurationSeconds = 3.5f);

	UFUNCTION(BlueprintCallable, Category = "BCU|HUD|Messages")
	void PlayRespawnFade(float Duration, bool bWasArrested);

protected:
	UPROPERTY(Transient)
	TMap<FName, TObjectPtr<UUserWidget>> Widgets;

	UPROPERTY(Transient)
	TArray<FVector> GPSRoute;

	float MinimapTimer = 0.0f;
	float GPSTimer = 0.0f;

	void BindSubsystems();
	void DrawMinimapBase(UCanvas* Canvas);
	void DrawMinimapBlips(UCanvas* Canvas);
	FVector2D WorldToMinimapUV(const FVector& WorldLocation) const;
};
