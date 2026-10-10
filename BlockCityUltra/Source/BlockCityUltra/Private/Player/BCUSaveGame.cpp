// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Player/BCUSaveGame.h"

#include "Core/BCUGameInstance.h"
#include "Core/BCUPlayerController.h"
#include "Core/BCUPlayerState.h"
#include "Player/BCUPlayerCharacter.h"
#include "Player/BCUEconomySubsystem.h"
#include "Mission/BCUMissionSubsystem.h"
#include "Vehicle/BCUBaseVehicle.h"
#include "Vehicle/BCUVehicleSubsystem.h"
#include "Graphics/BCUGraphicsSubsystem.h"
#include "World/Weather/BCUTimeOfDaySystem.h"
#include "World/Weather/BCUWeatherSystem.h"
#include "Police/BCUPoliceSubsystem.h"
#include "Async/Async.h"
#include "GenericPlatform/GenericPlatformSaveGame.h"
#include "Misc/Paths.h"
#include "HAL/PlatformFeatures.h"
#include "GenericPlatform/GenericPlatform.h"
#include "Kismet/GameplayStatics.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUSave, Log, All);

static const int32 BCU_CURRENT_SAVE_VERSION = 7;

bool UBCUSaveGame::ValidateAndMigrate()
{
	if (SaveVersion > BCU_CURRENT_SAVE_VERSION)
	{
		bIsValid = false;
		ValidationMessage = FText::Format(
			NSLOCTEXT("BCU", "Save_TooNew", "This save was written by a newer version (v{0}); "
				"this build supports v{1}."),
			FText::AsNumber(SaveVersion), FText::AsNumber(BCU_CURRENT_SAVE_VERSION));
		return false;
	}

	// Migration path for every older layout. Each step is additive so a v1 save
	// still loads: unknown fields simply take their defaults.
	if (SaveVersion < 3)
	{
		// v3 added the garage; v1/v2 saves got their current car moved into it.
		if (Profile.Garage.Num() == 0 && Profile.Cash > 0)
		{
			FBCUSavedVehicle Starter;
			Starter.VehicleId = TEXT("kestrel_commuter");
			Profile.Garage.Add(Starter);
		}
	}

	if (SaveVersion < 5)
	{
		// v5 added property income; existing properties earn nothing until bought.
		for (FBCUSavedProperty& Property : Profile.Properties)
		{
			Property.DailyIncome = FMath::Max(0, Property.DailyIncome);
		}
	}

	if (SaveVersion < 6)
	{
		// v6 added graphics settings to the profile.
		Graphics = FBCUGraphicsSettings();
	}

	SaveVersion = BCU_CURRENT_SAVE_VERSION;
	bIsValid = true;
	ValidationMessage = FText::GetEmpty();
	return true;
}

//═══════════════════════════════════════════════════════════════════════════════
// UBCUSaveGameSystem
//═══════════════════════════════════════════════════════════════════════════════

void UBCUSaveGameSystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

	CurrentSave = NewObject<UBCUSaveGame>(this);
	CurrentSave->Profile.Cash = 2500;
	CurrentSave->SavedAtUtc = FDateTime::UtcNow();
}

void UBCUSaveGameSystem::Deinitialize()
{
	FlushPendingSave();
	Super::Deinitialize();
}

FString UBCUSaveGameSystem::SlotName(int32 Index) const
{
	return FString::Printf(TEXT("%s_%d"), *DefaultSaveSlotName, FMath::Clamp(Index, 0, MaxSaveSlots - 1));
}

void UBCUSaveGameSystem::SetActiveSlot(int32 SlotIndex)
{
	ActiveSlot = FMath::Clamp(SlotIndex, 0, MaxSaveSlots - 1);
}

FBCUPlayerProfile& UBCUSaveGameSystem::GetProfile()
{
	if (!CurrentSave)
	{
		CurrentSave = NewObject<UBCUSaveGame>(this);
	}
	return CurrentSave->Profile;
}

