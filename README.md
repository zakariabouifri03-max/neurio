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

## 📡 LAN Game Stream — بث الألعاب على الشبكة المحلية · Direct APK download

لعبة كاملة **كتشتغل على تيليفون واحد وكتّبثّث للتيليفون الآخر** فوق الواي فاي المحلي — بلا سيرفر، بلا إنترنت، وبلا ما تنزّل أي شي من ملفات اللعبة على التيليفون الثاني.

Stream a game that runs on one phone to another phone on the same Wi-Fi (video + audio
only, input sent back). **Requires Android 8.0+ (API 26)**, hand-rolled networking, no
third-party libraries.

### ⬇️ Download the APK · حمّل الـ APK

| Build | Direct link |
| --- | --- |
| **`neurio-lan-game-stream.apk`** (release, installs directly — 181 KB) | **[⬇️ Download](https://github.com/zakariabouifri03-max/neurio/releases/download/apk-latest/neurio-lan-game-stream.apk)** |
| `neurio-lan-game-stream-debug.apk` (debug — 237 KB) | [⬇️ Download](https://github.com/zakariabouifri03-max/neurio/releases/download/apk-latest/neurio-lan-game-stream-debug.apk) |
| All builds / release page | https://github.com/zakariabouifri03-max/neurio/releases/tag/apk-latest |

Short link (points at the newest build): **https://github.com/zakariabouifri03-max/neurio/releases/latest**

> The APKs are rebuilt automatically by GitHub Actions on every change and re-uploaded
> to the same `apk-latest` release, so these links always serve the latest build.

**Install · التثبيت**
1. Download the APK on **both** phones (Chrome on Android: *Install unknown apps* once).
2. On the phone **that has the game**: `HOST GAME` → pick the game → `START STREAM` → accept
   screen-capture consent → read out the 6-digit pairing code.
3. On the **other phone**: `JOIN GAME` → tap the host → type the code → `PLAY`.
4. Optional, to send touches into the game: on the host, enable **Settings → LAN Game remote
   input** (accessibility service). Without it the client still gets video + audio.

Everything stays on the local network; no game files, APKs or OBBs are ever sent to the
client phone. Sources live in **[`lan-game-stream/`](lan-game-stream/)** — see its
[README](lan-game-stream/README.md), [protocol](lan-game-stream/docs/PROTOCOL.md) and
[limitations](lan-game-stream/docs/LIMITATIONS.md).
