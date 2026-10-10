# BLOCK CITY ULTRA — playable browser slice

The Phase 1 vertical slice, built to be **played right now** without installing
Unreal Engine. Same design as the C++ project in `../Source`: a procedurally
generated voxel city, a third-person character, enterable vehicles with real
driving physics, traffic, pedestrians, a progressive wanted level with police
pursuit, a mission chain, day/night and weather.

Everything is original. City names, districts, vehicles, manufacturers,
characters, factions, missions and dialogue were written for this project. No
asset, name, map, building or vehicle from any existing game is reproduced.

## Run it

Any static file server works. The slice uses ES modules, so it must be served
over HTTP — opening `index.html` from `file://` will fail on the imports.

```bash
cd BlockCityUltra/BrowserSlice
python3 -m http.server 8765 --bind 0.0.0.0
# → http://localhost:8765
```

There are no dependencies to install: Three.js r170 is vendored in
`js/three.module.js`.

## Controls

| Action | Key |
|---|---|
| Move / drive | `W` `A` `S` `D` |
| Look | Mouse (click the canvas to capture the pointer) |
| Sprint | `Shift` |
| Jump / handbrake | `Space` |
| Enter / exit vehicle | `F` |
| Start next mission | `E` |
| Horn (in a car) | `H` |
| Camera mode | `C` (third → close → first) |
| Look back | `Q` (hold) |
| Big map | `M` |
| New random city | `R` |
| Release mouse | `Esc` |

Touch: drag the left half to move, the right half to look.

## What is in the slice

**Procedural city** — `js/world.js`. A 12 × 12 block grid (≈1.4 km square),
deterministic from a seed. Six original districts laid out as a fixed macro-plan:
Foundry Heights at the core, then Marbella Row and Neon Mile, then Rowan Park and
Ironside Docks, with Calder International on the fringe. Generation is six
passes, mirroring `UBCUCityGenerator`: road layout → ground and pavement →
building massing → street furniture → vegetation and water → spawn points.

**Real cubic geometry** — `js/mesher.js`. The city is stored as axis-aligned
boxes per material and merged into one `BufferGeometry` per material. A spatial
hash drives an occlusion pass that drops any face buried inside another box.
Typical result for the whole slice:

```
boxes 44,767 → faces emitted 73,758 (culled 194,844)
             → 147,516 triangles in 24 draw calls
generation 47 ms, mesh build ~1.0 s
```

The blocky look comes from the geometry. There is no pixelation shader anywhere
in this project — that is the whole point of the art direction.

**Height field** — tower placement is gated on a city-scale noise peak, so
skyscrapers form a *cluster* at the financial core (up to 175 m) instead of
scattering evenly. A 175 m tower next to a 12 m walk-up is what makes a
generated skyline read as planned. Setback tiers, parapets, HVAC blocks, water
tanks, antennas with aviation beacons and helipads are all parametric.

**Windows that stay lit** — each window's material (unlit glass, warm interior,
cool interior) is chosen once at generation time from a hash, so the night
skyline is stable and free. There is no per-window light: emissive geometry does
the visual work and one pooled point light does the lighting work.

**Vehicles** — `js/vehicles.js`. Eight original vehicles, each built from a
parametric silhouette profile (a supercar is a low wedge, a van is a tall box, a
pickup is a cab plus a bed). Physics is a bicycle model with separate
longitudinal and lateral dynamics, speed-sensitive steering, a grip limit that
breaks into a drift, body roll and pitch from load, and a handbrake that
deliberately breaks traction.

**Traffic** — a lane graph built from the road layout, with lane following,
cornering slowdown, obstacle avoidance and yielding to the player. Vehicles are
pooled and spawned in a ring outside comfortable visibility so nothing
materialises in front of you. Far traffic updates at ~3 Hz.

**Pedestrians** — two tiers, exactly like `UBCUPedestrianSubsystem`: near
pedestrians are simulated with procedural limb swing, panic and flee behaviour;
far ones are not simulated at all. Hitting one is a witnessed crime and clears
the street.

