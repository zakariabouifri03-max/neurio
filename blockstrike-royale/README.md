# BlockStrike Royale (Godot 4 prototype)

An original voxel battle-royale prototype for Android (landscape) written in Godot 4.7 + GDScript.
Cubic Minecraft-style terrain, a shrinking-zone battle royale, third-person shooting, AI opponents,
virtual-joystick touch controls and a menu shell for the rest of the planned modes.

> **Status: local prototype.** The game runs headless in this repository's test environment
> (unit tests, runtime smoke tests of the menu and matches). Visual look, touch behaviour on a real
> phone, frame rate on low-end devices and the Android APK have **not** been verified. Online play
> does **not** exist yet. See "Not implemented" below. Nothing here is a mockup: every menu entry
> either works locally or is shown disabled with the reason.

## Quick start

1. Install Godot **4.7.x** (the editor build) from https://godotengine.org/download.
2. Open this folder (`blockstrike-royale/`) as a project. Godot imports the assets on first open.
3. Press F5. The main menu opens on the **Play** tab. Pick **Battle Royale - Solo** or **Training Ground** there.

Controls on a PC (for testing):

| Action | Key |
| --- | --- |
| Move | W A S D (Shift to sprint) |
| Look | Mouse (captured in matches) |
| Fire | Left mouse |
| Aim down sights | Right mouse (hold) |
| Jump / Crouch | Space / C |
| Reload | R |
| Switch weapon / slots 1-3 | Q / 1 2 3 |
| Pick up / use | E |
| Heal (bandage or medkit) | F |
| Throw grenade (aim with the mouse) | G |
| Build a sandbag wall | B (aim at a surface) |
| Inventory | Tab or I |
| Pause | Esc |

Touch controls (landscape): touch the left side of the screen to start a floating joystick (push to the
edge to sprint). Drag on the right half of the screen to look, and tap the buttons on the right. Buttons: FIRE, AIM, JUMP, CROUCH, RELOAD, SWAP,
USE, HEAL, BUILD, NADE, BAG, pause (II). Use **Settings > Edit layout** to drag buttons anywhere; the layout,
button size, joystick size and look sensitivity are saved on the device.
To test touch layout on a desktop, enable **Settings > Always show touch controls**.

## Modes

| Mode | Status |
| --- | --- |
| Battle Royale - Solo | Playable offline: 16 players (you + 15 AI), shrinking zone, supply drops, elimination, placement, rewards |
| Battle Royale - Duo / Squad | Playable offline with **AI** teammates only. Human teammates need online play (not implemented) |
| Training Ground | Playable: 6 respawning bots, unlimited reserve ammo, respawn after death |
| Offline practice | Covered by Training Ground. Matches run on the device with AI opponents only |
| Clash Squad 4v4 (rounds, buy menu) | Not implemented |
| 2v2 Arena | Not implemented |
| Custom rooms (codes, invites, config) | Not implemented. Needs the room server |
| LAN host / join | Not implemented |
| Ranked queue / Friends / Online matchmaking | Not implemented. Shown disabled with the reason |

## What is implemented

- **World:** map "Ironridge Valley" (112 x 40 x 112 blocks), generated from a fixed seed. Grass, sand,
  stone, forests with trees, a village with houses and roads, a river with a bridge, a walled military
  base, rocks and loot. Chunked voxel meshes with per-vertex ambient
  occlusion, one collider per chunk, and chunk culling by view distance.
- **Combat:** hitscan weapons with spread, recoil, fire rate, magazine, reload time, ADS, headshot
  multipliers and per-pellet shotgun damage. Weapons: assault rifle, SMG, shotgun, sniper, pistol and
  knife (melee). Grenades (throw with G or NADE): 2.2 s fuse, bounce off terrain, 110 damage at the
  centre falling off to 10 % at 5.5 m. Teammates are not hurt. Procedurally built weapon models, muzzle flashes, tracers, dust, blood and debris
  particles. A supply drop lands with a smoke burst and a blast sound.
