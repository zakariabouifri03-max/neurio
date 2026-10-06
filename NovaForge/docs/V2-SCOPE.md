# V1 scope and what is deliberately out

V1 is a single-player, desktop, OpenGL 3.3 engine: editor, renderer, physics, AI, scripting, audio,
animation, assets, runtime, build system, project system and the AI assistant. The items below are
**not implemented in V1**. They are listed here so nothing has to be guessed, and none of them is
faked anywhere in the UI: features that do not exist are labelled "Not implemented in V1" in the
editor (or simply absent from menus) instead of shipping as dead buttons.

## Out of scope for V1 (V2 candidates)

| Feature | Why it is out | What V1 has instead |
|---|---|---|
| Multiplayer / networking | needs a replication layer, authority model and rollback design - a project on its own | single-player runtime, deterministic fixed-step simulation (the foundation a replication layer would need) |
| Console platforms (PS/Xbox/Switch) | requires vendor SDKs and NDA toolchains | Windows x64 output; the platform layer is abstracted behind `platform/` so another backend can be added |
| Mobile export (iOS/Android) | needs a different renderer path (GLES), touch input and packaging pipeline | desktop only |
| VR | needs stereo rendering, per-eye cameras, comfort rules | standard and first/third person cameras |
| Cinematics / sequencer | a timeline editor, keyframe tracks and a cinematic player - a whole editor mode | scripted camera/object animation through the script system |
| Niagara-style GPU VFX | requires a GPU particle system, compute shaders and a graph editor | script-driven animated props, debug draw, procedural sky/fog |
| Terrain streaming / world partition | needs a paging system, LOD generation and origin rebasing | fixed scenes with frustum culling, instancing and an asset cache |
| Advanced animation editor | needs a skeleton/pose editor, blend trees, IK and retargeting | glTF clips, playback, cross-fade, state selection in `AnimatorComponent` |
| Full Blueprint visual scripting | a graph editor plus a VM is a project in itself | `.nfscript` data-driven behaviours, a component registry, native module registration (`NovaForgeRegisterComponents`) and an event system the assistant can generate |
| Real scripting language VM (Lua/Wren) | V1 keeps the script layer data-driven so the VM can be swapped in behind `ScriptSystem` | the script component + `.nfscript` schema is already the seam for it |
| Navmesh pathfinding | needs voxelisation, polygon meshes and a funnel algorithm | patrol routes, waypoint following, direct steering with collision-aware movement |
| Convex/soft-body decomposition, cloth, destruction | production solvers are large, specialised systems | boxes, spheres, capsules, planes, triggers, contacts, sleep, raycasts |
| Binary FBX | the SDK is proprietary and the binary layout is large; a partial importer produces garbage | GLB, GLTF, OBJ and **ASCII** FBX import; binary FBX is rejected with a clear error message |
| Draco / meshopt compressed GLB | requires the decoder libraries and extra streaming logic | uncompressed GLB/GLTF, with a warning when a compressed file is encountered |
| Video playback | needs a decoder stack and platform integration | audio (miniaudio) only |
| Skinned-mesh GPU skinning on all paths | V1 samples poses on the CPU for determinism | CPU pose sampling into the vertex buffer |
| Asset hot-reload of scripts mid-play | needs a safe reload boundary for running components | stop → play restarts scripts with the current file; F5 reloads assets |

## Known V1 limitations (works, but bounded)

* **Physics**: a purpose-built deterministic solver (grid broadphase; OBB SAT plus signed-distance
  sampling). Boxes, spheres, capsules and planes collide reliably; deeply stacked or heavily
  concave piles are not simulated. No joints, no ragdolls.
* **Renderer**: OpenGL 3.3 core. Directional/point/spot lights, ambient, one shadow map cascade
  (directional), fog, skybox, transparency sorting, instancing. No deferred/clustered shading, no
  SSAO/bloom/GI, no PBR texture sets beyond the base-colour/normal/roughness-metallic slots.
* **Editor**: single-scene editing at a time, one viewport, no prefab workflow UI (spawn options do
  reference scenes), no terrain/material graphs, no UI-layout templates.
* **AI assistant**: the offline planner understands the documented intent families; the optional
  HTTP backend is generic OpenAI-compatible rather than a bespoke agent. It edits scene files,
  scripts and imported assets - it does not rewrite engine C++ or generate new component types.
* **Audio**: playback, 3D attenuation, looping, volume/pitch, generated fallback tone. No reverb
  zones, buses, ducking or DSP chain.
* **Combat tuning**: attack damage, range and interval live in the runtime API
  (`SetAttackDamage`/`SetAttackRange`/`AttackInterval`) with sane defaults from the player component.
  They are not yet exposed as Inspector fields or `Settings/*.json` entries.
* **Packaging**: one Windows x64 target. The shipped `.exe` links statically against the UCRT-less
  runtime and needs only the OS OpenGL driver; no code signing or installer is produced.

## What could be added without redesigning V1

The seams were chosen deliberately:

* `platform/` - a new OS backend (macOS/Linux window, another console) is a backend implementation,
  not a rewrite.
* `scripting/` - a language VM can replace the data-driven behaviours behind the existing component.
* `renderer/` - the renderer interface (`Renderer::RenderScene`, `SceneExtractor` items) is stable,
  so a Vulkan/deferred backend is an alternative implementation.
* `physics/` - `PhysicsWorld`'s public API (bodies, sweeps, raycasts, triggers) is solver agnostic;
  Jolt/Bullet could be dropped in behind it.
* `buildsystem/` - additional platform targets are extra `BuildRequest::targetPlatform` cases plus
  the matching toolchain detection, exactly like the current Windows path.
