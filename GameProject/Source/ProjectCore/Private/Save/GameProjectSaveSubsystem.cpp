// Copyright GameProject. All rights reserved. Original content only.

#include "Save/GameProjectSaveSubsystem.h"

#include "Core/GameProjectBlueprintLibrary.h"
#include "Core/GameProjectLog.h"
#include "Engine/Engine.h"
#include "Engine/GameInstance.h"
#include "Engine/World.h"
#include "Kismet/GameplayStatics.h"
#include "Save/GameProjectSaveContributor.h"
#include "Save/SaveGameProject.h"
#include "Misc/DateTime.h"
#include "ProjectCore.h"

void UGameProjectSaveSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);

	CurrentSaveGame = NewObject<USaveGameProject>(this);
}

void UGameProjectSaveSubsystem::Deinitialize()
{
	SortedContributors.Reset();
	Contributors.Reset();
	Super::Deinitialize();
}

UGameProjectSaveSubsystem* UGameProjectSaveSubsystem::Get(const UObject* WorldContextObject)
{
	if (!WorldContextObject || !GEngine)
	{
		return nullptr;
	}

	const UWorld* World = GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull);
	const UGameInstance* GameInstance = World ? World->GetGameInstance() : nullptr;
	return GameInstance ? GameInstance->GetSubsystem<UGameProjectSaveSubsystem>() : nullptr;
}

FString UGameProjectSaveSubsystem::GetSlotNameForIndex(int32 SaveSlot)
{
	// A negative index is treated as the autosave slot rather than rejected: the
	// game mode calls SaveGame(-1) before travel and that must not silently fail.
	return SaveSlot < 0 ? TEXT("GameProjectAutosave") : FString::Printf(TEXT("GameProjectSave_%d"), SaveSlot);
}

bool UGameProjectSaveSubsystem::DoesSlotExist(int32 SaveSlot) const
{
	return DoesNamedSlotExist(GetSlotNameForIndex(SaveSlot));
}

bool UGameProjectSaveSubsystem::DoesNamedSlotExist(const FString& SlotName) const
{
	return UGameplayStatics::DoesSaveGameExist(SlotName, /*UserIndex*/ 0);
}

void UGameProjectSaveSubsystem::RebuildSortedContributors()
{
	if (!bContributorsDirty)
	{
		return;
	}
	bContributorsDirty = false;

	SortedContributors.Reset(Contributors.Num());

	// Stable sort by priority keeps registration order for equal priorities, which
	// makes save ordering reproducible between runs.
	TArray<TWeakObjectPtr<UObject>> Live;
	Live.Reserve(Contributors.Num());
	for (const TWeakObjectPtr<UObject>& Weak : Contributors)
	{
		if (Weak.IsValid() && Weak->GetClass()->ImplementsInterface(UGameProjectSaveContributor::StaticClass()))
		{
			Live.Add(Weak);
		}
	}

	Live.StableSort([](const TWeakObjectPtr<UObject>& A, const TWeakObjectPtr<UObject>& B)
	{
		const int32 PriorityA = IGameProjectSaveContributor::Execute_GetSavePriority(A.Get());
		const int32 PriorityB = IGameProjectSaveContributor::Execute_GetSavePriority(B.Get());
		return PriorityA < PriorityB;
	});

	SortedContributors = MoveTemp(Live);
}

void UGameProjectSaveSubsystem::RegisterContributor(UObject* Contributor)
{
	if (!Contributor || !Contributor->GetClass()->ImplementsInterface(UGameProjectSaveContributor::StaticClass()))
	{
		UE_LOG(LogSave, Warning, TEXT("RegisterContributor: '%s' does not implement IGameProjectSaveContributor."),
			*GetNameSafe(Contributor));
		return;
	}

	if (Contributors.Contains(Contributor))
	{
		return;
	}

	Contributors.Add(Contributor);
	bContributorsDirty = true;

	UE_LOG(LogSave, Verbose, TEXT("Registered save contributor '%s' (%d total)."),
		*IGameProjectSaveContributor::Execute_GetSaveContributorId(Contributor).ToString(), Contributors.Num());
}

