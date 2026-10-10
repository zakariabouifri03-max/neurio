# Legal and Originality

This document is the authority on what may and may not ship. Read it before
adding any asset, name, texture, sound or line of dialogue.

## 1. The rule

Everything in BLOCK CITY ULTRA is either **(a) created for this project** or
**(b) used under a licence whose terms are recorded in §6**. There is no third
category. If you cannot say which of (a) or (b) an asset belongs to, it does not
go in the build.

## 2. Explicit prohibitions

| Prohibited | Why | What we do instead |
|---|---|---|
| Any GTA / Grand Theft Auto asset, name, map, character, vehicle, radio station, dialogue or logo | Copyrighted by Rockstar Games / Take-Two. Genre similarity is fine; asset, name or layout reuse is not. | An original city (Vault City) with original districts, original factions, original vehicles |
| Any Minecraft asset, texture, block model, skin, sound or the name "Minecraft" | Copyrighted by Mojang / Microsoft. The *voxel aesthetic* is not ownable; their assets and name are. | Original voxel geometry generated procedurally, with original PBR materials |
| Real city names as district names, real street names, real building models | Not a copyright issue for names, but real-building models and photographs usually are, and it breaks the fiction | Original districts: Foundry Heights, Rowan Park, Marbella Row, Ironside Docks, Calder International, Neon Mile, Ashfall Basin, Granite Ridge |
| Real car marques, model names or body scans | Trade marks + design rights | Original manufacturers: Kestrel Motors, Bramford, Ironside Works, Calder Transit, Vellum, Marbella Auto, Ashfall, Rowan, Granite, Neon Works, Vault Fleet |
| Licensed commercial music, real radio stations, real artists | Sync and master licences we do not hold | Original score and original radio, or nothing |
| Stock assets from a marketplace whose licence excludes games, or whose licence is unclear | Re-sublicence risk | Only assets with an explicit, recorded game licence (§6) |
| Photogrammetry of real buildings, cars or interiors | Derivative of a copyrighted structure/design | Original parametric generation |
| Real police force badges, liveries, call signs or radio procedure recordings | Trade mark + public-impersonation law in several jurisdictions | Original "Vault City Police Department" with original livery and original radio chatter |

## 3. What *is* fine

Genre conventions are not protected. The following are all safe because they are
ideas and mechanics, not expression:

- An open-world city the player drives and walks around in
- A progressive wanted level with police pursuit
- Enterable vehicles, vehicle theft, garages, vehicle customisation
- Third-person character control with a camera-relative move scheme
- Mission givers, delivery jobs, races, heists, random events
- Day/night cycle, rain, wet roads, neon signage
- A **voxel-inspired** visual style — the cube is not owned by anyone

What is *not* safe is copying a specific implementation: a specific skyline, a
specific car silhouette, a specific HUD layout, a specific character, a specific
line of dialogue, a specific texture.

## 4. Originality of this project's content

| Element | Origin |
|---|---|
| City name "Vault City", its 10 districts, the Ashfall River, Granite Ridge | Original, invented for this project |
| Street layouts, block sizes, building massing | Procedurally generated from original parametric recipes in `BCUCityGenerator.cpp` |
| Building silhouettes (setback tiers, window grids, roof detail) | Original parameter sets; no real building is modelled |
| Vehicle names, manufacturers, silhouettes | Original; `BCUVehicleVoxelBuilder.cpp` generates every body from a parametric profile |
| Characters (Mara Kessel, Dex Oyelaran, Silas Vane), factions, dialogue | Original writing, in `Tools/data/missions.csv` and `DT_Dialogue.csv` |
| Police unit behaviour, dispatch profiles, pursuit tactics | Original design; `BCUPoliceSubsystem.cpp` |
| Voxel material trait table (63 materials) | Original values in `BCUVoxelTypes.cpp` |
| UI layout, HUD readouts, minimap | Original; no reference to any existing game's HUD |
| Music, SFX, radio | **Must be commissioned or licensed** — none ships unlicensed |
| Fonts | Must be OFL/Apache/proprietary-licensed; check before shipping |

