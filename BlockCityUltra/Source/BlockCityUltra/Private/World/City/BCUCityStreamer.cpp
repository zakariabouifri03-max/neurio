// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.

#include "World/City/BCUCityStreamer.h"

#include "World/City/BCUCellActor.h"
#include "World/City/BCUDistrictDataAsset.h"
#include "World/Voxel/BCUVoxelGrid.h"
#include "World/Voxel/BCUVoxelMesher.h"
#include "Async/Async.h"
#include "Async/TaskGraphInterfaces.h"
#include "Components/HierarchicalInstancedStaticMeshComponent.h"
#include "Core/BCUGameState.h"
#include "AI/BCUTrafficSubsystem.h"
#include "AI/BCUPedestrianSubsystem.h"
#include "Police/BCUPoliceSubsystem.h"
#include "Engine/StaticMesh.h"
#include "HAL/Runnable.h"
#include "Kismet/GameplayStatics.h"
#include "Misc/ScopeLock.h"
#include "Stats/Stats.h"

DEFINE_LOG_CATEGORY_STATIC(LogBCUCityStreamer, Log, All);
DECLARE_STATS_GROUP(TEXT("BCU City Streaming"), STATGROUP_BCUCity, STATCAT_Advanced);
DECLARE_CYCLE_STAT(TEXT("Cell Generation"), STAT_BCUCellGen, STATGROUP_BCUCity);
DECLARE_CYCLE_STAT(TEXT("Cell Meshing"), STAT_BCUCellMesh, STATGROUP_BCUCity);
DECLARE_DWORD_ACCUMULATOR_STAT(TEXT("Resident Cells"), STAT_BCUResidentCells, STATGROUP_BCUCity);
DECLARE_DWORD_ACCUMULATOR_STAT(TEXT("City Triangles"), STAT_BCUCityTris, STATGROUP_BCUCity);

ABCUCityStreamer::ABCUCityStreamer()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickGroup = TG_PrePhysics;
	PrimaryActorTick.TickInterval = 0.0f;
	PrimaryActorTick.bStartWithTickEnabled = true;

	bReplicates = false;
	SetCanBeDamaged(false);

	// The streamer itself is a management actor: it must survive every level
	// and never be part of an HLOD or a streaming cell.
#if WITH_EDITORONLY_DATA
	bIsSpatiallyLoaded = false;
	HLODLayerName = NAME_None;
#endif

	CitySeed.Seed = 20260710;
	CitySeed.Density = 0.62f;
	CitySeed.Verticality = 0.7f;
	CitySeed.Nature = 0.35f;
}

void ABCUCityStreamer::BeginPlay()
{
	Super::BeginPlay();

	ApplyScalabilitySettings();

	if (!MaterialSet)
	{
		MaterialSet = NewObject<UBCUVoxelMaterialSet>(this);
		MaterialSet->EnsureDefaults();
		UE_LOG(LogBCUCityStreamer, Warning, TEXT("No VoxelMaterialSet assigned — using built-in defaults."));
	}

	if (const APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(this, 0))
	{
		StreamingSource = PlayerPawn->GetActorLocation();
	}

	// Listen for scalability changes so the video options take effect
	// immediately without a map reload.
	ScalabilityChangedHandle = FScalability::OnScalabilityChanged().AddUObject(
		this, &ABCUCityStreamer::OnScalabilityChanged);

	UpdateWantedCells();
	UE_LOG(LogBCUCityStreamer, Log, TEXT("City streamer online: %s, %dx%d cells (%.1f km per side)"),
		*CitySeed.ToString(), RegionExtentCells.X, RegionExtentCells.Y,
		RegionExtentCells.X * CellSizeCm / 100000.0f);
}

void ABCUCityStreamer::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
	FScalability::OnScalabilityChanged().Remove(ScalabilityChangedHandle);
	Super::EndPlay(EndPlayReason);
}

