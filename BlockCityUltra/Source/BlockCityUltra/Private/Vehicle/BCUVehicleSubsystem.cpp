// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Vehicle/BCUVehicleSubsystem.h"

#include "Vehicle/BCUBaseVehicle.h"
#include "Vehicle/BCUVehicleVoxelBuilder.h"
#include "World/City/BCUCityStreamer.h"
#include "World/City/BCUDistrictDataAsset.h"
#include "Player/BCUEconomySubsystem.h"
#include "Engine/AssetManager.h"
#include "EngineUtils.h"
#include "Kismet/GameplayStatics.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUVehicles, Log, All);

void UBCUVehicleSubsystem::Initialize(FSubsystemCollectionBase& Collection)
{
	Super::Initialize(Collection);
	RefreshCatalogue();
}

void UBCUVehicleSubsystem::Deinitialize()
{
	MeshCache.Empty();
	Super::Deinitialize();
}

void UBCUVehicleSubsystem::RefreshCatalogue()
{
	Catalogue.Reset();

	if (UAssetManager* Manager = UAssetManager::GetIfInitialized())
	{
		TArray<FPrimaryAssetId> Ids;
		Manager->GetAssetListForPrimaryAssetTypes(
			TArray<FPrimaryAssetType>{ FPrimaryAssetType(TEXT("BCUVehicle")) }, Ids);

		for (const FPrimaryAssetId& Id : Ids)
		{
			if (UBCUVehicleDefinition* Def = Cast<UBCUVehicleDefinition>(Manager->GetPrimaryAssetObject(Id)))
			{
				Catalogue.Add(Def);
			}
		}
	}

	// Content-scan fallback so the project runs before any data table exists.
	if (Catalogue.Num() == 0)
	{
		for (TObjectIterator<UClass> It; It; ++It)
		{
			if (!It->IsChildOf(UBCUVehicleDefinition::StaticClass()) || It->HasAnyClassFlags(CLASS_Abstract))
			{
				continue;
			}

			if (UBCUVehicleDefinition* CDO = Cast<UBCUVehicleDefinition>(It->GetDefaultObject()))
			{
				if (CDO->VehicleId.IsValid()) { Catalogue.Add(CDO); }
			}
		}
	}

	UE_LOG(LogBCUVehicles, Log, TEXT("Vehicle catalogue: %d definitions"), Catalogue.Num());
}

UBCUVehicleDefinition* UBCUVehicleSubsystem::FindVehicle(FName VehicleId) const
{
	for (UBCUVehicleDefinition* Def : Catalogue)
	{
		if (Def && Def->VehicleId == VehicleId) { return Def; }
	}
	return nullptr;
}

TArray<UBCUVehicleDefinition*> UBCUVehicleSubsystem::GetVehiclesOfClass(EBCUVehicleClass Class) const
{
	TArray<UBCUVehicleDefinition*> Result;
	for (UBCUVehicleDefinition* Def : Catalogue)
	{
		if (Def && Def->VehicleClass == Class) { Result.Add(Def); }
	}
	return Result;
}

UBCUVehicleDefinition* UBCUVehicleSubsystem::PickTrafficVehicleForCell(const FBCUCellCoord& Cell) const
{
	// District-weighted first (trucks at the port, supercars uptown), then a
	// rarity-weighted global pick so rare cars stay rare.
	for (TActorIterator<ABCUCityStreamer> It(GetWorld()); It; ++It)
	{
		if (UBCUDistrictDataAsset* District = (*It)->GetDistrictForCell(Cell))
		{
			if (District->AI.TrafficVehiclePool.Num() > 0)
			{
				const int32 Index = FMath::RandRange(0, District->AI.TrafficVehiclePool.Num() - 1);
				if (UBCUVehicleDefinition* Pick = District->AI.TrafficVehiclePool[Index].LoadSynchronous())
				{
					return Pick;
				}
			}
		}
		break;
	}

	if (Catalogue.Num() == 0) { return nullptr; }

	// Weight by rarity so a Legendary never floods the streets.
	static const float RarityWeight[5] = { 60.0f, 26.0f, 9.0f, 3.5f, 1.5f };
	float Total = 0.0f;
	for (const UBCUVehicleDefinition* Def : Catalogue)
	{
		Total += (Def && !Def->IsEmergencyVehicle()) ? RarityWeight[int32(Def->Rarity)] : 0.0f;
	}
	if (Total <= 0.0f) { return nullptr; }

	float Roll = FMath::FRandRange(0.0f, Total);
	for (UBCUVehicleDefinition* Def : Catalogue)
	{
		if (!Def || Def->IsEmergencyVehicle()) { continue; }

		Roll -= RarityWeight[int32(Def->Rarity)];
		if (Roll <= 0.0f) { return Def; }
	}

	return nullptr;
}

// ── Garage ────────────────────────────────────────────────────────────────────

void UBCUVehicleSubsystem::GrantVehicle(FName VehicleId)
{
	if (!VehicleId.IsValid()) { return; }

	OwnedVehicles.AddUnique(VehicleId);
	OnGarageChanged.Broadcast(OwnedVehicles);
}

bool UBCUVehicleSubsystem::RemoveVehicle(FName VehicleId)
{
	const int32 Removed = OwnedVehicles.Remove(VehicleId);
	if (Removed > 0) { OnGarageChanged.Broadcast(OwnedVehicles); }
	return Removed > 0;
}