## 5. Naming conventions

Follow these and a name will not collide with anything real:

- **Manufacturers:** an English place-name or trade word + a generic suffix
  (Motors, Works, Transit, Auto, Fleet). Never a real marque.
- **Districts:** a natural or industrial feature + a topographic word (Heights,
  Park, Row, Docks, Basin, Ridge, Mile). Never a real borough.
- **Characters:** a common given name + an uncommon surname. Never a real
  person, never a name from another game.
- **Missions:** an ordinary noun phrase describing the job (Cold Chain Run,
  Night Shift, Ironside Cleanup). Never a title from another game.

## 6. Third-party components and their licences

| Component | Licence | Obligation |
|---|---|---|
| Unreal Engine 5.5 | Epic Games EULA / Unreal EULA | Royalty terms per the Epic agreement; engine credit in the splash |
| ChaosVehiclesPlugin, Niagara, EnhancedInput, Water, GeometryProcessing | Unreal Engine licence (ships with the engine) | None beyond the engine EULA |
| **NVIDIA DLSS** | **Separate NVIDIA licence required.** The plugin is **optional and disabled by default** in `BlockCityUltra.uproject` (`"Enabled": false, "Optional": true`), and `BlockCityUltra.Build.cs` **never hard-links it**. | Before shipping with DLSS you must (1) obtain the plugin through NVIDIA's official channel, (2) accept NVIDIA's licence, (3) enable it in the `.uproject`, (4) add `"DLSS"` to `PublicDependencyModuleNames` in `Build.cs`. Until then the runtime probe in `BCUGraphicsSubsystem` reports DLSS unavailable and the game uses TSR. |
| Any Marketplace/Bridge asset | Per-asset Epic licence | Record the asset id, the licence date and the permitted use in `Content/_LICENSES.md` before shipping |
| Any font | Per-font licence | OFL and Apache-2.0 fonts require the licence text to ship in `Content/ThirdPartyLicenses/` |
| Three.js (browser slice only) | MIT | Ship the MIT notice with the browser build |

### DLSS, specifically

DLSS is the one place this project can accidentally become non-compliant, so the
rule is written into the code, not just this document:

1. `BlockCityUltra.uproject` lists DLSS as `Enabled: false, Optional: true`.
2. `BlockCityUltra.Build.cs` defines `BCU_WITH_OPTIONAL_DLSS` on Win64 but never
   adds `DLSS` to any dependency list.
3. `BCUGraphicsSubsystem.cpp` probes for the plugin at runtime through
   `IPluginManager` and only issues `r.NGX.*` console commands when the plugin is
   loaded **and** the GPU supports it.
4. When the probe fails, the upscaler falls back to TSR, and dynamic resolution
   takes over the frame-time budget.

The result: a build made from this repository without a DLSS licence compiles,
runs and ships legally. Adding DLSS is a deliberate, licensed act.

## 7. Pre-ship checklist

Before any public build:

- [ ] `Content/_LICENSES.md` lists every third-party asset with its licence and date.
- [ ] No asset filename, folder name or asset name references another game, marque or real city.
- [ ] Every music and radio track is original or licensed, and the licence covers games.
- [ ] Every font ships with its licence text.
- [ ] DLSS is either absent, or present with a recorded NVIDIA licence and enabled deliberately.
- [ ] `git log --stat` reviewed for accidentally committed binary assets of unknown origin.
- [ ] Splash screen carries the Unreal Engine credit required by the EULA.
- [ ] A grep of all `Tools/data/*.csv` and dialogue returns no real-world names.

## 8. If you find something that violates this

Remove it in the same commit, and say so in the commit message. An unlicensed
asset discovered after ship is a takedown and possibly a claim; one removed
before ship is a Tuesday.
