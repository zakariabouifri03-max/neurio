"""Per-part state tracked by the download engine."""

from __future__ import annotations

import threading
from dataclasses import dataclass, field
from enum import Enum

from .ranges import ByteRange
from .speed import SpeedMeter

__all__ = ["PartStatus", "PartState"]


class PartStatus(str, Enum):
    QUEUED = "queued"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    PAUSED = "paused"
    CANCELLED = "cancelled"

    @property
    def label(self) -> str:
        return {
            PartStatus.QUEUED: "Queued",
            PartStatus.RUNNING: "Downloading",
            PartStatus.DONE: "Complete",
            PartStatus.FAILED: "Failed",
            PartStatus.PAUSED: "Paused",
            PartStatus.CANCELLED: "Cancelled",
        }[self]


@dataclass
class PartState:
    """Mutable state of one parallel part (thread-safe via ``lock``)."""

    range: ByteRange
    downloaded: int = 0
    status: PartStatus = PartStatus.QUEUED
    retries: int = 0
    error: str | None = None
    meter: SpeedMeter = field(default_factory=SpeedMeter)
    lock: threading.Lock = field(default_factory=threading.Lock)

    # -- convenience proxies -------------------------------------------------
    @property
    def index(self) -> int:
        return self.range.index

    @property
    def start(self) -> int:
        return self.range.start

    @property
    def end(self) -> int:
        return self.range.end

    @property
    def length(self) -> int:
        return self.range.length

    @property
    def remaining(self) -> int:
        return max(0, self.length - self.downloaded)

    def progress(self) -> float:
        """Completion of this part in percent (0..100)."""
        if self.length <= 0:
            return 100.0
        return min(100.0, self.downloaded * 100.0 / self.length)

    def speed(self) -> float:
        return self.meter.speed() if self.status is PartStatus.RUNNING else 0.0

    def snapshot(self) -> dict:
        with self.lock:
            return {
                "index": self.index,
                "start": self.start,
                "end": self.end,
                "length": self.length,
                "downloaded": self.downloaded,
                "status": self.status.value,
                "retries": self.retries,
                "error": self.error,
                "speed": self.speed(),
            }
