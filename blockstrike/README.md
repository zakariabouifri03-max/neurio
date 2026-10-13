# BlockStrike Royale

An original 3D **voxel battle-royale shooter for Android**, made with **Godot 4.7 + GDScript**.
Blocky world and characters, fast mobile gunplay, Battle Royale / Clash Squad / 2v2 Arena / Training,
LAN and online multiplayer with an authoritative server, cosmetics shop and progression.

Everything in the game - characters, weapons, maps, textures, sounds and music - is generated
procedurally by this project's own code, so all content is original. The only third-party asset is the
Lilita One font (SIL OFL 1.1).

> Download: every CI build publishes a signed APK under **GitHub Releases** (tag `blockstrike-v0.3.0-bN`)
> and as a workflow artifact. Install it with "Install unknown apps" enabled.

## Game modes

| Mode | Players | Map | Notes |
|---|---|---|---|
| Battle Royale Solo / Duo / Squad | up to 32 (bots fill) | Cubic Isle 256x256 | plane drop, skydive + parachute, loot, 6-phase shrinking zone, supply drops, knock & revive in teams, spectate |
| Clash Squad 4v4 | 8 | Clash Town | rounds (first to 4), buy phase with credits, escalating loss bonus, round zone |
| 2v2 Arena | 4 | Block Arena | rounds (first to 3), random shared loadouts |
| Training Ground | 1 + bots | Training Ground | respawning weapon racks, static + moving target dummies, add/remove bots, infinite ammo |
| Custom Rooms | 2-32 | any | room codes, LAN discovery, team/ready/ping list, host settings (mode, map, bots, building, difficulty, private), chat, invites |
| Offline | - | any | every mode vs AI bots, no network needed (ranked vs hard bots available) |

## Features

* **Voxel world**: chunked meshes with hidden-face culling and per-vertex ambient occlusion, built on
  worker threads; procedural 16x16 pixel textures in a texture array; island with forests, villages with
  two-storey houses, river, bridges, roads, snowy mountains, a walled military base with towers and a hangar,
  a farm, beaches and a desert town. Deterministic: every peer generates the same world from a seed.
* **Characters**: blocky skinned meshes (8 bones) with procedural animation - walk, run, crouch, jump,
  skydive, parachute, knocked crawl, reload, recoil, melee swing, throw, healing, 8 emotes, victory dances.
* **Weapons** (15): 2 assault rifles, 2 SMGs, 2 shotguns, sniper + DMR, 2 pistols, pickaxe + bat, frag,
  smoke and instant-wall grenades. Each has damage, fire rate, spread/ADS spread, recoil, range falloff,
  magazine, reload time, headshot multiplier, movement speed.
* **Combat**: server-side hitscan with head/body hitboxes, armour (vest/helmet Lv1-3 with durability),
  healing items (bandage, med kit, energy drink with heal-over-time), knockdown/revive, fall damage,
  damage numbers, hit markers, damage direction indicators, kill feed.
* **Building**: place defensive blocks (cube button / B), destroy them with bullets, melee or grenades.
* **Inventory**: 2 primary slots, pistol, melee, throwables, 4 ammo types, meds, armour, blocks;
  auto pick-up of useful items, nearby-loot list, drop items, death drops in BR.
* **Progression**: coins & gems (earned by playing only - no real-money purchases), XP and levels with
  rewards, 3 daily + 3 weekly missions, 10 achievements, ranked leagues (Wood to Royale) with 28-day
  seasons and season rewards, match history.
* **Shop / Locker**: 10 characters, 9 outfits, 9 hats, 6 backpacks, 9 weapon wraps, 8 emotes,
  4 victory dances; daily featured items with discount; 3D preview. Cosmetics are visual only.
* **Mobile UI**: landscape, multi-touch dynamic joystick, camera drag (also while holding fire), left and
  right fire buttons, aim/scope, jump, crouch, reload, heal, build, throw, interact, weapon slots,
  inventory, minimap + full map, emotes, pause; adjustable sensitivity, button size/opacity and a
  drag-to-move **button layout editor**. Keyboard + mouse also supported.
