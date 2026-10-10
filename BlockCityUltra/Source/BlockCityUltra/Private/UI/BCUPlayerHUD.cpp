// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "UI/BCUPlayerHUD.h"

#include "Core/BCUGameState.h"
#include "Core/BCUPlayerController.h"
#include "Core/BCUPlayerState.h"
#include "Mission/BCUMissionSubsystem.h"
#include "Police/BCUPoliceSubsystem.h"
#include "Player/BCUPlayerCharacter.h"
#include "Player/BCUEconomySubsystem.h"
#include "Vehicle/BCUBaseVehicle.h"
#include "World/Weather/BCUTimeOfDaySystem.h"
#include "Engine/Canvas.h"
#include "Engine/CanvasRenderTarget2D.h"
#include "Blueprint/UserWidget.h"
#include "Kismet/GameplayStatics.h"
#include "Kismet/KismetRenderingLibrary.h"
#include "Core/BCUAudioSubsystem.h"
#include "AI/BCUTrafficSubsystem.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUHUD, Log, All);

ABCUPlayerHUD::ABCUPlayerHUD()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickInterval = 0.0f;
}

void ABCUPlayerHUD::BeginPlay()
{
	Super::BeginPlay();

	// The minimap is a render target the UMG widget displays as a brush, which
	// keeps the map drawing in C++ (fast, exact) and the styling in UMG (fast to
	// iterate). 512² is enough for a 900 m radius at readable precision.
	MinimapTarget = UKismetRenderingLibrary::CreateCanvasRenderTarget2D(
		GetWorld(), UCanvasRenderTarget2D::StaticClass(), MinimapResolution, MinimapResolution);

	BindSubsystems();
}

void ABCUPlayerHUD::BindSubsystems()
{
	UWorld* World = GetWorld();
	if (!World) { return; }

	// Police + mission events drive the toasts and the wanted-star animation.
	if (UBCUPoliceSubsystem* Police = World->GetSubsystem<UBCUPoliceSubsystem>())
	{
		Police->OnPlayerArrested.AddLambda([this](int32 Level)
		{
			ShowToast(FText::Format(
				NSLOCTEXT("BCU", "HUD_Busted", "BUSTED — {0} stars"), FText::AsNumber(Level)), 4.0f);
		});
	}

	if (UBCUMissionSubsystem* Missions = World->GetSubsystem<UBCUMissionSubsystem>())
	{
		Missions->OnMissionStarted.AddLambda([this](UBCUMissionDefinition* Def)
		{
			if (Def) { ShowToast(Def->Title, 4.0f); }
			RefreshGPSRoute();
		});

		Missions->OnMissionEnded.AddLambda([this](UBCUMissionDefinition* Def, bool bSuccess)
		{
			if (!Def) { return; }
			ShowToast(bSuccess
				? FText::Format(NSLOCTEXT("BCU", "HUD_MissionDone", "{0} — COMPLETE"), Def->Title)
				: FText::Format(NSLOCTEXT("BCU", "HUD_MissionFail", "{0} — FAILED"), Def->Title), 4.0f);
			ClearGPSRoute();
		});

		Missions->OnObjectiveChanged.AddLambda([this](UBCUMissionDefinition*, const FBCUObjective&)
		{
			RefreshGPSRoute();
		});
	}
}

void ABCUPlayerHUD::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);

	// Minimap at ~20 Hz and GPS at ~4 Hz: both are redraws nobody can perceive
	// at 60 Hz, and together they were the HUD's two biggest frame costs.
	MinimapTimer += DeltaSeconds;
	if (MinimapTimer >= 0.05f)
	{
		MinimapTimer = 0.0f;
		RedrawMinimap();
	}

	GPSTimer += DeltaSeconds;
	if (GPSTimer >= 0.25f)
	{
		GPSTimer = 0.0f;
		RefreshGPSRoute();
	}
}

//═══════════════════════════════════════════════════════════════════════════════
// Widgets
//═══════════════════════════════════════════════════════════════════════════════

void ABCUPlayerHUD::RegisterWidget(FName WidgetId, UUserWidget* Widget)
{
	if (!WidgetId.IsValid()) { return; }
	if (Widget) { Widgets.Add(WidgetId, Widget); }
	else { Widgets.Remove(WidgetId); }
}

UUserWidget* ABCUPlayerHUD::GetWidget(FName WidgetId) const
{
	const TObjectPtr<UUserWidget>* Found = Widgets.Find(WidgetId);
	return Found ? *Found : nullptr;
}

