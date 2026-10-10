# Rendering and Nanite

## 1. Renderer configuration

Set in `Config/DefaultEngine.ini`, DX12 + SM6 on Win64:

| Feature | Setting | Why |
|---|---|---|
| Nanite | Enabled | Cubic architecture is exactly what Nanite's cluster LOD is good at |
| Lumen GI | Enabled, screen + mesh SDF probes | Dynamic day/night with no baked lightmaps |
| Lumen reflections | Enabled, HWRT when supported | Glass curtain walls and wet asphalt |
| Virtual shadow maps | Enabled | One physical light source (the sun) over a 24 km region |
| Hardware ray tracing | Optional, probed at runtime | Never required; see §4 |
| `r.GenerateMeshDistanceFields` | 1 | Lumen mesh SDFs + distance-field AO |
| Virtual textures | Runtime + streaming | 605 km² of surface detail |
| Texture pool | 4096 MB | Raised at runtime to VRAM/3, clamped 1024–8192 |
| `r.AntiAliasingMethod` | 4 (TSR/DLSS) | 2 = off only in the Performance preset |

`WorldSettingsClassName` is `BCUWorldSettings`, so every map carries its own city
seed, material set and district table with no extra actor to place.

## 2. Nanite, and the path for what Nanite cannot do

Nanite does not support masked or translucent materials. A voxel city is full of
both: leaves, glass, water, ice, and every lit window. So each city cell is
**four mesh sections**, and the Nanite decision is per section, not global:

| Section | Materials | Nanite | Shadows | Affects DF GI |
|---|---|---|---|---|
| Opaque | concrete, brick, steel, asphalt, stone, plaster | **enabled** | cast + receive | yes |
| Masked | leaves, flowers, grating | disabled | cast | no |
| Translucent | glass, water, ice | disabled | no | no |
| Emissive | lit windows, neon, fixtures | disabled | no | yes |

`FBCUVoxelMesher::ClassifyVoxel` routes each voxel by its flags. The classification
comes from the material traits, so adding a material automatically puts it in the
right section: `bNaniteCompatible = false` plus `FLAG_Masked` for foliage,
`FLAG_Translucent` for glass and water, `FLAG_Emissive` for anything that glows.

Why emissive is not Nanite either: it is the section most likely to be swapped at
runtime (day → night) and it must never cast a shadow, so keeping it on the
classic path is cheaper than teaching Nanite about it.

## 3. Lumen

Lumen is what makes the voxel identity work at night. A cubic city has enormous
contact-shadow and bounce-light opportunities — every window recess, every
arcade, every setback tier — and none of it can be baked, because the city is
generated at runtime and the sun moves.

- **Final gather**: screen probes + mesh SDF probes. Generated meshes get
  `bAffectDynamicIndirectLighting = true` on opaque and emissive sections, false
  on masked and translucent.
- **Hardware ray tracing** for the final gather when available:
  `r.Lumen.HardwareRayTracing 1`, gated on `GSupportsRayTracing && SM6`.
- **Reflections**: Lumen reflections for glass; HWRT reflections in the Quality
  and Ultra presets when the probe says the GPU supports it.
- **No baked lightmaps.** `bGenerateLightmapUVs = false` on every generated mesh.

## 4. Hardware ray tracing — probed, never assumed

`UBCUGraphicsSubsystem::IsHardwareRayTracingAvailable()` probes
`RHIGetDevice()->GetDeviceInfo()` for `GSupportsRayTracing` **and** SM6, then
reports through `EBCURayTracingMode`:

| Mode | Cvars |
|---|---|
| Off | all `r.RayTracing* 0` |
| Reflections | `r.RayTracing.Reflections 1` |
| Reflections + Shadows | plus `r.RayTracing.Shadows 1` |
| Full | plus `r.RayTracing.Geometry.*`, translucency, `r.Lumen.HardwareRayTracing 1` |

