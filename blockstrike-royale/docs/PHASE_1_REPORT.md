# Phase 1 report - BLOCKSTRIKE ROYALE

Date: 2026-10-13
Engine target: **Godot 4.4.1-stable** (Android, Mobile renderer, ETC2/ASTC)
Commits: `9d5eb56` (foundation), `9fa144f` (playable build), `e23af8e` (mesher fixes)

---

## 1. What Phase 1 had to deliver - and what exists

| Phase-1 requirement | Delivered | Evidence |
|---|---|---|
| Original voxel map | 5 original maps generated from integer-hash noise: Emerald Island 320x320 (river, 2 bridges, 3 roads, 12 named places, 620 trees), Neon Yard 96x96, Dust Canyon 64x64, Training Base 112x80, Frost Frontier 256x256 | `scripts/world/terrain_generator.gd`, `data/maps.json` |
| Controllable voxel character | `PlayerController` (CharacterBody3D) with shared `MoveLogic`: acceleration, air control, crouch, sprint, step assist, water buoyancy, fall damage; procedural cuboid rig with 16 animation states | `scripts/player/player_controller.gd`, `move_logic.gd`, `character_animator.gd` |
| Third-person camera | Boom with collision shortening, ADS FOV + distance, pitch clamps, sensitivity settings, name tags for everyone else | same |
| Working touch controls | Floating left stick, right-side look area, 14 action buttons, drag-to-move layout editor, size/left-handed/tap-to-fire options, all persisted in the save file | `scripts/ui/touch/touch_controls.gd`, `touch_button.gd` |
| One weapon with firing + hit detection | 14 weapons, data-driven; hitscan with per-pellet spread, falloff, headshots, armour reduction, wall blocking, melee arcs, throwables with fuses | `scripts/combat/*.gd`, `data/weapons.json` |
| Health + elimination | Health/armour tiers, healing items, damage sources, elimination, kill feed, spectating, death → results | `player_controller.gd`, `damage_system.gd`, `match_manager.gd` |
| One enemy bot / target | Full bot brains with 4 difficulty tiers (Easy/Normal/Hard/Expert), plus target blocks and infinite-ammo practice ranges in Training Ground | `scripts/ai/bot_controller.gd` |
| Pause menu | Pause overlay with resume, sensitivity, touch size, layout editor, leave; the tree really pauses and the menu still responds | `scripts/ui/menus/pause_menu.gd` |
| Return-to-menu flow | App root owns the screen stack; match → results → menu or rematch without reloading autoloads | `scripts/ui/app.gd`, `match/match_scene.gd` |
| Android export configuration | Debug + release presets, mobile renderer, landscape, immersive mode, adaptive launcher icons, permissions, **no credentials in the repo** | `export_presets.cfg`, `project.godot` |

Beyond the minimum, Phase 1 also ships four complete modes (Battle Royale with a
7-phase shrinking zone and supply drops, Clash Squad 4v4 with buy phase and
first-to-4 rounds, 2v2 Arena, and a Training Ground), loot containers and pickups,
building (limited and free), a full HUD, and loadout/settings screens.

## 2. Files

**Created in this phase (63 files, ~10 400 lines of GDScript + data):**

* `scripts/world/` - `voxel_library.gd`, `chunk.gd`, `voxel_ray.gd`, `terrain_generator.gd`,
  `voxel_world.gd`, `building_service.gd`, `zone_manager.gd`, `environment_builder.gd`
* `scripts/player/` - `player_controller.gd`, `move_logic.gd`, `character_animator.gd`,
  `input_router.gd`, `interaction_component.gd`
* `scripts/combat/` - `weapon_controller.gd`, `weapon_model.gd`, `damage_system.gd`,
  `throwable_projectile.gd`, `game_effects.gd`
* `scripts/inventory/` - `player_inventory.gd`, `loot_pickup.gd`, `loot_container.gd`
* `scripts/match/` - `match_manager.gd`, `match_scene.gd`, `players.gd`
* `scripts/ai/bot_controller.gd`
* `scripts/ui/` - `app.gd`, `game_router.gd`, `hud/hud.gd`, `touch/touch_controls.gd`,
  `touch/touch_button.gd`, `menus/main_menu.gd`, `menus/settings_menu.gd`,
  `menus/loadout_menu.gd`, `menus/pause_menu.gd`, `menus/results_screen.gd`
* `scenes/` - `app.tscn`, `match.tscn`, `menus/main_menu.tscn`, `menus/settings.tscn`,
  `menus/loadout.tscn`
* `tests/` - `tests.tscn`, `test_runner.gd`, `test_case.gd`, 5 suites, `run_tests.sh`
* `export_presets.cfg`, `README.md`, `LICENSE`, `docs/BUILD.md`,
  `docs/DEVELOPMENT_STATUS.md`, `docs/ASSETS.md`

**Modified (existing foundation code):**

* `project.godot` - added the `scoreboard` input action (Tab) and kept every Android setting.
* `scripts/core/game_config.gd` - `scoreboard` action added to `ACTION_DEFAULTS`.
* `scripts/core/audio_director.gd` - `AudioServer.bus_count` (the old `get_bus_count()` call
  does not exist), 3D pool properties fixed, and `stream_path()` now accepts full `res://`
  paths so data files may reference sounds by id or by path.
* `scripts/core/network_manager.gd` - real snapshot channel (`send_snapshot`,
  `receive_snapshot`, `send_player_state`, `peer_state_received`).
* `scripts/core/lobby.gd` - the saved loadout is merged into offline match settings.
* `tools/validate/validate_project.py` - comment/string masking for the Godot-3 idiom scan,
  lambda support for `.connect(...)`, `lmg` weapon category.
