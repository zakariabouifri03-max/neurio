# Drift — Ocean Survival

**A little raft. An endless ocean.**

An original, playable 3D raft-survival game for the browser. Hook supplies out of the tide, expand your wooden raft, craft a self-sufficient home, and keep an eye on the shark. The living-ocean update adds reflective turquoise swells, a first-person deck view, and Palmwood Cove: a palm-covered beach with a furnished timber-and-thatch shelter.

All models, ocean effects, sail artwork, item illustrations, and sound effects are procedural/original. This is a small single-player prototype inspired by raft-survival games, **not an official Raft release**; it uses no assets from that game.

## Play

```sh
npm run dev
# Open http://localhost:3000/drift.html
```

Node 18+ is sufficient to run the server. **No npm install or build step is needed to play.** The server binds to `0.0.0.0` and works through hosted preview proxies. To choose another port:

```sh
PORT=8000 npm run dev
```

Any ordinary static server also works:

```sh
python3 -m http.server 8000 --bind 0.0.0.0
```

Use a modern browser with WebGL 2 enabled. On a slower device, open **Pause → Graphics quality → Light**. This disables scene reflections and shadows, while retaining waves, sky reflections, and gameplay. The game provides a recovery screen if WebGL is unavailable or the graphics context is lost.

## Your first few minutes

1. **Click floating driftwood, bottles, leaves, crates, or barrels.** Your hook reels them in. Pressing `E` also hooks nearby supplies.
2. Press **`B`**, then click a highlighted raft edge. A foundation costs **4 driftwood + 2 plastic**. `Esc` cancels building.
3. Press **`C`** for crafting. Weave rope, then build a **water purifier** on an empty foundation. It makes a fresh drink every 60 seconds.
4. Select **water `[5]`** or **coconut `[6]`**, then click or press `E` to consume it. Full meters never waste a supply.
5. Follow your chapter objectives. Build a growing bed for renewable food, or a grill to make your food more nourishing.
6. Click **Set course** or press **`G`** to paddle automatically toward Palmwood Cove. Move manually, switch tools, or press `G` again to cancel. You can also equip the **paddle `[3]`** and steer yourself. Approaching a new island grants beachcombing supplies once per voyage.
7. Click **Step aboard** or press **`V`** for the first-person view. Drag to look around; movement keys walk on your existing raft. Press `V` again for the building overview.
8. When a shark circles close, select the **spear `[4]`** and click or press `E` to send it away.

### Controls

| Action | Desktop |
|---|---|
| Walk on the raft | `W A S D` or arrow keys |
| Collect a floating supply | Click it with the hook selected |
| Use selected tool / nearest supply | `E` or `Space` |
| Look around / orbit | Drag the ocean with either mouse button |
| First-person deck view / raft overview | `V` or the viewpoint button |
| Set / cancel course for Palmwood Cove | `G` or the cove button |
| Zoom in overview | Mouse wheel |
| Choose hook / hammer / paddle / spear / water / coconut | `1`–`6` |
| Build a foundation | `B`, then click an outlined edge |
| Crafting recipes | `C` |
| Backpack | `Tab` or `I` |
| Help | `H` |
| Photo / model inspection mode | `P`, or Pause → Just enjoy the view |
| Cancel building, close a panel, or pause | `Esc` |

**Phones and tablets:** tap supplies to collect, drag the ocean to look around, pinch to zoom in overview, and use the on-screen joystick. **Step aboard** also works on touch screens. Tap a hotbar item to equip it; the round action button uses it. Backpack and crafting are touch-accessible. Portrait and landscape layouts are supported.

## What is included

- A displaced ocean with four shared CPU/GPU wave components, sun glints, crest/shoreline foam, shallow-water caustics, and scene reflections.
- Three sea states in **Pause → Sea state**: **Calm lagoon**, **Rolling swells**, and **Open ocean**. The raft and salvage follow the same waves you see.
- First-person deck and orbit cameras, an animated cloth sail, walking castaway, drifting salvage, and a circling shark.
- Three irregular tropical islands, detailed coconut palms and ferns, swaying foliage, textured sand/wood/bark, clouds, and birds.
- Palmwood Cove’s raised wooden shelter, thatched roof, porch, furnishings, and flickering torch lights. Automatic course-setting stops the raft offshore; **walking ashore and entering the cabin are not implemented**. The complete island is available as an editable 3D model.
- A six-slot toolbelt, survival meters, resource inventory, minimap, compass, and four objective chapters.
- Connected foundation placement, up to 64 foundations. Structures cannot overlap or be placed on the water.
- Six recipes: foundation, woven rope, water purifier, grill, growing bed, and sail.
- Hunger, thirst, healing, starvation, shark damage, a game-over screen, and confirmed new-voyage resets.
- Optional synthesized ocean ambience and interaction sounds. Sound starts muted.
- Photo mode, quality settings, fullscreen where supported, and downloadable 3D raft/island snapshots.

