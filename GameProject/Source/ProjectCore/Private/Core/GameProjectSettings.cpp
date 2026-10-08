// Copyright GameProject. All rights reserved. Original content only.

#include "Core/GameProjectSettings.h"

#include "Core/GameProjectLog.h"
#include "Engine/StaticMesh.h"
#include "ProjectCore.h"

#if WITH_EDITOR
#include "Misc/DataValidation.h"
#endif

UGameProjectSettings::UGameProjectSettings()
{
	// Point the placeholder meshes at engine content that always exists, so a
	// fresh clone renders something instead of logging "mesh not found".
	PlaceholderCubeMesh = TSoftObjectPtr<UStaticMesh>(FSoftObjectPath(GameProject::FallbackCubeMeshPath));
	PlaceholderPlaneMesh = TSoftObjectPtr<UStaticMesh>(FSoftObjectPath(GameProject::FallbackPlaneMeshPath));
	VoxelBlockMesh = TSoftObjectPtr<UStaticMesh>(FSoftObjectPath(GameProject::FallbackCubeMeshPath));
}

bool UGameProjectSettings::IsChunkSizePowerOfTwo() const
{
	return ChunkSize > 0 && (ChunkSize & (ChunkSize - 1)) == 0;
}

#if WITH_EDITOR
EDataValidationResult UGameProjectSettings::IsDataValid(FDataValidationContext& ValidationContext) const
{
	EDataValidationResult Result = Super::IsDataValid(ValidationContext);

	if (!IsChunkSizePowerOfTwo())
	{
		ValidationContext.AddError(FText::FromString(
			FString::Printf(TEXT("ChunkSize (%d) must be a power of two."), ChunkSize)));
		Result = EDataValidationResult::Invalid;
	}

	if (ChunkHeight <= 0)
	{
		ValidationContext.AddError(FText::FromString(TEXT("ChunkHeight must be > 0.")));
		Result = EDataValidationResult::Invalid;
	}

	if (InitialChunkRadius > MaxChunkRadius)
	{
		ValidationContext.AddWarning(FText::FromString(
			TEXT("InitialChunkRadius is larger than MaxChunkRadius; it will be clamped.")));
	}

	if (InteractionTraceRadius > 0.0f && InteractionTraceRadius > InteractionTraceDistance * 0.25f)
	{
		ValidationContext.AddWarning(FText::FromString(
			TEXT("InteractionTraceRadius is very large relative to the trace distance.")));
	}

	return Result;
}
#endif
