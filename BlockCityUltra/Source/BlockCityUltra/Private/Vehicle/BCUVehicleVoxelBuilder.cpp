// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "Vehicle/BCUVehicleVoxelBuilder.h"

#include "World/Voxel/BCUVoxelGrid.h"
#include "World/Voxel/BCUVoxelMesher.h"
#include "World/Voxel/BCUVoxelTypes.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUVehicleBuilder, Log, All);

void UBCUVehicleVoxelBuilder::GetProfileForStyle(FName BodyStyle, TArray<float>& OutRoofLine,
	TArray<float>& OutBeltLine, float& OutFrontOverhang, float& OutRearOverhang)
{
	// Original parametric silhouettes. Values are normalised along the car's
	// length (0 = nose, 1 = tail) and give roof/belt height as a 0..1 fraction
	// of the total body height.
	const FString Style = BodyStyle.ToString();

	if (Style == TEXT("Super") || Style == TEXT("Supercar"))
	{
		OutRoofLine = { 0.30f, 0.42f, 0.55f, 0.58f, 0.52f, 0.38f, 0.28f };
		OutBeltLine = { 0.28f, 0.34f, 0.40f, 0.40f, 0.36f, 0.30f, 0.26f };
		OutFrontOverhang = 0.08f; OutRearOverhang = 0.10f;
	}
	else if (Style == TEXT("Muscle"))
	{
		OutRoofLine = { 0.34f, 0.50f, 0.68f, 0.70f, 0.62f, 0.46f, 0.34f };
		OutBeltLine = { 0.32f, 0.38f, 0.46f, 0.46f, 0.42f, 0.36f, 0.32f };
		OutFrontOverhang = 0.12f; OutRearOverhang = 0.09f;
	}
	else if (Style == TEXT("Motorcycle"))
	{
		OutRoofLine = { 0.18f, 0.30f, 0.42f, 0.40f, 0.32f, 0.24f, 0.18f };
		OutBeltLine = { 0.16f, 0.22f, 0.30f, 0.30f, 0.24f, 0.20f, 0.16f };
		OutFrontOverhang = 0.22f; OutRearOverhang = 0.18f;
	}
	else if (Style == TEXT("Truck") || Style == TEXT("Semi"))
	{
		OutRoofLine = { 0.95f, 0.98f, 0.98f, 0.60f, 0.55f, 0.55f, 0.50f };
		OutBeltLine = { 0.70f, 0.72f, 0.72f, 0.42f, 0.40f, 0.40f, 0.38f };
		OutFrontOverhang = 0.06f; OutRearOverhang = 0.05f;
	}
	else if (Style == TEXT("Van"))
	{
		OutRoofLine = { 0.82f, 0.95f, 0.96f, 0.96f, 0.94f, 0.86f, 0.72f };
		OutBeltLine = { 0.66f, 0.74f, 0.74f, 0.74f, 0.72f, 0.66f, 0.58f };
		OutFrontOverhang = 0.07f; OutRearOverhang = 0.08f;
	}
	else if (Style == TEXT("Bus"))
	{
		OutRoofLine = { 0.94f, 0.98f, 0.98f, 0.98f, 0.98f, 0.96f, 0.90f };
		OutBeltLine = { 0.72f, 0.78f, 0.78f, 0.78f, 0.78f, 0.76f, 0.70f };
		OutFrontOverhang = 0.05f; OutRearOverhang = 0.06f;
	}
	else if (Style == TEXT("SUV") || Style == TEXT("Offroad"))
	{
		OutRoofLine = { 0.62f, 0.78f, 0.90f, 0.92f, 0.90f, 0.80f, 0.66f };
		OutBeltLine = { 0.50f, 0.58f, 0.64f, 0.64f, 0.62f, 0.56f, 0.50f };
		OutFrontOverhang = 0.10f; OutRearOverhang = 0.10f;
	}
	else if (Style == TEXT("Pickup"))
	{
		OutRoofLine = { 0.50f, 0.72f, 0.88f, 0.88f, 0.52f, 0.48f, 0.46f };
		OutBeltLine = { 0.46f, 0.54f, 0.62f, 0.62f, 0.46f, 0.44f, 0.42f };
		OutFrontOverhang = 0.10f; OutRearOverhang = 0.12f;
	}
	else // Sedan / Compact / default three-box
	{
		OutRoofLine = { 0.42f, 0.62f, 0.86f, 0.88f, 0.80f, 0.58f, 0.44f };
		OutBeltLine = { 0.40f, 0.48f, 0.56f, 0.56f, 0.54f, 0.48f, 0.42f };
		OutFrontOverhang = 0.10f; OutRearOverhang = 0.11f;
	}
}

