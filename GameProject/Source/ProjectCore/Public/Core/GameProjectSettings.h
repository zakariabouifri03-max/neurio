// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "Engine/DeveloperSettings.h"
#include "Engine/EngineTypes.h"
#include "GameProjectSettings.generated.h"

class AOpenWorldTestAreaBuilder;
class UStaticMesh;
class UOpenWorldInputConfig;
class UOpenWorldMovementSettings;
class UVoxelBlockRegistry;
class AVoxelWorldManager;
class AVoxelChunkActor;
class UOpenWorldHUDWidget;

/**
 * Project-wide tunables (Project Settings -> Game -> Game Project).
 *
 * Rule enforced across the codebase: anything a designer might want to change
 * per build/per platform lives here or in a Data Asset - never as a literal in
 * a .cpp. That keeps future phases (vehicles, interiors, missions) from having
 * to recompile to retune the game.
 */
UCLASS(config = Game, defaultconfig, meta = (DisplayName = "Game Project"))
class PROJECTCORE_API UGameProjectSettings : public UDeveloperSettings
{
	GENERATED_BODY()

public:
	UGameProjectSettings();

	/** Convenience accessor; always valid because it returns the CDO. */
	static const UGameProjectSettings& Get() { return *GetDefault<UGameProjectSettings>(); }

	virtual FName GetCategoryName() const override { return TEXT("Game"); }

	// ------------------------------------------------------------- General
	/** Enables Verbose logging for GameProject categories at startup. */
	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "General")
	bool bEnableVerboseLogging = false;

	/** Whether debug tooling starts enabled (ignored in Shipping/Test builds). */
	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "General")
	bool bEnableDebugToolsByDefault = true;

	// ------------------------------------------------------------- Data assets
	/** Enhanced Input configuration (IMC + IAs). If null, a runtime fallback IMC is built in C++. */
	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Input")
	TSoftObjectPtr<UOpenWorldInputConfig> InputConfig;

	/** Movement tuning (speeds, accel, rotation rates, crouch, jump). */
	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Player")
	TSoftObjectPtr<UOpenWorldMovementSettings> MovementSettings;

	/** Block id -> definition registry for the voxel system. */
	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Voxel")
	TSoftObjectPtr<UVoxelBlockRegistry> VoxelBlockRegistry;

	/** Widget class used for the player HUD (WBP_PlayerHUD). */
	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "UI")
	TSoftClassPtr<UOpenWorldHUDWidget> PlayerHUDWidgetClass;

	/** Actor spawned by the game mode to build the Phase 01 test environment. */
	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "World|Test")
	TSoftClassPtr<AOpenWorldTestAreaBuilder> DefaultTestWorldBuilderClass;

	// ------------------------------------------------------------- Voxel
	/** Unit mesh used for one voxel block. Phase 01 renders blocks as instances of this. */
	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Voxel")
	TSoftObjectPtr<UStaticMesh> VoxelBlockMesh;

	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Voxel")
	TSoftClassPtr<AVoxelWorldManager> VoxelWorldManagerClass;

	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Voxel")
	TSoftClassPtr<AVoxelChunkActor> VoxelChunkActorClass;

	/** Blocks per chunk edge (X and Y). Power of two keeps index math branch-free. */
	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Voxel", meta = (ClampMin = "4", ClampMax = "64", EditCondition = "false"))
	int32 ChunkSize = 16;

	/** Blocks per chunk on Z. */
	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Voxel", meta = (ClampMin = "8", ClampMax = "256", EditCondition = "false"))
	int32 ChunkHeight = 64;

	/** World-space size of one block in cm. 100 == 1 metre blocks (Minecraft-like). */
	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Voxel", meta = (ClampMin = "10.0", ClampMax = "1000.0"))
	float BlockWorldSize = 100.0f;

	/** Chunks loaded around the focus point at startup. */
	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Voxel|Streaming", meta = (ClampMin = "0", ClampMax = "16"))
	int32 InitialChunkRadius = 2;

	/** Hard clamp on the runtime load radius (chunks). */
	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Voxel|Streaming", meta = (ClampMin = "1", ClampMax = "32"))
	int32 MaxChunkRadius = 8;

	/** Frame budget guards: these are what keep chunk streaming from hitching. */
	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Voxel|Streaming", meta = (ClampMin = "1", ClampMax = "32"))
	int32 MaxChunksGeneratedPerFrame = 2;

	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Voxel|Streaming", meta = (ClampMin = "1", ClampMax = "32"))
	int32 MaxChunksRebuiltPerFrame = 3;

	/** Milliseconds of the frame the voxel system may spend on generation/rebuild. */
	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Voxel|Streaming", meta = (ClampMin = "0.1", ClampMax = "8.0"))
	float VoxelFrameBudgetMs = 2.0f;

	// ------------------------------------------------------------- Interaction
	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Interaction")
	TEnumAsByte<ECollisionChannel> InteractionTraceChannel = ECC_Visibility;

	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Interaction", meta = (ClampMin = "50.0", ClampMax = "10000.0"))
	float InteractionTraceDistance = 400.0f;

	/** >0 turns the interaction probe into a sphere trace (more forgiving UI). */
	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Interaction", meta = (ClampMin = "0.0", ClampMax = "200.0"))
	float InteractionTraceRadius = 12.0f;

	/**
	 * How often the interaction probe runs, in seconds. This is a timer, not Tick:
	 * a 20 Hz probe is indistinguishable from per-frame for UI focus but costs a
	 * fraction of the trace budget when the player is standing still.
	 */
	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Interaction", meta = (ClampMin = "0.01", ClampMax = "1.0"))
	float InteractionScanInterval = 0.05f;

	// ------------------------------------------------------------- Placeholder visuals
	/** Engine meshes used by debug/test builders when no authored asset exists. */
	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Placeholders")
	TSoftObjectPtr<UStaticMesh> PlaceholderCubeMesh;

	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Placeholders")
	TSoftObjectPtr<UStaticMesh> PlaceholderPlaneMesh;

	// ------------------------------------------------------------- World time
	/** Seconds since midnight when a new world starts. 28800 == 08:00. */
	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "World|Time", meta = (ClampMin = "0.0"))
	double WorldTimeStartSeconds = 28800.0;

	/**
	 * Phase 01 keeps the clock *paused* - day/night is a later phase. The state
	 * and replication already exist so nothing has to be rewritten then.
	 */
	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "World|Time")
	bool bWorldTimeAdvances = false;

	/** Length of one in-game day in real seconds, used when the clock advances. */
	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "World|Time", meta = (ClampMin = "60.0"))
	double WorldTimeDayLengthSeconds = 1440.0;

	// ------------------------------------------------------------- Validation
#if WITH_EDITOR
	virtual EDataValidationResult IsDataValid(class FDataValidationContext& ValidationContext) const override;
#endif

private:
	/** Guards against ChunkSize values that would break the branch-free index math. */
	bool IsChunkSizePowerOfTwo() const;
};
