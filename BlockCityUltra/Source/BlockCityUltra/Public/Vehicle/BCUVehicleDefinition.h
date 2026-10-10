// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "Engine/DataAsset.h"
#include "UObject/SoftObjectPtr.h"
#include "BCUVehicleDefinition.generated.h"

class UStaticMesh;
class USkeletalMesh;
class UMaterialInterface;
class USoundBase;
class UAnimMontage;

UENUM(BlueprintType)
enum class EBCUVehicleClass : uint8
{
	Compact			UMETA(DisplayName = "Compact"),
	Sedan			UMETA(DisplayName = "Sedan"),
	Muscle			UMETA(DisplayName = "Muscle"),
	Super			UMETA(DisplayName = "Supercar"),
	SUV				UMETA(DisplayName = "SUV / Offroad"),
	Motorcycle		UMETA(DisplayName = "Motorcycle"),
	Van				UMETA(DisplayName = "Van"),
	Pickup			UMETA(DisplayName = "Pickup"),
	Truck			UMETA(DisplayName = "Truck / Semi"),
	Bus				UMETA(DisplayName = "Bus"),
	Police			UMETA(DisplayName = "Police Cruiser"),
	PoliceInterceptor UMETA(DisplayName = "Police Interceptor"),
	PoliceVan		UMETA(DisplayName = "Police Van"),
	Fire			UMETA(DisplayName = "Fire Engine"),
	Ambulance		UMETA(DisplayName = "Ambulance"),
	Taxi			UMETA(DisplayName = "Taxi"),
	Helicopter		UMETA(DisplayName = "Helicopter"),
	Boat			UMETA(DisplayName = "Boat")
};

UENUM(BlueprintType)
enum class EBCUDriveTrain : uint8
{
	RWD		UMETA(DisplayName = "Rear Wheel Drive"),
	FWD		UMETA(DisplayName = "Front Wheel Drive"),
	AWD		UMETA(DisplayName = "All Wheel Drive")
};

UENUM(BlueprintType)
enum class EBCUVehicleRarity : uint8
{
	Common		UMETA(DisplayName = "Common"),
	Uncommon	UMETA(DisplayName = "Uncommon"),
	Rare		UMETA(DisplayName = "Rare"),
	Epic		UMETA(DisplayName = "Epic"),
	Legendary	UMETA(DisplayName = "Legendary")
};

/** One wheel of the vehicle. Voxel bodies use short-travel cube wheels. */
USTRUCT(BlueprintType)
struct FBCUWheelSpec
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Wheel")
	FName WheelName = TEXT("FL");

	/** Offset from the vehicle root, in cm. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Wheel")
	FVector Location = FVector::ZeroVector;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Wheel", meta = (ClampMin = "1.0"))
	float RadiusCm = 34.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Wheel", meta = (ClampMin = "1.0"))
	float WidthCm = 22.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Wheel")
	bool bIsSteering = true;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Wheel")
	bool bIsPowered = false;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Wheel", meta = (ClampMin = "0.0"))
	float MaxSteerAngleDeg = 34.0f;

	/** Suspension travel and rates — tuned per class in the data table. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Wheel|Suspension", meta = (ClampMin = "0.0"))
	float SuspensionMaxDropCm = 18.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Wheel|Suspension", meta = (ClampMin = "0.0"))
	float SuspensionMaxCompressionCm = 16.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Wheel|Suspension", meta = (ClampMin = "0.0"))
	float SpringRate = 24000.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Wheel|Suspension", meta = (ClampMin = "0.0"))
	float DampingRatio = 0.62f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Wheel|Tyre", meta = (ClampMin = "0.0"))
	float TyreFrictionScale = 1.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Wheel|Tyre", meta = (ClampMin = "0.0"))
	float SlipThreshold = 0.34f;
};

/** A seat: driver plus passengers. Voxel interiors are modelled around these. */
USTRUCT(BlueprintType)
struct FBCUSeatSpec
{
	GENERATED_BODY()

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Seat")
	FName SeatName = TEXT("Driver");