void UBCUVehicleVoxelBuilder::CarveBody(UBCUVoxelGrid* Grid, UBCUVehicleDefinition* Definition)
{
	if (!Grid || !Definition) { return; }

	TArray<float> RoofLine, BeltLine;
	float FrontOverhang = 0.1f, RearOverhang = 0.1f;
	GetProfileForStyle(Definition->BodyStyle, RoofLine, BeltLine, FrontOverhang, RearOverhang);

	const int32 Length = FMath::Max(6, Definition->BodyVoxelDimensions.Z);
	const int32 Width = FMath::Max(4, Definition->BodyVoxelDimensions.X);
	const int32 Height = FMath::Max(3, Definition->BodyVoxelDimensions.Y);
	const int32 Segments = FMath::Max(2, RoofLine.Num() - 1);

	// March along the length, interpolating the profile. Every station is a
	// solid slab, then the greenhouse pass hollows the cabin.
	for (int32 L = 0; L < Length; ++L)
	{
		const float T = float(L) / float(FMath::Max(1, Length - 1));
		const float Station = T * float(Segments);
		const int32 S0 = FMath::Clamp(FMath::FloorToInt(Station), 0, Segments - 1);
		const int32 S1 = FMath::Min(S0 + 1, Segments);
		const float Blend = Station - float(S0);

		const float Roof = FMath::Lerp(RoofLine[S0], RoofLine[S1], Blend);
		const float Belt = FMath::Lerp(BeltLine[S0], BeltLine[S1], Blend);

		// Taper the ends (overhangs) so the nose is not a flat wall.
		const float TaperFront = FMath::Clamp(T / FMath::Max(0.001f, FrontOverhang), 0.0f, 1.0f);
		const float TaperRear = FMath::Clamp((1.0f - T) / FMath::Max(0.001f, RearOverhang), 0.0f, 1.0f);
		const float Taper = FMath::Min(TaperFront, TaperRear);
		const float WidthScale = FMath::Lerp(0.72f, 1.0f, Taper);

		const int32 HalfWidth = FMath::Max(2, FMath::RoundToInt(float(Width) * 0.5f * WidthScale));
		const int32 BottomZ = FMath::RoundToInt(float(Height) * 0.18f);
		const int32 BeltZ = FMath::Max(BottomZ + 1, FMath::RoundToInt(float(Height) * Belt));
		const int32 RoofZ = FMath::Max(BeltZ + 1, FMath::RoundToInt(float(Height) * Roof));

		for (int32 W = -HalfWidth; W <= HalfWidth; ++W)
		{
			for (int32 Z = BottomZ; Z <= BeltZ; ++Z)
			{
				Grid->SetVoxel(FIntVector(W, L, Z), EBCUVoxelMaterial::Steel, /*PaletteIndex=*/0);
			}

			// Above the belt line only the outer skin is filled (the greenhouse
			// pass adds glass), except at the very front and rear where the
			// roof continues solid.
			const bool bIsEnd = (T < 0.12f || T > 0.90f);
			if (bIsEnd)
			{
				for (int32 Z = BeltZ + 1; Z <= RoofZ; ++Z)
				{
					Grid->SetVoxel(FIntVector(W, L, Z), EBCUVoxelMaterial::Steel);
				}
			}
			else if (FMath::Abs(W) == HalfWidth)
			{
				for (int32 Z = BeltZ + 1; Z <= RoofZ; ++Z)
				{
					Grid->SetVoxel(FIntVector(W, L, Z), EBCUVoxelMaterial::Steel);
				}
			}
		}
	}
}

