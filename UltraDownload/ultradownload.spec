# Build on Windows: python -m PyInstaller --clean --noconfirm ultradownload.spec
from pathlib import Path
root = Path(SPECPATH)
a = Analysis(
    [str(root / 'main.py')], pathex=[str(root)],
    binaries=[], datas=[(str(root / 'assets' / 'app_icon.ico'), 'assets')],
    hiddenimports=['app.self_test'],
    hookspath=[], hooksconfig={}, runtime_hooks=[str(root / 'tools' / 'diagnostic_hook.py')],
    excludes=['pytest', 'tkinter', 'PySide6.QtWebEngineCore', 'PySide6.QtWebEngineWidgets',
              'PySide6.QtQml', 'PySide6.QtQuick', 'PySide6.QtMultimedia'],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz, a.scripts, a.binaries, a.datas, [],
    name='UltraDownload', debug=False, bootloader_ignore_signals=False,
    strip=False, upx=False, console=False,
    icon=str(root / 'assets' / 'app_icon.ico'),
    version=str(root / 'version_info.txt'),
)
