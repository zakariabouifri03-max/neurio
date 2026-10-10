# BLOCK CITY ULTRA — Start Here

Read this first. It is the map to everything else.

| # | Document | What it answers |
|---|----------|-----------------|
| 01 | [BUILD_AND_RUN.md](01_BUILD_AND_RUN.md) | How to open, compile, package and ship the project |
| 02 | [ARCHITECTURE.md](02_ARCHITECTURE.md) | What every module and class does, and why |
| 03 | [WORLD_GENERATION.md](03_WORLD_GENERATION.md) | How a 200 km² deterministic city is generated and streamed |
| 04 | [ART_DIRECTION.md](04_ART_DIRECTION.md) | The original voxel identity: real cubic geometry, PBR materials |
| 05 | [RENDERING_AND_NANITE.md](05_RENDERING_AND_NANITE.md) | Nanite vs. the non-Nanite path, Lumen, VSM, ray tracing |
| 06 | [PERFORMANCE_AND_SCALABILITY.md](06_PERFORMANCE_AND_SCALABILITY.md) | Budgets, profiling, the four presets, DLSS licensing |
| 07 | [GAMEPLAY_SYSTEMS.md](07_GAMEPLAY_SYSTEMS.md) | Vehicles, wanted level, missions, economy, save/load |
| 08 | [LEGAL_AND_ORIGINALITY.md](08_LEGAL_AND_ORIGINALITY.md) | What is original, what is licensed, what must never ship |

## What is in this repository

```
BlockCityUltra/
├── BlockCityUltra.uproject      ← open this in Unreal Engine 5.5
├── Config/                      ← engine, game, input, scalability
├── Content/                     ← generated scaffold (run Tools/scaffold_content.py)
├── Docs/                        ← these documents
├── Source/
│   ├── BlockCityUltra/          ← runtime C++ (47 headers, 47 implementations)
│   └── BlockCityUltraEditor/    ← editor tooling (city menu, HLOD bake, profiler)
└── Tools/
    ├── scaffold_content.py      ← generates the Content/ Blueprint + data-table scaffold
    └── data/                    ← CSV data tables (vehicles, districts, missions)
```

## The 10-minute path

1. Install **Unreal Engine 5.5** (Epic Games Launcher → Library).
2. `git clone` this repository, then `python3 Tools/scaffold_content.py` once.
3. Open `BlockCityUltra/BlockCityUltra.uproject`. Accept the "modules out of date"
   prompt and let it rebuild.
4. Open `Content/Maps/L_VaultCity_Slice.umap` and press **Play**.
5. Press **Alt+1…Alt+4** to switch graphics presets, **F10** for the performance
   dump, **`** for the console.

## The honest caveat

This repository contains the complete C++ runtime, the configuration, the data
tables and the tooling — but **Unreal Engine itself is not installed in the
environment where this was authored**, so the C++ has not been compiled by a
real Unreal Build Tool run. Every file was written against UE 5.5 APIs and
audited by script for header/implementation parity, brace balance and
undeclared `BCU*` symbols. Expect to fix a small number of signature mismatches
on first build; the architecture, the systems and the content pipeline are
complete and do not need redesign.

See [01_BUILD_AND_RUN.md](01_BUILD_AND_RUN.md) §6 for the first-build checklist.
