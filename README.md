# RABONA — Wobbly Football

An original, playable 3D wobbly-physics football game inspired by the Rabona screenshots you shared. Built for the browser with Three.js — no build step, no external runtime APIs.

**What you see in the reference images:**
- Capsule stickmen with white joints, colorful boots, wobbly tackles
- Desert stadium with cube seats, RABONA billboards, floodlights, cactus
- Big yellow/black ball, sliding saves, rabona (cross-leg) kicks
- “PLAY WITH FRIENDS” vibe — this version is SOLO VS AI, local 3v3

This is an original interpretation, not a copy of any commercial game.

## Features

**Stadium**
- 70×44m pitch with striped grass, white lines, center circle, penalty areas
- Two full goals with posts, crossbar, and net
- Desert outside: sand, rocks, cactus, 4 floodlights with point lights
- Cube stands like in screenshots (red/white/blue cubes with star patterns)
- RABONA billboards around pitch and big scoreboard
- Bright desert sky with clouds, environment map for reflections

**Players — Wobbly Physics**
- Procedural capsule characters: torso, head with hair, arms with elbow joints, legs with knee joints, feet with colorful boots
- White joint spheres exactly like reference
- Teams: BLUE vs RED, plus GOLD goalkeepers who dive
- Animations: idle sway, run cycle with opposite arm/leg swing, kick, **rabona** (leg crosses behind), slide tackle, fall & get up, celebrate
- Shadow blobs that scale with height
- Wobble springs on torso when hit

**Ball**
- Yellow base with black pentagons + blue lines (like reference), canvas texture
- Physics: gravity, drag, rolling friction, bounce, spin, Magnus curve on rabona
- Possession: ball sticks slightly in front when you are close
- Kicks: normal (E) and rabona (Q) with curve and extra height

**Gameplay — 3v3**
- You control BLUE team (auto-switches to closest to ball, press R to force switch)
- 2 field players + 1 goalkeeper per team (6 total)
- AI: chase ball, support positioning, shoot when in range, goalkeeper tracks ball laterally and dives
- Tackling: slide (Space) into carrier → carrier falls, you steal
- Goals: ball must cross line inside 7.32m width and below 2.44m height
- 90-second quick match, scoreboard, commentary, goal celebration with camera orbit
- After goal, positions reset

**Controls**
- **WASD / Arrows**: Move
- **Shift**: Sprint (1.45×)
- **E**: Kick / Shoot (towards goal or facing)
- **Q**: Rabona kick (curled, fancy)
- **Space**: Slide tackle
- **R**: Switch player (closest to ball)
- **C**: Camera (follow player vs ball/wide)
- **Esc**: Pause

**Touch / Mobile**
- Left cluster: move
- Right cluster: KICK (big), R (rabona), S (slide), ⚡ sprint
- Responsive layout, no horizontal overflow

**Lobby**
- Live 3D showcase: wobbly player doing run/rabona cycle with ball bobbing
- Drag to orbit
- PLAY (quick match), PRACTICE (same but you can lab rabona), TEAMS (info), HOW TO PLAY
- Settings: difficulty (easy/normal/hard affects AI speed), quality (performance/balanced/high), camera default, volume, mute
- Local storage: `rabona-settings-v1` and `rabona-record-v1`

**Audio**
- Synthesized kicks, slide, bump, goal fanfare, whistle via WebAudio

## How to Run

No build step or runtime package installation required. Start the included dependency-free static server (Node 18+):

```bash
npm start
```

Binds to `0.0.0.0:8000`, accepts preview proxy hosts, blocks hidden files and dependency folders. Use `PORT=8080 npm start` for different port.

Alternatively:

```bash
python3 -m http.server 8000 --bind 0.0.0.0
```

Open http://localhost:8000

Add `?test=1` to skip service worker (used by tests).

## Architecture

- `index.html`: markup, icons, HUD, touch controls, modals
- `src/rabona/style.css`: local fonts, responsive UI, HUD, touch, modals
- `src/rabona/rules.js`: constants, pitch dimensions, ball/player physics helpers (`stepBall`, `kickBall`, `stepPlayer`), seeded RNG, time formatting
- `src/rabona/models.js`: `createWobblyPlayer` (capsule hierarchy, materials, shadow, update function), `createBall` (textured icosa + shadow), `createPitch` (striped canvas texture + white lines), `createGoal` (posts + net lines), `createStadium` (desert, rocks, cactus, cube stands, floodlights, billboards, scoreboard texture)
- `src/rabona/world.js`: environment sky canvas → PMREM, fog, hemi + directional light with 2048 shadow, `followShadow`, `updateScoreTexture`
- `src/rabona/game.js`: `RabonaGame` class — teams, ball, possession, AI (field + GK), input, kick/rabona/slide, goal detection, camera (follow vs ball with lerp, shake), HUD, commentary
- `src/rabona/audio.js`: WebAudio synthesized effects
- `src/rabona/main.js`: boot, renderer, quality, lobby orbit, UI bindings, settings/record persistence, main loop (dt capped 0.05), showcase animation
- `vendor/three.module.js`: Three r170 local, `vendor/utils/BufferGeometryUtils.js`
- `assets/fonts/`: Barlow Condensed, DM Sans, IBM Plex Mono WOFF2
- `assets/rabona.svg`: logo
- `tools/serve.mjs`: safe static server (blocks dotfiles, node_modules, outside root, uses realpath)
- `sw.js`: `rabona-v1`, caches local assets, network-first, offline reload to lobby
- `manifest.webmanifest`: PWA metadata

Preserved but not loaded: `src/` old racing source, `src/royale/` previous OUTRUN game.

## Tests

```bash
npm test              # 12 unit tests: RNG, pitch, ball physics, kick, player movement, sprint, facing, timers, format
npm run test:browser  # full real-WebGL integration: lobby, garage, guide, settings persistence, kickoff, movement, kick, rabona, slide, simulation, goal, pause, touch, exit, finish, mobile layout, reload persistence
```

Browser tests use bundled Chromium via `@sparticuz/chromium` and require `LD_LIBRARY_PATH` with extracted libs (handled in test file). They run with `?test=1` to skip SW.

## Limitations & Honest Notes

- Single player vs AI, not real online multiplayer (labeled SOLO VS AI)
- 3v3 not 11v11 — keeps it playable and performant in browser
- Wobble is procedural animation + springs, not full rigid-body ragdoll (would need Ammo/Cannon and be heavier)
- No throw-ins/corners/offside — ball bounces off invisible walls except goal mouth, keeps action flowing
- AI is simple steering + random shots, not a full football tactics engine
- All assets procedural/local, no external models or textures

## Credits

Original game code, models, textures, and audio synthesis. Fonts: Barlow Condensed, DM Sans, IBM Plex Mono (OFL). Three.js r170 MIT.

Inspired by Rabona's wobbly football vibe — an original interpretation built for this prompt.
