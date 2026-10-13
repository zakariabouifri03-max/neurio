# BLOCKSTRIKE ROYALE

A complete, original 3D **voxel battle royale** made in **Godot 4.4** and designed
for **Android** (touch-first, portrait-free landscape, 30-60 FPS presets), with
desktop play supported for development and testing.

Everything in this repository is original work: the code, the 24-block texture
atlas, the 40 sound effects, the icons and the five maps are all generated or
hand-written for this project (see `docs/ASSETS.md`). No third-party art, audio
or paid plugins are used.

---

## What is playable right now (Phase 1)

| Feature | State |
|---|---|
| Original voxel world, 5 maps, streaming chunks, terrain + landmarks + loot | working |
| Third-person voxel character, procedural animation rig, name tags, cosmetics hooks | working |
| Camera: third-person boom with collision, aim (ADS), FOV/sensitivity settings | working |
| Touch controls: floating stick, look area, 14 action buttons, drag-to-move editor, saved layout | working |
| Keyboard/mouse and gamepad input through the same action set | working |
| 14 weapons (AR, SMG, shotgun, sniper, pistol, LMG, melee, throwables) driven by `data/weapons.json` | working |
| Hit registration: hitscan, pellets, falloff, headshots, armour, melee, explosions, wall blocking | working |
| Health, armour tiers, healing, elimination, kill feed, spectating | working |
| Bots in three difficulty tiers (Easy/Normal/Hard/Expert) with loot, combat, healing and cover use | working |
| Loot: crates, ammo/med boxes, supply drops, pickups, inventory limits | working |
| Modes: Battle Royale (zone), Clash Squad 4v4 (buy phase, first to 4), 2v2 Arena, Training Ground | working |
| Building: limited (BR) and free (Training) placement, walls/floors/stairs, removal | working |
| HUD: health/armour, ammo, crosshair spread, hit markers, kill feed, zone timer, minimap, scoreboard | working |
| Menus: main menu, mode select, loadout, settings, pause, results | working |
| Save system: versioned, checksummed, atomic writes, corruption recovery | working |
| Economy, progression (Bronze to Master) and missions (data layer, screens later) | data layer done |
| Android export presets (debug + release), touch emulation, ETC2/ASTC textures | configured |
| LAN/internet multiplayer, custom rooms, shop screens, ranked | next phases |

The honest current state - including what is *not* implemented - is tracked in
[`docs/DEVELOPMENT_STATUS.md`](docs/DEVELOPMENT_STATUS.md).

## Quick start (desktop)

```bash
# 1. Get Godot 4.4.x (the editor binary is not stored in this repository)
#    https://godotengine.org/download  ->  Godot 4.4.x standard
# 2. Import the project
godot --path . --editor
# 3. Or run the game straight away
godot --path . res://scenes/app.tscn
```

Keyboard: `WASD` move, `Space` jump, `Shift` sprint, `Ctrl` crouch, mouse look,
left click fire, right click aim, `R` reload, `F` interact, `E`/`Q` cycle weapons,
`1-4` slots, `H` heal, `B` build (hold to keep building), `Tab` scoreboard,
`Esc` pause. Touch controls appear on Android and can be used with the mouse.

## Running the tests

The test suite runs inside the engine (it validates the real data files, assets
and gameplay maths):

```bash
tests/run_tests.sh /path/to/godot        # or: godot --headless --path . res://tests/tests.tscn
```

Five suites cover content data, the voxel pipeline, combat maths, economy/save
rules and the touch layout. Exit code 0 means every assertion passed.

## Building for Android

See [`docs/BUILD.md`](docs/BUILD.md) for the exact steps (Android SDK, export
templates, debug APK, signed release). Signing credentials are never stored in
this repository - `export_presets.cfg` intentionally leaves the keystore fields
empty.

## Repository layout

```
blockstrike-royale/
  data/            weapons, items, loot tables, maps, modes, economy, shop, missions (JSON)
  scripts/
    core/          autoload services: config, content DB, save, settings, economy,
                   progression, missions, inventory, match config, audio, network, lobby
    world/         voxel library, chunks, terrain generator, streaming world, ray cast,
                   building service, safe zone, environment builder
    player/        character controller, animation rig, movement, input router, interaction
    combat/        weapon controller/model, damage system, throwables, effects
    inventory/     player inventory, loot pickups, loot containers
    match/         match manager, match scene, player factory
    ai/            bot brains (perception, navigation, combat behaviour)
    ui/            app root, HUD, touch controls, menus
  scenes/          app root, match scene, menu scenes
  tests/           headless test suite (tests.tscn + suites)
  tools/assets/    the asset generators that produced every texture/icon/sound
  docs/            status, build instructions, asset provenance, phase reports
  server/          dedicated server entry point (multiplayer phases)
```

## Licensing

All code and assets in this repository were created for this project and are
released under the MIT licence (see `LICENSE`). Third-party components are listed
in `docs/ASSETS.md` (currently: none - the game engine itself is not vendored).