**Police** — `js/police.js`. Heat accumulates per crime and decays *only* when
no unit has line of sight, which is the single rule that makes losing the cops a
real loop rather than a timer. Line of sight is a segment-vs-AABB test against
the building colliders, so breaking around a tower genuinely works. Units
dispatch on a per-wanted-level profile, spawn off-camera, and pick a tactic from
range and aggression: follow, intercept (with a quadratic lead solve), box in,
ram, or spiral-search the last known position. Arrest happens when a unit is
close, slow and looking at you.

**Missions** — `js/mission.js`. Three original jobs, matching
`../Tools/data/missions.csv`: Cold Chain Run (delivery), Neon Mile Sprint (race),
Vault of Foundry Heights (heist, starts you at three stars). Markers are a
rotating ring plus a 90 m light column so they read through the skyline.

**Day/night and weather** — `js/main.js`. Real solar geometry for a 41.5° N
latitude, so sunrise is due east and the golden hour is actually golden. A
Markov weather table moves between clear, cloud, rain, storm and fog. Wetness
rises in rain and dries with sun and wind, and it drives road roughness — the
cheapest change that makes rain look expensive. Lightning spikes the ambient
during a storm.

**Graphics presets** — Performance / Balanced / Quality / Ultra, mirroring the
four scalability groups in `../Config/DefaultScalability.ini`. They change draw
distance, shadow map size, traffic and pedestrian budgets, rain particle count,
pixel ratio and fog. Switch them on the title screen; the slice applies them
live.

## Files

```
BrowserSlice/
├── index.html            UI shell: HUD, title, loading, map, end card
├── style.css             original HUD design
├── js/
│   ├── three.module.js   vendored Three.js r170 (MIT)
│   ├── config.js         scale, districts, presets, vehicles, wanted table
│   ├── util.js           seeded RNG, value noise, math helpers
│   ├── world.js          city generation (six passes) + collision + LOS
│   ├── mesher.js         box → merged geometry with occlusion culling
│   ├── vehicles.js       voxel car bodies, vehicle physics, traffic manager
│   ├── player.js         voxel character, input, camera rig
│   ├── police.js         heat, wanted level, dispatch, pursuit AI
│   ├── mission.js        the three-mission slice chain
│   ├── hud.js            minimap, big map, readouts, toasts
│   └── main.js           renderer, sky, weather, pedestrians, game loop
└── Tools/smoke-test.mjs  headless generation + meshing test (runs in Node)
```

## Verify without a browser

```bash
node Tools/smoke-test.mjs
```

Runs the generation and meshing path headlessly and prints building count,
triangle count, draw calls, timings, and assertions for the collision and
line-of-sight solvers.

## How this maps to the UE5 project

| Browser slice | UE5 project |
|---|---|
| `js/world.js` generation passes | `UBCUCityGenerator` (same six passes, same seed) |
| `js/mesher.js` box merge + culling | `FBCUVoxelMesher` greedy meshing into four sections |
| `js/config.js` presets | `UBCUGraphicsSubsystem` + `DefaultScalability.ini` |
| `js/vehicles.js` bicycle model | `ABCUBaseVehicle` on Chaos WheeledVehicle |
| `js/vehicles.js` traffic manager | `UBCUTrafficSubsystem` lane graph + pooling |
| `js/player.js` two-tier crowd | `UBCUPedestrianSubsystem` near pawns + far instances |
| `js/police.js` heat + pursuit | `UBCUPoliceSubsystem` + `ABCUPoliceUnit` |
| `js/mission.js` objectives | `UBCUMissionSubsystem` + `UBCUMissionDefinition` |
| `js/hud.js` minimap render | `ABCUPlayerHUD` canvas render target |
| `js/main.js` solar geometry | `UBCUTimeOfDaySystem::ComputeSunAngles` |

The heat table, wanted thresholds, crime types, vehicle stats, district
parameters and mission rewards are the same numbers in both versions — the CSVs
in `../Tools/data/` are the single source of truth.
