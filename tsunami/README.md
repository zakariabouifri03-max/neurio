# 🌊 TSUNAMI — survival on the Moroccan coast

لعبة نجاة ثلاثية الأبعاد كاملة فالمتصفح — كتفيق فالساحل، الموجة كتجي، كتهرب للمدينة، كتاخد الطونوبيل، وكتطلع للجبل باش تعيش.
A full 3D survival game in the browser — you wake on the beach, a tsunami wipes the coast, you flee
through the town, take a pick-up, drive up the mountain and survive there while disasters keep coming.

No build step, no assets, no CDN: **everything is procedural** (terrain, city, ocean, textures, sound)
and Three.js r170 is vendored in `vendor/`.

---

## ▶️ How to play — كيفاش تلعب

Serve the folder with any static server (ES modules + import map need `http://`, they do not work over `file://`):

```bash
cd tsunami
python3 -m http.server 8000
# → open http://localhost:8000
```

## 🖥 Main menu — المينو

The game opens on a **live 3D menu**: a slow drone shot orbiting above the fishing town's roofs,
looking out over the bay, with traffic and villagers moving below and the full post pipeline
running behind the panel. From there:

- **CONTINUE** — only offered when a run is saved (the slot summary shows day, chapter, clock, difficulty and playtime).
- **NEW GAME** — a second page picks the **difficulty** (CALM / NORMAL / BRUTAL: hunger & thirst rate,
  cold, injury, wave height and the starting kit) and whether to play the opening cinematic.
- **SETTINGS** — quality (LOW → ULTRA, applies on RELOAD), language (EN / AR, full RTL), mouse
  sensitivity and master volume. Everything is remembered in `localStorage`.
- **CONTROLS / HOW TO SURVIVE / ABOUT** — key list, a first-day walkthrough and credits.

`Esc` during play opens the same menu in paused mode (resume · save · settings · controls · quit to
menu · restart run). `↑ ↓` + `Enter` navigate it, `Esc` goes back — and the game **saves into two
slots**, so starting a new run never silently eats the run you were on.

Press **`F3`** (or add `?debug` to the url) for an on-screen self check: state, fps, player/camera
position, water level and depth at the camera, bag/structure counts, draw calls and any console
warning or shader error. It is the fastest way to report what the game is actually doing.

## 🛠 The workbench — طابلة الخدمة

Survival has two crafting tiers:

1. **In your hands** (`C` anywhere): sticks, fibre, rope, bandages, the hatchet, the **workbench
   itself** (6 stick · 4 plank), campfires, walls…
2. **At a workbench**: craft the table, place it with `G`, then press `E` at it (or open `C` while
   standing next to it) to unlock the advanced list — **canvas backpack (+6 bag slots)**, **harpoon**
   (2× the spear), **steel axe** (fells a tree in half the swings), **fishing net** (+1 fish per
   catch), **bedroll** (sleep anywhere) and bulk water purification. Each one is a real mechanic,
   not a label: the backpack really widens the bag, the net really changes the catch.

The crafting panel shows both stations and tells you why a recipe is locked.

## 🎬 The story flow — الأحداث

1. **Cinematic intro** — a golden morning over the fishing town: boats in the bay, people on the sand.
2. **Beach** — you wake on the sand of a working fishing beach (drawn-up boats, net racks, crates,
   a fish stall, the jetty and the sea in front of you). Walk out to the jetty: you find the
   **splintered fishing rod**, repair it (`C` → CRAFT), gather fibre, scrap and berries.
3. **The sea pulls back** — the water drains off the seabed, sirens, then a 13 m wall of water,
   two more waves and the flood. **Run uphill** (the flood tops out at 16.5 m).
4. **The town** — waterfront buildings collapse, debris floats, crates wash up. Reach the upper town.
5. **The escape car** — a red pick-up waits on the road above town, fuelled up. Drive the switchbacks.
6. **The mountain camp** — chop trees, hunt goats & deer, build a campfire and a lean-to shelter.
7. **Survival** — hunger, thirst, warmth, water (purify it!), night, cold, fire.
8. **Fishing** — the mandatory part: **rig the rod** (`rod_fix` recipe), cast with **LMB**, wait for the
   bite `!`, strike, then fight the fish with the tension meter (release `RMB` when it runs).
   11 species + legendary golden fish, journal in `J`.
