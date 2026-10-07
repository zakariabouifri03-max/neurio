#!/usr/bin/env python3
"""Development helper (Linux CI/dev containers only).

The PySide6 manylinux wheels link against a handful of system libraries
(libGL.so.1, libEGL.so.1, libxkbcommon.so.0, libdbus-1.so.3) that are not
installed in minimal containers.  Qt's `offscreen` platform plugin never calls
into those libraries for raster widget rendering, so we can satisfy the dynamic
linker with symbol stubs.

This file is *not* part of the shipped application: it only exists so the whole
UI test-suite can run headless on a bare container.  Windows builds use the
real Qt DLLs from the official PySide6 wheels.

Usage:  python tools/stub_libs.py [--out DIR]
"""
from __future__ import annotations

import argparse
import collections
import glob
import os
import shutil
import subprocess
import sys

IGNORE_WEAK = True


def _site_packages_qt() -> str | None:
    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    venv = os.path.join(here, ".venv")
    for pat in (
        os.path.join(venv, "lib", "python*", "site-packages", "PySide6", "Qt"),
        os.path.join(venv, "Lib", "site-packages", "PySide6", "Qt"),
    ):
        hits = glob.glob(pat)
        if hits:
            return hits[0]
    return None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=None, help="output directory for stub libs")
    args = ap.parse_args()

    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    out = args.out or os.path.join(root, ".devlibs")
    build = os.path.join(root, ".devbuild")
    os.makedirs(out, exist_ok=True)
    os.makedirs(build, exist_ok=True)

    qtdir = _site_packages_qt()
    if not qtdir:
        print("PySide6 not installed in .venv - nothing to do")
        return 0
    qtlib = os.path.join(qtdir, "lib")

    from elftools.elf.elffile import ELFFile  # type: ignore

    sysdirs = ["/lib/x86_64-linux-gnu", "/usr/lib/x86_64-linux-gnu", "/usr/lib", "/lib"]

    def present(name: str):
        for d in [qtlib, *sysdirs]:
            p = os.path.join(d, name)
            if os.path.exists(p):
                return p
        return None

    def scan(path: str):
        need, undef, defined, soname = [], [], set(), None
        with open(path, "rb") as fh:
            elf = ELFFile(fh)
            symtab = None
            for sec in elf.iter_sections():
                if sec.name == ".dynsym":
                    symtab = sec
                if sec.header["sh_type"] == "SHT_DYNAMIC":
                    for tag in sec.iter_tags():
                        if tag.entry.d_tag == "DT_NEEDED":
                            need.append(tag.needed)
                        elif tag.entry.d_tag == "DT_SONAME":
                            soname = tag.soname
            if symtab:
                for sym in symtab.iter_symbols():
                    if not sym.name:
                        continue
                    if sym["st_shndx"] == "SHN_UNDEF":
                        undef.append((sym.name, sym["st_info"]["bind"]))
                    else:
                        defined.add(sym.name)
        return need, undef, defined, soname

    sonmap = {}
    for path in glob.glob(os.path.join(qtlib, "*.so*")):
        try:
            *_, soname = scan(path)
        except Exception:
            continue
        if soname:
            sonmap[soname] = path

    starts = [
        os.path.join(qtlib, name)
        for name in (
            "libQt6Widgets.so.6",
            "libQt6Gui.so.6",
            "libQt6Core.so.6",
            "libQt6Svg.so.6",
            "libQt6Network.so.6",
            "libQt6Multimedia.so.6",
            "libQt6SvgWidgets.so.6",
            "libQt6OpenGL.so.6",
            "libQt6OpenGLWidgets.so.6",
        )
        if os.path.exists(os.path.join(qtlib, name))
    ]
    starts += glob.glob(os.path.join(qtdir, "plugins", "platforms", "libqoffscreen.so"))

    seen, missing = set(), set()
    all_undef: dict[str, set[str]] = collections.defaultdict(set)
    all_defined: set[str] = set()
    queue = list(starts)
    while queue:
        path = queue.pop()
        if path in seen:
            continue
        seen.add(path)
        try:
            need, undef, defined, _ = scan(path)
        except Exception:
            continue
        all_defined |= defined
        for name, bind in undef:
            all_undef[name].add(bind)
        for name in need:
            target = sonmap.get(name) or present(name)
            if target:
                queue.append(target)
            else:
                missing.add(name)

    unresolved = sorted(
        name
        for name, binds in all_undef.items()
        if name not in all_defined and not (IGNORE_WEAK and binds == {"STB_WEAK"})
    )
    print(f"missing sonames : {sorted(missing)}")
    print(f"unresolved syms : {len(unresolved)}")

    if not missing:
        print("nothing to stub")
        return 0

    src = os.path.join(build, "stub.c")
    with open(src, "w") as fh:
        for name in unresolved:
            fh.write(f"void {name}(void) {{ }}\n")

    zig = _find_zig(root)
    if not zig:
        print("zig not found - install `ziglang` into .venv (pip install ziglang)")
        return 1

    lib = os.path.join(build, "libstub.so")
    subprocess.check_call([zig, "cc", "-shared", "-fPIC", "-O1", "-o", lib, src])
    for name in sorted(missing):
        shutil.copyfile(lib, os.path.join(out, name))
    print(f"wrote {len(missing)} stub libraries to {out}")
    return 0


def _find_zig(root: str) -> str | None:
    exe = "zig.exe" if os.name == "nt" else "zig"
    candidates = [
        os.path.join(root, ".venv", "bin", exe),
        os.path.join(root, ".venv", "Scripts", exe),
    ]
    for pat in (
        os.path.join(root, ".venv", "lib", "python*", "site-packages", "ziglang", exe),
    ):
        candidates += glob.glob(pat)
    for c in candidates:
        if os.path.exists(c) and os.access(c, os.X_OK):
            return c
    return shutil.which("zig")


if __name__ == "__main__":
    sys.exit(main())
