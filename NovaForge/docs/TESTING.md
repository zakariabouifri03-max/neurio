# Testing

Two suites, both runnable from a fresh clone with no extra tooling.

## 1. Native unit tests (core services)

```bash
g++ -std=c++20 -O1 -Iengine/src tests/TestMain.cpp tests/CoreTests.cpp engine/src/core/*.cpp \
    -o /tmp/nftests_core -pthread && /tmp/nftests_core
# 85 checks: math, JSON parse/write round-trips, string utils, file system, log ring buffer
```

## 2. Engine self test (the important one)

```bash
./build/release/nftool/nftool test              # 88 checks (phases 1-6), ~10 s
./build/release/nftool/nftool test -v           # verbose logging
NOVAFORGE_ZIG=/path/to/zig ./build/release/nftool/nftool test --windows-build
```

`--windows-build` additionally compiles and links an exported game with the in-engine build system
and verifies the resulting PE image (**94 checks** in total - phase 7 adds 6), so the whole
*Build Game* path is exercised end to end on any OS, cross-compiling with Zig.

### What is covered

| Phase | Representative checks |
|---|---|
| 1. Core services | JSON parse/query/write, UTF-8 file IO, log ring buffer + file mirror, time helpers |
| 2. Project creation | `Project::CreateNew` layout (`project.json`, `Assets/`, `Settings/`, scenes, starter script), scene/script listing |
| 3. Asset import | a GLB and an OBJ fixture written by the test itself are imported through the real importers → vertex/triangle/material counts, asset-database registration, mesh load, material slots, bounds sanity |
| 4. Scene building | Add Ground / Light / Player / NPC / Door / Pickup / Trigger, parenting keeps world transforms, save → reload preserves object count, component identity and hierarchy |
| 5. Runtime simulation | runtime initialises from the project, physics bodies are created, the player falls and lands, WASD moves it, camera boom exists, interact creates the expected event, an attached script spins its object, damage reaches health and the HUD, two runtimes fed identical input reach bit-identical positions (determinism), a PNG frame is rendered head-lessly |
| 6. Physics & gameplay regression | **every collider matches its mesh bounds**, crates settle on the ground surface (no floating, no sinking), the player rests exactly on the floor, W walks the player into a wall and the wall blocks it, the player never falls through, attack damages an NPC exactly once, the cooldown prevents repeat damage, the cooldown expires and works again, the damaged NPC retargets and engages, the engaged NPC damages the player back |
| 7. Build system | pipeline reports staged project.json / Assets / Engine sources / BuildReport.txt, package verification passes, and with `--windows-build`: 45 sources compiled, the executable is produced and is a **64-bit PE** (`0x8664`) |

Failures print `[FAIL] <description>` and the process exits non-zero, so the suite is usable as a
CI gate. Nothing in the suite is a stub: every check drives the production code paths.

## 3. Manual acceptance run

The workflow the engine is designed around (also documented in `EDITOR.md`):

1. Launch the editor, **Create Project**
2. **Import GLB** in the Asset Browser, drag the model into the viewport (it spawns at the drop point)
3. Right-click → **Add Ground**, **Add Light**
4. Right-click → **Create Player**, then **Add Collider**
5. Right-click → **Create NPC** (AI state machine attached)
6. **PLAY** → walk around (WASD + mouse), jump, sprint, interact with the gate (E), fight the NPCs (LMB/F)
7. **Save** the scene, press **BUILD GAME**
8. The editor writes `Builds/<Project>/<Project>.exe` and reports the verification result
9. Close the editor and launch the produced `.exe` - it plays the same content with the same systems

Headless equivalents used during development:

```bash
./build/release/nftool/nftool sample samples/SampleIsland     # generate the sample project
./build/release/nftool/nftool sim   samples/SampleIsland --frames 300
./build/release/nftool/nftool render samples/SampleIsland --out /tmp/frame.png --frames 120
./build/release/nftool/nftool build  samples/SampleIsland --out /tmp/pkg --compile
```

## 4. Adding a check

Checks live in `tools/nftool/selftest.cpp`. Add a `Check(condition, "description")` inside the
relevant phase (or a new `Phase("8. …")`) and rebuild `nftool`:

```bash
python3 tools/build.py --target native --config release --only nftool
./build/release/nftool/nftool test
```

Because the exported game build is exercised by the same suite, a regression in the build system or
in the packaging layout fails the suite long before it reaches a user's machine.