## The 3D models

Two ready-to-import, self-contained **glTF 2.0 binaries** are included:

| Model | Download | Contents |
|---|---|---|
| Starter raft | [`models/drift-raft.glb`](models/drift-raft.glb) | Approximately 1.2 MB; raft, castaway, equipment, and embedded timber/sail textures |
| Palmwood Cove | [`models/palmwood-cove.glb`](models/palmwood-cove.glb) | Approximately 8 MB; sculpted island, coconut palms, foliage, rocks, furnished shelter, vertex colors, and embedded surface textures |

Open either model in Blender, a glTF viewer, or a compatible game engine.

Export **your own expanded raft** or the island at any time from **Pause → Your raft as a 3D model / Palmwood Cove 3D model → Get .glb**. Export is entirely local and works offline. These are static mesh snapshots, not animated rigs or a copy of the ocean shader, dynamic lights, or gameplay. See [`models/README.md`](models/README.md).

## Saving and offline play

Progress is saved to this browser's `localStorage` after important actions and every eight seconds. Reloading restores supplies, needs, structures, foundations, time, visited islands, and settings (including sea state and viewpoint). Older saves are supported; boats stranded by the revised coastline are moved into safe water without losing their inventory or progress. No accounts, cloud storage, or backend are involved. Private-browsing restrictions or storage limits can prevent saving; the game still runs and reports that state.

A service worker caches the entire game after the first successful online visit. Subsequent visits work offline. The installable web manifest supports adding Drift to your home screen. Fonts and Three.js are bundled locally; there are no external CDN dependencies.

A **new voyage** requires confirmation because it replaces the local save. There is no multiplayer or online synchronization.

## Optional single-file game

For a portable HTML copy that can be opened directly from disk:

```sh
npm install
npm run bundle -- --drift
# dist/drift.html
```

The exporter embeds Three.js, game logic, CSS, fonts, and icons. It does not need a server or service worker. Generated bundles are ignored by Git. The normal hosted game does not need this build.

## Tests

The core rules have no browser or npm dependency:

```sh
npm test       # 42 tests across Blockyard, Drift, saves, physics, and waves
npm run check  # Parse all game modules and validate both manifests
```

Browser integration tests use Playwright Core and an installed Chromium/Chrome binary. Start the game server in a separate terminal first:

```sh
npm install
BROWSER_EXECUTABLE_PATH=/path/to/chromium npm run test:drift
```

`npm run test:ocean` runs just the living-ocean checks. `TEST_BASE_URL` optionally selects another server. `BROWSER_SINGLE_PROCESS=1` supports constrained Chromium installations; the suites use separate browser launches for desktop and touch. Tests cover hooking, foundation building, crafting, water production, consumption, walking, orbit/zoom, paddling, shark defense, pause/settings/photo mode, GLB download, save/reload, offline reload, confirmed resets, mobile taps/joystick, first-person tools and camera, sea states, course cancellation/arrival, one-time island rewards, island GLB exports, and portrait/landscape controls. Screenshots and test downloads go to the ignored `.arena/` directory.

Both included GLBs have also passed the Khronos glTF validator with **zero errors, warnings, or informational issues**.

## Project structure

```text
drift.html                 Game interface and local import map
src/raft/
  game.js                  Main loop, input, hook animation, movement, building
  models.js                Procedural 3D models and static mesh batching
  world.js                 Scene lighting, animated sky, birds, island integration
  ocean.js                 Displaced water, foam, caustics, and planar reflections
  waves.js                 Shared CPU/GPU waves, buoyancy, and safe coastlines
  tropics.js               Terrain, palms, foliage, furnished shelter, and wind
  textures.js              Locally generated timber, bark, sand, and water textures
  rules.js                 Pure survival, crafting, placement, and save rules
  ui.js                    HUD, inventory, recipes, dialogs, minimap
  icons.js                 Original SVG interface/item illustrations
  audio.js                 Web Audio ocean ambience and sound effects
  export.js                Local glTF 2.0 / GLB writer
  style.css                Responsive desktop/touch interface
models/drift-raft.glb        Ready-to-import starter raft
models/palmwood-cove.glb     Ready-to-import tropical island and shelter
assets/fonts/               Local fonts with their OFL licenses
vendor/                     Three.js r170 and geometry utilities
sw.js                       Versioned, network-first offline cache
manifest.webmanifest        Installable app metadata
```

The repository's previous racing game is preserved at [`racing.html`](racing.html), with its original `src/` modules and video tools. Its optional single-file build is still available with `node tools/build-singlefile.mjs --racing`.
