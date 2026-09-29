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

## ☎️ Scam Baqi — سكام مع الصحاب (offline edition)

نسخة كاملة 3D ف المتصفح، مستوحاة من لعبة ستيم **Scam With Your Friends**، ولكن **100% offline**: مكتب كول سنتر، كولات مع شخصيات AI محليين، كوتا يومية، بوس عصبي، فيروسات/مداهمات/ضربات جوية — بلا إنترنت و بلا سيرفر.

🧠 **الذكاء**: موديل عصبي مدرّب محلياً كيتفهم الدارجة/العربية/العربيزي (`node tools/train-nlu.mjs`)، مخ حوار بذاكرة و تناقضات، و جسر اختياري لـ **LLM محلي** (Ollama/LM Studio) عبر `node tools/scam-ai-server.mjs` — AI حقيقي، و لكن بلا سحابة.

**▶️ العب دابا:** حلّ `scam-baqi-offline.html` (ملف واحد، دوبل كليك) — ولا `cd scam && python3 -m http.server 8000` → `http://localhost:8000`

📖 التفاصيل و التحكم: [`scam/README.md`](scam/README.md) · 📄 الدوسيي على اللعبة الأصلية: [`docs/scam-with-friends-9issa.html`](docs/scam-with-friends-9issa.html)

