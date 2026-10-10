// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "Subsystems/GameInstanceSubsystem.h"
#include "BCUInputSubsystem.generated.h"

class UInputMappingContext;
class UInputAction;

/** One rebindable action. */
USTRUCT(BlueprintType)
struct FBCUInputBinding
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Input")
	FName ActionId = NAME_None;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Input")
	FText DisplayName;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Input")
	FKey PrimaryKey;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Input")
	FKey SecondaryKey;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Input")
	FKey GamepadKey;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Input")
	FName Category = TEXT("General");

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Input")
	FKey UserPrimaryKey;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "BCU|Input")
	FKey UserSecondaryKey;
};

/**
 * Rebinding, mouse/gamepad sensitivity, inversion and the action help list.
 * Kept separate from ABCUPlayerController so bindings survive map travel and
 * can be edited from the options menu while the game is paused.
 */
UCLASS(config = Game, Blueprintable)
class BLOCKCITYULTRA_API UBCUInputSubsystem : public UGameInstanceSubsystem
{
	GENERATED_BODY()

public:
	virtual void Initialize(FSubsystemCollectionBase& Collection) override;
	virtual void Deinitialize() override;

	UFUNCTION(BlueprintPure, Category = "BCU|Input")
	const TArray<FBCUInputBinding>& GetBindings() const { return Bindings; }

	UFUNCTION(BlueprintCallable, Category = "BCU|Input")
	TArray<FBCUInputBinding> GetBindingsInCategory(FName Category) const;

	/** Rebinds an action; returns false on a conflict the user must resolve. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Input")
	bool RebindAction(FName ActionId, int32 SlotIndex, const FKey& NewKey);

	UFUNCTION(BlueprintCallable, Category = "BCU|Input")
	void ResetBindingsToDefault();

	/** Pushes the current bindings into the Enhanced Input mapping contexts. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Input")
	void ApplyBindings();

	UFUNCTION(BlueprintCallable, Category = "BCU|Input")
	void SetMouseSensitivity(float Value);

	UFUNCTION(BlueprintCallable, Category = "BCU|Input")
	void SetGamepadSensitivity(float Value);

	UFUNCTION(BlueprintCallable, Category = "BCU|Input")
	void SetInvertLookY(bool bInvert);

	UFUNCTION(BlueprintPure, Category = "BCU|Input")
	float GetMouseSensitivity() const { return MouseSensitivity; }

	UFUNCTION(BlueprintPure, Category = "BCU|Input")
	float GetGamepadSensitivity() const { return GamepadSensitivity; }

	UFUNCTION(BlueprintPure, Category = "BCU|Input")
	bool GetInvertLookY() const { return bInvertLookY; }

protected:
	UPROPERTY(EditAnywhere, config, Category = "BCU|Input")
	TArray<FBCUInputBinding> Bindings;

	UPROPERTY(EditAnywhere, config, Category = "BCU|Input")
	float MouseSensitivity = 1.0f;

	UPROPERTY(EditAnywhere, config, Category = "BCU|Input")
	float GamepadSensitivity = 1.0f;

	UPROPERTY(EditAnywhere, config, Category = "BCU|Input")
	bool bInvertLookY = false;

	void EnsureDefaultBindings();
};