void UBCUVehicleVoxelBuilder::CarveGreenhouse(UBCUVoxelGrid* Grid, UBCUVehicleDefinition* Definition)
{
	if (!Grid || !Definition) { return; }

	TArray<float> RoofLine, BeltLine;
	float FrontOverhang, RearOverhang;
	GetProfileForStyle(Definition->BodyStyle, RoofLine, BeltLine, FrontOverhang, RearOverhang);

	const int32 Length = FMath::Max(6, Definition->BodyVoxelDimensions.Z);
	const int32 Width = FMath::Max(4, Definition->BodyVoxelDimensions.X);
	const int32 Height = FMath::Max(3, Definition->BodyVoxelDimensions.Y);
	const int32 Segments = FMath::Max(2, RoofLine.Num() - 1);
	const int32 HalfWidth = FMath::Max(2, Width / 2);

	for (int32 L = 0; L < Length; ++L)
	{
		const float T = float(L) / float(FMath::Max(1, Length - 1));
		const float Station = T * float(Segments);
		const int32 S0 = FMath::Clamp(FMath::FloorToInt(Station), 0, Segments - 1);
		const float Blend = Station - float(S0);
		const int32 S1 = FMath::Min(S0 + 1, Segments);

		const float Roof = FMath::Lerp(RoofLine[S0], RoofLine[S1], Blend);
		const float Belt = FMath::Lerp(BeltLine[S0], BeltLine[S1], Blend);
		const int32 BeltZ = FMath::Max(1, FMath::RoundToInt(float(Height) * Belt));
		const int32 RoofZ = FMath::Max(BeltZ + 1, FMath::RoundToInt(float(Height) * Roof));

		// Side glass between belt and roof, inset by one voxel.
		for (int32 Z = BeltZ + 1; Z < RoofZ; ++Z)
		{
			Grid->SetVoxel(FIntVector(-HalfWidth, L, Z), EBCUVoxelMaterial::GlassTinted);
			Grid->SetVoxel(FIntVector(HalfWidth, L, Z), EBCUVoxelMaterial::GlassTinted);
		}

		// Roof panel.
		for (int32 W = -HalfWidth + 1; W <= HalfWidth - 1; ++W)
		{
			Grid->SetVoxel(FIntVector(W, L, RoofZ), EBCUVoxelMaterial::Steel);
		}
	}

	// Windscreen and rear window.
	const int32 BeltZ = FMath::Max(1, FMath::RoundToInt(float(Height) * BeltLine[BeltLine.Num() / 2]));
	const int32 RoofZ = FMath::Max(BeltZ + 2, FMath::RoundToInt(float(Height) * RoofLine[RoofLine.Num() / 2]));

	for (int32 Z = BeltZ; Z <= RoofZ; ++Z)
	{
		for (int32 W = -HalfWidth + 1; W <= HalfWidth - 1; ++W)
		{
			Grid->SetVoxel(FIntVector(W, FMath::RoundToInt(float(Length) * 0.20f), Z), EBCUVoxelMaterial::GlassClear);
			Grid->SetVoxel(FIntVector(W, FMath::RoundToInt(float(Length) * 0.88f), Z), EBCUVoxelMaterial::GlassTinted);
		}
	}
}

void UBCUVehicleVoxelBuilder::CarveWheels(UBCUVoxelGrid* Grid, UBCUVehicleDefinition* Definition, FName WheelStyle)
{
	if (!Grid || !Definition) { return; }

	// Wheels are blocky discs: a filled square with the corners removed. That
	// reads as a wheel at speed and stays true to the voxel identity.
	const bool bLowProfile = (WheelStyle.ToString() == TEXT("Sport") || WheelStyle.ToString() == TEXT("Track"));

	for (const FBCUWheelSpec& Wheel : Definition->Wheels)
	{
		const int32 Radius = FMath::Max(1, FMath::RoundToInt(Wheel.RadiusCm / Definition->VoxelSizeCm));
		const int32 HalfThickness = FMath::Max(1, FMath::RoundToInt(Wheel.WidthCm * 0.5f / Definition->VoxelSizeCm));
		const FIntVector Centre = FIntVector(
			FMath::RoundToInt(Wheel.Location.X / Definition->VoxelSizeCm),
			FMath::RoundToInt(Wheel.Location.Y / Definition->VoxelSizeCm),
			FMath::RoundToInt(Wheel.Location.Z / Definition->VoxelSizeCm));

		for (int32 T = -HalfThickness; T <= HalfThickness; ++T)
		{
			for (int32 Z = -Radius; Z <= Radius; ++Z)
			{
				for (int32 Y = -Radius; Y <= Radius; ++Y)
				{
					const float Dist = FMath::Sqrt(float(Y * Y + Z * Z));
					if (Dist > float(Radius)) { continue; }

					EBCUVoxelMaterial Material = EBCUVoxelMaterial::RubberMat;
					if (Dist < float(Radius) * (bLowProfile ? 0.72f : 0.55f))
					{
						Material = (WheelStyle == TEXT("Chrome")) ? EBCUVoxelMaterial::Chrome
							: EBCUVoxelMaterial::Aluminium;
					}

					Grid->SetVoxel(Centre + FIntVector(T, Y, Z), Material);
				}
			}
		}
	}
}

