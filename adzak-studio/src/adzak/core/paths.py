"""Application directory layout.

Everything ADZAK writes outside of the user's project folders goes under the
per-user data directory so that the application never needs administrator
privileges.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

APP_DIR_NAME = "AdzakCreativeStudio"


def app_data_dir() -> Path:
    """Per-user data directory (settings DB, logs, cache, autosaves)."""
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or os.path.expanduser("~")
    elif sys.platform == "darwin":
        base = os.path.join(os.path.expanduser("~"), "Library", "Application Support")
    else:
        base = os.environ.get("XDG_DATA_HOME") or os.path.join(
            os.path.expanduser("~"), ".local", "share"
        )
    p = Path(base) / APP_DIR_NAME
    p.mkdir(parents=True, exist_ok=True)
    return p


def logs_dir() -> Path:
    p = app_data_dir() / "logs"
    p.mkdir(parents=True, exist_ok=True)
    return p


def cache_dir() -> Path:
    p = app_data_dir() / "cache"
    p.mkdir(parents=True, exist_ok=True)
    return p


def autosave_dir() -> Path:
    p = app_data_dir() / "autosave"
    p.mkdir(parents=True, exist_ok=True)
    return p


def projects_dir() -> Path:
    """Default location for new projects."""
    home = Path.home()
    candidates = [home / "AdzakProjects", home / "Documents" / "AdzakProjects"]
    p = candidates[0]
    p.mkdir(parents=True, exist_ok=True)
    return p


def default_ffmpeg_dir() -> Path | None:
    """Where a bundled ffmpeg.exe would live next to a packaged app."""
    if getattr(sys, "frozen", False):  # PyInstaller build
        base = Path(sys.executable).parent
    else:
        base = Path(__file__).resolve().parents[3]
    bundled = base / "ffmpeg" / "bin"
    return bundled if bundled.exists() else None
