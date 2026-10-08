// Copyright GameProject. All rights reserved. Original content only.

#include "World/OpenWorldStreamingSourceComponent.h"

#include "Core/GameProjectLog.h"
#include "GameFramework/Actor.h"

UOpenWorldStreamingSourceComponent::UOpenWorldStreamingSourceComponent()
{
	PrimaryComponentTick.bCanEverTick = false; // WP polls sources itself.
	bEnabled = true;
}

FName UOpenWorldStreamingSourceComponent::GetStreamingSourceName() const
{
	// Stable per component so WP can match this frame's source against last
	// frame's; a name that changes would look like a source being removed and
	// re-added, forcing cells to reload.
	return *FString::Printf(TEXT("GameProject_%s"), *GetName());
}

#if GAMEPROJECT_WITH_WP_STREAMING_SOURCE
bool UOpenWorldStreamingSourceComponent::GetStreamingSource(FWorldPartitionStreamingSource& OutStreamingSource) const
{
	if (!bEnabled)
	{
		return false;
	}

	const AActor* Owner = GetOwner();
	if (!IsValid(Owner))
	{
		return false;
	}

	const FVector Velocity = Owner->GetVelocity();

	OutStreamingSource = FWorldPartitionStreamingSource(
		GetStreamingSourceName(),
		Owner->GetActorLocation(),
		Owner->GetActorRotation(),
		EStreamingSourceTargetState::Activated,
		bBlockOnSlowLoading,
		EStreamingSourcePriority::Default,
		/*bRemote*/ false,
		Velocity);

	OutStreamingSource.ExtraRadius = ExtraLoadingRadius;

	// An empty TargetGrids set means "affects every grid" (see
	// FStreamingSourceShapeHelper::IsSourceAffectingGrid), which is the default we
	// want; naming a grid narrows this source to it.
	OutStreamingSource.TargetGrids.Reset();
	if (!TargetGrid.IsNone())
	{
		OutStreamingSource.TargetGrids.Add(TargetGrid);
	}

	if (bVisualize)
	{
		// WP has no bVisualize flag on the source itself; a non-zero DebugColor is
		// what makes it show up in the editor's streaming visualisation.
		OutStreamingSource.DebugColor = FColor::Orange;
	}

	// One shape describing the source. Using an explicit shape (rather than leaving
	// it empty) is what makes the velocity stretch possible.
	FStreamingSourceShape Shape;
	Shape.bUseGridLoadingRange = LoadingRangeScale <= 0.0f;
	Shape.LoadingRangeScale = LoadingRangeScale;
	Shape.Radius = ExtraLoadingRadius;
	Shape.bIsSector = false;

	if (bStretchAlongVelocity)
	{
		if (!Velocity.IsNearlyZero())
		{
			// Offset the sphere forward so cells in the direction of travel are
			// requested earlier. This is the single cheapest way to hide streaming
			// at vehicle speed and needs no change to the grid itself.
			const FVector Forward = Velocity.GetSafeNormal();
			Shape.Location = Forward * (VelocityStretchDistance * 0.5f);
			Shape.Radius = FMath::Max(Shape.Radius, VelocityStretchDistance * 0.5f);
		}
	}

	OutStreamingSource.Shapes.Reset();
	OutStreamingSource.Shapes.Add(Shape);

	return true;
}
#endif