void ABCUCityStreamer::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	QUICK_SCOPE_CYCLE_COUNTER(STAT_BCUCityStreamer_Tick);

	if (const APawn* PlayerPawn = UGameplayStatics::GetPlayerPawn(this, 0))
	{
		StreamingSource = PlayerPawn->GetActorLocation();
	}

	// Re-evaluate the wanted set ~6 times a second. Doing it every frame costs
	// 6× more for no visible benefit, since a cell is 256 m across.
	const double Now = GetWorld()->GetTimeSeconds();
	if (Now - LastStreamingUpdate > 0.166)
	{
		LastStreamingUpdate = Now;
		UpdateWantedCells();
		EvictDistantCells();
		UpdateHLODProxies();
	}

	CellsGeneratedThisFrame = 0;
	ProcessBuildQueue(DeltaSeconds);

	// Push streaming stats to the game state so the HUD and `stat` show them.
	if (ABCUGameState* State = GetWorld()->GetGameState<ABCUGameState>())
	{
		State->SetResidentCellCount(ResidentCells.Num());
		if (!bInitialLoadComplete && ResidentCells.Num() >= PendingCells.Num() && InFlightBuilds.Num() == 0)
		{
			bInitialLoadComplete = true;
			State->MarkInitialStreamingComplete();
			OnStreamingProgress.Broadcast(1.0f);
		}
	}

	SET_DWORD_STAT(STAT_BCUResidentCells, ResidentCells.Num());
	SET_DWORD_STAT(STAT_BCUCityTris, TotalTriangles);
}

//═══════════════════════════════════════════════════════════════════════════════
// Wanted set
//═══════════════════════════════════════════════════════════════════════════════

void ABCUCityStreamer::UpdateWantedCells()
{
	const FBCUCellCoord Centre = WorldToCell(StreamingSource);

	struct FCandidate
	{
		FBCUCellCoord Coord;
		float DistanceSq;
	};

	TArray<FCandidate> Candidates;
	Candidates.Reserve((LoadRadiusCells * 2 + 1) * (LoadRadiusCells * 2 + 1));

	for (int32 DY = -LoadRadiusCells; DY <= LoadRadiusCells; ++DY)
	{
		for (int32 DX = -LoadRadiusCells; DX <= LoadRadiusCells; ++DX)
		{
			const FBCUCellCoord Coord = ClampToRegion(FBCUCellCoord(Centre.X + DX, Centre.Y + DY));
			if (!IsInRegion(Coord))
			{
				continue;
			}

			// Circular load radius: a square one loads ~27% more cells for the
			// same visual radius, which is pure wasted VRAM.
			const float DistSq = float(DX * DX + DY * DY);
			if (DistSq > float(LoadRadiusCells * LoadRadiusCells))
			{
				continue;
			}

			Candidates.Add({ Coord, DistSq });
		}
	}

	// Nearest first so the cell the player is standing in always wins a slot.
	Candidates.Sort([](const FCandidate& A, const FCandidate& B)
	{
		return A.DistanceSq < B.DistanceSq;
	});

	PendingCells.Reset();
	const double Now = GetWorld()->GetTimeSeconds();

	for (const FCandidate& Candidate : Candidates)
	{
		if (FBCUResidentCell* Existing = ResidentCells.Find(Candidate.Coord))
		{
			Existing->DistanceSq = Candidate.DistanceSq;
			Existing->LastTouchTime = Now;
			continue;
		}

		if (!PendingCells.Contains(Candidate.Coord))
		{
			PendingCells.Add(Candidate.Coord);
		}
	}

	if (!bInitialLoadComplete && Candidates.Num() > 0)
	{
		const float Progress = float(ResidentCells.Num()) / float(Candidates.Num());
		OnStreamingProgress.Broadcast(FMath::Clamp(Progress, 0.0f, 1.0f));
	}
}

void ABCUCityStreamer::ProcessBuildQueue(float DeltaSeconds)
{
	(void)DeltaSeconds;

	while (PendingCells.Num() > 0
		&& CellsGeneratedThisFrame < MaxCellsLoadedPerFrame
		&& InFlightBuilds.Num() < MaxConcurrentAsyncBuilds)
	{
		const FBCUCellCoord Coord = PendingCells[0];
		PendingCells.RemoveAt(0);

		FBCUResidentCell& Cell = ResidentCells.FindOrAdd(Coord);
		Cell.Coord = Coord;
		Cell.State = 1; // generating
		Cell.District = GetDistrictForCell(Coord);

		if (!Cell.Actor)
		{
			Cell.Actor = SpawnCellActor(Coord, Cell.District);
		}
		if (!Cell.Grid)
		{
			Cell.Grid = NewObject<UBCUVoxelGrid>(this);
			Cell.Grid->MaterialSet = MaterialSet;

			// 4×4 chunks in plan, 4 in Z, each 256 voxels → 1024×1024×1024
			// addressable, sparsely allocated.
			Cell.Grid->Initialise(
				FIntVector(256, 256, 240),
				FIntVector(4, 4, 4),
				Coord,
				VoxelScaleCm);
		}

		// Kick the build onto a worker thread. Generation is pure; only the
		// mesh upload touches UObject render state and must be on the game thread.
		{
			FScopeLock Lock(&InFlightLock);
			InFlightBuilds.Add(Coord);
		}

		CellsGeneratedThisFrame++;
		BuildCell(Cell);
	}
}

