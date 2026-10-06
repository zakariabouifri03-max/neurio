# Editor manual

## Layout

```
┌ Toolbar ───────────────────────────────────────────────────────────────────────────┐
│ Play ▶  Pause ⏸  Step ⏭  Stop ■   Move / Rotate / Scale   Snap   Undo / Redo      │
│ Save   Save As   Build Game   New Project   Open Project                           │
├───────────────┬──────────────────────────────────┬─────────────────────────────────┤
│ Scene         │                                  │ Inspector                       │
│ Hierarchy     │      3D Viewport                 │ (components + properties)       │
│               │                                  │                                 │
│ Project       │                                  │ AI Assistant                    │
│ Browser       │                                  │ (plan → preview → Apply/Revert) │
├───────────────┴──────────────────────────────────┴─────────────────────────────────┤
│ Asset Browser            │ Console (info / warning / error, filter, clear)         │
└────────────────────────────────────────────────────────────────────────────────────┘
```

All panels are dockable ImGui windows: drag a tab to re-dock, split or float it. The layout is the
dark professional docking style with context menus, keyboard shortcuts and property fields.

## Viewport controls

| Input | Action |
|---|---|
| Right mouse drag | Orbit camera |
| Middle mouse drag | Pan |
| Mouse wheel | Zoom (also dolly in free-fly) |
| Right mouse + WASD / QE | Free-fly |
| Left click | Select object (gizmo handles take priority) |
| Ctrl + left click | Add to / remove from selection (multi-select) |
| W / E / R | Move / Rotate / Scale gizmo |
| Ctrl (held) | Snap (grid / angle / scale steps) |
| Ctrl+D | Duplicate selection |
| Delete | Delete selection |
| F | Frame selection |
| Ctrl+Z / Ctrl+Shift+Z | Undo / Redo |
| Ctrl+S | Save scene |
| Space | Play / Stop |

Gizmos are drawn in the viewport with axis colours and depth-independent overlays; dragging a
handle pushes an undo entry with the transform delta.

## Scene Hierarchy

* Click to select, double-click to rename, right-click for the context menu.
* Context menu creation actions (all of them are real, they call `SceneFactory`):
  **Add Ground, Add Box/Sphere/Cylinder/Cone/Plane, Add Light, Add Camera, Create Player,
  Create NPC, Add Door, Add Pickup, Add Trigger Volume, Add Audio Source, Add Quest, Add Spawner,
  Create Empty, Duplicate, Delete, Rename, Add Collider, Add Rigidbody**.
* Drag an object onto another to parent it; drag to empty space to unparent. Parents keep world
  transforms, and the Inspector shows the local transform.

## Inspector

* Components are grouped with headers, an enable checkbox and a description line.
* Property widgets match the property type: bool checkbox, int/float drag fields, vector fields,
  colour pickers (with alpha where the type has alpha), enum dropdowns, asset pickers (model /
  texture / material / audio), entity pickers, string and multi-line text fields, and read-only
  info rows.
* Editing a field writes immediately to the component, marks the scene dirty and pushes an undo
  entry; asset and destructive operations ask for confirmation.
* `Add Component` lists every registered component type with its description.

## Asset Browser

* `Import` accepts `.glb .gltf .obj .fbx .png .jpg .jpeg .wav .mp3 .ogg .flac`; the importer copies
  the file into the right `Assets/` folder, reports vertex/triangle/material/animation counts in the
  Console, and lists warnings for unsupported features.
* Drag a model row into the viewport to spawn it at the drop position (ray-cast against the scene),
  or double-click to spawn at the origin.
* Missing/orphaned assets are highlighted; "Reveal" opens the containing folder.

## Console and Logs

Errors, warnings and info messages from every subsystem land in the Console with a category and a
timestamp; the same lines are written to `Logs/Editor.log` next to the executable. A missing texture
or an unreadable script is a warning + fallback, never a crash.

## Play mode

`Space` / the toolbar Play button starts the game inside the viewport using the same `GameRuntime`
the exporter packages:

* physics, collisions, gravity, triggers
* NPC AI (they will patrol, notice you, chase and attack)
* scripts, doors, pickups, quests
* audio, HUD and messages
* the player controller (WASD, mouse look, jump, sprint, interact, attack)

Pause ⏸ freezes the simulation, Step ⏭ advances exactly one frame (useful to inspect physics), Stop ■
restores the pre-play scene state exactly (transforms, component state, created/destroyed objects).

## Project browser / project management

`New Project` creates the documented folder layout (`Assets/`, `Settings/`, `Scenes/`, `Scripts/`,
`Logs/`, `Builds/`, `project.json`); `Open Project` loads an existing folder and remembers the last
scene; `Save` / `Save As` write the scene; `Build Game` packages the game (see `BUILD.md`). Projects
persist across restarts: the editor restores the last project and scene from the settings file.

## Shortcuts summary

| Shortcut | Action |
|---|---|
| Ctrl+N / Ctrl+O | New / Open project |
| Ctrl+S / Ctrl+Shift+S | Save scene / Save scene as |
| Ctrl+B | Build Game |
| Ctrl+Z / Ctrl+Shift+Z | Undo / Redo |
| Ctrl+D / Del | Duplicate / Delete selection |
| W / E / R | Move / Rotate / Scale gizmo |
| Space | Play / Stop |
| F5 | Reload assets |
| F1 | Shortcut help |

## Not implemented in V1

Terrain sculpting, a curve/timeline editor, a material graph, a skeleton/pose editor and UI layout
templates are **not implemented in V1** (see `V2-SCOPE.md` for the full list and rationale).
