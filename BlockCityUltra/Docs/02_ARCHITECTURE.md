# Architecture

## 1. Module layout

| Module | Type | Load phase | Contents |
|---|---|---|---|
| `BlockCityUltra` | Runtime | `PostConfigInit` | All gameplay, world generation, rendering control |
| `BlockCityUltraEditor` | Editor | `PostEngineInit` | City menu, HLOD bake, performance report |

`PostConfigInit` matters: the runtime module registers console variables that
`DefaultScalability.ini` and `DefaultEngine.ini` reference, and those must exist
before the config hierarchy is fully applied.

## 2. Subsystem map

Who owns what, and who talks to whom. Arrows mean "reads from".

```
                    ┌────────────────────────┐
                    │  UBCUGameInstance      │  loading screen, profiles,
                    │  (per game, survives   │  caches the four instance
                    │   map travel)          │  subsystems below
                    └───────────┬────────────┘
                                │
      ┌──────────────┬──────────┼──────────────┬────────────────┐
      ▼              ▼          ▼              ▼                ▼
 UBCUGraphics   UBCUSaveGame  UBCUAudio    UBCUInput      (DLSS probe)
 Subsystem      System        Subsystem    Subsystem
  presets,       slots,        music/radio  rebinding,
  upscaler,      async save    /mix         sensitivity
  RT, benchmark

                    ┌────────────────────────┐
                    │  UWorld subsystems     │  one per world, so a map
                    │                        │  travel resets them
                    └───────────┬────────────┘
      ┌──────────────┬──────────┼──────────────┬────────────────┐
      ▼              ▼          ▼              ▼                ▼
 UBCUTimeOfDay  UBCUWeather  UBCUTraffic   UBCUPedestrian   UBCUPolice
 System         System       Subsystem     Subsystem        Subsystem
  sun/sky/fog    rain/wet/    lane graph,   near pawns +     heat, wanted,
                 lightning    vehicle pool  far instances    dispatch, pursuit
      ▲              ▲          ▲              ▲                ▲
      └──────────────┴──────────┼──────────────┴────────────────┘
                                │
                    ┌───────────┴────────────┐
                    │  UBCUEconomySubsystem  │  cash, reputation, shops,
                    │  UBCUMissionSubsystem  │  property income, missions,
                    │  UBCUVehicleSubsystem  │  random events, garage
                    └────────────────────────┘
```

`ABCUCityStreamer` is an **actor**, not a subsystem, because it must be placed
per-level and carry per-level seed data. Every subsystem above reads it.

## 3. Class inventory

### Core (`Source/BlockCityUltra/Public/Core`)

| Class | Role |
|---|---|
| `ABCUGameMode` | Respawn, teleport-by-tag, difficulty → reward and police aggression multipliers |
| `UBCUGameInstance` | Survives map travel; caches subsystems; loading screen; save requests |
| `ABCUGameState` | Replicated clock, weather intensity, wetness, current district, resident cell count |
| `ABCUPlayerState` | Replicated cash, reputation, wanted level, district, distance stats |
| `ABCUSpawnPoint` | `APlayerStart` subclass with spawn kinds, tags, priority, night-only flag |
| `ABCUPlayerController` | **The only owner of input.** Enhanced Input contexts, vehicle entry/exit, UI toggles, respawn fade |
| `ABCUWorldSettings` | Per-map city seed, material set, district table, region extent |
| `UBCUAudioSubsystem` | Music states, layered pursuit score, radio stations, five mix buses |
| `UBCUInputSubsystem` | Rebinding, sensitivity, inversion; pushes into the mapping contexts |

### Player (`Public/Player`)

