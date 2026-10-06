#!/usr/bin/env python3
"""
NovaForge Engine - build orchestrator
=====================================
One script that builds every target of the engine, on Linux (development /
CI) and on Windows (shipping: genuine PE .exe files).

Why a hand written build script instead of CMake?
------------------------------------------------
The engine is built with the *Zig* toolchain (`zig cc`), which is a single
self contained C/C++ cross compiler that also ships the C runtime, the
Windows SDK headers, libc++ and lld.  That means:

  * `python3 build.py --target windows-editor` produces a real Windows
    .exe from Linux with no SDK install, no mingw, no Visual Studio.
  * the very same source tree builds native Linux binaries used for the
    automated tests (headless software renderer) - so the engine logic is
    actually executed and verified, not just compiled.

Usage
-----
  python3 build.py --target tests              # unit/integration tests (native)
  python3 build.py --target editor             # native editor (X11 + software rasterizer)
  python3 build.py --target editor-headless    # native editor, offscreen (screenshots)
  python3 build.py --target runtime            # native game runtime
  python3 build.py --target windows-editor     # NovaForge.exe          (Windows)
  python3 build.py --target windows-runtime    # NovaForgeRuntime.exe   (Windows)
  python3 build.py --target all
  python3 build.py --list
"""

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent
BUILD = ROOT / "build"
OBJ = BUILD / "obj"
TP = ROOT / "third_party"

# ----------------------------------------------------------------------------
# toolchain discovery
# ----------------------------------------------------------------------------


def find_zig():
    """Locate `zig`. Order: $ZIG, PATH, pip `ziglang` package."""
    env = os.environ.get("ZIG")
    if env and Path(env).exists():
        return env
    which = shutil.which("zig")
    if which:
        return which
    try:
        import ziglang  # noqa

        cand = Path(ziglang.__file__).parent / (
            "zig.exe" if os.name == "nt" else "zig"
        )
        if cand.exists():
            return str(cand)
    except Exception:
        pass
    for base in ("/tmp/venv", str(BUILD / "toolchain")):
        cand = Path(base) / "lib" / f"python{sys.version_info.major}.{sys.version_info.minor}" / "site-packages" / "ziglang" / ("zig.exe" if os.name == "nt" else "zig")
        if cand.exists():
            return str(cand)
    sys.exit(
        "error: `zig` not found.\n"
        "  Install it with:  python3 -m pip install ziglang\n"
        "  or set the ZIG environment variable."
    )


# ----------------------------------------------------------------------------
# source description
# ----------------------------------------------------------------------------

CORE_SRC = [
    "engine/core/log.cpp",
    "engine/core/image.cpp",
    "engine/core/fs.cpp",
    "engine/core/json.cpp",
    "engine/core/guid.cpp",
    "engine/core/thread_pool.cpp",
]

SCENE_SRC = [
    "engine/scene/scene.cpp",
    "engine/scene/components.cpp",
    "engine/scene/scene_serialize.cpp",
    "engine/scene/prefabs.cpp",
    "engine/scene/scene_render.cpp",
]

ASSETS_SRC = [
    "engine/assets/asset_library.cpp",
    "engine/assets/mesh.cpp",
    "engine/assets/material.cpp",
    "engine/assets/texture.cpp",
    "engine/assets/model.cpp",
    "engine/assets/import.cpp",
    "engine/assets/import_gltf.cpp",
    "engine/assets/import_obj.cpp",
    "engine/assets/import_fbx.cpp",
]

RENDER_SRC = [
    "engine/render/draw_list.cpp",
    "engine/render/soft_raster.cpp",
    "engine/render/ui_overlay.cpp",
    "engine/render/particles.cpp",
    "engine/render/pipe_software.cpp",
    "engine/render/postfx.cpp",
    "engine/render/effects.cpp",
]
# V1 ships the CPU rasterizer on every platform (docs/RENDERING.md explains the
# trade-off). A hardware backend plugs into the IRenderer seam; no GL/DX code is
# compiled or claimed until it exists.

