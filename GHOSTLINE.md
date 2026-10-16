# GHOSTLINE

Archived game: open [`ghostline.html`](ghostline.html). The home page now hosts HOLLOWPINE.

**The city is your backdoor.**

An original, playable **3D urban hacking prototype** for the browser. Explore a stylized nighttime South Bank district, breach the surveillance network, and get back to the safehouse. Inspired by the urban-hacking genre; not affiliated with Ubisoft or Watch Dogs.

The previous **Bash Baqi Racing** game is preserved at [`racing.html`](racing.html), with its documentation in [`RACING.md`](RACING.md). It is also linked from GHOSTLINE's Settings panel. Its source, saves, icons, and videos remain intact.

## Run

Requires **Node.js 22+** for the included development server and testing tools:

```sh
npm run dev
# Open http://localhost:3000/ghostline.html
```

The server binds to `0.0.0.0`, accepts preview hosts, and needs **no installed npm packages** to serve the game. Set `PORT` to use another port.

Any ordinary static HTTP server also works:

```sh
python3 -m http.server 8000 --bind 0.0.0.0
```

Do not open `index.html` directly with `file://`: ES modules need an HTTP origin. A current WebGL 2-capable browser with hardware acceleration is recommended.

### Deploy

Serve the repository as a static site, including `src/`, `vendor/`, `assets/`, `icons/`, `sw.js`, and the manifest. Runtime imports and fonts are local; there is no CDN, API key, backend, account, or build step. Relative paths also work on a subdirectory deployment such as GitHub Pages.

The versioned service worker precaches the game and fonts. After the first successful cache installation, the game can reload offline. Application requests are network-first so online updates are not hidden behind a permanent cache. Progress and preferences are saved locally when storage is available.

## Play

Click **Enter the city**. Breach all three NEXUS relays, then return to the green safehouse beacon to complete **Ghost in the grid**. Continue exploring after the operation, or replay it.

| Action | Control |
| --- | --- |
| Move | `W A S D` or arrow keys |
| Look around | Click/touch and drag the world |
| Sprint | `Shift` |
| Jump | `Space` |
| Breach a nearby relay / loop a camera | `E` or the on-screen Hack button |
| Toggle network scan | `Q` |
| District blackout | `B` |
| District map | `M` |
| Pause / close a panel | `Esc` |

On phones and tablets, use the directional pad, Run / Jump buttons, and on-screen abilities. No pointer lock is required.

### Mechanics

- **Relays:** get within 13 meters and initiate a 2.4-second breach. Moving out of range breaks the connection. Each relay grants 150 XP; extracting grants another 300 XP.
- **Security cameras:** hack one to loop its feed for 20 seconds and reduce your trace.
- **Network scan:** reveals devices, network links, and a tactical street grid.
- **Blackout:** dims the district, disables detection for 8 seconds, and reduces trace. The rig takes 25 seconds to recharge.
- **Patrol drones:** getting too close raises trace, especially while sprinting. At 100%, you return to the safehouse; breached relays remain secure. Move away or trigger a blackout to evade detection.
- **Map:** select a relay or click a walkable street to place a waypoint. The minimap reflects your position, heading, relays, drones, and extraction point.
- **Checkpoint:** relay progress, elapsed operation time, position, jacket palette, and preferences survive reloads. A breach in progress is not restored.
- **Settings:** adaptive / high / low quality, rain, optional synthesized sound, camera sensitivity, and a two-click operation reset.

This is a compact sandbox prototype, not a full commercial open-world game. Traffic and pedestrians are ambient; cars are not driveable. There is no combat, multiplayer, backend hacking, or real-world network access. London is an original fictionalized block layout, not a geographic reconstruction.

## Original 3D model

The **Operative** tab contains a live, draggable 3D viewer and three jacket palettes. **Download 3D Model** exports the selected palette directly to a GLB file.

A ready-to-use carbon model is also included:

**[`models/echo-operative-carbon.glb`](models/echo-operative-carbon.glb)**

- Original geometry generated in `src/ghostline/operative.js`; no borrowed game assets.
- glTF 2.0 binary, approximately 2 meters tall, Y-up, forward along −Z.
- Named parent groups for the spine, head, shoulders, elbows, hips, and knees.
- PBR materials, a utility backpack, cap / hood, half-mask, boots, radio, and profiler phone.
- **Static pose export with articulated parts.** The game animates the node transforms procedurally; the export does not claim a skinned skeleton, embedded animation clips, or production-ready rigging.
- Import into Blender using **File → Import → glTF 2.0**.

## Technical notes

- **Three.js r170**, vendored locally, plus its GLTF exporter and geometry utilities.
- Seeded procedural architecture, window / pavement textures, street furniture, signs, foliage, vehicles, and character models.
- Material-batched static geometry and character parts, collision-aware third-person movement / camera, daylight-balanced night lighting, fog, emissive windows, local light pools, and rain.
- Responsive HTML/CSS HUD, locally hosted Space Grotesk and IBM Plex Mono fonts, native modal dialogs, keyboard focus states, and touch controls.
- Adaptive quality drops render resolution, shadows, and pedestrian density when rendering is persistently slow.
- Web Audio soundscape is opt-in and synthesized, with no audio downloads.

```text
ghostline.html             GHOSTLINE interface
racing.html                Preserved racing game
src/ghostline/
  main.js                  Game loop, input, camera, HUD, storage, interactions
  city.js                  City geometry, ambient traffic, cameras, drones, weather
  operative.js             Original articulated character and civilians
  rules.js                 Pure mission, collision, and persistence helpers
  map.js                   Tactical map and minimap
  model-viewer.js           Interactive character preview and GLB export
  sound.js                 Synthesized soundscape
  style.css                Responsive interface and local fonts
models/                    Ready-to-import character model
assets/fonts/              Local fonts and their licenses
vendor/                    Three.js and its MIT license
sw.js                      Versioned offline cache, network-first updates
tools/serve.mjs            Dependency-free, preview-compatible static server
tests/                     Unit and browser integration tests
```

## Verify

Install test/build dependencies once:

```sh
npm ci
npm test

# In a second terminal while the game server is running:
npm run test:browser:ghostline
```

`npm test` checks mission transitions, timed / interrupted breaches, range guards, XP, extraction, save validation, storage failures, collision sliding, boundaries, and deterministic RNG.

`npm run test:browser:ghostline` uses Playwright and a Chromium binary provided by an npm package (no browser-CDN download required). It exercises the actual WebGL app: deployment, movement, pausing, tools and cooldowns, maps and waypoints, camera hacking, the full three-relay / extraction loop, model viewing / palettes / GLB validation, settings, persisted and offline reloads, and mobile controls / resizing. It refreshes the included carbon GLB from the actual exporter. Diagnostic screenshots stay in the ignored `.cache/` folder.

- `BASE_URL=http://...` changes the test server URL.
- `CHROMIUM_PATH=/path/to/chromium` uses an existing browser instead of the npm-provided Linux Chromium.

The archived racing game's single-file build also remains available:

```sh
npm run build:racing
```

This writes the ignored `bash-baqi-racing.html` bundle. Large browser binaries, npm dependencies, cache files, and test screenshots are intentionally not versioned.

## Third-party licenses

Three.js / GLTFExporter / BufferGeometryUtils: MIT, see [`vendor/LICENSE`](vendor/LICENSE). Font licenses are included under `assets/fonts/`. All city and operative geometry is original procedural work for this prototype.
