# SAWT+ — Volume Booster & Speaker

**Sound beyond the gauge. Bla tachawch. Bhal baffle.**

A phone-first **volume booster and sound amplifier** web app: push audio past the normal level, shape bass and treble, and keep it clean with a limiter + soft-clip stage. Installable as a PWA, works offline, no ads, no server.

Three sources run through the same clean boost chain:

- **MIC** — live microphone amplifier for quiet rooms, TV, and conversations (headphones recommended to avoid feedback).
- **FILE** — boost your own MP3 / WAV / OGG / M4A files, entirely on-device.
- **SOUNDS** — mixable synthesized ambience and noise colors: rain, ocean, wind, fire, fan, white, pink, and brown noise.

Plus: boost dial ×0.5–×8 (+/− dB readout), live level meter with CLIP light, bass / treble, five presets (CLEAN / SPEECH / MUSIC / BASS / NIGHT), output level, mute, and a **NO DISTORTION** limiter.

## Run

With **Node.js 22+**:

```sh
npm run dev
# Open http://localhost:3000
```

The included server needs **no installed npm packages**, binds to `0.0.0.0`, and accepts live-preview hosts. Use `PORT=8080 npm run dev` to change the port. Any static HTTP server works (`python3 -m http.server 8000 --bind 0.0.0.0`). Do not open the HTML files over `file://`; ES modules need an HTTP origin.

### Install on a phone

Open the site in the phone browser over HTTPS or localhost, then tap **INSTALL** (Android / Chrome) or **Share → Add to Home Screen** (iPhone). The app runs full-screen and offline after installation: modules, fonts, icons, and the app shell are precached by `sw.js`.

### Android APK (GitHub Releases)

A native Android wrapper around the same app is built automatically by GitHub Actions (`.github/workflows/sawt-apk.yml`) and published on the repository's Releases page:

- **Direct download:** `https://github.com/zakariabouifri03-max/neurio/releases/download/sawt-latest/sawt-plus.apk`
- The `sawt-latest` rolling tag always carries the newest build; each build replaces the asset.
- On the phone, open the link (or download `sawt-plus.apk` and tap it) and allow **install from unknown sources** when prompted.

The APK is a thin WebView shell (`android/`) that loads a self-contained bundle of this web app from its own assets — no server, works offline, same interface. It requests only the microphone permission (for MIC amplifier mode). Builds are signed with a CI-generated sideload key, not a Play Store key. To rebuild locally: `node tools/build-android-assets.mjs`, then `gradle assembleRelease` in `android/` (Android SDK 34 + JDK 17 required).

### Honest limits

A web app can only boost audio that plays **through it** (its files, its sounds, and the live mic pass-through). It cannot raise the system volume of other apps — the OS owns that. It cannot override phone audio hardware. Long loud sessions can damage hearing; the output-level control and mute are there for a reason. Everything stays in the browser: no accounts, no analytics, no network calls.

## Previous games

The same site keeps the earlier prototypes:

- [HOLLOWPINE](hollowpine.html) — 3D woodland-survival game with downloadable GLB models; [models documentation](models/README.md).
- [GHOSTLINE](ghostline.html) — urban hacking prototype; [documentation](GHOSTLINE.md).
- [Bash Baqi Racing](racing.html) — kart racing; [documentation](RACING.md).

They are linked from SAWT+ (footer / About) and from HOLLOWPINE's Settings panel. Saved-game keys, source, and models stay separate.

---

# HOLLOWPINE

**The wild has no mercy. Make it to morning.** — playable at [hollowpine.html](hollowpine.html).

An original, playable **3D woodland-survival prototype** with downloadable environment, character, and equipment models. Inspired by the forest-survival genre, including *The Forest*; a stylized prototype, **not a recreation or an Endnight Games product**. All geometry is original procedural work.

## Play

Click **Begin your story**. You start with a hatchet, an unlit torch, two portions of berries, and two flask charges.

1. **Gather essentials.** Pick up branches, stones, wild flax, and berries. Only marked pines can be chopped; four hatchet strikes fell one for five wood.
2. **Light a campfire.** Bring **4 wood + 4 stone** to camp and open Crafting with `C`.
3. **Build a lean-to.** Gather **8 wood + 4 fiber** and build the shelter at camp.
4. **Rest until dawn.** Approach the shelter and press `E` with the fire lit and food / water ≥ 20. Reach morning to complete the objective.

### Controls

| Action | Keyboard / mouse |
| --- | --- |
| Move | `W A S D` or arrow keys |
| Sprint / Jump | `Shift` / `Space` |
| Look around | Drag the 3D world |
| Gather / chop / build / tend / refill / rest | `E`, near the relevant object |
| Swing hatchet | `F`, or click the world with the hatchet equipped |
| Equip hatchet / torch | `1` / `2` |
| Eat berries / drink water | `3` / `4` |
| Crafting / forest map | `C` / `M` |
| Pause / close a panel | `Esc` |

Touch devices have directional, Run, and contextual-action controls plus tappable equipment / crafting buttons.