* **Multiplayer**: authoritative server (dedicated or LAN host), client prediction + reconciliation,
  snapshot interpolation, lag compensation, LAN UDP discovery, IP-encoded LAN room codes, matchmaking
  queues with bot fill, ping/packet-loss indicator, bot takeover on disconnect. See [docs/SERVER.md](docs/SERVER.md).
* **Performance**: Low / Medium / High presets with automatic detection by RAM/CPU, resolution scale,
  FPS cap (30-120), view distance, shadows toggle, unlit voxel shader on Low, chunk visibility ranges,
  fog, pooled effects/tracers/labels, cached meshes, ETC2/ASTC texture compression.

## Controls

Touch: left side = movement joystick (push fully to sprint); drag anywhere on the right (or on a fire
button) to look. Buttons: fire (left + right), aim, jump, crouch, reload, heal, build (then fire = place),
throw, interact (pick up / open crate / revive / jump from plane), weapon slots at the bottom, bag,
minimap (tap for full map), emote, pause.

Desktop: WASD, mouse look (click to capture), LMB fire, RMB aim, Space jump, C crouch, Shift sprint,
R reload, F/E interact, 1-5 weapons, Q next weapon, H heal, B build (V or LMB places), G throw,
M map, Tab inventory, T emote, Esc pause.

## Project layout

```
project.godot            Godot project (GL Compatibility renderer, landscape, 1280x720 base)
export_presets.cfg       Android export preset (arm64-v8a, armeabi-v7a, x86_64)
android/release.keystore Project signing key (public dev key - replace for store releases)
scenes/                  boot, main menu, match
scripts/autoload/        DB (data), Settings, Profile, Audio, Net, Game
scripts/core/            blocks, voxel art/shaders, world storage + collision + raycast, mesher, terrain, map generators
scripts/match/           Match (simulation), ModeRules, Actor, BotBrain, views, models, effects, controller
scripts/ui/              theme/widgets/icons, HUD, touch controls, minimap, main menu, panels, rooms
tests/                   headless test runner + suites, CI autoplay (screenshots / benchmark)
tools/                   gen_audio.py (all SFX + music), gen_icon.py (app icon)
docs/                    SERVER.md, CI logs, screenshots, benchmark
```

## Build from source

1. Install Godot 4.7.2 and its export templates; set the Android SDK + JDK 17 paths in Editor Settings.
2. Optional: `pip install numpy soundfile pillow`, then `python3 tools/gen_audio.py` and
   `python3 tools/gen_icon.py` (the generated files are already committed).
3. Open `blockstrike/project.godot`, then Project > Export > Android > Export Project.
   Command line: `godot --headless --path . --export-release "Android" build/BlockStrikeRoyale.apk`

The release preset signs with `android/release.keystore` (alias `blockstrike`, password `blockstrike`).
This key is public; for a store release create your own key and set
`GODOT_ANDROID_KEYSTORE_RELEASE_PATH/_USER/_PASSWORD`.

## Tests

```bash
godot --headless --path . res://tests/test_runner.tscn -- --suite=parse   # compiles every script
godot --headless --path . res://tests/test_runner.tscn -- --suite=sim     # unit tests + full bot matches of every mode
godot --headless --path . res://tests/test_runner.tscn -- --suite=world   # world generation + meshing timings
```

CI (`.github/workflows/blockstrike-android.yml`) runs these, exports and verifies the APK, renders a
screenshot tour and a benchmark with software OpenGL, installs + launches the APK on an Android emulator,
publishes a GitHub Release and commits logs/screenshots to `docs/ci` and `docs/screenshots`.

## Status / known limitations

See the "Status" section at the end of this file (kept up to date with what CI verified).

## Status

* Verified automatically: all scripts compile; complete bot matches of every mode finish with a winner;
  collision/raycast/hitbox/codec/inventory unit tests pass; APK export + signature verification.
* Not verifiable in CI: real-phone frame rates (CI has no GPU), real multi-device LAN/online sessions.
  The networking code paths are shared with the offline game, but have not been play-tested between phones
  by the author - please report issues.
* Online play needs your own dedicated server (docs/SERVER.md); profiles are stored on the device.
