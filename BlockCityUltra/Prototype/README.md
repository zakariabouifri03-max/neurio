# BLOCK CITY ULTRA — Playable Vertical Slice

The **Milestone 1** deliverable from the development plan: a high-quality
playable city district with a drivable vehicle, a third-person character,
realistic lighting, traffic, police AI and one complete mission.

It runs in the browser against a vendored Three.js r170 — **no build step, no
CDN, no internet required**.

```bash
python3 serve.py            # → http://localhost:8000
python3 serve.py 8080       # custom port
```

`serve.py` is a standalone threaded server. `python3 -m http.server 8000` also
works — it's just single-threaded, so the 13 module files load a little slower.
**Opening `index.html` from the filesystem will not work**: browsers block ES
modules on `file://` URLs, so the game must be served over HTTP.

---

## Controls

| Key | Action |
|---|---|
| `W A S D` / arrows | drive · walk |
| `Space` | handbrake (breaks rear grip → drift) |
| `F` | enter / exit vehicle (walk up to any car) |
| `Shift` | sprint on foot |
| `C` | look behind while driving |
| `R` | repair the car (costs credits) |
| `N` | skip forward 3 hours |
| `F3` | performance overlay |
| `M` | show / hide the settings panel |
| `Esc` | pause |

---

## What's in it

* **Voxel district** — 266 procedural buildings, 3,562 road segments,
  **64,689 voxel boxes in 11 draw calls**. Cubic setbacks, cornice bands,
  corner piers, spandrel slabs, rooftop HVAC / stairhouses / antenna masts.
  The blockiness is in the **geometry**, not a screen-space filter.
* **Driving** — longitudinal engine/brake/drag model, lateral tyre slip with a
  grip circle, speed-sensitive steering, weight-transfer body roll,
  damage from impacts, fuel, gears and RPM.
* **On foot** — third-person character that can walk, sprint and steal any
  nearby car (which is, correctly, a crime).
* **Day/night** — real solar azimuth/elevation model, golden hour, streetlights
  and windows that light up at dusk via a single global parameter.
* **Weather** — 7 states with rain, wind, fog, wet roads that stay wet after
  the rain stops, and lightning in storms.
* **Traffic** — simulated cars with car-following near you; analytic "road
  ghosts" out to the horizon (1 draw call for hundreds of distant cars).
* **Pedestrians** — 320 instanced voxel people who panic and flee when you
  cause trouble nearby.
* **Police & wanted system** — 5-star heat table, patrol → investigate →
  search grid → pursue → PIT → arrest, with giving-up logic when you break
  line of sight. Crime only counts fully when witnessed.
* **One complete mission** — *First Light*: meet the contact, take the car,
  deliver the package, lose the heat. GPS ribbon drawn on the road.
* **Graphics presets** — Performance / Balanced / Quality / Ultra, 1080p /
  1440p / 4K, 30–144 fps caps or unlocked, optional dynamic resolution.

---

## File map

```
Prototype/
├── index.html              HUD, minimap, settings panel, CSS
├── vendor/three.module.js  Three.js r170 (MIT, vendored)
└── src/
    ├── main.js             game loop, input, presets, camera, crimes
    ├── city.js             district + road graph + A*  (≡ citygen.py ≡ C++)
    ├── voxel.js            voxel architecture + instanced batching
    ├── vehicle.js          vehicle physics + voxel vehicles + chase camera
    ├── traffic.js          traffic tiers + instanced pedestrians
    ├── police.js           wanted heat + police behaviour ladder
    ├── mission.js          mission data + objective state machine
    ├── environment.js      sun/sky/weather/wetness
    ├── hud.js              speedo, wanted, minimap, GPS, stats overlay
    └── util.js             seeded RNG, math, spatial hash
```

Every one of these has a counterpart in `../Source/BlockCityUltra/`:

| Prototype | Engine |
|---|---|
| `city.js` | `World/BCUCityGenerator.cpp`, `World/BCURoadNetwork.cpp` |
| `voxel.js` | `Voxel/BCUBuildingGenerator.cpp`, `Voxel/BCUVoxelMesher.cpp` |
| `vehicle.js` | `Vehicles/BCUVehicleBase.cpp` |
| `traffic.js` | `Vehicles/BCUTrafficSystem.cpp`, `AI/BCUPedestrianSystem.cpp` |
| `police.js` | `AI/BCUPoliceSystem.cpp`, `AI/BCUWantedComponent.cpp` |
| `mission.js` | `Gameplay/BCUMissionSystem.cpp` |
| `environment.js` | `World/BCUEnvironmentSystem.cpp` |
| `hud.js` | `UI/BCUHUD.cpp`, `UI/BCUMinimapSystem.cpp` |
| `main.js` | `Core/BCUGameMode.cpp`, `Core/BCUGameInstance.cpp` |

The district table, seeded RNG and wanted-level thresholds are kept identical
across all three implementations (C++, Python, JS) on purpose.