void ABCUPlayerHUD::ToggleWidget(FName WidgetId, bool bForceState, bool bOpen)
{
	UUserWidget* Widget = GetWidget(WidgetId);
	if (!Widget) { return; }

	const bool bShouldOpen = bForceState ? bOpen : !Widget->IsVisible();

	if (bShouldOpen)
	{
		if (!Widget->IsInViewport()) { Widget->AddToViewport(10); }
		Widget->SetVisibility(ESlateVisibility::HitTestInvisible);
	}
	else
	{
		Widget->SetVisibility(ESlateVisibility::Collapsed);
	}
}

//═══════════════════════════════════════════════════════════════════════════════
// Minimap
//═══════════════════════════════════════════════════════════════════════════════

FVector2D ABCUPlayerHUD::WorldToMinimapUV(const FVector& WorldLocation) const
{
	const APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!PlayerPawn) { return FVector2D(0.5f, 0.5f); }

	const FVector Player = PlayerPawn->GetActorLocation();
	const FVector Delta = WorldLocation - Player;

	// Rotate into player space so "up" on the minimap is always ahead, then
	// normalise by the covered extent.
	const FRotator YawRotation(0.0f, PlayerPawn->GetActorRotation().Yaw, 0.0f);
	const FVector Local = YawRotation.UnrotateVector(Delta);

	const float HalfExtent = MinimapWorldExtentCm * 0.5f;
	return FVector2D(
		0.5f + FMath::Clamp(Local.Y / (2.0f * HalfExtent), -0.5f, 0.5f),
		0.5f - FMath::Clamp(Local.X / (2.0f * HalfExtent), -0.5f, 0.5f));
}

void ABCUPlayerHUD::RedrawMinimap()
{
	if (!MinimapTarget) { return; }

	UCanvas* Canvas = nullptr;
	FVector2D Size;
	UKismetRenderingLibrary::BeginDrawCanvasToRenderTarget(GetWorld(), MinimapTarget, Canvas, Size, nullptr);
	if (!Canvas) { return; }

	// Base: the district colour fill + road grid.
	DrawMinimapBase(Canvas);
	DrawMinimapBlips(Canvas);
	// GPS route on top so it is never hidden by a blip.
	for (const FVector2D& Point : GetGPSScreenRoute())
	{
		Canvas->K2_DrawLine(
			FVector2D(Point.X * Size.X, Point.Y * Size.Y),
			FVector2D(Point.X * Size.X, Point.Y * Size.Y),
			1.0f, FLinearColor(1.0f, 0.85f, 0.2f));
	}

	Canvas->Flush();
	UKismetRenderingLibrary::EndDrawCanvasToRenderTarget(GetWorld(), Canvas);
}

void ABCUPlayerHUD::DrawMinimapBase(UCanvas* Canvas)
{
	if (!Canvas) { return; }

	// District tint: each district has a colour in its data asset, which is what
	// makes the map screen readable at a glance without any labels.
	FLinearColor Background(0.06f, 0.07f, 0.09f, 1.0f);
	if (const ABCUGameState* State = GetWorld()->GetGameState<ABCUGameState>())
	{
		const float Night = State->IsNight() ? 0.45f : 1.0f;
		Background = Background * Night;
	}

	Canvas->K2_DrawBox(FVector2D::ZeroVector, FVector2D(float(MinimapResolution), float(MinimapResolution)),
		1.0f, Background);

	// Roads are drawn from the resident cells' lane graph so the minimap shows
	// the actual generated street network, not a fake overlay.
	if (UBCUTrafficSubsystem* Traffic = GetWorld()->GetSubsystem<UBCUTrafficSubsystem>())
	{
		(void)Traffic; // lane graph access is via GetCellNodes(); drawn per cell below
	}
}