If the probe fails the mode is forced to Off and the preset falls back to Lumen
software tracing plus screen-space reflections. A machine without RT support gets
the same game, not a broken one.

## 5. Upscaling — TSR always, DLSS only when licensed

`EBCUUpscalerMode`: TSR (0), DLSS SR (1), DLSS SR + Frame Generation (2), Off (3).

**DLSS is never hard-linked.** See `Docs/08` §6 for the licensing rule. In code:

1. `.uproject` lists DLSS as `Enabled: false, Optional: true`.
2. `Build.cs` defines `BCU_WITH_OPTIONAL_DLSS` on Win64 but never adds `DLSS` to
   a dependency list.
3. `IsDLSSAvailable()` probes `IPluginManager::Get().IsPluginLoaded("DLSS")` at
   runtime, inside `#if BCU_WITH_OPTIONAL_DLSS`.
4. Only when the probe succeeds are `r.NGX.DLSS.Enable`, `r.NGX.DLSS.Quality` and
   `r.NGX.DLSS.FrameGeneration.Enable` issued.
5. On failure the mode falls back to TSR and dynamic resolution takes over the
   frame-time budget.

`r.ScreenPercentage` is lerped 58 → 100 by `UpscalerQuality`, so a preset controls
internal resolution and upscaler quality together rather than fighting each other.

## 6. Virtual shadow maps

One directional light over a 24 km region is the case VSM was built for.
Generated meshes set `bCastFarShadow = true` so a distant tower still contributes
to the shadow map without a full-resolution page.

Streetlight and vehicle lights do **not** cast shadows by default — they are
pooled, numerous, and a shadow-casting point light is the most expensive thing in
the frame. Headlight spot lights cast only in the Ultra preset.

## 7. Volumetric fog

`UBCUTimeOfDaySystem::ApplyFog` owns density and inscattering; `UBCUWeatherSystem`
multiplies it. They are deliberately separated so the two systems never fight:
time of day sets the base curve (thicker at night and dawn), weather adds its own
type contribution (dense fog 0.085, thunderstorm 0.055, heatwave 0.010).

`VolumetricFogScatteringDistribution` rises towards the horizon so dusk sun shafts
are visible between towers — one of the cheapest high-impact looks in the project.

## 8. Distance culling and occlusion

| Mechanism | Where |
|---|---|
| World Partition streaming | cell source loading |
| `ABCUCityStreamer` load/unload radius | circular, 5/7 cells at Ultra |
| HLOD merged proxies | 4×4-cell blocks beyond `HLODMergeDistanceCm` |
| `FBCUVoxelMesher::BuildHLODMesh` | conservative N³ downsample; lit windows are preserved so a night HLOD city does not look dead |
| Distance-field occlusion | `bAffectDistanceFieldLighting` on opaque + HLOD sections |
| Interior exclusion | `bExcludeInteriors` on the exterior HLOD pass |
| Prop HISM cull distances | 200 m – 1.8 km |

## 9. Frame budget (Ultra, RTX 5060-class, 1440p)

| Item | Budget |
|---|---|
| City generation | 0 ms on the game thread (4 worker threads) |
| Mesh upload | ≤ 2 ms per frame, max 2 cells |
| Opaque Nanite pass | 4.5 ms |
| Lumen final gather | 3.0 ms |
| VSM | 1.8 ms |
| Translucent + emissive | 1.2 ms |
| Traffic (34 cars, tier 0) | 1.4 ms CPU |
| Pedestrians (140, two tiers) | 0.9 ms CPU |
| Police (≤ 8 units) | 0.4 ms CPU |
| **Total** | **~16 ms GPU / ~11 ms CPU → 60 fps with headroom** |

`bcu.dump.perf` prints the real numbers: `stat unit`, `stat scenerendering`,
`stat streaming`, `stat memory`, `stat gpu`, `stat rhi`, plus the city, traffic
and police one-liners.
