# 🔥 BOOYAH FIRE — Free Battle Royale

A Free Fire–style 3D battle royale you can play in the browser: **40–48 fighters**, a parachute
drop onto one of 8 procedurally generated islands, loot, backpacks, gloo walls, drivable vehicles,
a shrinking safe zone, ranks and rewards — all in a single static folder with **no build step,
no CDN and no server**. Works offline and installs as a PWA.

```
npm run serve        # → http://localhost:8000     (or just open index.html)
```

---

## Play

| | |
|---|---|
| **On foot** | `WASD` move · mouse look · left click fire · right click aim · `Shift` sprint · `Ctrl`/`C` crouch · `Space` jump · `R` reload · `1`/`2` weapons · `F` pick up · `H` medkit · `J` first aid · `G` gloo wall · `V` grenade · `B` smoke · `N` flash · `Tab` map · `Esc` pause |
| **Driving** | `W`/`S` throttle & reverse · `A`/`D` steer · `F` get in / get out — the camera pulls back behind the car |
| **Touch** | left thumb-stick drives or walks (push it to the edge to sprint) · drag the right side to look · buttons for fire, aim, jump, crouch, reload, weapons, items and gloo · ✋ enters/exits vehicles and picks loot up · **auto-fire** toggle in Settings |
| **Map** | `Tab` or `M` opens the tactical map, tapping the minimap opens it too — tap the map to steer your parachute to a landing spot |

Drop phase: you steer the parachute with the same input, and if you don't touch the controls the
fighter glides to the marked landing ring on its own. Consumables, ammo and armour are picked up by
walking over them; weapons and vehicles are chosen deliberately (`F` or tapping the loot list).
Being knocked in duo/squad starts a 26-second bleed-out — your squad can revive you, and if you die
while they're still alive the match continues and the camera follows a teammate.

## Android APK

The same game ships as a sideloadable APK — **one file, 0.34 MB, works offline**:

```bash
npm run build:apk     # → BOOYAH-FIRE.apk   (also: npm run test:apk)
```

Copy `BOOYAH-FIRE.apk` to the phone, tap it and allow *Install unknown apps* for your file manager.

> ثبّت اللعبة على الأندرويد: انسخ ملف `BOOYAH-FIRE.apk` إلى الهاتف، اضغط عليه، ثم اسمح بـ «تثبيت تطبيقات
> غير معروفة». يعمل التطبيق بدون إنترنت — الحزمة كاملة داخل الملف.

There is no Android SDK, Gradle or `apksigner` in this repo, so the APK is assembled in plain Node:

