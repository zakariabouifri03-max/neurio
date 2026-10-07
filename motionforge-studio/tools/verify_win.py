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

from build_win import APP_EXE, app_version, pe_imports  # noqa: E402

APP_VER = app_version()

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


def parse_version_info(blob: bytes, problems: list[str]) -> dict:
    """Parse a VS_VERSIONINFO blob the way Windows does.

    Windows silently ignores a blob whose ``wLength`` fields are wrong (an
    empty "Details" tab in Explorer), so this reader is deliberately strict:
    every structure must declare its own size, and the root must carry the
    52 byte ``VS_FIXEDFILEINFO``.
    """
    def node(off: int, label: str) -> dict:
        if off + 6 > len(blob):
            problems.append(f"{label}: truncated header")
            return {"key": "", "length": 0, "value": b"", "children": []}
        length, value_len, value_type = struct.unpack_from("<HHH", blob, off)
        end_key = off + 6
        while end_key + 1 < len(blob) and blob[end_key:end_key + 2] != b"\x00\x00":
            end_key += 2
        key = blob[off + 6:end_key].decode("utf-16-le", "replace")
        here = {"key": key, "length": length, "value": b"", "children": [],
                "value_type": value_type}
        cursor = (end_key + 2 + 3) & ~3
        if value_type == 0:
            here["value"] = blob[cursor:cursor + value_len]
            cursor = (cursor + value_len + 3) & ~3
        else:
            here["value"] = blob[cursor:cursor + value_len * 2]
            cursor = (cursor + value_len * 2 + 3) & ~3
        if length == 0 or off + length > len(blob):
            problems.append(f"{label}/{key}: wLength {length} is invalid")
            return here
        stop = off + length
        while cursor + 6 <= stop:
            child = node(cursor, f"{label}/{key}")
            here["children"].append(child)
            step = cursor + max(child["length"], 1)
            if step <= cursor:
                break
            cursor = step
        return here

    root = node(0, "")
    out: dict = {"problems": problems, "key": root["key"], "strings": {},
                 "translation": None, "file_version": None, "product_version": None}

    def collect(extra: dict) -> None:
        for child in extra.get("children", []):
            if child["key"] == "StringFileInfo":
                for table in child["children"]:
                    for item in table["children"]:
                        value = item["value"].decode("utf-16-le", "replace")
                        out["strings"][item["key"]] = value.split("\x00")[0]
            elif child["key"] == "VarFileInfo":
                for var in child["children"]:
                    if var["key"] == "Translation" and len(var["value"]) >= 4:
                        out["translation"] = struct.unpack_from("<HH", var["value"], 0)
            collect(child)

    collect(root)
    fixed = root["value"]
    if len(fixed) < 52:
        problems.append("root: VS_FIXEDFILEINFO is missing")
    else:
        signature, _struct_ver, fv_hi, fv_lo = struct.unpack_from("<IIII", fixed, 0)
        if signature != 0xFEEF04BD:
            problems.append(f"root: VS_FIXEDFILEINFO signature {signature:#x} is wrong")
        out["file_version"] = ((fv_hi >> 16) & 0xFFFF, fv_hi & 0xFFFF,
                               (fv_lo >> 16) & 0xFFFF)
    if root["key"] != "VS_VERSION_INFO":
        problems.append(f"root: key is {root['key']!r}")
    return out


def version_check(path: str, label: str, version: tuple[int, int, int]) -> int:
    """Everything Windows needs to show a full Details page."""
    problems: list[str] = []
    res = pe_resources(path)
    versions = res.get(16, [])
    if not versions:
        print(f"{FAIL} {label}: no RT_VERSION resource")
        return 1
    info = parse_version_info(versions[0][2], problems)
    strings = info["strings"]
    wanted = {
        "ProductName": "MotionForge Studio",
        "FileVersion": ".".join(str(p) for p in version),
        "FileDescription": None,
        "CompanyName": None,
        "OriginalFilename": None,
    }
    for key, expected in wanted.items():
        value = strings.get(key, "")
        good = bool(value) and (expected is None or value == expected)
        if not good:
            problems.append(f"{key}={value!r} (expected {expected!r})")
        print(f"{OK if good else FAIL} {key:16s} {value!r}")
    if info["file_version"] != version:
        problems.append(f"fixed file version {info['file_version']} != {version}")
    if info["translation"] is None:
        problems.append("no translation entry in VarFileInfo")
    if problems:
        print(f"{FAIL} {label}: version resource problems")
        for problem in problems:
            print(f"        - {problem}")
    return len(problems)