bool UBCUSaveGameSystem::SaveToSlot(int32 SlotIndex, const FText& Description)
{
	if (!CurrentSave)
	{
		return false;
	}

	// Capture live state first, then stamp the metadata.
	if (const ABCUPlayerController* PC = Cast<ABCUPlayerController>(
			UGameplayStatics::GetPlayerController(this, 0)))
	{
		CaptureFromPlayer(PC);
	}

	CurrentSave->SavedAtUtc = FDateTime::UtcNow();
	CurrentSave->SaveDescription = Description;
	CurrentSave->BuildVersion = TEXT("0.9.0-slice");
	CurrentSave->SaveVersion = BCU_CURRENT_SAVE_VERSION;

	const bool bSaved = UGameplayStatics::SaveGameToSlot(CurrentSave, SlotName(SlotIndex), 0);
	UE_LOG(LogBCUSave, Log, TEXT("Save slot %d (%s): %s"), SlotIndex, *SlotName(SlotIndex),
		bSaved ? TEXT("written") : TEXT("FAILED"));

	OnSaveCompleted.Broadcast(bSaved);
	return bSaved;
}

bool UBCUSaveGameSystem::LoadFromSlot(int32 SlotIndex)
{
	const FString Name = SlotName(SlotIndex);
	if (!UGameplayStatics::DoesSaveGameExist(Name, 0))
	{
		UE_LOG(LogBCUSave, Warning, TEXT("No save in slot %s"), *Name);
		OnSaveCompleted.Broadcast(false);
		return false;
	}

	UBCUSaveGame* Loaded = Cast<UBCUSaveGame>(UGameplayStatics::LoadGameFromSlot(Name, 0));
	if (!Loaded)
	{
		OnSaveCompleted.Broadcast(false);
		return false;
	}

	if (!Loaded->ValidateAndMigrate())
	{
		UE_LOG(LogBCUSave, Error, TEXT("Save in slot %s is invalid: %s"),
			*Name, *Loaded->ValidationMessage.ToString());
		OnSaveCompleted.Broadcast(false);
		return false;
	}

	CurrentSave = Loaded;
	ActiveSlot = SlotIndex;

	// Apply everything the save owns: money, unlocks, clock, weather, position.
	UWorld* World = GetGameInstance()->GetWorld();
	if (!World)
	{
		OnSaveCompleted.Broadcast(true);
		return true;
	}

	if (UBCUEconomySubsystem* Economy = World->GetSubsystem<UBCUEconomySubsystem>())
	{
		Economy->AddCash(CurrentSave->Profile.Cash, EBCUCashReason::Other);
		Economy->AddReputation(CurrentSave->Profile.Reputation);
		for (const FName& Id : CurrentSave->Profile.UnlockedCosmetics)
		{
			Economy->UnlockCosmetic(Id);
		}
		for (const FBCUSavedProperty& Property : CurrentSave->Profile.Properties)
		{
			Economy->UnlockProperty(Property.PropertyId);
		}
		for (const FBCUSavedVehicle& Car : CurrentSave->Profile.Garage)
		{
			Economy->UnlockVehicle(Car.VehicleId);
		}
	}

	if (UBCUVehicleSubsystem* Vehicles = World->GetSubsystem<UBCUVehicleSubsystem>())
	{
		for (const FBCUSavedVehicle& Car : CurrentSave->Profile.Garage)
		{
			Vehicles->GrantVehicle(Car.VehicleId);
		}
	}

	if (UBCUMissionSubsystem* Missions = World->GetSubsystem<UBCUMissionSubsystem>())
	{
		for (const FName& Id : CurrentSave->Profile.CompletedMissions)
		{
			Missions->MarkMissionCompleted(Id, /*bSuccess=*/true);
		}
	}

	if (UBCUTimeOfDaySystem* TOD = World->GetSubsystem<UBCUTimeOfDaySystem>())
	{
		TOD->SetTimeOfDay(CurrentSave->TimeOfDay);
	}

	if (UBCUWeatherSystem* Weather = World->GetSubsystem<UBCUWeatherSystem>())
	{
		Weather->SetWeather(static_cast<EBCUWeather>(CurrentSave->Weather), 0.5f);
		Weather->SetSurfaceWetness(CurrentSave->SurfaceWetness);
	}

	if (UBCUGraphicsSubsystem* Graphics = GetGameInstance()->GetSubsystem<UBCUGraphicsSubsystem>())
	{
		Graphics->ApplySettings(CurrentSave->Graphics);
	}

	UE_LOG(LogBCUSave, Log, TEXT("Loaded slot %s: $%d, %d missions, %d cars"),
		*Name, CurrentSave->Profile.Cash, CurrentSave->Profile.CompletedMissions.Num(),
		CurrentSave->Profile.Garage.Num());

	OnSaveCompleted.Broadcast(true);
	return true;
}

