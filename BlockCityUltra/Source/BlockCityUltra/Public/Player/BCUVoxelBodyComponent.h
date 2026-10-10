// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "Components/ActorComponent.h"
#include "BCUVoxelBodyComponent.generated.h"

class UInstancedStaticMeshComponent;
class UStaticMesh;
class UMaterialInterface;

/** One cubic body part: head, torso, arm, leg, hat, etc. */
USTRUCT(BlueprintType)
struct FBCUBodyPart
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Body")
	FName PartName = TEXT("Torso");

	/** Size in voxels (a 1-voxel head is 4×4×4 at 6 cm). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Body")
	FIntVector VoxelDimensions = FIntVector(4, 3, 5);

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Body")
	float VoxelSizeCm = 6.0f;

	/** Rest pose offset from the actor root. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Body")
	FVector RestLocation = FVector::ZeroVector;

	/** Which palette slot colours this part (skin, shirt, trousers, shoes). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Body", meta = (ClampMin = "0", ClampMax = "3"))
	int32 PaletteSlot = 0;

	/** Animation bone this part follows. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Body")
	FName FollowBone = NAME_None;

	/** True for parts that are removed when the character sits in a car. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Body")
	bool bHiddenWhenSeated = false;
};

/**
 * Builds a character out of cubes.
 *
 * Each part is one InstancedStaticMeshComponent instance of a unit cube, scaled
 * to the part's voxel dimensions. The result is a genuinely blocky silhouette
 * that still deforms with the animation blueprint (each part follows a bone),
 * and it costs ~10 instances and one draw call per character.
 */
UCLASS(ClassGroup = (BCU), meta = (BlueprintSpawnableComponent))
class BLOCKCITYULTRA_API UBCUVoxelBodyComponent : public UActorComponent
{
	GENERATED_BODY()

public:
	UBCUVoxelBodyComponent();

	virtual void BeginPlay() override;

	/** Builds (or rebuilds) every part from the Parts array. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Body")
	void BuildBody();

	/** Applies an outfit preset from DT_CharacterCustomisation. */
	UFUNCTION(BlueprintCallable, Category = "BCU|Body")
	void ApplyOutfit(FName OutfitId);

	UFUNCTION(BlueprintCallable, Category = "BCU|Body")
	void SetPalette(const FLinearColor& Skin, const FLinearColor& Shirt,
		const FLinearColor& Trousers, const FLinearColor& Shoes);

	/** Poses the body inside a vehicle seat (legs bent, arms on the wheel). */
	UFUNCTION(BlueprintCallable, Category = "BCU|Body")
	void SetSeatedPose(const FTransform& SeatTransform);

	UFUNCTION(BlueprintCallable, Category = "BCU|Body")
	void SetStandingPose();

	/** Default humanoid recipe: 9 parts, ~1.4k triangles total. */
	static void GetDefaultHumanoidParts(TArray<FBCUBodyPart>& OutParts);

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Body")
	TArray<FBCUBodyPart> Parts;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Body")
	FLinearColor SkinColor = FLinearColor(0.78f, 0.60f, 0.47f);

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Body")
	FLinearColor ShirtColor = FLinearColor(0.16f, 0.32f, 0.55f);

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Body")
	FLinearColor TrouserColor = FLinearColor(0.14f, 0.14f, 0.17f);

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Body")
	FLinearColor ShoeColor = FLinearColor(0.08f, 0.07f, 0.06f);

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Body")
	TSoftObjectPtr<UMaterialInterface> BodyMaterial;

protected:
	UPROPERTY(Transient)
	TObjectPtr<UInstancedStaticMeshComponent> InstanceComponent;

	UPROPERTY(Transient)
	TObjectPtr<UStaticMesh> CubeMesh;

	bool bSeated = false;
	FTransform SeatedTransform = FTransform::Identity;

	void EnsureCubeMesh();
	FLinearColor ColorForSlot(int32 Slot) const;
};
