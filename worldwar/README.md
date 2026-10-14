# 🪖 Block Front 1944 — voxel war game

A Minecraft-style 3D war game that runs in the browser. Open `worldwar/index.html`
through any static server (for example `python3 -m http.server 8000`, then visit `/worldwar/`).

- Procedural voxel front line: trenches with sandbag parapets, brick bunkers, trees, sand patches.
- Blocky 3D models: Allied rifle first-person viewmodel, Axis soldiers (walk/aim animation, headshots), Axis tanks (rotating turret, shells that blow up walls).
- Waves that scale up; tanks from wave 2.
- Build and dig: place bricks/sandbags/stone/wood, dig terrain. Grenades destroy walls.
- Uses the vendored Three.js r170 in `../vendor` (no CDN, no build step).

Controls: WASD move · Shift sprint · Space jump · mouse aim · left click fire (hold) · R reload · Q grenade · right click place · F dig · 1–6 / wheel material · Esc pause.
