# SampleIsland - NovaForge sample project

Open this folder in NovaForge (`File > Open Project`) or press Play in the editor.
The packaged build in `Builds/` is a standalone game - no editor required.

## Controls
| Input | Action |
|---|---|
| W A S D | Move |
| Shift | Sprint |
| Space | Jump |
| Mouse | Look (click the window to capture the cursor) |
| E | Interact (doors, pickups, NPCs) |
| Left mouse / F | Attack (NPCs fight back) |
| Esc | Pause menu / release the cursor |
| F5 | Quick save |
| F11 | Toggle fullscreen |
| F1 | Toggle the on-screen HUD |

Logs are written to `Logs/Game.log` next to the executable.

## Scene contents (23 objects)
- Player (third person controller, collider, 120 HP)
- 3 NPCs using the state machine (Patrol / Chase / Attack)
- Gate with an opening door, trigger volume and interaction prompt
- Health + ammo pickups, pushable crates, a script-driven spinning crate
- Directional sun with shadows + a point lamp