PHYSICS_SRC = [
    "engine/physics/physics.cpp",
    "engine/physics/physics_debug.cpp",
]

AI_SRC = ["engine/ai/npc_ai.cpp"]

SCRIPT_SRC = [
    "engine/script/script_host.cpp",
    "engine/script/api_bindings.cpp",
]

AUDIO_SRC = ["engine/audio/audio.cpp"]

PROJECT_SRC = ["engine/project/project.cpp", "engine/project/settings.cpp"]

BUILDSYS_SRC = ["engine/buildsys/build_system.cpp"]

GAME_SRC = ["engine/game/gameplay.cpp"]

PLATFORM_COMMON = ["engine/platform/platform_common.cpp"]
PLATFORM_WIN = ["engine/platform/platform_win32.cpp"]
PLATFORM_OFF = ["engine/platform/platform_offscreen.cpp"]

IMGUI_SRC = [
    "third_party/imgui/imgui.cpp",
    "third_party/imgui/imgui_draw.cpp",
    "third_party/imgui/imgui_tables.cpp",
    "third_party/imgui/imgui_widgets.cpp",
    "third_party/imgui/imgui_demo.cpp",
    "third_party/imgui/misc/cpp/imgui_stdlib.cpp",
]
# The editor talks to the engine's own platform layer (see editor/imgui_soft.cpp
# for the software ImGui renderer), so no per-OS ImGui backend is needed.
IMGUI_WIN_SRC = []

LUA_SRC = sorted(
    str(p.relative_to(ROOT)).replace("\\", "/")
    for p in (TP / "lua").glob("*.c")
    if p.name not in ("lua.c", "luac.c", "onelua.c", "loadlib.c", "ltests.c")
)

BULLET_DIRS = [
    "BulletCollision/BroadphaseCollision",
    "BulletCollision/CollisionDispatch",
    "BulletCollision/CollisionShapes",
    "BulletCollision/NarrowPhaseCollision",
    "BulletDynamics/Character",
    "BulletDynamics/ConstraintSolver",
    "BulletDynamics/Dynamics",
    "LinearMath",
]
BULLET_SRC = []
for d in BULLET_DIRS:
    for p in sorted((TP / "bullet3/src" / d).glob("*.cpp")):
        BULLET_SRC.append(str(p.relative_to(ROOT)).replace("\\", "/"))


class Target:
    def __init__(self, name, sources, defines, out, extra_flags=None, link_flags=None,
                 incdirs=None):
        self.name = name
        self.sources = sources
        self.defines = defines
        self.incdirs = incdirs or [
            "-I" + str(ROOT),
            "-I" + str(ROOT / "engine"),
            "-I" + str(TP / "imgui"),
            "-I" + str(TP / "stb"),
            "-I" + str(TP / "bullet3" / "src"),
            "-I" + str(TP / "lua"),
            "-I" + str(TP / "miniz"),
        ]
        self.out = out
        self.extra_flags = extra_flags or []
        self.link_flags = link_flags or []


EDITOR_SRC = [
    "editor/main.cpp",
    "editor/editor_app.cpp",
    "editor/panels/panel_viewport.cpp",
    "editor/panels/panel_hierarchy.cpp",
    "editor/panels/panel_inspector.cpp",
    "editor/panels/panel_assets.cpp",
    "editor/panels/panel_console.cpp",
    "editor/panels/panel_ai.cpp",
    "editor/panels/panel_settings.cpp",
    "editor/panels/panel_project.cpp",
    "editor/panels/panel_animator.cpp",
    "editor/gizmo.cpp",
    "editor/editor_camera.cpp",
    "editor/theme.cpp",
    "editor/icons.cpp",
    "editor/dialogs.cpp",
    "editor/ai/ai_assistant.cpp",
    "editor/ai/ai_codegen.cpp",
]

RUNTIME_SRC = [
    "runtime/main.cpp",
    "runtime/game_runtime.cpp",
]

