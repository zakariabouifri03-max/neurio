"""SQLite cache for probed metadata and generated asset paths."""
from __future__ import annotations

import json
import sqlite3
import threading
from pathlib import Path
from typing import Optional

from ..core import paths
from ..core.logging_setup import get_logger

log = get_logger("media-cache")
_LOCK = threading.RLock()


def _connect() -> sqlite3.Connection:
    paths.ensure_dirs()
    conn = sqlite3.connect(str(paths.DB_PATH), timeout=15, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _LOCK, _connect() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS media_meta (
                path TEXT PRIMARY KEY,
                mtime REAL NOT NULL,
                size INTEGER NOT NULL,
                file_hash TEXT,
                metadata TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS generated_assets (
                source_hash TEXT NOT NULL,
                kind TEXT NOT NULL,
                path TEXT NOT NULL,
                params TEXT DEFAULT '',
                PRIMARY KEY (source_hash, kind, params)
            );
            """
        )


def get_cached_metadata(path: str) -> Optional[dict]:
    init_db()
    p = Path(path)
    try:
        st = p.stat()
    except OSError:
        return None
    with _LOCK, _connect() as conn:
        row = conn.execute(
            "SELECT metadata, mtime, size FROM media_meta WHERE path=?",
            (str(p),),
        ).fetchone()
    if row and row["mtime"] == st.st_mtime and row["size"] == st.st_size:
        try:
            return json.loads(row["metadata"])
        except json.JSONDecodeError:
            return None
    return None


def store_metadata(path: str, file_hash: str, metadata: dict) -> None:
    init_db()
    p = Path(path)
    try:
        st = p.stat()
    except OSError:
        return
    with _LOCK, _connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO media_meta(path, mtime, size, file_hash, metadata)"
            " VALUES (?,?,?,?,?)",
            (str(p), st.st_mtime, st.st_size, file_hash, json.dumps(metadata)),
        )


def get_asset(source_hash: str, kind: str, params: str = "") -> Optional[str]:
    init_db()
    with _LOCK, _connect() as conn:
        row = conn.execute(
            "SELECT path FROM generated_assets WHERE source_hash=? AND kind=? AND params=?",
            (source_hash, kind, params),
        ).fetchone()
    if row and Path(row["path"]).exists():
        return row["path"]
    return None


def store_asset(source_hash: str, kind: str, out_path: str, params: str = "") -> None:
    init_db()
    with _LOCK, _connect() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO generated_assets(source_hash, kind, path, params)"
            " VALUES (?,?,?,?)",
            (source_hash, kind, str(out_path), params),
        )
