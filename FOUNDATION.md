# Neurio foundation layer

This checkout is a browser/Three.js PWA rather than an Unreal Engine project. Per the requested clarification, Phase 01 is implemented as a modular browser equivalent without disturbing the existing racing game.

## Added architecture

- `src/foundation/game-core.js` — `GameProjectCore`, settings/state boundary, categorized debug logs. This is the project-level coordinator analogous to a GameInstance/GameState boundary.
- `src/foundation/voxel.js` — `VoxelWorldManager`, `VoxelChunkData`, `VoxelChunkComponent`, and original data-driven block definitions for grass, dirt, stone, sand, concrete, wood, glass, and road. Prototype rendering uses one `InstancedMesh` per solid block type.
- `src/foundation/interaction.js` — reusable `Interactable` and camera-center raycast `InteractionSystem`. Press `E` invokes the current target and the prompt is replaceable HTML.
- `src/foundation/debug.js` — opt-in overlay for state, position, current chunk, and loaded chunk count.
- `src/main.js` — wires the foundation into the existing race lifecycle; the prototype chunk is displayed in the test race and interaction/debug systems are scoped to the active scene/camera.
- `src/style.css` — replaceable prompt/debug overlay styling.

## How to test

```bash
python3 -m http.server 8000
# open http://localhost:8000/?debug=1
```

Then start a race. A small original block prototype appears near the starting area. `?debug=1` enables the development overlay. Existing racing controls and save persistence remain unchanged.

## Decisions for the next phase

- Chunk data is independent from rendering, so a greedy mesher, streamed chunk provider, collision baking, and async generation can replace `buildPreview()` without changing world callers.
- Interactions are attached via `object.userData.interactable`; doors, shops, vehicles, NPCs, and mission objects can implement the same contract.
- The current save format remains backward compatible. Foundation settings/state are namespaced under `save.foundation` and versioned independently.
- No vehicle, NPC, weapon, mission, city, or full-world system was added.

## Validation

The repository does not contain Unreal Engine, an `.uproject`, C++ modules, or a UE build toolchain, so an Unreal compile/editor launch cannot be claimed. JavaScript module syntax and the app smoke test should be run with the static server above; the original game remains the runtime host.
