# NEXUS GAME STUDIO

**An AI-powered 3D game development environment.** Idea → AI generation → 3D scene → gameplay → testing → debugging → build → standalone game.

This is a **real, working** environment — not a mockup. Every button does something:
the renderer renders, the physics simulates, scripts compile and run, the AI agent
executes structured tool calls against your project, and the build system produces a
game you can double-click and play with the editor closed.

```
┌─────────────────────────────────────────────────────────────────────┐
│  NEXUS GAME STUDIO                                                  │
│  ┌──────────┬──────────────────────────────────┬─────────────────┐  │
│  │ Scene    │                                  │  Inspector      │  │
│  │ (tree)   │         3D VIEWPORT              │  (components)   │  │
│  ├──────────┤   orbit · gizmos · terrain       ├─────────────────┤  │
│  │ Assets   │   sculpt · play mode             │  AI Agent       │  │
│  ├──────────┴──────────────────────────────────┴─────────────────┤  │
│  │ Console · Problems · Output · Profiler · Scripts · Visual Scr │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Quick start

```bash
npm install          # install dependencies
npm run build        # build editor bundle, standalone runtime, (server separately)
npm run build:server # build the server
npm start            # start NEXUS at http://localhost:8756
```

or during development:

```bash
npm install
npm run build            # needed once for www-runtime + server bundle
npm run dev              # server with live-reload on server code
```

The **Island Survival** sample game ships with the repo (`Projects/island-survival`) —
open it from the home screen and press **Play** (Ctrl+P).

### Requirements

- **Node.js 18+** (20+ recommended)
- A browser with WebGL2 (Chrome / Edge / Firefox)
- For LLM-powered AI: an API key (OpenAI, Anthropic, or any OpenAI-compatible
  endpoint like Ollama/LM Studio/vLLM) — see *AI setup* below.
  **The AI agent works without a key** using its built-in deterministic planner
  for common requests; the LLM adds free-form understanding.

---

## What's inside

| Module | Path | What it does |
|---|---|---|
| **Engine** | `Engine/` | Scene system, PBR renderer (three.js), physics (cannon-es), scripting runtime, visual scripting interpreter, terrain, audio, animation, gameplay components, UI/HUD, NPC AI |
| **Editor** | `Editor/` | Full editor app: docking panels, hierarchy, inspector, assets (GLB/GLTF/FBX/OBJ import + auto-analysis), console/problems/output/profiler, script editor (CodeMirror), visual script graph editor, terrain tools, command palette |
| **AIAgent** | `AIAgent/` | Structured tool calls (27 tools), deterministic intent planner, project memory with indexing/retrieval, AI debugger (diagnose → explain → fix → retest), LLM proxy |
| **BuildSystem** | `BuildSystem/` | Real 8-stage pipeline: Validate → Validate Assets → Compile Scripts → Process Assets → Package Content → Create Runtime → Generate EXE package → Validate |
| **Server** | `Server/` | Express server: project persistence, asset storage, snapshots, build endpoint, AI (LLM) proxy |
| **Templates** | `Templates/` | 7 game templates incl. the fully playable *Island Survival* |
| **Electron** | `Electron/` | Native desktop shell (menu bar, window) + Windows packaging script |
| **Projects** | `Projects/` | Your games (each a folder with `project.json` + `Content/`) |

### Feature checklist (all real)

- **Editor** — dark pro UI, menu bar (File/Edit/Project/Build/Play/AI/View), docking
  panels with splitters + tab docking + layout persistence, context menus,
  keyboard shortcuts, command palette (Ctrl+Shift+P), toasts, statusbar.
- **Scene hierarchy** — tree, search, drag-to-reparent, lock/visibility, rename,
  duplicate, delete, prefab creation, multi-scene.
- **Viewport** — orbit/pan/zoom, click-select, move/rotate/scale gizmos with snap,
  selection outline, grid, focus (F), terrain sculpting (raise/lower/smooth/flatten/
  paint), island generator, drag-and-drop asset placement.
- **Inspector** — schema-driven editing for **31 component types**, material editor
  (PBR: color/metal/rough/emissive/opacity), script `@prop` exposure, asset
  reference pickers, tag editing.
- **Assets** — upload GLB/GLTF/OBJ/FBX (auto-parsed), textures, audio; automatic
  thumbnails + analysis (meshes, materials, animations, **humanoid detection**,
  height); categories, search, drag into scene; **AI asset assistant** offers
  Player/NPC/Enemy setups for imported characters.
- **Scripting** — ES-class scripts compiled with `new Function` sandboxing,
  exact error lines (prefix-scan locator), `@prop` inspector integration,
  runtime error capture → Problems panel → **Fix With AI**.
- **Visual scripting** — node graph (events/flow/conditions/actions/variables),
  exec + data pins, live interpreter with delays/sequences/branches.
- **Play mode** — Play/Pause/Stop/Restart running the *real* simulation; automated
  playtest harness with assertions (also used by the AI agent to verify fixes).
- **Physics** — cannon-es rigidbodies, static/trigger colliders, character
  controllers, heightfield terrain collision, raycasts, contact events.
- **NPC AI** — state machine (Idle/Patrol/Investigate/Follow/Chase/Attack/Flee/
  Dead), detection (range + FOV + hearing), pathfinding, presets (guard,
  shopkeeper, zombie, soldier).
- **Gameplay** — Health, Damage, Interactable, Pickup, Inventory, Door, Trigger,
  Weapon, Projectile, Spawner (incl. night-mode), Checkpoint, DayNightCycle,
  SaveSystem, and more — all Inspector-configurable.
- **AI Agent** — natural language → structured GAME PLAN (World/Player/Gameplay/
  AI/UI checklists) → step-by-step execution with progress; 27 real tools
  (create/delete/modify objects & components, scripts, scenes, materials,
  prefabs, run/stop game, read console/errors, build project, inspect asset);
  **destructive changes show a review dialog before applying**; undo/redo;
  project snapshots; project memory with indexed retrieval (never sends the
  whole project).
- **AI Debugger** — "The player cannot jump" → inspects controllers, colliders,
  rigidbodies, scripts → diagnosis cards (cause, solution, files) → **Apply Fix**
  → automated retest.
- **Build system** — 8-stage pipeline with honest failure (cause, file, suggested
  fix). Output: a **fully offline single-file `<Game>.html`** + `Launch-*.bat` +
  `Make-*-Exe.bat` (packages a real `.exe` via Electron on the target machine) +
  Runtime/ + Content/ + Config/ + build.log. The game runs with the editor closed.
- **Templates** — 3D Game, First Person Horror, Third Person Adventure, Top-Down,
  Simple Shooter, Survival, and **Island Survival** (playable sample: island
  terrain, third-person player, day/night, zombies at night, gathering, crafting,
  combat, save system).

### Not yet implemented (honest list)

- FBX import uses a best-effort parser — complex FBX files may need conversion to GLB.
- Animation state machines are code-driven (Animator component states), not a visual graph editor.
- Multiplayer networking: not implemented.

---

## AI setup (optional but recommended)

1. Menu **AI → AI Settings (Connect LLM)**
2. Choose provider:
   - **OpenAI** — API key + model (e.g. `gpt-4o`)
   - **Anthropic** — API key + model (e.g. `claude-sonnet-4-20250514`)
   - **Custom / local** — base URL of any OpenAI-compatible server
     (Ollama: `http://localhost:11434/v1`, model `llama3.1`; LM Studio, vLLM, …)