ENGINE_COMMON = (
    CORE_SRC + SCENE_SRC + ASSETS_SRC + RENDER_SRC + PHYSICS_SRC + AI_SRC
    + SCRIPT_SRC + AUDIO_SRC + PROJECT_SRC + BUILDSYS_SRC + GAME_SRC
    + ["engine/engine_api.cpp"]
)

TESTS_SRC = sorted(
    str(p.relative_to(ROOT)).replace("\\", "/") for p in (ROOT / "tests").glob("test_*.cpp")
)

DEF_LINUX = ["NF_PLATFORM_LINUX=1", "NF_HEADLESS_CAPABLE=1"]
DEF_WIN = ["NF_PLATFORM_WINDOWS=1"]


def targets(zig):
    t = {}
    common_linux = list(DEF_LINUX) + ["MINIZ_NO_STDIO"]
    linux_flags = ["-std=c++17", "-O2", "-g0", "-Wall", "-Wno-unused-parameter",
                   "-fno-strict-aliasing", "-pthread"] 
    # Native Linux desktop windows use the X11 backend (see docs/BUILDING.md:
    # `sudo apt install libx11-dev`); CI/test targets need no extra libraries.
    linux_link = ["-lm", "-lpthread"]

    # miniz (vendored) provides the DEFLATE codec used by the binary FBX importer
    # and the ZIP writer/reader used by "BUILD GAME" (.zip export) and the
    # asset pipeline. mz_zip_reader_init_mem works without OS file APIs.
    MINIZ_SRC = ["third_party/miniz/miniz.c", "third_party/miniz/miniz_tinfl.c",
                 "third_party/miniz/miniz_tdef.c", "third_party/miniz/miniz_zip.c"]
    t["tests"] = Target(
        "tests",
        CORE_SRC + SCENE_SRC + ASSETS_SRC + RENDER_SRC + PHYSICS_SRC + AI_SRC
        + SCRIPT_SRC + PROJECT_SRC + BUILDSYS_SRC + ["engine/audio/audio.cpp"]
        + PLATFORM_COMMON + PLATFORM_OFF + TESTS_SRC + BULLET_SRC + LUA_SRC + MINIZ_SRC,
        common_linux + ["NF_HEADLESS=1"],
        BUILD / "tests" / "novaforge_tests",
        linux_flags,
        linux_link,
    )
    t["editor"] = Target(
        "editor",
        ENGINE_COMMON + EDITOR_SRC + IMGUI_SRC + PLATFORM_COMMON
        + PLATFORM_OFF + BULLET_SRC + LUA_SRC + MINIZ_SRC,
        common_linux,
        BUILD / "editor" / "NovaForge",
        linux_flags,
        linux_link,
    )
    t["export"] = Target(
        "export",
        CORE_SRC + SCENE_SRC + ASSETS_SRC + RENDER_SRC + PHYSICS_SRC + AI_SRC + SCRIPT_SRC
        + AUDIO_SRC + PROJECT_SRC + BUILDSYS_SRC + PLATFORM_COMMON + PLATFORM_OFF
        + BULLET_SRC + LUA_SRC + MINIZ_SRC + ["tools/export_game.cpp"],
        common_linux,
        BUILD / "tools" / "export_game",
        linux_flags,
        linux_link,
    )
    t["sample"] = Target(
        "sample",
        CORE_SRC + SCENE_SRC + ASSETS_SRC + RENDER_SRC + PHYSICS_SRC + AI_SRC
        + PROJECT_SRC + ["tools/make_sample.cpp"]
        + PLATFORM_COMMON + PLATFORM_OFF + BULLET_SRC + MINIZ_SRC,
        common_linux + ["NF_HEADLESS=1"],
        BUILD / "tools" / "make_sample",
        linux_flags,
        linux_link,
    )
    t["runtime"] = Target(
        "runtime",
        ENGINE_COMMON + RUNTIME_SRC + PLATFORM_COMMON
        + PLATFORM_OFF + BULLET_SRC + LUA_SRC + MINIZ_SRC,
        common_linux,
        BUILD / "runtime" / "NovaForgeRuntime",
        linux_flags,
        linux_link,
    )
    win_common = list(DEF_WIN) + ["IMGUI_IMPL_WIN32_DISABLE_GAMEPAD", "MINIZ_NO_STDIO"]
    win_flags = ["-std=c++17", "-O2", "-Wall", "-Wno-unused-parameter",
                 "-fno-strict-aliasing", "-DUNICODE", "-D_UNICODE"]
    win_link = ["-lgdi32", "-luser32", "-lole32", "-loleaut32", "-luuid",
                "-lshell32", "-lcomdlg32", "-lwinmm",
                "-static-libstdc++", "-static-libgcc", "-Wl,--gc-sections"]
    t["windows-runtime"] = Target(
        "windows-runtime",
        ENGINE_COMMON + RUNTIME_SRC + PLATFORM_COMMON + PLATFORM_WIN + PLATFORM_OFF
        + BULLET_SRC + LUA_SRC + MINIZ_SRC,
        win_common + ["_WIN32_WINNT=0x0601"],
        BUILD / "windows" / "NovaForgeRuntime.exe",
        win_flags,
        win_link,
    )
    t["windows-editor"] = Target(
        "windows-editor",
        ENGINE_COMMON + EDITOR_SRC + IMGUI_SRC + PLATFORM_COMMON
        + PLATFORM_WIN + PLATFORM_OFF + BULLET_SRC + LUA_SRC + MINIZ_SRC,
        win_common + ["_WIN32_WINNT=0x0601"],
        BUILD / "windows" / "NovaForge.exe",
        win_flags,
        win_link,
    )
    return t


