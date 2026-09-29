# 🎭 Swindle Squad — *deal · doubt · double-cross*

A complete, playable **3D multiplayer deception party game** for **2–8 players online**. Short rounds of dubious deals
— secret roles, real lies, a big dramatic reveal. Built from scratch: original art, characters, room, UI, sounds,
mechanics and code. No engine, no asset store, no build step.

> **The Gilded Alibi** is a members' back room with one table, eight chairs, a wall screen that tells you who lied,
> and a locker full of things you should probably not have borrowed.

```bash
node server/index.mjs            # → http://localhost:8099/swindle/
# or:  npm start     ·   npm run swindle
```

Node 18+ is the only requirement — the server speaks raw `http` + a hand-written RFC6455 WebSocket layer, so there are
**zero runtime dependencies** (Three.js r170 is vendored in `vendor/`).

Solo play works with no server at all: **PLAY SOLO** opens a local table with bots in your own tab, using the exact same
authority code the server uses.

---

## 🃏 The loop

```
MAIN MENU → CREATE / JOIN (code) → LOBBY (invite · ready · customise · emotes · host rules)
   → ROUND: secret roles → brief → TALK (chat · emotes · deals · flags) → SUBMIT (lock your call)
   → REVEAL (slowed, beat by beat) → REWARDS → next round → FINAL WINNER → REMATCH
```

* **Rounds last 2–5 minutes** (`briefMs / turnMs / submitMs` are host settings). 8 deception rounds and 6 very short
  minigames are shuffled into a night: `cases · counterfeit · backstab · contracts · parcel · vouch · auction · ledger`
  plus `mg_suitcase · mg_button · mg_vault · mg_cards · mg_vanish · mg_fall`. Each one runs
  **TRUST → DOUBT → DECISION → REVEAL**.
* **Secret roles rotate every round** (Trickster, Detective, Trader, Protector, Risk Taker, Insider + per-round keys like
  `audited` / `knowTrap` / `insured`). Nobody is permanently "the scammer" — tonight's lie is not tomorrow's evidence.
* **You can**: tell the truth, lie, fake a deal, accept, reject, void, accuse, protect, push your luck, bid, flag a
  loophole, take someone's heat. Auto-commit when the buzzer beats you (the "safe" option).
* **The reveal is the show**: the authority releases one beat at a time (`CFG.revealBeatMs`), the camera focuses on each
  player as their decision is read out, hidden objectives are exposed, deals are opened, point deltas pop, banners fire —
  `SCAM SUCCESS · TRICK FAILED · GOOD CALL · WRONG ACCUSATION · BIG WIN · FINAL SCORE`.
* **Scoring**: chips only ever move on the server. Deception pays, correct detection pays, wrong accusations cost,
  voided deals burn the voider, insurance pays the insured. Lifetime chips (`profile.bank`) buy cosmetics.

## 🕵️ Anti-cheat by construction

| Rule | Where |
|---|---|
| Only the authority computes scores, roles, rewards, decisions, timers | `shared/engine.js` (`Room`) |
| Clients send **intents** (`ready · act · offer · accuse · push · chat · emote · move …`) and nothing else | `swindle/js/net.js` |
| Every intent is validated against phase, turn, cooldowns, ownership and ranges | `Room.handle()` |
| Secrets are **redacted before the snapshot leaves the server**: you receive your own `secret`, your own `me`, and `hands` without the `fake` flag | `Room.view()` |
| Snapshots are throttled (~15 Hz); events (chat, reveal beats, awards) go immediately | `Room.flush()` |
| Movement is server-clamped to the room; emote/chat rate-limited and sanitised | `Room` + `shared/util.js` |
| Protocol mismatch (`PROTO`) is refused outright instead of desyncing | `server/index.mjs` |
| Drop-outs keep their seat and their chips (resume token), the round never waits | `/api/rejoin` + `Room.attach()` |

## 🎨 Client

