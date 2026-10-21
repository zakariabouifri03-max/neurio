# ⛏️ neurio Craft — Minecraft 3D Realistic

Lo3ba **Minecraft 3D wa9i3iya** f l-moutasaffih (browser) — 3alam voxel la-nihayi kayt-welled b seed,
bni w kesser, nhar w lil, may w ghuyum, hayawanat, w TNT kaytferga3! 💣

A realistic 3D Minecraft-style voxel game that runs entirely in the browser — infinite seeded
terrain, break & build, a full day/night cycle, water and clouds, animals, and exploding TNT.

**▶ Play / El3eb:** serve the repo root and open `/minecraft/`:

```bash
python3 -m http.server 8000
# → http://localhost:8000/minecraft/
```

No build step, no downloads at runtime: Three.js r170 is vendored in `../vendor/`,
every texture is painted procedurally on a canvas at boot, every sound is synthesised
with the Web Audio API.

## 🎮 Controls — كيفاش تلعب

| Action | PC | 📱 Mobile |
|---|---|---|
| Move — تحرك | `W A S D` / arrows | left joystick |
| Look — شوف | mouse (pointer lock) | drag right side of screen |
| Break block — كسّر | left click (hold) | ⛏️ button (hold) |
| Place block — بني | right click (hold) | 🧱 button |
| Jump / swim — نقّز / عوّم | `Space` | ⬆️ button |
| Sprint — جري | `Shift` | — |
| Fly — طير | `F` (Space ⬆ / Shift ⬇) | 🕊️ button |
| Inventory — المخزون | `E` | 🎒 button |
| Choose block | `1–9` / mouse wheel | tap the hotbar |
| Pick aimed block | middle click | — |
| Time of day — الوقت | `T` | 🕐 button |
| Pause | `Esc` | ⏸ button |

💣 **Tip:** break a TNT block and it **explodes** (chain reactions included).
Your building edits are auto-saved per-seed in `localStorage`; change the **seed**
on the title screen (or hit 🎲 in the pause menu) for a brand-new world.

## ✨ "Realistic" tech

- **Per-vertex ambient occlusion** + directional face shading in the chunk mesher (hidden-face culling, AO diagonal flipping)
- **Procedural 64px texture atlas** (33 tiles: grass, bark rings, cobblestone, ores, TNT…) reused as a bump map for surface depth
- **Dynamic sun & moon** with soft shadows (PCF), ACES filmic tone mapping, distance fog matched to the sky, stars at night, drifting cloud layer, animated water
- **Seeded fBm value-noise terrain**: continents, mountain ridges, lakes, beaches, desert / snow biomes, 3D-noise caves, ores (coal / gold / diamond), oak & birch trees, cacti, flowers
- **Infinite chunk streaming** (16×64×16 chunks generated + meshed around the player), 3 graphics quality presets
- First-person AABB voxel physics: gravity, sprint FOV-kick, head-bob, swimming, one-block auto-step, fly mode
- Blocky **animals** (pigs, sheep, cows) wandering with leg animation, break **particles**, screen-shake explosions, synth SFX & daytime birdsong

## 🗂️ Files

```
minecraft/
├── index.html          # title screen, HUD, hotbar, inventory, pause, touch UI
└── src/
    ├── game.js         # renderer, player physics, input, sky, animals, SFX, UI
    ├── world.js        # chunk storage + seeded terrain/biome/cave/ore/tree generation
    ├── mesher.js       # culled chunk meshing with vertex AO + face shading
    ├── textures.js     # procedural canvas atlas (incl. water + clouds + UI icons)
    ├── blocks.js       # block registry (26 blocks) + tile mapping
    ├── noise.js        # seeded 2D/3D value-noise & fBm
    └── style.css
```
