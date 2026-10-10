# Performance and Scalability

## 1. The budget model

The player only ever pays for ~1 km² of real geometry. Everything else is a
merged proxy, a cheaper simulation tier, or nothing at all.

| System | Full detail | Reduced | Off |
|---|---|---|---|
| City cells | 5-cell radius, voxel meshes | HLOD proxy beyond 2.3 km | unloaded past 7 cells |
| Interiors | streamed when the player is inside | generated only for enterable buildings | never generated (Performance) |
| Traffic | tier 0 < 450 m: full Chaos physics + AI | tier 1 < 900 m: kinematic, 3 Hz | tier 2: despawned |
| Pedestrians | near: real pawn, animation, perception | far: instanced, kinematic, 1 Hz | beyond despawn radius |
| Police units | < 1.5 km: full tick + raycast LOS | beyond: 0.15× tick, no raycast | despawned past 3.75 km when not wanted |
| Vehicle detail | level 2 trim (player car) | level 1 (traffic) | level 0 (far) |
| Street props | HISM instances, 200 m–1.8 km cull | density-scaled | Performance preset |
| Shadows | VSM + far shadows | VSM only | static only |
| Ray tracing | full (GI + reflections + shadows) | reflections | off |

## 2. The four presets

`Config/DefaultScalability.ini` groups 0–3, applied by
`UBCUGraphicsSubsystem::ApplyPreset`.

| | Performance | Balanced | Quality | Ultra |
|---|---|---|---|---|
| Screen percentage | 72 | 85 | 100 | 100 |
| Upscaler | TSR/DLSS q0.42 | q0.58 | q0.75 | q1.0 |
| Frame generation | off | off | off | on if available |
| Ray tracing | off | off | reflections | full |
| Dynamic resolution floor | 55% | 66% | 78% | off |
| Resolution target | 1080p | 1080p | 1440p | 4K |
| Motion blur | off | on | on | on |
| City load radius | 2 cells | 3 | 4 | 5 |
| Max traffic | 40 | 70 | 100 | 120 |
| Max pedestrians | 60 | 120 | 180 | 220 |
| Interiors | off | sparse | on | on |
| Volumetric fog | off | on | on | on |

Frame rate targets: Unlocked, 30, 60, 90, 120, 144 via `t.MaxFPS` + `r.VSync`.

## 3. Separate scalability groups

The brief requires independent control, so BCU adds its own groups on top of the
stock `sg.*` set:

| Group | Cvar | Range |
|---|---|---|
| `BCUCityQuality` | `bcu.city.Quality` | 0–3 |
| `BCUVoxelQuality` | `bcu.voxel.Quality` | 0–3 |
| `BCUTrafficQuality` | `bcu.traffic.Quality` | 0–3 |
| `BCUWeatherQuality` | `bcu.weather.Quality` | 0–3 |
| `BCURayTracing` | `bcu.raytracing.Mode` | 0–3 |
| `BCUUpscaler` | `bcu.upscaler.Mode` | 0–3 |

`FBCUScalabilityOverrides` has 13 categories (view distance, shadows,
reflections, GI, post-process, textures, effects, vegetation, anti-aliasing, city
detail, voxel detail, traffic density, weather detail), each `-1` = follow the
preset. A player who wants Ultra lighting with Performance traffic sets exactly
that, and the result is saved as the `Custom` preset.

## 4. GPU instancing

Repeated voxels are never individual actors or components:

- **City geometry** — one merged static mesh per section per cell (4 components,
  not 40 000 cubes).
- **Street props** — `UHierarchicalInstancedStaticMeshComponent` per cell, with
  auto-clustering and density scaling.
- **Characters** — `UBCUVoxelBodyComponent` is one ISM component of 13 instances.
- **Far pedestrians** — one HISM per outfit, so 240 pedestrians cost as many draw
  calls as there are distinct outfits.
- **Vehicle bodies** — generated as merged meshes, cached per
  (definition, wheel style) in `UBCUVehicleSubsystem::MeshCache`. Paint is a
  material parameter, not a mesh difference, so the cache stays small.

## 5. Async city generation

`Build.cs` defines `BCU_ASYNC_CITY_GEN` and `BCU_MAX_ASYNC_BUILD_THREADS=6`.