void ABCUCityStreamer::BuildCell(FBCUResidentCell& Cell)
{
	const FBCUCellCoord Coord = Cell.Coord;
	UBCUVoxelGrid* Grid = Cell.Grid;
	UBCUDistrictDataAsset* District = Cell.District;
	const FBCUCitySeed Seed = CitySeed;
	UBCUVoxelMaterialSet* Materials = MaterialSet;
	TWeakObjectPtr<ABCUCityStreamer> WeakThis(this);

	// ── Phase 1+2: generation and carving, off the game thread ──────────────
	Async(EAsyncExecution::ThreadPool, [WeakThis, Coord, Grid, District, Seed, Materials]()
	{
		SCOPE_CYCLE_COUNTER(STAT_BCUCellGen);

		FBCUCityCellData CellData = UBCUCityGenerator::GenerateCell(Coord, Seed, District, Materials);
		UBCUCityGenerator::CarveCellIntoGrid(CellData, Grid, District, Seed);

		// ── Phase 3: meshing, also off the game thread ──────────────────────
		TMap<EBCUMeshSection, FBCUVoxelMeshData> Sections;
		{
			SCOPE_CYCLE_COUNTER(STAT_BCUCellMesh);

			FBCUMeshOptions Options;
			Options.bGreedyMerge = true;
			Options.bVertexAO = true;
			Options.bCullHiddenFaces = true;
			Options.bExcludeInteriors = true;  // interiors stream separately
			Options.VoxelScaleCm = Grid->GetVoxelScaleCm();
			Options.MaxQuadsPerSection = 65536;

			FBCUVoxelMesher::BuildGridMesh(Grid, Options, Sections);
		}

		// ── Phase 4: upload on the game thread ──────────────────────────────
		AsyncTask(ENamedThreads::GameThread, [WeakThis, Coord, Sections = MoveTemp(Sections),
			CellData = MoveTemp(CellData)]() mutable
		{
			if (!WeakThis.IsValid())
			{
				return;
			}

			ABCUCityStreamer* Self = WeakThis.Get();
			FBCUResidentCell* Cell = Self->ResidentCells.Find(Coord);
			if (!Cell)
			{
				return;
			}

			Cell->CellData = MoveTemp(CellData);
			Cell->MeshBuildMs = FBCUVoxelMesher::GetLastBuildTimeMs();
			Self->UploadCellMeshes(*Cell, Sections);
			Self->PopulateInstancedProps(*Cell);
			Self->OnAsyncBuildComplete(Coord, /*bSuccess=*/true);
		});
	}, [WeakThis, Coord]()
	{
		// Failure path: never leave a cell half-built and still "in flight".
		if (WeakThis.IsValid())
		{
			WeakThis->OnAsyncBuildComplete(Coord, /*bSuccess=*/false);
		}
	});
}