# ----------------------------------------------------------------------------
# compilation
# ----------------------------------------------------------------------------

def obj_path(target, src, flags, zig):
    tag = hashlib.sha1(("|".join(flags) + "|" + zig).encode()).hexdigest()[:8]
    src_p = Path(src)
    rel = src_p.parts[-2:] if src_p.parts[0] == "third_party" else src_p.parts[-3:]
    safe = "_".join(rel)
    return OBJ / target / tag / (safe + ".o")


def run(cmd, **kw):
    p = subprocess.run(cmd, capture_output=True, text=True, **kw)
    return p


def compile_one(zig, target, src, flags, is_windows, jobs_verbose=False):
    of = obj_path(target, src, flags, zig)
    of.parent.mkdir(parents=True, exist_ok=True)
    lst = of.with_suffix(".o.d")
    if of.exists() and lst.exists():
        try:
            deps = lst.read_text().split("\t")[-1].split()
            newest = max(
                (os.path.getmtime(ROOT / d) for d in deps
                 if (ROOT / d).exists() and (ROOT / d).is_file()),
                default=0,
            )
            if os.path.getmtime(of) >= newest:
                return ("cached", of, "")
        except Exception:
            pass
    srcp = ROOT / src
    assert srcp.exists(), f"missing source: {src}"
    cxx = src.endswith((".cpp", ".cc", ".cxx"))
    cmd = [zig, "c++" if cxx else "cc"]
    if is_windows:
        cmd += ["-target", "x86_64-windows-gnu"]
    cmd += flags
    if not cxx:
        cmd += ["-std=c11"]
    cmd += ["-MMD", "-MF", str(lst), "-c", str(srcp), "-o", str(of)]
    p = run(cmd)
    if p.returncode != 0:
        return ("fail", of, p.stderr[-8000:])
    return ("ok", of, "")


