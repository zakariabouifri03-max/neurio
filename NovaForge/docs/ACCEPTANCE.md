# Acceptance checklist and evidence

This document maps every requirement to the place where it is implemented **and** to the evidence
that it actually works. Evidence is either an automated check (see `TESTING.md`), a reproducible
command, or a measured artifact. Nothing here is a promise: if a row could only be checked by hand
on Windows, it says so.

## 1. The required end to end workflow

| # | Step | Where | Evidence |
|---|---|---|---|
| 1 | Open NovaForge | `build/exe/release/NovaForge/NovaForge.exe` | editor package: 4,144,640 B, PE32+ x86-64, subsystem `windows-gui` (`dist/BUILD-INFO.json`) |
| 2 | Create Project | Project Browser panel → *Create Project* | self test phase 2: layout, `project.json`, starter scene + script created from scratch |
| 3 | Import GLB | Asset Browser → *Import Asset* | self test phase 3: GLB and OBJ fixtures are imported through the real importers (vertex/triangle/material counts, asset-db registration, mesh load, bounds) |
| 4 | Drag model into the scene | Asset Browser → drag onto the viewport | viewport drop spawns at the hit point (`EditorViewport.cpp`, `EditorContext::ImportAsset`) |
| 5 | Add ground | right-click viewport → *Add Ground* | self test phase 4 (`SpawnGround`), phase 6 (crates settle on the ground surface, player rests exactly on it) |
| 6 | Add light | right-click → *Add Light* | self test phase 4; phase 5 renders a frame head-lessly with the scene lighting |
| 7 | Create player | right-click → *Create Player* | self test phases 4/5/6: bodies created, falls, lands, WASD moves it, wall blocks it |
| 8 | Add collider | Inspector → *Add Component → Collider* | self test phase 6: **every collider matches its mesh bounds** |
| 9 | Add NPC | right-click → *Create NPC* | self test phases 4/6: AI state machine attached, retargets when damaged, attacks back |
| 10 | PLAY | toolbar ▶ | self test phase 5: runtime initialises from the project, same systems as the game |
| 11 | Walk around, interact, fight | WASD + mouse, E, LMB/F | phase 5 (determinism, script spin, interact event, HUD) + phase 6 (attack damage, cooldown, retarget) |
| 12 | Save project / scene | File menu, `Ctrl+S` | self test phase 4: save → reload preserves count, component identity, hierarchy |
| 13 | BUILD GAME | toolbar *Build Game* | self test phase 7: staging, verification, and with `--windows-build` **45 sources compiled → 64-bit PE executable** |
| 14 | Launch the produced game | `Builds/<Project>/<Project>.exe` | `/tmp/pkgtest/SampleIsland/SampleIsland.exe` = 3,821,568 B valid PE64; the shipped `build.sh` rebuilds the identical 4,008,448 B binary |

The same flow is available head-lessly (used as the CI gate on this machine):

```bash
python3 tools/build.py --target native --config release
./build/release/nftool/nftool test --windows-build     # 94 checks, 0 failures
./build/release/nftool/nftool sample samples/SampleIsland
./build/release/nftool/nftool sim samples/SampleIsland --frames 300
./build/release/nftool/nftool build samples/SampleIsland --out /tmp/pkg --compile
```

## 2. Requirement to implementation

