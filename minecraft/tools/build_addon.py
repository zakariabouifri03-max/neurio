#!/usr/bin/env python3
"""
build_addon.py — pack the addon into an installable .mcaddon
============================================================
  python3 tools/build_addon.py                  -> dist/Neurio-AI-Villagers.mcaddon
  python3 tools/build_addon.py --api 1.21       -> for older Minecraft versions
  python3 tools/build_addon.py --open           -> (Windows/macOS) import it right away

A .mcaddon is just a zip with the behaviour pack and the resource pack inside.
Double-click it (or open it on Android/iOS) and Minecraft imports both packs.

--api picks which Script API module versions the manifest asks for:
  latest (default)  @minecraft/server 2.10.0 + @minecraft/server-ui 2.2.0   (Minecraft 1.26.x)
  1.21              @minecraft/server 1.17.0 + @minecraft/server-ui 1.3.0   (Minecraft 1.21.x)
If the pack does not load and the log says a module version is missing, rebuild with the
other preset (or edit the two "version" strings in addon/behavior_pack/manifest.json).
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ADDON = os.path.join(ROOT, "addon")
BP = os.path.join(ADDON, "behavior_pack")
RP = os.path.join(ADDON, "resource_pack")
DIST = os.path.join(ROOT, "dist")

API_PRESETS = {
    "latest": {"server": "2.10.0", "ui": "2.2.0", "min_engine": [1, 20, 0]},
    "1.26":   {"server": "2.10.0", "ui": "2.2.0", "min_engine": [1, 20, 0]},
    "1.21":   {"server": "1.17.0", "ui": "1.3.0", "min_engine": [1, 20, 0]},
}

SKIP_DIRS = {"__pycache__", "node_modules", "build", ".git", ".venv"}
SKIP_FILES = {".DS_Store", "Thumbs.db"}
SKIP_EXT = {".pyc", ".pyo"}


def set_api(preset: str):
    cfg = API_PRESETS[preset]
    path = os.path.join(BP, "manifest.json")
    with open(path, encoding="utf-8") as f:
        m = json.load(f)
    m["header"]["min_engine_version"] = cfg["min_engine"]
    deps = []
    for d in m.get("dependencies", []):
        if d.get("module_name") == "@minecraft/server":
            d["version"] = cfg["server"]
        if d.get("module_name") == "@minecraft/server-ui":
            d["version"] = cfg["ui"]
        deps.append(d)
    m["dependencies"] = deps
    with open(path, "w", encoding="utf-8") as f:
        json.dump(m, f, indent=2, ensure_ascii=False)
        f.write("\n")
    print(f"api preset '{preset}': @minecraft/server {cfg['server']}, @minecraft/server-ui {cfg['ui']}")


def add_tree(zf: zipfile.ZipFile, folder: str, arcname: str):
    n = 0
    for dirpath, dirnames, filenames in os.walk(folder):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]
        for fn in sorted(filenames):
            if fn in SKIP_FILES or os.path.splitext(fn)[1] in SKIP_EXT:
                continue
            full = os.path.join(dirpath, fn)
            rel = os.path.relpath(full, folder).replace(os.sep, "/")
            zf.write(full, f"{arcname}/{rel}")
            n += 1
    return n


def validate():
    problems = []
    for p in (os.path.join(BP, "manifest.json"), os.path.join(RP, "manifest.json")):
        try:
            with open(p, encoding="utf-8") as f:
                json.load(f)
        except Exception as e:
            problems.append(f"{p}: {e}")
    entry = os.path.join(BP, "scripts", "main.js")
    if not os.path.exists(entry):
        problems.append("missing scripts/main.js")
    if not os.path.exists(os.path.join(BP, "scripts", "voicemanifest.js")):
        problems.append("missing scripts/voicemanifest.js (run tools/build_voicebank.py)")
    if not os.path.exists(os.path.join(RP, "sounds", "sound_definitions.json")):
        problems.append("missing sounds/sound_definitions.json (run tools/build_voicebank.py)")
    return problems


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="latest", choices=list(API_PRESETS.keys()))
    ap.add_argument("--out", default=os.path.join(DIST, "Neurio-AI-Villagers.mcaddon"))
    ap.add_argument("--name", default="Neurio-AI-Villagers")
    ap.add_argument("--open", action="store_true", help="open/import the file after building")
    args = ap.parse_args()

    problems = validate()
    if problems:
        print("!! problems:")
        for p in problems:
            print("   -", p)
        if any("missing scripts/main.js" in p for p in problems):
            sys.exit(1)

    set_api(args.api)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    if os.path.exists(args.out):
        os.remove(args.out)

    with zipfile.ZipFile(args.out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        nb = add_tree(zf, BP, f"{args.name}-BP")
        nr = add_tree(zf, RP, f"{args.name}-RP")

    size = os.path.getsize(args.out)
    print(f"built {os.path.relpath(args.out, ROOT)}  ({nb} BP + {nr} RP files, {size/1024/1024:.2f} MB)")
    print("install: open the .mcaddon with Minecraft (double-click / share / import)")

    if args.open:
        if sys.platform.startswith("win"):
            os.startfile(args.out)  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.run(["open", args.out])
        else:
            print("(on Linux/Android just copy the file to the device and open it)")


if __name__ == "__main__":
    main()
