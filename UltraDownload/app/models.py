from dataclasses import dataclass, asdict
import math

CHUNK_SIZE = 1_048_576
MAX_CONCURRENT_CHUNKS = 10


def chunk_count(size: int) -> int:
    if size < 0:
        raise ValueError("File size cannot be negative")
    return (size + CHUNK_SIZE - 1) // CHUNK_SIZE


def chunk_range(size: int, index: int) -> tuple[int, int]:
    if index < 0 or index >= chunk_count(size):
        raise ValueError("Chunk index outside file")
    start = index * CHUNK_SIZE
    return start, min(start + CHUNK_SIZE - 1, size - 1)


@dataclass
class Remote:
    url: str
    filename: str
    size: int | None
    ranges: bool
    etag: str = ""
    modified: str = ""
    reason: str = ""

    @property
    def validator(self):
        return self.etag if self.etag and not self.etag.startswith("W/") else self.modified


@dataclass
class Download:
    id: str
    filename: str
    destination: str
    size: int | None
    ranges: bool
    etag: str = ""
    modified: str = ""
    expected_sha256: str = ""
    status: str = "queued"
    error: str = ""
    sha256: str = ""
    priority: int = 0
    bandwidth: int = 0
    updated: float = 0

    @property
    def count(self):
        return chunk_count(self.size) if self.ranges and self.size is not None else (0 if self.size == 0 else 1)

    def as_dict(self):
        return asdict(self)
