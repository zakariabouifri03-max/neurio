# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec — single-file build.

Produces dist/UltraDownload.exe (one self-contained executable).
First start is slower (self-extraction to %TEMP%); prefer the onedir
spec for daily use.
"""

import os

block_cipher = None

a = Analysis(
    [os.path.join('ultradownload', 'main.py')],
    pathex=[os.path.abspath('.')],
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
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='UltraDownload',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=os.path.join('assets', 'icon.ico'),
    version=os.path.join('assets', 'version_info.txt'),
)