- **Survival:** health, armour (absorbs half of incoming damage), bandages, medkits, armour plates,
  build blocks, ammo types (light, medium, shell, heavy), three inventory slots, loot dropped on death.
- **Battle royale:** safe zone with four shrink phases and rising damage outside (1, 2, 4, 7 per second)
  (`scripts/match/safe_zone.gd`),
  supply drops with weapons, elimination feed, placement, spectator camera (NEXT button), results.
- **AI:** target selection with line of sight, strafing, a reaction delay and aim error scaled by
  difficulty, looting, roaming, retreating into the zone, healing when hurt, stuck detection.
- **Building:** place sandbag walls against surfaces with the BUILD action; blocks are not placed inside characters.
- **Progression (local, saved to `user://blockstrike_save.json`):** coins, gems, XP and levels,
  rank points and six leagues (Bronze to Champion), daily missions (resets on the device's date), a
  cosmetics shop (outfits, helmets, backpacks, a weapon tint). Cosmetics never change stats.
- **Menus:** Play, Modes, Rooms, Shop, Inventory, Missions, Ranked, Friends, Settings.
- **Settings:** Low / Medium / High presets: render scale 0.7 / 0.85 / 1.0, view distance 70 / 110 / 170,
  FPS cap 30 / 45 / 60. Shadows are off on Low and on from Medium. SSAO and glow are on High only.
  Also: look and ADS sensitivity, joystick and button size, invert Y, FPS counter, master volume, player
  name, and the touch layout editor (Settings > Edit layout). "Always show touch controls" turns the
  touch UI on for desktop testing.
- **Audio:** all sound effects are synthesized in code (`autoload/sfx.gd`), no sound files.

## Project layout

```
project.godot              engine settings, autoloads (Game, Controls, Sfx), 1280x720 landscape
export_presets.cfg         Android preset (arm64, debug, internet permission off until networking exists)
autoload/
  game.gd                  settings, profile, quality presets, rewards, missions, shop, save file
  controls.gd              single input layer: keyboard/mouse and touch both write here
  sfx.gd                   procedural sound effects with pooled players
scripts/
  core/inventory.gd        slots, ammo, items, heal logic, drop list (pure, unit tested)
  match/safe_zone.gd       zone timeline (pure, unit tested)
  match/game_modes.gd      mode catalogue and which modes are playable
  match/match_manager.gd   one match: generation, spawning, loot, zone, respawn, end, HUD feed
  world/map_generator.gd   terrain, river, roads, village, base, forest, spawn and loot points
  world/voxel_world.gd     chunk meshes, colliders, ray queries, visibility culling
  world/block_defs.gd, texture_atlas.gd   block ids, colours and the procedural texture atlas
  world/loot_pickup.gd, supply_drop.gd    ground loot and parachute supply crates
  weapons/weapon_db.gd     weapon statistics
  weapons/weapon_model.gd  procedural weapon meshes
  weapons/fx.gd            pooled tracers, muzzle flashes, particle bursts
  characters/character_base.gd  health, armour, movement, firing, reload, melee, death, respawn
  characters/player.gd     third-person camera, ADS, recoil, input mapping
  characters/bot.gd        AI opponent
  characters/character_model.gd procedural blocky soldier with code animation
  ui/hud.gd, minimap.gd    in-match HUD, minimap, pause/inventory/results overlays
  ui/mobile_controls.gd    touch joystick, look swipe, action buttons, layout editor
  ui/main_menu.gd          menus
scenes/                    main.tscn (menu), match.tscn, player.tscn, bot.tscn
tests/
  test_runner.gd           headless unit tests (56 checks)
  smoke_test.gd, smoke.tscn  headless runtime smoke test of the menu and a full match
tools/build_apk.sh         command that exports the Android debug APK (needs the editor and templates)
```

## Testing

Unit tests (pure logic: safe zone, weapons, modes, inventory, block rules, map generation):

```
godot --headless --script res://tests/test_runner.gd
```

Runtime smoke test (builds every menu screen, starts a Battle Royale match, lets 16 characters fight,
picks up loot, builds a wall, pauses, opens inventory, ends the match and shows results; exits 0 on success):

```
godot --headless res://tests/smoke.tscn            # battle royale, about 2 minutes of game time
godot --headless res://tests/smoke.tscn -- training  # training ground
```

Results recorded while preparing this prototype (engine: Godot 4.7.2-stable, built from source,
headless, no GPU):

- Unit tests: 59 passed, 0 failed.
- Grenades: a thrown grenade detonated after its fuse, and a direct blast applied full damage at the
  centre of a bot.
- Smoke test, battle royale (5,590 frames, about 2 minutes of game time): 16 characters went live,
  bots eliminated each other (cause and killer logged), the zone began shrinking and entered phase 1,
  a supply drop spawned, the player was eliminated and entered spectating, a wall was built, pause,
  inventory and results worked, and the run ended with exit code 0.
- Smoke test, training: the player was shot and respawned, the unlimited-ammo rule held, and the run
  exited with code 0. The wall-build check is informational and is not required to pass: it failed on
  some runs when the aim ray missed the wall, so build placement is verified in only some runs.
- Problems found and fixed during testing: a hang when the kill feed was trimmed (queue_free does not
  remove a node in the same frame), glass treated as opaque (faces behind it were hidden), and two
  script parse errors. The log of the final runs contains one expected message, "Could not load global
  script cache", which appears on the first run before the project's `.godot` cache exists.

Not verified here: how the game looks on a screen, touch input on a phone, frame rate on low-end devices,
and the APK. Those need a display, a device and an Android export.

## Android build

```
GODOT=/path/to/Godot_v4.7.2-stable_linux.x86_64 tools/build_apk.sh
```

Requirements, which are not in this repository: the Godot 4.7.x **editor** binary (templates cannot
export), Godot 4.7.x Android export templates, JDK 17 and the Android SDK, configured in the editor
under Editor Settings > Export > Android. Output: `build/BlockStrikeRoyale-debug.apk`.
**The APK has not been built or installed yet.** The export templates and the Android SDK were not
reachable from the build environment.

For a release build, create a keystore in the editor's export dialog (do not commit it), keep
`package/unique_name` and bump `version/code` for each build.

## External services and online play (not implemented)

No online feature works in this build. Each item below needs a backend that does not exist yet:

- **Accounts and profiles:** sign-in, cloud save for coins, gems, XP, cosmetics and rank.
- **Matchmaking:** a queue service that groups players by mode, region and rank.
- **Authoritative match server:** runs the simulation (hit detection, zone damage, loot, supply drops),
  receives inputs, sends snapshots and handles disconnects and reconnects. The client currently
  simulates everything locally and must not be trusted for online play.
- **Rooms:** room codes, invites, the ready-check and room settings (map, mode, team size).
- **LAN:** UDP broadcast discovery and a direct ENet host/join (or manual IP entry).
- **Friends and presence:** friend list, invites, online status.
- **Ranked and seasons:** league points stored on the server, season resets, season rewards.

When any of these is built: set `permissions/internet=true` in `export_presets.cfg`, configure the
endpoints in a single file, and test each path with at least two clients and with a dropped connection
before describing it as working.

## Not implemented yet (from the requirements)

- Grenades thrown by bots (only the player can throw).
- Clash Squad, 2v2 Arena, custom rooms, human multiplayer, LAN, friends, ranked matchmaking.
- Weekly missions, achievements, seasonal rewards (the menus say so).
- Visual polish: the procedural soldier and voxel textures are placeholders. There are no animations
  for throwing, vaulting or reloading beyond the code-driven ones.
- Rounds, buy menu, team economy (Clash Squad).
- Performance work beyond the presets: no GPU instancing for trees, no LOD for distant chunks, and no
  measured frame rate on low-end phones yet. The 30 FPS target on low-end is a goal, not a result.
- Server-side anti-cheat (none exists, because there is no server).

## Assets and licensing

Everything in this repository is original work or generated by code at runtime: voxel geometry, the
block texture atlas, weapon and character models, particles, the app icon (`icon.svg`) and all sound
effects. No third-party art, music or audio files are included. Godot Engine is MIT-licensed.
