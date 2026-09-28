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

## 🎬 The story flow — الأحداث

1. **Cinematic intro** — a golden morning over the fishing town: boats in the bay, people on the sand.
2. **Beach** — you wake on the beach. Pick up the splintered **fishing rod**, repair it (`I` → CRAFT),
   gather fibre, scrap and berries.
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
- Full survival loop: inventory (36 items), 10 recipes, structures, cooking, water purification.
- Procedural WebAudio: ocean/wind/rain beds, engine, ~36 one-shots, sparse music, all gesture-gated.

## 🧪 Dev checks — أدوات التطوير

No browser needed for logic verification:

```bash
cd tsunami
node tools/selftest.mjs                                   # world + ocean model
node tools/sim.mjs                                       # gameplay integration sim (tsunami → fishing → storm)
node --import ./tools/three-stub/register.mjs tools/boot.mjs   # boots the REAL main.js headlessly
```

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
