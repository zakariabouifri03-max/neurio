// Copyright (c) Neurio Interactive. BLOCK CITY ULTRA — original IP.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "World/Voxel/BCUVoxelTypes.h"
#include "World/City/BCUCityGenerator.h"
#include "BCUCityStreamer.generated.h"

class UBCUVoxelGrid;
class UBCUVoxelMaterialSet;
class UBCUDistrictDataAsset;
class UHierarchicalInstancedStaticMeshComponent;
class UStaticMeshComponent;
class UInstancedStaticMeshComponent;
class UBCUCellActor;
struct FBCUVoxelMeshData;

/** One resident city cell: its grid, its meshes, its instanced props. */
USTRUCT(BlueprintType)
struct FBCUResidentCell
{
	GENERATED_BODY()

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City|Streaming")
	FBCUCellCoord Coord;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City|Streaming")
	TObjectPtr<UBCUCellActor> Actor = nullptr;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City|Streaming")
	TObjectPtr<UBCUVoxelGrid> Grid = nullptr;

	UPROPERTY(BlueprintReadOnly, Category = "BCU|City|Streaming")
	TObjectPtr<UBCUDistrictDataAsset> District = nullptr;

	/** Generation data kept alive so HLOD rebuilds do not re-run generation. */
	FBCUCityCellData CellData;

	/** 0 = queued, 1 = generating, 2 = meshing, 3 = resident, 4 = unloading. */
	int32 State = 0;

	/** Squared distance to the streaming source, in cm. */
	float DistanceSq = TNumericLimits<float>::Max();

	/** Last time the cell was touched (for LRU eviction). */
	double LastTouchTime = 0.0;

	/** Mesh build time in ms — surfaced by `bcu.city.stat`. */
	double MeshBuildMs = 0.0;

	/** Triangle count of the resident meshes. */
	int32 TriangleCount = 0;
};

UENUM(BlueprintType)
enum class EBCUCityDebugMode : uint8
{
	None			UMETA(DisplayName = "None"),
	CellBounds		UMETA(DisplayName = "Cell Bounds"),
	ChunkWireframe	UMETA(DisplayName = "Chunk Wireframe"),
	LODColors		UMETA(DisplayName = "LOD Heatmap"),
	VoxelNormals	UMETA(DisplayName = "Voxel Normals"),
	TrafficLanes	UMETA(DisplayName = "Traffic Lanes"),
	Districts		UMETA(DisplayName = "District Overlay")
};

DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FOnBCUCellStateChanged, FBCUCellCoord, Coord, int32, NewState);
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FOnBCUStreamingProgress, float, Progress01);

/**
 * Runtime city streaming.
 *
 * Sits on top of World Partition. World Partition owns *where* actors live and
 * which cells are source-loaded; UBCUCityStreamer owns *what the city is*:
 * it decides which cells to generate, on which worker thread, at which voxel
 * LOD, and when to swap a cell for its HLOD proxy.
 *
 * Budget model (Ultra preset, RTX 5060-class):
 *   - 5-cell load radius (≈1.3 km) of full-detail voxel meshes
 *   - 2 cells generated per frame max, on 4 async workers
 *   - beyond the HLOD distance, one merged proxy mesh per 4×4 cells
 *   - props (lamps, bins, trees, signs) are HISM instances, never actors
 *
 * This is what keeps a 200 km² city inside a 12 GB VRAM budget: the player only
 * ever pays for ~1 km² of real geometry.
 */
UCLASS(Blueprintable, meta = (DisplayName = "BCU City Streamer"))
class BLOCKCITYULTRA_API ABCUCityStreamer : public AActor
{
	GENERATED_BODY()

public:
	ABCUCityStreamer();

	//~ AActor
	virtual void BeginPlay() override;
	virtual void Tick(float DeltaSeconds) override;
	virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
	//~ End

	// ── Configuration ───────────────────────────────────────────────────────
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|City|Streaming", config)
	float CellSizeCm = 25600.0f;

	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|City|Streaming", config)
	float VoxelScaleCm = 25.0f;

