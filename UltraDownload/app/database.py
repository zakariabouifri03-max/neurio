import json
import sqlite3
import threading
import time
from pathlib import Path

from .models import CHUNK_SIZE, chunk_count, chunk_range


class Database:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.conn = sqlite3.connect(path, check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        with self.conn:
            self.conn.execute("PRAGMA journal_mode=WAL")
            self.conn.execute("PRAGMA synchronous=FULL")
            self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS downloads (
              id TEXT PRIMARY KEY, info TEXT NOT NULL, destination TEXT NOT NULL,
              status TEXT NOT NULL, error TEXT NOT NULL DEFAULT '', checksum TEXT NOT NULL,
              actual_hash TEXT NOT NULL DEFAULT '', publish_hash TEXT NOT NULL DEFAULT '',
              chunk_size INTEGER NOT NULL, chunks INTEGER NOT NULL,
              downloaded INTEGER NOT NULL DEFAULT 0, priority INTEGER NOT NULL DEFAULT 0,
              bandwidth INTEGER NOT NULL DEFAULT 0, updated REAL NOT NULL);
            CREATE TABLE IF NOT EXISTS chunks (
              download_id TEXT NOT NULL, idx INTEGER NOT NULL, start INTEGER NOT NULL,
              end INTEGER NOT NULL, expected INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
              partial INTEGER NOT NULL DEFAULT 0, retries INTEGER NOT NULL DEFAULT 0,
              retry_at REAL NOT NULL DEFAULT 0, sha256 TEXT NOT NULL DEFAULT '',
              PRIMARY KEY(download_id, idx));
            CREATE INDEX IF NOT EXISTS pending_chunks ON chunks(download_id, status, retry_at, idx);
            """)

    def create(self, identifier, info, destination, checksum="", bandwidth=0):
        count = chunk_count(info.size) if info.ranges and info.size is not None else 0
        with self.lock, self.conn:
            self.conn.execute(
                """INSERT INTO downloads
                (id,info,destination,status,checksum,chunk_size,chunks,bandwidth,updated)
                VALUES (?,?,?,'queued',?,?,?,?,?)""",
                (
                    identifier,
                    json.dumps(info.public_dict()),
                    str(destination),
                    checksum,
                    CHUNK_SIZE,
                    count,
                    bandwidth,
                    time.time(),
                ),
            )

            def rows():
                for i in range(count):
                    start, end = chunk_range(i, info.size)
                    yield identifier, i, start, end, end - start + 1

            self.conn.executemany(
                "INSERT INTO chunks(download_id,idx,start,end,expected) VALUES (?,?,?,?,?)",
                rows(),
            )

    def get(self, identifier):
        with self.lock:
            row = self.conn.execute(
                "SELECT * FROM downloads WHERE id=?", (identifier,)
            ).fetchone()
        if not row:
            raise KeyError(identifier)
        return dict(row)

    def downloads(self):
        with self.lock:
            return [
                dict(r)
                for r in self.conn.execute(
                    "SELECT * FROM downloads ORDER BY priority DESC, rowid"
                )
            ]

    def update(self, identifier, **values):
        allowed = {
            "status",
            "error",
            "actual_hash",
            "publish_hash",
            "downloaded",
            "priority",
            "bandwidth",
            "info",
        }
        if not values.keys() <= allowed:
            raise ValueError("Invalid download field")
        values["updated"] = time.time()
        with self.lock, self.conn:
            self.conn.execute(
                f"UPDATE downloads SET {','.join(f'{key}=?' for key in values)} WHERE id=?",
                (*values.values(), identifier),
            )

    def chunk(self, identifier, index, **values):
        if not values.keys() <= {"status", "partial", "retries", "retry_at", "sha256"}:
            raise ValueError("Invalid chunk field")
        with self.lock, self.conn:
            self.conn.execute(
                f"UPDATE chunks SET {','.join(f'{key}=?' for key in values)} WHERE download_id=? AND idx=?",
                (*values.values(), identifier, index),
            )

    def rows(self, identifier, offset=0, limit=256):
        with self.lock:
            return [
                dict(r)
                for r in self.conn.execute(
                    "SELECT * FROM chunks WHERE download_id=? AND idx>=? ORDER BY idx LIMIT ?",
                    (identifier, offset, limit),
                )
            ]

    def iter_chunks(self, identifier):
        offset = 0
        while rows := self.rows(identifier, offset):
            yield from rows
            offset = rows[-1]["idx"] + 1

    def next_pending(self, identifier, limit):
        with self.lock:
            return [
                dict(r)
                for r in self.conn.execute(
                    """SELECT * FROM chunks
                WHERE download_id=? AND status='pending' AND retry_at<=? ORDER BY idx LIMIT ?""",
                    (identifier, time.time(), limit),
                )
            ]

    def counts(self, identifier):
        with self.lock:
            rows = self.conn.execute(
                "SELECT status,COUNT(*) AS n,SUM(partial) AS bytes FROM chunks WHERE download_id=? GROUP BY status",
                (identifier,),
            ).fetchall()
        return {r["status"]: (r["n"], r["bytes"] or 0) for r in rows}

    def reset_failed(self, identifier):
        with self.lock, self.conn:
            self.conn.execute(
                "UPDATE chunks SET status='pending', retries=0, retry_at=0 WHERE download_id=? AND status='failed'",
                (identifier,),
            )

    def interrupted(self):
        with self.lock, self.conn:
            self.conn.execute(
                "UPDATE chunks SET status='pending' WHERE status='active'"
            )
            self.conn.execute(
                "UPDATE downloads SET status='paused', error='Interrupted session; resume to verify saved data' WHERE status IN ('queued','inspecting','recovering','downloading','assembling','publishing','pausing')"
            )

    def close(self):
        with self.lock:
            self.conn.close()