### Survival systems

Vitals (health, stamina, hunger, thirst, warmth), camp crafting with fuel, flask refill at the lakeside spring, day/night cycle, wandering deer and wolves (optional threats), live minimap with waypoints, collapse-and-recover flow, and local saves. Menus pause the simulation. Settings offers automatic / high / low graphics quality, soundscape, night threats, camera sensitivity, and a confirmed reset.

This is a compact **single-player survival slice**: finite resource nodes, two crafting recipes, one first-night objective. No caves, swimming, multiplayer, free-form construction, or copied game assets.

## Original 3D models

Open **3D Models** for a live, draggable / zoomable preview. **Download .GLB** exports locally. Ready-made files are included:

| File | Contents |
| --- | --- |
| [Forest campsite](models/hollowpine-forest-campsite.glb) | Standalone conifer-forest diorama, rocky ground, ferns, lean-to, and campfire |
| [Survivor](models/hollowpine-survivor.glb) | Original backpacked hiker, beanie, boots, clothing, and field hatchet |
| [Field hatchet](models/hollowpine-field-hatchet.glb) | Standalone steel-headed, wood-handled prop |
| [ECHO operative](models/echo-operative-carbon.glb) | Preserved GHOSTLINE character |

All are **self-contained glTF 2.0 binary files**, PBR materials, meters, Y-up. Import in Blender via **File → Import → glTF 2.0 (.glb/.gltf)**.

**These are static mesh / scene exports.** The character has named parent-transform articulation, but is **not a skinned production rig and contains no embedded animation clips**. The campsite is a compact diorama, not the entire playable map. See [model notes](models/README.md).

## Implementation

- Local **Three.js r170**, GLTFExporter, BufferGeometryUtils; no runtime npm dependencies.
- Seeded procedural geometry, generated textures, instanced foliage, articulated hiker / animals, moving water, day/night lighting, adaptive quality.
- Web Audio synthesized soundscape (opt-in) and SAWT+ synthesized ambience; no external recordings or CDNs.
- Local Instrument Serif / Space Grotesk / IBM Plex Mono fonts; responsive HTML/CSS; keyboard and touch input; reduced-motion support.

```text
index.html                 SAWT+ volume booster app (the current app)
src/sawt/
  app.js                   Boost UI, presets, meter, persistence
  audio.js                 Boost chain: EQ → gain → limiter → soft-clip
  style.css                Phone-first pro-audio interface
icons/sawt.*               App icon (SVG + PNG), generated by tools/make-sawt-icons.mjs

hollowpine.html            HOLLOWPINE survival game
src/hollowpine/            Its runtime, rules, models, world, map, viewer, sound
models/                    Ready-to-import GLBs and model notes
assets/fonts/              Local fonts and licenses
vendor/                    Local Three.js, addons, and MIT license
sw.js                      Offline cache with network-first updates
tools/serve.mjs            Dependency-free static server

ghostline.html             Preserved urban hacking game + src/ghostline/
racing.html                Preserved kart racing game + src/*.js
```

## Verify

```sh
npm ci
npm test

# Keep npm run dev running in another terminal:
npm run test:browser          # SAWT+ + HOLLOWPINE browser suites
npm run test:browser:sawt     # SAWT+ only
npm run test:browser:hollowpine
npm run test:browser:ghostline

# Optional: rebuild the archived racing game's single-file bundle
npm run build:racing
```

The unit suite covers survival / mission transitions, archived GHOSTLINE rules, and Khronos glTF validation of all four GLBs (self-contained buffers / images, static-export contract, zero errors / warnings).

The **SAWT+ browser suite** exercises the real app: boost math and limiter, ambient tiles through the meter, presets and saved settings, microphone amplification (fake media stream) and denial feedback, WAV file boosting and loop, phone-viewport layout with touch, mute, and offline boot + offline audio.

The **HOLLOWPINE browser suite** exercises the WebGL game: movement / pause, gathering / felling, crafting, night threats and torch protection, dawn completion, map waypoints, model viewing and all three exports, recovery, settings, saved and offline reloads, reset, mobile touch, portrait / landscape layouts, and default-quality startup. It refreshes the three forest GLBs through the real download controls. Screenshots are diagnostic files in ignored `.cache/`.

The browser helper uses Playwright with an npm-provided Linux Chromium. It supports:

- `BASE_URL=http://...` — test an already running server (include `/hollowpine.html` or `/ghostline.html` for the game suites).
- `CHROMIUM_PATH=/path/to/chromium` — use an existing compatible Chromium executable.

The racing bundle `bash-baqi-racing.html`, dependencies, browser binaries, and diagnostic screenshots are intentionally not versioned.

## Third-party licenses

Three.js / GLTFExporter / BufferGeometryUtils: MIT; see [`vendor/LICENSE`](vendor/LICENSE). Font licenses are included under `assets/fonts/`. Khronos glTF Validator is a development-only dependency. All app, woodland, survivor, equipment, and archived city / operative work was authored for these prototypes.