void ABCUCityStreamer::OnAsyncBuildComplete(const FBCUCellCoord& Coord, bool bSuccess)
{
	{
		FScopeLock Lock(&InFlightLock);
		InFlightBuilds.Remove(Coord);
	}

	FBCUResidentCell* Cell = ResidentCells.Find(Coord);
	if (!Cell)
	{
		return;
	}

	if (!bSuccess)
	{
		Cell->State = 0;
		ResidentCells.Remove(Coord);
		UE_LOG(LogBCUCityStreamer, Error, TEXT("Failed to build cell %s"), *Coord.ToString());
		return;
	}

	Cell->State = 3; // resident
	Cell->TriangleCount = 0;
	TotalCellsGenerated++;
	TotalGenerationMs += Cell->CellData.GenerationMs;
	TotalMeshMs += Cell->MeshBuildMs;

	if (Cell->Actor)
	{
		Cell->Actor->SetCellResident(true);
		TotalTriangles += Cell->Actor->GetTriangleCount();
		Cell->TriangleCount = Cell->Actor->GetTriangleCount();
	}

	// Register the discovered spawn points with the AI subsystems so traffic and
	// patrols do not have to iterate the world to find lanes.
	if (UWorld* World = GetWorld())
	{
		if (UBCUTrafficSubsystem* Traffic = World->GetSubsystem<UBCUTrafficSubsystem>())
		{
			Traffic->RegisterCellLanes(Coord, Cell->CellData.TrafficSpawnPoints, Cell->CellData.Roads);
		}
		if (UBCUPedestrianSubsystem* Peds = World->GetSubsystem<UBCUPedestrianSubsystem>())
		{
			Peds->RegisterCellWalkPoints(Coord, Cell->CellData.PedestrianSpawnPoints);
		}
		if (UBCUPoliceSubsystem* Police = World->GetSubsystem<UBCUPoliceSubsystem>())
		{
			Police->RegisterPatrolPoints(Coord, Cell->CellData.PoliceSpawnPoints);
		}
	}

	OnCellStateChanged.Broadcast(Coord, Cell->State);
	UE_LOG(LogBCUCityStreamer, Verbose, TEXT("Cell %s resident: %d tris, gen %.1f ms, mesh %.1f ms"),
		*Coord.ToString(), Cell->TriangleCount, Cell->CellData.GenerationMs, Cell->MeshBuildMs);
}

void ABCUCityStreamer::UploadCellMeshes(FBCUResidentCell& Cell,
	TMap<EBCUMeshSection, FBCUVoxelMeshData>& Sections)
{
	if (!Cell.Actor)
	{
		return;
	}

	for (TPair<EBCUMeshSection, FBCUVoxelMeshData>& Pair : Sections)
	{
		if (Pair.Value.Positions.Num() == 0)
		{
			continue;
		}

		// Nanite is enabled for opaque geometry only. Masked (foliage) and
		// translucent (glass, water) sections use the classic renderer path —
		// that is the alternative rendering path for Nanite-incompatible voxels.
		const bool bEnableNanite = bUseNaniteForClusters
			&& Pair.Key == EBCUMeshSection::Opaque;

		UStaticMesh* Mesh = FBCUVoxelMesher::CreateStaticMesh(
			Cell.Actor,
			FName(*FString::Printf(TEXT("SM_Cell_%d_%d_S%d"), Cell.Coord.X, Cell.Coord.Y,
				static_cast<int32>(Pair.Key))),
			{{ Pair.Key, Pair.Value }},
			MaterialSet,
			bEnableNanite);

		if (Mesh)
		{
			Cell.Actor->SetSectionMesh(Pair.Key, Mesh, CellToWorld(Cell.Coord), bEnableNanite);
		}
	}
}

void ABCUCityStreamer::PopulateInstancedProps(FBCUResidentCell& Cell)
{
	if (!Cell.Actor)
	{
		return;
	}

	// Street furniture is generated as voxels for the *shape*, but repeated
	// high-detail props (lamp glass, bin lids, benches, signs) are also emitted
	// as HISM instances so they cost one draw call for the whole cell.
	UHierarchicalInstancedStaticMeshComponent* Props = Cell.Actor->GetPropInstances();
	if (!Props)
	{
		return;
	}

	const FVector Origin = CellToWorld(Cell.Coord);
	int32 Added = 0;

	for (const FVector& Point : Cell.CellData.PedestrianSpawnPoints)
	{
		// Sidewalk points double as prop anchor points (planters, signs).
		Props->AddInstance(FTransform(FRotator::ZeroRotator, Point - Origin, FVector::OneVector));
		Added++;
	}

	UE_LOG(LogBCUCityStreamer, Verbose, TEXT("Cell %s: %d instanced props"), *Cell.Coord.ToString(), Added);
}

UBCUCellActor* ABCUCityStreamer::SpawnCellActor(const FBCUCellCoord& Coord, UBCUDistrictDataAsset* District)
{
	FActorSpawnParameters Params;
	Params.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	Params.bNoFail = true;
	Params.ObjectFlags |= RF_Transient;
	Params.Name = FName(*FString::Printf(TEXT("BCUCell_%d_%d"), Coord.X, Coord.Y));

	UBCUCellActor* Actor = GetWorld()->SpawnActor<UBCUCellActor>(
		UBCUCellActor::StaticClass(), CellToWorld(Coord), FRotator::ZeroRotator, Params);

	if (Actor)
	{
		Actor->SetCellCoord(Coord);
		Actor->SetDistrict(District);
		Actor->SetNaniteEnabled(bUseNaniteForClusters);
		Actor->SetDistanceFieldOcclusion(bEnableDistanceFieldOcclusion);
	}

	return Actor;
}

