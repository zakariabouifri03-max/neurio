# BlockStrike Royale — Godot 4 prototype

This directory is the playable Godot 4 prototype for **BlockStrike Royale**. It is intentionally separate from the repository's older browser kart game so the existing web build stays intact.

## What is playable now

- One authored blocky arena with a forest, cubic mountains, Cedar Village, river, bridge, roads, and Outpost 07 military base.
- Third-person player controller with walk/run, jump, crouch, camera orbit, aim zoom, two weapon slots, hitscan AR-7 Pulse and Sidekick, reload, armor, health, ammo, weapon swapping, and optional cover blocks.
- Eight local AI bots with movement, line-of-sight shooting, damage, eliminations, safe-zone damage, and victory/defeat flow.
- Shrinking mint safe zone, world-space ring, minimap, tracers, muzzle flashes, hit effects, shadows, fog, and procedural voxel-style geometry.
- Landscape HUD with virtual joystick, camera pad, fire/aim/jump/crouch/reload/swap/build controls. Mouse and keyboard controls work in the desktop editor too.
- Local progression: coins, gems, XP, levels, missions, cosmetic shop, inventory, and save data at `user://blockstrike_royale.json`.
- Selectable offline variants: Battle Royale, Clash Squad, 2v2 Arena, and Training Ground. The prototype changes bot count and match timing per mode.
- Rooms screen with an ENet LAN host/join transport layer and manual local IP entry.

## Run in Godot

1. Install Godot 4.x.
2. Import the `godot/` folder.
3. Run `scenes/main.tscn` or press **Play Project**.
4. On desktop: `WASD` move, mouse-right drag or arrow keys look, left mouse fires, right mouse aims, `Space` jumps, `C` crouches, `R` reloads, `Q` swaps, and `B` places cover.
5. On Android, export in landscape. The large touch controls appear automatically.

All world geometry, characters, weapons, UI, iconography, materials, particles, and effects in this prototype are generated from GDScript and Godot primitives. No external asset license is required.

## Android export

`export_presets.cfg` contains the Android package identity:

- Package: `com.blockstrike.royale`
- Version: `0.1.0` / code `1`
- ARMv7 and ARM64 enabled
- Landscape, immersive mode, OpenGL/Compatibility renderer
- Internet and local-network permissions declared for the LAN transport layer

To create an APK, configure an Android SDK, JDK 17, and matching Godot 4 export templates, then run:

```bash
godot --headless --path godot --export-debug "Android" build/BlockStrikeRoyale-debug.apk
```

The current Arena environment did not provide Godot, the Android SDK/JDK, or export templates, so an APK was **not** claimed or checked in. The export preset is configuration only until those tools are installed. Do not treat the web PWA in the repository root as the Android game.

## Networking status — intentionally explicit

`network_manager.gd` implements ENet LAN host/join/disconnect status and room player-list signals. It does not yet synchronize authoritative movement, weapons, loot, teams, or match results. Internet matchmaking, accounts, ranked service, room-code backend, anti-cheat, NAT traversal, and a dedicated authoritative server still need to be deployed and tested. The UI labels these paths as experimental instead of pretending they are live.

## Unfinished feature list

This is the first working prototype milestone, not a claim that every requested live-service feature is complete. The next passes still need full 32-player server replication, real Solo/Duo/Squad team rules, Clash Squad round/purchase logic, 2v2 round scoring, a spectator camera, supply drops, healing animations, a server-backed friends/custom-room service, achievements/weekly seasons, more maps, authored texture/audio packs, device FPS profiling, and signed APK verification on real Android hardware.

Recommended next milestone:

1. Create a headless Godot server scene with server-only world simulation.
2. Move player input validation, hitscan, loot, safe-zone state, and result calculation to that server.
3. Add RPC snapshots/interpolation and disconnect recovery.
4. Add a hosted matchmaking/auth service before enabling ranked or public room codes.

## Project map

```text
godot/
├── project.godot
├── export_presets.cfg
├── scenes/main.tscn       # boot scene
├── scenes/player.tscn     # reusable player scene
├── scenes/bot.tscn        # reusable bot scene
├── assets/icon.svg
└── scripts/
    ├── main.gd              # match lifecycle, rendering, effects, rewards
    ├── voxel_world.gd       # procedural arena and build blocks
    ├── player.gd            # third-person controller and weapons
    ├── bot.gd               # offline combat AI
    ├── safe_zone.gd         # shrinking Battle Royale circle
    ├── pickup.gd            # ammo, armor, medkit pickups
    ├── block_factory.gd     # reusable procedural voxel primitives
    ├── hud.gd               # menus, mobile controls, HUD, shop/progression panels
    ├── game_state.gd        # local save, weapons, cosmetics, XP and missions
    ├── audio_manager.gd     # generated weapon, impact and victory sounds
    ├── network_manager.gd   # LAN transport boundary; no fake online service
    ├── virtual_joystick.gd
    ├── look_pad.gd
    └── minimap.gd
```

## Performance notes

The Compatibility renderer is selected for Android. The map uses large ground meshes, simple box materials, low-poly procedural details, no runtime texture downloads, and a finite build-block cap. The settings panel exposes Low/Medium/High for the next optimization pass. Actual 30 FPS results must be measured on the target 2–4 GB devices; this repository does not claim a device benchmark without the devices.
