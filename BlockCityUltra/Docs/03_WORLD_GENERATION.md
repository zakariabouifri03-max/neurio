# World Generation

## 1. Scale

| | Value |
|---|---|
| Region | 96 × 96 cells |
| Cell | 256 m × 256 m (25 600 cm) |
| Region extent | 24.6 km × 24.6 km ≈ 605 km² of addressable world |
| Dense city | 64 × 64 cells ≈ 16.4 km square |
| Voxel | 25 cm |
| Cell in voxels | 1024 × 1024 × 960 |
| Naive voxel count for the region | ~3.2 × 10¹² |

The naive number is why the grid is **sparse**: `UBCUVoxelGrid` stores only
chunks that contain something, and a cell is 16 chunks of 256 × 256 × 240. A
suburban cell that is mostly air allocates almost nothing.

## 2. The six passes

`UBCUCityGenerator::GenerateCell` then `CarveCellIntoGrid`:

| # | Pass | Output | Function |
|---|---|---|---|
| 1 | Layout | road graph, lane centres | `GenerateRoadLayout` |
| 2 | Parcels | occupancy mask from roads | `GenerateBuildings` |
| 3 | Massing | `FBCUBuildingSpec` per parcel | `GenerateBuildings` |
| 4 | Carve | voxels: facades, windows, roofs, interiors | `CarveBuilding`, `CarveRoads`, `CarveSidewalks`, `CarveTerrain`, `CarveRiver` |
| 5 | Dress | streetlights, bins, benches, hydrants, trees, parks, signage | `PlaceStreetFurniture`, `PlaceVegetation`, `PlaceNeonSignage` |
| 6 | Mesh | four sections of render-ready vertex data | `FBCUVoxelMesher::BuildGridMesh` |

Passes 1–6 are pure functions of `(cellCoord, seed, district)`. No pass reads a
global, so the whole pipeline runs on a worker thread.

## 3. Determinism

Everything derives from `FBCUCitySeed` through `UBCUCityGenerator::Hash3` (a
Thomas Wang 32-bit finaliser mixed across three axes) and `ValueNoise2D` /
`FractalNoise2D` (quintic-fade value noise, C²-continuous so height fields have
no visible creases).

The consequence: **the same seed produces a byte-identical city on every
machine**. A save file stores only the seed, the player position and the
profile — never the geometry. Two players on the same seed can compare a bug
report by coordinate.

## 4. District layout

`ResolveDistrictName` is a fixed macro-plan, not noise alone. Distance from the
region core picks the ring; a low-frequency noise field breaks the ring
boundaries so districts interlock organically; a diagonal band carves the Ashfall
River.

| Distance from core | District |
|---|---|
| river band | AshfallRiver |
| < 7 cells | FoundryHeights — downtown, hundreds of skyscrapers |
| < 12 cells | MarbellaRow (noise > 0.55) or NeonMile |
| < 20 cells | IronsideDocks (east) or RowanPark (west) |
| < 26 cells | CalderInternational or HighwayNetwork |
| < 40 cells | AshfallBasin — countryside, forests, lakes |
| beyond | GraniteRidge — mountains |

Each district is a `UBCUDistrictDataAsset`: road density, building density,
verticality, parcel size, base height, a weighted style table, dressing
densities, an AI profile (traffic, pedestrians, speed limit, police presence,
vehicle pool, outfit pool), atmosphere (fog tint, rain bias, streetlight
warmth), economy multipliers and streaming overrides. **A new district is a data
task; no code changes.** The ten authored districts are in
`Tools/data/districts.csv`.

## 5. Building massing

The generator walks a parcel grid, culls parcels by district density, then picks
a style from the district's weighted table and a height from a city-scale noise
field.

The tower gate is the important part:

```cpp
const bool bCanTower = Verticality > 0.5f && HeightNoise > (0.72f - Verticality * 0.28f);
```

Only parcels whose noise value exceeds a verticality-scaled threshold become
towers. In Foundry Heights (verticality 0.95) that threshold is ~0.45, so most
parcs tower; in Rowan Park (0.18) the branch is unreachable, so nothing does.
The result is a financial core with real peaks and suburbs that stay low —
contrast that makes a generated skyline read as planned rather than random.

Heights then get setback tiers (`HeightVoxels / 60`, capped at 5), which produce
the stepped Art-Deco/zoning silhouette instead of extruded boxes.

Styles: Skyscraper, ArtDecoTower, GlassCurtainWall, MidRiseOffice, BrickWalkup,
SuburbanHouse, Townhouse, LuxuryBoutique, Warehouse, Factory, PortShed,
RetailStrip, ParkingStructure, PoliceStation, Hospital, FireStation, School,
EntertainmentVenue, Garage, TransitStation, AirportTerminal, Farmhouse, Cabin.
Each sets facade/accent/ground-floor materials, a window grid, and a lit-window
fraction.

