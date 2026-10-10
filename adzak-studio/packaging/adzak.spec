# PyInstaller spec (onedir: faster start on low-end PCs and replaceable Qt DLLs for LGPL compliance).
# Build with:  pyinstaller --noconfirm packaging/adzak.spec   (run from the adzak-studio folder)
# -*- mode: python ; coding: utf-8 -*-
import os

ROOT = os.path.abspath(os.path.join(SPECPATH, ".."))
FFMPEG_DIR = os.path.join(ROOT, "packaging", "ffmpeg")
datas = [(os.path.join(ROOT, "THIRD_PARTY_LICENSES.md"), "licenses")]
binaries = []
if os.path.isfile(os.path.join(FFMPEG_DIR, "ffmpeg.exe")):
    binaries.append((os.path.join(FFMPEG_DIR, "ffmpeg.exe"), "ffmpeg"))
if os.path.isfile(os.path.join(FFMPEG_DIR, "ffprobe.exe")):
    binaries.append((os.path.join(FFMPEG_DIR, "ffprobe.exe"), "ffmpeg"))

a = Analysis(
    [os.path.join(ROOT, "adzak", "__main__.py")],
    pathex=[ROOT],
    binaries=binaries,
    datas=datas,
    hiddenimports=["keyring.backends.Windows"],
    excludes=["tkinter", "matplotlib", "torch", "tensorflow", "IPython", "notebook", "pytest"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="ADZAK-Creative-Studio",
    console=False,
    disable_windowed_traceback=False,
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name="ADZAK-Creative-Studio")
