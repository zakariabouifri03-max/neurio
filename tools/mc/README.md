# tools/mc — headless toolbox for the Minecraft Island viewer

Everything in `src/minecraft/` is pure logic + canvas painting, so the whole
world can be generated, validated and even *rendered* without a browser.

| tool | what it does |
|---|---|
| `validate.mjs [seed]` | static import/export graph check, loads every module under Node (DOM stub), generates + meshes the world, animates characters/mobs, and exports a real `.glb` through three's own GLTFExporter. Exits non-zero on any failure. |
| `preview.mjs [seed] [out.png] [az] [el] [hour]` | CPU ray-caster that draws the generated voxel world through the real procedural atlas (alpha-tested leaves/crops, biome tint, face shading, sun/sky, open-ocean plane). Used to eyeball worldgen without a GPU. `AIM=house|tower|farm|camp|dock|mine`, `PW`/`PH` set the resolution. |
| `stub.js` | the minimal DOM/Canvas2D stub both tools share. |
| `test-gen.mjs [seed]` | fast terrain/structure/mesh statistics dump. |

Examples:

```bash
node tools/mc/validate.mjs 20261011
PW=1280 PH=720 node tools/mc/preview.mjs 20261011 shot.png 0.72 0.34 9.4
AIM=dock PW=1280 PH=720 node tools/mc/preview.mjs 7 seed7-dock.png -1.95 0.13 17.9
```

The checked-in `preview.png`, `preview-dock.png` and `preview-night.png` were
produced by `preview.mjs` and double as worldgen regression snapshots.