bool UBCUSaveGameSystem::DeleteSlot(int32 SlotIndex)
{
	const FString Name = SlotName(SlotIndex);
	const bool bDeleted = UGameplayStatics::DeleteGameInSlot(Name, 0);
	UE_LOG(LogBCUSave, Log, TEXT("Delete slot %s: %s"), *Name, bDeleted ? TEXT("ok") : TEXT("nothing to delete"));
	return bDeleted;
}

bool UBCUSaveGameSystem::GetSlotInfo(int32 SlotIndex, FText& OutDescription, FDateTime& OutSavedAt,
	int32& OutCash, int32& OutReputation, int32& OutMissions) const
{
	const FString Name = SlotName(SlotIndex);
	if (!UGameplayStatics::DoesSaveGameExist(Name, 0))
	{
		return false;
	}

	// Full deserialize is the only reliable way to read metadata; the load
	// screen does this once per slot on a background thread.
	const UBCUSaveGame* Loaded = Cast<UBCUSaveGame>(UGameplayStatics::LoadGameFromSlot(Name, 0));
	if (!Loaded)
	{
		return false;
	}

	OutDescription = Loaded->SaveDescription;
	OutSavedAt = Loaded->SavedAtUtc;
	OutCash = Loaded->Profile.Cash;
	OutReputation = Loaded->Profile.Reputation;
	OutMissions = Loaded->Profile.CompletedMissions.Num();
	return true;
}

void UBCUSaveGameSystem::RequestAsyncSave(FName ReasonTag)
{
	if (bSavePending)
	{
		PendingSaveReason = ReasonTag;
		return;
	}

	bSavePending = true;
	PendingSaveReason = ReasonTag;
	PerformAsyncSave();
}

void UBCUSaveGameSystem::PerformAsyncSave()
{
	if (!CurrentSave)
	{
		bSavePending = false;
		return;
	}

	// Capture on the game thread (it touches live actors), serialize off it.
	if (const ABCUPlayerController* PC = Cast<ABCUPlayerController>(
			UGameplayStatics::GetPlayerController(this, 0)))
	{
		CaptureFromPlayer(PC);
	}

	CurrentSave->SavedAtUtc = FDateTime::UtcNow();

	TWeakObjectPtr<UBCUSaveGameSystem> WeakThis(this);
	UObject* SaveObject = CurrentSave;
	const FString Name = SlotName(ActiveSlot);

	Async(EAsyncExecution::ThreadPool, [WeakThis, SaveObject, Name]()
	{
		// Serialize on the worker; only the file write is truly blocking.
		int32 Size = 0;
		TArray<uint8> Bytes;
		if (UGameplayStatics::SaveGameToMemory(Cast<USaveGame>(SaveObject), Bytes, 0))
		{
			Size = Bytes.Num();
			if (ISaveGameSystem* System = IPlatformFeaturesModule::Get().GetSaveGameSystem())
			{
				System->SaveGame(/*bAttemptToUseUI=*/false, Name, /*UserIndex=*/0, Bytes);
			}
		}

		AsyncTask(ENamedThreads::GameThread, [WeakThis, Size, Name]()
		{
			if (WeakThis.IsValid())
			{
				WeakThis->bSavePending = false;
				WeakThis->OnSaveCompleted.Broadcast(Size > 0);
			}
			UE_LOG(LogBCUSave, Log, TEXT("Async save %s: %d bytes"), *Name, Size);
		});
	});
}

void UBCUSaveGameSystem::FlushPendingSave()
{
	// Called on shutdown: a save in flight must not be lost.
	if (bSavePending && CurrentSave)
	{
		SaveToSlot(ActiveSlot, CurrentSave->SaveDescription);
		bSavePending = false;
	}
}

