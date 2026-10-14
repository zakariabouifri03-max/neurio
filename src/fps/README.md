# 🔫 WARFRONT — Operation Blackout

A Call-of-Duty-style 3D FPS that runs entirely in the browser: **no build step, no external
assets**. Every texture is painted with Canvas2D, every sound is synthesized with WebAudio,
every model is assembled from boxes in code (no GLTF downloads — swap in your own models via
`THREE.GLTFLoader` if you want, the rig is per-module).

Open `warfront.html` from a static server (ES modules need `http://`, `file://` won't load them):

```bash
node tools/serve.mjs 8000        # → http://localhost:8000/   (WARFRONT), /index.html (racing)
# or: python3 -m http.server 8000
# or: npx serve .
```

One-file build (pastes into an email, works from `file://`, ~0.7 MB):

```bash
node tools/build-warfront-singlefile.mjs   # → warfront-singlefile.html
```

---

## The loop

You're dropped into a 75 × 75 m contested town. **Hold or clear the objective to advance the
wave**, survive, bank score, spend scorestreaks, and try not to bleed out before the mission
clock hits zero. Three difficulty tiers change enemy count, accuracy, reaction time, damage
multipliers and whether your health regenerates at all.

| System | What's implemented |
|---|---|
| Movement | walk / sprint (stamina) / crouch / slide / jump, AABB world collision with step-up, headbob, view kick, landing dip |
| Gunplay | 9 primaries + 2 secondaries, per-weapon recoil pattern + bloom, ADS with weapon-specific FOV, reload / cancel, swap, quick-melee, attachable underbarrel **rocket** |
| Ballistics | hitscan with range falloff, multi-pellet shotguns, penetration (thin metal only), **headshot ×2.5 / limb ×0.78**, per-material impact FX and bullet decals |
| AI soldiers | pathfinding on a nav grid, cover seeking, strafing, flanking, flank-penalty aim, suppression, reaction time before they can hit you, 360° awareness, grenades, team filtering, corpse drop + ragdoll-free fade |
| Throwables | frag grenades with arcs + bounce + auto-equip-back, enemy nades, **smoke grenades** that also block AI line of sight (30 billboarded puffs) |
| Scorestreaks | **UAV** (marks enemies for 16 s, 3 kills) → **airstrike** (6 bombs walking along your aim point, 5 kills) → **care package** (supply crate you press **F** on: full refill + 3 plates + 2 nades + 2 smokes + 3 rockets, 8 kills); each re-arms after the next threshold |
| Medals & XP | DOUBLE / TRIPLE / MULTI / KILLING SPREE / BLOODTHIRSTY / UNTOUCHABLE / LONGSHOT / HEADSHOT / REVENGE / AVENGER + streak-ready medals, killfeed, combo score multiplier, ranked persistent save |
| Unlocks | weapons, perks and camos by waves cleared / lifetime kills — **DUAL MAGS** (fast mag swaps), **EXTENDED MAGS**, gold camo at 100 kills, **GHOST** at 250 |
| Perks | Lightweight (faster move/slide), Double Tap (2× fire rate, +10 % damage, slower ADS), Sleight of Hand (fast reload/melee), Dead Proof (100 → 160 plates) |
| HUD | dynamic crosshair, health/plate bars, kill counter toward the next medal, radar sweep **plus a 106 m tactical map** with player view cone, hit/crosshair enemies, objective ring & bar, low-hp vignette, damage direction, subtitles, mission clock, 200 m draw-in lines |
| Audio | synthesized weapon report with supersonic crack, per-material impacts, footsteps, empty click, reload foley, explosions, low-hp heartbeat, radio squelch on every enemy bark, distance-attenuated gunfire, drone and jet flyovers, ambient wind + distant combat |
| Accessibility | aim assist (stronger when a mouse can't be captured), auto-fire fallback on touch, invert-Y, sensitivity, FOV, quality, subtitles, mobile touch layout |

## Controls

`WASD` move · `Shift` sprint · `Ctrl` crouch / slide · `Space` jump · `LMB` fire · `RMB` aim ·
`R` reload · `G` frag · `Q` smoke · `E` melee · `F` open care package · `V` underbarrel rocket ·
`1 2 3` slots · `4 5 6` scorestreaks · `Tab` scoreboard · `Esc` pause · `M` mute · `F3` debug.
On touch: left half = move, right half = look, buttons for fire / aim / jump / crouch / reload /
nades / streaks, and fire is automatic while you aim at a target.

## Files

```
warfront.html            page shell + HUD markup (import map → vendor/three)
src/fps/fps.css          all HUD/menu styling (inlined by the single-file build)
src/fps/main.js          boot, save/load, menu + settings + help wiring
src/fps/game.js          run state machine: waves, scoring, streaks, pause, pointer lock, touch
src/fps/player.js        movement, camera, collision, damage/regen, view-aim assist, throwables
src/fps/weapons.js       WEAPONS table, buildGun(), damageAt(), Guns (ads/recoil/bloom/swap)
src/fps/soldier.js       procedural LOD soldier + the AI state machine
src/fps/world.js         town + nav grid + collider query + procedural textures + sky
src/fps/fx.js            pooled tracers / puffs / sparks / debris / blood / decals / shake
src/fps/audio.js         WebAudio synth (no samples)
src/fps/util.js          clamp/lerp/damp/RNG/raycast/LOS/MinHeap/format
```

## Notes for tweaking

- **Weapon feel** lives entirely in `WEAPONS` (`rpm`, `bloom`, `kick`, `adsFov`, `dmg`, `falloff`,
  `spread`, `recoil`, `perf`). `recoil.pattern` is a normalized sway the kick follows.
- **Difficulty** is `DIFFS` in `game.js` — it scales enemy count, accuracy, aim skill, reaction
  delay, damage taken, plates, mission length and the regen rate (`0` = no regen).
- The world is **static and merged**: `World.build()` buckets geometry per material and merges it
  into one mesh per material, and mirrors every box into a flat typed-array collider cache
  (`_flat`). Raycasts, LOS and movement collision all run against that cache, not the scene
  graph — so drawing 11 calls is normal. If you add props, add them through `addSolid()` so
  they collide and receive shadows.
- **Soldiers are LOD-based** — they're one InstancedMesh batch per part-material at range and
  real meshes up close, so 20+ AI bodies stay cheap. Their models come from `buildSoldier()`.
- Persistence key: `localStorage['warfront.save']` (rank, XP, unlocks, loadout, settings,
  lifetime kills, camos). Clear it to start over; `s_reset` in Settings wipes it.
- If the browser iframe denies pointer lock, the game falls back to cursor-over-window aiming
  and shows a notice.