	/** Local transform where the occupant is attached while seated. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Seat")
	FTransform SeatTransform = FTransform::Identity;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Seat")
	bool bIsDriverSeat = false;

	/** Door used to enter this seat (animation + entry-point offset). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Seat")
	FVector EntryOffset = FVector(-90.0f, 0.0f, 0.0f);

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|Seat")
	bool bCanEnterWhileMoving = false;
};

/**
 * Everything that defines one vehicle: performance, physics, voxel body recipe,
 * lights, audio, economy. Instances live in /Game/Data/Vehicles and are loaded
 * through the Asset Manager primary-asset type "BCUVehicle".
 *
 * All vehicle names and silhouettes are original creations.
 */
UCLASS(BlueprintType, meta = (DisplayName = "BCU Vehicle Definition"))
class BLOCKCITYULTRA_API UBCUVehicleDefinition : public UPrimaryDataAsset
{
	GENERATED_BODY()

public:
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Identity")
	FName VehicleId = NAME_None;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Identity")
	FText DisplayName;

	/** In-fiction manufacturer, e.g. "Kestrel Motors". Original. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Identity")
	FText Manufacturer;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Identity")
	EBCUVehicleClass VehicleClass = EBCUVehicleClass::Sedan;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Identity")
	EBCUVehicleRarity Rarity = EBCUVehicleRarity::Common;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Identity")
	FName ModelTag = TEXT("Generic");

	// ── Performance ─────────────────────────────────────────────────────────
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Performance", meta = (ClampMin = "0.0"))
	float MassKg = 1560.0f;

	/** Engine torque curve peak, in N·m at PeakTorqueRPM. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Performance", meta = (ClampMin = "0.0"))
	float PeakTorqueNm = 320.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Performance", meta = (ClampMin = "100.0"))
	float PeakTorqueRPM = 3600.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Performance", meta = (ClampMin = "100.0"))
	float MaxRPM = 6800.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Performance", meta = (ClampMin = "100.0"))
	float IdleRPM = 850.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Performance", meta = (ClampMin = "0.0"))
	float TopSpeedKmh = 205.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Performance")
	TArray<float> GearRatios = { 3.6f, 2.4f, 1.7f, 1.25f, 0.95f, 0.75f };

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Performance", meta = (ClampMin = "0.5"))
	float FinalDriveRatio = 3.4f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Performance")
	EBCUDriveTrain DriveTrain = EBCUDriveTrain::FWD;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Performance", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float BrakeTorqueNm = 2600.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Performance", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float HandbrakeTorqueNm = 3400.0f;

	/** 0 = pure road, 1 = pure offroad. Affects suspension + tyre model. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Performance", meta = (ClampMin = "0.0", ClampMax = "1.0"))
	float OffroadBias = 0.0f;

	/** Nitrous / boost: 0 disables the boost system. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Performance", meta = (ClampMin = "0.0"))
	float BoostTorqueMultiplier = 0.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Performance", meta = (ClampMin = "0.0"))
	float BoostDurationSeconds = 0.0f;

	// ── Physics / collision ─────────────────────────────────────────────────
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Physics")
	FVector CenterOfMassOffset = FVector(0.0f, 0.0f, -22.0f);

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Physics", meta = (ClampMin = "0.0"))
	float DragCoefficient = 0.34f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Physics", meta = (ClampMin = "0.0"))
	float RollingResistance = 0.015f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Physics", meta = (ClampMin = "0.0"))
	float DownforceCoefficient = 0.0f;

	/** Body health. Destruction is cosmetic-first (voxel panels pop off). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Physics", meta = (ClampMin = "1.0"))
	float BodyHealth = 1000.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Physics")
	bool bCanFlipBack = true;

	// ── Voxel body recipe ───────────────────────────────────────────────────
	/** Bounding box of the body in voxels; the generator carves from this. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Voxel")
	FIntVector BodyVoxelDimensions = FIntVector(9, 4, 19); // W, H, L in voxels

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Voxel", meta = (ClampMin = "1.0"))
	float VoxelSizeCm = 12.0f;

	/** Silhouette recipe id consumed by UBCUVehicleVoxelBuilder. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Voxel")
	FName BodyStyle = TEXT("Sedan");

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Voxel")
	TArray<FBCUWheelSpec> Wheels;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Voxel")
	TArray<FBCUSeatSpec> Seats;

	// ── Materials / lights ──────────────────────────────────────────────────
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Materials")
	TSoftObjectPtr<UMaterialInterface> PaintMaterial;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Materials")
	TSoftObjectPtr<UMaterialInterface> GlassMaterial;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Materials")
	TSoftObjectPtr<UMaterialInterface> TrimMaterial;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Materials")
	TSoftObjectPtr<UMaterialInterface> TyreMaterial;

	/** Headlight/taillight emissive intensity at night (candela-ish). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Lights", meta = (ClampMin = "0.0"))
	float HeadlightIntensity = 12000.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Lights", meta = (ClampMin = "0.0"))
	float BrakeLightIntensity = 4000.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Lights")
	FLinearColor HeadlightColor = FLinearColor(1.0f, 0.97f, 0.9f);

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Lights")
	FLinearColor BrakeLightColor = FLinearColor(1.0f, 0.06f, 0.04f);

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Lights")
	bool bHasEmergencyLightbar = false;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Lights")
	FLinearColor EmergencyColorA = FLinearColor(0.9f, 0.05f, 0.05f);

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Lights")
	FLinearColor EmergencyColorB = FLinearColor(0.05f, 0.2f, 1.0f);

	// ── Audio ───────────────────────────────────────────────────────────────
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Audio")
	TSoftObjectPtr<USoundBase> EngineIdleSound;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Audio")
	TSoftObjectPtr<USoundBase> EngineLoadSound;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Audio")
	TSoftObjectPtr<USoundBase> HornSound;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Audio")
	TSoftObjectPtr<USoundBase> SirenSound;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Audio")
	TSoftObjectPtr<USoundBase> TyreSkidSound;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Audio", meta = (ClampMin = "0.0"))
	float EnginePitchScale = 1.0f;

	// ── Economy ─────────────────────────────────────────────────────────────
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Economy", meta = (ClampMin = "0"))
	int32 PurchasePrice = 24000;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Economy", meta = (ClampMin = "0"))
	int32 ResaleValue = 14000;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Economy", meta = (ClampMin = "0"))
	int32 RepairCostPerHealthPoint = 4;

	/** Fuel economy: litres per 100 km at cruise. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Economy", meta = (ClampMin = "0.0"))
	float FuelLitresPer100Km = 7.4f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Economy", meta = (ClampMin = "0.0"))
	float FuelTankLitres = 62.0f;

	/** Upgrade ceilings for the garage (0..5 levels each). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Economy")
	int32 MaxEngineLevel = 5;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Economy")
	int32 MaxHandlingLevel = 5;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Economy")
	int32 MaxBrakeLevel = 5;

	// ── Customisation ───────────────────────────────────────────────────────
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Customisation")
	TArray<FLinearColor> FactoryPaintColors;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Customisation")
	TArray<FName> AvailableWheelStyles;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Customisation")
	TArray<FName> AvailableDecals;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Customisation")
	TArray<FName> AvailableBodyKits;

	// ── Meshes (optional; the voxel builder generates one when null) ────────
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Assets")
	TSoftObjectPtr<UStaticMesh> BodyMeshOverride;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Assets")
	TSoftObjectPtr<USkeletalMesh> InteriorMesh;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Assets")
	TSoftObjectPtr<UAnimMontage> EnterMontage;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|Vehicle|Assets")
	TSoftObjectPtr<UAnimMontage> ExitMontage;

	//~ UPrimaryDataAsset
	virtual FPrimaryAssetId GetPrimaryAssetId() const override
	{
		return FPrimaryAssetId(TEXT("BCUVehicle"), VehicleId);
	}
	//~ End

	/** Derived top speed in cm/s (Chaos works in cm). */
	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|Performance")
	float GetTopSpeedCmPerSecond() const { return TopSpeedKmh * 2777.78f; }

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|Performance")
	bool IsPoliceVehicle() const
	{
		return VehicleClass == EBCUVehicleClass::Police
			|| VehicleClass == EBCUVehicleClass::PoliceInterceptor
			|| VehicleClass == EBCUVehicleClass::PoliceVan;
	}

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|Performance")
	bool IsEmergencyVehicle() const { return IsPoliceVehicle()
		|| VehicleClass == EBCUVehicleClass::Fire || VehicleClass == EBCUVehicleClass::Ambulance; }

	UFUNCTION(BlueprintPure, Category = "BCU|Vehicle|Performance")
	bool IsTwoWheeler() const { return VehicleClass == EBCUVehicleClass::Motorcycle; }

	/** Seat index of the driver, or INDEX_NONE when the vehicle is unmanned. */
	int32 GetDriverSeatIndex() const;
};
