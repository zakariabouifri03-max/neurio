# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for NovaCut AI Studio (Windows x64, also works on Linux/macOS).

Build:  pyinstaller installer/novacut.spec
Output: dist/NovaCutAIStudio/  (launch NovaCutAIStudio.exe inside it)

Place ffmpeg.exe / ffprobe.exe into installer/bin/ before building and the
build script will bundle them; at runtime the app discovers them next to the
executable, then falls back to PATH and the imageio-ffmpeg wheel.
"""
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

ROOT = Path(SPECPATH).parent
datas = [
    (str(ROOT / "novacut" / "resources"), "novacut/resources"),
]
bin_dir = ROOT / "installer" / "bin"
if bin_dir.exists():
    for exe in bin_dir.glob("*.exe"):
        datas.append((str(exe), "bin"))
    for dll in bin_dir.glob("*.dll"):
        datas.append((str(dll), "bin"))

hiddenimports = (
    collect_submodules("novacut")
    + ["PySide6.QtMultimedia", "PySide6.QtMultimediaWidgets"]
)

a = Analysis(
    [str(ROOT / "run.py")],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "PySide6.QtWebEngineCore", "PySide6.Qt3DCore",
              "PySide6.QtCharts", "PySide6.QtDataVisualization"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="NovaCutAIStudio",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,                # GUI application
    disable_windowed_traceback=False,
    icon=str(ROOT / "novacut" / "resources" / "novacut.ico")
        if (ROOT / "novacut" / "resources" / "novacut.ico").exists() else None,
)
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="NovaCutAIStudio",
)
