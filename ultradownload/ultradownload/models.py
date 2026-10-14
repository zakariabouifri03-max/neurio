"""Core data models shared by the engine, database and GUI.

These models are intentionally Qt-free so the download engine can be
exercised by automated tests without a GUI event loop.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Dict, Optional


class DownloadStatus(str, Enum):
    QUEUED = "queued"
    ACTIVE = "active"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"

    @property
    def is_finished(self) -> bool:
        return self in (
            DownloadStatus.COMPLETED,
            DownloadStatus.FAILED,
            DownloadStatus.CANCELLED,
        )


class PartStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    FAILED = "failed"


class RangeSupport(str, Enum):
    UNKNOWN = "unknown"
    YES = "yes"
    NO = "no"


@dataclass
class PartState:
    """Runtime + persisted state of one byte-range worker."""

    index: int
    start: int           # inclusive first byte of the range
    end: int             # inclusive last byte of the range
    downloaded: int = 0  # bytes of this range already on disk
    status: PartStatus = PartStatus.PENDING
    error: str = ""
    retries: int = 0
    # runtime-only fields (never persisted)
    speed: float = 0.0

    @property
    def size(self) -> int:
        return self.end - self.start + 1

    @property
    def remaining(self) -> int:
        return max(0, self.size - self.downloaded)

    @property
    def progress(self) -> float:
        if self.size <= 0:
            return 100.0
        return min(100.0, self.downloaded * 100.0 / self.size)

    def to_dict(self) -> dict:
        return {
            "index": self.index,
            "start": self.start,
            "end": self.end,
            "downloaded": self.downloaded,
            "status": self.status.value,
            "error": self.error,
            "retries": self.retries,
            "speed": self.speed,
            "size": self.size,
            "progress": self.progress,
        }


@dataclass
class DownloadTask:
    """Everything the engine and database need to know about one file."""

    url: str
    filename: str
    dest_dir: str
    total_size: int = -1            # -1 => unknown
    part_count: int = 40
    status: DownloadStatus = DownloadStatus.QUEUED
    id: Optional[int] = None
    priority: int = 0               # higher runs first
    speed_limit: int = 0            # bytes/sec for this download, 0 => unlimited
    checksum_algo: str = ""         # "", "md5", "sha1", "sha256"
    checksum_value: str = ""
    error: str = ""
    etag: str = ""
    last_modified: str = ""
    content_type: str = ""
    range_support: RangeSupport = RangeSupport.UNKNOWN
    final_url: str = ""             # after redirects
    requires_auth: bool = False
    allow_overwrite: bool = False
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)
    # Sensitive request headers live in memory only; they are never written
    # to the database in plain text (see db.py).
    headers: Dict[str, str] = field(default_factory=dict, repr=False)
    parts: list = field(default_factory=list)

    # ----- derived helpers -------------------------------------------------
    @property
    def temp_path(self) -> str:
        import os
        return os.path.join(self.dest_dir, self.filename + ".udpart")

    @property
    def final_path(self) -> str:
        import os
        return os.path.join(self.dest_dir, self.filename)

    @property
    def downloaded_bytes(self) -> int:
        return sum(p.downloaded for p in self.parts)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "url": self.url,
            "filename": self.filename,
            "dest_dir": self.dest_dir,
            "total_size": self.total_size,
            "part_count": self.part_count,
            "status": self.status.value,
            "priority": self.priority,
            "speed_limit": self.speed_limit,
            "checksum_algo": self.checksum_algo,
            "checksum_value": self.checksum_value,
            "error": self.error,
            "etag": self.etag,
            "last_modified": self.last_modified,
            "content_type": self.content_type,
            "range_support": self.range_support.value,
            "final_url": self.final_url,
            "requires_auth": self.requires_auth,
            "allow_overwrite": self.allow_overwrite,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "downloaded": self.downloaded_bytes,
        }


@dataclass
class ProbeResult:
    """Outcome of inspecting a URL before downloading (Step A)."""

    ok: bool
    url: str
    final_url: str = ""
    status_code: int = 0
    filename: str = ""
    total_size: int = -1
    content_type: str = ""
    range_support: RangeSupport = RangeSupport.UNKNOWN
    etag: str = ""
    last_modified: str = ""
    error: str = ""
    error_kind: str = ""            # machine readable: dns/timeout/http404/...
    redirect_count: int = 0
