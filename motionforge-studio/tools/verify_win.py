"""Verify a built Windows artefact (portable zip or installer exe).

Checks, without running anything:

* the archive/folder layout a user sees after unpacking,
* the entry point is a real PE executable with our icon group and version
  information,
* no Qt/library import of the packaged Qt modules is missing (the resource
  patcher and the Qt pruner are the two places a build can silently break),
* the application sources and the path configuration file are in place.

    tools/devrun.sh tools/verify_win.py dist/MotionForge-Studio-1.0.0-win64-portable.zip
"""
from __future__ import annotations

import os
import struct
import sys
import tempfile
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from build_win import APP_EXE, pe_imports  # noqa: E402

OK = "  ok  "
WARN = " warn "
FAIL = " FAIL "


def read_window(path: str, count: int) -> bytes:
    with open(path, "rb") as fh:
        return fh.read(count)


def pe_resources(path: str) -> dict:
    """Return {type: [(id, size, data)]} for a PE file."""
    data = open(path, "rb").read()
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    nsec = struct.unpack_from("<H", data, pe + 6)[0]
    opt_size = struct.unpack_from("<H", data, pe + 20)[0]
    magic = struct.unpack_from("<H", data, pe + 24)[0]
    ddoff = pe + 24 + (112 if magic == 0x20B else 96)
    rsrc_rva, rsrc_size = struct.unpack_from("<II", data, ddoff + 2 * 8)
    if not rsrc_rva:
        return {}
    sections = []
    sec = pe + 24 + opt_size
    for i in range(nsec):
        o = sec + 40 * i
        vsize, va, rawsize, rawptr = struct.unpack_from("<IIII", data, o + 8)
        sections.append((va, max(vsize, rawsize), rawptr))

    def rva2off(rva):
        for va, size, rawptr in sections:
            if va <= rva < va + size:
                return rawptr + (rva - va)
        return None

    base = rva2off(rsrc_rva)
    if base is None:
        return {}
    out: dict = {}

    def walk(off, level, path_=()):
        nname, nid = struct.unpack_from("<HH", data, base + off + 12)
        for i in range(nname + nid):
            e = base + off + 16 + 8 * i
            ident, dataoff = struct.unpack_from("<II", data, e)
            if i < nname:
                so = base + (ident & 0x7FFFFFFF)
                ln = struct.unpack_from("<H", data, so)[0]
                key = data[so + 2:so + 2 + 2 * ln].decode("utf-16-le", "replace")
            else:
                key = ident
            if dataoff & 0x80000000:
                walk(dataoff & 0x7FFFFFFF, level + 1, path_ + (key,))
            else:
                rva, size, _cp, _r = struct.unpack_from("<IIII", data, base + dataoff)
                blob_off = rva2off(rva)
                blob = data[blob_off:blob_off + size] if blob_off is not None else b""
                out.setdefault(path_[0] if path_ else key, []).append((key, size, blob))

    walk(0, 0)
    return out


def read_version_strings(blob: bytes) -> dict:
    """Very small VS_VERSIONINFO reader - enough for a build check."""
    text = blob.decode("utf-16-le", "replace")
    out = {}
    for key in ("CompanyName", "FileDescription", "FileVersion", "ProductName",
                "ProductVersion", "OriginalFilename"):
        idx = text.find(key)
        if idx >= 0:
            start = idx + len(key)
            while start < len(text) and text[start] == "\x00":
                start += 1
            end = start
            while end < len(text) and text[end] not in "\x00":
                end += 1
            out[key] = text[start:end]
    return out


def check_pe(path: str, label: str) -> int:
    problems = 0
    with open(path, "rb") as fh:
        head = fh.read(2)
    if head != b"MZ":
        print(f"{FAIL} {label}: not a Windows executable")
        return 1
    size = os.path.getsize(path)
    data = open(path, "rb").read()
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    nsec = struct.unpack_from("<H", data, pe + 6)[0]
    opt_size = struct.unpack_from("<H", data, pe + 20)[0]
    magic = struct.unpack_from("<H", data, pe + 24)[0]
    size_of_image = struct.unpack_from("<I", data, pe + 24 + 56)[0]
    sec = pe + 24 + opt_size
    worst = 0
    for i in range(nsec):
        o = sec + 40 * i
        _vs, va, rawsize, rawptr = struct.unpack_from("<IIII", data, o + 8)
        worst = max(worst, rawptr + rawsize)
        if rawptr + rawsize > size:
            print(f"{FAIL} {label}: section {i} runs past the end of the file")
            problems += 1
    if worst > size:
        problems += 1
    res = pe_resources(path)
    icons = res.get(3, [])
    groups = res.get(14, [])
    versions = res.get(16, [])
    print(f"{OK if icons and groups else FAIL} {label}: {len(icons)} icons, "
          f"{len(groups)} icon group(s), {len(versions)} version resource(s), {size/1e6:.1f} MB")
    if not icons or not groups:
        problems += 1
    if versions:
        info = read_version_strings(versions[0][2])
        for key in ("ProductName", "FileVersion", "FileDescription"):
            value = info.get(key, "")
            flag = OK if value else FAIL
            if not value:
                problems += 1
            print(f"{flag} {key:16s} {value!r}")
    else:
        print(f"{FAIL} {label}: no version information")
        problems += 1
    _ = magic, size_of_image
    return problems