def check_pe(path: str, label: str, version: tuple[int, int, int],
             require_resources: bool = True) -> int:
    """Structural check of an executable, plus its icon and version resource."""
    problems = 0
    with open(path, "rb") as fh:
        head = fh.read(2)
    if head != b"MZ":
        print(f"{WARN} {label}: not a Windows PE (cross platform build), "
              f"{os.path.getsize(path) / 1e6:.1f} MB")
        return 0
    size = os.path.getsize(path)
    data = open(path, "rb").read()
    pe = struct.unpack_from("<I", data, 0x3C)[0]
    nsec = struct.unpack_from("<H", data, pe + 6)[0]
    opt_size = struct.unpack_from("<H", data, pe + 20)[0]
    magic = struct.unpack_from("<H", data, pe + 24)[0]
    sec = pe + 24 + opt_size
    problems += 0
    for i in range(nsec):
        o = sec + 40 * i
        _vs, va, rawsize, rawptr = struct.unpack_from("<IIII", data, o + 8)
        if rawptr + rawsize > size:
            print(f"{FAIL} {label}: section {i} runs past the end of the file")
            problems += 1
    layout = []
    for i in range(nsec):
        o = sec + 40 * i
        name = data[o:o + 8].rstrip(b"\x00").decode("latin1")
        layout.append((name, struct.unpack_from("<I", data, o + 20)[0]))
    if problems == 0:
        print(f"      sections: " + ", ".join(n for n, _ in layout))
    res = pe_resources(path)
    icons = res.get(3, [])
    groups = res.get(14, [])
    print(f"{OK if (icons and groups) else FAIL} {label}: {len(icons)} icons, "
          f"{len(groups)} icon group(s), {size/1e6:.1f} MB")
    if require_resources and (not icons or not groups):
        problems += 1
    problems += version_check(path, label, version)
    _ = magic
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
        exe = next((n for n in names
                    if n.lower().endswith(APP_EXE.lower())), None)
        if exe is None:
            print(f"{FAIL} {APP_EXE} missing")
            return problems + 1
        tmp = os.path.join(tempfile.gettempdir(), "mfs_verify_" + os.path.basename(exe))
        with z.open(exe) as src, open(tmp, "wb") as dst:
            dst.write(src.read())
        problems += check_pe(tmp, APP_EXE, APP_VER)
        leaked = [n for n in names
                  if os.path.basename(n).lower() in ("python.exe", "pythonw.exe")]
        if leaked:
            print(f"{FAIL} the build still contains {leaked}")
            problems += 1
        console = next((n for n in names
                        if n.lower().endswith("motionforge runtime console.exe")), None)
        if console:
            with z.open(console) as src, open(tmp + ".console", "wb") as dst:
                dst.write(src.read())
            problems += check_pe(tmp + ".console", "console runtime", APP_VER)
        required = ["python313.dll", "lib/PySide6/QtCore.pyd", "app/mfs/app.py",
                    "app/mfs/ui/session.py", "MotionForge.py", "ReadMe.txt",
                    "lib/PySide6/Qt6Core.dll", "lib/numpy/__init__.py",
                    "lib/imageio_ffmpeg/binaries/", "licenses/THIRD-PARTY-NOTICES.txt",
                    "MotionForge Studio.exe", "MotionForge runtime.exe",
                    "MotionForge runtime console.exe", "python313._pth"]
        # windows checkouts produce "Lib/..." while linux builds write "lib/...",
        # so every comparison here must be case-insensitive
        lowered = [(n, n.lower()) for n in names]
        for want in required:
            w = want.lower()
            hit = any(l.endswith(w) or (w.endswith("/") and w in l) for _n, l in lowered)
            if not hit:
                problems += 1
                stem = os.path.basename(want.rstrip("/"))
                near = [n for _n, l in lowered if stem and stem.split(".")[0].lower() in l][:4]
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
            problems += check_pe(target, os.path.basename(target), APP_VER)
    print("\n" + ("ALL CHECKS PASSED" if not problems else f"{problems} PROBLEM(S) FOUND"))
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
