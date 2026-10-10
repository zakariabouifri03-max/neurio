# PyInstaller spec for ADZAK CREATIVE STUDIO (Windows build)
# Build with:  pyinstaller --clean scripts/adzak.spec
import os
from pathlib import Path

ROOT = Path(SPECPATH).parent
SRC = ROOT / "src"

templates = str(SRC / "adzak" / "resources" / "templates")
ffmpeg_dir = ROOT / "ffmpeg" / "bin"
extras = [(templates, os.path.join("adzak", "resources", "templates"))]
if ffmpeg_dir.exists():
    extras.append((str(ffmpeg_dir), "ffmpeg/bin"))

a = Analysis(
    [str(SRC / "adzak" / "__main__.py")],
    pathex=[str(SRC)],
    binaries=[],
    datas=extras,
    hiddenimports=[
        "adzak.core", "adzak.services", "adzak.ai", "adzak.ui",
        "imageio_ffmpeg",
    ],
    excludes=["tkinter", "matplotlib", "scipy", "pandas", "torch"],
    noarchive=False,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="AdzakCreativeStudio",
    debug=False,
    strip=False,
    upx=False,
    console=False,              # GUI app: no console window
    icon=None,                  # set to an .ico path to brand the exe
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    name="AdzakCreativeStudio",
)