//═══════════════════════════════════════════════════════════════════════════════
// Eviction + HLOD
//═══════════════════════════════════════════════════════════════════════════════

void ABCUCityStreamer::EvictDistantCells()
{
	const FBCUCellCoord Centre = WorldToCell(StreamingSource);
	const float UnloadRadiusSq = float(UnloadRadiusCells * UnloadRadiusCells);

	TArray<FBCUCellCoord> ToRemove;

	for (const TPair<FBCUCellCoord, FBCUResidentCell>& Pair : ResidentCells)
	{
		// Never evict a cell that is mid-build: the async task holds a pointer.
		if (InFlightBuilds.Contains(Pair.Key))
		{
			continue;
		}

		if (Pair.Value.District && Pair.Value.District->bAlwaysResident)
		{
			continue;
		}

		const int32 DX = Pair.Key.X - Centre.X;
		const int32 DY = Pair.Key.Y - Centre.Y;
		if (float(DX * DX + DY * DY) > UnloadRadiusSq)
		{
			ToRemove.Add(Pair.Key);
		}
	}

	for (const FBCUCellCoord& Coord : ToRemove)
	{
		ReleaseCell(Coord);
	}
}

void ABCUCityStreamer::UpdateHLODProxies()
{
	// HLOD proxies are merged 4×4-cell blocks. We only rebuild a block when the
	// player crosses into a new block, which happens a handful of times per
	// minute rather than every frame.
	const FBCUCellCoord Centre = WorldToCell(StreamingSource);
	const int32 BlockX = Centre.X / 4;
	const int32 BlockY = Centre.Y / 4;

	static int32 LastBlockX = TNumericLimits<int32>::Min();
	static int32 LastBlockY = TNumericLimits<int32>::Min();

	if (BlockX == LastBlockX && BlockY == LastBlockY)
	{
		return;
	}
	LastBlockX = BlockX;
	LastBlockY = BlockY;

	if (ResidentCells.Num() == 0)
	{
		return;
	}

	// Show proxies for the ring of blocks beyond the full-detail radius, hide
	// the ones the player has driven into.
	for (const TPair<FBCUCellCoord, FBCUResidentCell>& Pair : ResidentCells)
	{
		if (!Pair.Value.Actor)
		{
			continue;
		}

		const float DistanceCm = FMath::Sqrt(Pair.Value.DistanceSq) * CellSizeCm;
		const bool bBeyondHLOD = DistanceCm > HLODMergeDistanceCm;
		Pair.Value.Actor->SetHLODVisible(bBeyondHLOD);
		Pair.Value.Actor->SetFullDetailVisible(!bBeyondHLOD);
	}
}

//═══════════════════════════════════════════════════════════════════════════════
// Public API
//═══════════════════════════════════════════════════════════════════════════════

void ABCUCityStreamer::SetStreamingSource(const FVector& NewSource)
{
	StreamingSource = NewSource;
	UpdateWantedCells();
}

void ABCUCityStreamer::RequestCell(const FBCUCellCoord& Coord, bool bImmediate)
{
	if (!IsInRegion(Coord))
	{
		return;
	}

	if (ResidentCells.Contains(Coord))
	{
		return;
	}

	if (bImmediate)
	{
		FBCUResidentCell& Cell = ResidentCells.FindOrAdd(Coord);
		Cell.Coord = Coord;
		Cell.District = GetDistrictForCell(Coord);
		Cell.Actor = SpawnCellActor(Coord, Cell.District);
		Cell.Grid = NewObject<UBCUVoxelGrid>(this);
		Cell.Grid->MaterialSet = MaterialSet;
		Cell.Grid->Initialise(FIntVector(256, 256, 240), FIntVector(4, 4, 4), Coord, VoxelScaleCm);
		Cell.DistanceSq = 0.0f;
		Cell.LastTouchTime = GetWorld()->GetTimeSeconds();

		// Synchronous build: used by mission pre-load so a chase never streams
		// in mid-pursuit. Blocks the game thread for ~40-120 ms.
		{
			FScopeLock Lock(&InFlightLock);
			InFlightBuilds.Add(Coord);
		}
		BuildCell(Cell);
		return;
	}

	if (!PendingCells.Contains(Coord))
	{
		PendingCells.Insert(Coord, 0); // jump the queue
	}
}

