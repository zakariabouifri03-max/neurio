// Copyright GameProject. All rights reserved. Original content only.

#include "Core/GameProjectBlueprintLibrary.h"

#include "Core/GameProjectGameInstance.h"
#include "Core/GameProjectLog.h"
#include "Core/GameProjectSettings.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInterface.h"
#include "ProjectCore.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "Subsystems/SubsystemBlueprintLibrary.h"

UGameProjectGameInstance* UGameProjectBlueprintLibrary::GetGameProjectGameInstance(const UObject* WorldContextObject)
{
	if (!WorldContextObject)
	{
		return nullptr;
	}

	const UWorld* World = GEngine ? GEngine->GetWorldFromContextObject(WorldContextObject, EGetWorldErrorMode::ReturnNull) : nullptr;
	if (!World)
	{
		// Commandlets and CDO construction have no world; fall back to the engine instance.
		return nullptr;
	}

	return Cast<UGameProjectGameInstance>(World->GetGameInstance());
}

UGameInstanceSubsystem* UGameProjectBlueprintLibrary::GetGameProjectSubsystem(const UObject* WorldContextObject, TSubclassOf<UGameInstanceSubsystem> SubsystemClass)
{
	if (!SubsystemClass)
	{
		return nullptr;
	}

	// Engine helper already handles world-context resolution and returns null safely.
	return USubsystemBlueprintLibrary::GetGameInstanceSubsystem(WorldContextObject, SubsystemClass);
}

UStaticMesh* UGameProjectBlueprintLibrary::GetPlaceholderCubeMesh()
{
	return ResolveSoftObject(UGameProjectSettings::Get().PlaceholderCubeMesh, TEXT("placeholder cube"));
}

UStaticMesh* UGameProjectBlueprintLibrary::GetPlaceholderPlaneMesh()
{
	return ResolveSoftObject(UGameProjectSettings::Get().PlaceholderPlaneMesh, TEXT("placeholder plane"));
}

UMaterialInterface* UGameProjectBlueprintLibrary::GetPlaceholderMaterial()
{
	static TWeakObjectPtr<UMaterialInterface> CachedMaterial;

	UMaterialInterface* Material = CachedMaterial.Get();
	if (!Material)
	{
		Material = LoadObject<UMaterialInterface>(nullptr, GameProject::FallbackMaterialPath);
		CachedMaterial = Material;
	}
	return Material;
}

FString UGameProjectBlueprintLibrary::FormatTimeOfDay(double SecondsSinceMidnight)
{
	constexpr double SecondsPerDay = 86400.0;
	double Normalised = FMath::Fmod(SecondsSinceMidnight, SecondsPerDay);
	if (Normalised < 0.0)
	{
		Normalised += SecondsPerDay;
	}

	const int32 TotalMinutes = static_cast<int32>(Normalised / 60.0);
	return FString::Printf(TEXT("%02d:%02d"), TotalMinutes / 60, TotalMinutes % 60);
}

FString UGameProjectBlueprintLibrary::FormatPosition(const FVector& Position)
{
	return FString::Printf(TEXT("(%d, %d, %d)"),
		FMath::RoundToInt32(Position.X),
		FMath::RoundToInt32(Position.Y),
		FMath::RoundToInt32(Position.Z));
}

bool UGameProjectBlueprintLibrary::AreDebugToolsAllowed()
{
	return GAMEPROJECT_WITH_DEBUG_TOOLS != 0;
}