* `tools/validate/test_winding.py` - new UV-axis invariant check (see bug 2 below).

## 3. Evidence - what was actually run

| Check | Command | Result |
|---|---|---|
| GDScript syntax, every file | `./tools/gdcheck/gdcheck $(find blockstrike-royale -name '*.gd')` | **58 files parsed clean** |
| Project semantics against the Godot 4.4.1 API database | `python3 tools/validate/validate_project.py blockstrike-royale` | **PASS - 0 errors, 0 warnings** (autoloads 12, scenes 6, tests 7, weapons 14, data files 8) |
| Voxel geometry invariants | `python3 tools/validate/test_winding.py` | **PASS** - 6 faces x 4 corners, winding + UV axes + AO + UV coverage |
| Data integrity (every weapon, item, map, place, mode, shop entry, audio path) | inside the validator and `tests/test_content.gd` | PASS (static) |
| Engine test suite | `tests/run_tests.sh <godot>` | **written but not executed - no engine in this sandbox** |

**Not done, and not claimed:** the game has never been launched, no APK has been
built, and no Android device has run it. This sandbox cannot execute Godot or run
the Android toolchain, so every "works" statement above is a *statically verified*
claim (parser + API database + geometry tests + data validation), not an observed
run. The first editor session is the highest-risk remaining step and is listed as
such in `docs/DEVELOPMENT_STATUS.md`.

## 4. Bugs found and fixed during this phase

1. **Chunk `world` reference typed as `Node`** and a stale `get_block_global()` call -
   the mesher could not reach the streaming world; caught by the validator, fixed
   by typing the field `VoxelWorld` and calling `get_block()`.
2. **Side and bottom face UVs were vertically flipped**, which would have drawn every
   grass/dirt/snow side tile upside down, and the atlas rects sampled exactly on tile
   boundaries, letting nearest filtering pick up a neighbouring tile along face edges.
   Fixed by rewriting `FACE_UVS` and insetting every rect by half a texel on load; the
   geometry test now verifies `cross(u_dir, v_dir) == -normal` for all six faces.
3. **`AudioServer.get_bus_count()` does not exist** (it is the `bus_count` property) and
   the UI audio pool was receiving 3D-only properties - both would have failed at
   start-up. Found by the API-database check.
4. **The `team_size` key was read as `teams_size`**, so team modes silently degraded to
   free-for-all. Caught while auditing the match manager.
5. **The final zone phase never completed** (zero shrink time meant the phase never
   advanced), so a Battle Royale match could not be won by attrition. Fixed.
6. **Round sequencing did not exist** for Clash Squad/Arena (the first wipe ended the
   match). Now the winning team scores a round, players respawn with the mode loadout,
   credits are paid, the buy phase restarts, and the first team to N rounds wins.
7. **Bots could not shoot straight**: without a camera rig their yaw was never applied
   and `aim_direction()` ignored pitch. Fixed in `PlayerController`.
8. **A finger landing on an action button also steered the camera** (both raw-input
   handlers saw the event). Buttons now claim their rectangle.
9. **The pause menu would have been unclickable** while the tree was paused; it now runs
   in `PROCESS_MODE_WHEN_PAUSED`.
10. **The world was never handed its map/seed** (no `setup()` call), so the first match
    would have had no terrain. Fixed.

## 5. Known bugs / limitations at the end of Phase 1

1. Nothing in this project has been executed in the engine yet (see section 3).
2. **Multiplayer is not playable.** Rooms, LAN discovery, clock sync and the snapshot
   channel exist, but remote player spawning and server-authoritative damage do not, and
   `MatchScene.start_with()` *refuses* networked matches with a clear message instead of
   pretending. LAN/internet play is therefore unreachable from the menu, by design.
3. Clash Squad/Arena dead players keep a free camera instead of being parked until the
   next round starts.
4. Shop, inventory, mission and ranked *screens* do not exist yet (services and data do),
   so no menu entry offers them.
5. Bots do not coordinate beyond proximity (no squad leaders, no revives, no vehicles).
6. No haptics, no audio occlusion, one music bed per context.
7. Nothing has been profiled on real hardware; the Low preset is a reasonable guess, not
   a measurement.

## 6. External dependencies

* **Godot 4.4.1-stable** (engine, not vendored). Every API used is checked against
  `tools/validate/godot_api_db.json`, generated from the 4.4.1 source documentation.
* No third-party art, audio, fonts, plugins or packages. All 114 assets are generated by
  `tools/assets/*.py` (deterministic, standard library only).
* Verification tooling in `tools/` (a GDScript parser built from the tree-sitter
  grammar, an API database builder and the project validator) is development-only and
  is not shipped with the game.
* Android builds additionally need the Android SDK/build-tools, JDK 17 and the Godot
  export templates - see `docs/BUILD.md`. Signing keys stay local: the repository
  contains no keystore, password or key material.

## 7. Exact next steps (Phase 2)

1. **First engine session** (highest priority): `godot --path . res://scenes/app.tscn`,
   fix whatever the first run surfaces, then `--export-debug "Android Debug"` and install
   on a device. Report real FPS numbers for the Low/Medium presets.
2. Run `tests/run_tests.sh` in that session and fix any failing assertion - the suites
   are written to be run, not just to exist.
3. Park dead players until the next round in Clash Squad/Arena (spectate camera only for
   the round they died in, then respawn on the round start).
4. Complete LAN play: spawn remote players from room state, interpolate host snapshots,
   validate damage host-side, then remove the barrier in `MatchScene.start_with()`.
5. Build the shop / inventory / mission screens on the existing services, then ranked.
6. Profile on a low-end Android device and tune the Low preset and the chunk mesh budget.