	/** Cells loaded at full detail around the streaming source. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|City|Streaming", config, meta = (ClampMin = "1", ClampMax = "12"))
	int32 LoadRadiusCells = 5;

	/** Cells kept before eviction (hysteresis prevents thrash at the boundary). */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|City|Streaming", config, meta = (ClampMin = "2", ClampMax = "16"))
	int32 UnloadRadiusCells = 7;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|City|Streaming", config, meta = (ClampMin = "1", ClampMax = "8"))
	int32 MaxCellsLoadedPerFrame = 2;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|City|Streaming", config, meta = (ClampMin = "1", ClampMax = "16"))
	int32 MaxConcurrentAsyncBuilds = 4;

	/** Beyond this distance a cell is represented by its HLOD proxy only. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|City|Streaming", config)
	float HLODMergeDistanceCm = 230400.0f;

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|City|Streaming", config)
	bool bUseNaniteForClusters = true;

	/** Distance-field occlusion culling for the merged clusters. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|City|Streaming", config)
	bool bEnableDistanceFieldOcclusion = true;

	/** Off in Performance mode: interiors are never generated or streamed. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|City|Streaming", config)
	bool bGenerateInteriors = true;

	/** City seed — change it and you get a different, still coherent, city. */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "BCU|City|Seed")
	FBCUCitySeed CitySeed;

	/** Shared material set (traits + palettes) for every generated mesh. */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|City|Seed")
	TObjectPtr<UBCUVoxelMaterialSet> MaterialSet;

	/** District table. Index by name via GetDistrict(). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|City|Seed")
	TArray<TObjectPtr<UBCUDistrictDataAsset>> Districts;

	/** Region extent in cells (96×96 ≈ 24.6 km per side including wilderness). */
	UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "BCU|City|Seed", meta = (ClampMin = "8", ClampMax = "512"))
	FIntPoint RegionExtentCells = FIntPoint(96, 96);

	// ── Runtime API ─────────────────────────────────────────────────────────
	/** Sets the streaming source (player camera). Called by the game mode. */
	UFUNCTION(BlueprintCallable, Category = "BCU|City|Streaming")
	void SetStreamingSource(const FVector& NewSource);

	/** Forces a cell to be resident right now (mission pre-load). */
	UFUNCTION(BlueprintCallable, Category = "BCU|City|Streaming")
	void RequestCell(const FBCUCellCoord& Coord, bool bImmediate = false);

	/** Frees a cell immediately, ignoring the unload radius. */
	UFUNCTION(BlueprintCallable, Category = "BCU|City|Streaming")
	void ReleaseCell(const FBCUCellCoord& Coord);

	UFUNCTION(BlueprintPure, Category = "BCU|City|Streaming")
	int32 GetResidentCellCount() const;

	UFUNCTION(BlueprintPure, Category = "BCU|City|Streaming")
	bool IsCellResident(const FBCUCellCoord& Coord) const;

	/** World → cell coordinate. */
	UFUNCTION(BlueprintPure, Category = "BCU|City|Streaming")
	FBCUCellCoord WorldToCell(const FVector& WorldPosition) const;

	/** Cell coordinate → world origin. */
	UFUNCTION(BlueprintPure, Category = "BCU|City|Streaming")
	FVector CellToWorld(const FBCUCellCoord& Coord) const;

	/** The voxel grid of a resident cell, or nullptr. */
	UFUNCTION(BlueprintPure, Category = "BCU|City|Streaming")
	UBCUVoxelGrid* GetCellGrid(const FBCUCellCoord& Coord) const;

	/** District asset covering a cell. */
	UFUNCTION(BlueprintPure, Category = "BCU|City|Streaming")
	UBCUDistrictDataAsset* GetDistrictForCell(const FBCUCellCoord& Coord) const;

	UFUNCTION(BlueprintPure, Category = "BCU|City|Streaming")
	UBCUDistrictDataAsset* GetDistrict(FName DistrictId) const;

	/** District the streaming source is currently inside. */
	UFUNCTION(BlueprintPure, Category = "BCU|City|Streaming")
	UBCUDistrictDataAsset* GetCurrentDistrict() const;

	// ── Voxel editing at runtime (destruction, player-built props) ──────────
	/** Sets one voxel in world space; the owning cell re-meshes next frame. */
	UFUNCTION(BlueprintCallable, Category = "BCU|City|Voxel")
	bool SetVoxelAtWorldLocation(const FVector& WorldLocation, EBCUVoxelMaterial Material, uint8 PaletteIndex = 0);

	/** Removes voxels in a world-space sphere — the destruction primitive. */
	UFUNCTION(BlueprintCallable, Category = "BCU|City|Voxel")
	int32 DestroyVoxelsInRadius(const FVector& WorldLocation, float RadiusCm, bool bOnlyDestructible = false);

	/** Voxel raycast in world space. Cheaper and exact vs. a physics trace. */
	UFUNCTION(BlueprintCallable, Category = "BCU|City|Voxel")
	bool VoxelLineTrace(const FVector& Start, const FVector& End, FVector& OutHitLocation,
		FVector& OutNormal, FBCUVoxel& OutVoxel) const;

	// ── Debug / profiling ───────────────────────────────────────────────────
	UFUNCTION(BlueprintCallable, Category = "BCU|City|Debug")
	void SetDebugMode(EBCUCityDebugMode Mode);

	UFUNCTION(BlueprintPure, Category = "BCU|City|Debug")
	EBCUCityDebugMode GetDebugMode() const { return DebugMode; }

	/** One-line profiler summary for `bcu.city.stat`. */
	UFUNCTION(BlueprintPure, Category = "BCU|City|Debug")
	FString GetStreamingStats() const;

	UPROPERTY(BlueprintAssignable, Category = "BCU|City|Streaming")
	FOnBCUCellStateChanged OnCellStateChanged;

	UPROPERTY(BlueprintAssignable, Category = "BCU|City|Streaming")
	FOnBCUStreamingProgress OnStreamingProgress;

	/** True once the initial radius is fully resident (drives the loading bar). */
	UPROPERTY(BlueprintReadOnly, Category = "BCU|City|Streaming")
	bool bInitialLoadComplete = false;

