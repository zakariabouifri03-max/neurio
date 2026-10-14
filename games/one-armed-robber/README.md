# 🦾🚫 One-Armed Robber — 3D heist (browser)

A first-person 3D heist game in the spirit of *One-Armed Robber*: you have one good arm, a bag, and a plan.
Pick the back door, loot the bank, dodge cameras and guards, then reach the green **GETAWAY VAN** zone before the police arrive.

**▶ Play:** serve the repository root with any static server and open `games/one-armed-robber/`:

```bash
python3 -m http.server 8000
# → http://localhost:8000/games/one-armed-robber/
```

No build step. Three.js r170 is reused from the repo's `vendor/` folder; everything else (level, textures, sounds) is generated in code.

## Controls

| Action | Keys |
|---|---|
| Move | `W A S D` |
| Look | Mouse (click to lock) |
| Sprint | `SHIFT` |
| Crouch (harder to spot) | `C` or `CTRL` (hold) |
| Punch (knock out guards, smash cameras) | Left click |
| Grab loot / pick the back door | Hold `E` |
| Vault keypad | Tap `E`, repeat the colour sequence with `1–4` or click |
| Pause | `ESC` |

## Rules

- **Heat** rises while a guard or camera sees you (much slower while crouched). Full heat = **alarm**.
- After the alarm, guards hunt you (they shoot, and grab you when adjacent) and the **police arrive in 60 s**.
- Loot weighs you down: a heavier bag means slower movement.
- Getting busted (HP at 0) or the police arriving ends the heist and the loot is lost.
- Escaping to the van with any loot wins; your best haul is saved in the browser.

## Loot

| Target | Value | How |
|---|---|---|
| Cash registers (×2) | $800 each | Hold E |
| Storage cash bundles (×4) | $1,200 each | Hold E |
| Jewelry displays (×3) | $2,000 each | Hold E |
| Office safe | $2,500 | Hold E |
| Vault gold bars (×5) | $4,000 each | Hold E (after the keypad) |

Total on the map: **$34,900**.

## Files

```
games/one-armed-robber/
├── index.html   # HUD, menus, keypad + results overlays
├── style.css
├── game.js      # level, player, guards (grid pathfinding), cameras, heat/alarm, audio, minimap
└── README.md
```
