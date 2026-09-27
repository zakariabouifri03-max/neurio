# Borrowed Light

**Borrowed Light** is a complete, original first-person psychological horror game for the browser. It is a self-contained Three.js experience with no build step and no downloaded game assets.

> **Premise:** Mara has promised her friend Asha one mundane favour: spend a rainy Friday night at her bungalow on Alder Row, put away the groceries, and wait for morning. The house knows the sounds of its former maintenance contractor better than it should.

## Run

Serve the repository as a static site (ES modules cannot be opened directly from `file://`):

```bash
cd /home/user/neurio
python3 -m http.server 3000
```

Then open `http://localhost:3000`.

## Controls

| Action | Control |
| --- | --- |
| Move / look | `WASD` / mouse |
| Run | `Shift` |
| Crouch / move quietly | `C` or `Ctrl` |
| Interact / open / inspect | `E` |
| Phone | `Q` or phone button |
| Pause | `Esc` |

Headphones are recommended. Click **Begin Night** to enable sound and pointer-lock controls.

## Included game systems

- Full start-to-finish original story across prologue, escalation, survival, ending, and epilogue
- First-person controller with acceleration, head/hand bob, running, crouching, flashlight, and collision
- Procedural low-fi Alder Row bungalow, study, bedroom, utility space, garage, rain, street, domestic clutter, lighting, and fog
- Contextual interaction system for doors, keys, drawers, kettle, breaker, documents, recorder, garage release, hide spot, and inspectable props
- Small persistent inventory and automatic local checkpoint save / continue
- Smartphone UI: messages, notes, photos, contacts, flashlight, notifications, and story-critical unknown texts
- Generated Web Audio cues for wind, hum, latches, footsteps, electrical static, messages, and scares
- Human antagonist with glimpse, room search, retreat, chase, detection, and recoverable stumble behaviour
- Randomised minor sounds / light flickers, controlled cinematic events, a wardrobe stealth beat, and garage escape chase
- In-game pause, credits, quality presets, film grain, vignette, and motion settings

## Originality

All story, writing, characters, models, layout, sound synthesis, interface, and code in this experience are original to **Borrowed Light**. It does not include or reproduce assets, dialogue, characters, locations, or game content from other horror titles.

## Project structure

```text
index.html       # Game UI and overlays
src/main.js      # Scene, gameplay, story, AI, audio, save system
src/style.css    # Low-fi UI, phone, menus, effects
vendor/          # Vendored Three.js module
```
