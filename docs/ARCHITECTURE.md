# ROADFALL architecture

## Shared runtime

`RoadfallGame` owns one scene graph for both target platforms. A platform only changes:

- Godot renderer profile and dynamic resolution;
- InputMap events and touch UI availability;
- export preset, package identifier and binary architecture.

Vehicle forces, surfaces, route destinations, bot decisions, inventory, rewards and elimination all execute in the same GDScript classes on Android and Windows. There is no HTML/WebView runtime in the native project.

## Streaming and budgets

`RoadfallWorldStream` models a 12,000 m square as a 20 × 20 grid of 600 m cells. The active set is a 3 × 3 neighborhood on Low through High and 5 × 5 on Ultra. Cells asynchronously become the next production streaming seam; this slice generates deterministic meshes on demand and removes old cells, so the entire world is not held in RAM. Feature counts, traffic, shadow distance, particles and resolution are controlled by `RoadfallQualityManager`.

The gameplay-facing memory budget is intentionally finite:

| Budget | Low | Medium | High | Ultra |
|---|---:|---:|---:|---:|
| World cells | 9 | 9 | 9 | 25 |
| Vegetation factor | .25 | .50 | .82 | 1.00 |
| Traffic factor | .35 | .65 | .90 | 1.00 |
| Resolution scale | .72 | .86 | 1.00 | 1.00 |
| Shadow distance | 35 m | 65 m | 105 m | 180 m |

The production asset pass can replace the procedural meshes with imported LOD scenes without changing the world or match APIs.

## Match and networking

`RoadfallMatchDirector` is the authoritative gameplay contract locally: it owns all 50 competitor slots, route sequence, countdown, destination timers, late elimination, events, loot, final run and winner calculation. `RoadfallBotVehicle` is a fallback driver for the 49 remote slots. `RoadfallNetcodeAdapter` documents the replacement boundary and validates speed, acceleration, teleport distance, reward and place before accepting a server snapshot.

The backend must own match state, loot rolls, inventory, currency, rank, rewards, destination progression and winner determination in online mode. The client save is for offline/bot play and settings only.

## Input and UI

Windows uses keyboard/controller actions and Android exposes the same actions through touch buttons. `RoadfallHUD` uses a full-rect responsive canvas and avoids fixed browser assumptions; the export is landscape and menu controls stay inside safe margins. The settings model already stores left-handed layout, steering/camera sensitivity, vibration, minimap zoom/rotation and touch layout for the production custom-layout editor.
