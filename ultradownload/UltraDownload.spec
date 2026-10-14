# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec — onedir build (recommended).

Produces dist/UltraDownload/UltraDownload.exe plus its support files.
onedir starts instantly; use UltraDownload-onefile.spec for a single
self-extracting executable instead.
"""

import os

block_cipher = None

APP_ROOT = os.path.abspath('.')

a = Analysis(
    [os.path.join('ultradownload', 'main.py')],
    pathex=[APP_ROOT],
    binaries=[],
    datas=[
        (os.path.join('assets', 'icon.png'), 'assets'),
        (os.path.join('assets', 'icon.ico'), 'assets'),
    ],
    hiddenimports=[],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'tkinter', 'matplotlib', 'numpy', 'scipy', 'pandas', 'IPython',
        'notebook', 'jupyter', 'pytest', 'setuptools', 'wheel', 'pip',
    ],
    win_no_prefer_redirects=False,
    win_unpriv_sandbox=False,
    cipher=block_cipher,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    exclude_binaries=True,
    name='UltraDownload',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,                # GUI app: no console window
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=os.path.join('assets', 'icon.ico'),
    version=os.path.join('assets', 'version_info.txt'),
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='UltraDownload',
)
