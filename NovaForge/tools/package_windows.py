#!/usr/bin/env python3
"""NovaForge Engine - Windows release packaging.

Takes the cross-compiled executables and produces the two downloadable packages:

    dist/NovaForge-SampleIsland-Windows-x64/     game runtime + the sample island content
    dist/NovaForge-SampleIsland-Windows-x64.zip
    dist/NovaForge-Editor-Windows-x64/           editor + the same content
    dist/NovaForge-Editor-Windows-x64.zip
    dist/BUILD-INFO.json                         sizes / hashes / subsystem of both exes

Usage:
    python3 tools/package_windows.py                    # package what build.py produced
    python3 tools/package_windows.py --build            # build the Windows target first
    python3 tools/package_windows.py --sample otherproj # package a different project
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"

PLAY_README = """# NovaForge Engine - standalone game (Windows x64)

`NovaForgeGame.exe` is the NovaForge **runtime**: a separate executable, not a renamed copy of the
editor. It contains no editor code - it reads `project.json`, `Settings/` and `Assets/` from its own
folder and plays whatever project it finds there.

    NovaForgeGame.exe        the game - statically linked, no installer, no dependencies
    project.json             game settings (window, physics, input map, start scene)
    Assets/Scenes/*.nfscene  the level - human readable JSON scene format
    Assets/Scripts/*.nfscript behaviour scripts used by the level
    Assets/Audio/*.wav       sound clips

## Run it

1. Unpack this folder anywhere (the Desktop is fine).
2. Double-click `NovaForgeGame.exe`.

Requires Windows 10/11 x64 and an OpenGL 3.3 capable GPU driver (any 2012+ GPU). Nothing else is
needed: the UCRT ships with Windows and no Visual C++ redistributable is used.

Command line:

    NovaForgeGame.exe                            play
    NovaForgeGame.exe --console                  keep the log window open (Logs/Game.log is always written)
    NovaForgeGame.exe --fullscreen               start fullscreen
    NovaForgeGame.exe --width 1920 --height 1080
    NovaForgeGame.exe --headless --frames 300    run the simulation without a window (smoke test)
    NovaForgeGame.exe --screenshot frame.png     render one frame to a PNG and exit
    NovaForgeGame.exe --project <folder>         play a different project folder

## Controls

| Input | Action |
|---|---|
| W A S D / arrow keys | Move |
| Mouse | Look - click the window to capture the cursor |
| Space | Jump |
| Shift | Sprint |
| E / Enter | Interact (gate, pickups) |
| Left mouse / F | Attack - the NPCs fight back |
| R | Respawn after dying |
| Esc | Pause menu / release the cursor |
| F5 | Quick save the current scene state |
| F11 | Toggle fullscreen |
| F1 | Toggle the on-screen HUD |

## What is in this sample

* 60 x 60 island with a raised platform, pillars, crates and a script driven spinning crate
* third person player: capsule collider, gravity, jump, sprint, 120 HP, block/respawn
* three NPCs driven by the AI state machine: `Guard` and `Patrol` walk their route,
  `Brute` and `Scout` chase and attack on sight
* a gate that opens when you walk into its trigger volume (own script + interaction prompt)
* health and ammo pickups, a welcome trigger, and a quest ("Survive the island")
* a directional sun with shadows plus a point lamp, ambient audio loop
* gameplay log in `Logs/Game.log`

## Where this came from

This folder is exactly what the editor's **Build Game** button produces: the build system stages
the game executable, `project.json`, `Assets/`, `Settings/`, the engine sources under `Engine/`
plus `Build.bat` / `build.sh` so the game can be rebuilt from source without the editor.
"""

EDITOR_README = """# NovaForge Engine - editor (Windows x64)

`NovaForge.exe` is the editor: the tool where scenes are built, played and exported.
This folder also contains the **Sample Island** project, so you can open it and press Play
immediately - and it is the same content the standalone game package ships.

## Run it

Double-click `NovaForge.exe`, then `File > Open Project` and choose this folder (it contains
`project.json` + `Assets/`), or `File > New Project` to start from scratch.

## Quick tour

* **Toolbar** - Play / Pause / Step / Stop, Build Game, Save / Save As, Undo / Redo, gizmo mode
* **Scene Hierarchy** (left) - create, rename, duplicate, parent, delete; right-click for
  *Add Ground / Light / Player / NPC / Door / Pickup / Trigger Volume / Audio Source / Quest*
* **Viewport** (centre) - RMB orbit, MMB pan, wheel zoom, WASD free-fly, W/E/R for
  Move/Rotate/Scale gizmos, Ctrl snaps, click selects, Ctrl+click multi-selects
* **Inspector** (right) - every component exposes editable fields, assets and confirmation
  dialogs for destructive operations
* **Asset Browser** - Import GLB / GLTF / OBJ / FBX / PNG / JPG / WAV, drag a model into the scene
* **AI Assistant** (right dock) - describe a change in plain language; it edits the *real* project
  files and components, shows a preview of every AI ACTION -> file/component touched, requires
  Apply, and can Revert the whole change set
* **Console / Logs** - errors and warnings are reported there and written to `Logs/Editor.log`
* **Play mode** - the game runs inside the viewport with the same systems as the exported build
  (physics, AI, scripting, audio, collisions, HUD)

## End to end acceptance flow

Create Project -> Import GLB -> drag the model into the scene -> Add Ground -> Add Light ->
Create Player -> Add Collider -> Add NPC -> Play -> walk around -> interact / fight ->
Save project -> Build Game -> close the editor -> launch the produced `<Project>.exe`.

The build output (default `Builds/<Project>/`) is a standalone folder exactly like the Sample
Island package: a separate runtime executable, `project.json`, `Assets/`, `Engine/` sources and
`Build.bat` / `build.sh` (verified rebuild scripts - `build.sh` cross-compiles the same .exe from
the packaged sources).

Documentation: `docs/` in the repository (architecture, formats, build system, AI assistant,
test suite) and `BuildReport.txt` inside every build output.
"""


def describe(path: Path) -> dict:
    data = path.read_bytes()
    if data[:2] != b"MZ":
        raise SystemExit(f"{path} is not a PE executable")
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    if data[pe:pe + 4] != b"PE\0\0":
        raise SystemExit(f"{path} has no PE signature")
    machine = struct.unpack_from("<H", data, pe + 4)[0]
    subsystem = struct.unpack_from("<H", data, pe + 4 + 20 + 68)[0]
    if machine != 0x8664:
        raise SystemExit(f"{path} is not x86-64 (machine {machine:#x})")
    return {
        "file": path.name,
        "bytes": len(data),
        "machine": hex(machine),
        "bits": 64,
        "subsystem": {2: "windows-gui", 3: "console"}.get(subsystem, str(subsystem)),
        "sha256": hashlib.sha256(data).hexdigest(),
    }


def stage_project(source: Path, target: Path, exe: Path, exe_name: str, readme: str) -> None:
    target.mkdir(parents=True, exist_ok=True)
    shutil.copy2(exe, target / exe_name)
    shutil.copy2(source / "project.json", target / "project.json")
    for folder in ("Assets", "Settings"):
        if (source / folder).is_dir():
            shutil.copytree(source / folder, target / folder, dirs_exist_ok=True)
    if (source / "README.md").is_file():
        shutil.copy2(source / "README.md", target / "PROJECT-README.md")
    (target / "README.md").write_text(readme, encoding="utf-8")


def zip_folder(folder: Path, out: Path) -> int:
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for root, _dirs, files in os.walk(folder):
            for name in sorted(files):
                full = Path(root) / name
                arc = os.path.join(folder.name, os.path.relpath(full, folder))
                archive.write(full, arc)
    return out.stat().st_size


def main() -> int:
    parser = argparse.ArgumentParser(description="package the Windows build for download")
    parser.add_argument("--config", default="release")
    parser.add_argument("--sample", default="samples/SampleIsland", help="project to ship")
    parser.add_argument("--build", action="store_true", help="run tools/build.py first")
    args = parser.parse_args()

    if args.build:
        subprocess.run([sys.executable, str(ROOT / "tools" / "build.py"), "--target", "windows",
                        "--config", args.config], check=True, cwd=ROOT)

    editor_exe = ROOT / "build" / "exe" / args.config / "NovaForge" / "NovaForge.exe"
    game_exe = ROOT / "build" / "exe" / args.config / "NovaForgeGame" / "NovaForgeGame.exe"
    for path in (editor_exe, game_exe):
        if not path.is_file():
            raise SystemExit(f"missing {path} - run: python3 tools/build.py --target windows "
                             f"--config {args.config}")

    project = (ROOT / args.sample).resolve()
    info = {"editor": describe(editor_exe), "game": describe(game_exe),
            "project": str(project.relative_to(ROOT))}

    shutil.rmtree(DIST, ignore_errors=True)
    play_dir = DIST / "NovaForge-SampleIsland-Windows-x64"
    editor_dir = DIST / "NovaForge-Editor-Windows-x64"
    stage_project(project, play_dir, game_exe, "NovaForgeGame.exe", PLAY_README)
    stage_project(project, editor_dir, editor_exe, "NovaForge.exe", EDITOR_README)

    info["packages"] = {
        "NovaForge-SampleIsland-Windows-x64.zip":
            zip_folder(play_dir, DIST / "NovaForge-SampleIsland-Windows-x64.zip"),
        "NovaForge-Editor-Windows-x64.zip":
            zip_folder(editor_dir, DIST / "NovaForge-Editor-Windows-x64.zip"),
    }
    (DIST / "BUILD-INFO.json").write_text(json.dumps(info, indent=2) + "\n", encoding="utf-8")

    print("packaged:")
    print(f"  game    : {info['game']['bytes']:,} bytes  ({info['game']['subsystem']})")
    print(f"  editor  : {info['editor']['bytes']:,} bytes  ({info['editor']['subsystem']})")
    for name, size in info["packages"].items():
        print(f"  {name}  {size:,} bytes")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
