# BlockStrike Royale: development status

Last updated: 2026-10-13. Engine target: **Godot 4.7.2-stable**. Language: GDScript (typed where practical).

Legend: ✅ done and tested · 🟡 partial or untested on target · ⬜ not started

## Phase 1: foundation (current scope)

| Item | Status | Notes |
|---|---|---|
| Original voxel map (Emerald Island) | ✅ | Deterministic generation, 7 landmarks, up to 12 spawn points, boundary walls. Verified by data tests and physics probes. |
| Controllable voxel character | ✅ | Procedural rig, 11 animation states, step-up, crouch headroom check, water slowdown. |
| Third-person camera | ✅ | Spring arm, settings, aim zoom. Camera placement is not visually verified (no rendering in build environment). |
| Android touch controls | 🟡 | Multi-touch logic tested headless with synthetic touch events. **Not tested on a real device.** Feel, sizes and safe-area handling are unverified. |
| One working weapon | ✅ | Pulse Carbine: spread, recoil, falloff, headshot, reload, dry fire. Damage and fire cooldown tested; falloff, reload and recoil not directly tested. |
| Hit detection | ✅ | Ray and hit tests against world geometry and actors. Wall blocking and line-of-sight tested. |
| Health and elimination | ✅ | Armour absorption, lethal damage, no double death, respawn, fall-out elimination. |
| Basic bot / target | ✅ | Three difficulties. Acquires, aims, fires, strafes, searches. Tested to acquire and fire within the test window. |
| Pause menu | ✅ | Resume, settings, layout edit, return to menu. Escape pause/resume and Return to menu tested end to end. Android back and focus-loss pause are implemented but not verified on a device. |
| Return-to-menu flow | ✅ | Title → Training Ground → pause → Return to main menu. Tested end to end with real button and key events. |
| Android export configuration | 🟡 | `export_presets.cfg` written (arm64, debug). **No APK built**: export templates and Android SDK cannot be downloaded in the build environment. |
| Settings persistence | ✅ | Validation, clamping, unknown-key rejection, corrupt-file recovery tested. |
| No fake controls | ✅ | Test verifies every enabled control on the title, pause and match menus has a handler. Unbuilt modes are shown disabled. |

### Phase 1 report

**Files created:** the whole `blockstrike/` project (see README "Layout"). Key files:
`project.godot`, `export_presets.cfg`, `data/*.json`, `scripts/**` and `tests/**` (32 GDScript files in total), `scenes/**` (7 scenes), `tests/run_tests.gd`, `tests/flow_driver.gd`, `tests/flow_launcher.gd`, `tools/run_tests.sh`, `README.md`, `STATUS.md`.
**Files modified:** none outside `blockstrike/`. The existing Three.js racing game is untouched.

**Tests run (headless, Godot 4.7.2 built from source for the sandbox):**
- `tests/run_tests.gd`: **81 checks, 81 passed**, across 4 consecutive runs.
- `tests/flow_launcher.gd` / `flow_driver.gd`: **13 checks, 13 passed**, across the same runs.
- Import and whole-project parse check: clean. Every `.gd` file parses.
- Main scene headless run for 180 frames: no script errors.

Test coverage is logic, data, physics and UI wiring. It does **not** cover visuals, frame rate on phones, touch feel, audio output, or Android export.

**Bugs found and fixed during Phase 1:**
- Terrain geometry and collision were offset by each chunk's own origin, so most of the island was rendered and collided in the wrong place. The fix was made in `chunk_mesher.gd`, and a regression test checks the physics ground height across 40 sampled columns.
- Bot firing and acquisition tests were flaky because the duel position was random. The test now finds a flat, unobstructed duel area deterministically.
- HUD elimination text was parented twice, so it would not have appeared.
- A wall-hop in the bot fired every frame while a wall was ahead. It now has a cooldown.
- A few GDScript type-inference errors (`:=` from Variant values) were fixed; this engine build reported them as errors.

**Known bugs and limitations:**
- Not verified visually: the sandbox has no display or GPU, so camera framing, colours, lighting, shadows, HUD layout and touch button placement are unchecked.
- Not verified on Android hardware, and the APK has not been built.
- Performance on phones is unknown. The full island is built on start with a loading screen; the desktop build takes a few seconds in the headless test.
- Only one map, one weapon and one bot mode (training); there is no win condition, scoring beyond kills and deaths, or match timer.
- Touch "Edit layout" runs live, so the match is not paused while editing.
- Bots navigate by waypoints and simple wall-hops; there is no navigation mesh.
- Music is not included; sound effects are synthesised placeholders.
- Keybinding customisation is not available.

**External dependencies:**
- Godot 4.7.x (editor and, for Android, export templates).
- For Android export only: Android SDK, NDK and JDK, configured by the developer.
- No server, accounts or third-party assets.

**Sandbox build note:** the editor binary used for testing was built from the Godot 4.7.2 source in headless mode (no display, no audio, no D-Bus). This build is for tests and does not reflect a standard release editor.

**Next steps:**
1. Install export templates and the Android SDK/NDK/JDK locally, export the debug APK, and install it on a phone.
2. Play-test touch controls on a phone in landscape: button sizes, safe areas, multi-touch, layout editing.
3. Check performance and adjust chunk view distance and graphics presets on a phone.
4. Begin the next phase (not started).

## Later phases (not started)

| Area | Status |
|---|---|
| Battle Royale mode (shrinking zone, loot, lobby) | ⬜ Not started |
| Clash Squad mode | ⬜ Not started |
| 2v2 mode | ⬜ Not started |
| Custom rooms | ⬜ Not started |
| LAN multiplayer | ⬜ Not started (needs networking layer; no server) |
| Internet multiplayer | ⬜ Not started. **No server is configured.** |
| Authoritative server-side damage and currency | ⬜ Not started. Current damage is local to the offline match. |
| Shop and cosmetics | ⬜ Not started (shop screen is shown disabled) |
| Progression and economy | ⬜ Not started |
| Additional weapons | ⬜ Not started (data-driven `data/weapons.json` ready for more) |
| Additional maps | ⬜ Not started |
| Music and extended audio | ⬜ Not started |
| Release Android build and store listing | ⬜ Not started |
