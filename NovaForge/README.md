# NovaForge Engine

A desktop 3D game engine written from scratch in C++20: a real editor, a real renderer, a real
runtime, and a real build system, delivered as source + build scripts + docs + a sample project +
a downloadable standalone Windows game.

Everything here runs for real. There are no mock screens, no fake progress bars, no placeholder
buttons: every panel, action and system described below is implemented and exercised by an
automated test suite (`tools/nftool/nftool test` - **88 checks**, **94** with the packaged-game
build enabled - currently 0 failures, plus 85 native unit checks in `tests/`).

```
 ┌───────────────────────────── editor (NovaForge.exe) ─────────────────────────────┐
 │ Scene Hierarchy │ 3D Viewport │ Inspector │ Asset Browser │ Console │ AI Assistant │
 └───────────────┬──────────────────────────────────────────────────────┬───────────┘
                 │ same engine library, same systems                    │ Build Game
                 ▼                                                      ▼
        play mode / GameRuntime                              BuildSystem → standalone package
        (physics, AI, scripts, audio,                          <Project>/<Project>.exe
         collisions, HUD, exactly like the game)               project.json + Assets/ + Engine/
```

## 1. Get the playable build (no compiler needed)

| File | What it is |
|---|---|
| `dist/NovaForge-SampleIsland-Windows-x64.zip` | The exported **game**: `NovaForgeGame.exe` (4.0 MB, x64) + the *Sample Island* content. Unpack, double-click, play. |
| `dist/NovaForge-Editor-Windows-x64.zip` | The **editor** (`NovaForge.exe`, 4.1 MB) + the same sample project to open, edit, play and re-export. |

Both executables are statically linked: the only requirements are Windows 10/11 x64 and an
OpenGL 3.3 capable GPU driver. `NovaForgeGame.exe` is the runtime - a different program from the
editor, not a renamed copy - and it loads `project.json` / `Assets/` from its own folder.
In-game controls and command line switches are listed in the package `README.md`.

`dist/BUILD-INFO.json` records size, machine type, subsystem and SHA-256 of both binaries.

**Download from GitHub** (branch `arena/ab4e89c3-neurio` of this repository):

* game runtime: <https://github.com/zakariabouifri03-max/neurio/raw/arena/ab4e89c3-neurio/NovaForge/dist/NovaForge-SampleIsland-Windows-x64.zip>
* editor: <https://github.com/zakariabouifri03-max/neurio/raw/arena/ab4e89c3-neurio/NovaForge/dist/NovaForge-Editor-Windows-x64.zip>
* browsing the files: <https://github.com/zakariabouifri03-max/neurio/tree/arena/ab4e89c3-neurio/NovaForge/dist>

## 2. Build from source

```bash
# Linux / macOS host, native build + tests + headless tools
python3 tools/build.py --target native --config release
./build/release/nftool/nftool test                 # 88 checks: core, import, scene, physics, runtime
NOVAFORGE_ZIG=/path/to/zig ./build/release/nftool/nftool test --windows-build   # 94 checks (adds phase 7: the exported game is compiled and PE-verified)

# Windows executables (cross-compiled with Zig, no MSVC needed)
python3 tools/build.py --target windows --config release
python3 tools/package_windows.py                   # produce the two download packages

# generate the sample project from scratch
./build/release/nftool/nftool sample samples SampleIsland
./build/release/nftool/nftool sim   samples/SampleIsland --frames 300     # headless play test
```

The only build requirement is **Python 3.9+** and a C++20 compiler: `zig` (recommended - one
download, cross-compiles Windows exes from any OS), MSVC, or MinGW g++. See `docs/BUILD.md`.

## 3. The end to end flow the engine is built around

Open NovaForge → **Create Project** → **Import GLB** → drag the model into the scene →
**Add Ground** → **Add Light** → **Create Player** → **Add Collider** → **Add NPC** → **PLAY** →
walk around → interact / fight → **Save** → **BUILD GAME** → the editor writes
`Builds/<Project>/<Project>.exe` → close the editor → launch the game.

Every step of that flow is implemented and covered by the automated suite; the physics and
gameplay steps additionally have dedicated regression checks (colliders matching meshes, the
player standing exactly on the ground, crates settling on surfaces, walls blocking movement,
player attacks damaging NPCs, NPCs retaliating, damage reaching the HUD).

