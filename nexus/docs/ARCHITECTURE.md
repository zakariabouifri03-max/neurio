# NEXUS GAME STUDIO — Architecture

## Module layout

```
nexus/
├── Engine/                  # The game engine (no editor dependencies)
│   ├── core/
│   │   ├── types.ts         # All data structures: ProjectData, SceneData,
│   │   │                    #   GameObjectData, ComponentData, AssetData, Vec3…
│   │   │                    #   + pure helpers (findObject, subtree, cloneData…)
│   │   ├── registry.ts      # Component registry: 31 defs with defaults +
│   │   │                    #   Inspector schemas (field types, ranges, enums)
│   │   ├── ops.ts           # Pure scene/project mutations (add/remove/duplicate
│   │   │                    #   objects, components, prefabs, scripts, scenes,
│   │   │                    #   materials) + validateProject
│   │   ├── events.ts        # editorBus (typed pub/sub) + engine events
│   │   └── math.ts          # vec math, color, easing, formatBytes…
│   ├── render/renderer.ts   # NexusRenderer: three.js WebGL2, PBR materials,
│   │                        #   shadow maps, env lighting, fog, tone mapping
│   ├── physics/physics.ts   # PhysicsWorld: cannon-es wrapper — bodies from
│   │                        #   component data, triggers, heightfields,
│   │                        #   raycasts (with skip), contact events
│   ├── runtime/
│   │   ├── object.ts        # RuntimeObject / RuntimeComponent: live scene graph
│   │   ├── game.ts          # GameRuntime: instantiateScene, fixed-step update,
│   │   │                    #   player controllers, camera modes, HUD, save/
│   │   │                    #   load, runPlaytest harness
│   │   ├── assetresolver.ts # AssetData → three.js resources (models, textures,
│   │   │                    #   audio), embedded (base64) or server files
│   │   ├── input.ts         # keyboard/mouse/pointer-lock input abstraction
│   │   └── main.ts          # nexusBoot(): standalone game entry (builds a
│   │                        #   GameRuntime from window.NEXUS_GAME)
│   ├── scripting/runtime.ts # compileScript sandbox (new Function + PROLOGUE),
│   │                        #   error line locator, @prop parser, Nexus API
│   ├── visualscript/interpreter.ts  # node graph interpreter (exec + data pins)
│   ├── terrain/terrain.ts   # heightfield generation (island), brushes,
│   │                        #   splat colors, encode/decode, mesh building
│   ├── gameplay/            # Health, Damage, Pickup, Inventory, Door, Trigger,
│   │                        #   Weapon, Projectile, Spawner, Checkpoint,
│   │                        #   Interactable, DayNightCycle, SaveSystem, NPC…
│   ├── animation/           # Animator + locomotion state machine
│   ├── audio/               # positional audio, music, SFX
│   └── ui/hud.ts            # HUD renderer + UI document templates
├── Editor/                  # The editor app (uses Engine, never used by Engine)
│   ├── main.ts / app.ts     # entry + application shell (menus, toolbar, panels,
│   │                        #   commands, play mode, build flow, toasts)
│   ├── store.ts             # EditorStore singleton: project state, undo/redo,
│   │                        #   selection, play state, console, problems
│   ├── viewport.ts          # edit-mode scene graph + orbit + gizmos + terrain
│   │                        #   sculpting + play-mode hosting + stats overlay
│   ├── layout.ts            # DockLayout: zones, splitters, tab docking,
│   │                        #   localStorage persistence
│   ├── panels/              # hierarchy, inspector, assets, console/problems/
│   │                        #   output/profiler, aipanel
│   ├── scripteditor.ts      # CodeMirror script editor + visual script graph UI
│   ├── dialogs.ts           # modal system + new project / create-with-AI /
│   │                        #   build / snapshots / AI settings dialogs
│   ├── commands.ts          # command registry + shortcuts + palette
│   ├── ai-bridge.ts         # drag-drop asset→scene, AI asset assistant,
│   │                        #   prefab-from-selection, window drop hooks
│   └── home.ts              # project hub / template gallery
├── AIAgent/                 # The AI layer
│   ├── tools.ts             # 27 agent tools operating on the store via Engine ops
│   ├── planner.ts           # deterministic intent routing + game plans
│   ├── memory.ts            # indexed project memory (retrieval, not full dumps)
│   ├── debugger.ts          # diagnosis engine → apply fixes → test plans
│   ├── agent.ts             # Agent: event stream, plan execution, review gates
│   └── llm.ts               # llmToolLoop: OpenAI-style tool calling
├── BuildSystem/pipeline.ts  # 8-stage packaging pipeline (see BUILD_SYSTEM.md)
├── Server/index.ts          # Express: REST API + static hosting + LLM proxy
├── Templates/index.ts       # 7 project builders incl. Island Survival
├── Electron/                # desktop shell + Windows packaging
└── tests/                   # vitest suite + headless boot test
```

