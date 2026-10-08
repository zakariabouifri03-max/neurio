# 🏁 Bash Baqi Racing

لعبة سباق كارت ثلاثية الأبعاد كاملة بالمتصفح — سيارات باغي على الشاطئ، متجر، بطولة، وخرائط عشوائية!
A full 3D kart-racing game in the browser — beach buggies, a huge shop, a championship, and random tracks!

**▶ Play:** serve the folder with any static server and open it:

```bash
python3 -m http.server 8000
# → http://localhost:8000
```

No build step, no external CDN — everything is procedural and vendored (Three.js r170 included in `vendor/`).

---

## 🎬 فيديو ترويجي — 60 ثانية أنيميشن

A **1-minute vertical cartoon trailer** (1080×1920, 24 fps) with a fully synthesised
soundtrack is included: **[`video/bash-baqi-racing-60s.mp4`](video/bash-baqi-racing-60s.mp4)**

title card → beach cruise → dune ramp backflip → `TURBO!` duel overtake → `FINISH` + trophy → sunset logo card.

Everything is generated from code (no stock footage/music):

```bash
python3 tools/video/audio.py  --out /tmp/track.wav      # music + SFX synth
python3 tools/video/cartoon.py --encode video/bash-baqi-racing-60s.mp4 --audio /tmp/track.wav
```

See **[`tools/video/README.md`](tools/video/README.md)** for the scene timeline and all the knobs.

---

## 📱 Install on your phone — كأنها APK!

The game is a full **PWA** (Progressive Web App): installable, fullscreen, **works offline**, its own icon — no APK file needed.

1. Open the game link on your phone (Chrome on Android / Safari on iPhone)
2. Tap **📱 Install** button inside the game's garage, **or** browser menu `⋮` → **"Add to Home screen" / "تثبيت التطبيق"**
3. Done — the 🏁 buggy icon sits on your home screen and launches **fullscreen like a real app**

> **Want a real `.apk` file?** Host this repo anywhere public (e.g. enable **Settings → Pages → Deploy from branch** in GitHub — one tap), then go to **pwabuilder.com** on your phone, paste the link, and it gives you a signed APK to download. No PC needed.

**Offline play** is built-in: a service worker caches all game files on first visit.

---

## 🎮 The Game

You are dropped **straight into a race** the moment the game loads. Finish, earn, upgrade, repeat!

- 🏎️ **50 cars to buy** — micros, beach buggies, muscle cars, monster trucks, hotrods, super sports (3 ultra-rare 💎 gem cars)
- 🧑‍🤝‍🧑 **16 drivers** — from Zaid 😎 to Nova the alien 👽
- 🗺️ **50 random tracks** across 10 worlds: Beach, Jungle, Desert, cobblestone Town at sunset, Snow, Volcano, Swamp, Canyon, Farm, and Stardust Night 🌙
- 🥇🥈🥉 **Place 1st–3rd** for big rewards — every place pays coins, top 3 pays gems, 1st wins a 🏆
- 🪙 Coins also sit **on the track** — grab them mid-race
- 🏆 **Championship season**: points (10/8/6/4/2/1) every race vs 5 rivals; champion after 10 races wins a jackpot
- 📦 **? item boxes**: 🔥 turbo boost · 🚀 homing rocket · 🛡️ bubble shield
- 🔧 **Garage**: upgrades (top speed / acceleration / handling), paint shop, wheels, horns
- 💾 Progress auto-saves in the browser

## 🕹️ Controls

| Action | Keys |
|---|---|
| Drive | `W A S D` / arrows (auto-gas on mobile) |
| Power-up | `SPACE` |
| Reset on track | `R` |
| Horn | `H` |
| Pause | `ESC` |

Touch buttons appear automatically on phones/tablets.

## 🧱 Tech — 100% procedural

- **Three.js r170** (vendored, zero runtime dependencies) with a hand-written **bloom pass** (threshold + separable blur + filmic composite + vignette)
- Every track is generated from a seeded closed Catmull-Rom spline: road ribbon mesh, terrain sculpted *away from the spline*, themed decor merged into single draw calls, start-line arch, item boxes, coins, hot-air balloons 🎈
- Cars & chibi drivers are built from primitives (8 car archetypes, 16 hat styles, emoji faces)
- All SFX + the island music loop are synthesized live with the Web Audio API — zero audio files
- Arcade kart physics: grip/drift model, off-road slowdown, rubber-banding AI, homing rockets, spin-outs, dust particles

```
neurio/
├── index.html            # UI layers (HUD, menus, shop, results)
├── src/
│   ├── main.js           # state machine + renderer + economy
│   ├── race.js           # race engine: physics, AI, powerups, HUD
│   ├── menu.js           # garage scene + shop/drivers/customize/upgrades/series
│   ├── builders.js       # 3D builders: cars, drivers, track worlds
│   ├── data.js           # 50 cars · 16 drivers · 50 maps · 10 themes · economy
│   ├── tex.js            # canvas textures (roads, skies, faces…)
│   ├── audio.js          # synth engine/sfx/music
│   ├── post.js           # bloom post-processing
│   ├── save.js           # localStorage persistence
│   └── util.js           # seeded RNG + helpers
└── vendor/               # three.js r170 (no internet needed)
```

