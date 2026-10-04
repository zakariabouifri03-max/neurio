# 📷 Streamer Life Sim 2 — Darija Edition

لعبة كاملة بنفس فكرة Streamer Life Simulator 2: مدينة صغيرة، دارك، PC، ستريمينغ، متجر، سيارات، و multiplayer!
A full 3D life-sim in the spirit of Streamer Life Simulator 2: small foggy pine town, houses you can buy & enter,
a PC with streaming apps, an online shop, drivable cars with first-person interiors, NPCs, day/night cycle,
and **online/LAN multiplayer** so you and a friend can roam the town together.

**▶ Play now:** run `node streamer/server.mjs 8080` and open `http://localhost:8080`
(the server also hosts the `/ws` WebSocket relay used by multiplayer).

---

## 🎮 The game

- **Main menu**: PLAY · MULTIPLAYER · SETTINGS · QUIT — over a live 3D fly-around of the town.
- **The town**: crossroads with crosswalks, HOMESTEAD FOODS grocery, barn, RV camp, street lamps,
  utility poles + wires, curve & pedestrian road signs, guardrails, pine forest, cloudy sky, day/night cycle.
- **Your streamer life**: start in the trailer with a weak PC. Sit at the PC → Z-OS desktop with apps:
  - **OPS** — streaming panel: nickname, stream key, bitrate, category (Just Chatting / Gaming / ASMR…),
    quality (unlock 1080p/4K with better hardware), START/STOP STREAMING, live viewers & followers.
  - **Web (Zamazor)** — the shop: CPUs, GPUs, RAM, HDD, coolers, monitors, mics (BuzzMic, SoundClash,
    ToneFusion, VocalForge, ClearVoice Pro, CrystalSound Green…), keyboards, mouses, chairs, tables,
    routers, lamps — stars, prices, basket, "Complete Purchase". Bought gear upgrades your stream score
    and visibly upgrades your room.
  - **Virus Scanner** — "%30" scanning circle, threats like `c.debug.router.backup`, REMOVE button, $50 PREMIUM scam 😄.
    Viruses actually infect your PC while streaming and halve your viewers until you clean them!
  - **Wallpapers** — change the desktop wallpaper.
- **Economy**: viewers pay you $/min and bring followers. Better PC + mic + router + bitrate = more viewers.
- **Houses**: FOR SALE signs — buy the Wooden Cabin ($1,500), Red Family House ($6,000) or Big Villa ($15,000),
  then enter them (each has its own wallpapered room with your PC setup).
- **Cars**: start with the Old Sedan; buy the yellow **Dodgy Van** ($900) or **Sport Z** ($5,000).
  First-person interior: dashboard, steering wheel that turns, rear-view mirror, speedometer, engine sound.
- **NPCs** walk the streets; **chat** with Enter (or 💬 on mobile).
- **Multiplayer**: create a room → share the 5-letter code → your friend joins → you see each other with
  name tags, walk/drive together and chat. Works over the internet or LAN via the `/ws` relay.
- **Settings**: graphics quality, shadows, volume, mouse sensitivity, invert-Y, streamer name, reset save.
- **Auto-save** in the browser (money, followers, items, houses, cars, time of day).

## 🕹️ Controls

| Action | Key |
|---|---|
| Move | WASD / arrows (left joystick on phone) |
| Look | mouse (drag right side on phone) |
| Run | Shift |
| Interact / enter-exit car / buy | E |
| Chat | Enter |
| Pause | Esc |

Touch buttons appear automatically on phones/tablets (joystick, E, 🏃, 💬, and ▲▼◀▶ when driving).

## 📱 APK / 🖥️ EXE / PWA

- **`StreamerLife2.apk`** (repo root) — real signed Android APK (v1+v2+v3), fullscreen WebView, 100% offline,
  Internet permission enabled so multiplayer works when you point it at a server. Install: download → tap → allow unknown sources.
- **`StreamerLife2.exe`** (repo root) — Windows executable (cross-compiled with Zig): extracts the offline game
  and opens it in your default browser. Double-click and play.
- **`streamer-life.html`** — the entire game in ONE file: works from `file://`, share it, open it anywhere.
- **PWA**: served over http it's installable on phone & desktop (manifest + service worker + icons) — offline after first visit.

### Rebuild the packages
```bash
node tools/build-streamer-singlefile.mjs   # → streamer-life.html
# APK pipeline (see repo history): apktool project in /tmp built from tools' icons + smali shell + assets/game.html
# EXE:  zig cc -target x86_64-windows-gnu -O2 tools/launcher.c game_data.c -o StreamerLife2.exe -lshell32
```

## 🧱 Tech

- Three.js r170 (vendored) — 100% procedural textures (asphalt, grass, wood, siding, floral wallpaper, signs),
  instanced pine forest, soft shadows, fog + overcast sky, day/night with lit windows & street lamps.
- Zero-dependency Node server: static hosting + hand-rolled RFC6455 WebSocket relay for multiplayer rooms.
- Web Audio synthesized SFX: clicks, cash, jingles, car engine loop.
- Single-file build via esbuild; APK via apktool/d8/apksigner; EXE via Zig cross-compilation.

Made with ❤️ and Three.js — من فاس بحب 🇲