| Class | Role |
|---|---|
| `ABCUPlayerCharacter` | Third-person avatar; locomotion states, stamina, camera-relative movement |
| `UBCUCameraSystem` | One component, two parameter sets: spring-arm on foot, speed-reactive chase cam driving |
| `UBCUHealthComponent` | Health, armour, delayed regen to a ceiling; shared by player, peds and police |
| `UBCUInteractionComponent` | One sphere sweep + one line trace per frame; publishes a single focused actor |
| `UBCUVoxelBodyComponent` | Builds a character from cubes — 13 instanced unit-cube parts, one draw call |
| `UBCUSaveGameSystem` | 8 slots, async serialize, versioned migration, capture/apply to the player |
| `UBCUEconomySubsystem` | Cash, reputation, ranks, shops, unlocks, property income, inventory |

### World (`Public/World`)

| Class | Role |
|---|---|
| `UBCUVoxelGrid` | Sparse chunk storage; fill/carve/stamp; DDA raycast; flood fill |
| `FBCUVoxelMesher` | Greedy meshing into four sections; static-mesh upload; HLOD downsample |
| `UBCUVoxelMaterialSet` | 63-entry PBR trait table + palettes; decides Nanite compatibility |
| `UBCUCityGenerator` | Deterministic 6-pass generation: layout → parcels → massing → carve → dress → mesh |
| `ABCUCityStreamer` | Runtime streaming, async build queue, eviction, HLOD swap, runtime voxel editing |
| `ABCUCellActor` | Four mesh components per cell (one per section) + HISM props + HLOD proxy |
| `UBCUDistrictDataAsset` | Everything about a district: generation, dressing, AI, atmosphere, economy, streaming |
| `UBCUTimeOfDaySystem` | Real solar geometry; sun/sky/fog/atmosphere; drives every "is it night" question |
| `UBCUWeatherSystem` | Markov weather, wetness, wind, lightning, publishes to a Material Parameter Collection |

### Vehicle (`Public/Vehicle`)

| Class | Role |
|---|---|
| `ABCUBaseVehicle` | Chaos wheeled vehicle; seats, occupants, player+AI input merge, lights, fuel, state machine |
| `UBCUVehicleDefinition` | Pure data: performance, physics, voxel recipe, wheels, seats, materials, audio, economy |
| `UBCUVehicleSubsystem` | Catalogue, garage, district-weighted traffic picks, customisation costs, mesh cache |
| `UBCUVehicleVoxelBuilder` | Parametric vehicle body: profile recipes, greenhouse, wheels, interior, lights, trim |
| `UBCUVehicleAudioComponent` | Layered engine (idle+load crossfade), tyre scrub, wind, siren, distance ducking |
| `UBCUVehicleDamageComponent` | Cosmetic-first destruction: panel pop, smoke, fire, explosion, performance penalty |
| `UBCUVehicleCustomisationComponent` | Paint, finish, wheels, decals, kits, underglow, three upgrade tracks |

### AI (`Public/AI`)

| Class | Role |
|---|---|
| `UBCUTrafficSubsystem` | Lane graph, A* routing, vehicle pooling, three simulation tiers |
| `UBCUTrafficComponent` | Per-vehicle behaviour layered on the subsystem's lane following |
| `UBCUPedestrianSubsystem` | Two-tier crowd: near pawns + far instanced kinematic pedestrians |
| `ABCUPedestrianAIController` | Sight + hearing perception, panic, calm-down |
| `ABCUNPCCharacter` | One class for every person; role selects outfit, faction, hostility, interaction |

### Police (`Public/Police`)

| Class | Role |
|---|---|
| `UBCUPoliceSubsystem` | Heat, wanted buckets, crime events, dispatch profiles, pursuit phases, arrest |
| `ABCUPoliceUnit` | One officer: vehicle, tactic (follow/intercept/ram/box-in/search), predictive intercept |
| `UBCUWantedComponent` | Per-pawn cache of the wanted level + pursuit pressure for HUD and music |

### Mission (`Public/Mission`)

| Class | Role |
|---|---|
| `UBCUMissionDefinition` | Pure data: objectives, dialogue, rewards, prerequisites, world effects, preload cells |
| `UBCUMission` | Runtime instance; Blueprint-native events for bespoke logic |
| `UBCUMissionSubsystem` | Roster discovery, lifecycle, completion, random events, marker + GPS routing |