void ABCUCityStreamer::ReleaseCell(const FBCUCellCoord& Coord)
{
	FBCUResidentCell* Cell = ResidentCells.Find(Coord);
	if (!Cell)
	{
		return;
	}

	if (InFlightBuilds.Contains(Coord))
	{
		// Defer: the worker still holds the grid pointer.
		PendingCells.AddUnique(Coord);
		return;
	}

	TotalTriangles -= Cell->TriangleCount;
	Cell->State = 4;
	OnCellStateChanged.Broadcast(Coord, 4);

	if (Cell->Actor)
	{
		Cell->Actor->DestroyCell();
		Cell->Actor->Destroy();
	}

	if (UWorld* World = GetWorld())
	{
		if (UBCUTrafficSubsystem* Traffic = World->GetSubsystem<UBCUTrafficSubsystem>())
		{
			Traffic->UnregisterCell(Coord);
		}
		if (UBCUPedestrianSubsystem* Peds = World->GetSubsystem<UBCUPedestrianSubsystem>())
		{
			Peds->UnregisterCell(Coord);
		}
		if (UBCUPoliceSubsystem* Police = World->GetSubsystem<UBCUPoliceSubsystem>())
		{
			Police->UnregisterPatrolPoints(Coord);
		}
	}

	ResidentCells.Remove(Coord);
	UE_LOG(LogBCUCityStreamer, Verbose, TEXT("Released cell %s"), *Coord.ToString());
}

int32 ABCUCityStreamer::GetResidentCellCount() const
{
	return ResidentCells.Num();
}

bool ABCUCityStreamer::IsCellResident(const FBCUCellCoord& Coord) const
{
	const FBCUResidentCell* Cell = ResidentCells.Find(Coord);
	return Cell && Cell->State == 3;
}

FBCUCellCoord ABCUCityStreamer::WorldToCell(const FVector& WorldPosition) const
{
	return FBCUCellCoord(
		FMath::FloorToInt(WorldPosition.X / CellSizeCm),
		FMath::FloorToInt(WorldPosition.Y / CellSizeCm));
}

FVector ABCUCityStreamer::CellToWorld(const FBCUCellCoord& Coord) const
{
	return FVector(Coord.X * CellSizeCm, Coord.Y * CellSizeCm, 0.0f);
}

UBCUVoxelGrid* ABCUCityStreamer::GetCellGrid(const FBCUCellCoord& Coord) const
{
	const FBCUResidentCell* Cell = ResidentCells.Find(Coord);
	return Cell ? Cell->Grid : nullptr;
}

UBCUDistrictDataAsset* ABCUCityStreamer::GetDistrict(FName DistrictId) const
{
	for (UBCUDistrictDataAsset* District : Districts)
	{
		if (District && District->DistrictId == DistrictId)
		{
			return District;
		}
	}
	return nullptr;
}

UBCUDistrictDataAsset* ABCUCityStreamer::GetDistrictForCell(const FBCUCellCoord& Coord) const
{
	// First check the authored district bounds, then fall back to the procedural
	// region layout so an unauthored cell still generates sensibly.
	for (UBCUDistrictDataAsset* District : Districts)
	{
		if (District && District->ContainsCell(Coord))
		{
			return District;
		}
	}

	const FName Generated = UBCUCityGenerator::ResolveDistrictName(Coord, CitySeed);
	return GetDistrict(Generated);
}

UBCUDistrictDataAsset* ABCUCityStreamer::GetCurrentDistrict() const
{
	return GetDistrictForCell(WorldToCell(StreamingSource));
}

//═══════════════════════════════════════════════════════════════════════════════
// Runtime voxel editing (destruction)
//═══════════════════════════════════════════════════════════════════════════════

