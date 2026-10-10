"""SQLite-backed application settings with typed accessors.

Settings are stored as JSON-encoded values so arbitrary structured data can be
persisted.  A small schema-version marker lets us migrate in future releases.
"""

from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Any

from . import paths

SCHEMA_VERSION = 1

_DEFAULTS: dict[str, Any] = {
    "ui/theme": "dark",
    "ui/language": "en",
    "ui/low_memory_mode": False,
    "preview/resolution": "half",      # full | half | quarter
    "preview/fps": 24,
    "render/threads": 0,               # 0 = auto
    "render/hw_accel": "auto",
    "cache/max_mb": 2048,
    "ffmpeg/path": "",
    "ai/provider": "",
}


class Settings:
    """Thread-safe key/value store persisted in SQLite."""

    def __init__(self, db_path: Path | None = None):
        self._path = db_path or (paths.app_data_dir() / "settings.sqlite3")
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(self._path, check_same_thread=False)
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)"
        )
        self._conn.execute(
            "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)"
        )
        self._conn.execute(
            "INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?)",
            (str(SCHEMA_VERSION),),
        )
        self._conn.commit()

    # -- basic accessors -------------------------------------------------
    def get(self, key: str, default: Any = None) -> Any:
        with self._lock:
            row = self._conn.execute(
                "SELECT value FROM settings WHERE key=?", (key,)
            ).fetchone()
        if row is None:
            return _DEFAULTS.get(key, default)
        try:
            return json.loads(row[0])
        except json.JSONDecodeError:
            return _DEFAULTS.get(key, default)

    def set(self, key: str, value: Any) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO settings (key, value) VALUES (?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, json.dumps(value)),
            )
            self._conn.commit()

    def delete(self, key: str) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM settings WHERE key=?", (key,))
            self._conn.commit()

    def all(self) -> dict[str, Any]:
        with self._lock:
            rows = self._conn.execute("SELECT key, value FROM settings").fetchall()
        out: dict[str, Any] = {}
        for k, v in rows:
            try:
                out[k] = json.loads(v)
            except json.JSONDecodeError:
                out[k] = v
        return out

    def defaults(self) -> dict[str, Any]:
        return dict(_DEFAULTS)

    def close(self) -> None:
        with self._lock:
            self._conn.close()
