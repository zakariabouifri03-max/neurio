# -*- mode: python ; coding: utf-8 -*-
# Neurio PyInstaller spec — builds Neurio.exe for Windows/Linux/macOS
# Usage: pyinstaller app/Neurio.spec
# Or: python -m PyInstaller app/Neurio.spec
# Output: dist/Neurio.exe (Windows) / dist/Neurio (Linux/Mac)

import sys
from PyInstaller.utils.hooks import collect_all, collect_data_files

# Collect rembg + onnxruntime data
datas = []
binaries = []
hiddenimports = []

try:
    d, b, h = collect_all('rembg')
    datas += d; binaries += b; hiddenimports += h
except: pass

try:
    d, b, h = collect_all('onnxruntime')
    datas += d; binaries += b; hiddenimports += h
except: pass

try:
    d, b, h = collect_all('cv2')
    datas += d; binaries += b; hiddenimports += h
except: pass

hiddenimports += [
    'PIL', 'PIL.Image', 'PIL.ImageEnhance', 'PIL.ImageFilter', 'PIL.ImageOps',
    'numpy', 'cv2',
    'onnxruntime', 'onnxruntime.capi',
    'rembg', 'rembg.bg',
]

block_cipher = None

a = Analysis(
    ['main.py'],
    pathex=[],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=['tkinter', 'matplotlib', 'scipy', 'notebook'],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='Neurio',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,  # GUI app — no black console
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='icons/neurio.ico' if sys.platform == 'win32' else None,
    # On Mac, create .app bundle separately via BUNDLE
)

# Optional: on Mac build .app
# app = BUNDLE(exe, name='Neurio.app', icon='icons/neurio.icns', bundle_identifier='com.neurio.app')