## Data flow

**Editing.** Every mutation goes through `Engine/core/ops` (pure functions on
`ProjectData`). The editor wraps them with `store.pushUndo(label)` +
`store.markDirty()` + `editorBus.emit('sceneChanged', …)`. Panels listen to the
bus and re-render themselves — no ad-hoc coupling between panels.

**Playing.** `Viewport.enterPlayMode()` snapshots the scene data, builds a
`GameRuntime` from it (`instantiateScene`), swaps the edit scene graph for the
runtime one, and hands the render loop over to the runtime's fixed-step update.
On stop, the edit graph is restored — play-mode changes never leak into edits.

**The same `GameRuntime` class powers the standalone build** — `Engine/runtime/
main.ts` boots it from the embedded `window.NEXUS_GAME` payload. What you test in
the editor is what ships.

**AI.** `Agent.chat(text)` → `planFromText` (deterministic routing for known
intents) → structured `Plan` with steps that call **tools** (`AIAgent/tools.ts`,
real `Engine/core/ops` mutations). If an LLM is configured, free-form requests
are routed through `llmToolLoop` (OpenAI-style tool calls, executed against the
same tool set). Destructive/multi-file plans raise a **review dialog** before
executing. The debugger path (`diagnoseGameplayBug` / `diagnoseProblem`) produces
`Diagnosis` cards with `apply()` functions and `testPlan`s — the editor runs the
playtest automatically after applying.

## Component registry

`Engine/core/registry.ts` is the single source of truth for component metadata:

```ts
defineComponent({
  type: 'Health', label: 'Health', category: 'gameplay', icon: 'heart',
  description: '…',
  defaults: () => ({ maxHealth: 100, startHealth: 100, … }),
  schema: [ n('maxHealth', 'Max Health', 100, 1, 100000, 1), … ],
});
```

The Inspector renders any registered component from its schema; the AI agent's
`modify_component` tool validates against the same defaults; templates build
components through the same `createComponentData`. Adding a component type = one
`defineComponent` + (if it has behavior) a runtime class in `Engine/gameplay/`.

## Scripting sandbox

`compileScript(id, name, source, apiFactory)` wraps user code:

```
PROLOGUE  — const Nexus = apiFactory(onProblem);
USER CODE — verbatim (classes extending Nexus.Component)
EPILOGUE  — return ClassName;
```

- Syntax errors carry **exact lines**: V8 gives no location for `new Function`
  syntax errors, so the runtime prefix-scans the source (first line-prefix whose
  compile error message equals the full source's message = the offending line).
- Runtime errors inside hooks are captured via `safeHook` → `ScriptProblem`
  {file, line, message} → Problems panel → click opens the script at the line →
  **Fix With AI** feeds the problem to the debugger.

## Undo/snapshots

- `store.pushUndo(label)` deep-copies scenes + scripts + assets + UI documents +
  recipes + variables. Ctrl+Z / Ctrl+Y walk the stack.
- Server-side snapshots (`POST /api/projects/:id/snapshots`) copy project.json +
  Content/ into `.snapshots/<id>/` with a meta entry; restore auto-snapshots the
  current state first.
- Every save writes a rolling backup (`.backups/`, last 10) on the server.

## Performance notes

- Panels re-render on demand (bus events), not on a timer.
- Asset thumbnails are generated once at import (three.js render → dataURL) and
  cached in asset meta.
- Play mode uses fixed-step physics (60 Hz, 4 substeps) decoupled from render.
- The profiler panel samples the real renderer stats (draw calls, triangles) and
  runtime timings (update ms, physics ms).
- The standalone build inlines everything into one HTML (offline, zero requests);
  large binaries beyond the embed budget are copied to Content/ instead.