| step | how |
|---|---|
| the app shell | `BashBaqiRacing.apk` in the repo root is the template: its 2.4 kB `classes.dex` is a WebView that loads `file:///android_asset/game.html` |
| the game | esbuild bundles `src/main.js` (+ three.js) and the bundle, the CSS and the favicon are inlined into one self-contained `assets/game.html` |
| manifest & resources | `tools/axml.mjs` rewrites the *binary* manifest string pool (package `com.booyah.fire`, label `BOOYAH FIRE`, and a fully-qualified activity name, since `classes.dex` still owns `com.bashbaqi.racing.MainActivity`) and patches the package name in `resources.arsc` in place |
| icons | the mipmaps are drawn by the same procedural artwork as the PWA icons, at 48/72/96/144/192 px |
| zip | `tools/apk-sign.mjs` writes the archive itself: entries deflated (stored + 4-byte aligned for `.arsc`, `.dex`, `.png`), then the v2 APK Signing Block spliced in before the central directory |
| signing | JAR v1 (`MANIFEST.MF` → `CERT.SF` → PKCS#7 `CERT.RSA`) **and** APK Signature Scheme v2 (RSA-PKCS1-v1_5 + SHA-256, 1 MB chunk digests, signer's SubjectPublicKeyInfo, `0xbeeff00d` stripping protection) — both schemes verified internally before the file is written |
| the key | `android/keystore/booyah-fire.key.pem` / `.cert.pem` (self-signed code-signing certificate: `keyUsage=digitalSignature`, `extKeyUsage=codeSigning`, backdated 30 days so a phone with a slightly slow clock still accepts it) — committed, so every rebuild upgrades the installed app instead of fighting it |

`npm run test:apk` checks the wire format against a real one: it verifies the reference APK signed by
`apksigner` (9 v1 files, v2 block 4088 B, two extra blocks), round-trips an untouched manifest string
pool byte-for-byte, then signs a synthetic APK, confirms both schemes accept it, and confirms they
*reject* it after a single byte is flipped in a file or in the central directory. It also asserts the
details an installer actually looks at: every stored entry 4-byte aligned with a `0xd935` record in
*both* the local and central headers, the UTF-8 flag set on every name, the stripping-protection
attribute present, and the signer's public-key field carrying the certificate's own key.

`npm run verify:apk` (needs `pip install cryptography`) is the second opinion: `tools/verify-apk.py`
parses the files from scratch and lets OpenSSL check the RSA signatures, so a mistake shared by the
Node writer and the Node verifier cannot hide. It signs off on the reference APK too.

If a device ever refuses the v2 signature, `npm run build:apk:v1` produces `BOOYAH-FIRE-v1-only.apk`
— the same APK signed with JAR v1 only, which is all Android 5/6 understand.

## What's in it

- **Battle royale loop** — drop → loot → rotate with the zone → final circles → **BOOYAH** win screen.
- **Tactical map** — auto-opens during the drop (tap it to pick your landing spot), then `Tab`/`M`
  or a tap on the minimap opens it any time: zone rings, next circle, airdrops, loot tiers,
  vehicles and squadmates.
- **16 weapons** (pistols, SMGs, rifles, DMRs, snipers, shotguns) with a real TTK spread from
  0.43 s (AK47) to 1.43 s (AWM) against a level-2 vest, headshot multipliers, magazine/reserve ammo,
  reload timing, ADS spread, recoil, flinch and weapon attachments.
- **Gear & carrying capacity** — vest and helmet levels 0–3, and **3 backpack tiers** that are not
  cosmetic: level 3 turns 36 reserve rounds into 84 and roughly doubles every consumable stack.
- **Consumables & gadgets** — medkit, first aid, gloo wall (2.9 × 2.7 m, 340 HP, 34 s), frag
  grenade, smoke, flashbang, plus airdrops at 145 s and 320 s.
- **Vehicles** — up to 6 land vehicles (off-roader, buggy, bike) and 3 boats per island: enter with `F`,
  arcade handling with terrain/slope effects, running people over, and vehicles that soak bullets for
  their occupant, smoke when wrecked, then explode and eject the driver.
- **8 phases of the safe zone** (wait 32 → 12 s, shrink 32 → 11 s, ratio 0.63 → 0.80, 1 → 20 DPS).
- **AI opponents** that parachute in, loot gear and backpacks, rotate with the zone, take cover,
  burst-fire with distance-dependent accuracy, knock and revive each other, and fight to the end.
- **Squads** — solo (40 fighters), duo (48), squad (48), with knock/revive and spectate-on-death.
- **Characters & pets** — 12 characters and 6 pets, each with a small passive perk.
- **Progression** — 15 ranks, coins, diamonds, XP, 10 missions, a prize wheel, and a shop with
  character, gun and parachute skins. Saved to `localStorage` under `booyahfire_save_v1`.
- **Presentation** — bloom post-processing, procedural canvas textures, day/night island themes,
  and 100 % synthesized Web Audio (20 SFX, ambience and a soundtrack) — nothing is downloaded.

## Islands

Eight themes — Bermuda, Purgatory, Kalahari, Alpine, Ashlands, Sunset Cove, Stardust Night and
Deep Jungle — each 560 × 560 m with towns, roads, airfields and docks, 310–560 props, and a layout
generated from the match seed, so every drop is a different map.

## Controls & systems at a glance

```
drop ──▶ loot ──▶ gear up ──▶ zone rotates ──▶ top 10 ──▶ BOOYAH
```

| system | detail |
|---|---|
| zone | 8 phases, damage 1 → 20 DPS, minimum radius 11 m |
| gloo walls | 340 HP, 34 s lifetime, blocks bullets and sight |
| backpacks | lv1 ×4 reserve / ×1.3 stacks · lv2 ×5.5 / ×1.7 · lv3 ×7 / ×2.2 |
| vehicles | 8–9 per island · 120–260 HP · top speed 19–28 m/s · 1–4 seats · parked clear of walls, trunks and cliffs so you can always drive off |
| vehicles take damage | the car absorbs ~58 % of incoming fire, the occupant 42 % |
| knock / revive | 3 s revive → 40 % HP, 26 s bleed-out |

## Tooling (verification)

None of this is needed to *play*; it is how the game is kept honest. Everything runs in plain Node
with a DOM/2D-canvas shim — no browser, no WebGL, no bundler.

```bash
npm install          # only pulls the 'three' devDependency the headless harnesses import
npm run test:all     # assets + markup + stylesheet + simulation + view + full-app smoke test
npm run lint         # eslint: no-undef catches the classic "forgot to import" crash
npm run icons        # regenerate icons/ from the procedural artwork in tools/make-icons-ff.mjs
npm run build:apk    # pack the game into BOOYAH-FIRE.apk (toolchain in tools/apk-sign.mjs + tools/axml.mjs)
```

| check | what it guards |
|---|---|
| `tools/check-assets.mjs` | every `href`/`src`/import/importmap/service-worker reference exists on disk |
| `tools/check-html.mjs` | parses `index.html` with parse5: well-formed, ids unique, every `$('…')` in JS resolves |
| `tools/check-style.mjs` | balanced CSS, and every class the app toggles has a rule (a missing `.hidden` breaks everything) |
| `tools/test-sim.mjs` | 41 k frames of headless match simulation: TTK table, zone timing, landings, knocks, revives, loot, backpacks, and every land vehicle on 12 islands actually driven |
| `tools/test-view.mjs` | builds the whole three.js scene without WebGL: mesh/triangle/sprite budgets, LOD, pose paths, driving a car and wrecking it |
| `tools/test-dom.mjs` | boots the real app against a DOM shim: lobby → match → combat → loot → map → vehicles → death → results → menus → save → touch |
| `tools/test-apk-sign.mjs` | the APK wire format: verifies a real apksigner-signed APK, round-trips the binary manifest, signs and then tamper-checks `BOOYAH-FIRE.apk` |

The same `three` build the browser loads is the one the tests import (`vendor/` and
`node_modules/three` are byte-identical at r170), so a passing test really does exercise shipping code.

## Layout

```
freefire/
├── index.html              app shell, HUD markup, lobby, panels, importmap
├── manifest.webmanifest    PWA manifest (fullscreen, maskable icons)
├── sw.js                   offline service worker, cache 'booyah-v1', scoped to /freefire/
├── icons/                  generated PNG icons (192, 512, maskable 512)
├── vendor/                 three.js r170 (+ BufferGeometryUtils), resolved via the importmap
├── src/
│   ├── util.js             math, RNG, noise, ray casts, formatters
│   ├── data.js             weapons, gear, backpacks, vehicles, characters, pets, ranks, loot tables, economy
│   ├── tex.js              procedural canvas textures (grass, sand, wood, metal, sky, gloo, smoke…)
│   ├── sim.js              the whole battle-royale simulation (pure logic, no three.js, no DOM)
│   ├── world.js            terrain, water, sky, merged props, zone wall, airdrop crates, gloo walls
│   ├── view.js             fighters, parachutes, vehicles, name plates, camera, tracers, particles, loot
│   ├── post.js             minimal bloom post-processing (core three.js only)
│   ├── audio.js            synthesized Web Audio engine (SFX, ambience, music, vehicle engines)
│   ├── hud.js              minimap, compass, health/armor/ammo, speedometer, kill feed, damage pops
│   └── main.js             bootstrap: lobby, panels, input (keyboard/mouse/touch), save, game loop
├── android/keystore/       dev signing key + certificate (rebuilds upgrade in place)
├── BOOYAH-FIRE.apk         built by `npm run build:apk` — sideload this on Android
├── BOOYAH-FIRE-v1-only.apk fallback build (JAR v1 only) for stubborn installers
└── tools/                  verification harnesses, the icon generator and the APK toolchain
    ├── apk-sign.mjs        zip writer + APK v1/v2 signer & verifier (no SDK)
    ├── axml.mjs            binary AndroidManifest.xml / resources.arsc rewriting
    ├── verify-apk.py       independent v1/v2 verification with OpenSSL
    └── build-apk.mjs       the whole APK build: bundle → inline → sign → verify
```

`sim.js` never imports three.js — it is a pure, deterministic function of (seed, input) — which is
what makes the headless tests meaningful: the same match logic that ships is exercised 41 000 frames
at a time, including driving every land vehicle on a dozen islands off the line.

## Notes

- Runs in any WebGL2 browser; without WebGL it shows a readable error instead of a blank screen.
- Quality settings (auto/low/high) drop bloom, shadows and pixel ratio for weaker devices.
- The service worker is scoped to `/freefire/`, so it never interferes with anything else on the
  same origin.
