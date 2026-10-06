# File formats

Everything NovaForge reads or writes is human-readable text (or a documented binary container).
There is no single giant proprietary project file: a project is a folder of small files that a
person can diff, review and hand-edit.

```
MyProject/
  project.json                 project + game settings (see below)
  Assets/
    Scenes/*.nfscene           levels
    Models/*.glb|*.gltf|*.obj|*.fbx   imported source meshes (copied verbatim)
    Textures/*.png|*.jpg       imported textures
    Materials/*.nfmaterial     material instances (JSON)
    Audio/*.wav|*.mp3|*.ogg    sound clips
    Scripts/*.nfscript         gameplay scripts
  Settings/
    input.json                 input map (actions → keys/mouse buttons)
    graphics.json              renderer settings
    ai.json                    AI assistant configuration
  Builds/<Name>/               output of "Build Game"
  Logs/                        Editor.log / Game.log
```

## `project.json`

```json
{
  "format": { "generator": "NovaForge Engine", "formatVersion": 1 },
  "name": "SampleIsland",
  "version": "1.0.0",
  "description": "Created with NovaForge Engine",
  "company": "Independent",
  "window": { "width": 1280, "height": 720, "fullscreen": false, "vsync": true,
              "targetFps": 0, "showConsoleWindow": false, "allowWindowedToggle": true },
  "graphics": { "shadows": true, "shadowResolution": 1024, "quality": 2 },
  "gameplay": { "gravity": -20.0, "masterVolume": 0.8,
                "startScene": "Assets/Scenes/SampleIsland.nfscene" },
  "input": [ { "action": "MoveForward", "key": "W" }, { "action": "Attack", "mouseButton": "Left" } ],
  "tags": ["Player", "Enemy", "Ground", "Pickup"],
  "lastScene": "Assets/Scenes/SampleIsland.nfscene"
}
```

`gameplay.startScene` is what the exported game loads; `window`/`graphics` drive the runtime
window, VSync, quality level, shadows and console visibility.

## `.nfscene` (scene / level)

```json
{
  "format": "NovaForge Scene",
  "version": 1,
  "name": "SampleIsland",
  "environment": { "gravity": [0, -20, 0], "ambient": [0.16, 0.18, 0.22],
                   "ambientIntensity": 0.45, "skyTop": [...], "skyBottom": [...],
                   "fogEnabled": true, "fogStart": 30, "fogEnd": 140 },
  "objects": [
    {
      "id": 5, "name": "Player_1", "tag": "Player", "active": true,
      "components": [
        { "type": "Transform", "enabled": true,
          "properties": { "position": [0, 1.2, -8], "rotationEuler": [0, 0, 0], "scale": [1, 1, 1] } },
        { "type": "CharacterController", "properties": { "moveSpeed": 5.5, "capsuleHeight": 1.8 } },
        { "type": "Collider", "properties": { "shape": 2, "radius": 0.4, "height": 1.8,
                                              "center": [0, 0.9, 0] } },
        { "type": "Health", "properties": { "maxHealth": 120, "currentHealth": 120 } }
      ]
    }
  ]
}
```

* `id` is a stable 64-bit entity id; parent/child links are stored as `parent` on the child.
* Component types are registered by name (`ComponentRegistry`), so unknown components in a newer
  file are reported as warnings instead of crashing the load.
* **Collider dimensions are local units**: the transform scale is applied on top of
  `size`/`radius`/`height`/`center`. That is what makes an "Add Collider" on a scaled object match
  its mesh exactly (a regression test asserts mesh bounds == collider bounds for every object).
* Missing asset references are warnings in the Console and in `BuildReport.txt`, never crashes.

## `.nfscript` (gameplay script)

```
# name: Spinner
# owner: SpinningCrate_1
behavior: script
class: Spinner
params:
  speed: 45
  axis: 1
onStart:
  log "Spinner started"
onUpdate:
  spin speed axis
```

The parser accepts the commented header form above *and* the JSON form (`{"class": "...", ...}`).
Scripts are attached through the `Script` component:

```json
{ "type": "Script", "properties": { "className": "Spinner",
                                    "sourcePath": "Assets/Scripts/Spinner.nfscript",
                                    "owner": "SpinningCrate_1",
                                    "parameters": { "speed": 45 } } }
```

Native modules can register extra component types by exporting
`void NovaForgeRegisterComponents()`, which is what the exported game and the editor both call on
startup - the scripting layer is designed so a real scripting language (Lua/Wren/custom VM) can be
dropped in behind `ScriptSystem` without touching the scene format.

## `Settings/input.json`

```json
{ "actions": [ { "name": "MoveForward", "keys": ["W"], "mouse": "" },
               { "name": "Attack", "keys": ["F"], "mouse": "Left" } ] }
```

## `Materials/*.nfmaterial`

```json
{ "name": "Crate", "baseColor": [0.55, 0.38, 0.2, 1], "metallic": 0.05, "roughness": 0.65,
  "baseColorTexture": "Assets/Textures/crate.png", "emissive": [0, 0, 0],
  "emissiveStrength": 0.0, "opacity": 1.0, "doubleSided": false }
```

## Imported models

`Assets/Models/<name>.glb` etc. are byte-for-byte copies of the imported source. Parsed geometry,
materials and animation clips are cached (in memory, keyed by path + modification time) so a second
load is instant; the asset database reports vertex/triangle/material/animation counts at import
time and logs a warning (not an error) when a file uses a feature V1 does not support
(e.g. binary FBX, sparse accessors, Draco compression).

## Build output

```
Builds/SampleIsland/SampleIsland/
  SampleIsland.exe        standalone runtime (separate program from the editor)
  NovaForgeGame.exe       identical copy under the engine's runtime name
  project.json  Assets/  Settings/
  Engine/Source/          the engine sources used for this build
  Engine/Generated/BuildConfig.h
  Build.bat  build.sh     real rebuild scripts (they cross-compile the same .exe)
  README.txt  BuildReport.txt
```

`BuildReport.txt` lists the toolchain, configuration, executable size, binary format
(x86-64 / Windows), copied asset count, start scene, and the verification results plus any asset
warnings. If a build fails, the report says exactly why and the staged package is kept so
`Build.bat` can be run for the full compiler diagnostics.
