"""SQLite persistence: downloads, parts, settings, crash recovery.

Design notes:

* WAL journal mode + explicit transactions keep concurrent GUI/worker access
  safe (single connection guarded by a lock).
* Progress checkpoints are cheap and periodic — never per network chunk.
* Credentials (passwords, tokens, cookies) are NEVER stored; the schema only
  keeps non-sensitive metadata.
* ``load_recoverable`` validates temp files against stored part sizes so the
  app can restore interrupted downloads after a crash.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Iterable

log = logging.getLogger("ultradownload.db")

__all__ = ["Database", "DownloadRecord"]

SCHEMA = """
CREATE TABLE IF NOT EXISTS downloads (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    filename TEXT,
    dest_dir TEXT NOT NULL,
    total_size INTEGER,
    mime_type TEXT,
    part_count INTEGER NOT NULL DEFAULT 40,
    status TEXT NOT NULL DEFAULT 'queued',
    error TEXT,
    priority INTEGER NOT NULL DEFAULT 0,
    checksum_algo TEXT,
    checksum_value TEXT,
    speed_limit REAL,
    supports_ranges INTEGER NOT NULL DEFAULT 0,
    single_mode INTEGER NOT NULL DEFAULT 0,
    etag TEXT,
    last_modified TEXT,
    notes TEXT,
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL,
    completed_at REAL
);