protected:
	UPROPERTY(Transient)
	TMap<FBCUCellCoord, FBCUResidentCell> ResidentCells;

	/** Queue of cells waiting to be generated, nearest first. */
	TArray<FBCUCellCoord> PendingCells;

	FVector StreamingSource = FVector::ZeroVector;
	EBCUCityDebugMode DebugMode = EBCUCityDebugMode::None;
	double LastStreamingUpdate = 0.0;
	int32 CellsGeneratedThisFrame = 0;
	int32 TotalCellsGenerated = 0;
	double TotalGenerationMs = 0.0;
	double TotalMeshMs = 0.0;
	int32 TotalTriangles = 0;

	/** Recomputes the wanted cell set from the streaming source. */
	void UpdateWantedCells();

	/** Advances queued cells through generate → mesh → resident. */
	void ProcessBuildQueue(float DeltaSeconds);

	/** Evicts cells outside the unload radius, nearest-last (LRU). */
	void EvictDistantCells();

	/** Builds/updates the merged HLOD proxies beyond HLODMergeDistanceCm. */
	void UpdateHLODProxies();

	/** Applies the current scalability group to the streaming parameters. */
	void ApplyScalabilitySettings();

	/** Spawns the actor that carries a cell's meshes. */
	UBCUCellActor* SpawnCellActor(const FBCUCellCoord& Coord, UBCUDistrictDataAsset* District);

	/** Runs generation + meshing for one cell. May run on a worker thread. */
	void BuildCell(FBCUResidentCell& Cell);

	/** Uploads mesh data into the cell actor's components (game thread only). */
	void UploadCellMeshes(FBCUResidentCell& Cell, TMap<EBCUMeshSection, FBCUVoxelMeshData>& Sections);

	/** Adds instanced street props (lamps, bins, trees) to a cell. */
	void PopulateInstancedProps(FBCUResidentCell& Cell);

	FBCUCellCoord ClampToRegion(const FBCUCellCoord& Coord) const;
	bool IsInRegion(const FBCUCellCoord& Coord) const;

	/** Handles the async build completing. */
	void OnAsyncBuildComplete(const FBCUCellCoord& Coord, bool bSuccess);

private:
	/** Async job bookkeeping: coord → in-flight task. */
	TSet<FBCUCellCoord> InFlightBuilds;
	FCriticalSection InFlightLock;

	FDelegateHandle ScalabilityChangedHandle;
	void OnScalabilityChanged();
};
