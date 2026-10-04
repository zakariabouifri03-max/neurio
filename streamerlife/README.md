# 🔴 Streamer Life 3D — Medina

Lo3ba dyal **streamer life simulator** kamla: 3D city, dar dyalk, PC b tatbi9at (stream, shop, bank, social…),
tchri dar / tomobil / gear, ou **multiplayer online** (bjoj f nafs lmdina + chat).

Web + PWA (telephone) + **APK** + **EXE** (Electron).

---

## ▶️ Kifach tl3ab (3 toro9)

**1. Browser / PC (hsen tari9a):**
```bash
node server/mp-server.mjs        # → http://localhost:8787
```
Hada sarvor dyal lweb **ou** dyal lmultiplayer f nafs lport.

**2. Telephone (APK):** `StreamerLife.apk` f had lfolder — copy-ih l telephone, install (khas t3ti
"Install from unknown sources"). Kaykhdem **offline**, bla internet.

**3. File wa7ed:** `streamer-life.html` — lo3ba kamla f fichier wa7ed, tqder t3awdha b double-click
(file://) bla sarvor. (Multiplayer khasso sarvor.)

---

## 🎮 Lo3b

| Touche | Action |
|---|---|
| `W A S D` | tmchi |
| `Shift` | tjri |
| Mouse | tchouf |
| `E` | interact (bab, PC, frigo, douche, lfarch…) |
| `F` | tdkhol / tkhroj mn tomobil |
| `Tab` | lkharita |
| `Esc` | pause |
| `Enter` | chat (f multiplayer) |

F telephone: joystick lisar + boutons limin (🏃 / 🚗 / E).

### L9issa
Kat bda f **studio sghir** b PC dyal batata ou 350$. Katbda tstreami, katkber lviewers ou
lfollowers, katchri gear ou PC jdid, mn be3d **villa**, ou f lakhir **mansion** (viewers ×1.8).

### Chno kayn f lmdina
- 🛒 Supermarket (makla) · 💻 Tech Store (PC + micro + camera + fiber…) · 🚗 Car Dealer (5 tomobilat)
- 🛋️ Furniture (decor = viewers) · 👕 Clothes · 🏦 Bank (deposit / loan) · 🏋️ Gym · 🏠 Real Estate (3 dyour)
- Park, fontaine, tomobilat waqfin, lampadaires, day/night cycle (lil kat3ammar lidwa)

### PC dyalk (10 tatbi9at)
`🔴 StreamerHub` (go live, chat hayy, donations, subs, hype, shoutout) · `🛒 NovaShop` ·
`🏦 Bank` · `📱 Chirper` (posts) · `✉️ Mail` · `💼 Business` (5 sponsors) · `🎮 GameLib` (8 l3ab) ·
`🎞️ VideoLab` (clips → videos → passive income) · `📊 Analytics` · `⚙️ Settings`

### Besoins
⚡ Energy · 🍔 Hunger · 🚿 Hygiene · 😊 Mood — kayn nowm, makla, douche, TV. Ila 7bat energy f lastream,
katwelli mghchi 😵.

---

## 🌐 Multiplayer online

1. Wa7ed mnkom kay7el sarvor: `node server/mp-server.mjs`
2. Howa ou sahbo: menu → **MULTIPLAYER** → address `ws://IP-DYAL-LMODIF:8787` → nafs **room code**
3. Katchoufo b3diyatkom f nafs lmdina, smiya fou9 rask, ou chat b `Enter`.

Sarvor **bla dependencies** (WebSocket maktoub b yeddin f Node), 15 ticks/s, rooms.
Bach tl3bo bo3ad (machi nafs lwifi) host-iw sarvor f ay VPS / ngrok ou 3tih `wss://…`.

---

## 📦 Build

```bash
node tools/build-singlefile.mjs     # → streamer-life.html (lo3ba f fichier wa7ed)
python3 tools/build-apk.py          # → StreamerLife.apk  (signed v1 + v2, bla Java/Android SDK)
python3 tools/verify-apk.py         # kay-verifi signature
npm i && npm run dist               # → EXE dyal Windows (installer + portable) b electron-builder
npm run desktop                     # kay7el lo3ba f Electron directement
```

> APK kaystakhdem WebView shell li kayn f repo (`../BashBaqiRacing.apk`) ou kaybeddel assets + icon +
> label, mn be3d kay-sign-iha b mfateh jdad f `tools/.keys/` (ma kat-commitach — gitignored).
> Package id baqi `com.bashbaqi.racing`, 3lach ila 3ndek lo3ba dyal racing installée ghadi tbeddelha.

> EXE: electron-builder kaykhass internet bach ydownloadi Electron (~100 MB), 3lach ma dertoch lexe f repo —
> `npm run dist` 3ndek f PC ou tjib `dist/Streamer Life 3D Setup.exe`.

---

## 🗂️ Structure

```
src/game.js    loop, economy, streams, day/night, save
src/world.js   city + 3 interiors dyal dyour
src/player.js  FPS controller + driving
src/pc.js      NovaOS desktop + 10 apps
src/ui.js      menu / HUD / shops / settings
src/net.js     multiplayer client
src/tex.js     textures procedurales (bla assets barra)
server/mp-server.mjs   HTTP + WebSocket server (0 dependencies)
tools/         single-file build, APK builder + verifier
```

Three.js r170 vendored — **walo** kay-tahmel mn internet, kolchi offline.