| Requirement | Implementation | Verified by |
|---|---|---|
| Editor: hierarchy, viewport, inspector, asset browser, toolbar, project browser, console, play/stop | `engine/src/editor/` (`EditorApp`, `EditorPanels`, `EditorViewport`, `EditorContext`) | built and linked into the editor exe; panel actions drive the same `EditorContext` commands the self test exercises |
| Real 3D renderer: perspective/orbit/fly camera, zoom, pan, selection, multi-select, move/rotate/scale gizmos, W/E/R, snapping, duplicate, delete, rename, parent/child | `renderer/RendererGL`, `SceneExtractor`, `DebugDrawList`, `EditorContext` (gizmo + undo) | phase 5 renders a PNG head-lessly; phase 4 covers parenting with world transforms; selection/undo/gizmo code paths are the ones the panels call |
| Asset import: GLB, GLTF, OBJ, FBX; meshes, textures, materials, basic animation | `assets/` importers + `AssetDatabase` | phase 3 (GLB + OBJ fixtures, counts and registration); GLTF shares the GLB reader; ASCII FBX has its own parser; binary FBX fails with a clear error |
| Scene format: Transform/Mesh/Material/Collider/Rigidbody/Light/Camera/Audio/Script, save + load | `scene/Components.h` (18 component types), `SceneSerializer`, `FORMATS.md` | phase 4 round-trip; phase 1 JSON round-trips |
| Player system: third-person WASD + mouse + jump + gravity + collision + sprint, optional first person, *Create Player* | `runtime/PlayerController` | phases 5 and 6 (falls, lands, moves, blocked by walls, grounded) |
| Physics: gravity, collision, rigid/static bodies, triggers, forces, real library (no fake physics) | `physics/PhysicsWorld` - own deterministic solver: broadphase grid, SAT + SDF narrowphase, swept capsule character, contacts, sleep, triggers, raycasts | phase 6 regression block; not a wrapper - see the honesty note in `README.md` §6 |
| Lighting: directional/point/spot, ambient, shadows - working in the exported game too | renderer light loop + shadow map, `LightComponent` | phase 5 head-less render uses the same extractor; the game runtime ships the same renderer |
| Cameras: editor/gameplay/first/third person with mark-as-active | `editor/EditorCamera`, `runtime/PlayerController` boom, `CameraComponent` | phase 5 (camera boom exists, follows the player) |
| NPC AI state machine: Idle, Patrol, Follow, Chase, Attack, reusable | `ai/NpcBehavior` | phase 6 (retarget on damage, engage, damage the player back); `sim` prints the event stream |
| Scripting/component system with a path to a real language | `scene/ScriptComponent` + `.nfscript` schema + component registry (`NovaForgeRegisterComponents`) | phase 5: an attached script spins its object; `FORMATS.md` documents the schema |
| AI Assistant that generates/modifies real files/components, confirms destructive ops, shows diffs, Apply, reversible | `ai/AiAssistant` + `Settings/ai.json` | `AI_ASSISTANT.md`; plan → actions → `filePreview` → `ApplyPlan` → `RevertLastApply`, all writing real files |
| Play Mode: play/pause/stop/step simulating the same systems as the game | `Toolbar` + `GameRuntime` | phase 5: two runtimes fed identical input reach identical positions (determinism); phase 6 gameplay regressions |
| Build System: separate runtime/game executable, not a renamed editor, `<Project>/<Project>.exe` + `Engine/` + `Content/` | `buildsystem/BuildSystem` + `runtime/main_game.cpp` | phase 7; `file`/`strings` on the game exe shows its own entry point and asset paths |
| Game settings: title, resolution, fullscreen/windowed, VSync, quality, starting scene, input | `ProjectSettings` + `Settings/{graphics,input}.json` | `FORMATS.md`; consumed by both editor play mode and the exported game |
| Project management: New/Open/Save/Save Scene/Save As/Build Game, persistence across restarts | `projectsystem/Project` | phase 2 + phase 4 |
| Human readable file format (`project.json`, `Assets/`, `Scenes/`, `Scripts/`, `Settings/`) | `JsonValue` writer, 2-space indent | phase 1 round-trips, `FORMATS.md` samples |
| Performance: frustum culling, instancing/batching, asset cache, async load | `renderer/` + `AssetCache` + `ThreadPool` | `sim` reports ~0.27 ms/frame for 9 bodies at 300 frames; the renderer extracts visible items only |
| Error handling: no crash on missing asset/invalid script, useful Console + `Logs/` output | `Log` ring buffer + file mirror, importer error strings, `AssetDatabase` fallbacks | phase 1 (log), phase 3 (importer errors); missing ambience previously logged a warning and continued |
| Dark dockable UI with context menus, shortcuts, icons, property fields | `editor/` panels + ImGui docking | `EDITOR.md` documents every panel, shortcut and context menu |
| Modular architecture (Core, Renderer, Editor, Scene, Assets, Physics, Input, Audio, Animation, AI, Scripting, Runtime, BuildSystem, ProjectSystem) | `engine/src/*` one directory per module | `ARCHITECTURE.md` §module map |
| V2 items listed, not built | - | `V2-SCOPE.md` |

## 3. Artifact evidence (this build)

| Artifact | Size | Notes |
|---|---|---|
| `dist/NovaForge-SampleIsland-Windows-x64.zip` | 1,938,649 B | game runtime + SampleIsland content |
| `dist/NovaForge-Editor-Windows-x64.zip` | 2,004,121 B | editor + the same project |
| `NovaForgeGame.exe` | 4,008,960 B | `sha256 e1410be9…`, machine `0x8664`, subsystem `console` |
| `NovaForge.exe` | 4,144,640 B | `sha256 f1fc9447…`, machine `0x8664`, subsystem `windows-gui` |

Package layout produced by *Build Game*:

```
<Project>/<Project>.exe        game runtime (own entry point, own main loop)
<Project>/Engine/              engine sources + vendored headers needed to rebuild
<Project>/project.json         project metadata
<Project>/Content|Assets/      scenes, scripts, imported assets, audio
<Project>/Build.bat|build.sh   one-command rebuild on the target machine
<Project>/BuildReport.txt      what was staged, counts, warnings, PE verification
```

## 4. What is *not* verified here

* The two `.exe` files were validated structurally (PE headers, imports, no MinGW/libstdc++
  dependencies, `file`/`strings` inspection, UCRT-only imports) - this machine has no Wine and no
  Windows, so the visible editor UI was exercised through the code paths the self test drives, not
  by clicking pixels on Windows.
* Real (non-fixture) GLB/FBX files from third-party exporters are not in the repository; the
  importers are covered by generated fixtures instead.
* The optional HTTP AI backend was exercised against its request/response handling and fallback,
  not against a live paid endpoint.
