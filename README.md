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

## ⚡ Neurio GFX Boost — app li y‑régler téléphone 60 FPS + 4K

**[`NeurioGFXBoost.apk`](NeurioGFXBoost.apk)** (`com.neurio.gfxboost`) is a standalone
**performance / GFX tool** — *not* a game. Install it on any Android 5.0+ phone and it
gives you the controls to make the phone run **stable 60 FPS** and render **up to 4K**:

- ⚡ **BOOST** — one-tap optimizer: frees RAM, tunes GPU, locks the frame rate (animated progress + live device stats)
- 🎯 **FPS** — 30 / **60 stable** / 90 / 120 + stable frame-pacing + auto-stabilizer
- 🖼️ **Resolution** — AUTO / 720p / 1080p / 1440p / **4K (2160p)**
- 🎨 **Graphics** — Smooth / Balanced / Ultra + anti-aliasing, shadows, effects, HDR, V-Sync
- 🎮 **Game profiles** — save a FPS+res+quality combo per game and APPLY it before playing
- 📱 Live device read-out: model, Android ver, cores, RAM, screen, refresh rate, battery, GPU

All settings persist on-device (localStorage). Built with the same no-SDK pipeline,
signed v1+v2, own launcher icon (lightning bolt).

```bash
python3 tools/build-booster-apk.py     # builds + signs NeurioGFXBoost.apk
```

> Honest note: without root, Android apps can't *force* system-wide refresh-rate/resolution.
> This tool is a **GFX/booster companion**: it builds the performance profile, guides the
> right settings for your hardware, and applies per-game profiles — exactly like Play-Store
> "GFX Tool / Game Booster" apps do.

---

## 🤖 (Bonus) Real Android APK of the game — 60 FPS + up to 4K

**[`BashBaqiRacing-4K60.apk`](BashBaqiRacing-4K60.apk)** is a real, installable
Android build of the racing game (tiny WebView wrapper around the single-file game),
with the same ⚡ Graphics controls baked into the garage:

- 🖼️ **Render resolution** — AUTO / HD 720p / FHD 1080p / QHD 1440p / **✨ 4K ULTRA** (up to 3840×2160)
- 🎯 **Framerate** — 🔋 30 FPS · ⚡ **60 STABLE** (frame-pacing locked to a steady 60) · 🚀 MAX
- 🧠 **Auto-stabilizer** — watches the live FPS and auto-tunes effects/resolution so the game never stutters

```bash
npm install && npm run build:apk       # bundles the game → assets/game.html, then builds + signs
```

Both APK builders (`tools/build-apk.py`, `tools/build-booster-apk.py`) re-zip with
4-byte alignment and sign with **both v1 (JAR) and v2 (APK Signature Scheme)** — v2 is
mandatory because the manifest targets SDK 30. The signing key lives in `tools/signing/`.

> ⚠️ The builds are signed with a **new key**, so if an older copy of the same package is
> already on the phone, uninstall it first.

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
