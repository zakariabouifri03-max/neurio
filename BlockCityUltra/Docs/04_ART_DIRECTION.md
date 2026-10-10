# Art Direction

## 1. The one rule

**The voxel look comes from geometry, never from a post-process.** There is no
pixelation shader, no resolution downscale used as a style, no dithering pass
pretending to be voxels. If a screenshot of BLOCK CITY ULTRA looks blocky at 4K,
it is because the building is made of cubes.

The consequence is that the aesthetic survives every expensive rendering feature.
Lumen bounce, virtual shadow map contact shadows, hardware ray-traced
reflections and volumetric fog all behave correctly on cubic geometry because it
*is* geometry — a pixel filter would destroy all four.

## 2. What "PBR voxel" means

Cubic forms, physically based surfaces. Every material in
`UBCUVoxelMaterialSet` has a base colour, roughness, metallic, emissive
luminance, wetness response and a Nanite-compatibility flag. The 63-entry table
lives in `BCUVoxelTypes.cpp` and is exported as
`Content/VoxelMaterialSet/DT_VoxelMaterialTraits.csv`.

| Family | Examples | Roughness | Metallic |
|---|---|---|---|
| Structural | concrete, brick, sandstone, granite, marble | 0.55–0.92 | 0.00–0.02 |
| Metals | steel, rusted steel, aluminium, chrome, copper, corrugated | 0.08–0.78 | 0.62–1.00 |
| Glass | clear, tinted, curtain-wall | 0.04–0.08 | 0.00–0.35 |
| Emissive | lit windows (warm/cool), neon (pink/cyan/amber/white), light fixtures | 0.20–0.30 | 0.00 |
| Ground | asphalt, worn asphalt, paving, tactile paving, road lines, kerb, gravel | 0.70–0.95 | 0.00 |
| Nature | grass, dry grass, dirt, mud, sand, rock, snow, ice, water, bark, leaves | 0.02–0.96 | 0.00 |
| Interior | plaster, oak, dark wood, tile, carpet, fabric, six painted colours | 0.18–0.98 | 0.00 |

Emissive intensity is in nits: a lit window is 8–12, neon signage 38–45, a light
fixture 60. Those numbers are what make a night street bloom correctly under ACES
tonemapping rather than glowing uniformly.

## 3. One material, many surfaces

Every generated mesh uses a single layered material, `M_VoxelSurface`. Per-voxel
variation arrives through vertex data, not through material slots:

- **Vertex colour** = material base colour × palette tint × baked shade × vertex AO
- **UV0** = world-aligned tiling coordinate at 1 tile per metre, so merged quads
  never stretch a texture
- **UV1.x** = material index (0–63), letting the shader branch into the right
  layer
- **UV1.y** = packed flags (emissive, translucent, masked, destructible,
  climbable, interior-only, wetness-reactive)

`FBCUVoxelPalette` multiplies rather than replaces, so one "Brick" material
produces a whole street of differently aged facades. The default palettes are
`FacadeAges` (six tints, white → 61% grey) and `NeonSignage` (six colours).

## 4. The city reads as a city

Density alone does not make a city legible. These are the specific devices:

**Skyline contrast.** Tower placement is gated on a city-scale noise peak, so
skyscrapers cluster at the financial core and a 175 m tower can stand next to a
12 m walk-up. Uniform height is the fastest way to make a generated city look
random.

**Setback tiers.** Tall buildings step inward every ~60 voxels (max five tiers),
which produces the zoned Art-Deco silhouette instead of an extruded box.

**Floor plate banding.** A horizontal accent-material band every 8 voxels makes
storeys countable from the street, which is what gives a facade its sense of
scale.

**Corner pilasters.** Accent-material columns at every building corner read as
structure rather than surface.

**Arcades.** Tall downtown buildings get a recessed ground-floor walkway with
emissive ceiling lights every 4 m — a covered space the player can actually walk
through.

**Ground-floor differentiation.** Lobbies are marble or granite, shopfronts are
reflective glass, warehouses are stained concrete. The first six metres of every
building is where the player spends all their time, so it never matches the
facade above it.

