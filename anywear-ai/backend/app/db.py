"""SQLite persistence (stdlib only, no ORM dependency)."""

from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS history (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL,
    category TEXT,
    person_file_id TEXT,
    garment_file_id TEXT,
    garment_url TEXT,
    result_file_id TEXT,
    provider TEXT,
    mode TEXT,
    meta TEXT
);
CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    status TEXT NOT NULL,
    category TEXT,
    person_file_id TEXT,
    garment_file_id TEXT,
    garment_url TEXT,
    result_file_id TEXT,
    provider TEXT,
    mode TEXT,
    error TEXT,
    meta TEXT
);
"""


class Database:
    def __init__(self, path: Path):
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(str(path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    def execute(self, sql: str, params: tuple = ()) -> sqlite3.Cursor:
        with self._lock:
            cur = self._conn.execute(sql, params)
            self._conn.commit()
            return cur

    def query(self, sql: str, params: tuple = ()) -> list[sqlite3.Row]:
        with self._lock:
            return self._conn.execute(sql, params).fetchall()

    def query_one(self, sql: str, params: tuple = ()) -> sqlite3.Row | None:
        with self._lock:
            return self._conn.execute(sql, params).fetchone()

    def close(self) -> None:
        with self._lock:
            self._conn.close()


_db: Database | None = None


def init_db(path: Path) -> Database:
    global _db
    _db = Database(path)
    return _db


def get_db() -> Database:
    if _db is None:
        raise RuntimeError("database not initialized")
    return _db