Made with ❤️ and Three.js

---

## 📦 `BashBaqiRacing.apk` — ملف جاهز!

A **ready-to-install Android APK** is included in this repo (built offline with aapt2 + ecj + d8 + apksigner, no Gradle — see `tools/`).
It's a fullscreen WebView shell that runs the bundled single-file game 100% offline.

**Install on a phone:**
1. Download `BashBaqiRacing.apk` onto your phone.
2. Tap it → allow **"Install from unknown sources"** (once).
3. Play — icon 🏁 sits on your home screen, works offline.

- Package: `com.bashbaqi.racing` · minSdk 21 (Android 5.0+) · signed v1+v2
- Rebuildable: `node tools/build-singlefile.mjs` regenerates the bundled game (`bash-baqi-racing.html`); the APK pipeline lives in the repo history.

---

## ⚽ Neurio Futsal — 5v5 indoor football (`futsal/`)

An original 3D futsal game that runs in the browser (Three.js, no build step). Open
`futsal/index.html` through any static server, e.g. from the repo root:

```bash
python3 -m http.server 8000
# → http://localhost:8000/futsal/
```

**Delivery note:** this is a browser game served as static files. It is **not** a native Windows `.exe`;
building one needs an Electron/Tauri-style wrapper, which is not part of this build. Fullscreen /
borderless / windowed are handled in the page (Fullscreen API and letterboxing at 16:9 or 16:10).

### What is in this build
- **Match engine** (`futsal/src/sim/`): 5v5 (GK + 4 outfield per side), passing, through balls, shots
  (power/tap/lob), dribbling, sprint, tackles, interceptions, blocks, switching, goalkeeper saves and rush,
  corners, kick-ins, goal kicks, free kicks, penalties, fouls, advantage, yellow/red cards, stoppage time.
- **Modes:** Quick Match, Tournament (four-team knockout), Training (free practice and a 60 s shooting drill),
  AI vs AI, and a live AI match behind the menus.
- **Teams:** eight original fictional teams with generated kits and attributes (speed, acceleration, shooting,
  passing, dribbling, strength, stamina, ball control, defending, reaction, goalkeeping).
- **Rendering:** procedural futsal hall, boards, goals with nets, stepped stands and a crowd (instanced),
  kit-coloured players with numbers and procedural run / tackle poses. Camera modes: Broadcast, Player,
  Close, Training (V cycles).
- **Graphics presets:** LOW / MEDIUM / HIGH / ULTRA (pixel ratio, shadows, shadow-map size, crowd size,
  light count, fog, player shadows).
- **Audio:** all sounds synthesised in WebAudio (kick, bounce, whistle, goal roar, card beep, crowd bed). No music.
- **Input:** keyboard (WASD, Shift, Space, J, K, L, Q, E, C, R, F lob, V camera, Esc pause) and gamepad
  (left stick move, right stick aim, A pass, B shoot, X tackle, Y through, LB/RB switch, LT sprint,
  R3 press, L3 skill, D-pad up keeper rush, Back camera, Start pause). Menus work with keys, pad and mouse.
- **Post-match:** score, possession, shots (on target), pass accuracy, fouls, corners, saves, cards,
  goal log and top-rated players.
- **Persistence:** settings, match history and tournament progress in `localStorage` (key `neurio-futsal-v1`).

### Not in this build
- **Career** (menu item is disabled), **Penalty Shootout mode**, and **Local 2-player** are not implemented.
- The tournament decides knockout draws with a penalty decider weighted by team strength; there is no
  shootout mode yet.

### Known limits
- Pass completion is around 35–45% in the headless simulation; real futsal is higher. Pass selection is
  the main area still being tuned.
- Kicks made with the ball sitting beside or behind the kicker (mostly goalkeeper distribution) are
  "flicks" that can move the ball up to about 2 m in one frame; the view damps this so it does not look like a teleport.
- The 60 FPS target is designed for a GPU. Software WebGL (headless testing) runs far slower.
- Shots-on-target is counted from the shot aim, not the outcome.

### Tests
```bash
node --test futsal/tests/
```
The tests cover the config, team data, match setup, a five-minute simulation (no NaN, bounded ball step),
determinism, a full quick match, the tournament bracket and save-data fallbacks.

### Layout
`futsal/index.html` (entry) · `futsal/src/main.js` (app flow and loop) · `futsal/src/sim/` (MatchManager,
BallController, AIController, GoalkeeperAI, PlayerController, TeamManager, FormationManager, Referee, MatchStats) ·
`futsal/src/render/` (arena, playerModel, matchView, camera) · `futsal/src/ui/UIManager.js` · `futsal/src/input.js` ·
`futsal/src/audio.js` · `futsal/src/save.js` · `futsal/src/tournament.js` · `futsal/src/config.js` (all tuning).
