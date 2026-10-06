# The NEXUS Build System

`BuildSystem/pipeline.ts` — a real 8-stage pipeline. Invoked from the editor's
Build dialog (`POST /api/build`) or the AI agent's `build_project` tool.

## Stages

| # | Stage | What it actually does |
|---|---|---|
| 1 | **Validate Project** | loads `project.json`, checks structure |
| 2 | **Validate Assets** | `validateProject`: entry scene exists, asset references resolve, Spawner prefabs exist, script/component sanity |
| 3 | **Compile Scripts** | every script goes through the real `compileScript` sandbox — syntax errors fail the build with exact file+line |
| 4 | **Process Assets** | reads asset binaries from `Content/`, base64-encodes for embedding (220 MB inline budget; larger files are copied instead) |
| 5 | **Package Content** | builds the game payload `{ project, embedded, config }` with `</script` escaping |
| 6 | **Create Runtime** | reads the standalone runtime bundle (`www-runtime/runtime.js`, the same `GameRuntime` the editor uses) |
| 7 | **Generate Package** | writes the output folder (below) |
| 8 | **Validate** | re-reads the output HTML, verifies the runtime marker, round-trips the JSON payload, checks size — then writes `build.log` |

## Output: `Projects/<id>/Builds/<Game>/`

```
MyGame/
├── MyGame.html          ← the game. One file, fully offline, double-click to play.
├── Launch-MyGame.bat    ← starts the game in the default browser
├── Make-MyGame-Exe.bat  ← builds MyGame.exe (Windows + Node.js required)
├── Runtime/             ← Electron wrapper (package.json + electron-main.cjs)
├── Content/             ← original asset files (for modding)
├── Config/game.json     ← build configuration
├── build.log            ← full pipeline log
└── README.txt           ← how to play / how to make the exe
```

### The EXE

`Make-MyGame-Exe.bat` runs `npm install` inside `Runtime/` (downloads Electron,
~100 MB, once) and then `electron-packager` → `MyGame.exe` in the build folder.
The exe loads `MyGame.html` fullscreen with menus disabled. This is honest
packaging: the game logic is the NEXUS runtime running in Chromium; the wrapper
is a real native executable. A machine without Node.js can still play the HTML
directly.

## Failure behavior

Failures are honest and actionable. The Output panel shows:

```
[2/8] Validating assets…
      ✗ EnemySpawner: Spawner references missing prefab.
──── BUILD FAILED ────
      Cause: 1 validation error(s)
      File: EnemySpawner: Spawner references missing prefab.
      Suggested fix: Open the AI Agent and ask it to fix the errors, or fix them in the Inspector.
```

Ask the AI Agent *"fix the build errors"* — it reads the log, diagnoses, applies
fixes through tools, and rebuilds.

## Rebuilding the runtime bundle

The runtime is built from `Engine/runtime/main.ts`:

```bash
npm run build     # builds www/ (editor) AND www-runtime/runtime.js (game runtime)
```

If `www-runtime/runtime.js` is missing, builds fail with a clear message telling
you to run `npm run build` first — never a silently broken output.
