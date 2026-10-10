# BLOCK CITY ULTRA

An original open-world action/driving game for Unreal Engine 5.5, built around a
**voxel-inspired visual identity where the voxels are real 3D geometry** — cubic
meshes generated procedurally, lit by Lumen, shadowed by virtual shadow maps and
reflected by hardware ray tracing. No pixelation filter is used anywhere.

The city, its ten districts, every vehicle, manufacturer, character, faction,
mission and line of dialogue are original creations. See
[Docs/08_LEGAL_AND_ORIGINALITY.md](Docs/08_LEGAL_AND_ORIGINALITY.md).

---

## Play it right now

The Phase 1 vertical slice ships as a **playable browser build** so the design can
be tried without installing an engine:

```bash
cd BrowserSlice
python3 -m http.server 8765 --bind 0.0.0.0
# → http://localhost:8765
```

No dependencies — Three.js is vendored. Walk around a procedurally generated
1.4 km city, steal a car, run a delivery, get chased by police through a
thunderstorm, and finish three original missions. Details in
[BrowserSlice/README.md](BrowserSlice/README.md).

---

## What is here

| Path | Contents |
|---|---|
| `BlockCityUltra.uproject` | UE 5.5 project. Two modules, DLSS optional and disabled by default |
| `Config/` | `DefaultEngine.ini`, `DefaultGame.ini`, `DefaultInput.ini`, `DefaultScalability.ini` |
| `Source/BlockCityUltra/` | Runtime C++ — 48 headers, 48 implementations |
| `Source/BlockCityUltraEditor/` | Editor tools: city menu, cell rebuild, HLOD bake, performance report |
| `Content/` | Generated scaffold: data-table CSVs + import sidecars + Blueprint recipes |
| `Docs/` | Nine documents covering build, architecture, generation, art, rendering, performance, gameplay and legal |
| `Tools/` | `scaffold_content.py` (content generator), `data/*.csv` (the source of truth), `setup_input_assets.py` |
| `BrowserSlice/` | The playable Three.js vertical slice |

## Start here

1. [Docs/00_START_HERE.md](Docs/00_START_HERE.md) — the map to everything else
2. [Docs/01_BUILD_AND_RUN.md](Docs/01_BUILD_AND_RUN.md) — build, package, run, first-build checklist
3. [Docs/02_ARCHITECTURE.md](Docs/02_ARCHITECTURE.md) — every class, and why it exists
4. [BrowserSlice/README.md](BrowserSlice/README.md) — play the slice

## The ten-minute path

```bash
python3 Tools/scaffold_content.py         # generates Content/ (idempotent)
# open BlockCityUltra.uproject in UE 5.5, accept the rebuild prompt
# open Content/Maps/L_VaultCity_Slice.umap, press Play
```

## Design contract

- **Voxels are geometry.** `FBCUVoxelMesher` emits one quad per visible voxel
  face, greedy-merged only when material, palette *and* shade all match. The
  blocky silhouette survives Lumen, virtual shadow maps and hardware ray tracing
  because it is honest cubic geometry.
- **Nanite where it works, and a real path where it doesn't.** Each city cell is
  four mesh sections: opaque goes to Nanite; masked (foliage), translucent
  (glass, water) and emissive (windows, neon) do not, because those material
  modes are not Nanite-compatible.
- **Everything is distance-LOD'd.** Traffic has three simulation tiers,
  pedestrians have two, police units drop to 0.15× tick rate, cells swap to
  merged HLOD proxies, and interiors are only generated for buildings the player
  can actually enter.
- **Generation is deterministic.** Every `UBCUCityGenerator` function takes its
  seed as an argument and touches no global state, so the same seed produces a
  byte-identical city on every machine — which is what makes a save file
  reproducible and a bug report actionable.
- **DLSS is optional and never hard-linked.** The plugin is `Enabled: false,
  Optional: true`; `Build.cs` never lists it; the runtime probes for it through
  `IPluginManager` and falls back to TSR plus dynamic resolution. A build made
  from this repository without a DLSS licence compiles, runs and ships legally.

## Target hardware

RTX 5060-class GPU, modern multicore CPU, 16–32 GB RAM. Four presets —
Performance, Balanced, Quality, Ultra — with unlocked frame rate and 30/60/90/
120/144 targets.

## Status

The C++ runtime, configuration, data tables and tooling are complete. Unreal
Engine is **not installed in the environment where this was written**, so the
code has not been through a real Unreal Build Tool run: it was written against
UE 5.5 APIs and audited by script for header/implementation parity and
undeclared symbols. Expect a small number of signature fixes on first build —
[Docs/01_BUILD_AND_RUN.md §6](Docs/01_BUILD_AND_RUN.md) lists exactly where they
will be.

The browser slice, by contrast, **runs today**: generation, meshing, collision
and line-of-sight are verified headlessly by `BrowserSlice/Tools/smoke-test.mjs`.

## Licence

Original work by Neurio Interactive. Third-party components and their licences
are listed in [Docs/08_LEGAL_AND_ORIGINALITY.md §6](Docs/08_LEGAL_AND_ORIGINALITY.md).
Three.js (browser slice only) is MIT.
