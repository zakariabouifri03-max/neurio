#!/usr/bin/env python3
"""
NovaForge Engine - build driver.

A dependency-free build system (no CMake required) that can:
  * build the engine + editor + game runtime as native binaries
  * CROSS-COMPILE real 64-bit Windows executables (PE32+) from any host
    using the Zig toolchain bundled in the `ziglang` PyPI wheel
  * run the automated test suite

Usage:
  python tools/build.py --target native --config release            # native build (dev/test)
  python tools/build.py --target windows --config release           # cross-compile PE32+ exes
  python tools/build.py --target windows --config release --unity   # faster (unity build)
  python tools/build.py --list                                      # show build targets

The same driver is used by CI (.github/workflows/windows-build.yml) and by
scripts/build_windows.bat on a Windows machine (where it drives MSVC or mingw).
"""
from __future__ import annotations

import argparse
import atexit
import concurrent.futures
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENGINE = ROOT / "engine"
BUILD = ROOT / "build"


def rel(path: Path) -> Path:
    """Shorten a path for logging; build outputs can live outside the repository."""
    try:
        return path.relative_to(ROOT)
    except ValueError:
        return path

# --------------------------------------------------------------------------------------
# toolchain discovery
# --------------------------------------------------------------------------------------


def find_zig() -> list[str]:
    """Locate the Zig compiler (used as a C/C++ compiler + cross linker)."""
    for env in ("NOVAFORGE_ZIG", "ZIG"):
        if os.environ.get(env):
            return [os.environ[env]]
    exe = shutil.which("zig")
    if exe:
        return [exe]
    # ziglang PyPI wheel: `python -m ziglang ...`
    try:
        out = subprocess.run(
            [sys.executable, "-m", "ziglang", "version"],
            capture_output=True, text=True, timeout=120,
        )
        if out.returncode == 0:
            return [sys.executable, "-m", "ziglang"]
    except Exception:
        pass
    return []


@dataclass
class Toolchain:
    name: str
    cxx: list[str]
    target_flag: list[str]
    exe_suffix: str
    defines: list[str] = field(default_factory=list)
    extra_link: list[str] = field(default_factory=list)
    is_legacy_crt: bool = False
    archiver: list[str] = field(default_factory=lambda: ["ar", "rcs"])

    def obj_suffix(self) -> str:
        return ".obj" if self.exe_suffix == ".exe" else ".o"


def make_toolchain(target: str, verbose: bool) -> Toolchain:
    if target == "windows":
        zig = find_zig()
        if not zig:
            sys.exit(
                "ERROR: building Windows binaries requires Zig.\n"
                "  Install it with:  python -m pip install ziglang\n"
                "  (or set NOVAFORGE_ZIG to a zig executable)."
            )
        return Toolchain(
            name="zig-clang (x86_64-windows-gnu)",
            cxx=zig + ["c++"],
            target_flag=["-target", "x86_64-windows-gnu"],
            exe_suffix=".exe",
            archiver=zig + ["ar", "rcs"],
        )
    # native
    for candidate in (["clang++"], ["g++"]):
        if shutil.which(candidate[0]):
            for ar_name in ("llvm-ar", "ar"):
                if shutil.which(ar_name):
                    return Toolchain(name=candidate[0] + " (native)", cxx=candidate,
                                     target_flag=[], exe_suffix="",
                                     archiver=[ar_name, "rcs"])
            return Toolchain(name=candidate[0] + " (native)", cxx=candidate,
                             target_flag=[], exe_suffix="")
    # zig can also target the host
    zig = find_zig()
    if zig:
        return Toolchain(name="zig-clang (native)", cxx=zig + ["c++"], target_flag=[],
                         exe_suffix="", archiver=zig + ["ar", "rcs"])
    sys.exit("ERROR: no C++ compiler found (need g++, clang++ or zig).")


# --------------------------------------------------------------------------------------
# source lists
# --------------------------------------------------------------------------------------

VENDOR_SOURCES = [
    "vendor/imgui/imgui.cpp",
    "vendor/imgui/imgui_draw.cpp",
    "vendor/imgui/imgui_tables.cpp",
    "vendor/imgui/imgui_widgets.cpp",
]

# ImGui platform backends: needed by the editor AND by exported games (in-game HUD).
VENDOR_BACKEND_SOURCES = [
    "vendor/imgui/backends/imgui_impl_win32.cpp",
    "vendor/imgui/backends/imgui_impl_opengl3.cpp",
]