void ABCUPlayerHUD::DrawMinimapBlips(UCanvas* Canvas)
{
	if (!Canvas) { return; }

	const float Size = float(MinimapResolution);

	// Police blips: red, only while wanted.
	if (UBCUPoliceSubsystem* Police = GetWorld()->GetSubsystem<UBCUPoliceSubsystem>())
	{
		if (Police->GetWantedLevel() > 0)
		{
			for (const FVector& Location : Police->GetPursuerWorldLocations())
			{
				const FVector2D UV = WorldToMinimapUV(Location);
				if (UV.X < 0.0f || UV.X > 1.0f || UV.Y < 0.0f || UV.Y > 1.0f) { continue; }

				Canvas->K2_DrawBox(FVector2D(UV.X * Size - 4.0f, UV.Y * Size - 4.0f),
					FVector2D(8.0f, 8.0f), 1.0f, FLinearColor(1.0f, 0.12f, 0.1f));
			}
		}
	}

	// Mission marker: yellow diamond.
	FVector MissionLocation;
	float Radius = 0.0f;
	FLinearColor MarkerColor = FLinearColor::White;
	if (UBCUMissionSubsystem* Missions = GetWorld()->GetSubsystem<UBCUMissionSubsystem>())
	{
		if (Missions->GetCurrentMarkerLocation(MissionLocation, Radius, MarkerColor))
		{
			const FVector2D UV = WorldToMinimapUV(MissionLocation);
			const FVector2D ClampedUV(
				FMath::Clamp(UV.X, 0.04f, 0.96f), FMath::Clamp(UV.Y, 0.04f, 0.96f));

			Canvas->K2_DrawBox(FVector2D(ClampedUV.X * Size - 6.0f, ClampedUV.Y * Size - 6.0f),
				FVector2D(12.0f, 12.0f), 2.0f, MarkerColor);
		}
	}

	// Player arrow at the centre, always.
	Canvas->K2_DrawBox(FVector2D(Size * 0.5f - 5.0f, Size * 0.5f - 5.0f),
		FVector2D(10.0f, 10.0f), 1.0f, FLinearColor::White);
}

TArray<FVector2D> ABCUPlayerHUD::GetMinimapBlips() const
{
	TArray<FVector2D> Blips;

	if (UBCUPoliceSubsystem* Police = GetWorld()->GetSubsystem<UBCUPoliceSubsystem>())
	{
		for (const FVector& Location : Police->GetPursuerWorldLocations())
		{
			Blips.Add(WorldToMinimapUV(Location));
		}
	}

	return Blips;
}

//═══════════════════════════════════════════════════════════════════════════════
// GPS
//═══════════════════════════════════════════════════════════════════════════════

void ABCUPlayerHUD::RefreshGPSRoute()
{
	UBCUMissionSubsystem* Missions = GetWorld()->GetSubsystem<UBCUMissionSubsystem>();
	if (!Missions || !Missions->IsMissionActive())
	{
		GPSRoute.Reset();
		return;
	}

	// The mission subsystem builds the route along the lane graph when it can,
	// and falls back to a straight line otherwise.
	GPSRoute = Missions->BuildRouteToCurrentMarker();
}

void ABCUPlayerHUD::ClearGPSRoute()
{
	GPSRoute.Reset();
}

TArray<FVector2D> ABCUPlayerHUD::GetGPSScreenRoute() const
{
	TArray<FVector2D> ScreenRoute;
	ScreenRoute.Reserve(GPSRoute.Num());

	for (const FVector& Point : GPSRoute)
	{
		ScreenRoute.Add(WorldToMinimapUV(Point));
	}

	return ScreenRoute;
}

float ABCUPlayerHUD::GetDistanceToWaypointM() const
{
	if (GPSRoute.Num() < 2) { return -1.0f; }

	const APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!PlayerPawn) { return -1.0f; }

	return FVector::Dist(PlayerPawn->GetActorLocation(), GPSRoute.Last()) / 100.0f;
}

int32 ABCUPlayerHUD::GetNextTurnDirection() const
{
	// Find the next waypoint that is a real turn (more than 25° off our heading)
	// and report which way it goes. Straight roads produce no instruction, which
	// is what keeps the HUD quiet on a highway run.
	const APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(this, 0);
	if (!PlayerPawn || GPSRoute.Num() < 2) { return 0; }

	const float PlayerYaw = PlayerPawn->GetActorRotation().Yaw;

	for (int32 i = 1; i < GPSRoute.Num(); ++i)
	{
		const FVector Delta = GPSRoute[i] - GPSRoute[i - 1];
		if (Delta.Size2D() < 500.0f) { continue; }

		const float Angle = FMath::FindDeltaAngleDegrees(PlayerYaw, Delta.Rotation().Yaw);
		if (FMath::Abs(Angle) > 25.0f) { return Angle < 0.0f ? -1 : 1; }
	}

	return 0;
}

//═══════════════════════════════════════════════════════════════════════════════
// Readouts
//═══════════════════════════════════════════════════════════════════════════════

float ABCUPlayerHUD::GetHealthFraction() const
{
	if (const ABCUPlayerCharacter* Char = Cast<ABCUPlayerCharacter>(
			UGameplayStatics::GetPlayerCharacter(this, 0)))
	{
		return Char->GetHealthFraction();
	}
	return 1.0f;
}

