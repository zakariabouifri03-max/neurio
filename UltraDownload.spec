# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for UltraDownload.

Build on Windows with:  pyinstaller UltraDownload.spec
Produces:               dist/UltraDownload.exe  (one-file, windowed)
"""

import sys
from pathlib import Path

block_cipher = None
project = Path(SPECPATH)

a = Analysis(
    [str(project / "ultradownload" / "__main__.py")],
    pathex=[str(project)],
    binaries=[],
    datas=[
        (str(project / "assets" / "icon.png"), "assets"),
        (str(project / "assets" / "icon.ico"), "assets"),
    ],
    hiddenimports=[
        "ultradownload",
        "ultradownload.app",
        "ultradownload.manager",
        "ultradownload.config",
        "ultradownload.utils",
        "ultradownload.engine",
        "ultradownload.engine.task",
        "ultradownload.engine.inspector",
        "ultradownload.engine.merger",
        "ultradownload.engine.ranges",
        "ultradownload.engine.parts",
        "ultradownload.engine.speed",
        "ultradownload.engine.bandwidth",
        "ultradownload.engine.errors",
        "ultradownload.storage.database",
        "ultradownload.gui",
        "ultradownload.gui.main_window",
        "ultradownload.gui.signals",
        "ultradownload.gui.theme",
        "ultradownload.gui.widgets",
        "ultradownload.gui.pages.dashboard",
        "ultradownload.gui.pages.add_download",
        "ultradownload.gui.pages.details",
        "ultradownload.gui.pages.history",
        "ultradownload.gui.pages.settings_page",
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "unittest", "pydoc", "tests"],
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
    a.datas,
    [],
    name="UltraDownload",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,            # windowed GUI application
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(project / "assets" / "icon.ico"),
    version=str(project / "file_version_info.txt")
    if sys.platform == "win32" else None,
)