```
worker:  GenerateCell → CarveCellIntoGrid → BuildGridMesh     (pure, no UObject render state)
game:    CreateStaticMesh → SetSectionMesh → PopulateInstancedProps → register with AI
```

The rule: anything that creates or mutates a `UObject`'s render state is on the
game thread; everything else is a pure function on a worker. `MaxCellsLoadedPerFrame`
caps the hitch budget at 2 cells, and the async pool is bounded so a fast drive
cannot queue 40 cells at once.

## 6. Profiling

| Command | Output |
|---|---|
| `bcu.dump.perf` | `stat unit`, `stat scenerendering`, `stat streaming`, `stat memory`, `stat gpu`, `stat rhi` + city/traffic/police one-liners |
| `bcu.benchmark` | 6-second capture via `OnFrameReadyDelegate`, average FPS |
| `stat group BCU` | per-cycle counters for cell generation, meshing, streamer tick |
| `bcu.city.stat` | resident cells, pending, in flight, triangles, average gen/mesh ms |
| `bcu.traffic.stat` | agents, pool size, lane-graph cells, spawned/despawned totals |
| `bcu.police.stat` | wanted, heat, phase, units, orders, crimes, spotted, hidden |
| `stat streaming` | texture and World Partition streaming |
| `stat scenerendering` | draw calls, primitives, Nanite clusters |

`UBCUGraphicsSubsystem::GetRecommendedPreset()` picks the starting preset from
hardware: VRAM ≥ 12 GB and RAM ≥ 30 GB and HWRT → Ultra; VRAM ≥ 8 GB and RAM ≥
16 GB → Quality; VRAM ≥ 6 GB → Balanced; otherwise Performance. `GetDetectedVRAM_MB()`
and `GetDetectedAdapterName()` are exposed to the UI so the options screen can say
why it chose what it chose.

## 7. Memory

| Item | Budget |
|---|---|
| Resident voxel data (5-cell radius, sparse) | ~180 MB |
| Mesh vertex data (20 resident cells × 4 sections) | ~420 MB |
| Texture pool | VRAM/3, clamped 1024–8192 MB |
| HLOD proxies | ~60 MB |
| Traffic pool (120 vehicles) | ~90 MB |
| Pedestrian instances | ~15 MB |

Voxel data is 4 bytes per voxel (`material`, `paletteIndex`, `flags`, `shade`),
and only non-empty chunks are allocated. A suburban cell that is mostly air costs
almost nothing; that is the whole reason for sparse storage.

## 8. What to do when the frame rate drops

In order, because this is the order it actually pays off:

1. `stat unit` — is it Game, Draw or GPU? Everything after this depends on the answer.
2. **Game thread high** → drop `bcu.traffic.MaxActiveVehicles` and
   `bcu.traffic.MaxActivePedestrians` first. AI is the largest CPU consumer by far.
3. **Draw thread high** → check `stat scenerendering` draw calls. If the count is
   high, props are not instanced; verify the cell's HISM was populated.
4. **GPU high at Ultra** → drop `bcu.raytracing.Mode` to 1, then to 0. HWRT
   reflections are the single most expensive toggle in the project.
5. **GPU high with RT off** → lower `r.ScreenPercentage` before lowering
   `sg.ShadowQuality`. Upscaling is nearly free; shadow pages are not.
6. **Hitches on fast driving** → lower `bcu.city.MaxCellsLoadedPerFrame` to 1. The
   hitch is mesh upload, and the cap is what bounds it.
7. **Streaming stalls** → `stat streaming`, then raise the load radius so cells
   arrive earlier, or lower it so fewer compete.

## 9. The browser slice as a profiling reference

`BrowserSlice/Tools/smoke-test.mjs` runs generation and meshing headlessly and
prints the numbers, which makes it a fast way to test a generation change without
booting an engine:

```
buildings 378 · boxes 44,767 → faces emitted 73,758 (culled 194,844)
          · 147,516 triangles · 24 draw calls
generation 47 ms · mesh build ~1.0 s · tallest tower 175 m
```

The cull ratio (72%) and the merge ratio are the two numbers to watch: if either
drops, a generation change has started producing geometry that cannot be merged.