bool ABCUCityStreamer::SetVoxelAtWorldLocation(const FVector& WorldLocation,
	EBCUVoxelMaterial Material, uint8 PaletteIndex)
{
	const FBCUCellCoord Coord = WorldToCell(WorldLocation);
	UBCUVoxelGrid* Grid = GetCellGrid(Coord);
	if (!Grid)
	{
		return false;
	}

	const FVector Local = WorldLocation - CellToWorld(Coord);
	const FIntVector Voxel(
		FMath::FloorToInt(Local.X / VoxelScaleCm),
		FMath::FloorToInt(Local.Y / VoxelScaleCm),
		FMath::FloorToInt(Local.Z / VoxelScaleCm));

	Grid->SetVoxel(Voxel, Material, PaletteIndex);

	if (FBCUResidentCell* Cell = ResidentCells.Find(Coord))
	{
		Cell->State = 2; // re-mesh next tick
		Cell->Grid->MarkAllChunksDirty();
	}

	return true;
}

int32 ABCUCityStreamer::DestroyVoxelsInRadius(const FVector& WorldLocation, float RadiusCm, bool bOnlyDestructible)
{
	const FBCUCellCoord Coord = WorldToCell(WorldLocation);
	UBCUVoxelGrid* Grid = GetCellGrid(Coord);
	if (!Grid)
	{
		return 0;
	}

	const FVector Local = WorldLocation - CellToWorld(Coord);
	const FIntVector Centre(
		FMath::FloorToInt(Local.X / VoxelScaleCm),
		FMath::FloorToInt(Local.Y / VoxelScaleCm),
		FMath::FloorToInt(Local.Z / VoxelScaleCm));

	const int32 RadiusVoxels = FMath::CeilToInt(RadiusCm / VoxelScaleCm);
	const float RadiusSq = float(RadiusVoxels * RadiusVoxels);
	int32 Removed = 0;

	for (int32 Z = Centre.Z - RadiusVoxels; Z <= Centre.Z + RadiusVoxels; ++Z)
	{
		for (int32 Y = Centre.Y - RadiusVoxels; Y <= Centre.Y + RadiusVoxels; ++Y)
		{
			for (int32 X = Centre.X - RadiusVoxels; X <= Centre.X + RadiusVoxels; ++X)
			{
				const int32 DX = X - Centre.X;
				const int32 DY = Y - Centre.Y;
				const int32 DZ = Z - Centre.Z;
				if (float(DX * DX + DY * DY + DZ * DZ) > RadiusSq)
				{
					continue;
				}

				const FIntVector Pos(X, Y, Z);
				const FBCUVoxel Voxel = Grid->GetVoxel(Pos);
				if (Voxel.IsEmpty())
				{
					continue;
				}
				if (bOnlyDestructible && !Voxel.IsDestructible())
				{
					continue;
				}

				Grid->ClearVoxel(Pos);
				Removed++;
			}
		}
	}

	if (Removed > 0)
	{
		Grid->MarkAllChunksDirty();
		if (FBCUResidentCell* Cell = ResidentCells.Find(Coord))
		{
			Cell->State = 2;
		}
	}

	UE_LOG(LogBCUCityStreamer, Verbose, TEXT("Destroyed %d voxels at %s (r=%.0f cm)"),
		Removed, *WorldLocation.ToString(), RadiusCm);
	return Removed;
}

bool ABCUCityStreamer::VoxelLineTrace(const FVector& Start, const FVector& End,
	FVector& OutHitLocation, FVector& OutNormal, FBCUVoxel& OutVoxel) const
{
	// Step along the segment in half-voxel increments and query each cell's
	// grid with its exact DDA. This keeps the trace correct across cell borders
	// without a global voxel structure.
	const FVector Delta = End - Start;
	const float Length = Delta.Size();
	if (Length < KINDA_SMALL_NUMBER)
	{
		return false;
	}

	const FVector Step = Delta.GetSafeNormal() * (VoxelScaleCm * 0.5f);
	const int32 MaxSteps = FMath::Clamp(FMath::CeilToInt(Length / (VoxelScaleCm * 0.5f)), 1, 4096);

	FVector Sample = Start;
	FBCUCellCoord LastCoord = WorldToCell(Sample);

	for (int32 i = 0; i < MaxSteps; ++i, Sample += Step)
	{
		const FBCUCellCoord Coord = WorldToCell(Sample);
		UBCUVoxelGrid* Grid = GetCellGrid(Coord);
		if (!Grid)
		{
			LastCoord = Coord;
			continue;
		}

		const FIntVector Voxel = Grid->WorldToVoxel(Sample);
		if (!Grid->IsEmpty(Voxel))
		{
			OutVoxel = Grid->GetVoxel(Voxel);
			OutHitLocation = Grid->VoxelToWorld(Voxel) + CellToWorld(Coord);

			// Normal = back towards the previous sample.
			OutNormal = (LastCoord == Coord) ? -Step.GetSafeNormal() : FVector::UpVector;
			return true;
		}

		LastCoord = Coord;
	}

	return false;
}