def engine_sources() -> list[str]:
    out = []
    for module_dir in sorted((ENGINE / "src").iterdir()):
        if not module_dir.is_dir():
            continue
        # the editor module depends on a windowing + GL backend and is compiled into the
        # editor application (see editor_sources()), never into the shared engine library
        if module_dir.name == "editor":
            continue
        for src in sorted(module_dir.rglob("*.cpp")):
            rel = src.relative_to(ROOT).as_posix()
            # platform backends are selected by target
            if "platform/win32" in rel:
                continue
            # application entry points live in the executable targets, never in the library
            if src.name == "main_game.cpp":
                continue
            out.append(rel)
    return out


def shared_editor_sources() -> list[str]:
    """Editor state hub: used by the engine library (the AI assistant plans against it)
    as well as by the editor application."""
    return ["engine/src/editor/EditorContext.cpp"]


def windows_only_sources() -> list[str]:
    return [p.relative_to(ROOT).as_posix()
            for p in sorted((ENGINE / "src" / "platform" / "win32").rglob("*.cpp"))]


def editor_sources() -> list[str]:
    # EditorContext.cpp is part of the engine library (shared_editor_sources()).
    shared = set(shared_editor_sources())
    return [p.relative_to(ROOT).as_posix()
            for p in sorted((ENGINE / "src" / "editor").rglob("*.cpp"))
            if p.relative_to(ROOT).as_posix() not in shared]


def runtime_sources(include_game_main: bool = True) -> list[str]:
    out = []
    for p in sorted((ENGINE / "src" / "runtime").rglob("*.cpp")):
        rel = p.relative_to(ROOT).as_posix()
        if not include_game_main and p.name == "main_game.cpp":
            continue          # the game entry point only belongs in the game executable
        out.append(rel)
    return out


def test_sources() -> list[str]:
    return [p.relative_to(ROOT).as_posix()
            for p in sorted((ROOT / "tests").rglob("*.cpp"))]


# --------------------------------------------------------------------------------------
# compilation
# --------------------------------------------------------------------------------------


@dataclass
class Product:
    name: str
    sources: list[str]
    kind: str                 # "app" | "lib"
    extra_defines: list[str] = field(default_factory=list)
    link_libs: list[str] = field(default_factory=list)
    windows_only: bool = False
    unity: bool = True


def products(target: str) -> list[Product]:
    eng = engine_sources()
    common_defines = []
    prods = [
        # ImGui is part of the engine library: the AI assistant panel and the editor both use it
        Product("nfengine", eng + shared_editor_sources() + VENDOR_SOURCES, "lib", unity=True),
    ]
    if target == "windows":
        prods[0].windows_only = False
        prods[0].sources = (eng + shared_editor_sources() + windows_only_sources() +
                            VENDOR_SOURCES + VENDOR_BACKEND_SOURCES)
        # the runtime + AI assistant live in the engine library; only the entry points differ
        prods.append(Product("NovaForge", editor_sources(), "app",
                             extra_defines=["NF_PLATFORM_WINDOWS=1", "NF_EDITOR=1"],
                             link_libs=["user32", "gdi32", "opengl32", "winmm", "ole32",
                                        "shell32", "comdlg32", "imm32", "ws2_32", "winhttp",
                                        "dwmapi"],
                             unity=True))
        prods.append(Product("NovaForgeGame", ["engine/src/runtime/main_game.cpp"], "app",
                             extra_defines=["NF_PLATFORM_WINDOWS=1", "NF_RUNTIME=1"],
                             link_libs=["user32", "gdi32", "opengl32", "winmm", "ole32",
                                        "shell32", "comdlg32", "imm32", "winhttp", "dwmapi"],
                             unity=True))
    else:
        # native (host) build: engine library + tests + headless runtime tools
        prods.append(Product("nftests", test_sources(), "app",
                             extra_defines=[f"NF_PLATFORM_{'LINUX' if sys.platform.startswith('linux') else 'MAC'}=1"],
                             link_libs=["m", "pthread"],
                             unity=False))
        prods.append(Product("nftool", sorted(p.relative_to(ROOT).as_posix()
                                                for p in (ROOT / "tools" / "nftool").glob("*.cpp")),
                             "app",
                             extra_defines=["NF_PLATFORM_LINUX=1"], link_libs=["m", "pthread"],
                             unity=False))
    return prods


def unity_batches(sources: list[str], batch_size: int = 40) -> list[list[str]]:
    """Group translation units into bigger ones: dramatically faster builds."""
    return [sources[i:i + batch_size] for i in range(0, len(sources), batch_size)]


def write_unity_file(idx: int, group: list[str], outdir: Path) -> Path:
    outdir.mkdir(parents=True, exist_ok=True)
    path = outdir / f"unity_{idx:03d}.cpp"
    lines = ["// generated by tools/build.py - unity build translation unit"]
    for src in group:
        lines.append(f'#include "{ (ROOT / src).as_posix() }"')
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return path