void UGameProjectSaveSubsystem::UnregisterContributor(UObject* Contributor)
{
	const int32 Removed = Contributors.Remove(Contributor);
	if (Removed > 0)
	{
		bContributorsDirty = true;
	}
}

void UGameProjectSaveSubsystem::CollectSaveData()
{
	if (!CurrentSaveGame)
	{
		CurrentSaveGame = NewObject<USaveGameProject>(this);
	}

	RebuildSortedContributors();

	CurrentSaveGame->SaveVersion = GameProject::SaveGameVersion;
	CurrentSaveGame->SavedUtc = FDateTime::UtcNow();
#if !UE_BUILD_SHIPPING
	CurrentSaveGame->BuildConfiguration = TEXT("Development");
#else
	CurrentSaveGame->BuildConfiguration = TEXT("Shipping");
#endif

	for (const TWeakObjectPtr<UObject>& Weak : SortedContributors)
	{
		UObject* Contributor = Weak.Get();
		if (!Contributor)
		{
			continue;
		}

		if (!IGameProjectSaveContributor::Execute_HasSaveData(Contributor))
		{
			continue;
		}

		IGameProjectSaveContributor::Execute_WriteSaveData(Contributor, *CurrentSaveGame);
	}

	UE_LOG(LogSave, Log, TEXT("Collected save data from %d contributor(s)."), SortedContributors.Num());
}

void UGameProjectSaveSubsystem::ApplySaveData()
{
	if (!CurrentSaveGame)
	{
		return;
	}

	RebuildSortedContributors();

	// Reverse order on read: whatever wrote last should be restored first, so a
	// system that depends on another's state sees it already in place.
	for (int32 Index = SortedContributors.Num() - 1; Index >= 0; --Index)
	{
		UObject* Contributor = SortedContributors[Index].Get();
		if (Contributor)
		{
			IGameProjectSaveContributor::Execute_ReadSaveData(Contributor, *CurrentSaveGame);
		}
	}

	UE_LOG(LogSave, Log, TEXT("Applied save data (version %d, saved %s)."),
		CurrentSaveGame->SaveVersion, *CurrentSaveGame->SavedUtc.ToString());
}

bool UGameProjectSaveSubsystem::SaveToSlot(int32 SaveSlot, bool bForceSynchronous)
{
	CollectSaveData();
	PendingSaveSlot = SaveSlot;
	return SaveNamedSlot(GetSlotNameForIndex(SaveSlot), bForceSynchronous);
}

bool UGameProjectSaveSubsystem::SaveNamedSlot(const FString& SlotName, bool bForceSynchronous)
{
	if (!CurrentSaveGame)
	{
		UE_LOG(LogSave, Error, TEXT("SaveNamedSlot('%s') with no save object."), *SlotName);
		return false;
	}

	if (bForceSynchronous)
	{
		const bool bSaved = UGameplayStatics::SaveGameToSlot(CurrentSaveGame, SlotName, /*UserIndex*/ 0);
		UE_LOG(LogSave, Log, TEXT("Synchronous save '%s' %s."), *SlotName, bSaved ? TEXT("succeeded") : TEXT("FAILED"));
		OnSaveFinished.Broadcast(PendingSaveSlot, bSaved);
		return bSaved;
	}

	// Async keeps a 200 ms disk write off the frame budget. The lambda captures a
	// weak pointer because the subsystem can be torn down mid-write on exit.
	TWeakObjectPtr<UGameProjectSaveSubsystem> WeakThis(this);
	const int32 SlotForCallback = PendingSaveSlot;

	UGameplayStatics::AsyncSaveGameToSlot(CurrentSaveGame, SlotName, /*UserIndex*/ 0,
		FAsyncSaveGameDelegate::CreateLambda(
			[WeakThis, SlotForCallback](const FString& InSlotName, bool bSuccess)
			{
				UE_LOG(LogSave, Log, TEXT("Async save '%s' %s."), *InSlotName, bSuccess ? TEXT("succeeded") : TEXT("FAILED"));
				if (UGameProjectSaveSubsystem* Self = WeakThis.Get())
				{
					Self->OnSaveFinished.Broadcast(SlotForCallback, bSuccess);
				}
			}));

	return true;
}

