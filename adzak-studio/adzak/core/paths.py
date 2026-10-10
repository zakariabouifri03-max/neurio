"""Per-user application directories. No administrator rights are required."""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

APP_DIR_NAME = "ADZAK-Creative-Studio"


def app_data_dir() -> Path:
    override = os.environ.get("ADZAK_DATA_DIR")
    if override:
        root = Path(override)
    elif sys.platform == "win32":
        root = Path(os.environ.get("APPDATA", str(Path.home()))) / APP_DIR_NAME
    else:
        root = Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local" / "share"))) / APP_DIR_NAME
    root.mkdir(parents=True, exist_ok=True)
    return root


def subdir(name: str) -> Path:
    p = app_data_dir() / name
    p.mkdir(parents=True, exist_ok=True)
    return p


def temp_dir() -> Path:
    return subdir("tmp")


def cleanup_temp(max_age_hours: float = 24.0) -> int:
    """Delete stale files from the temp folder. Returns the number of files removed."""
    cutoff = time.time() - max_age_hours * 3600
    removed = 0
    for f in temp_dir().glob("*"):
        try:
            if f.is_file() and f.stat().st_mtime < cutoff:
                f.unlink()
                removed += 1
        except OSError:
            pass
    return removed


def safe_name(name: str, fallback: str = "untitled") -> str:
    """Make a string safe to use as a file name on Windows and other systems."""
    bad = '<>:"/\\|?*\x00'
    cleaned = "".join("_" if c in bad or ord(c) < 32 else c for c in name).strip(" .")
    return cleaned[:120] or fallback


def enforce_cache_limit(max_mb: int) -> int:
    """Delete the oldest files in the proxy and preview caches until they fit in max_mb. Returns bytes freed."""
    limit = max(16, int(max_mb)) * 1024 * 1024
    files: list[tuple[float, int, Path]] = []
    for name in ("proxies", "tmp"):
        for f in subdir(name).rglob("*"):
            if f.is_file():
                st = f.stat()
                files.append((st.st_mtime, st.st_size, f))
    total = sum(s for _, s, _ in files)
    freed = 0
    for _, size, f in sorted(files):
        if total <= limit:
            break
        try:
            f.unlink()
            total -= size
            freed += size
        except OSError:
            pass
    return freed
