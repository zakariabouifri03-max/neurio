# ROADFALL

ROADFALL is a native 3D cross-platform driving Battle Royale foundation for **Android ARM64** and **Windows 64-bit**. It is built as one Godot 4 project with one shared gameplay codebase, not a web page or a WebView shell.

The current build is a playable offline-bot slice of the commercial game loop:

- streamed 12 km × 12 km world with City, Suburbs, Industrial, Airport, Mountain, Forest, Desert, Coast, Farmland and Snow regions;
- continuous orthogonal highway/local-road network with safe, fast, off-road and risky route choices;
- real-time physics vehicle controller with throttle, braking, steering, handbrake, boost, surfaces, grip, weight/mass and upgrades;
- Street Car, Rally Car, Muscle Car, Off-Road SUV, Sports Car, Hyper Car, Heavy Utility and Performance SUV loadouts;
- 50-competitor match director with 49 route-selecting AI bots, mistakes, low-detail far simulation, sequential destinations and elimination;
- FINAL RUN, finish/winner/reward/rank progression, Credits and Road Gems;
- deterministic pickup/inventory/temporary upgrade system;
- dynamic weather and world events: rain, fog, sandstorm, snowstorm, convoy, train crossing, bridge closure, police pursuit and more;
- responsive minimap plus full interactive map, destinations, route marker, live competitors and landmarks;
- garage, shop, cosmetics-first economy, profile, leaderboard/season/challenge panels and JSON save system;
- Android-first touch controls (accelerator, brake, steering buttons, handbrake, boost, map, inventory and camera) plus configurable steering layout setting;
- keyboard, mouse and Xbox-style controller support: WASD, Space, Shift, E, M, Tab, Esc, C and I;
- automatic Low/Medium/High/Ultra detection, manual quality settings, Battery Saver/Balanced/Performance/Quality modes, dynamic resolution/shadow/traffic budgets;
- server-authority seam in `game/netcode_adapter.gd` so a network transport can replace bots without rewriting gameplay rules.

## Build requirements

Install **Godot 4.3 or newer** with the Android build template and Android SDK/NDK configured. Godot is not bundled in this repository. No browser or Node runtime is used by the game.

### Run in the editor

1. Open this directory in Godot 4.
2. Press Play Project.
3. The first run creates `user://roadfall_profile.json`.
4. Use `WASD`, a controller, or the on-screen controls on a touch device.

### Windows 64-bit build

```bash
./scripts/build_windows.sh
# build/windows/ROADFALL.exe
```

### Android ARM64 APK and AAB

Connect the Android SDK/NDK in Godot Editor → Editor Settings → Export → Android, then:

```bash
./scripts/build_android.sh apk
# build/android/ROADFALL.apk

./scripts/build_android.sh aab
# build/android/ROADFALL.aab
```

The export presets set the package to `com.roadfall.game`, app name `ROADFALL`, landscape orientation, release metadata, and ARM64-only Android architecture. Sign the release artifact with the production keystore before store upload; the preset is intentionally not shipped with a secret signing key.

## Project layout

```text
project.godot              Godot native project settings
export_presets.cfg         Windows, Android APK and Android AAB presets
scenes/Main.tscn           single shared native entry scene
branding/                  original ROADFALL icon and splash artwork
game/data.gd               shared rules, vehicles, loot, regions, destinations
game/game.gd               platform-neutral game bootstrap and input bridge
game/world_stream.gd       12 km world cells, roads, landmarks and surfaces
game/vehicle.gd            shared vehicle physics and upgrade application
game/bot_vehicle.gd        swappable bot driver/navigation behavior
game/match_director.gd     50-player match, routes, events, elimination, winner
game/hud.gd                responsive HUD, touch controls, map and inventory
game/map_view.gd           minimap/full map rendering and markers
game/quality_manager.gd    auto quality, scalable budgets and thermal fallback
game/menu.gd               menu, garage, shop, profile and settings
game/save_system.gd        local profile/progression persistence
game/netcode_adapter.gd    server-authoritative multiplayer integration seam
scripts/                   reproducible Godot export commands
docs/                      architecture and production handoff notes
```

## Multiplayer and production handoff

The first functional build intentionally uses AI competitors so the complete match can be played without backend credentials. `RoadfallNetcodeAdapter` defines the transport seam and validation contracts for server-authoritative match state, loot, inventory, rank, currency, destination progression, reconnect, private lobbies, reporting and anti-cheat. The gameplay scene does not need to be rewritten when a transport is connected.

This repository contains source and reproducible export configuration. The sandbox does not include the Godot editor/export templates or Android signing credentials, so release APK/AAB and Windows binaries are generated by the build commands in an installed Godot environment rather than pretending that a web bundle is an APK.