9. **Chained disasters** — aftershocks, landslides, rockfalls, storms with lightning, harbour fires.
10. **Rescue** — salvage the radio parts in the mine, fire a flare and reach the rescue boat.

## 🎮 Controls — التحكم

| Key | Action |
| --- | --- |
| `W A S D` | move / drive |
| `Shift` | sprint · give line while fishing |
| `Space` | jump · handbrake in a car |
| `C` | crouch |
| `E` | interact / harvest / cook / drink |
| `LMB` | attack · cast the rod · reel in |
| `RMB` | give line (fishing) |
| `F` | enter / leave a vehicle |
| `I` `C` `J` `M` | inventory · crafting · journal · map |
| `F3` | debug / self-check overlay (`?debug` in the url) |
| `G` | build menu · `T` torch · `Q` flare/spear throw · `1..9` quick use |
| `V` | first / third person · `Esc` pause |

Touch devices get a virtual stick + action buttons automatically.

## 🛠 Features — الخصائص

- Procedural 2.6 km × 2.6 km island: beach, fishing town, harbour, farmland, lake, mountain, mine.
- HDR render pipeline: bloom, sun rays, ACES tonemap, chromatic aberration, wet lens, underwater
  absorption, damage/cold grade (auto-disabled on low quality).
- Real water model: swell spectrum, 3 tsunami fronts with a moving crest shader, flood level, currents,
  foam, floating debris and buoyant vehicles.
- Crowd + wildlife AI (people flee to towers/camps, animals graze & bolt), melee hunting.
- Full survival loop: inventory (42 items), 17 recipes in two tiers (hand + workbench), 6 buildable
  structures, cooking, water purification, sleeping, bleeding and cold.
- Live 3D main menu with difficulty presets, two save slots, quality/language/sensitivity settings.
- Two-tier crafting: hand recipes anywhere, advanced gear only at a **workbench** you craft, place
  and use (`E`).
- Procedural WebAudio: ocean/wind/rain beds, engine, ~36 one-shots, sparse music, all gesture-gated.

## 🧪 Dev checks — أدوات التطوير

No browser needed for logic verification:

```bash
cd tsunami
node tools/selftest.mjs                                   # world + ocean model + module/audio integrity
node tools/sim.mjs                                       # gameplay integration sim (tsunami → fishing → storm)
node --import ./tools/three-stub/register.mjs tools/boot.mjs   # boots the REAL main.js headlessly
node tools/shadercheck.mjs                               # compiles every shader with glslangValidator
```

`tools/shadercheck.mjs` is the important one for "a mesh vanished": three **silently skips a mesh
whose shader fails to compile** — the ocean disappearing behind a sand-coloured seabed was exactly
that (`uAmp` used in the water fragment shader but never declared). The validator is not vendored
(~5 MB third-party binary); install it once:

```bash
npm i --no-save glslang-validator-prebuilt-predownloaded
mkdir -p ~/.cache/glslang
cp node_modules/glslang-validator-prebuilt-predownloaded/bin/glslangValidator.linux ~/.cache/glslang/glslangValidator
chmod +x ~/.cache/glslang/glslangValidator            # or export GLSLANG=/path/to/glslangValidator
```

The game also reports shader errors on screen at runtime (red box, bottom-left) — if a mesh ever
goes missing again, that box and the browser console will say why.

`tools/three-stub/` swaps in a stubbed `WebGLRenderer` so the whole game shell (boot, cinematic,
missions, HUD, post pipeline calls, frame loop) runs in Node.

`node_modules/three/*` are **not** npm packages: they are two 3-line shims that re-export
`../../vendor/three.module.js`, so Node and the browser load byte-identical library code.

## 📁 Layout

```
index.html      entry (import map → vendor/three.module.js)
src/main.js     game shell: boot, cinematic, missions, input, camera, loop
src/world.js    terrain, roads, city, coast, mountain   src/ocean.js   swell + tsunami + flood
src/disasters.js tsunami, earthquakes, landslides, storms, fires
src/survival.js items, crafting, building   src/fishing.js  rod + fight + species
src/player.js   controller   src/vehicles.js  cars & boats   src/npc.js  crowd & wildlife
src/particles.js spray/smoke/fire/rain   src/post.js  HDR pipeline   src/sky.js  sky & clouds
src/ui.js       HUD, panels, i18n (EN / AR)   src/resource.js  harvestable nodes
```
