# Testing & verification

Everything below is reproducible; CI artefacts are committed to `docs/ci/` and `docs/screenshots/` by
`.github/workflows/blockstrike-android.yml`.

## 1. Automated headless suites (run in CI on every push)

| Suite | What it checks |
|---|---|
| `parse` | Every GDScript file compiles (40 scripts) with the autoload singletons available. |
| `sim` | Unit tests (voxel collision, landing, 1-block auto-step, walls, DDA raycasts, head/body hitboxes, LAN room-code and input codec round trips, inventory rules) **plus complete bot-only matches** of Battle Royale Solo + Squad (32 bots), Clash Squad (3 seeds) and 2v2 Arena on the authoritative server code, and a Training Ground session. Every match must finish with a winner; BR must see every bot leave the plane, bots must loot and the zone must progress. |
| `world` | World generation + meshing timings for all four maps. |

Measured on the CI VM (one 30 Hz server tick): ~0.2 ms (Arena) to ~1.0 ms (BR, 32 bots) on average, worst
ticks ~5-12 ms. Cubic Isle generates in ~0.55 s and meshes 256 chunks (~180k quads) in ~2.3 s on one thread
of a debug build; on devices the meshing runs on all cores via WorkerThreadPool.

## 2. Real network tests (run manually in the development sandbox)

These start real processes talking ENet over UDP on localhost:

* `suite_net` against a headless dedicated server (`-- --server --port=7790`):
  1 client creating an Arena room - connected, room created, match started, the client moved 45 m under
  client-side prediction with only 2 unacknowledged inputs, received hits/kills/inventory events and saw remote
  actors moving (RTT shown ~33 ms).
* 2 clients + 6 bots in a server-hosted Clash Squad room (client B joined with the 6-letter room code):
  both clients saw identical state (8 actors, same 24 hits / 6 kills).
* `suite_lanhost` + `suite_net --lan=CODE`: a LAN host (server + player in one process) and a client joining with
  the IP-encoded LAN room code; the client's inputs moved its character ~25-29 m on the host. Host shutdown was
  detected by the client, which returned to the menu with a "connection lost" notice.

Not tested: real phones on a real Wi-Fi network (LAN broadcast discovery needs a real network; the sandbox
only has loopback), internet play through NAT, more than 2 human clients at once.

## 3. Android APK (CI)

* Export with the official Godot 4.7.2 Android templates; `apksigner verify` passes (v2 + v3 signatures),
  `aapt` shows `com.blockstrike.royale`, minSdk 24, targetSdk 36, native code arm64-v8a + armeabi-v7a + x86_64,
  permissions INTERNET, ACCESS_NETWORK_STATE, ACCESS_WIFI_STATE, CHANGE_WIFI_MULTICAST_STATE, VIBRATE. ~79 MB.
* Android emulator (API 30, x86_64, AOSP image, SwiftShader software GPU): `adb install` = Success, the app
  launches, stays alive, and a scripted tap on START runs an offline Battle Royale Squad match with 32 actors.
  The game's own `[perf]` log lines report **13-17 FPS on the software-emulated GPU** (Low preset); real phone
  GPUs are far faster, but **no real phone was available to measure**.
* Known emulator-only warning: SwiftShader exposes only 261 fragment uniform vectors and Godot reports that some
  scene-shader variants exceed it. The project lowers `max_lights_per_object` to 2 and uses no dynamic
  lights in effects to minimise this; the game still renders and runs on the emulator.

## 4. Rendering + benchmark (CI, Mesa llvmpipe, no GPU)

`--autoplay=tour` captures every menu and scripted moments of every mode (see `docs/screenshots/`).
`--autoplay=bench` measures each quality preset in a 32-player BR match (`docs/ci/benchmark.md`):

| Preset | Draw calls | Triangles / frame | Static memory |
|---|---|---|---|
| Low | ~70-160 | ~20k-48k | ~80 MB |
| Medium | ~90-240 | ~49k-110k | ~80 MB |
| High | ~200-230 | ~130k-155k | ~80 MB |

(The FPS column there is CPU rasterisation and is not representative of phones.)
These budgets fit mid-range and low-end GLES3 phones (2-4 GB RAM) on the Low/Medium presets.

## How to run locally

```bash
cd blockstrike
godot --headless --path . res://tests/test_runner.tscn -- --suite=parse
godot --headless --path . res://tests/test_runner.tscn -- --suite=sim
# network (two terminals)
godot --headless --path . -- --server --port=7790
godot --headless --path . res://tests/test_runner.tscn -- --suite=net --port=7790 --mode=arena_2v2
```