INCLUDE_DIRS = ["engine/src", "vendor/imgui", "vendor/imgui/backends", "vendor/miniaudio",
                "vendor/stb"]


def compile_one(job, tc: Toolchain, cfg: str, outdir: Path, verbose: bool):
    src, obj, extra_defines, pch_defines = job
    cmd = list(tc.cxx) + list(tc.target_flag)
    cmd += ["-std=c++20", "-c"]
    cmd += ["-O0", "-g", "-DNF_DEBUG=1"] if cfg == "debug" else ["-O2", "-DNDEBUG=1", "-DNF_DEBUG=0"]
    cmd += ["-fno-exceptions" if False else "-fexceptions"]
    cmd += ["-Wno-unused-parameter", "-Wno-missing-field-initializers", "-Wno-nullability-completeness",
            "-Wno-deprecated-declarations", "-Wno-unused-variable", "-Wno-unused-function",
            "-Wno-unused-but-set-variable", "-Wno-char-subscripts"]
    for d in INCLUDE_DIRS:
        cmd += ["-I", d]
    for d in extra_defines:
        cmd.append(f"-D{d}")
    cmd += [src, "-o", obj]
    if verbose:
        print("  " + " ".join(cmd))
    res = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
    if res.returncode != 0:
        return (False, obj, res.stdout + res.stderr)
    return (True, obj, res.stdout + res.stderr)


def build_product(prod: Product, tc: Toolchain, cfg: str, verbose: bool, jobs: int,
                  libs: list[Path] | None = None):
    out = BUILD / tc.exe_suffix.replace(".", "") / cfg / prod.name
    out.mkdir(parents=True, exist_ok=True)
    objdir = out / "obj"
    objdir.mkdir(parents=True, exist_ok=True)

    sources = list(prod.sources)
    comp_units: list[tuple[str, Path]] = []   # (source-for-deps, file-to-compile)

    defines = list(prod.extra_defines)
    prefix = f"{prod.name}_"

    if prod.unity:
        batches = unity_batches(sources, 40)
        for i, group in enumerate(batches):
            up = write_unity_file(i, group, out / "unity")
            comp_units.append((group[0], up))
    else:
        for s in sources:
            comp_units.append((s, ROOT / s))

    print(f"[build] {prod.name}: {len(sources)} sources -> {len(comp_units)} TUs "
          f"({tc.name}, {cfg})")

    objs = []
    work = []
    for i, (dep, path) in enumerate(comp_units):
        obj = objdir / f"{prefix}{i:03d}{tc.obj_suffix()}"
        objs.append(obj)
        work.append((str(path), str(obj), defines, []))

    # incremental: skip units whose object is newer than all inputs
    pending = []
    for (src, obj, defs, pch) in work:
        if os.path.exists(obj) and os.path.getmtime(obj) > os.path.getmtime(src):
            # for unity builds check every included file
            stale = False
            if prod.unity:
                for line in Path(src).read_text(encoding="utf-8").splitlines():
                    if line.startswith('#include "'):
                        f = Path(line.split('"')[1])
                        if f.exists() and f.stat().st_mtime > os.path.getmtime(obj):
                            stale = True
                            break
            if not stale:
                continue
        pending.append((src, obj, defs, pch))

    if pending:
        print(f"[build] compiling {len(pending)} unit(s) with {jobs} job(s)...")
        t0 = time.time()
        failures = []
        with concurrent.futures.ThreadPoolExecutor(max_workers=jobs) as ex:
            futs = [ex.submit(compile_one, j, tc, cfg, out, verbose) for j in pending]
            done = 0
            for f in concurrent.futures.as_completed(futs):
                ok, obj, log = f.result()
                done += 1
                if not ok:
                    failures.append((obj, log))
                if not verbose:
                    sys.stdout.write(f"\r[build] {done}/{len(pending)} units")
                    sys.stdout.flush()
        sys.stdout.write("\n")
        if failures:
            for obj, log in failures[:4]:
                print(f"\n--- compile failed: {obj} ---\n{log[:6000]}")
            sys.exit(1)
        print(f"[build] compiled in {time.time() - t0:.1f}s")

    if prod.kind == "app":
        exe = out / (prod.name + tc.exe_suffix)
        cmd = list(tc.cxx) + list(tc.target_flag)
        cmd += ["-O2"] if cfg != "debug" else ["-O0", "-g"]
        if tc.exe_suffix == ".exe":
            cmd += ["-static", "-static-libgcc"]
            # GUI subsystem for the editor, console for the runtime (so it can print/log)
            if prod.name != "NovaForgeGame":
                cmd += ["-Wl,--subsystem,windows"]
            cmd += ["-Wl,--stack,16777216"]
        # objects first, then the engine archives inside --start-group/--end-group so the
        # linker resolves them regardless of the order members are needed in
        cmd += [str(o) for o in objs]
        if libs:
            cmd.append("-Wl,--start-group")
            cmd += [str(lib) for lib in libs]
            cmd.append("-Wl,--end-group")
        cmd += ["-o", str(exe)]
        for lib in prod.link_libs:
            cmd.append("-l" + lib)
        if tc.exe_suffix != ".exe":
            cmd.append("-pthread")
        if verbose:
            print("  " + " ".join(cmd))
        res = subprocess.run(cmd, cwd=ROOT, capture_output=True, text=True)
        if res.returncode != 0:
            print(f"--- link failed: {prod.name} ---\n{(res.stdout + res.stderr)[:8000]}")
            sys.exit(1)
        print(f"[build] linked -> {rel(exe)}")
        return exe
    else:
        lib = out / ("lib" + prod.name + ".a")
        if os.path.exists(str(lib)):
            os.remove(str(lib))
        res = subprocess.run(list(tc.archiver) + [str(lib)] + [str(o) for o in objs],
                             cwd=ROOT, capture_output=True, text=True)
        if res.returncode != 0:
            # fall back to the clang driver's partial link (works on ELF hosts)
            res = subprocess.run(list(tc.cxx) + ["-r"] + [str(o) for o in objs] + ["-o", str(lib)],
                                 cwd=ROOT, capture_output=True, text=True)
        if res.returncode != 0:
            print("--- archive failed ---\n" + (res.stdout + res.stderr)[:4000])
            sys.exit(1)
        print(f"[build] archived -> {rel(lib)}")
        return lib


