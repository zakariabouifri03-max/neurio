"""Typed errors used by the UltraDownload engine.

The GUI and the queue manager map these to user-friendly messages.  Errors are
split into *transient* (safe to retry with backoff) and *permanent* (retrying
the same request cannot help).
"""

from __future__ import annotations


class DownloadError(Exception):
    """Base class for all engine errors."""

    transient = False


class InvalidURLError(DownloadError):
    """The URL is malformed or uses an unsupported scheme."""


class InspectError(DownloadError):
    """The remote server could not be inspected (HEAD/GET probe failed)."""

    transient = True


class TransientHTTPError(DownloadError):
    """Timeouts, connection resets, HTTP 408/429/5xx — worth retrying."""

    transient = True

    def __init__(self, message: str, status_code: int | None = None,
                 retry_after: float | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.retry_after = retry_after


class PermanentHTTPError(DownloadError):
    """HTTP 401/403/404/410 and other non-retryable responses."""

    transient = False

    def __init__(self, message: str, status_code: int | None = None) -> None:
        super().__init__(message)
        self.status_code = status_code


class ContentRangeError(DownloadError):
    """A 206 response carried a missing or incorrect Content-Range header."""

    transient = True


class RangeIgnoredError(DownloadError):
    """The server answered 200 OK to a Range request (ranges not supported)."""

    transient = False


class TruncatedResponseError(DownloadError):
    """The connection closed before the requested byte range was complete."""

    transient = True


class ChecksumMismatchError(DownloadError):
    """The assembled file does not match the trusted checksum."""

    transient = False


class InsufficientDiskSpaceError(DownloadError):
    """Not enough free space on the destination volume."""

    transient = False


class PermissionDeniedError(DownloadError):
    """The destination (or temp directory) is not writable."""

    transient = False


class FileExistsError_(DownloadError):
    """The destination file exists and the user has not allowed overwriting."""

    transient = False


class MergeError(DownloadError):
    """Reassembling parts into the final file failed (parts are preserved)."""

    transient = True


class StateError(DownloadError):
    """Resume requested but saved state no longer matches the remote file."""

    transient = False


class DownloadCancelled(DownloadError):
    """Raised inside workers when the task was cancelled."""

    transient = False


class DownloadPaused(DownloadError):
    """Raised inside workers when the task was paused (not a failure)."""

    transient = False