## 4. Modules

| Module | Responsibility |
|---|---|
| `core/` | math (Vec2/3/4, Mat3/4, Quat, AABB, ray), JSON parser/writer, logging with ring buffer, UTF-8 file system, string utils, time, thread pool |
| `renderer/` | OpenGL 3.3 core renderer (WGL, in-repo GL loader), scene extraction, frustum culling, batching/instancing, shadow maps, skybox, debug draw, software rasterizer for headless tests |
| `scene/` | entities, 18 component types, component registry, scene graph with world caching, `.nfscene` serializer, `SceneFactory` (ground/light/player/NPC/door/pickup/trigger/quest/camera/audio) |
| `physics/` | swept-shape physics: AABB broadphase, OBB SAT + signed distance field narrowphase, dynamic/kinematic/static bodies, capsule character mover with step-up and sliding, triggers, contacts, raycasts |
| `assets/` | asset database + cache, GLB/GLTF/OBJ/FBX mesh importers, PNG/JPG texture import (stb), WAV audio import, async loading |
| `audio/` | miniaudio backend, 3D voices, listener, generated-tone fallback, content-root path resolution |
| `animation/` | skeletal pose sampling, glTF animation clips, state playback used by the character controllers |
| `ai/` | NPC state machine (Idle, Patrol, Follow, Chase, Attack, Flee, Dead), perception, patrol routes, character mover shared with the player |
| `scripting/` | script component + `.nfscript` behaviours (spin, bob, rotate, patrol helpers, doors), event system, native module registration (`NovaForgeRegisterComponents`) |
| `runtime/` | `GameRuntime` (fixed-step loop, play/stop/pause/step, save, HUD, messages, combat), third/first person player controller, exported game entry point |
| `editor/` | docking UI: hierarchy, viewport with gizmos, inspector, asset browser, console, project browser, build panel, AI assistant, play-in-editor |
| `aiassistant/` | natural-language planner that edits real project files/components, with preview, confirmation, apply and revert |
| `buildsystem/` | project validation, packaging, source staging, executable compilation, package verification, build report |
| `projectsystem/` | project layout creation, `project.json`, scenes/scripts/settings management |
| `platform/` | Win32 windowing + input + OpenGL context, null backend for headless tools |

## 5. Documentation

| Document | Contents |
|---|---|
| `docs/ARCHITECTURE.md` | module responsibilities, data flow, frame loop, physics/AI/scripting design decisions |
| `docs/BUILD.md` | toolchains, build targets, cross-compiling Windows exes, `Build Game` internals, rebuild scripts |
| `docs/EDITOR.md` | panels, shortcuts, the full acceptance workflow, play mode |
| `docs/FORMATS.md` | `project.json`, `.nfscene`, `.nfscript`, `Settings/*.json`, build output layout, asset metadata |
| `docs/AI_ASSISTANT.md` | how the assistant plans/edits files, configuration, safety model |
| `docs/TESTING.md` | what the automated checks cover, how to run them, how to add more |
| `docs/ACCEPTANCE.md` | the end-to-end acceptance checklist with the verified evidence for each item |
| `docs/V2-SCOPE.md` | deliberately out-of-scope features, V1 limitations, "not implemented in V1" list |

## 6. Honesty notes (V1 limitations)

* The engine targets **single player, desktop, OpenGL 3.3**. Multiplayer, consoles, mobile, VR,
  cinematics tooling, Niagra-style VFX, terrain streaming, world partition, a full animation editor
  and a full Blueprint replacement are **not implemented in V1** and are documented in
  `docs/V2-SCOPE.md`.
* Physics is a purpose-built deterministic solver (AABB broadphase, OBB/SDF narrowphase). It is a
  real solver with mass, restitution, friction, sleep, triggers and contacts - it is **not** Jolt
  or Bullet; complex concave/stochastic stacking is beyond V1.
* FBX import covers the ASCII format and embedded/common geometry; binary FBX shows a clear
  compiler-style error in the Console instead of importing garbage.
* The AI assistant has two provably working modes: an offline rule-based planner (default, no
  network) and an OpenAI-compatible HTTP backend configured in `Settings/ai.json`. If the network
  call fails, the plan falls back to the offline planner - the panel never pretends to have done
  work it did not do.
* `.pdb` debug databases and intermediate object files are intentionally removed from shipped
  packages to keep them lean.
