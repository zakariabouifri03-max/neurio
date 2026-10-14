"""General helpers: filename sanitization, size/time formatting, redaction."""

from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

__all__ = [
    "sanitize_filename",
    "filename_from_headers",
    "filename_from_url",
    "format_bytes",
    "format_speed",
    "format_eta",
    "redact_headers",
    "app_data_dir",
    "is_windows_reserved_name",
]

_WINDOWS_INVALID = re.compile(r'[<>:"/\\|?*\x00-\x1f]')
_WINDOWS_RESERVED = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}
_MAX_FILENAME_LEN = 240  # leave headroom for extension/path on Windows

_SENSITIVE_HEADERS = {"authorization", "cookie", "proxy-authorization", "x-api-key", "set-cookie"}


def is_windows_reserved_name(name: str) -> bool:
    return name.upper().split(".")[0] in _WINDOWS_RESERVED


def sanitize_filename(name: str, fallback: str = "download.bin") -> str:
    """Return a safe, portable filename (no traversal, no reserved names)."""
    if not name:
        return fallback

    # Drop any directory components a hostile server may have sent.
    name = name.replace("\\", "/").split("/")[-1]
    name = unquote(name)
    name = _WINDOWS_INVALID.sub("_", name)
    # Leading dots hide files on POSIX and trailing dots/spaces break Windows.
    name = name.strip(" ").lstrip(".")
    while name.endswith(".") or name.endswith(" "):
        name = name[:-1]
    name = name.strip(" ")

    if not name or name in {".", ".."}:
        return fallback
    stem, dot, ext = name.partition(".")
    if is_windows_reserved_name(stem):
        name = "_" + name
    if len(name) > _MAX_FILENAME_LEN:
        if dot and len(ext) < 16:
            name = name[: _MAX_FILENAME_LEN - len(ext) - 1] + "." + ext
        else:
            name = name[:_MAX_FILENAME_LEN]
    return name or fallback


def filename_from_headers(content_disposition: str | None) -> str | None:
    """Extract a filename from a Content-Disposition header (RFC 5987 aware)."""
    if not content_disposition:
        return None
    # filename*=charset'lang'percent-encoded-value  (preferred)
    m = re.search(r"filename\*\s*=\s*([^;]+)", content_disposition, re.IGNORECASE)
    if m:
        value = m.group(1).strip().strip('"')
        parts = value.split("'", 2)
        if len(parts) == 3:
            return sanitize_filename(unquote(parts[2]))
        return sanitize_filename(unquote(value))
    m = re.search(r'filename\s*=\s*"([^"]+)"', content_disposition, re.IGNORECASE)
    if m:
        return sanitize_filename(m.group(1))
    m = re.search(r"filename\s*=\s*([^;]+)", content_disposition, re.IGNORECASE)
    if m:
        return sanitize_filename(m.group(1).strip().strip('"'))
    return None


def filename_from_url(url: str) -> str | None:
    """Best-effort filename from the URL path."""
    path = urlparse(url).path
    if not path or path.endswith("/"):
        return None
    base = unquote(path.rsplit("/", 1)[-1])
    if not base or "." not in base:
        return None
    return sanitize_filename(base)


def format_bytes(n: float | int | None, precision: int = 1) -> str:
    if n is None:
        return "—"
    n = float(n)
    units = ("B", "KB", "MB", "GB", "TB", "PB")
    idx = 0
    while abs(n) >= 1024.0 and idx < len(units) - 1:
        n /= 1024.0
        idx += 1
    if idx == 0:
        return f"{int(n)} B"
    return f"{n:.{precision}f} {units[idx]}"


def format_speed(bytes_per_sec: float | None) -> str:
    if bytes_per_sec is None or bytes_per_sec <= 0:
        return "0 B/s"
    return format_bytes(bytes_per_sec, precision=2) + "/s"


def format_eta(seconds: float | None) -> str:
    if seconds is None or seconds < 0 or seconds != seconds or seconds == float("inf"):
        return "—"
    seconds = int(seconds)
    if seconds < 60:
        return f"{seconds}s"
    minutes, sec = divmod(seconds, 60)
    if minutes < 60:
        return f"{minutes}m {sec:02d}s"
    hours, minutes = divmod(minutes, 60)
    if hours < 24:
        return f"{hours}h {minutes:02d}m"
    days, hours = divmod(hours, 24)
    return f"{days}d {hours:02d}h"


def redact_headers(headers: dict | None) -> dict:
    """Copy of *headers* with credential values replaced (safe for logs)."""
    if not headers:
        return {}
    return {
        k: ("<redacted>" if k.lower() in _SENSITIVE_HEADERS else v)
        for k, v in headers.items()
    }


def app_data_dir() -> Path:
    """Per-user data directory (SQLite DB, logs) — platform aware."""
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or str(Path.home() / "AppData" / "Local")
        path = Path(base) / "UltraDownload"
    elif sys.platform == "darwin":
        path = Path.home() / "Library" / "Application Support" / "UltraDownload"
    else:
        base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
        path = Path(base) / "UltraDownload"
    path.mkdir(parents=True, exist_ok=True)
    return path
