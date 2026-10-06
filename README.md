# NEXUS Game Studio

**NEXUS Game Studio** is a focused, browser-based 3D game editor built around the repository's vendored Three.js runtime. It is a working scene editor and playable prototype—not a native Unreal/Unity replacement. The editor ships with a playable **Island Survival** sample, local project storage, GLB/glTF/OBJ geometry import, an executable gameplay-event graph, and a one-file browser-game exporter.

> **Platform note:** the editor runs in a secure Electron desktop shell, and GitHub Actions packages an **unsigned Windows x64 portable `.exe`**. It is a desktop wrapper around the browser-based Three.js editor, not a native C++ game engine; Windows SmartScreen may show an unsigned-app warning. The in-editor Build panel separately produces a self-contained `.html` game.

## Run the editor

Requirements: a current Chromium, Firefox, or Safari browser with WebGL 2 support; Python 3 for local serving. Node.js 20+ is needed only for automated tests.

```bash
npm start
# Open http://localhost:8000
```

Or, without npm:

```bash
python3 -m http.server 8000 --bind 0.0.0.0
```

For the desktop shell, install dependencies and run `npm run desktop`. Build a Windows x64 portable `.exe` on Windows with `npm run build:win`; pushes to the session branch also run the Windows packaging workflow and publish a GitHub prerelease containing only the `.exe` asset. The Electron wrapper serves the bundled editor on a persistent loopback origin so IndexedDB projects survive app restarts. Use **File → Export Project File** to move a project; browser storage is not an arbitrary folder on disk. `racing.html` still opens the original Bash Baqi Racing game from this repository.

## What works in this build

- **3D WebGL viewport:** Three.js r170, physically based `MeshStandardMaterial` properties, shadows, fog, environment/hemisphere light, live draw-call/frame statistics, orbit/pan/zoom, object picking, transform tools, focus, grid, and game-camera preview.
- **Scene editing:** create and delete objects, rename, duplicate, drag assets into the viewport, reparent in the hierarchy, edit transforms and material values, configure components, undo/redo scene edits, save/open scenes, and create/restore scene snapshots.
- **Project templates:** Island Survival, Third Person, First Person, Top Down, Simple Shooter, and Empty Project. The browser New Project dialog describes storage and target limitations.
- **Asset import:** OBJ geometry and glTF 2.0 / GLB mesh geometry. glTF PBR factors and embedded or selected external base-color images are imported where supported by the browser. For `.gltf`, select the `.bin` and texture files at the same time if they are external. FBX, animation retargeting, skinning workflows, and full material graphs are not implemented.
- **Components and play mode:** character movement, jumping/gravity, sprint/stamina, health, inventory, gatherable pickups, a chase/attack enemy, simple static collision, day/night lighting, basic vertical rigid-body gravity, combat, and stone-tool crafting. Play changes are discarded on Stop; an exported sample game saves position, resources, health, enemy state, and collected items to browser storage when available.
- **Gameplay Graph:** a small executable event/condition/action chain. The current event is player proximity; actions include message, open, toggle visibility, and heal. It is intentionally not a general Blueprint system.
- **Local agent:** a deterministic intent-to-plan helper that proposes structured, reviewable calls into the editor's scene/component/validation/build tools. It is not a hosted LLM and does not connect to a cloud model. It won't silently execute a destructive plan. Stored JavaScript assets are not run by the game runtime.
- **Project/build pipeline:** validate transforms and mesh data, serialize the scene, bundle the vendored renderer and runtime into one offline-capable HTML download, and check the embedded scene payload. Release and Development HTML configurations are available; Development shows an FPS/object overlay.

## Island Survival sample controls

Press **Play** in the toolbar, click the viewport to capture mouse look, and use:

| Action | Input |
|---|---|
| Move | `W A S D` |
| Look | Mouse while captured |
| Jump | `Space` |
| Sprint | `Shift` |
| Gather nearest resource | `E` |
| Attack nearby enemy | `F` |
| Craft a stone tool (3 wood + 2 stone) | `C` |
| Pause / release mouse | `Esc` |
| Stop and restore edit scene | `Stop` |

The sample scene includes a low-poly island, shore, cabin, trees, rocks, a player, resource pickups, an enemy, a working day/night light cycle, and a cabin-proximity Gameplay Graph. Project progress in editor Play Mode is intentionally rolled back on Stop; the exported standalone game includes optional browser-local autosave.

## Build a standalone playable game

1. Open **Build → Build Portable HTML Game** (or the Build button).
2. Choose Development or Release.
3. The builder validates the scene, checks the local Three.js runtime, serializes the scene, bundles the single-file runtime, parses the embedded payload, and downloads `<ProjectName>.html`.
4. Open that file in a modern browser. It runs without the editor and without a server or external module import.

This in-editor export is a portable browser game, **not** the desktop `.exe`. The desktop wrapper is built separately with `npm run build:win` or by the Windows GitHub Actions workflow.

## Project and architecture

```text
index.html                 NEXUS editor shell
electron/main.cjs          Secure Electron window and persistent-origin local file server
src/studio.js              Editor UI, project workflow, panels, commands and build orchestration
src/engine.js              Three.js renderer, scene graph, editor controls and play simulation
src/asset-import.js        OBJ + GLB/glTF 2.0 geometry/material import
src/project.js             Templates, IndexedDB persistence and scene validation
src/agent.js               Deterministic planner and structured editor-tool registry
src/graph.js               Event/condition/action graph model
src/exporter.js            Self-contained HTML game builder/runtime
src/studio.css             Dark editor UI, docks, dialogs and responsive layout
vendor/three.module.js     Vendored Three.js r170; no package install is required
racing.html                Original repository game, kept available separately
tests/core.test.js         Node tests for import, planning, project and graph utilities
```

The code deliberately favors a small JavaScript/Three.js path because this repository already contains a vendored real-time renderer and a working browser game. A native C++/Vulkan/DirectX engine and the requested production subsystems cannot be honestly delivered as a quick layer on top of this web checkout. The current physics is a light prototype (character ground/gravity, obstacle checks, and vertical rigid-body gravity); it is **not** a full rigid-body solver. Animation import/retargeting, audio authoring, terrain sculpting, visual shader graphs, arbitrary script execution, code signing, and a native C++ game engine remain future work.

## Tests and checks

```bash
npm test
npm run check
```

The tests cover OBJ parsing, a synthetic GLB v2 mesh, malformed GLB rejection, structured local-agent planning, explicit unsupported behavior for night spawning, project templates/graphs, project validation, portable HTML bundling, and headless simulation of sample-scene movement, jumping, gathering, crafting, and enemy chase. There is no browser automation dependency in this checkout; exercise the WebGL editor and standalone output in a browser for end-to-end verification.