void UBCUVehicleVoxelBuilder::CarveInterior(UBCUVoxelGrid* Grid, UBCUVehicleDefinition* Definition)
{
	if (!Grid || !Definition) { return; }

	// Dashboard, seats, steering wheel and door cards. Voxel interiors are what
	// make the first-person and hood cameras worth having.
	const int32 Width = FMath::Max(4, Definition->BodyVoxelDimensions.X);
	const int32 Length = FMath::Max(6, Definition->BodyVoxelDimensions.Z);
	const int32 Height = FMath::Max(3, Definition->BodyVoxelDimensions.Y);
	const int32 HalfWidth = Width / 2;
	const int32 FloorZ = FMath::Max(1, FMath::RoundToInt(float(Height) * 0.20f));
	const int32 DashZ = FloorZ + FMath::Max(2, Height / 3);

	const int32 DashY = FMath::RoundToInt(float(Length) * 0.30f);

	for (int32 W = -HalfWidth + 1; W <= HalfWidth - 1; ++W)
	{
		for (int32 Z = FloorZ; Z <= DashZ; ++Z)
		{
			Grid->SetVoxel(FIntVector(W, DashY, Z), EBCUVoxelMaterial::PaintedGrey);
		}
	}

	// Steering wheel: a ring of dark voxels in front of the driver seat.
	const int32 WheelY = DashY - 1;
	for (int32 i = -1; i <= 1; ++i)
	{
		Grid->SetVoxel(FIntVector(-HalfWidth + 2 + i, WheelY, DashZ - 1), EBCUVoxelMaterial::WoodDark);
		Grid->SetVoxel(FIntVector(-HalfWidth + 2 + i, WheelY, DashZ), EBCUVoxelMaterial::WoodDark);
	}

	// Seats, one per seat spec.
	for (const FBCUSeatSpec& Seat : Definition->Seats)
	{
		const FIntVector SeatPos = FIntVector(
			FMath::RoundToInt(Seat.SeatTransform.GetLocation().X / Definition->VoxelSizeCm),
			FMath::RoundToInt(Seat.SeatTransform.GetLocation().Y / Definition->VoxelSizeCm),
			FloorZ);

		Grid->FillBox(FBox(
			FVector(SeatPos.X - 1, SeatPos.Y - 1, SeatPos.Z),
			FVector(SeatPos.X + 1, SeatPos.Y + 1, SeatPos.Z)),
			EBCUVoxelMaterial::Fabric);
		Grid->FillBox(FBox(
			FVector(SeatPos.X - 1, SeatPos.Y + 1, SeatPos.Z),
			FVector(SeatPos.X + 1, SeatPos.Y + 2, SeatPos.Z + 3)),
			EBCUVoxelMaterial::Fabric);
	}
}

void UBCUVehicleVoxelBuilder::CarveLights(UBCUVoxelGrid* Grid, UBCUVehicleDefinition* Definition)
{
	if (!Grid || !Definition) { return; }

	const int32 Width = FMath::Max(4, Definition->BodyVoxelDimensions.X);
	const int32 Length = FMath::Max(6, Definition->BodyVoxelDimensions.Z);
	const int32 Height = FMath::Max(3, Definition->BodyVoxelDimensions.Y);
	const int32 HalfWidth = Width / 2;
	const int32 LightZ = FMath::Max(1, FMath::RoundToInt(float(Height) * 0.42f));

	// Headlights: emissive white voxels at the nose.
	for (int32 Side = -1; Side <= 1; Side += 2)
	{
		FBCUVoxel Head;
		Head.Material = static_cast<uint8>(EBCUVoxelMaterial::LightFixture);
		Head.Flags = FBCUVoxel::FLAG_Emissive;
		Grid->SetVoxel(FIntVector(Side * (HalfWidth - 1), 0, LightZ), Head);
		Grid->SetVoxel(FIntVector(Side * (HalfWidth - 1), 1, LightZ), Head);

		// Taillights: emissive red at the tail.
		FBCUVoxel Tail;
		Tail.Material = static_cast<uint8>(EBCUVoxelMaterial::PaintedRed);
		Tail.Flags = FBCUVoxel::FLAG_Emissive;
		Grid->SetVoxel(FIntVector(Side * (HalfWidth - 1), Length - 1, LightZ), Tail);
		Grid->SetVoxel(FIntVector(Side * (HalfWidth - 1), Length - 2, LightZ), Tail);
	}

	// Emergency lightbar on the roof.
	if (Definition->bHasEmergencyLightbar)
	{
		const int32 RoofZ = FMath::RoundToInt(float(Height) * 0.92f) + 1;
		const int32 BarY = FMath::RoundToInt(float(Length) * 0.40f);

		for (int32 W = -HalfWidth + 1; W <= HalfWidth - 1; ++W)
		{
			FBCUVoxel Bar;
			Bar.Material = static_cast<uint8>(W < 0 ? EBCUVoxelMaterial::NeonPink : EBCUVoxelMaterial::NeonCyan);
			Bar.Flags = FBCUVoxel::FLAG_Emissive;
			Grid->SetVoxel(FIntVector(W, BarY, RoofZ), Bar);
		}
	}
}

