# Original 3D models — Blockyard & Drift

Self-contained **glTF 2.0 binaries**, procedurally created for these games rather than downloaded or extracted from another title. Coordinates are Y-up in approximate meters.

## Blockyard adventurer

**[`blockyard-avatar.glb`](blockyard-avatar.glb)** — approximately **137 KB**, 21 mesh primitives.

- Rounded block head, torso, arms, hands, legs, and sneakers
- Original smiling face, cap, backpack, straps, and chest badge
- Citrus outfit: lime shirt, orange cap, blue pants, purple backpack
- Embedded face PNG and PBR material colors

Open **Your avatar** in Blockyard to choose one of four outfits, see a real 3D preview, and export your selected look. The downloadable file is a neutral static pose, **not a skinned/rigged avatar or an official Roblox asset**.

Source: [`src/blockyard/models.js`](../src/blockyard/models.js).

## Cloud Hop course

**[`blockyard-cloud-hop.glb`](blockyard-cloud-hop.glb)** — approximately **2.7 MB**, 373 mesh primitives.

- Six floating checkpoint islands and connecting jump platforms
- Lava lane, blue moving-platform meshes, yellow spring, and pink spinner
- Voxel trees, flowers, bench, studded grass caps, checkpoint flags, and gold finish arch
- All 24 collectible coin meshes and embedded sign/flag textures

The exported course is a static snapshot: platforms and hazards do not animate outside the game. Distant background scenery, sky, camera, UI, particles, and lights are excluded. Model geometry is not a Roblox Studio project and does not contain gameplay scripts.

Sources: [`src/blockyard/world.js`](../src/blockyard/world.js) and [`src/blockyard/rules.js`](../src/blockyard/rules.js). Use **Get the 3D model** in Blockyard to export the current world.

---

# Drift models

## Starter raft

**[`drift-raft.glb`](drift-raft.glb)** — approximately **1.2 MB**, 128 mesh primitives.

- Nine wooden foundations, support timbers, floats, nails, and rope bindings
- Mast, spars, cloth sail, pennant, and guy ropes
- Storage chest, barrel, sleeping mat, rope coil, lifebuoy, and lantern
- Low-poly castaway with straw hat and scrap hook
- PBR material colors and embedded timber/sail PNG textures

Source: [`src/raft/models.js`](../src/raft/models.js).

## Palmwood Cove

**[`palmwood-cove.glb`](palmwood-cove.glb)** — approximately **8 MB**.

- Sculpted sandy island and a shallow seabed, with terrain vertex colors
- Fourteen curved coconut palms with individual pinnate fronds and coconuts
- Ferns, grass, and irregular textured shoreline rocks
- Raised timber shelter with porch, stairs, beams, thatched roof, door, and open windows
- Furnishings, storage, and torch meshes
- Embedded sand, wood-grain, and palm-bark PNG textures

Sources: [`src/raft/tropics.js`](../src/raft/tropics.js) and [`src/raft/textures.js`](../src/raft/textures.js).

## Import and export

- **Blender:** File → Import → glTF 2.0 → select a `.glb` file.
- **Three.js:** load with `GLTFLoader`.
- **Other engines/viewers:** use a glTF 2.0-compatible importer.

Coordinates are **Y-up**, in approximate meters. Geometry transforms and normals are baked into a single root mesh containing material primitives. Textures are embedded; there are no external URLs or dependencies.

These are **static mesh snapshots**. Animated sails, foliage wind, wave buoyancy, dynamic torch lighting, sound, and survival logic remain part of the game. The animated ocean and UI are deliberately excluded. The models contain no skeletons or animation clips. Surface color textures are included; shader effects and bump mapping are not exported.

Build your own raft in the game, then open **Pause → Your raft as a 3D model → Get .glb** to export your foundations, stations, and the castaway’s current pose. **Pause → Palmwood Cove 3D model → Get .glb** exports the island. Both exports are generated locally and work offline. Build-preview guides are not exported.

The complete shelter is included in the island model, but the game currently supports approaching the shore and collecting beachcombing rewards, **not walking ashore or entering the shelter**.

The writer is [`src/raft/export.js`](../src/raft/export.js). The included files have passed the Khronos glTF validator with **0 errors, 0 warnings, and 0 informational issues**.
