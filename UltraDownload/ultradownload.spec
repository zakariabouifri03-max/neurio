# Build on Windows with Python 3.12 x64. PyInstaller does not cross-compile.
from pathlib import Path
import sys
from PyInstaller.utils.hooks import collect_submodules

if sys.platform != 'win32':
    raise SystemExit('Build UltraDownload.exe on Windows. Cross-compilation is not supported.')
root = Path(SPECPATH)
a = Analysis([str(root / 'main.py')], pathex=[str(root)],
    binaries=[], datas=[(str(root / 'assets' / 'app_icon.ico'), 'assets')],
    hiddenimports=collect_submodules('keyring.backends') + collect_submodules('win32ctypes', filter=lambda name: '.tests' not in name),
    hookspath=[], hooksconfig={}, runtime_hooks=[],
    excludes=['pytest', 'tkinter', 'PySide6.QtWebEngineCore', 'PySide6.QtWebEngineWidgets'],
    noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, a.binaries, a.datas, [],
    name='UltraDownload', debug=False, bootloader_ignore_signals=False, strip=False,
    upx=False, console=False, disable_windowed_traceback=False,
    icon=str(root / 'assets' / 'app_icon.ico'), version=str(root / 'version_info.txt'),
    uac_admin=False)