* **One compact room, modelled for the game**: central table with a motorised reveal dial, eight chairs, a big wall
  screen that renders live UI (menu, lobby, brief, deals, reveal, results), brass lockers with numbers on them, bar
  nook, plant corner, coat rack, hanging lamps with warm tungsten key light, amber/rose neon signage, oxblood carpet,
  dust motes, and props you can stand on. `swindle/js/room3d.js`
* **Characters**: chunky stylised humans with big heads, pillow limbs and expressive geometric faces — 6 skins × 6 faces
  × 9 hairs × 6 hats × 6 glasses × 8 shirts × 6 pants × 6 shoes × 8 accessories × 12 outfit colours, all procedural
  geometry + canvas textures. Idle sway, blink, breathing, sweat beads, sit/stand, walk, 12 emotes, mood expressions,
  floating nameplates with role chips, speech bubbles and point deltas. `swindle/js/chars.js`
* **Camera**: third-person/isometric rig that keeps everyone in frame, gently frames the player who is deciding, zooms
  for reveal beats, shakes on bad news, and has a spectator pull-back. `CameraRig`
* **FX**: pooled GPU points (chips, sparks, smoke), shock rings, light beams, floating text, confetti; bloom +
  chromatic aberration + grain + saturation post (`swindle/js/fx.js`, `post.js`).
* **Audio**: entirely synthesised at runtime (Web Audio) — a music director that changes mode per phase
  (`lobby → hush → tense → reveal → results → final`), plus ~30 SFX: chips, stamps, deals, lies (detuned pad), good/bad
  stingers, gavel, riser, alarm, whoosh, final horn. `swindle/js/audio.js`
* **Graphics presets**: `low / medium / high / ultra` (dpr, shadows, bloom, particle budget, fog, anisotropy) — auto-detected
  on first run; 60 FPS target with adaptive dpr.
* **PWA**: installable, own icons, offline-capable (the solo table and all assets keep working with no network).
  `swindle/manifest.webmanifest`, `swindle/sw.js`

### Controls

| Action | Input |
|---|---|
| Walk around the room | `W A S D` / arrows · drag stick on touch |
| Use a prop · sit down | `E` · `F` |
| Talk quick-reactions · emote wheel | `Q` · `1…9` (emote slots) |
| Chat | `T` |
| Pick an option · lock your call | click / `1…9` · `Enter` |
| Accuse · push your luck | the dock buttons · `X` / `Shift` |
| Focus the camera on a player | click their nameplate · `Tab` cycles |
| Mute · quality · help · customise | `M` · `G` · `H` · `C` |
| Back / close | `Esc` |

## 🧱 Layout

```
neurio/
├── swindle/
│   ├── index.html · style.css        # entry + the whole skin (no framework)
│   ├── js/main.js                    # renderer, quality, phase camera, character pool, wall-screen painter
│   ├── js/ui.js                      # every DOM surface — renders, never scores
│   ├── js/net.js                     # GameClient: socket, reconnect/resume, local-room shim
│   ├── js/room3d.js                  # the room, seats, props, collision, CameraRig, PRESETS
│   ├── js/chars.js                   # characters, faces, emotes, nameplates
│   ├── js/{fx,post,tex}.js           # particles, HDR-ish bloom pass, procedural textures
│   ├── js/{audio,save,util}.js       # synth director, profile + cosmetics, DOM helpers
│   └── {manifest.webmanifest,sw.js,icons/}
├── shared/                           # THE AUTHORITY — imported by server and by solo play
│   ├── engine.js                     # Room: phases, intents, validation, deals, reveal, scoring
│   ├── content.js                    # roles, goods, rounds, minigames, cosmetics, settings, tags
│   ├── bots.js                       # bot brains (they bluff, accuse, and tilt)
│   └── util.js                       # rng, id/emoji sanitiser, clamp, formatters
├── server/
│   ├── index.mjs                     # http + static + /api/* + WS routing, 25 Hz tick
│   └── ws.mjs                        # hand-written RFC6455 (frames, ping/pong, masks, fragmentation)
└── tools/
    ├── sim-rounds.mjs                # authority simulation (all rounds, all phases, all edge cases)
    ├── protocol-test.mjs             # real WebSocket clients: redaction, anti-cheat, resume
    ├── smoke-3d.mjs                  # headless build of room/characters/FX/textures
    ├── smoke-client.mjs              # headless run of main.js+ui.js through a whole game
    ├── check-wiring.mjs              # DOM/three/import surface cross-check
    └── make-swindle-icons.mjs        # procedural PNG icons (own encoder, no deps)
```