def main():
    ap = argparse.ArgumentParser(description="NovaForge build driver")
    ap.add_argument("--target", default="native", choices=["native", "windows"])
    ap.add_argument("--config", default="release", choices=["debug", "release"])
    ap.add_argument("--jobs", type=int, default=max(1, (os.cpu_count() or 2)))
    ap.add_argument("--unity", action="store_true", default=True)
    ap.add_argument("--no-unity", dest="unity", action="store_false")
    ap.add_argument("-v", "--verbose", action="store_true")
    ap.add_argument("--only", default=None, help="build a single product by name")
    ap.add_argument("--stage", default=None,
                    help="cross-compile the game runtime and copy it into this folder as "
                         "<exe-name>.exe (used by the rebuild scripts shipped inside a build)")
    ap.add_argument("--exe-name", default=None, help="name of the staged executable")
    ap.add_argument("--build-dir", default=None,
                    help="where intermediate objects and binaries go (default: <repo>/build; "
                         "a throw-away temp directory is used when --stage is given, so a rebuild "
                         "never leaves build artifacts inside a shipped package)")
    ap.add_argument("--list", action="store_true")
    args = ap.parse_args()

    if args.list:
        for p in products(args.target):
            print(f"{p.name:16s} {p.kind:4s} {len(p.sources)} sources")
        return

    global BUILD
    if args.build_dir:
        BUILD = Path(args.build_dir).expanduser().resolve()
    elif args.stage:
        BUILD = Path(tempfile.mkdtemp(prefix="novaforge-rebuild-"))
        atexit.register(shutil.rmtree, BUILD, True)  # never leave artifacts in the package

    staged_exe: Path | None = None
    if args.stage:
        # "rebuild this package": always a Windows game exe built from the packaged sources
        args.target = "windows"
        args.only = "NovaForgeGame"
        staged_exe = Path(args.stage) / ((args.exe_name or "NovaForgeGame") + ".exe")

    tc = make_toolchain(args.target, args.verbose)
    print(f"[build] NovaForge Engine | target={args.target} config={args.config} | {tc.name}")
    built_libs: list[Path] = []
    for p in products(args.target):
        # the shared engine library is always built first (applications link against it)
        if args.only and p.name != args.only and p.kind != "lib":
            continue
        p.unity = p.unity and args.unity
        artifact = build_product(p, tc, args.config, args.verbose, args.jobs, built_libs)
        if p.kind == "lib" and artifact is not None:
            built_libs.append(Path(artifact))
        if staged_exe is not None and p.kind == "app" and artifact is not None:
            staged_exe.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(artifact, staged_exe)
            print(f"[build] staged -> {staged_exe}  ({staged_exe.stat().st_size} bytes)")

    if not args.build_dir and args.stage:
        # objects and the intermediate binary were written to a temp dir: leave no trace behind
        shutil.rmtree(BUILD, ignore_errors=True)
    print("[build] done.")


if __name__ == "__main__":
    main()
