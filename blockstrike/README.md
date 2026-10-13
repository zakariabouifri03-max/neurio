# BlockStrike Royale (Godot 4.7 prototype)

An original, touch-first **3D voxel battle royale** project built with **Godot 4.7 and GDScript**.
This folder is the Godot project; the existing Three.js racing game in the parent repository is separate and untouched.

**Current state: Phase 1 prototype (playable offline training ground).**
See [STATUS.md](STATUS.md) for the honest checklist of what is done, tested, partial, or not started.

> No APK has been built yet. The Android export preset exists, but the export templates and Android SDK could not be downloaded in the build environment. See "Android export" below.

## What works now

- **Emerald Island**: an original procedurally generated 128×40×128 voxel map with a river and bridges, a village, a signal outpost, a warehouse row, a hilltop tower, ruins, forests, boulders, and invisible boundary walls at the coastline. Generation is deterministic from a fixed seed.
- **Playable voxel character**: a procedurally built voxel humanoid with idle, walk, sprint, jump, fall, land, crouch, aim, reload, hurt and death states. It can step up small ledges and slows in water.
- **Third-person camera**: spring-arm follow camera with look sensitivity, invert-Y, FOV and distance settings, plus aim-down-sights zoom and optional aim assist.
- **One weapon** (Pulse Carbine): hitscan with spread, recoil, moving-spread penalty, range falloff, headshot multiplier, magazine and reserve ammo, reload and dry-fire.
- **Hit detection, health, armour and elimination**: shots are resolved against world geometry and actors. Dead actors respawn after 3 s. Falling out of the map counts as elimination.
- **Training bots**: Beginner, Normal and Advanced bots (data in `data/bots.json`). Each bot patrols, detects the player by line of sight, aims with reaction time and error, strafes, searches when it loses sight, and jumps small walls.
- **Touch controls** (Android, landscape): multi-touch. A floating move stick on the left half, look-drag on the right half, and buttons for Fire, Aim, Jump, Crouch (tap to toggle), Reload, Sprint and Pause. Positions can be edited live, and a left-handed layout is available.
- **Desktop fallback** for development: WASD, mouse look, LMB fire, RMB aim, Space jump, R reload, Shift sprint, C/Ctrl crouch, Esc pause.
- **Pause menu**: Resume, Settings, Edit touch layout, Return to main menu. Escape toggles pause (tested). The Android back gesture and automatic pause on focus loss or backgrounding are implemented but not yet verified on a device.
- **Settings** (saved locally to `user://settings.json` with a backup and corrupt-file recovery): sensitivities, camera distance, FOV, touch button size and opacity, touch layout, aim assist, graphics preset (Low/Medium/High), FPS counter, effects volume, mute.
- **Title screen**: Training Ground (choose bot difficulty), Settings, Quit. Modes that are not built yet (Battle Royale, Clash Squad, 2v2, custom rooms, multiplayer, shop) are shown **disabled and labelled** rather than hidden or faked.

## Not implemented (see STATUS.md)

Battle Royale, Clash Squad, 2v2, custom rooms, LAN and internet multiplayer, matchmaking, shop, cosmetics, progression, economy, additional weapons, additional maps, audio music, and a release Android build.
Multiplayer requires a game server; **no server is configured or included**, so no online functionality is claimed.

## Running it

Requirements: **Godot 4.7.x** (the project was written for 4.7.2-stable).

1. Open Godot and import `blockstrike/project.godot`.
2. Press F5. The main scene is the title screen.

Command-line tests (headless, no display needed):

```bash
GODOT=/path/to/godot-4.7.2 tools/run_tests.sh
```

This runs the unit and integration suite (`tests/run_tests.gd`) and an end-to-end flow test (`tests/flow_launcher.gd`, `tests/flow_driver.gd`) that drives the real menus and key input from title screen to Training Ground, pause, resume, and Return to Menu.

## Android export

The preset `Android Debug (arm64)` in `export_presets.cfg` writes to `build/BlockStrikeRoyale-debug.apk`.

To build it you need, on your own machine:

- Godot 4.7.x **export templates** (install from the Godot editor: Editor → Manage Export Templates).
- **Android SDK, NDK and a JDK** configured in Godot's Editor Settings → Export → Android.
- The debug keystore is generated/used by Godot's default debug signing. **No release keystore or signing credentials are stored in this repository**, and `.gitignore` excludes keystores, `*.apk` and `*.aab`.

Export with Project → Export → "Android Debug (arm64)", or `godot --headless --export-debug "Android Debug (arm64)" build/BlockStrikeRoyale-debug.apk`.
The APK is not included in the repository and has not been verified in this environment.

## Layout

```
project.godot          Godot project (autoloads: GameState, AppSettings, Sfx)
data/                  Blocks, weapons and bot tuning (JSON, validated by tests)
scenes/                Title screen, pause menu, HUD, touch controls, match, map, player
scripts/core/          Game constants, navigation state, graphics presets
scripts/save/          Save-file read/write with backup, settings store
scripts/voxel/         Block database, chunk mesher, voxel world, map generator
scripts/maps/          Map container (terrain, lighting, boundary)
scripts/player/        Player controller, character rig, third-person camera
scripts/combat/        Health, weapon, weapon data, shot resolution, impact effects
scripts/ai/            Bot controller
scripts/input/         Player input state, desktop input adapter
scripts/ui/            Title screen, pause menu, settings panel, HUD, touch controls
scripts/match/         Training match rules (kills, respawn, out-of-bounds)
scripts/audio/         Procedural sound effects (no audio files)
tests/                 Headless unit/integration tests and end-to-end flow test
tools/run_tests.sh     Runs both test suites
```

Empty placeholder folders for later phases (inventory, network, economy) are not created yet. The architecture keeps game rules (`scripts/match`, `scripts/combat`), presentation (`scripts/ui`), persistence (`scripts/save`) and networking separate so that later online play can reuse the rules on a server.

## Assets and licensing

Everything is original and generated in code: voxel geometry and colours, character and weapon models, and sound effects synthesised at start-up. No third-party models, textures, music or audio files are included. The default font is Godot's bundled font.

## External services

None are required to play. No server, account, analytics or ads are used. Online modes need a game server that does not exist in this project yet.