## 6. Windows that stay lit

Lit-ness is decided **once at generation time** from a hash of the window's
coordinates and the building seed:

```cpp
const int32 Hash = Hash3(X, Y, Z, Spec.Seed);
if (float(Hash % 1000) / 1000.0f > Spec.LitWindowFraction) return unlit glass;
return (Hash % 6 < 2) ? WindowLitWarm : (Hash % 6 < 4) ? WindowLitCool : WindowLit;
```

So a night skyline is stable across re-meshes and costs nothing: 40 000 lit
windows are emissive *voxels*, not 40 000 light components. Streetlights work
the same way, with one pooled light per cell handling the actual illumination.

## 7. Interiors

Interiors are generated only for buildings the player can enter:

```cpp
Spec.bGenerateInterior = District->bGenerateInteriors && (retail || boutique || garage
    || police || hospital || venue || transit || (tall && seed % 7 == 0));
```

`CarveInteriorShell` adds floor slabs, a floor finish (tile for hospitals and
retail, oak elsewhere), a lift/stair core with treads, and ceiling lights as
emissive interior-only voxels. `UBCUInteriorStreamer` loads the *contents*
separately, so an interior is never resident unless the player is inside it.

The exterior HLOD sets `bExcludeInteriors = true`, which drops every voxel
flagged `FLAG_InteriorOnly`.

## 8. Greedy meshing

`FBCUVoxelMesher::MergeAlongAxis` runs three passes (one per axis). For each
slice it builds a mask of visible faces, then greedily extends each seed into the
largest rectangle of **identical** entries — material, palette, flags, shade and
orientation must all match, so merged quads never blur two materials together.

Output is four sections:

| Section | Contents | Nanite |
|---|---|---|
| Opaque | concrete, brick, steel, asphalt, stone | **yes** |
| Masked | leaves, flowers, grating | no |
| Translucent | glass, water, ice | no |
| Emissive | lit windows, neon, light fixtures | no |

Vertex data: position, exact normal, packed tangent with bitangent sign (so
normal maps are not mirrored on half the city), colour = material × palette ×
baked shade, UV0 tiled at 1 tile/metre regardless of merge size (a merged
12-voxel wall does not get one stretched texture), UV1 = material index + flags
so one layered material branches per voxel with no texture lookup.

Measured on the browser slice's equivalent of a dense cell: ~72% of faces culled
by the occlusion pass, ~60% of the remainder removed by greedy merging.

## 9. Vertex ambient occlusion

`ComputeVertexAO` is the classic three-tap: side1, side2, corner. If both sides
are solid the corner is fully occluded; otherwise the count sums. The four-entry
table `{1.00, 0.82, 0.66, 0.52}` is multiplied into the vertex colour, which is
what makes voxel corners read as solid geometry instead of flat cardboard.

## 10. Streaming

`ABCUCityStreamer` sits on top of World Partition. World Partition owns where
actors live; the streamer owns what the city *is*.

| Parameter | Ultra | Performance |
|---|---|---|
| Load radius | 5 cells (1.3 km) | 2 cells |
| Unload radius | 7 cells | 4 cells |
| Cells generated per frame | 2 | 1 |
| Concurrent async builds | 4 | 2 |
| HLOD merge distance | 2.3 km | 1.2 km |
| Interiors | streamed | off |

The load radius is **circular**, not square — a square loads ~27% more cells for
the same visual radius, which is pure wasted VRAM. Candidates are sorted nearest
first so the cell the player stands in always wins a slot.

Build pipeline per cell:

```
worker thread:  GenerateCell → CarveCellIntoGrid → BuildGridMesh
game thread:    CreateStaticMesh → SetSectionMesh → PopulateInstancedProps
                → register lanes / walk points / patrol points with the AI
```

Eviction never touches a cell with an in-flight build (the worker holds the grid
pointer), never touches a district flagged `bAlwaysResident`, and uses hysteresis
(unload radius > load radius) so a player driving along a boundary does not
thrash.

## 11. Runtime voxel editing

`DestroyVoxelsInRadius` and `SetVoxelAtWorldLocation` mutate a resident grid,
mark the touched chunks dirty (including neighbours when the edit lands on a
chunk seam, or a face that became hidden across the seam is never re-meshed),
and re-mesh on the next tick. This is the destruction primitive: an explosion
leaves a permanent voxel crater in the city.

## 12. The browser slice

`BrowserSlice/js/world.js` implements the same six passes at browser scale:
boxes instead of voxels, a spatial hash instead of a chunk grid, one merged
geometry per material instead of four sections. The seed, the district plan, the
height-field gate, the window-lit hash and the crime/wanted tables are the same
numbers, so the two versions generate recognisably the same city.

Measured: 378 buildings, 44 767 boxes → 147 516 triangles in 24 draw calls,
47 ms generation, ~1.0 s mesh build, tallest tower 175 m.
