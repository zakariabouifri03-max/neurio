# Architecture

## Design rules

1. **One engine library, two programs.** `libnfengine.a` contains scene, renderer, physics, AI,
   scripting, audio, assets, runtime, project system, build system and the AI assistant. The
   editor (`NovaForge.exe`) and the exported game (`<Project>.exe`) are thin entry points on top
   of it. The exported game is therefore *not* a renamed editor: it links no editor panel code and
   contains no editor UI.
2. **No fake anything.** Systems either work or are labelled "Not implemented in V1" (see
   `V2-SCOPE.md`). The build system fails loudly, asset import reports real counts, physics is a
   real solver, and the AI assistant only reports changes it actually wrote to disk.
3. **Deterministic simulation.** Gameplay runs on a fixed step (`RuntimeConfig::fixedTimeStep`,
   default 1/60) with a bounded accumulator, so the editor's play mode, the headless test harness
   and the exported game all produce identical results from identical input.

## Module map

| Module | Key types | Notes |
|---|---|---|
| `core` | `Vec2/3/4`, `Mat3/4`, `Quat`, `AABB`, `Ray`, `JsonValue`, `Log`, `fs`, `ThreadPool` | header-light math, column-major matrices, quaternions throughout the scene graph |
| `scene` | `Scene`, `GameObject`, `ComponentBase`, `ComponentRegistry`, `SceneFactory`, `SceneSerializer` | entities are 64-bit ids; transforms are cached per object and invalidated through `MarkTransformDirty`; every transform write refreshes the world cache so an immediate read is correct |
| `physics` | `PhysicsWorld`, `CollisionShape`, `PhysicsBody`, `BodyDesc` | AABB broadphase grid, swept tests for discrete movement, OBB SAT for box/box, signed-distance sampling for capsules/spheres/boxes |
| `renderer` | `Renderer`, `RendererGL`, `SoftwareRasterizer`, `SceneExtractor`, `DebugDrawList` | OpenGL 3.3 core via an in-repo loader; scene extraction produces sorted opaque/transparent draw items with batch keys; headless mode uses the software rasterizer to produce PNG frames |
| `assets` | `AssetDatabase`, `Model`, `Mesh`, `Material`, `Texture`, `AnimationClip` | importers for GLB, GLTF, OBJ, ASCII FBX; asynchronous load queue pumped from the runtime loop |
| `audio` | `AudioSystem`, `AudioSourceComponent` | miniaudio device, 3D voices with attenuation, listener follows the active camera, relative paths resolve through the audio content root, missing clips fall back to a generated tone and a warning |
| `animation` | `AnimatorComponent`, `AnimationSystem`, `Skeleton` | clip playback, cross-fade, pose sampling for skinned meshes |
| `ai` | `NpcBehavior`, `AIComponent`, `MoveCharacter` | explicit state machine (Idle, Patrol, Follow, Chase, Attack, Flee, Dead), perception by distance/LOS flag, patrol routes, attack windup and cooldown; the player and the NPCs share the same character mover |
| `scripting` | `ScriptComponent`, `ScriptSystem`, `.nfscript` | data-driven behaviours invoked from the component update path; triggers fire in a fixed order (TriggerVolume → Door → Script → Pickup) so results are reproducible |
| `runtime` | `GameRuntime`, `PlayerController`, `main_game.cpp` | play/stop/pause/step, fixed-step simulation, save/load, HUD, messages, combat, camera boom, exported-game entry point |
| `editor` | `EditorApp`, `EditorContext`, panels | docking layout, selection, undo (full-scene JSON snapshots), gizmos, asset browser, project browser, build panel, AI assistant panel |
| `aiassistant` | `AiAssistant`, `AiPlan` | natural-language → structured plan → whitelisted file/component actions with preview, confirmation, apply and revert |
| `buildsystem` | `BuildSystem`, `BuildRequest`, `BuildResult` | validate → stage → compile → link → verify → report; also the source of the rebuild scripts |
| `platform` | `Window`, `InputState`, Win32 + null backends | the only place OS APIs are used; the null backend keeps headless tools and tests linkable everywhere |

## Frame flow (runtime)

```
Tick(dt)
  dt clamp (0.1 s max) ─► asset async pump ─► paused/stopped early-out
  SyncPhysicsBodies()          reconcile scene colliders ⇄ physics bodies (stable ids)
  UpdatePlayer(dt)             PlayerController: look → move (shared MoveCharacter) → camera boom
  combat input                 LMB / F → PerformAttack (range + arc + cooldown → ApplyDamage)
  fixed accumulator            UpdateFixed(step) up to 5 sub-steps
  scene.Update(dt)             components: AI, doors, triggers, pickups, scripts, animation
  physics.Step(dt)             integrate, resolve contacts, sleep, trigger events
  physics.SyncToScene(scene)   dynamic bodies write their transforms back
  audio.Update(listener …)
  ProcessRuntimeEvents()       scene events → HUD messages / stats / logs
```

Rendering is host-driven: the editor renders the scene into an offscreen target for the viewport
image and the exported game renders straight to the window, both through `Renderer::RenderScene`
with the same extraction, culling, batching and shadow code.

## Physics design

* Shapes are authored **local** and scaled into world space in one place
  (`ScaleCollisionShape`), so the broadphase bounds and the narrowphase can never disagree - the
  bug class that makes characters sink into floors or crates float above them.
* Broadphase: uniform grid + an explicit "huge objects" list for ground-sized meshes, so a 60×60
  floor does not explode the cell count.
* Narrowphase: OBB SAT (exact minimum translation vector) for box/box, signed-distance sampling for
  capsules, spheres and boxes, bisection refinement inside sweeps.
* Character movement: capsule sweeps with sliding, step-up (≤ 0.55 m), ground probes and skinning;
  the player and NPCs move through the same code path, which is why the AI can navigate the same
  geometry the player collides with.
* Determinism: fixed step, ordered candidate iteration, no randomness in the solver.

## Editor design

* `EditorContext` owns editor state (selection, gizmo mode, undo stack, dialogs, console buffer,
  play/build operations) and exposes a command API so panels stay thin and the AI assistant can
  drive the same operations the UI does.
* Undo/redo stores full-scene JSON snapshots (bounded ring, 100 entries) - simple, correct, and it
  also allows the AI assistant's change sets to be reverted as one unit.
* The AI assistant never edits files directly: it creates a plan of whitelisted actions with a
  preview; the user confirms (destructive actions require an explicit confirmation), applies, and
  can revert the whole set.

## Error handling

* Missing assets, unreadable scripts, unknown component types and unsupported importer features are
  warnings in the Console and in `Logs/Editor.log` / `Logs/Game.log`; the runtime continues with a
  fallback (default material, generated tone, skipped object).
* `Log` keeps an in-memory ring buffer (what the Console panel shows) and mirrors it to the log file.
* `BuildSystem` reports success **only** after package verification; failures keep the staged
  package and produce a report naming the failing stage.