ABCUBaseVehicle* UBCUVehicleSubsystem::SpawnOwnedVehicle(FName VehicleId, const FVector& Location, const FRotator& Rotation)
{
	UBCUVehicleDefinition* Def = FindVehicle(VehicleId);
	if (!Def) { return nullptr; }

	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AdjustIfPossibleButAlwaysSpawn;
	Params.bNoFail = true;
	Params.ObjectFlags |= RF_Transient;

	ABCUBaseVehicle* Vehicle = GetWorld()->SpawnActor<ABCUBaseVehicle>(
		ABCUBaseVehicle::StaticClass(), Location, Rotation, Params);

	if (Vehicle)
	{
		Vehicle->ConfigureFromDefinition(Def);
		Vehicle->bPlayerOwned = true;
		SpawnedOwnedVehicles.Add(Vehicle);
	}

	return Vehicle;
}

ABCUBaseVehicle* UBCUVehicleSubsystem::FindNearestOwnedVehicle(const FVector& Location, float MaxDistanceCm) const
{
	ABCUBaseVehicle* Best = nullptr;
	float BestDistance = MaxDistanceCm;

	for (ABCUBaseVehicle* Vehicle : SpawnedOwnedVehicles)
	{
		if (!Vehicle || !Vehicle->bPlayerOwned) { continue; }

		const float Distance = FVector::Dist(Vehicle->GetActorLocation(), Location);
		if (Distance < BestDistance)
		{
			BestDistance = Distance;
			Best = Vehicle;
		}
	}

	return Best;
}

// ── Customisation ─────────────────────────────────────────────────────────────

void UBCUVehicleSubsystem::SetVehiclePaint(ABCUBaseVehicle* Vehicle, const FLinearColor& Color)
{
	if (!Vehicle) { return; }

	Vehicle->PaintColor = Color;
	if (Vehicle->Customisation) { Vehicle->Customisation->ApplyPaint(Color); }
}

void UBCUVehicleSubsystem::SetVehicleUpgrades(ABCUBaseVehicle* Vehicle, int32 EngineLevel, int32 HandlingLevel, int32 BrakeLevel)
{
	if (!Vehicle) { return; }

	Vehicle->EngineLevel = FMath::Clamp(EngineLevel, 0, 5);
	Vehicle->HandlingLevel = FMath::Clamp(HandlingLevel, 0, 5);
	Vehicle->BrakeLevel = FMath::Clamp(BrakeLevel, 0, 5);

	if (Vehicle->Customisation)
	{
		Vehicle->Customisation->ApplyUpgradeLevels(Vehicle->EngineLevel, Vehicle->HandlingLevel, Vehicle->BrakeLevel);
	}
}

int32 UBCUVehicleSubsystem::GetCustomisationCost(FName CategoryId, int32 Level) const
{
	// Costs rise geometrically: level 5 is ~8× level 1, which is what makes the
	// garage a long-term sink rather than a one-purchase upgrade.
	static const TMap<FName, int32> BaseCosts =
	{
		{ TEXT("Paint"), 450 }, { TEXT("Wheels"), 1200 }, { TEXT("Engine"), 3800 },
		{ TEXT("Handling"), 2600 }, { TEXT("Brakes"), 1800 }, { TEXT("Decal"), 250 },
		{ TEXT("BodyKit"), 5200 }, { TEXT("Underglow"), 900 }, { TEXT("Horn"), 300 }
	};

	const int32* Base = BaseCosts.Find(CategoryId);
	const int32 BaseCost = Base ? *Base : 1000;
	return FMath::RoundToInt(float(BaseCost) * FMath::Pow(1.85f, float(FMath::Clamp(Level, 0, 5))));
}

UStaticMesh* UBCUVehicleSubsystem::GetCachedVehicleMesh(UBCUVehicleDefinition* Definition,
	const FLinearColor& Paint, FName WheelStyle)
{
	if (!Definition) { return nullptr; }

	// Paint is a material parameter, not a mesh difference — only the silhouette
	// and wheel style need distinct meshes. That keeps the cache small.
	const FString Key = FString::Printf(TEXT("%s|%s"), *Definition->VehicleId.ToString(), *WheelStyle.ToString());

	if (TObjectPtr<UStaticMesh>* Found = MeshCache.Find(Key))
	{
		if (*Found) { return *Found; }
	}

	UStaticMesh* Built = UBCUVehicleVoxelBuilder::BuildVehicleMesh(GetWorld(), Definition, Paint, WheelStyle);
	if (Built) { MeshCache.Add(Key, Built); }
	return Built;
}

void UBCUVehicleSubsystem::OnPlayerEnteredVehicle(ABCUBaseVehicle* Vehicle, int32 SeatIndex)
{
	if (!Vehicle) { return; }

	// Stealing a car that is not yours is a crime; stealing a police car is a
	// much bigger one.
	if (!Vehicle->bPlayerOwned)
	{
		UWorld* World = GetWorld();
		if (World)
		{
			if (Vehicle->GetDefinition() && Vehicle->GetDefinition()->IsPoliceVehicle())
			{
				// Reported by the police subsystem directly so it is witnessed.
				UE_LOG(LogBCUVehicles, Log, TEXT("Player entered a police vehicle"));
			}
		}
	}

	(void)SeatIndex;
}

FString UBCUVehicleSubsystem::GetVehicleStats() const
{
	return FString::Printf(TEXT("catalogue=%d owned=%d spawned=%d meshcache=%d"),
		Catalogue.Num(), OwnedVehicles.Num(), SpawnedOwnedVehicles.Num(), MeshCache.Num());
}
