# Development status

Last updated: 2026-10-13 (end of Phase 1).
Engine target: **Godot 4.4.1-stable**. Every claim below was verified without
running the engine in this environment - see "How this was verified".

## Phase plan and state

| Phase | Scope | State |
|---|---|---|
| 1 | Foundation: project, world, character, camera, touch controls, one working weapon, health/elimination, one bot, pause + return to menu, Android export config | **complete** |
| 2 | Full weapon roster, loot economy, building service, full HUD, bots with squads and difficulty scaling | **complete for offline play** (this phase folded into Phase 1's foundation work) |
| 3 | Modes: Battle Royale zone, Clash Squad buy phase, 2v2 Arena, Training Ground, results + rewards | **complete for offline play** |
| 4 | LAN multiplayer (ENet + discovery) and custom rooms | room/beacon layer written, match replication **not** wired |
| 5 | Internet multiplayer (dedicated server, server-authoritative damage) | server entry point and RPC layer only |
| 6 | Missions/achievements/ranked screens, shop and inventory screens | data + services done, screens not started |
| 7 | Audio polish, music states, haptics | buses + 40 sounds done, music states simple |
| 8 | Performance passes (Low to Ultra), device profiling | presets implemented, **unprofiled on hardware** |
| 9 | Android release pipeline, signing, store assets | presets written, build **not run** here |

## What works today (offline)

* **World**: 5 original maps (Emerald Island 320x320, Neon Yard 96x96, Dust Canyon
  64x64, Training Base 112x80, Frost Frontier 256x256) generated from integer hash
  noise with rivers, ponds, roads, 15 landmark types, vegetation and loot spots.
  Chunks stream in around the player with a per-frame mesh budget, an LRU cache and
  player edits that survive chunk unloads.
* **Movement**: one shared `MoveLogic` for players and bots (acceleration, air
  control, step assist, crouch, sprint, water buoyancy, fall damage).
* **Combat**: 14 weapons with data-defined parts, spread, recoil, reload, pellets,
  falloff and headshots; armour tiers reduce damage; melee swings; throwables with
  fuses and blasts; exact DDA voxel ray casts for block picking and placement.
* **Bots**: four difficulty tiers, each with its own reaction time, aim error, lead,
  engagement range, healing threshold, strafe behaviour and building tendency.
* **Modes**: Battle Royale with a 7-phase shrinking zone and supply drops; Clash
  Squad 4v4 with a buy phase and first-to-4 rounds; 2v2 Arena; Training Ground with
  infinite ammo, respawns, target blocks and free building.
* **UI**: touch controls (14 buttons, drag-to-move layout editor, persistence),
  HUD (health, armour, ammo, crosshair spread, hit markers, damage numbers, kill
  feed, zone timer, minimap, inventory strip, interaction prompts, scoreboard,
  buy panel), main menu, loadout, settings, pause, results.
* **Meta**: versioned atomic save with checksum and corruption recovery; economy
  (coins/gems, no duplicate purchases); progression with Bronze to Master ranks;
  missions/achievement definitions; graphics presets from Low to Ultra with
  30 FPS low-end and 60 FPS high-end targets.

## Known limitations / bugs to fix next

1. **No engine execution here.** The sandbox cannot run Godot or build an APK, so
   everything is verified statically (parser, API database, geometry test, data
   validation). The first real editor run will likely surface small runtime issues
   (node lifetimes, first-frame ordering). This is the top risk of the project.
2. **Multiplayer is not playable.** Rooms, discovery, clock sync and RPC plumbing
   exist, and the host can broadcast snapshots, but remote player spawning,
   interpolation and server-authoritative damage are not implemented, so LAN and
   internet play are deliberately not reachable from the menu yet.
3. **Shop/mission screens are missing** - the data and services exist, the screens
   do not, so those menu entries are not shown.
4. **Round transitions in Clash Squad/Arena** are simplified: a round ends and the
   match ends, but between-round reset (new round, credits per round, spectate
   between rounds) is not yet sequenced.
5. **Bots do not revive teammates or use vehicles** (there are none yet).
6. **No haptics** yet on Android (vibration permission is already declared).
7. **Audio** has no 3D occlusion and only one music track per context.
8. Textures are 16x16 tiles at atlas scale, which is the intended art style, but
   no normal maps / roughness variation yet.

## How this was verified

| Check | Command | Result |
|---|---|---|
| GDScript syntax (all 58 scripts) | `./tools/gdcheck/gdcheck $(find blockstrike-royale -name '*.gd')` | 58 files parsed clean |
| Project semantics vs Godot 4.4.1 API database | `python3 tools/validate/validate_project.py blockstrike-royale` | PASS - 0 errors, 0 warnings |
| Voxel face winding / AO geometry | `python3 tools/validate/test_winding.py` | PASS |
| Engine test suite | `tests/run_tests.sh <godot>` | written, **not executed here** (no engine in this sandbox) |

## Next steps (Phase 2 of the plan)

1. Run the project in a real Godot editor, fix runtime issues, export a debug APK.
2. Sequence Clash Squad/Arena rounds properly (round reset, per-round credits,
   between-round spectating, match point).
3. Wire LAN play end to end: spawn remote players from room state, interpolate
   snapshots, authorise damage on the host.
4. Add the shop, inventory and mission screens on top of the existing services.
5. Profile on a low-end Android device and tune the Low preset.
