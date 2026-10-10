# Build and Run

## 1. Requirements

| | Minimum | Recommended |
|---|---|---|
| Engine | Unreal Engine 5.5 | 5.5.x latest hotfix |
| OS | Windows 10 22H2 x64 | Windows 11 x64 |
| GPU | RTX 3060 12 GB (DX12, SM6) | **RTX 5060-class 8–12 GB** |
| CPU | 6-core / 12-thread | 8-core / 16-thread |
| RAM | 16 GB | 32 GB |
| Disk | 90 GB free (engine + project + DDC) | NVMe SSD |
| IDE | Visual Studio 2022 + "Game development with C++" workload | same |

The project targets **DirectX 12 with Shader Model 6** on Win64 because Lumen
hardware ray tracing, Nanite and virtual shadow maps all require it.

## 2. First-time setup

```bash
git clone <this-repository>
cd neurio/BlockCityUltra
python3 ../Tools/scaffold_content.py      # generates Content/ (Blueprints, data tables)
```

`scaffold_content.py` is idempotent: re-running it only writes files that are
missing or older than the CSVs in `Tools/data/`. It never overwrites a Blueprint
you have edited, because it writes `.uasset` placeholders plus the source data
tables that the Blueprints read — the assets themselves are created by the
editor on first load.

Then open `BlockCityUltra.uproject`. Unreal will report that modules are out of
date; click **Yes** to rebuild.

## 3. Building from the command line

```powershell
# Editor build (development)
"<UE>\Engine\Build\BatchFiles\Build.bat" BlockCityUltraEditor Win64 Development ^
  -Project="<repo>\BlockCityUltra\BlockCityUltra.uproject" -WaitMutex

# Game build (development)
"<UE>\Engine\Build\BatchFiles\Build.bat" BlockCityUltra Win64 Development ^
  -Project="<repo>\BlockCityUltra\BlockCityUltra.uproject" -WaitMutex

# Shipping build for distribution
"<UE>\Engine\Build\BatchFiles\Build.bat" BlockCityUltra Win64 Shipping ^
  -Project="<repo>\BlockCityUltra\BlockCityUltra.uproject" -WaitMutex
```

Generate IDE project files whenever a `.Build.cs` changes:

```powershell
"<UE>\Engine\Binaries\DotNET\UnrealBuildTool\UnrealBuildTool.exe" -ProjectFiles ^
  -Project="<repo>\BlockCityUltra\BlockCityUltra.uproject" -Game -Engine
```

## 4. Build defines

`BlockCityUltra.Target.cs` sets these; they are what the `#if` guards in the
source respond to.

| Define | Meaning |
|---|---|
| `BCU_ASYNC_CITY_GEN` | Enables worker-thread city generation |
| `BCU_MAX_ASYNC_BUILD_THREADS` | Cap on concurrent generation jobs (default 6) |
| `BCU_SUPPORTS_HWRT` | Platform supports hardware ray tracing (probed, then compiled) |
| `BCU_SUPPORTS_MESH_SHADERS` | Platform supports SM6 mesh shaders |
| `BCU_REQUIRE_NANITE` / `BCU_REQUIRE_LUMEN` | Hard requirement for the renderer |
| `BCU_WITH_OPTIONAL_DLSS` | Win64 only: compile the DLSS probe path (never links DLSS) |
| `BCU_WITH_PROFILING` | Development/DebugGame only: enable `BCU_WITH_PROFILING` stats |

## 5. Packaging

`Config/DefaultGame.ini` already configures Shipping, IoStore, pak, chunked
packaging and the cook list. Package from the editor:

**Platforms → Windows → Package Project**

or from the command line:

```powershell
"<UE>\Engine\Build\BatchFiles\RunUAT.bat" BuildCookRun ^
  -project="<repo>\BlockCityUltra\BlockCityUltra.uproject" ^
  -platform=Win64 -clientconfig=Shipping -build -cook -stage -pak -iostore ^
  -archive -archivedirectory="<out>" -nocompileeditor
```