**Neon blades.** Vertical corner signs and horizontal fascia signs with gaps (so
they read as lettering rather than a bar) on retail and entertainment buildings.

## 5. Night

Night is the slice's showcase, and it is almost free:

- Lit windows are emissive voxels chosen once at generation. No light components.
- Streetlights are emissive luminaire voxels plus **one pooled point light** per
  cell that snaps to the nearest lamp. Thousands of lamps, one shadow-casting
  light.
- Neon signage uses the `NeonSignage` palette so a block never repeats a colour
  pattern.
- Antenna aviation beacons are emissive voxels at roof height — the detail that
  makes a distant skyline feel occupied.
- Vehicle headlights come on automatically when `ABCUGameState::IsNight()` or
  weather intensity exceeds 0.55, read from the replicated game state so client
  and server agree on dusk.
- Wet roads at night are the payoff: `WetnessResponse` per material drives how
  much roughness drops, so asphalt (1.40) goes mirror-like while gravel (0.60)
  barely changes.

## 6. Wetness and weather

`UBCUWeatherSystem` publishes six scalars and one vector to `MPC_Weather`:
`Wetness`, `RainIntensity`, `CloudCover`, `FogDensity`, `Lightning`, `WindSpeed`,
`WindDirection`. Every wet-road, puddle and glass material reads the collection
instead of running its own simulation, so there is exactly one answer to "how wet
is the city".

Wetness rises in rain at `RainWetnessPerMinute × intensity` and dries at
`WetnessDryRatePerMinute`, scaled by daylight (0.35× at night, 2.2× in sun) and
wind (0.7×–1.8×). Drying slower in shade is a small thing that makes a rainstorm
feel like it ended.

## 7. Vehicles

`UBCUVehicleVoxelBuilder` generates every body from a parametric silhouette
recipe keyed on `BodyStyle`. Profiles are normalised along the car's length
(0 = nose, 1 = tail) with roof and belt lines:

| Style | Character |
|---|---|
| Supercar | low wedge, roof peaks at 0.58, long overhangs |
| Muscle | notchback, roof 0.70, short rear deck |
| Sedan | three-box, roof 0.88 |
| SUV | tall greenhouse, roof 0.92, high belt |
| Van | one long box, roof 0.96 |
| Bus | longest box, glazed band, roof 0.98 |
| Pickup | cab to 0.88 then a flat bed at 0.48 |
| Motorcycle | narrow, roof 0.42, big overhangs |

Wheels are blocky discs: a filled square with the corners removed, which reads as
a wheel at speed and stays true to the identity. Interiors get a dashboard, a
steering ring, per-seat cushions and backs — because the hood camera and first
person mode are worth having only if there is something to look at.

Detail trim is a level parameter: level 2 (the player's car) adds door seams,
mirrors, a chrome grille and exhaust tips; level 1 (traffic) adds seams only;
level 0 is bare. Same silhouette, a third of the triangles.

## 8. Characters

`UBCUVoxelBodyComponent` builds a person from **13 instanced unit cubes** — head,
torso, hips, two upper arms, two hands, two upper legs, two lower legs, two shoes
— at 6 cm voxels, ~1.8 m tall, ~1.4k triangles. One `InstancedStaticMeshComponent`
per character, so a 240-pedestrian crowd is a handful of draw calls.

Each part follows an animation bone, so the silhouette stays blocky while the
pose deforms correctly. Palette slot per part (skin / shirt / trousers / shoes)
is packed into custom data 0, letting one layered body material serve every
outfit in the city.

`ApplyOutfit` falls back to a deterministic hash-derived palette when no outfit
data exists, so a crowd feels populated with zero authored content.

## 9. What never ships

- A pixelation, mosaic or "retro" post-process material
- A resolution downscale used as an art style
- Any texture, model, silhouette or colour scheme traced from an existing game
- Any real building, vehicle marque, city name or police livery
- Placeholder art left in a shipping build — the generator is the art pipeline
