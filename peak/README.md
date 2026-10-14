# ⛰️ Peak Climb

A procedural 3D mountain-climbing game in the browser, inspired by *Peak*.
Grab the rock with your hands, pull yourself up on tethers, manage stamina,
rest on ledges, light campfires as checkpoints, and reach the summit flag.

**▶ Play:** from the repo root, serve it with any static server and open `/peak/`:

```bash
python3 -m http.server 8000
# → http://localhost:8000/peak/
```

No build step. Uses the vendored Three.js in `../vendor/`.

## Controls (desktop)

| Input | Action |
| --- | --- |
| Mouse | Look around |
| **LMB** | Left hand: grab the surface under the crosshair / release |
| **RMB** | Right hand: grab / release |
| **W A S D** | Move on the ground · pull yourself along your grips (look up + W to climb) |
| **Shift** | Sprint on flat ground |
| **Space** | Jump on the ground · **lunge** off your grips (costs 20 stamina) |
| **R** | Drop back to the last campfire |
| **Esc** | Pause menu |

## Rules

- **Stamina** drains while you hold a grip (steep rock drains faster, moving drains faster still).
  It recovers quickly on the ground and slowly when both hands are free.
  At 0 your arms give out and you let go.
- **Ledges** (flat terraces) are where you rest. Walls between ledges are 2–4 m, so you need a grip or a lunge to get over them.
- **Falls** of more than ~11 m/s hurt (HP). Zero HP sends you back to the last campfire.
- **Campfires** at 20, 42, 64 and 86 m are checkpoints. Touch one to set your respawn.
- **Summit** flag at the top. Your best time is saved in `localStorage`.

## Files

- `index.html` · `style.css` — HUD, menus, styling
- `game.js` — terrain generation, physics (tethers, stamina, falls), rendering, input

## Notes

- Each mountain is generated from a seed. Use `?seed=1234` to replay a specific mountain; the pause menu's **New mountain** button picks a fresh one.
- Desktop only for now (mouse and keyboard, pointer lock).