## 6. First-build checklist

If the build fails, work through this in order. These are the only places where
hand-written UE C++ commonly disagrees with a specific engine point release.

1. **Chaos vehicle API.** `BCUBaseVehicle.cpp` uses
   `UChaosWheeledVehicleMovementComponent::WheelSetups`, `FChaosEngineGearData`
   and `UChaosVehicleWheel` fields (`MaxDrop`, `SpringRate`, `SlipThreshold`).
   In 5.5 these exist; if your engine is 5.4 or earlier, several were named
   differently. Fix at the call sites in `ApplyDefinitionToChaos()`.
2. **`FMeshNaniteSettings`.** `BCUVoxelMesher::CreateStaticMesh` and
   `BCUCellActor` set Nanite per-component. In 5.5 this is
   `UStaticMeshComponent::SetNaniteSettings`. If your engine moved it to
   `FStaticMeshComponentNaniteSettings`, change the type only.
3. **`FMeshDescription` / `FStaticMeshAttributes`.** The mesher builds meshes with
   `MeshDescription`. This is the stable 5.x API; the only thing that moves
   between releases is whether `SetMeshDescription` or `AddSourceModel` must be
   called first. Current order: `AddSourceModel()` → `SetMeshDescription(i, …)`.
4. **`FScalability::OnScalabilityChanged()`.** Used by `BCUCityStreamer`. The
   delegate is parameterless; if your engine version passes a struct, add the
   parameter to `OnScalabilityChanged()`.
5. **`WheeledVehiclePawn` base class.** `ABCUBaseVehicle` derives from it. If
   ChaosVehiclesPlugin is not enabled in your engine build, enable it in the
   `.uproject` (it is listed and enabled by default).
6. **Missing assets are not build errors.** `/Game/Blueprints/...` paths in
   `DefaultGame.ini` and the subsystem defaults are soft references; a missing
   asset logs a warning at runtime and the system falls back to its defaults.

## 7. Running the vertical slice

`L_VaultCity_Slice` is the Phase 1 map: one district (Foundry Heights), one
drivable vehicle, the third-person character, realistic lighting, traffic,
police AI and one complete delivery mission.

Controls (also in `Config/DefaultInput.ini`):

| Action | Keyboard | Gamepad |
|---|---|---|
| Move / throttle | W A S D | Left stick / triggers |
| Look | Mouse | Right stick |
| Sprint | Left Shift | L3 |
| Enter / exit vehicle | F | X (Square) |
| Interact | E | B (Circle) |
| Handbrake | Space | B (Circle) |
| Camera mode | C | Right bumper |
| Map | M | Select |
| Phone / missions | Tab | D-pad down |
| Pause | Esc | Start |
| Presets | Alt+1…Alt+4 | — |
| Perf dump | F10 | — |
| Screenshot | F12 | — |

## 8. Console commands

| Command | Effect |
|---|---|
| `bcu.preset.performance` / `.balanced` / `.quality` / `.ultra` | Switch graphics preset |
| `bcu.benchmark` | 6-second capture, prints average FPS |
| `bcu.dump.perf` | Full CPU/GPU/memory/draw-call/streaming report |
| `bcu.city.Quality 0..3` | City detail tier |
| `bcu.city.LoadRadiusCells N` | Resident cells around the player |
| `bcu.city.InteriorStreaming 0/1` | Stream building interiors |
| `bcu.traffic.MaxActiveVehicles N` | Traffic budget |
| `bcu.traffic.MaxActivePedestrians N` | Pedestrian budget |
| `bcu.weather.WetnessOverride 0..1` | Force wet roads |
| `bcu.raytracing.Mode 0..3` | RT tier (ignored if unsupported) |
| `bcu.upscaler.Mode 0..3` | TSR / DLSS SR / DLSS+FG / off |