void UBCUSaveGameSystem::CaptureFromPlayer(const ABCUPlayerController* PC)
{
	if (!PC || !CurrentSave)
	{
		return;
	}

	UWorld* World = PC->GetWorld();
	FBCUPlayerProfile& Profile = CurrentSave->Profile;

	if (const ABCUPlayerState* PS = PC->GetPlayerState<ABCUPlayerState>())
	{
		Profile.Cash = PS->GetCash();
		Profile.Reputation = PS->GetReputation();
		CurrentSave->WantedLevel = PS->GetWantedLevel();
		CurrentSave->PlayerDistrict = PS->GetCurrentDistrict();
		Profile.DistanceDrivenKm = PS->GetTotalDistanceDrivenKm();
	}

	if (const ABCUPlayerCharacter* Char = Cast<ABCUPlayerCharacter>(PC->GetPawn()))
	{
		CurrentSave->PlayerLocation = Char->GetActorLocation();
		CurrentSave->PlayerRotation = Char->GetActorRotation();
		Profile.DistanceWalkedKm = Char->GetDistanceTravelledKm();
	}

	if (World)
	{
		if (const UBCUEconomySubsystem* Economy = World->GetSubsystem<UBCUEconomySubsystem>())
		{
			Profile.Cash = Economy->GetCash();
			Profile.Reputation = Economy->GetReputation();
			for (const FName& ItemId : Economy->GetInventoryIds())
			{
				Profile.Inventory.Add(ItemId, Economy->GetItemCount(ItemId));
			}
		}

		if (const UBCUMissionSubsystem* Missions = World->GetSubsystem<UBCUMissionSubsystem>())
		{
			Profile.CompletedMissions = Missions->GetCompletedMissions();
		}

		if (const UBCUTimeOfDaySystem* TOD = World->GetSubsystem<UBCUTimeOfDaySystem>())
		{
			CurrentSave->TimeOfDay = TOD->GetTimeOfDay();
			CurrentSave->DayNumber = TOD->DayNumber;
		}

		if (const UBCUWeatherSystem* Weather = World->GetSubsystem<UBCUWeatherSystem>())
		{
			CurrentSave->Weather = static_cast<uint8>(Weather->GetWeather());
			CurrentSave->SurfaceWetness = Weather->GetSurfaceWetness();
		}
	}

	// Garage: capture each owned car's live state (paint, upgrades, odometer).
	if (UBCUVehicleSubsystem* Vehicles = World ? World->GetSubsystem<UBCUVehicleSubsystem>() : nullptr)
	{
		Profile.Garage.Reset();
		for (const FName& Id : Vehicles->GetOwnedVehicles())
		{
			FBCUSavedVehicle Car;
			Car.VehicleId = Id;

			if (ABCUBaseVehicle* Live = Vehicles->FindNearestOwnedVehicle(
					CurrentSave->PlayerLocation, TNumericLimits<float>::Max()))
			{
				if (Live->GetVehicleId() == Id)
				{
					Car.PaintColor = Live->PaintColor;
					Car.WheelStyle = Live->WheelStyle;
					Car.EngineLevel = Live->EngineLevel;
					Car.HandlingLevel = Live->HandlingLevel;
					Car.BrakeLevel = Live->BrakeLevel;
					Car.HealthFraction = Live->HealthRemaining;
					Car.OdometerKm = Live->GetOdometerKm();
					Car.FuelLitres = Live->GetFuelLitres();
					Car.ParkedLocation = Live->GetActorLocation();
					Car.ParkedRotation = Live->GetActorRotation();
				}
			}

			Profile.Garage.Add(Car);
		}
	}

	// Video options travel with the profile.
	if (const UBCUGraphicsSubsystem* Graphics =
			GetGameInstance()->GetSubsystem<UBCUGraphicsSubsystem>())
	{
		CurrentSave->Graphics = Graphics->GetSettings();
	}
}

void UBCUSaveGameSystem::ApplyToPlayer(const ABCUPlayerController* PC)
{
	if (!PC || !CurrentSave)
	{
		return;
	}

	if (ABCUPlayerState* PS = PC->GetPlayerState<ABCUPlayerState>())
	{
		PS->SetCash(CurrentSave->Profile.Cash);
		PS->SetReputation(CurrentSave->Profile.Reputation);
		PS->SetWantedLevel(CurrentSave->WantedLevel);
		PS->SetCurrentDistrict(CurrentSave->PlayerDistrict);
	}

	if (ABCUPlayerCharacter* Char = Cast<ABCUPlayerCharacter>(PC->GetPawn()))
	{
		Char->ApplyOutfit(CurrentSave->Profile.OutfitId);
		Char->SetBodyVoxelPalette(CurrentSave->Profile.SkinColor,
			FLinearColor(0.16f, 0.32f, 0.55f), FLinearColor(0.14f, 0.14f, 0.17f),
			FLinearColor(0.08f, 0.07f, 0.06f));

		if (!CurrentSave->PlayerLocation.IsNearlyZero())
		{
			Char->SetActorLocationAndRotation(CurrentSave->PlayerLocation, CurrentSave->PlayerRotation);
		}
	}
}
