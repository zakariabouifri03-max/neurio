"""SQLite persistence: download queue, part progress and settings.

Design notes
------------
* One connection guarded by a re-entrant lock (workers + GUI thread).
* WAL journaling + ``synchronous=NORMAL`` + periodic checkpointing so a
  crash loses at most the last progress writes, never the schema.
* **No secrets are stored**: request headers (Authorization, Cookie…)
  live in memory only; the database keeps a ``requires_auth`` flag so
  the UI can tell the user that credentials must be re-entered after a
  restart.
* Byte offsets are stored as 64-bit INTEGERs (SQLite integers are
  signed 64-bit; larger sizes are impossible in practice).
"""

from __future__ import annotations

import os
import sqlite3
import threading
import time
from typing import Dict, List, Optional

from .models import (DownloadStatus, DownloadTask, PartState, PartStatus,
                     RangeSupport)

SCHEMA_VERSION = 1

_SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS downloads (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    url             TEXT NOT NULL,
    final_url       TEXT NOT NULL DEFAULT '',
    filename        TEXT NOT NULL,
    dest_dir        TEXT NOT NULL,
    total_size      INTEGER NOT NULL DEFAULT -1,
    part_count      INTEGER NOT NULL DEFAULT 40,
    status          TEXT NOT NULL DEFAULT 'queued',
    priority        INTEGER NOT NULL DEFAULT 0,
    speed_limit     INTEGER NOT NULL DEFAULT 0,
    checksum_algo   TEXT NOT NULL DEFAULT '',
    checksum_value  TEXT NOT NULL DEFAULT '',
    error           TEXT NOT NULL DEFAULT '',
    etag            TEXT NOT NULL DEFAULT '',
    last_modified   TEXT NOT NULL DEFAULT '',
    content_type    TEXT NOT NULL DEFAULT '',
    range_support   TEXT NOT NULL DEFAULT 'unknown',
    requires_auth   INTEGER NOT NULL DEFAULT 0,
    allow_overwrite INTEGER NOT NULL DEFAULT 0,
    downloaded      INTEGER NOT NULL DEFAULT 0,
    retries         INTEGER NOT NULL DEFAULT 0,
    created_at      REAL NOT NULL,
    updated_at      REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS parts (
    download_id INTEGER NOT NULL REFERENCES downloads(id) ON DELETE CASCADE,
    idx         INTEGER NOT NULL,
    start       INTEGER NOT NULL,
    end         INTEGER NOT NULL,
    downloaded  INTEGER NOT NULL DEFAULT 0,
    status      TEXT NOT NULL DEFAULT 'pending',
    error       TEXT NOT NULL DEFAULT '',
    retries     INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (download_id, idx)
);
CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_parts_download ON parts(download_id);
CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);
"""

_TASK_COLUMNS = (
    "url", "final_url", "filename", "dest_dir", "total_size", "part_count",
    "status", "priority", "speed_limit", "checksum_algo", "checksum_value",
    "error", "etag", "last_modified", "content_type", "range_support",
    "requires_auth", "allow_overwrite", "downloaded", "created_at",
    "updated_at",
)


class Database:
    """Thread-safe SQLite store for tasks, parts and settings."""

    def __init__(self, path: str) -> None:
        self.path = path
        parent = os.path.dirname(os.path.abspath(path))
        if parent:
            os.makedirs(parent, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(path, check_same_thread=False,
                                     timeout=15.0)
        self._conn.row_factory = sqlite3.Row
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL")
            self._conn.execute("PRAGMA synchronous=NORMAL")
            self._conn.execute("PRAGMA foreign_keys=ON")
            self._conn.executescript(_SCHEMA)
            self._migrate()
            self._conn.execute(
                "INSERT OR REPLACE INTO meta(key, value) VALUES('schema', ?)",
                (str(SCHEMA_VERSION),))
            self._conn.commit()

    def _migrate(self) -> None:
        """Add columns that may be missing in older databases."""
        cols = {row[1] for row in
                self._conn.execute("PRAGMA table_info(downloads)")}
        if "allow_overwrite" not in cols:
            self._conn.execute("ALTER TABLE downloads ADD COLUMN "
                               "allow_overwrite INTEGER NOT NULL DEFAULT 0")

    # ------------------------------------------------------------------ tasks

    def save_task(self, task: DownloadTask) -> int:
        """Insert or update a task; returns its id."""
        with self._lock:
            values = [
                task.url, task.final_url or task.url, task.filename,
                task.dest_dir, task.total_size, task.part_count,
                task.status.value, task.priority, task.speed_limit,
                task.checksum_algo, task.checksum_value, task.error,
                task.etag, task.last_modified, task.content_type,
                task.range_support.value, int(task.requires_auth),
                int(task.allow_overwrite),
                task.downloaded_bytes, task.created_at, task.updated_at,
            ]
            if task.id is None:
                cur = self._conn.execute(
                    f"INSERT INTO downloads ({','.join(_TASK_COLUMNS)}) "
                    f"VALUES ({','.join('?' * len(_TASK_COLUMNS))})", values)
                task.id = int(cur.lastrowid)
            else:
                sets = ",".join(f"{c}=?" for c in _TASK_COLUMNS)
                self._conn.execute(
                    f"UPDATE downloads SET {sets} WHERE id=?",
                    values + [task.id])
            self._conn.commit()
            return task.id

    def save_parts(self, task_id: int, parts: List[PartState]) -> None:
        with self._lock:
            self._conn.executemany(
                """INSERT INTO parts(download_id, idx, start, end, downloaded,
                                     status, error, retries)
                   VALUES (?,?,?,?,?,?,?,?)
                   ON CONFLICT(download_id, idx) DO UPDATE SET
                     start=excluded.start, end=excluded.end,
                     downloaded=excluded.downloaded, status=excluded.status,
                     error=excluded.error, retries=excluded.retries""",
                [(task_id, p.index, p.start, p.end, p.downloaded,
                  p.status.value, p.error, p.retries) for p in parts])
            self._conn.commit()

    def update_part_progress(self, task_id: int, parts: List[PartState]) -> None:
        """Fast path used by the periodic persistence tick."""
        with self._lock:
            self._conn.executemany(
                "UPDATE parts SET downloaded=?, status=?, error=?, retries=? "
                "WHERE download_id=? AND idx=?",
                [(p.downloaded, p.status.value, p.error, p.retries,
                  task_id, p.index) for p in parts])
            self._conn.commit()

    def update_task_runtime(self, task_id: int, status: DownloadStatus,
                            error: str = "", downloaded: int = 0) -> None:
        with self._lock:
            self._conn.execute(
                "UPDATE downloads SET status=?, error=?, downloaded=?, "
                "updated_at=? WHERE id=?",
                (status.value, error, downloaded, time.time(), task_id))
            self._conn.commit()

    def delete_task(self, task_id: int) -> None:
        with self._lock:
            self._conn.execute("DELETE FROM parts WHERE download_id=?",
                               (task_id,))
            self._conn.execute("DELETE FROM downloads WHERE id=?", (task_id,))
            self._conn.commit()

    def load_tasks(self) -> List[DownloadTask]:
        """All tasks with their parts, newest first."""
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM downloads ORDER BY created_at DESC").fetchall()
            part_rows = self._conn.execute(
                "SELECT * FROM parts ORDER BY download_id, idx").fetchall()
        parts_by_task: Dict[int, List[PartState]] = {}
        for pr in part_rows:
            parts_by_task.setdefault(pr["download_id"], []).append(PartState(
                index=pr["idx"], start=pr["start"], end=pr["end"],
                downloaded=pr["downloaded"],
                status=PartStatus(pr["status"]),
                error=pr["error"], retries=pr["retries"]))
        tasks = []
        for r in rows:
            task = DownloadTask(
                id=r["id"], url=r["url"], filename=r["filename"],
                dest_dir=r["dest_dir"], total_size=r["total_size"],
                part_count=r["part_count"],
                status=DownloadStatus(r["status"]),
                priority=r["priority"], speed_limit=r["speed_limit"],
                checksum_algo=r["checksum_algo"],
                checksum_value=r["checksum_value"], error=r["error"],
                etag=r["etag"], last_modified=r["last_modified"],
                content_type=r["content_type"],
                range_support=RangeSupport(r["range_support"]),
                final_url=r["final_url"],
                requires_auth=bool(r["requires_auth"]),
                allow_overwrite=bool(r["allow_overwrite"]),
                created_at=r["created_at"], updated_at=r["updated_at"])
            task.parts = parts_by_task.get(task.id, [])
            tasks.append(task)
        return tasks

    def get_task(self, task_id: int) -> Optional[DownloadTask]:
        for t in self.load_tasks():
            if t.id == task_id:
                return t
        return None

    # --------------------------------------------------------------- settings

    def get_settings(self) -> Dict[str, str]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT key, value FROM settings").fetchall()
        return {r["key"]: r["value"] for r in rows}

    def save_setting(self, key: str, value) -> None:
        with self._lock:
            self._conn.execute(
                "INSERT INTO settings(key, value) VALUES(?, ?) "
                "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                (key, str(value)))
            self._conn.commit()

    def save_settings(self, mapping: Dict[str, object]) -> None:
        with self._lock:
            for k, v in mapping.items():
                self._conn.execute(
                    "INSERT INTO settings(key, value) VALUES(?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    (k, str(v)))
            self._conn.commit()

    # ------------------------------------------------------------ maintenance

    def checkpoint(self) -> None:
        """Force a WAL checkpoint (called periodically by the manager)."""
        with self._lock:
            try:
                self._conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            except sqlite3.Error:  # pragma: no cover
                pass

    def integrity_check(self) -> bool:
        with self._lock:
            row = self._conn.execute("PRAGMA quick_check").fetchone()
        return bool(row and row[0] == "ok")

    def close(self) -> None:
        with self._lock:
            try:
                self._conn.commit()
                self._conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            except sqlite3.Error:
                pass
            self._conn.close()
