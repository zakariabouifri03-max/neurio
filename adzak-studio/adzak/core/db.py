"""SQLite storage for recent projects and application settings (no secrets)."""
from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path
from typing import Any, Optional

DEFAULT_SETTINGS: dict[str, Any] = {
    "language": "en",
    "theme": "dark",
    "low_memory": False,
    "preview_height": 360,
    "render_threads": 0,            # 0 = automatic
    "hardware_accel": False,
    "cache_limit_mb": 512,
    "autosave_minutes": 2,
    "use_proxies": False,
    "brand_kit": {"colors": ["#FF3B30", "#FFCC00", "#1C1C1E", "#FFFFFF"], "font": "Arial"},
    "ai_provider": {"kind": "none", "base_url": "https://api.openai.com/v1", "model": "gpt-4o-mini"},
}

SCHEMA = """
CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    file_path TEXT NOT NULL UNIQUE,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


class ProjectDB:
    def __init__(self, path: Path | str):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(self.path))
        self.conn.row_factory = sqlite3.Row
        self.conn.executescript(SCHEMA)
        self.conn.commit()

    def close(self) -> None:
        self.conn.close()

    # --- projects -------------------------------------------------------
    def upsert_project(self, name: str, kind: str, file_path: str) -> int:
        now = time.time()
        self.conn.execute(
            """INSERT INTO projects(name, kind, file_path, created_at, updated_at)
               VALUES(?,?,?,?,?)
               ON CONFLICT(file_path) DO UPDATE SET name=excluded.name, updated_at=excluded.updated_at""",
            (name, kind, str(file_path), now, now),
        )
        self.conn.commit()
        row = self.conn.execute("SELECT id FROM projects WHERE file_path=?", (str(file_path),)).fetchone()
        return int(row["id"])

    def recent_projects(self, limit: int = 20) -> list[dict]:
        rows = self.conn.execute(
            "SELECT * FROM projects ORDER BY updated_at DESC LIMIT ?", (limit,)
        ).fetchall()
        return [dict(r) for r in rows]

    def remove_project(self, project_id: int) -> None:
        self.conn.execute("DELETE FROM projects WHERE id=?", (project_id,))
        self.conn.commit()

    # --- settings -------------------------------------------------------
    def get_setting(self, key: str) -> Any:
        row = self.conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
        if row is None:
            return DEFAULT_SETTINGS.get(key)
        try:
            return json.loads(row["value"])
        except json.JSONDecodeError:
            return DEFAULT_SETTINGS.get(key)

    def set_setting(self, key: str, value: Any) -> None:
        if key not in DEFAULT_SETTINGS:
            raise KeyError(f"Unknown setting: {key}")
        self.conn.execute(
            "INSERT INTO settings(key, value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, json.dumps(value)),
        )
        self.conn.commit()

    def all_settings(self) -> dict[str, Any]:
        return {k: self.get_setting(k) for k in DEFAULT_SETTINGS}


def open_default_db(data_dir: Optional[Path] = None) -> ProjectDB:
    from .paths import app_data_dir

    return ProjectDB((data_dir or app_data_dir()) / "studio.sqlite3")
