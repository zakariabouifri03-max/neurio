from dataclasses import dataclass, asdict

CHUNK_SIZE = 1_048_576
MAX_CONCURRENT_CHUNKS = 10


def chunk_count(size: int) -> int:
    if size < 0:
        raise ValueError("File size cannot be negative")
    return (size + CHUNK_SIZE - 1) // CHUNK_SIZE


def chunk_range(index: int, size: int) -> tuple[int, int]:
    if not 0 <= index < chunk_count(size):
        raise IndexError("Chunk outside file")
    start = index * CHUNK_SIZE
    return start, min(start + CHUNK_SIZE, size) - 1


@dataclass(frozen=True)
class RemoteInfo:
    url: str
    resolved_url: str
    filename: str
    size: int | None
    ranges: bool
    etag: str = ""
    modified: str = ""
    reason: str = ""

    def public_dict(self):
        # Signed/query URLs are session-only, never persisted in clear text.
        from .file_utils import persistable_url

        data = asdict(self)
        data["url"] = persistable_url(self.url)
        data["resolved_url"] = persistable_url(self.resolved_url)
        return data


class DownloadError(Exception):
    pass


class Stopped(DownloadError):
    pass


class RemoteChanged(DownloadError):
    pass


class InvalidResponse(DownloadError):
    pass


class TransientError(DownloadError):
    def __init__(self, message, retry_after=0.0):
        super().__init__(message)
        self.retry_after = retry_after
