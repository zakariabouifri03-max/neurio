# NEXUS Acceptance Test — idea → standalone game

This is the full end-to-end walkthrough (spec §38). Every step below is real and
automated where possible. Expected total time: ~10 minutes.

## 0. Launch

```bash
npm install && npm run build && npm run build:server && npm start
```

Open **http://localhost:8756**. You should see the home screen: logo, quick
actions, project cards, template gallery.

## 1. New 3D project

**New Project…** → template *3D Game* → name `MyGame` → quality High →
platform Web → **Create**. The editor opens: menubar, toolbar, Scene hierarchy
(left), Inspector (right), Assets + Console (bottom), 3D viewport (center).
Statusbar shows "Editing".

## 2. Import assets

Drag a `.glb` character and environment models into the **Assets** panel (or use
its ⬆ button). Each upload:
- appears with an auto-generated thumbnail,
- is analyzed (mesh/material/animation counts; **humanoid** flag for characters),
- offers the AI asset assistant: *Set up as Player / NPC / Enemy*.

## 3. Create the scene

- Drag the environment GLB into the viewport → drops at the cursor with a collider.
- Toolbar **cube/sphere** buttons add primitives; double-click a hierarchy row to
  focus; W/E/R switch gizmos; **F** focuses selection.
- Drag your character in, accept the **Player** setup (controller + physics +
  health + camera).
- Add a light if the template doesn't have one (toolbar ☀).

## 4. Enemy NPC

Type in the **AI Agent** panel (bottom): `Add a zombie enemy`.
You get a plan checklist; steps execute with live progress; a zombie object with
NPC AI states, physics, and a reusable prefab appears in the hierarchy. Select it
→ Inspector shows every parameter (detection range, chase speed, attack damage…).

Then: `Make zombies spawn at night` → a night-mode Spawner + DayNightCycle.

## 5. Gameplay

- Inspector on the player: Health, Inventory, Weapon are already configured.
- Try visual scripting: select an object, **Add Component → Visual Script**,
  double-click the graph icon → node editor: OnStart → Log → Delay → SpawnPrefab.
- Gameplay components (Interactable, Pickup, Door, Trigger, Checkpoint, Spawner)
  are all Inspector-configurable.

## 6. PLAY

Press **▶** (Ctrl+P). The statusbar shows "▶ PLAYING", the playing frame border
appears. WASD + mouse to move, Space to jump. Press again to stop — the scene
returns exactly to its edited state.

## 7. Hit an error → AI Debugger

Open the Scripts panel, break something (e.g. set the player controller's
**Jump Force** to 0 in the Inspector, or type `this.gameObjekt` in a script).
Play → jump doesn't work / console shows an error with file + line.

Type in the AI Agent: `The player cannot jump`.
- The debugger inspects the project → **diagnosis card** with Cause, Solution,
  Affected files.
- Click **Apply Fix** → the fix is applied → an automated playtest runs →
  the result (passed/failed + frames) is reported in the conversation.
- Replay manually to confirm the fix.

For script errors: the **Problems** panel lists file/line/severity; clicking
jumps to the line in the editor; **Fix With AI** runs the same flow.

## 8. Save

Ctrl+S (or File → Save). The server writes `Projects/<id>/project.json` with a
rolling backup. **Project → Snapshots** creates named restore points.

## 9. BUILD

**Build menu → Build Game…** → Release → **Build**. The Output panel streams:

```
[1/8] Validating project…        ✓
[2/8] Validating assets…         ✓
[3/8] Compiling scripts…         ✓
[4/8] Processing assets…         ✓
[5/8] Packaging content…         ✓
[6/8] Creating standalone runtime… ✓
[7/8] Generating package "MyGame"… ✓
[8/8] Running validation…        ✓ HTML 1.18 MB, payload OK, runtime OK
──── BUILD COMPLETE ────
```

Output: `Projects/<id>/Builds/MyGame/` (see `docs/BUILD_SYSTEM.md`).

## 10. Standalone run (editor closed)

Stop the NEXUS server (`Ctrl+C`), even close the terminal. Then:

- **Any OS**: double-click `MyGame.html` — the game runs fully offline in your
  browser. Main menu → New Game → play.
- **Windows**: double-click `Make-MyGame-Exe.bat` (Node.js required) →
  `MyGame.exe`.

The game is the same runtime the editor used — no editor, no server, no network.

## Automated equivalents

- `npm test` — 46 unit/integration tests (engine, physics, scripting, visual
  scripting, terrain, AI planner executing real tools, AI debugger, templates,
  build pipeline incl. honest-failure cases, server REST over real HTTP).
- `node tests/boot.mjs` — boots the **real built editor bundle** headlessly:
  home screen → open Island Survival (102 objects) → all panels → play mode →
  30 simulated frames, zero problems → automated playtest → save → snapshot.
- Island Survival (the §35 sample game) ships in `Projects/island-survival` and
  is covered by template tests + the boot test + builds via the API in tests.
