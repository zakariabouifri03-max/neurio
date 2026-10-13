# 🏙️ Neurio City — realistic 3D open city (browser)

A procedural, realistic-looking open city you can drive through. No build step, no
assets to download: everything is generated in code with the vendored Three.js r170 in
`../vendor/` and the bloom pass from `../src/post.js`.

**▶ Run:** serve the repository root with any static server and open `/city/`:

```bash
python3 -m http.server 8000
# → http://localhost:8000/city/
```

## What's in it

| Area | Details |
|---|---|
| City | 7×7 blocks, 14 m roads with lane markings, crosswalks, curbs, parks, street trees, lamps, outer island and water |
| Buildings | 1–4 parcels per block, 2–160 m heights, glass towers / brick / sandstone / concrete facades, setbacks, rooftop units, antennas |
| Materials | PBR (albedo + roughness + emissive maps), clear-coat car paint, reflective glass, wet asphalt when it rains |
| Light | Real-time sun with soft shadows, moon at night, hemisphere fill, image-based reflections rendered from the sky |
| Sky | Procedural gradient, sun glow, moving fbm clouds, stars, sunset tint; full day/night cycle |
| Weather | Rain with streaks, grey sky, darker clouds, wet road reflections |
| Traffic | 26 cars on lanes with right-hand traffic, traffic-light obedience, following distance |
| Player | Grip/slip driving model (bicycle model with lateral slip), handbrake drift, spinning and steering wheels, brake lights, headlights at night |
| People | 42 walking pedestrians with swinging limbs; get out of your car and walk around (on foot, run with Shift) |
| Audio | Synthesized engine (speed-driven) and rain, via Web Audio |
| HUD | Clock, weather, speed/gear, minimap, controls panel |

## Controls

| Key | Action |
|---|---|
| `W` / `↑` | Accelerate |
| `S` / `↓` | Brake / reverse |
| `A` `D` / `←` `→` | Steer |
| `Space` | Handbrake (drift) |
| `C` | Chase / hood camera |
| `F` | Get out of the car (when stopped) / get back in (when near it) |
| `Shift` | Run on foot |
| `R` | Respawn on the nearest road |
| `Q` | Toggle the day cycle (10 real minutes per day) |
| `T` | Skip +1 hour |
| `N` | Rain on/off |
| `M` | Sound on/off |
| `P` | Minimap on/off |
| `H` | Show/hide controls |

Desktop keyboard is the primary input. Sound starts on the first key press (browser autoplay rules).

## Files

- `world.js` — city layout, batched geometry, facade textures, trees, lamps, signals, pedestrians
- `vehicles.js` — car model, player driving model, traffic AI
- `person.js` — on-foot character model and gait
- `sky.js` — sky shader, day/night state, key/fill light colours
- `main.js` — renderer, input, camera, audio, rain, minimap, HUD loop
- `index.html`, `style.css` — page and HUD

## Tuning

- `world.js`: `PITCH`, `GRID`, height ranges in `buildWorld`, facade palettes in `FACADES`
- `vehicles.js`: engine power curve, grip (`grip`), steering lock, traffic count in `main.js`
- `main.js`: `DAY_SECONDS` (day length), `RAIN_N` (rain drop count)
