// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "GameProjectSettingsTypes.generated.h"

/**
 * Everything the player can change in the options menu, in one serialisable
 * struct. Keeping it a USTRUCT (not loose members on a subsystem) means:
 *  - it can be written straight into USaveGameProject with SaveGame meta,
 *  - it can be diffed/applied as a unit,
 *  - adding a setting never changes the subsystem's public API.
 */
USTRUCT(BlueprintType)
struct FGameProjectGraphicsSettings
{
	GENERATED_BODY()

	/** 0=Low 1=Medium 2=High 3=Epic 4=Cinematic. -1 = leave the engine default alone. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Graphics", meta = (ClampMin = "-1", ClampMax = "4"))
	int32 OverallQuality = -1;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Graphics", meta = (ClampMin = "-1", ClampMax = "4"))
	int32 ViewDistanceQuality = -1;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Graphics", meta = (ClampMin = "-1", ClampMax = "4"))
	int32 ShadowQuality = -1;

	/** 0 = windowed, 1 = windowed fullscreen, 2 = fullscreen. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Graphics", meta = (ClampMin = "0", ClampMax = "2"))
	int32 WindowMode = 1;

	/** Zero means "keep the current desktop resolution". */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Graphics")
	FIntPoint Resolution = FIntPoint::ZeroValue;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Graphics")
	bool bVSync = false;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Graphics", meta = (ClampMin = "0.0", ClampMax = "240.0"))
	float FrameRateLimit = 0.0f;
};

USTRUCT(BlueprintType)
struct FGameProjectAudioSettings
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Audio", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float MasterVolume = 1.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Audio", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float EffectsVolume = 1.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Audio", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float MusicVolume = 1.0f;
};

USTRUCT(BlueprintType)
struct FGameProjectInputSettings
{
	GENERATED_BODY()

	/** Multiplied into the raw look axis before it reaches the pawn. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Input", meta = (ClampMin = "0.05", ClampMax = "5.0"))
	float MouseSensitivity = 1.0f;

	/** Separate scalar so gamepad and mouse players do not fight over one value. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Input", meta = (ClampMin = "0.05", ClampMax = "5.0"))
	float GamepadLookSensitivity = 1.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Input")
	bool bInvertLookY = false;

	/** Multiplied into the camera rig's response; distinct from raw device sensitivity. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Input", meta = (ClampMin = "0.05", ClampMax = "5.0"))
	float CameraSensitivity = 1.0f;
};

/** Aggregate of the three groups above. This is what gets persisted. */
USTRUCT(BlueprintType)
struct FGameProjectUserSettings
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Settings")
	FGameProjectGraphicsSettings Graphics;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Settings")
	FGameProjectAudioSettings Audio;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, SaveGame, Category = "Settings")
	FGameProjectInputSettings Input;

	/** Bumped whenever a persisted layout changes so old saves can be migrated. */
	UPROPERTY(BlueprintReadOnly, SaveGame, Category = "Settings")
	int32 SettingsVersion = 1;
};