### UI (`Public/UI`)

| Class | Role |
|---|---|
| `ABCUPlayerHUD` | Minimap render target, GPS route, all HUD readouts, toasts, respawn fade |

### Graphics (`Public/Graphics`)

| Class | Role |
|---|---|
| `UBCUGraphicsSubsystem` | Presets, resolution/framerate targets, upscaler, RT mode, capability probes, benchmark |

## 4. Design decisions worth knowing

**Input lives only on the controller.** `ABCUPlayerController` binds every action
and swaps mapping contexts. A pawn never binds input, so entering a vehicle while
a menu is open still produces the right controls when the menu closes.

**The camera is not auto-managed.** `bAutoManageActiveCameraTarget = false`;
`UBCUCameraSystem` owns the view target. This is what lets the camera move from
the character to the vehicle and back without a cut.

**Voxel geometry is real geometry.** No pixelation post-process exists anywhere in
the project. The blocky look comes from `FBCUVoxelMesher` emitting one quad per
visible voxel face, greedy-merged only when material, palette *and* shade match.

**Four mesh sections per cell.** Opaque goes to Nanite. Masked (foliage),
translucent (glass, water) and emissive (windows, neon) do not, because those
material modes are not Nanite-compatible. That is the "alternative rendering path"
the brief requires, and it is a per-section decision rather than a global one.

**Generation is deterministic and pure.** Every `UBCUCityGenerator` function takes
its seed as an argument and touches no global state, so it runs on a worker thread
and produces byte-identical output on every machine. That is what makes a save
file reproducible and a bug report actionable.

**Distance LOD is everywhere.** Traffic has three tiers, pedestrians have two,
police units drop to 0.15× tick rate, cells swap to HLOD proxies, interiors are
only generated for buildings the player can enter. No system in the project
simulates something the player cannot perceive.

**Emissions are voxels, not lights.** A lit window is an emissive voxel in the
mesh, chosen once at generation time. There is no per-window light component,
which is why a night skyline with 40 000 lit windows costs nothing.

## 5. Threading model

| Work | Thread |
|---|---|
| City generation + carving | Worker (`Async(EAsyncExecution::ThreadPool, …)`) |
| Voxel meshing | Worker |
| Mesh upload, `UStaticMesh` creation | Game thread (`AsyncTask(ENamedThreads::GameThread, …)`) |
| Traffic/pedestrian/police AI | Game thread, at a rate chosen per simulation tier |
| Save serialization | Worker; capture happens on the game thread first |
| Benchmark capture | `OnFrameReadyDelegate` (render thread callback) |

The rule is simple: anything that creates or mutates a `UObject`'s render state is
on the game thread; everything else is a pure function on a worker.

## 6. Where to add things

| You want to add… | Edit |
|---|---|
| A vehicle | `Tools/data/vehicles.csv`, then re-run the scaffolder. No code. |
| A district | `Tools/data/districts.csv`. No code. |
| A mission | `Tools/data/missions.csv`, or a `UBCUMissionDefinition` asset for bespoke objectives |
| A voxel material | `EBCUVoxelMaterial` + the trait table in `BCUVoxelTypes.cpp` + `DT_VoxelMaterialTraits.csv` |
| A building style | `EBCUBlockStyle` + the switch in `UBCUCityGenerator::GenerateBuildings` + a `Carve*` recipe |
| A crime type | `EBCUCrimeType` + the heat table in `BCUPoliceSubsystem.cpp` |
| A graphics preset | `EBCUQualityPreset` + `UBCUGraphicsSubsystem::ApplyPreset` + `DefaultScalability.ini` |
| An interactable | Tag the actor `BCU.Interact.*` — `UBCUInteractionComponent` already classifies it |
| A UI panel | A UMG Blueprint + `ABCUPlayerHUD::RegisterWidget` |