## ✅ Verify it

```bash
npm run sim        # node tools/sim-rounds.mjs 4 6   — authority: rounds, phases, awards  → ALL GOOD
npm run smoke3d    # headless room/characters/FX      → 3D SMOKE OK
npm run smoke      # headless client plays a full game → CLIENT SMOKE OK
npm run proto      # boots the server on a spare port and runs the live WS suite → PROTOCOL OK
npm run wire       # ids/classes/three/imports cross-check
npm run icons      # regenerate swindle/icons/*.png
```

`npm run all` runs the whole set. `node tools/sim-rounds.mjs 6 6 [seed]` takes player count, rounds and seed.

## 🌐 Social

Room codes (5 chars, unambiguous alphabet), private rooms, invite link + copy button, rematch (keeps the room and the
settings), spectator mode (camera pulls back, no chips at risk), bot fill for empty seats, quick-chat lines grouped by
phase, emotes with world-space bubbles, per-player stats, win history, and cosmetics you keep.

## 🚫 Originality

Nothing here is copied from any existing game. Characters, room, props, names, items, roles, dialogue, reactions,
announcer lines, UI, icons and sounds are all generated in this repo. The reference screenshots supplied with the brief
were used only for mood (a dim office, nameplates over heads, props to interact with) — no names, art, layout or text
were taken from them. Chat lines are generated from contextual banks per phase/role/tag; the sample lines given in the
brief are deliberately absent:

```bash
grep -RniE "trust me|swear that'?s real|don'?t choose me|he'?s lying|take the deal|not the scammer" swindle shared server || echo "clean"
```

---

# 🏁 Bash Baqi Racing (still in this repo)

The earlier game in this repository — a 3D kart racer. It stays fully playable at **`/racing`**
(`python3 -m http.server` + open `/index.html` also works).

لعبة سباق كارت ثلاثية الأبعاد كاملة بالمتصفح — سيارات باغي على الشاطئ، متجر، بطولة، وخرائط عشوائية!

- 🏎️ **50 cars to buy** — micros, beach buggies, muscle cars, monster trucks, hotrods, super sports (3 ultra-rare 💎 gem cars)
- 🧑‍🤝‍🧑 **16 drivers** — from Zaid 😎 to Nova the alien 👽
- ️ **50 random tracks** across 10 worlds: Beach, Jungle, Desert, cobblestone Town at sunset, Snow, Volcano, Swamp, Canyon, Farm, Stardust Night 🌙
- 🥇🥈🥉 **Place 1st–3rd** for big rewards — every place pays coins, top 3 pays gems, 1st wins a 🏆
- 🏆 **Championship season**: points (10/8/6/4/2/1) every race vs 5 rivals; champion after 10 races wins a jackpot
- 📦 **? item boxes**: 🔥 turbo boost · 🚀 homing rocket · 🛡️ bubble shield · 🔧 garage upgrades, paint shop, wheels, horns
- 💾 Progress auto-saves in the browser · 📱 installable PWA (own `manifest.webmanifest` + `sw.js`)
- ▶ Controls: `W A S D`/arrows, `SPACE` power-up, `R` reset, `H` horn, `ESC` pause; touch buttons on mobile
- 📦 A ready-to-install `BashBaqiRacing.apk` (WebView shell, built with aapt2 + d8 + apksigner — see repo history);
  `node tools/build-singlefile.mjs` regenerates the bundled single-file build

Made with ❤️ and Three.js