void UBCUVehicleVoxelBuilder::CarveDetailTrim(UBCUVoxelGrid* Grid, UBCUVehicleDefinition* Definition, int32 DetailLevel)
{
	if (!Grid || !Definition || DetailLevel <= 0) { return; }

	const int32 Width = FMath::Max(4, Definition->BodyVoxelDimensions.X);
	const int32 Length = FMath::Max(6, Definition->BodyVoxelDimensions.Z);
	const int32 HalfWidth = Width / 2;

	// Door seams, mirror stubs, exhaust tips and a grille. Detail level 2 adds
	// the mirrors and exhaust; level 1 only the seams.
	for (int32 Side = -1; Side <= 1; Side += 2)
	{
		const int32 X = Side * HalfWidth;

		for (int32 L = FMath::RoundToInt(float(Length) * 0.30f); L < FMath::RoundToInt(float(Length) * 0.72f); ++L)
		{
			Grid->SetVoxel(FIntVector(X, L, 2), EBCUVoxelMaterial::SteelRusted);
		}

		if (DetailLevel >= 2)
		{
			Grid->SetVoxel(FIntVector(X + Side, FMath::RoundToInt(float(Length) * 0.34f), 5), EBCUVoxelMaterial::Chrome);
		}
	}

	if (DetailLevel >= 2)
	{
		// Grille.
		for (int32 W = -HalfWidth + 2; W <= HalfWidth - 2; ++W)
		{
			Grid->SetVoxel(FIntVector(W, 0, 3), EBCUVoxelMaterial::Chrome);
		}

		// Exhaust tips.
		Grid->SetVoxel(FIntVector(-HalfWidth + 2, Length - 1, 1), EBCUVoxelMaterial::SteelRusted);
		Grid->SetVoxel(FIntVector(HalfWidth - 2, Length - 1, 1), EBCUVoxelMaterial::SteelRusted);
	}
}

UStaticMesh* UBCUVehicleVoxelBuilder::BuildVehicleMesh(UWorld* World, UBCUVehicleDefinition* Definition,
	const FLinearColor& PaintColor, FName WheelStyle)
{
	if (!Definition) { return nullptr; }

	// A per-vehicle grid, sized to the body bounding box plus wheels.
	UBCUVoxelGrid* Grid = NewObject<UBCUVoxelGrid>(GetTransientPackage());

	const int32 W = FMath::Max(4, Definition->BodyVoxelDimensions.X) + 4;
	const int32 H = FMath::Max(3, Definition->BodyVoxelDimensions.Y) + 4;
	const int32 L = FMath::Max(6, Definition->BodyVoxelDimensions.Z) + 4;
	Grid->Initialise(FIntVector(W, L, H), FIntVector(1, 1, 1), FBCUCellCoord(0, 0),
		FMath::Max(1.0f, Definition->VoxelSizeCm));

	CarveBody(Grid, Definition);
	CarveGreenhouse(Grid, Definition);
	CarveWheels(Grid, Definition, WheelStyle);
	CarveInterior(Grid, Definition);
	CarveLights(Grid, Definition);
	CarveDetailTrim(Grid, Definition, /*DetailLevel=*/2);

	FBCUMeshOptions Options;
	Options.bGreedyMerge = true;
	Options.bVertexAO = false;
	Options.VoxelScaleCm = Grid->GetVoxelScaleCm();

	TMap<EBCUMeshSection, FBCUVoxelMeshData> Sections;
	FBCUVoxelMesher::BuildGridMesh(Grid, Options, Sections);

	UStaticMesh* Mesh = FBCUVoxelMesher::CreateStaticMesh(
		GetTransientPackage(),
		FName(*FString::Printf(TEXT("SM_Vehicle_%s_%s"),
			*Definition->VehicleId.ToString(), *WheelStyle.ToString())),
		Sections, Grid->MaterialSet, /*bEnableNanite=*/false);

	UE_LOG(LogBCUVehicleBuilder, Verbose, TEXT("Built vehicle mesh %s (%d voxels)"),
		*Definition->VehicleId.ToString(), Grid->GetNonEmptyVoxelCount());

	(void)World; (void)PaintColor;
	return Mesh;
}
