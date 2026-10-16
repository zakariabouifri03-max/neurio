# Nour Studio, Blockyard, and Drift

The root app is **Nour Studio**, a local browser companion for clearer video-call camera framing and lighting. It offers adaptive exposure, manual light/contrast/warmth, and 480p/720p/1080p source profiles. Camera video is processed on-device and is never uploaded by the app. It **cannot speed up an internet connection** or restore details missing from the camera feed. A browser cannot replace WhatsApp's camera directly; on a computer, use the optional OBS Virtual Camera bridge described in the app. This is local image processing, not a generative-AI face replacement or an installed AI model.

**Android APK:** [download Nour Studio directly from GitHub](https://github.com/zakariabouifri03-max/neurio/releases/download/nour-studio-v1.0.0/NourStudio-Android-v1.0.0.apk). See [`NOUR-ANDROID.md`](NOUR-ANDROID.md) for installation and the WhatsApp/Android limitations.

The original playable 3D platformer, **Blockyard — Cloud Hop**, is at [`blockyard.html`](blockyard.html). The **Drift** raft-survival game is at [`drift.html`](drift.html), and the original racing demo is at [`racing.html`](racing.html).

## Run the apps

```sh
npm run dev
# Nour Studio: http://localhost:3000/
# Blockyard:   http://localhost:3000/blockyard.html
# Drift:       http://localhost:3000/drift.html
# Racing:      http://localhost:3000/racing.html
```

Node 18+ is enough to serve the apps. **No npm install, account, or external CDN is needed to run Nour Studio or play the games.** The server listens on `0.0.0.0:3000`, accepts preview hosts, and uses relative asset URLs. Set `PORT` to change the port. For webcam access, use HTTPS or `localhost` and grant the browser camera permission.

Nour Studio's video pipeline runs locally in the browser. The low-data profile limits the source to 640×480/24 fps; the balanced and high profiles cap it at 1280×720/30 fps and 1920×1080/30 fps. A cap can lower the amount of source video, but WhatsApp controls final compression and upload bitrate. These controls do not increase network speed.

## Blockyard — Cloud Hop

**Small blocks. Big adventures.**

An original, playable 3D obstacle-course game with a customizable blocky character, floating islands, collectible coins, and forgiving checkpoints. Inspired by the playful style of blocky games like Roblox; **not an official Roblox game**, and no Roblox assets, accounts, Robux, or multiplayer are involved.

The previous **Drift** raft-survival game remains fully available at [`drift.html`](drift.html), with its own saved voyage. See [`DRIFT.md`](DRIFT.md). The original racing demo is preserved at [`racing.html`](racing.html).

## Play Blockyard

```sh
# After npm run dev:
# Open http://localhost:3000/blockyard.html
# Drift is at http://localhost:3000/drift.html
```

Use a current browser with WebGL 2 and hardware acceleration. **Pause → Graphics → Light** lowers rendering resolution and disables shadows. Recovery screens handle unavailable WebGL or a lost graphics context.

## Your adventure

Follow the coins across six checkpoint islands:

1. **Sunny Square** — meet your character and find your feet.
2. **First steps** — hop between the floating blocks.
3. **Hotfoot** — jump over the coral-red lava strips.
4. **Cloud movers** — ride the blue moving platforms.
5. **Bounce garden** — use the yellow spring to reach the high blocks.
6. **Sky summit** — clear the rotating pink bar and reach the gold arch.

The 24 sky coins are an optional side quest. Checkpoints must be reached in order; touching each island saves your progress. Falling or touching a hazard returns you to your latest checkpoint. Passing through the final arch completes the run and records your local personal best.

### Controls

| Action | Desktop |
|---|---|
| Move | `W A S D` or arrow keys, relative to the camera |
| Jump | `Space` |
| Double jump | Press `Space` again while airborne |
| Sprint | Hold `Shift` |
| Orbit / look | Drag the game with either mouse button |
| Zoom | Mouse wheel |
| Respawn at checkpoint | `R` |
| Help | `H` |
| Pause / close a menu | `Esc` |

**Phones and tablets:** use the joystick and **JUMP** button; tap jump a second time in the air. Drag the world to look around and pinch to zoom. The circular reset button returns to your checkpoint. Portrait and landscape layouts are supported.

Jump buffering, brief coyote time, air steering, swept landing checks, solid block sides, and moving-platform carry make the course responsive without making it an automatic runner.

## Make it yours

Open **Your avatar** or the bottom-left character button. Choose from four free outfits: **Citrus club**, **Ocean explorer**, **Berry nice**, and **Electric blue**. Changes appear in the actual game and in a rotating 3D preview, and save automatically. They are cosmetic, not upgrades or purchases.

Sound is optional and starts muted. All jump sounds, coin chimes, and checkpoint celebrations are synthesized locally with Web Audio.

## Download the 3D models

- **[`models/blockyard-avatar.glb`](models/blockyard-avatar.glb)** — original blocky adventurer in the Citrus outfit; approximately 137 KB, including the painted face texture.
- **[`models/blockyard-cloud-hop.glb`](models/blockyard-cloud-hop.glb)** — complete floating course, islands, obstacles, foliage, benches, coins, flags, and signs; approximately 2.7 MB.

Click **Get the 3D model** in the bottom-right corner to export either model locally. Exporting your character uses your selected outfit. The avatar dialog also has a direct download button.

These are self-contained **glTF 2.0 binaries** for Blender and compatible 3D apps. They are static geometry/materials, **not** rigged avatars, Roblox Studio projects, or scripts. The game supplies movement, collision, animation, particles, and sound separately. See [`models/README.md`](models/README.md).

Both models have been checked using the Khronos glTF validator. Existing Drift raft and island models remain in `models/` as well.

## Saves and offline play

Blockyard uses its own `localStorage` key, `blockyard-cloud-hop-v1`; it does not overwrite Drift saves. Checkpoints, coins, elapsed time, outfit, sound/quality preferences, and your personal best persist. Reloading places you at your latest checkpoint, rather than in midair.

Menus pause the timer and obstacles. Hiding the browser tab pauses the game, and blur clears held movement input. Restarting requires confirmation, resets the current course, and preserves your outfit and personal best. If storage is blocked or full, the game remains playable and reports that saves are unavailable.

After one successful online visit and service-worker installation, **Nour Studio, Blockyard, and Drift can reload offline**. All scripts, fonts, textures, icons, and sounds are local or procedurally generated. Nour Studio still needs a camera permission; model export also works offline. There is no video upload or server-side save.

## Optional portable HTML

```sh
npm install
npm run bundle                 # dist/blockyard.html
npm run bundle -- --drift       # dist/drift.html
npm run bundle -- --racing      # dist/bash-baqi-racing.html
```

The single-file game embeds scripts, CSS, fonts, and icons, includes third-party licenses, and can be opened directly from disk. It needs no server or service worker. Generated bundles are ignored by Git; the normal hosted game needs no build.

## Checks

```sh
npm test        # 50 dependency-free processing, rules, physics, save, and wave tests
npm run check  # Parse all app modules and validate the three manifests
```

The platformer tests include a continuous, hazard-free traversal of every intended jump using the same physics as the game.

For browser integration tests, install dependencies and run the server in another terminal:

```sh
npm install
BROWSER_EXECUTABLE_PATH=/path/to/chromium npm run test:browser
# Preserved raft-game suites:
BROWSER_EXECUTABLE_PATH=/path/to/chromium npm run test:drift
```

The new suite covers movement, coin collection, double jumps, landing, camera controls, pause/audio/quality, real 3D customization, both GLB exports, checkpoints, falls, lava, moving platforms, springs, finish conditions, persistence, offline reload, restart confirmation, and touch/portrait/landscape input. Screenshots and test downloads stay in ignored `.arena/`.

`TEST_BASE_URL` overrides the page URL. `BROWSER_SINGLE_PROCESS=1` supports constrained Chromium environments; desktop and touch tests use separate browser launches.

## Structure

```text
index.html                 Blockyard interface and local import map
src/blockyard/
  game.js                  Fixed-step loop, input, camera, particles, audio, export
  rules.js                 Pure physics, course data, progression, save validation
  models.js                Original blocky avatar, scenery, textures, model helpers
  world.js                 Floating islands, obstacles, clouds, lighting, collectibles
  ui.js                    HUD, customization, menus, model downloads, route map
  icons.js                 Local SVG interface icons
  style.css                Responsive desktop/touch design
src/raft/                  Preserved Drift game and shared GLB writer
models/                    Downloadable original 3D models
assets/fonts/              Locally bundled fonts and OFL licenses
vendor/                    Three.js r170 and geometry utility, with license
sw.js                      Network-first offline cache for both games
```