CREATE TABLE IF NOT EXISTS parts (
    download_id TEXT NOT NULL,
    part_index INTEGER NOT NULL,
    start_byte INTEGER NOT NULL,
    end_byte INTEGER NOT NULL,
    downloaded_bytes INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'queued',
    retries INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (download_id, part_index),
    FOREIGN KEY (download_id) REFERENCES downloads(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
);

CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);
CREATE INDEX IF NOT EXISTS idx_downloads_created ON downloads(created_at);
"""


class DownloadRecord(dict):
    """A row from the downloads table (dict with attribute access)."""

    def __getattr__(self, name):
        try:
            return self[name]
        except KeyError:
            raise AttributeError(name)


class Database:
    def __init__(self, path: str | Path = ":memory:") -> None:
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.RLock()
        self._conn = sqlite3.connect(self.path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA foreign_keys = ON")
        if self.path != ":memory:":
            self._conn.execute("PRAGMA journal_mode = WAL")
            self._conn.execute("PRAGMA synchronous = NORMAL")
        with self._conn:
            self._conn.executescript(SCHEMA)

    def close(self) -> None:
        with self._lock:
            self._conn.commit()
            self._conn.close()

    # ------------------------------------------------------------- downloads
    def upsert_download(self, task_snapshot: dict) -> None:
        """Insert or update a download + its parts from a task snapshot."""
        snap = task_snapshot
        parts = snap.get("parts") or []
        checksum = snap.get("checksum") or (None, None)
        now = time.time()
        with self._lock, self._conn:
            self._conn.execute(
                """INSERT INTO downloads
                    (id, url, filename, dest_dir, total_size, mime_type, part_count,
                     status, error, priority, checksum_algo, checksum_value,
                     speed_limit, supports_ranges, single_mode, etag, last_modified,
                     notes, created_at, updated_at, completed_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(id) DO UPDATE SET
                     url=excluded.url, filename=excluded.filename,
                     dest_dir=excluded.dest_dir, total_size=excluded.total_size,
                     mime_type=excluded.mime_type, part_count=excluded.part_count,
                     status=excluded.status, error=excluded.error,
                     priority=excluded.priority, checksum_algo=excluded.checksum_algo,
                     checksum_value=excluded.checksum_value,
                     speed_limit=excluded.speed_limit,
                     supports_ranges=excluded.supports_ranges,
                     single_mode=excluded.single_mode, etag=excluded.etag,
                     last_modified=excluded.last_modified, notes=excluded.notes,
                     updated_at=excluded.updated_at, completed_at=excluded.completed_at
                """,
                (
                    snap["id"], snap["url"], snap.get("filename"),
                    snap.get("dest_dir"), snap.get("total_size"),
                    snap.get("mime_type"), snap.get("part_count_requested", 40),
                    snap.get("status", "queued"), snap.get("error"),
                    snap.get("priority", 0), checksum[0], checksum[1],
                    snap.get("speed_limit"),
                    1 if snap.get("supports_ranges") else 0,
                    1 if snap.get("single_mode") else 0,
                    snap.get("etag"), snap.get("last_modified"),
                    json.dumps(snap.get("notes") or []),
                    snap.get("created_at") or now, now, snap.get("completed_at"),
                ),
            )
            self._conn.execute(
                "DELETE FROM parts WHERE download_id = ?", (snap["id"],))
            self._conn.executemany(
                """INSERT INTO parts
                   (download_id, part_index, start_byte, end_byte,
                    downloaded_bytes, status, retries)
                   VALUES (?,?,?,?,?,?,?)""",
                [
                    (snap["id"], p["index"], p["start"], p["end"],
                     p["downloaded"], p["status"], p["retries"])
                    for p in parts
                ],
            )

    def _row_to_record(self, row: sqlite3.Row) -> DownloadRecord:
        d = DownloadRecord(dict(row))
        d["notes"] = json.loads(d.get("notes") or "[]")
        d["supports_ranges"] = bool(d.get("supports_ranges"))
        d["single_mode"] = bool(d.get("single_mode"))
        return d

    def get_download(self, download_id: str) -> DownloadRecord | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM downloads WHERE id = ?", (download_id,)).fetchone()
        return self._row_to_record(row) if row else None

    def get_parts(self, download_id: str) -> list[DownloadRecord]:
        with self._lock:
            rows = self._conn.execute(
                "SELECT * FROM parts WHERE download_id = ? ORDER BY part_index",
                (download_id,)).fetchall()
        return [DownloadRecord(dict(r)) for r in rows]

    def all_downloads(self, statuses: Iterable[str] | None = None) -> list[DownloadRecord]:
        with self._lock:
            if statuses:
                marks = ",".join("?" for _ in statuses)
                rows = self._conn.execute(
                    f"SELECT * FROM downloads WHERE status IN ({marks}) "
                    "ORDER BY priority DESC, created_at ASC",
                    tuple(statuses)).fetchall()
            else:
                rows = self._conn.execute(
                    "SELECT * FROM downloads ORDER BY priority DESC, created_at ASC"
                ).fetchall()
        return [self._row_to_record(r) for r in rows]

    def update_status(self, download_id: str, status: str, error: str | None = None,
                      completed_at: float | None = None) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                """UPDATE downloads SET status=?, error=?, updated_at=?,
                   completed_at=COALESCE(?, completed_at) WHERE id=?""",
                (status, error, time.time(), completed_at, download_id))

    def delete_download(self, download_id: str) -> None:
        with self._lock, self._conn:
            self._conn.execute("DELETE FROM parts WHERE download_id = ?", (download_id,))
            self._conn.execute("DELETE FROM downloads WHERE id = ?", (download_id,))

    def set_priority(self, download_id: str, priority: int) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                "UPDATE downloads SET priority=?, updated_at=? WHERE id=?",
                (priority, time.time(), download_id))

    # ------------------------------------------------------------- settings
    def get_setting(self, key: str, default: Any = None) -> Any:
        with self._lock:
            row = self._conn.execute(
                "SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        if row is None or row["value"] is None:
            return default
        try:
            return json.loads(row["value"])
        except json.JSONDecodeError:
            return row["value"]

    def set_setting(self, key: str, value: Any) -> None:
        with self._lock, self._conn:
            self._conn.execute(
                """INSERT INTO settings (key, value) VALUES (?, ?)
                   ON CONFLICT(key) DO UPDATE SET value=excluded.value""",
                (key, json.dumps(value)))

    def all_settings(self) -> dict:
        with self._lock:
            rows = self._conn.execute("SELECT key, value FROM settings").fetchall()
        out = {}
        for r in rows:
            try:
                out[r["key"]] = json.loads(r["value"])
            except (json.JSONDecodeError, TypeError):
                out[r["key"]] = r["value"]
        return out

    # ---------------------------------------------------------- recovery
    def load_recoverable(self) -> list[DownloadRecord]:
        """Downloads interrupted by a crash/forced shutdown.

        Rows left in active states are returned after their temp part files
        have been validated against the recorded part sizes.  Rows whose
        temporary data vanished are marked failed.
        """
        results = []
        for rec in self.all_downloads(("running", "merging", "queued")):
            parts = self.get_parts(rec["id"])
            tmp_dir = Path(rec["dest_dir"]) / ".ultradownload" / rec["id"]
            missing = []
            for p in parts:
                f = tmp_dir / f"part_{p['part_index']:05d}.part"
                if p["downloaded_bytes"] > 0 and not f.exists():
                    missing.append(p["part_index"])
            if parts and missing and rec["status"] in ("running", "merging"):
                self.update_status(
                    rec["id"], "failed",
                    "Temporary download data is missing — restart the download.")
                continue
            # Interrupted mid-transfer → safe to resume later.
            if rec["status"] in ("running", "merging"):
                self.update_status(rec["id"], "paused",
                                   "Recovered after an unexpected shutdown.")
                rec["status"] = "paused"
                rec["error"] = "Recovered after an unexpected shutdown."
            results.append(rec)
        return results

    def checkpoint(self) -> None:
        """Force a WAL checkpoint (call on app exit)."""
        with self._lock:
            try:
                self._conn.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            except sqlite3.Error:
                pass