def build_target(zig, name, t, jobs):
    flags = list(t.incdirs) + t.extra_flags + ["-D" + d for d in t.defines]
    is_windows = "windows" in name
    objs = []
    fails = []
    t0 = time.time()
    sources = []
    for src in dict.fromkeys(t.sources):
        if not (ROOT / src).exists():
            print(f"    [{name}] skipping (not written yet): {src}")
            continue
        sources.append(src)
    work = [(src, flags) for src in sources]
    done = 0
    with ThreadPoolExecutor(max_workers=jobs) as ex:
        futs = [ex.submit(compile_one, zig, name, s, f, is_windows) for s, f in work]
        for f in futs:
            st, of, err = f.result()
            done += 1
            if st == "fail":
                fails.append((of, err))
            objs.append(of)
            if done % 25 == 0 or done == len(work):
                print(f"    [{name}] {done}/{len(work)} TUs ({time.time()-t0:.0f}s)",
                      flush=True)
    if fails:
        print(f"\n!! {len(fails)} compilation error(s):\n")
        for of, err in fails[:6]:
            print(f"--- {of}\n{err}\n")
        return False
    t.out.parent.mkdir(parents=True, exist_ok=True)
    cmd = [zig, "c++"]
    if is_windows:
        cmd += ["-target", "x86_64-windows-gnu", "-Wl,--subsystem,windows"]
    cmd += ["-o", str(t.out)] + [str(o) for o in objs] + t.link_flags
    p = run(cmd)
    if p.returncode != 0:
        print(f"!! link failed for {name}:\n{p.stderr[-6000:]}")
        return False
    size = t.out.stat().st_size
    print(f"  -> {t.out.relative_to(ROOT)}  ({size/1048576:.1f} MB, "
          f"{len(objs)} TUs, {time.time()-t0:.0f}s)", flush=True)
    return True


def main():
    ap = argparse.ArgumentParser(description="NovaForge Engine build system")
    ap.add_argument("--target", default="editor")
    ap.add_argument("--jobs", type=int, default=max(2, (os.cpu_count() or 2)))
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--clean", action="store_true")
    ap.add_argument("--snapshot", action="store_true",
                    help="write dist/NovaForge-<version>-snapshot.zip: a lean "
                         "archive of the tracked sources only (no build output)")
    args = ap.parse_args()

    if args.snapshot:
        return make_snapshot()

    zig = find_zig()
    all_t = targets(zig)
    if args.list:
        for k, t in all_t.items():
            print(f"{k:18s} -> {t.out.relative_to(ROOT)}  ({len(t.sources)} TUs)")
        return 0
    if args.clean:
        shutil.rmtree(OBJ, ignore_errors=True)

    wanted = list(all_t) if args.target in ("all",) else args.target.split(",")
    print(f"NovaForge build | zig={Path(zig).name} v{zig_version(zig)} | jobs={args.jobs}")
    ok = True
    for name in wanted:
        if name not in all_t:
            print(f"unknown target '{name}' (see --list)")
            return 2
        print(f"== target {name}")
        ok = build_target(zig, name, all_t[name], args.jobs) and ok
    return 0 if ok else 1


ENGINE_VERSION = "0.1.0"


def make_snapshot():
    """Lean source archive: only files tracked by git, never build output.

    Produced with `python3 build.py --snapshot` and committed to dist/ so it can
    be downloaded straight from GitHub with a single direct link.
    """
    import zipfile
    repo = ROOT.parent
    dist = ROOT / "dist"
    dist.mkdir(exist_ok=True)
    name = f"NovaForge-{ENGINE_VERSION}-snapshot.zip"
    out = dist / name
    try:
        files = subprocess.run(["git", "ls-files", "-z", ROOT.name], cwd=repo,
                               capture_output=True, text=True, check=True).stdout.split("\0")
    except Exception as exc:                       # pragma: no cover - git missing
        print(f"snapshot needs git: {exc}")
        return 1
    files = [f for f in files if f and not f.startswith(f"{ROOT.name}/dist/")]
    if not files:
        print("nothing tracked - is NovaForge committed?")
        return 1
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for f in files:
            full = repo / f
            arc = f[len(ROOT.name) + 1:]
            if not (full.exists() and full.is_file()):
                continue
            info = zipfile.ZipInfo.from_file(full, arc)
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            z.writestr(info, full.read_bytes())
    size = out.stat().st_size
    print(f"snapshot -> {out.relative_to(repo)}  ({size / 1e6:.2f} MB, {len(files)} files)")
    return 0


def zig_version(zig):
    try:
        return subprocess.run([zig, "version"], capture_output=True, text=True).stdout.strip()
    except Exception:
        return "?"


if __name__ == "__main__":
    sys.exit(main())