bool UGameProjectSaveSubsystem::LoadFromSlot(int32 SaveSlot)
{
	const FString SlotName = GetSlotNameForIndex(SaveSlot);
	if (!DoesNamedSlotExist(SlotName))
	{
		UE_LOG(LogSave, Warning, TEXT("LoadFromSlot(%d): slot '%s' does not exist."), SaveSlot, *SlotName);
		OnLoadFinished.Broadcast(SaveSlot, false);
		return false;
	}

	bIsLoading = true;
	PendingLoadSlot = SaveSlot;

	USaveGame* Loaded = UGameplayStatics::LoadGameFromSlot(SlotName, /*UserIndex*/ 0);
	USaveGameProject* LoadedProject = Cast<USaveGameProject>(Loaded);

	if (!LoadedProject)
	{
		bIsLoading = false;
		UE_LOG(LogSave, Error, TEXT("LoadFromSlot(%d): '%s' is not a USaveGameProject (got %s)."),
			SaveSlot, *SlotName, *GetNameSafe(Loaded));
		OnLoadFinished.Broadcast(SaveSlot, false);
		return false;
	}

	if (!LoadedProject->MigrateFrom(LoadedProject->SaveVersion))
	{
		bIsLoading = false;
		OnLoadFinished.Broadcast(SaveSlot, false);
		return false;
	}

	// Held by a UPROPERTY from here on, so the loaded object survives level travel
	// and is collected by the same GC graph as everything else the subsystem owns.
	CurrentSaveGame = LoadedProject;

	ApplySaveData();
	bIsLoading = false;

	OnLoadFinished.Broadcast(SaveSlot, true);
	return true;
}

bool UGameProjectSaveSubsystem::DeleteSlot(int32 SaveSlot)
{
	const FString SlotName = GetSlotNameForIndex(SaveSlot);
	const bool bDeleted = UGameplayStatics::DeleteGameInSlot(SlotName, /*UserIndex*/ 0);
	UE_LOG(LogSave, Log, TEXT("Delete slot '%s': %s"), *SlotName, bDeleted ? TEXT("ok") : TEXT("not found"));
	return bDeleted;
}

bool UGameProjectSaveSubsystem::SaveSettingsToSlot(const TCHAR* SlotName, const FGameProjectUserSettings& Settings)
{
	if (!SlotName)
	{
		return false;
	}

	// A dedicated object, not CurrentSaveGame: writing options must never clobber
	// an in-progress game save.
	USaveGameProject* SettingsSave = NewObject<USaveGameProject>(this);
	SettingsSave->SaveVersion = GameProject::SaveGameVersion;
	SettingsSave->SavedUtc = FDateTime::UtcNow();
	SettingsSave->Settings = Settings;

	const bool bSaved = UGameplayStatics::SaveGameToSlot(SettingsSave, FString(SlotName), /*UserIndex*/ 0);
	if (!bSaved)
	{
		UE_LOG(LogSave, Warning, TEXT("Failed to persist settings to '%s'."), SlotName);
	}
	return bSaved;
}

bool UGameProjectSaveSubsystem::TryLoadSettingsFromSlot(const TCHAR* SlotName, FGameProjectUserSettings& OutSettings) const
{
	if (!SlotName || !UGameplayStatics::DoesSaveGameExist(FString(SlotName), 0))
	{
		return false;
	}

	const USaveGameProject* Loaded = Cast<USaveGameProject>(UGameplayStatics::LoadGameFromSlot(FString(SlotName), 0));
	if (!Loaded)
	{
		return false;
	}

	OutSettings = Loaded->Settings;
	return true;
}
