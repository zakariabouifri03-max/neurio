// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "Engine/DeveloperSettings.h"
#include "GameProjectDebugTypes.generated.h"

/**
 * Debug channels. Bitmask-backed so "is this on?" is a single AND, which matters
 * because these are queried from HUD refreshes and draw calls.
 */
UENUM(BlueprintType, meta = (Bitflags, UseEnumValuesAsMaskValuesInEditor = "true"))
enum class EGameProjectDebugChannel : uint8
{
	// Eight channels is a hard limit of the uint8 bitmask. That is deliberate: a
	// debug menu nobody can read at a glance is a debug menu nobody uses. Voxel
	// sub-detail (bounds vs queue vs timings) is a nested toggle inside
	// VoxelVisualisation rather than three more top-level channels.
	None					= 0,
	FPS						= 1 << 0,
	PlayerInfo				= 1 << 1,
	ChunkInfo				= 1 << 2,
	StreamingInfo			= 1 << 3,
	CollisionVisualisation	= 1 << 4,
	InteractionTrace		= 1 << 5,
	VoxelVisualisation		= 1 << 6,
	Memory					= 1 << 7,

	All						= 0xFF
};
ENUM_CLASS_FLAGS(EGameProjectDebugChannel);

/** Developer defaults for the debug subsystem, editable in Project Settings. */
UCLASS(config = Game, defaultconfig, meta = (DisplayName = "Game Project Debug"))
class PROJECTCORE_API UGameProjectDebugSettings : public UDeveloperSettings
{
	GENERATED_BODY()

public:
	UGameProjectDebugSettings() = default;

	static const UGameProjectDebugSettings& Get() { return *GetDefault<UGameProjectDebugSettings>(); }

	virtual FName GetCategoryName() const override { return TEXT("Game"); }

	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Startup")
	bool bStartWithFPSDisplay = false;

	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Startup")
	bool bStartWithPlayerInfo = false;

	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Startup")
	bool bStartWithChunkInfo = false;

	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Startup")
	bool bStartWithStreamingInfo = false;

	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Startup")
	bool bStartWithCollisionVisualisation = false;

	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Startup")
	bool bStartWithInteractionTraceVisualisation = false;

	/** When false, channels stay registered but nothing is drawn. Useful in Test builds. */
	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Behaviour")
	bool bDrawDebugOnlyWhenEnabled = true;

	/** How often the on-screen debug text block is rebuilt, in seconds. */
	UPROPERTY(config, EditAnywhere, BlueprintReadOnly, Category = "Behaviour", meta = (ClampMin = "0.05", ClampMax = "2.0"))
	float DebugTextRefreshInterval = 0.25f;
};
