// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "Core/GameProjectLog.h"
#include "GameProjectBlueprintLibrary.generated.h"

class UGameProjectGameInstance;
class UGameInstanceSubsystem;
class UStaticMesh;
class UMaterialInterface;
class UObject;
struct FWorldLocation;

/**
 * Small, dependency-free helpers shared by several systems.
 *
 * This is deliberately NOT a dumping ground: it only holds functions that are
 * (a) stateless, (b) used by more than one subsystem, and (c) useful to
 * Blueprint/designers. Anything with state belongs in a subsystem.
 */
UCLASS(meta = (ScriptName = "GameProjectLibrary"))
class PROJECTCORE_API UGameProjectBlueprintLibrary : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()

public:
	/** Returns the project GameInstance, or null in commandlets/tools. */
	UFUNCTION(BlueprintPure, Category = "GameProject|Core", meta = (WorldContext = "WorldContextObject", DisplayName = "Get GameProject Game Instance"))
	static UGameProjectGameInstance* GetGameProjectGameInstance(const UObject* WorldContextObject);

	/**
	 * Returns the first local player's instance of the requested GameInstance subsystem.
	 * Blueprint-friendly wrapper so designers never have to touch subsystem plumbing.
	 */
	UFUNCTION(BlueprintPure, Category = "GameProject|Core", meta = (WorldContext = "WorldContextObject", DeterminesOutputType = "SubsystemClass", DynamicOutputParam))
	static UGameInstanceSubsystem* GetGameProjectSubsystem(const UObject* WorldContextObject, TSubclassOf<UGameInstanceSubsystem> SubsystemClass);

	// --------------------------------------------------------- asset helpers
	/**
	 * Resolves a soft object pointer, loading synchronously only when required.
	 * Centralising this means every system gets the same "missing asset" warning
	 * instead of each one inventing its own silent failure.
	 */
	template <typename TObjectType>
	static TObjectType* ResolveSoftObject(const TSoftObjectPtr<TObjectType>& SoftObject, const TCHAR* ContextDescription)
	{
		if (SoftObject.IsNull())
		{
			return nullptr;
		}

		if (SoftObject.IsValid())
		{
			return SoftObject.Get();
		}

		TObjectType* Loaded = SoftObject.LoadSynchronous();
		if (!Loaded)
		{
			UE_LOG(LogGameProjectError, Warning, TEXT("ResolveSoftObject: failed to load '%s' (%s)."),
				*SoftObject.ToSoftObjectPath().ToString(), ContextDescription ? ContextDescription : TEXT("no context"));
		}
		return Loaded;
	}

	/** Engine cube used for placeholder/test geometry. Never returns null unless the engine content is missing. */
	UFUNCTION(BlueprintCallable, Category = "GameProject|Core|Placeholders")
	static UStaticMesh* GetPlaceholderCubeMesh();

	UFUNCTION(BlueprintCallable, Category = "GameProject|Core|Placeholders")
	static UStaticMesh* GetPlaceholderPlaneMesh();

	UFUNCTION(BlueprintCallable, Category = "GameProject|Core|Placeholders")
	static UMaterialInterface* GetPlaceholderMaterial();

	// --------------------------------------------------------- formatting
	/** "08:15" style clock text from seconds-since-midnight. */
	UFUNCTION(BlueprintPure, Category = "GameProject|Core|Format")
	static FString FormatTimeOfDay(double SecondsSinceMidnight);

	/** Compact "(123, -45, 678)" text for on-screen debug lines. */
	UFUNCTION(BlueprintPure, Category = "GameProject|Core|Format")
	static FString FormatPosition(const FVector& Position);

	/** True in Development/DebugGame/editor builds; always false in Shipping and Test. */
	UFUNCTION(BlueprintPure, Category = "GameProject|Core|Debug")
	static bool AreDebugToolsAllowed();
};
