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

## 📱 Install on your phone — APK ولا PWA

**Real APK (≈250 KB, offline, zero permissions):** download
**[`dist/BashBaqiRacing.apk`](dist/BashBaqiRacing.apk)** (tap the ⬇ *Download* button on
GitHub) onto the phone, tap the file, allow *"install unknown apps"* once — done. Nothing
else is needed: no internet, no Play Store, no account.

> 📲 **Share it on WhatsApp:** the direct link is
> `https://github.com/zakariabouifri03-max/neurio/raw/hooome/dist/BashBaqiRacing.apk`
> — send that to a friend and the whole game lands in their phone.

**Or the PWA:** the game is also a full **Progressive Web App** — installable, fullscreen,
**works offline**, its own icon.

1. Open the game link on your phone (Chrome on Android / Safari on iPhone)
2. Tap **📱 Install** button inside the game's garage, **or** browser menu `⋮` → **"Add to Home screen" / "تثبيت التطبيق"**
3. Done — the 🏁 buggy icon sits on your home screen and launches **fullscreen like a real app**

**Offline play** is built-in: a service worker caches all game files on first visit.

### ⚡ Fast mode (for older / slower phones)

Tap the **⚡** button in the garage to toggle performance mode:

| | pixels | bloom | shadows |
| --- | --- | --- | --- |
| **Auto** (default in the browser) | up to 2× | on | on |
| **Fast** (default in the APK) | 1× | off | off |

Auto mode also degrades by itself: if it keeps measuring under ~26 fps it drops bloom,
then the resolution, then switches to full fast mode. The choice is saved.

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
- ⚡ **Fast mode button**: 1× pixels / no bloom / no shadows for older phones (auto-degrades too)
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
├── tools/apk/            # offline APK pipeline: hand-written smali + apktool + v2 signing
└── vendor/               # three.js r170 (no internet needed)
```

Made with ❤️ and Three.js

---

## 📦 The APK — how it is built

The APK is **generated from this repo**, offline, with no Gradle and no Android SDK:

```bash
node tools/apk/build.mjs        # → dist/BashBaqiRacing.apk  (~250 KB)
```

esbuild bundles the game into one HTML file → `tools/make-icons.mjs` draws the launcher
icons → **apktool** assembles the hand-written `MainActivity.smali` into `classes.dex` and
packages everything → **APK Signature Scheme v2** signing in pure JS → `tools/apk/verify.py`
re-checks the digest, RSA signature, zip and dex from scratch and must print `PASS`.

- Package `com.neurio.bashbaqi` · **minSdk 24 (Android 7.0+)** · targetSdk 34 · signed **v2**
- **Zero permissions** — the HTML, JS, audio and icons all live inside the APK
- Starts in **⚡ fast mode** (it spots the `BashBaqiAPK` user agent) and keeps the screen
  awake; leaving the app pauses the race and silences the island music

See **[`tools/apk/README.md`](tools/apk/README.md)** for the one-time tool setup and the
signing-key notes (keep `tools/apk/keystore/` — future updates must use the same key).
