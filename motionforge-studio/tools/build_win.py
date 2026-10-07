"""Build the downloadable Windows packages for MotionForge Studio.

Produces two artefacts in ``dist/``:

* ``MotionForge-Studio-<ver>-win64-portable.zip`` - unpack anywhere and run
  ``MotionForge Studio.exe`` (self contained folder, no install, no Python).
* ``MotionForge-Studio-Setup-<ver>.exe`` - single file installer that unpacks
  the portable build, creates Start-menu / desktop shortcuts, registers an
  uninstaller in "Apps & features" and can run silently with ``/silent``.

The build is self contained: a stock CPython 3.13 *embedded* runtime plus the
Windows wheels of Qt (PySide6), numpy, imageio-ffmpeg and msvc-runtime are
fetched from PyPI, then stitched into an application folder whose entry point is
a renamed, resource patched ``pythonw.exe`` (real icon, real version info, no
console window).

    tools/devrun.sh tools/build_win.py                  # full build
    tools/devrun.sh tools/build_win.py --no-installer    # portable zip only
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import struct
import subprocess
import sys
import time
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PKG = os.path.join(ROOT, "app")
PY_VERSION = "3.13"
PY_TAG = "cp313"
APP_EXE = "MotionForge Studio.exe"
ICON_SRC = os.path.join(ROOT, "packaging", "win", "icon-source.png")
ICON = os.path.join(ROOT, "packaging", "win", "motionforge.ico")
ICON_SIZES = (16, 24, 32, 48, 64, 128, 256)
VENDOR = "MotionForge Labs"

WHEELS = [
    ("PySide6-Essentials", None),
    ("PySide6-Addons", None),
    ("shiboken6", None),
    ("numpy", None),
    ("imageio-ffmpeg", None),
    ("msvc-runtime", None),
]

# files/dirs that are not needed at runtime
STRIP_PATHS = (
    "include", "libs", "tcl", "Scripts", "Lib/site-packages", "Lib/ensurepip",
    "Lib/idlelib", "Lib/tkinter", "Lib/turtledemo", "Lib/test", "Lib/lib2to3",
    "Lib/unittest/test", "Lib/distutils", "Lib/venv", "Lib/msilib",
    "DLLs/_tkinter.pyd", "DLLs/tcl86t.dll", "DLLs/tk86t.dll",
    "DLLs/py.ico", "DLLs/pyc.ico", "DLLs/pyd.ico", "DLLs/python_lib.cat",
)
PY_SIDE_JUNK = ("assistant.exe", "designer.exe", "linguist.exe", "lrelease.exe",
                "lupdate.exe", "qmlcachegen.exe", "qml", "doc", "glue", "typesystems",
                "include", "lib", "metatypes", "qmltooling", "sqldrivers",
                "networkinformation", "designer", "qmllint", "QtQml.pyd",
                "QtQuick.pyd", "QtQuickControls2.pyd", "QtQuickWidgets.pyd",
                "QtQuickTest.pyd", "QtSql.pyd", "QtDBus.pyd", "QtTest.pyd")


# ---------------------------------------------------------------------------
# version helpers
# ---------------------------------------------------------------------------
def app_version() -> tuple[int, int, int]:
    src = open(os.path.join(PKG, "mfs", "__init__.py"), encoding="utf-8").read()
    ver = re.search(r'__version__\s*=\s*"([^"]+)"', src)
    if not ver:
        return (1, 0, 0)
    parts = [int(p) for p in re.findall(r"\d+", ver.group(1))[:3]]
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts)  # type: ignore[return-value]


def ver_text(version: tuple[int, int, int]) -> str:
    return ".".join(str(p) for p in version)


# ---------------------------------------------------------------------------
# downloads
# ---------------------------------------------------------------------------
VRE = re.compile(r"^(\d+)\.(\d+)(?:\.(\d+))?(?:(a|b|rc|dev)(\d+))?")


def vkey(v: str):
    m = VRE.match(v)
    if not m:
        return None
    major, minor, patch, tag, num = m.groups()
    return (int(major), int(minor), int(patch or 0), 0 if not tag else 1, int(num or 0))


def pypi_json(name: str) -> dict:
    with urllib.request.urlopen(f"https://pypi.org/pypi/{name}/json", timeout=120) as fh:
        return json.load(fh)


def stable_releases(data: dict):
    out = []
    for ver, files in data["releases"].items():
        k = vkey(ver)
        if files and k is not None and not k[3]:
            out.append((k, ver, files))
    out.sort(key=lambda x: x[0], reverse=True)
    return out


def pick_wheel(files, tags=("cp313", "abi3", "cp3", "py3-none", "py2.py3")):
    best = None
    for f in files:
        n = f["filename"]
        if not n.endswith(".whl") or "win_amd64" not in n or f["packagetype"] != "bdist_wheel":
            continue
        for rank, tag in enumerate(tags):
            if tag in n:
                if best is None or rank < best[0]:
                    best = (rank, f)
                break
    return best[1] if best else None


def download(url: str, path: str, size_hint: int = -1) -> str:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    if os.path.exists(path) and (size_hint < 0 or os.path.getsize(path) == size_hint):
        return path
    tmp = path + ".part"
    t0 = time.time()
    with urllib.request.urlopen(url, timeout=180) as src, open(tmp, "wb") as dst:
        shutil.copyfileobj(src, dst, 1024 * 512)
    os.replace(tmp, path)
    dt = max(0.05, time.time() - t0)
    print(f"    downloaded {os.path.basename(path)} "
          f"({os.path.getsize(path) / 1e6:.1f} MB in {dt:.1f}s)", flush=True)
    return path


def fetch_wheels(cache: str) -> list[str]:
    os.makedirs(cache, exist_ok=True)
    paths = []
    for name, pin in WHEELS:
        stem = name.lower().replace("-", "_")
        have = [f for f in os.listdir(cache)
                if f.lower().startswith(stem[:12]) and f.endswith(".whl") and "win_amd64" in f]
        if have:
            print(f"  cache", have[0])
            paths.append(os.path.join(cache, have[0]))
            continue
        data = pypi_json(name)
        chosen = pick_wheel(data["urls"]) if pin else None
        if chosen is None:
            for _k, _ver, rel in stable_releases(data):
                chosen = pick_wheel(rel)
                if chosen is not None:
                    break
        if chosen is None:
            raise SystemExit(f"no Windows wheel on PyPI for {name}")
        paths.append(download(chosen["url"], os.path.join(cache, chosen["filename"]),
                              chosen.get("size", -1)))
    return paths


def fetch_python_payload(cache: str, explicit: str = "") -> str:
    """Return the folder holding the embedded CPython payload (``cp313/``)."""
    if explicit:
        if os.path.exists(os.path.join(explicit, "python.exe")) or \
                os.path.exists(os.path.join(explicit, PY_TAG, "python.exe")):
            return explicit if os.path.exists(os.path.join(explicit, "python.exe")) \
                else os.path.join(explicit, PY_TAG)
        raise SystemExit(f"{explicit} does not look like a CPython payload")
    marker = os.path.join(cache, f"payload-{PY_TAG}", "python.exe")
    if os.path.exists(marker):
        print("  cache embedded CPython payload")
        return os.path.dirname(marker)
    data = pypi_json("winpython-embed")
    chosen = None
    for _k, ver, files in stable_releases(data):
        for f in files:
            if f["filename"].endswith((".tar.gz", ".zip")) and "winpython" in f["filename"]:
                chosen = f
                print(f"  winpython-embed {ver}: {chosen['filename']}")
                break
        if chosen is not None:
            break
    if chosen is None:
        raise SystemExit("winpython-embed payload not available on PyPI")
    archive = download(chosen["url"], os.path.join(cache, chosen["filename"]),
                       chosen.get("size", -1))
    outdir = os.path.join(cache, f"payload-{PY_TAG}")
    shutil.rmtree(outdir, ignore_errors=True)
    os.makedirs(outdir, exist_ok=True)
    import tarfile
    with tarfile.open(archive) as tar:
        inner = next((m for m in tar.getmembers() if m.name.endswith("data.zip")), None)
        if inner is None:
            raise SystemExit("winpython-embed archive has no data.zip")
        tar.extract(inner, outdir)
        data_zip = os.path.join(outdir, inner.name)
    with zipfile.ZipFile(data_zip) as z:
        for member in z.namelist():
            if member.startswith(f"{PY_TAG}/"):
                z.extract(member, outdir)
    os.remove(data_zip)
    return os.path.join(outdir, PY_TAG)


# ---------------------------------------------------------------------------
# resource building
# ---------------------------------------------------------------------------
def _utf16z(text: str) -> bytes:
    return text.encode("utf-16-le") + b"\x00\x00"


def _align4(b: bytes) -> bytes:
    return b + b"\x00" * ((4 - len(b) % 4) % 4)


def version_blob(version: tuple[int, int, int], app_name: str, exe_name: str) -> bytes:
    """A VS_VERSIONINFO blob ready to drop into an RT_VERSION leaf."""
    def w16(v):
        return struct.pack("<H", v)

    def w32(v):
        return struct.pack("<I", v)

    vs = version + (0,)
    hi, lo = (vs[0] << 16) | vs[1], vs[2] << 16
    fixed = (w32(0xFEEF04BD) + w32(0x00010000) + w32(hi) + w32(lo) +
             w32(hi) + w32(lo) + w32(hi) + w32(lo) + w32(0x3F))

    strings = [
        ("CompanyName", VENDOR),
        ("FileDescription", f"{app_name} - professional 2D animation studio"),
        ("FileVersion", ver_text(version)),
        ("InternalName", os.path.splitext(exe_name)[0]),
        ("LegalCopyright", f"Copyright (C) 2026 {VENDOR}. All rights reserved."),
        ("OriginalFilename", exe_name),
        ("ProductName", app_name),
        ("ProductVersion", f"{ver_text(version)} (Windows x64)"),
        ("Comments", "Draw, rig and animate 2D characters - timeline, rigging, audio, AI."),
    ]
    sblock = b""
    for key, value in strings:
        item = _align4(_utf16z(key) + _utf16z(value))
        sblock = _align4(sblock + w16(0) + w16(len(item) // 2) + w16(1)
                         + _utf16z(key) + _utf16z(value))
    strinfo = _align4(w16(0) + w16(len(sblock) // 2) + w16(1) + b"040904B0" + sblock)
    var_item = _align4(w16(0) + w16(4) + w16(0) + _utf16z("Translation")
                       + w32(0x04B00409))
    varinfo = _align4(w16(0) + w16(len(var_item) // 2) + w16(1) + _utf16z("VarFileInfo")
                      + var_item)
    children = (_align4(w16(0) + w16(len(fixed) // 2) + w16(0)
                        + _utf16z("VS_VERSION_INFO") + fixed)
                + _align4(w16(0) + w16(len(strinfo) // 2) + w16(1)
                          + _utf16z("StringFileInfo") + strinfo)
                + _align4(w16(0) + w16(len(varinfo) // 2) + w16(1)
                          + _utf16z("VarFileInfo") + varinfo))
    return _align4(children)


def pe_imports(path: str) -> set[str]:
    """Lower-case names of the DLLs a PE file imports (empty set if not a PE)."""
    try:
        data = open(path, "rb").read()
    except OSError:
        return set()
    if len(data) < 0x40 or data[:2] != b"MZ":
        return set()
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    if data[pe:pe + 4] != b"PE\x00\x00":
        return set()
    nsec = struct.unpack_from("<H", data, pe + 6)[0]
    opt_size = struct.unpack_from("<H", data, pe + 20)[0]
    magic = struct.unpack_from("<H", data, pe + 24)[0]
    ddoff = pe + 24 + (112 if magic == 0x20B else 96)
    imp_rva, _imp_size = struct.unpack_from("<II", data, ddoff + 8)
    if not imp_rva:
        return set()
    sections = []
    sec = pe + 24 + opt_size
    for i in range(nsec):
        o = sec + 40 * i
        vsize, va, rawsize, rawptr = struct.unpack_from("<IIII", data, o + 8)
        sections.append((va, max(vsize, rawsize), rawptr))

    def rva2off(rva: int):
        for va, size, rawptr in sections:
            if va <= rva < va + size:
                return rawptr + (rva - va)
        return None

    off = rva2off(imp_rva)
    names = set()
    while off:
        try:
            desc = struct.unpack_from("<IIIII", data, off)
        except struct.error:
            break
        if not any(desc):
            break
        no = rva2off(desc[3])
        if no is None:
            break
        end = data.find(b"\x00", no)
        if end < 0:
            break
        names.add(data[no:end].decode("ascii", "replace").lower())
        off += 20
    return names


def prune_qt(pyside: str) -> int:
    """Delete every Qt module/plugin the studio does not use.

    The keep list is a dependency closure computed from the modules the app
    imports, so nothing needed at run time can be dropped by accident.
    """
    keep_pyd = {"qtcore", "qtgui", "qtwidgets", "qtsvg", "qtnetwork", "qtmultimedia",
                "qtmultimediawidgets", "qtsvgwidgets", "qtopenglwidgets", "qtopenGL".lower()}
    keep_plugins = ("platforms", "styles", "imageformats", "iconengines", "generic",
                    "multimedia")
    plugins = os.path.join(pyside, "plugins")
    removed = 0
    for base, _dirs, files in os.walk(plugins):
        rel = os.path.relpath(base, plugins)
        top = rel.split(os.sep)[0]
        if rel == "." or top in keep_plugins:
            continue
        for f in files:
            os.remove(os.path.join(base, f))
            removed += 1
    # everything below the plugin dirs we drop entirely
    for junk in ("translations", "resources", "qml", "typesystems", "include", "lib",
                 "metatypes", "qmltooling"):
        target = os.path.join(pyside, junk)
        if os.path.isdir(target):
            shutil.rmtree(target, ignore_errors=True)

    pool = {f.lower(): f for f in os.listdir(pyside) if f.lower().endswith(".dll")}
    roots = []
    for f in os.listdir(pyside):
        low = f.lower()
        if low.endswith(".pyd") and low[:-4] in keep_pyd:
            roots.append(os.path.join(pyside, f))
    for name in ("qt6core", "qt6gui", "qt6widgets", "qt6svg", "qt6network", "qt6multimedia",
                 "qt6multimediawidgets", "qt6opengl", "qt6openglwidgets", "qt6svgwidgets",
                 "pyside6.abi3", "qtsvgwidgets"):
        if name + ".dll" in pool:
            roots.append(os.path.join(pyside, pool[name + ".dll"]))
    for base, _dirs, files in os.walk(plugins):
        for f in files:
            if f.lower().endswith(".dll"):
                roots.append(os.path.join(base, f))
    keep = {"pyside6.abi3.dll", "pyside6qml.abi3.dll"}
    stack = list(roots)
    while stack:
        path = stack.pop()
        for imp in pe_imports(path):
            if imp in keep:
                continue
            if imp in pool:
                keep.add(imp)
                stack.append(os.path.join(pyside, pool[imp]))
    for f in list(os.listdir(pyside)):
        low = f.lower()
        full = os.path.join(pyside, f)
        if os.path.isdir(full):
            continue
        if low.endswith(".pyd") and low[:-4] not in keep_pyd:
            os.remove(full)
            removed += 1
        elif low.startswith("qt6") and low.endswith(".dll") and low not in keep:
            os.remove(full)
            removed += 1
        elif low.endswith((".exe", ".pdb", ".bat", ".cmd", ".ilk")) or low == "pyside6qml.abi3.dll":
            os.remove(full)
            removed += 1
    # command line tools inside the plugin dirs are never needed at run time
    for base, _dirs, files in os.walk(plugins):
        for f in files:
            if f.lower().endswith((".exe", ".pdb")):
                os.remove(os.path.join(base, f))
                removed += 1
    return removed


def ico_images(path: str) -> dict:
    """Parse an .ico -> {size: png_bytes}."""
    data = open(path, "rb").read()
    _r, _k, count = struct.unpack_from("<HHH", data, 0)
    out = {}
    for i in range(count):
        w, h, _c, _r2, _p, _b, size, offset = struct.unpack_from("<BBBBHHII", data,
                                                                 6 + 16 * i)
        out[(w or 256, h or 256)] = data[offset:offset + size]
    return out


def bmp_icon_blob(png: bytes, size: int) -> bytes | None:
    """RT_ICON bitmap form: BITMAPINFOHEADER + bottom-up BGRA + AND mask."""
    from PySide6.QtGui import QImage
    img = QImage.fromData(png, "PNG")
    if img.isNull():
        return None
    img = img.convertToFormat(QImage.Format_ARGB32)
    w, h = img.width(), img.height()
    rows = []
    bits = img.constBits()
    bpl = img.bytesPerLine()
    raw = bytes(bits)[: bpl * h]
    for y in range(h):
        rows.append(raw[y * bpl:y * bpl + w * 4])
    xor = b"".join(reversed(rows))
    row_bytes = ((w + 31) // 32) * 4
    mask_rows = []
    for y in range(h):
        row = bytearray(row_bytes)
        line = rows[y]
        for x in range(w):
            if line[x * 4 + 3] == 0:
                row[x // 8] |= 0x80 >> (x % 8)
        mask_rows.append(bytes(row))
    header = struct.pack("<IiiHHIIiiII", 40, w, h * 2, 1, 32, 0, len(xor), 0, 0, 0, 0)
    return header + xor + b"".join(reversed(mask_rows))


def icon_blobs(icons: dict) -> tuple[list[bytes], bytes]:
    """Return the RT_ICON payloads and the matching RT_GROUP_ICON blob."""
    leaves, entries = [], []
    for idx, size in enumerate(ICON_SIZES, start=1):
        png = icons.get((size, size))
        if png is None:
            continue
        if size >= 256:
            leaf = png
        else:
            leaf = bmp_icon_blob(png, size)
            if leaf is None:
                continue
        leaves.append(leaf)
        dim = 0 if size >= 256 else size
        entries.append(struct.pack("<BBBBHHIH", dim, dim, 0, 0, 1, 32, len(leaf), idx))
    group = struct.pack("<HHH", 0, 1, len(entries)) + b"".join(entries)
    return leaves, group


def patch_pe_resources(path: str, ico_path: str, version: tuple[int, int, int],
                       app_name: str, exe_name: str) -> dict:
    """Replace icon + version resources of a PE file, in place.

    New resource *data* is appended to the ``.rsrc`` section (and the section is
    grown); the existing RT_ICON / RT_GROUP_ICON / RT_VERSION leaves are simply
    re-pointed at it, so no directory entry has to move.
    """
    data = bytearray(open(path, "rb").read())
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    _machine, nsec, _ts, _sym, _nsym, opt_size, _chars = struct.unpack_from(
        "<HHIIIHH", data, pe + 4)
    magic = struct.unpack_from("<H", data, pe + 24)[0]
    ddoff = pe + 24 + (112 if magic == 0x20B else 96)
    rsrc_rva, _rsrc_size = struct.unpack_from("<II", data, ddoff + 2 * 8)
    sec = pe + 24 + opt_size
    rsrc_off = rsrc_sec = None
    sections = []
    for i in range(nsec):
        o = sec + 40 * i
        name = bytes(data[o:o + 8]).rstrip(b"\x00")
        vsize, va, rawsize, rawptr = struct.unpack_from("<IIII", data, o + 8)
        sections.append((o, name, vsize, va, rawsize, rawptr))
        if name == b".rsrc":
            rsrc_off, rsrc_sec = rawptr, (o, name, vsize, va, rawsize, rawptr)
    if rsrc_off is None:
        raise SystemExit(f"{path}: no .rsrc section")

    def walk(off, path_=()):
        nname, nid = struct.unpack_from("<HH", data, rsrc_off + off + 12)
        found = []
        for i in range(nid):
            e = rsrc_off + off + 16 + 8 * (nname + i)
            ident, dataoff = struct.unpack_from("<II", data, e)
            if dataoff & 0x80000000:
                found += walk(dataoff & 0x7FFFFFFF, path_ + (ident,))
            else:
                found.append((path_ + (ident,), rsrc_off + dataoff))
        for i in range(nname):
            e = rsrc_off + off + 16 + 8 * i
            ident, dataoff = struct.unpack_from("<II", data, e)
            so = rsrc_off + (ident & 0x7FFFFFFF)
            ln = struct.unpack_from("<H", data, so)[0]
            nm = bytes(data[so + 2:so + 2 + 2 * ln]).decode("utf-16-le", "replace")
            if dataoff & 0x80000000:
                found += walk(dataoff & 0x7FFFFFFF, path_ + (nm,))
            else:
                found.append((path_ + (nm,), rsrc_off + dataoff))
        return found

    leaves = walk(0)
    by_type: dict = {}
    for entry in leaves:
        by_type.setdefault(entry[0][0], []).append(entry)

    leaves_icon, group = icon_blobs(ico_images(ico_path)) if os.path.exists(ico_path) else ([], b"")
    ver = version_blob(version, app_name, exe_name)

    raw_size = rsrc_sec[4]
    appended = bytearray()

    def append(blob: bytes) -> int:
        off = raw_size + len(appended)
        appended.extend(_align4(blob))
        return off

    stats = {"icons": 0, "group": 0, "version": 0}
    for i, entry in enumerate(by_type.get(3, [])):
        if i >= len(leaves_icon):
            break
        leaf = leaves_icon[i]
        rva = rsrc_rva + append(leaf)
        struct.pack_into("<IIII", data, entry[1], rva, len(leaf), 0, 0)
        stats["icons"] += 1
    for entry in by_type.get(14, [])[:1]:
        rva = rsrc_rva + append(group)
        struct.pack_into("<IIII", data, entry[1], rva, len(group), 0, 0)
        stats["group"] = 1
    for entry in by_type.get(16, [])[:1]:
        rva = rsrc_rva + append(ver)
        struct.pack_into("<IIII", data, entry[1], rva, len(ver), 1200, 0)
        stats["version"] = 1

    file_align = struct.unpack_from("<I", data, pe + 24 + 36)[0]
    new_raw = (raw_size + len(appended) + file_align - 1) // file_align * file_align
    appended.extend(b"\x00" * (new_raw - raw_size - len(appended)))
    delta = len(appended)
    insert_at = rsrc_off + raw_size

    for o, name, _vs, _va, _rs, rawptr in sections:
        if name != b".rsrc" and rawptr >= insert_at:
            struct.pack_into("<I", data, o + 20, rawptr + delta)
    data[insert_at:insert_at] = bytes(appended)
    struct.pack_into("<II", data, rsrc_sec[0] + 8, new_raw, rsrc_sec[3])
    struct.pack_into("<II", data, rsrc_sec[0] + 16, new_raw, rsrc_off)
    struct.pack_into("<II", data, ddoff + 2 * 8, rsrc_rva, new_raw)
    sec_align = struct.unpack_from("<I", data, pe + 24 + 32)[0]
    size_of_image = struct.unpack_from("<I", data, pe + 24 + 56)[0]
    need = (rsrc_rva + new_raw + sec_align - 1) // sec_align * sec_align
    if need > size_of_image:
        struct.pack_into("<I", data, pe + 24 + 56, need)
    open(path, "wb").write(bytes(data))
    return stats


def make_icon_assets() -> None:
    """(Re)build the multi-size .ico from the generated artwork."""
    if not os.path.exists(ICON_SRC):
        print("  no icon source, skipping")
        return
    script = os.path.join(ROOT, "tools", "make_icon.py")
    env = {**os.environ, "QT_QPA_PLATFORM": "offscreen",
           "PYTHONPATH": os.path.join(ROOT, "app")}
    if os.path.isdir(os.path.join(ROOT, ".devlibs")):
        env["LD_LIBRARY_PATH"] = os.path.join(ROOT, ".devlibs") + ":" + env.get("LD_LIBRARY_PATH", "")
    subprocess.run([sys.executable, script], check=True, cwd=ROOT, env=env,
                   stdout=subprocess.DEVNULL)
    print("  icon:", os.path.relpath(ICON, ROOT))


# ---------------------------------------------------------------------------
# assembly
# ---------------------------------------------------------------------------
def assemble(out: str, payload_dir: str, wheel_dirs: dict, version) -> str:
    app_dir = os.path.join(out, "MotionForge Studio")
    shutil.rmtree(app_dir, ignore_errors=True)
    os.makedirs(app_dir)

    print("  runtime ...")
    for name in os.listdir(payload_dir):
        src, dst = os.path.join(payload_dir, name), os.path.join(app_dir, name)
        if os.path.isdir(src):
            shutil.copytree(src, dst)
        else:
            shutil.copy2(src, dst)
    for rel in STRIP_PATHS:
        target = os.path.join(app_dir, rel)
        if os.path.isdir(target):
            shutil.rmtree(target, ignore_errors=True)
        elif os.path.exists(target):
            os.remove(target)

    print("  libraries ...")
    lib = os.path.join(app_dir, "lib")
    os.makedirs(lib, exist_ok=True)
    for src in wheel_dirs.values():
        for entry in os.listdir(src):
            if entry.endswith(".dist-info") or entry.endswith(".data"):
                continue
            s, d = os.path.join(src, entry), os.path.join(lib, entry)
            if os.path.isdir(s):
                shutil.copytree(s, d, dirs_exist_ok=True,
                                ignore=shutil.ignore_patterns("__pycache__", "*.pyi",
                                                              "*.h", "*.lib", "*.prl"))
            else:
                shutil.copy2(s, d)
    pyside = os.path.join(lib, "PySide6")
    dropped = prune_qt(pyside)
    print(f"    pruned {dropped} unused Qt file(s)")
    for junk in PY_SIDE_JUNK:
        target = os.path.join(pyside, junk)
        if os.path.isdir(target):
            shutil.rmtree(target, ignore_errors=True)
        elif os.path.exists(target):
            os.remove(target)
    for name in list(os.listdir(pyside)):
        low = name.lower()
        if low.endswith((".pyi", ".qmltypes")) or low.startswith("qt6qml"):
            target = os.path.join(pyside, name)
            shutil.rmtree(target, ignore_errors=True) if os.path.isdir(target) else os.remove(target)
    plugins = os.path.join(pyside, "plugins")
    for junk in ("designer", "qmllint", "qmltooling", "sqldrivers", "networkinformation"):
        shutil.rmtree(os.path.join(plugins, junk), ignore_errors=True)

    print("  application ...")
    shutil.copytree(os.path.join(PKG, "mfs"), os.path.join(app_dir, "app", "mfs"),
                    ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    docs = os.path.join(ROOT, "docs")
    if os.path.isdir(docs):
        shutil.copytree(docs, os.path.join(app_dir, "docs"),
                        ignore=shutil.ignore_patterns("__pycache__"))

    with open(os.path.join(app_dir, f"python{PY_VERSION.replace('.', '')}._pth"), "w",
              encoding="utf-8") as fh:
        fh.write("python313.zip\n.\nLib\nlib\napp\nimport site\n")

    print("  launcher ...")
    shutil.copy2(os.path.join(ROOT, "packaging", "win", "launcher", "MotionForge.py"),
                 os.path.join(app_dir, "MotionForge.py"))
    for source, target in (("pythonw.exe", APP_EXE), ("python.exe", "MotionForge console.exe")):
        src = os.path.join(app_dir, source)
        if not os.path.exists(src):
            continue
        dst = os.path.join(app_dir, target)
        shutil.copy2(src, dst)
        if os.path.exists(ICON):
            stats = patch_pe_resources(dst, ICON, version, "MotionForge Studio", target)
            print(f"    {target}: {stats['icons']} icon frames, version={stats['version']}")
        shutil.copy2(dst, os.path.join(app_dir, "launcher", os.path.basename(target))) \
            if False else None

    write_notices(app_dir, payload_dir, lib, version)
    shutil.copy2(os.path.join(ROOT, "packaging", "win", "ReadMe.txt"),
                 os.path.join(app_dir, "ReadMe.txt"))
    shutil.copy2(ICON, os.path.join(app_dir, "motionforge.ico"))
    print("  built", app_dir)
    return app_dir


def write_notices(app_dir: str, payload_dir: str, lib: str, version) -> None:
    lic = os.path.join(app_dir, "licenses")
    os.makedirs(lic, exist_ok=True)
    lines = [
        f"MotionForge Studio {ver_text(version)} - third party components",
        "=" * 64,
        "",
        "This application is distributed together with the components below.",
        "Their licence texts are collected in this folder.",
        "",
        f" * CPython {PY_VERSION}          - PSF License 2.0  (LICENSE_CPYTHON.txt)",
        " * Qt 6.11 / PySide6     - LGPL v3 (dynamic linking, replaceable DLLs)",
        " * numpy                 - BSD 3-Clause",
        " * imageio-ffmpeg        - BSD 2-Clause; bundles an FFmpeg static build",
        " * msvc-runtime          - Microsoft Visual C++ runtime redistributables",
        "",
        "FFmpeg runs as a separate executable process for encoding video and",
        "decoding audio (see licenses/ffmpeg-license.txt).",
        "",
    ]
    with open(os.path.join(lic, "THIRD-PARTY-NOTICES.txt"), "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines))
    src = os.path.join(payload_dir, "LICENSE.txt")
    if os.path.exists(src):
        shutil.copy2(src, os.path.join(lic, "LICENSE_CPYTHON.txt"))
    with open(os.path.join(lic, "LGPL_QT.txt"), "w", encoding="utf-8") as fh:
        fh.write("Qt 6 is used under the LGPL v3.  The Qt shared libraries shipped in\n"
                 "lib/PySide6 are unmodified and can be replaced by the user.\n"
                 "Full text: https://www.gnu.org/licenses/lgpl-3.0.txt\n"
                 "Qt source: https://download.qt.io/official_releases/qt/\n")
    with open(os.path.join(lic, "ffmpeg-license.txt"), "w", encoding="utf-8") as fh:
        fh.write("FFmpeg static build shipped by the imageio-ffmpeg project.\n"
                 "FFmpeg is licensed under the LGPL 2.1+ (some builds GPL); see\n"
                 "https://ffmpeg.org/legal.html .  FFmpeg is a trademark of\n"
                 "Fabrice Bellard, originator of the FFmpeg project.\n")
    for cand in os.listdir(lib):
        if cand.lower().startswith("numpy") and cand.endswith(".dist-info"):
            base = os.path.join(lib, cand, "licenses")
            if os.path.isdir(base):
                for f in sorted(os.listdir(base)):
                    shutil.copy2(os.path.join(base, f), os.path.join(lic, "BSD_NUMPY.txt"))
                    break
    with open(os.path.join(app_dir, "version.txt"), "w", encoding="utf-8") as fh:
        fh.write(ver_text(version) + "\n")


def folder_size(path: str) -> int:
    total = 0
    for base, _dirs, files in os.walk(path):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(base, f))
            except OSError:
                pass
    return total


def build_portable_zip(app_dir: str, out: str, version) -> str:
    path = os.path.join(out, f"MotionForge-Studio-{ver_text(version)}-win64-portable.zip")
    if os.path.exists(path):
        os.remove(path)
    base = os.path.dirname(app_dir)
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for root_dir, _dirs, files in os.walk(app_dir):
            for f in files:
                full = os.path.join(root_dir, f)
                z.write(full, os.path.relpath(full, base))
    print(f"  portable zip: {path} ({os.path.getsize(path) / 1e6:.1f} MB)")
    return path


# ---------------------------------------------------------------------------
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Build the Windows packages")
    ap.add_argument("--cache", default="/tmp/mfs-win-cache")
    ap.add_argument("--out", default=os.path.join(ROOT, "dist"))
    ap.add_argument("--no-installer", action="store_true")
    ap.add_argument("--no-icons", action="store_true")
    ap.add_argument("--payload", default="", help="already extracted CPython payload")
    args = ap.parse_args(argv)

    version = app_version()
    print(f"MotionForge Studio {ver_text(version)} - Windows build")
    os.makedirs(args.out, exist_ok=True)
    os.makedirs(args.cache, exist_ok=True)

    if not args.no_icons:
        make_icon_assets()

    print("  fetching Python payload ...")
    payload = fetch_python_payload(args.cache, args.payload)
    print("  fetching wheels ...")
    wheel_files = fetch_wheels(args.cache)
    extract = os.path.join(args.cache, "extracted")
    os.makedirs(extract, exist_ok=True)
    wheel_dirs = {}
    for whl in wheel_files:
        key = os.path.basename(whl).split("-")[0].replace("_", "-").lower()
        target = os.path.join(extract, key)
        stamp = os.path.join(target, ".ok")
        if not os.path.exists(stamp):
            shutil.rmtree(target, ignore_errors=True)
            os.makedirs(target, exist_ok=True)
            with zipfile.ZipFile(whl) as z:
                z.extractall(target)
            open(stamp, "w").write("1")
        wheel_dirs[key] = target

    work = os.path.join(args.cache, "tree")
    os.makedirs(work, exist_ok=True)
    app_dir = assemble(work, payload, wheel_dirs, version)
    size = folder_size(app_dir)
    print(f"  app folder: {size / 1e6:.0f} MB")

    zip_path = build_portable_zip(app_dir, args.out, version)

    setup = None
    if not args.no_installer:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from build_win_installer import build_installer
        setup = build_installer(zip_path, args.out, version, ICON, APP_EXE)

    print("\nDone:")
    print("  ", zip_path)
    if setup:
        print("  ", setup)
    with open(os.path.join(args.out, "BUILD-INFO.txt"), "w", encoding="utf-8") as fh:
        fh.write(f"MotionForge Studio {ver_text(version)}\n"
                 f"built {time.strftime('%Y-%m-%d %H:%M:%S')}\n"
                 f"portable: {os.path.basename(zip_path)} ({os.path.getsize(zip_path)/1e6:.1f} MB)\n")
        if setup:
            fh.write(f"installer: {os.path.basename(setup)} ({os.path.getsize(setup)/1e6:.1f} MB)\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