3. Ask the agent anything: *"Create a third-person player"*, *"Add a zombie enemy"*,
   *"Make zombies spawn at night"*, *"The player cannot jump"*,
   *"Build the project"*.

Without a key, the agent still handles these via its deterministic planner —
try the examples above. The API key is stored server-side in
`Server/config.json` (gitignored) and never in your projects.

---

## Building a game (acceptance flow)

1. Open a project (or create one: **New Project** or **Create With AI**).
2. Press the **hammer** (or Build menu → Build Game…) → choose Development/Release.
3. Watch the 8 stages in the **Output** panel.
4. Result folder `Projects/<id>/Builds/<Game>/`:
   - `<Game>.html` — double-click to play, fully offline
   - `Launch-<Game>.bat` — opens the game in your browser
   - `Make-<Game>-Exe.bat` — builds `<Game>.exe` on Windows (needs Node.js)
   - `Runtime/`, `Content/`, `Config/`, `build.log`, `README.txt`
5. If the build fails: the Output panel shows **cause + file + suggested fix**, and
   you can ask the AI Agent to fix it.

---

## Tests

```bash
npm test             # 46 tests: engine ops, physics, scripting, visual scripting,
                     # terrain, AI planner, AI debugger, templates, build pipeline,
                     # server REST API (real HTTP)
npm run build && node tests/boot.mjs   # headless boot test of the REAL built
                                        # editor: home → open project → panels →
                                        # play mode → playtest → save
npm run typecheck    # strict TypeScript across all modules
```

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — module layout, data flow, engine internals
- [`docs/AI.md`](docs/AI.md) — agent tools, planner, memory, debugger, LLM providers
- [`docs/BUILD_SYSTEM.md`](docs/BUILD_SYSTEM.md) — pipeline stages, output format, exe packaging
- [`docs/ACCEPTANCE_TEST.md`](docs/ACCEPTANCE_TEST.md) — the full idea→build walkthrough with expected results

## Tech choices & trade-offs

The spec preferred C++/DX12/Vulkan + ImGui. We chose **TypeScript + three.js +
cannon-es + a web editor** because it delivers the same *real* functionality
(PBR rendering, rigid-body physics, sandboxed scripting, a genuine build pipeline)
in a fraction of the development time while keeping the architecture modular
(Engine / Editor / AIAgent / BuildSystem / Server are separate modules with clean
boundaries). Rendering and physics delegate to proven libraries; everything above
them — the scene model, component registry, tooling, AI, build system — is this
project's own code. The trade-off: no native DX12/Vulkan renderer and the Windows
`.exe` is Electron-wrapped rather than a native binary. Performance targets are
met for scene-editing workloads (see Profiler panel).

## License

MIT (third-party libs keep their own licenses: three.js MIT, cannon-es MIT,
CodeMirror MIT, Express MIT).
