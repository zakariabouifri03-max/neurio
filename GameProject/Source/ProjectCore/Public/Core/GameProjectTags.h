// Copyright GameProject. All rights reserved. Original content only.

#pragma once

#include "CoreMinimal.h"
#include "GameplayTagContainer.h"
#include "Core/GameProjectLog.h"

/**
 * Single source of truth for the project's gameplay tag names.
 *
 * Tags are registered in Config/DefaultGame.ini ([/Script/GameplayTags.GameplayTagsManager])
 * so designers see them in every tag picker. C++ never spells the strings inline:
 * it calls these accessors, which means a typo is a compile error at the call
 * site instead of a silent "tag not found" at runtime.
 *
 * The function-local statics are intentional - they resolve on first use, which
 * is always after the tag manager has read the ini. Resolving tags in a
 * constructor or a static initialiser is a known order-of-init trap.
 */
namespace GameProjectTags
{
	/**
	 * Game-thread only. Returns by value on purpose: a reference into the cache
	 * would dangle the moment the map rehashes.
	 */
	inline FGameplayTag Request(const TCHAR* TagName)
	{
		static TMap<FName, FGameplayTag> Cache;

		const FName Name(TagName);
		if (const FGameplayTag* Found = Cache.Find(Name))
		{
			return *Found;
		}

		// ErrorIfNotFound=false: a missing tag degrades to "no tag" instead of
		// asserting, which keeps a partially-configured build playable.
		const FGameplayTag Tag = FGameplayTag::RequestGameplayTag(Name, /*bErrorIfNotFound*/ false);
		if (!Tag.IsValid())
		{
			UE_LOG(LogTemp, Warning, TEXT("GameProjectTags: '%s' is not registered - add it to DefaultGame.ini."), TagName);
		}

		Cache.Add(Name, Tag);
		return Tag;
	}

	// ---------------------------------------------------------- Interaction
	inline FGameplayTag InteractionCategoryDoor()     { return Request(TEXT("Interaction.Category.Door")); }
	inline FGameplayTag InteractionCategoryVehicle()  { return Request(TEXT("Interaction.Category.Vehicle")); }
	inline FGameplayTag InteractionCategoryNpc()      { return Request(TEXT("Interaction.Category.Npc")); }
	inline FGameplayTag InteractionCategoryShop()     { return Request(TEXT("Interaction.Category.Shop")); }
	inline FGameplayTag InteractionCategoryPickup()   { return Request(TEXT("Interaction.Category.Pickup")); }
	inline FGameplayTag InteractionCategoryMission()  { return Request(TEXT("Interaction.Category.Mission")); }
	inline FGameplayTag InteractionCategoryFurniture(){ return Request(TEXT("Interaction.Category.Furniture")); }
	inline FGameplayTag InteractionCategoryBuilding() { return Request(TEXT("Interaction.Category.Building")); }
	inline FGameplayTag InteractionCategorySavePoint(){ return Request(TEXT("Interaction.Category.SavePoint")); }
	inline FGameplayTag InteractionCategoryVoxel()    { return Request(TEXT("Interaction.Category.Voxel")); }

	// ---------------------------------------------------------- Player state
	inline FGameplayTag PlayerStateSprinting() { return Request(TEXT("Player.State.Sprinting")); }
	inline FGameplayTag PlayerStateCrouching() { return Request(TEXT("Player.State.Crouching")); }
	inline FGameplayTag PlayerStateInAir()     { return Request(TEXT("Player.State.InAir")); }
	inline FGameplayTag PlayerStateInVehicle() { return Request(TEXT("Player.State.InVehicle")); }
	inline FGameplayTag PlayerStateIndoors()   { return Request(TEXT("Player.State.Indoors")); }

	// ---------------------------------------------------------- Camera
	inline FGameplayTag CameraModeDefault()   { return Request(TEXT("Camera.Mode.Default")); }
	inline FGameplayTag CameraModeVehicle()   { return Request(TEXT("Camera.Mode.Vehicle")); }
	inline FGameplayTag CameraModeInterior()  { return Request(TEXT("Camera.Mode.Interior")); }
	inline FGameplayTag CameraModeAim()       { return Request(TEXT("Camera.Mode.Aim")); }
	inline FGameplayTag CameraModeCinematic() { return Request(TEXT("Camera.Mode.Cinematic")); }

	// ---------------------------------------------------------- Voxel
	inline FGameplayTag VoxelBlockGrass()    { return Request(TEXT("Voxel.Block.Grass")); }
	inline FGameplayTag VoxelBlockDirt()     { return Request(TEXT("Voxel.Block.Dirt")); }
	inline FGameplayTag VoxelBlockStone()    { return Request(TEXT("Voxel.Block.Stone")); }
	inline FGameplayTag VoxelBlockSand()     { return Request(TEXT("Voxel.Block.Sand")); }
	inline FGameplayTag VoxelBlockConcrete() { return Request(TEXT("Voxel.Block.Concrete")); }
	inline FGameplayTag VoxelBlockWood()     { return Request(TEXT("Voxel.Block.Wood")); }
	inline FGameplayTag VoxelBlockGlass()    { return Request(TEXT("Voxel.Block.Glass")); }
	inline FGameplayTag VoxelBlockRoad()     { return Request(TEXT("Voxel.Block.Road")); }

	// ---------------------------------------------------------- Debug
	inline FGameplayTag DebugChannelVoxel()       { return Request(TEXT("Debug.Channel.Voxel")); }
	inline FGameplayTag DebugChannelStreaming()   { return Request(TEXT("Debug.Channel.Streaming")); }
	inline FGameplayTag DebugChannelInteraction() { return Request(TEXT("Debug.Channel.Interaction")); }
	inline FGameplayTag DebugChannelPlayer()      { return Request(TEXT("Debug.Channel.Player")); }
}