//═══════════════════════════════════════════════════════════════════════════════
// Debug / scalability
//═══════════════════════════════════════════════════════════════════════════════

void ABCUCityStreamer::SetDebugMode(EBCUCityDebugMode Mode)
{
	DebugMode = Mode;

	for (const TPair<FBCUCellCoord, FBCUResidentCell>& Pair : ResidentCells)
	{
		if (Pair.Value.Actor)
		{
			Pair.Value.Actor->SetDebugMode(Mode);
		}
	}
}

void ABCUCityStreamer::ApplyScalabilitySettings()
{
	// Read the BCU city group so the video options drive streaming directly.
	static const auto CVarRadius = IConsoleManager::Get().FindTConsoleVariableDataInt(TEXT("bcu.city.LoadRadiusCells"));
	static const auto CVarLODBias = IConsoleManager::Get().FindTConsoleVariableDataInt(TEXT("bcu.city.MeshLODBias"));
	static const auto CVarPerFrame = IConsoleManager::Get().FindTConsoleVariableDataInt(TEXT("bcu.city.MaxCellsLoadedPerFrame"));
	static const auto CVarHLOD = IConsoleManager::Get().FindTConsoleVariableDataInt(TEXT("bcu.city.HLODOnlyDistanceCm"));
	static const auto CVarInterior = IConsoleManager::Get().FindTConsoleVariableDataInt(TEXT("bcu.city.InteriorStreaming"));

	if (CVarRadius)		{ LoadRadiusCells = FMath::Clamp(CVarRadius->GetValueOnGameThread(), 1, 12); }
	if (CVarPerFrame)	{ MaxCellsLoadedPerFrame = FMath::Clamp(CVarPerFrame->GetValueOnGameThread(), 1, 8); }
	if (CVarHLOD)		{ HLODMergeDistanceCm = float(FMath::Max(10000, CVarHLOD->GetValueOnGameThread())); }
	if (CVarLODBias)	{ UnloadRadiusCells = LoadRadiusCells + 2 + CVarLODBias->GetValueOnGameThread(); }
	if (CVarInterior)	{ bGenerateInteriors = CVarInterior->GetValueOnGameThread() > 0; }

	UnloadRadiusCells = FMath::Max(LoadRadiusCells + 1, UnloadRadiusCells);
}

void ABCUCityStreamer::OnScalabilityChanged()
{
	ApplyScalabilitySettings();
	UE_LOG(LogBCUCityStreamer, Log, TEXT("Scalability changed → load radius %d cells, HLOD %.0f m"),
		LoadRadiusCells, HLODMergeDistanceCm / 100.0f);
}

FString ABCUCityStreamer::GetStreamingStats() const
{
	return FString::Printf(
		TEXT("cells=%d pending=%d inflight=%d tris=%s gen=%d avgGen=%.1fms avgMesh=%.1fms radius=%d"),
		ResidentCells.Num(), PendingCells.Num(), InFlightBuilds.Num(),
		*FString::SanitizeFloat(float(TotalTriangles) / 1000.0f, 1) + TEXT("k"),
		TotalCellsGenerated,
		TotalCellsGenerated > 0 ? TotalGenerationMs / TotalCellsGenerated : 0.0,
		TotalCellsGenerated > 0 ? TotalMeshMs / TotalCellsGenerated : 0.0,
		LoadRadiusCells);
}

FBCUCellCoord ABCUCityStreamer::ClampToRegion(const FBCUCellCoord& Coord) const
{
	const int32 HalfX = RegionExtentCells.X / 2;
	const int32 HalfY = RegionExtentCells.Y / 2;
	return FBCUCellCoord(
		FMath::Clamp(Coord.X, -HalfX, HalfX - 1),
		FMath::Clamp(Coord.Y, -HalfY, HalfY - 1));
}

bool ABCUCityStreamer::IsInRegion(const FBCUCellCoord& Coord) const
{
	const int32 HalfX = RegionExtentCells.X / 2;
	const int32 HalfY = RegionExtentCells.Y / 2;
	return Coord.X >= -HalfX && Coord.X < HalfX && Coord.Y >= -HalfY && Coord.Y < HalfY;
}