def verify_zip(path: str) -> int:
    problems = 0
    if not os.path.exists(path):
        print(f"{FAIL} {path} not found")
        return 1
    print(f"== {os.path.basename(path)} ({os.path.getsize(path)/1e6:.1f} MB)")
    with zipfile.ZipFile(path) as z:
        names = z.namelist()
        bad = z.testzip()
        print(f"{OK if bad is None else FAIL} archive integrity ({len(names)} entries)")
        if bad:
            problems += 1
        root = sorted({n.split("/")[0] for n in names})
        print(f"      top level: {root}")
        exe = next((n for n in names if n.endswith(APP_EXE)), None)
        if exe is None:
            print(f"{FAIL} {APP_EXE} missing")
            return problems + 1
        tmp = os.path.join(tempfile.gettempdir(), "mfs_verify_" + os.path.basename(exe))
        with z.open(exe) as src, open(tmp, "wb") as dst:
            dst.write(src.read())
        problems += check_pe(tmp, APP_EXE)
        console = next((n for n in names if n.endswith("MotionForge console.exe")), None)
        if console:
            with z.open(console) as src, open(tmp + ".console", "wb") as dst:
                dst.write(src.read())
            problems += check_pe(tmp + ".console", "console twin")
        required = ["python313.dll", "lib/PySide6/QtCore.pyd", "app/mfs/app.py",
                    "app/mfs/ui/session.py", "MotionForge.py", "ReadMe.txt",
                    "lib/PySide6/Qt6Core.dll", "lib/numpy/__init__.py",
                    "lib/imageio_ffmpeg/binaries/", "licenses/THIRD-PARTY-NOTICES.txt"]
        for want in required:
            hit = any(n.endswith(want) or (want.endswith("/") and want in n) for n in names)
            if not hit:
                problems += 1
                stem = os.path.basename(want.rstrip("/"))
                near = [n for n in names if stem and stem.split(".")[0].lower() in n.lower()][:4]
                print(f"{FAIL} {want}   near={near}")
            else:
                print(f"{OK} {want}")
        print(f"      entry style: {names[500:502]}")
        if any("\\" in n for n in names):
            backslashes = [n for n in names if "\\" in n][:3]
            print(f"{FAIL} archive uses backslash separators, e.g. {backslashes}")
            problems += 1
        pth = next((n for n in names if n.endswith("python313._pth")), None)
        if pth:
            content = z.read(pth).decode("utf-8")
            print(f"{OK} python313._pth -> {content.split()}")
            if "app" not in content or "lib" not in content:
                problems += 1
        else:
            print(f"{FAIL} python313._pth missing")
            problems += 1
    return problems


def verify_folder(app_dir: str) -> int:
    """Import closure check: every DLL referenced by the kept Qt modules exists."""
    print(f"== {app_dir}")
    pyside = os.path.join(app_dir, "lib", "PySide6")
    if not os.path.isdir(pyside):
        print(f"{FAIL} no lib/PySide6")
        return 1
    pool = {f.lower() for f in os.listdir(pyside)}
    pool |= {f.lower() for f in os.listdir(app_dir)}
    for sub in ("DLLs",):
        if os.path.isdir(os.path.join(app_dir, sub)):
            pool |= {f.lower() for f in os.listdir(os.path.join(app_dir, sub))}
    problems = 0
    checked = 0
    for base, _dirs, files in os.walk(os.path.join(app_dir, "lib")):
        for f in files:
            if not f.lower().endswith((".dll", ".pyd", ".exe")):
                continue
            full = os.path.join(base, f)
            checked += 1
            for imp in pe_imports(full):
                if imp.startswith(("api-ms-", "ext-ms-", "kernel32", "user32", "gdi32",
                                   "advapi32", "shell32", "ole32", "oleaut32", "comdlg32",
                                   "winmm", "ws2_32", "bcrypt", "crypt32", "version",
                                   "shlwapi", "dwmapi", "uxtheme", "powrprof", "userenv",
                                   "imm32", "netapi32", "secur32", "mpr", "wtsapi32")):
                    continue
                if imp not in pool and not imp.endswith((".drv",)):
                    if imp.startswith("qt6") or imp.startswith("pyside6") or imp in pool:
                        print(f"{FAIL} {f}: needs {imp}")
                        problems += 1
                    break
    print(f"{OK if not problems else FAIL} import closure of {checked} binaries "
          f"({problems} missing)")
    return problems


def main(argv) -> int:
    targets = argv[1:] or ["dist"]
    problems = 0
    for target in targets:
        if os.path.isdir(target):
            problems += verify_folder(target)
        elif target.endswith(".zip"):
            problems += verify_zip(target)
        elif target.endswith(".exe"):
            problems += check_pe(target, os.path.basename(target))
    print("\n" + ("ALL CHECKS PASSED" if not problems else f"{problems} PROBLEM(S) FOUND"))
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