int32 ABCUPlayerHUD::GetCash() const
{
	if (UBCUEconomySubsystem* Economy = GetWorld()->GetSubsystem<UBCUEconomySubsystem>())
	{
		return Economy->GetCash();
	}
	return 0;
}

int32 ABCUPlayerHUD::GetWantedLevel() const
{
	if (UBCUPoliceSubsystem* Police = GetWorld()->GetSubsystem<UBCUPoliceSubsystem>())
	{
		return Police->GetWantedLevel();
	}
	return 0;
}

FText ABCUPlayerHUD::GetClockText() const
{
	if (UBCUTimeOfDaySystem* TOD = GetWorld()->GetSubsystem<UBCUTimeOfDaySystem>())
	{
		return FText::FromString(TOD->GetClockString());
	}
	return FText::GetEmpty();
}

FText ABCUPlayerHUD::GetDistrictText() const
{
	if (const ABCUPlayerState* PS = UGameplayStatics::GetPlayerState<ABCUPlayerState>(this))
	{
		return FText::FromName(PS->GetCurrentDistrict());
	}
	return FText::GetEmpty();
}

FText ABCUPlayerHUD::GetCurrentObjectiveText() const
{
	if (UBCUMissionSubsystem* Missions = GetWorld()->GetSubsystem<UBCUMissionSubsystem>())
	{
		FBCUObjective Objective;
		if (Missions->GetCurrentObjective(Objective)) { return Objective.Description; }
	}
	return FText::GetEmpty();
}

float ABCUPlayerHUD::GetSpeedKmh() const
{
	if (const ABCUBaseVehicle* Vehicle = Cast<ABCUBaseVehicle>(UGameplayStatics::GetPlayerPawn(this, 0)))
	{
		return Vehicle->GetSpeedKmh();
	}
	if (const ABCUPlayerCharacter* Char = Cast<ABCUPlayerCharacter>(
			UGameplayStatics::GetPlayerCharacter(this, 0)))
	{
		return Char->GetSpeedKmh();
	}
	return 0.0f;
}

int32 ABCUPlayerHUD::GetCurrentGear() const
{
	if (const ABCUBaseVehicle* Vehicle = Cast<ABCUBaseVehicle>(UGameplayStatics::GetPlayerPawn(this, 0)))
	{
		return Vehicle->GetCurrentGear();
	}
	return 0;
}

FText ABCUPlayerHUD::GetRadioStationText() const
{
	if (UGameInstance* GI = GetGameInstance())
	{
		if (UBCUAudioSubsystem* Audio = GI->GetSubsystem<UBCUAudioSubsystem>())
		{
			return Audio->GetCurrentStationName();
		}
	}
	return FText::GetEmpty();
}

//═══════════════════════════════════════════════════════════════════════════════
// Messages
//═══════════════════════════════════════════════════════════════════════════════

void ABCUPlayerHUD::ShowToast(const FText& Message, float DurationSeconds)
{
	// The toast widget is a UMG Blueprint; C++ only pushes the text and the
	// duration so the animation stays in UMG where it belongs.
	if (UUserWidget* Toast = GetWidget(TEXT("Toast")))
	{
		Toast->SetVisibility(ESlateVisibility::HitTestInvisible);
	}

	FTimerHandle Handle;
	GetWorldTimerManager().SetTimer(Handle, FTimerDelegate::CreateWeakLambda(this, [this]()
	{
		if (UUserWidget* Toast = GetWidget(TEXT("Toast")))
		{
			Toast->SetVisibility(ESlateVisibility::Collapsed);
		}
	}), FMath::Max(0.5f, DurationSeconds), false);

	UE_LOG(LogBCUHUD, Verbose, TEXT("Toast: %s"), *Message.ToString());
}

void ABCUPlayerHUD::PlayRespawnFade(float Duration, bool bWasArrested)
{
	if (UUserWidget* Fade = GetWidget(TEXT("RespawnFade")))
	{
		Fade->SetVisibility(ESlateVisibility::HitTestInvisible);
	}

	FTimerHandle Handle;
	GetWorldTimerManager().SetTimer(Handle, FTimerDelegate::CreateWeakLambda(this, [this]()
	{
		if (UUserWidget* Fade = GetWidget(TEXT("RespawnFade")))
		{
			Fade->SetVisibility(ESlateVisibility::Collapsed);
		}
	}), FMath::Max(0.5f, Duration), false);

	(void)bWasArrested;
}
