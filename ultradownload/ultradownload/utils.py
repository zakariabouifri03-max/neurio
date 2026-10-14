"""Small pure helpers: formatting, filename sanitisation, disk helpers.

Everything here is Qt-free and platform-tolerant so it can be unit
tested on any OS while the shipped application targets Windows.
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import sys
import unicodedata
from typing import Optional

# ---------------------------------------------------------------------------
# Size / speed / ETA formatting
# ---------------------------------------------------------------------------

_SIZE_UNITS = ("B", "KB", "MB", "GB", "TB", "PB")


def format_bytes(num: float, unit_spacer: str = " ") -> str:
    """Human readable size using binary steps labelled B/KB/MB/GB/TB.

    >>> format_bytes(0)
    '0 B'
    >>> format_bytes(1536)
    '1.50 KB'
    >>> format_bytes(80 * 1024**3)
    '80.00 GB'
    """
    if num is None:
        return "?"
    if num < 0:
        return "-" + format_bytes(-num, unit_spacer)
    n = float(num)
    for unit in _SIZE_UNITS:
        if n < 1024.0 or unit == _SIZE_UNITS[-1]:
            if unit == "B":
                return f"{int(n)}{unit_spacer}{unit}"
            return f"{n:.2f}{unit_spacer}{unit}"
        n /= 1024.0
    return f"{n:.2f}{unit_spacer}PB"  # pragma: no cover


def format_speed(bytes_per_sec: float) -> str:
    """Human readable transfer rate: ``12.34 MB/s``."""
    if bytes_per_sec is None or bytes_per_sec < 0:
        return "-- B/s"
    return format_bytes(bytes_per_sec) + "/s"


def format_eta(seconds: Optional[float]) -> str:
    """Human readable remaining time, ``--`` when unknown."""
    if seconds is None or seconds < 0 or seconds != seconds or seconds == float("inf"):
        return "--"
    seconds = int(seconds)
    if seconds < 60:
        return f"{seconds}s"
    if seconds < 3600:
        return f"{seconds // 60}m {seconds % 60:02d}s"
    hours, rem = divmod(seconds, 3600)
    if hours < 24:
        return f"{hours}h {rem // 60:02d}m"
    days, hours = divmod(hours, 24)
    return f"{days}d {hours:02d}h"


def compute_eta(downloaded: int, total: int, speed: float) -> Optional[float]:
    """Seconds remaining, or ``None`` when size or speed are unknown."""
    if total is None or total < 0 or speed <= 0:
        return None
    remaining = total - downloaded
    if remaining <= 0:
        return 0.0
    return remaining / speed


# ---------------------------------------------------------------------------
# Filename & path safety
# ---------------------------------------------------------------------------

_WINDOWS_RESERVED = {
    "CON", "PRN", "AUX", "NUL",
    *(f"COM{i}" for i in range(1, 10)),
    *(f"LPT{i}" for i in range(1, 10)),
}
_WINDOWS_RESERVED_RE = re.compile(
    r"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)", re.IGNORECASE
)
_ILLEGAL_CHARS_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def sanitize_filename(name: str, max_length: int = 150) -> str:
    """Make an untrusted filename safe for Windows and POSIX.

    * strips directories and traversal components,
    * removes illegal characters and control codes,
    * avoids Windows reserved device names,
    * trims trailing dots/spaces (illegal on Windows),
    * caps the length while preserving the extension.
    """
    if not name:
        return "download"
    # Normalise unicode and keep only the final path component of any OS.
    name = unicodedata.normalize("NFC", str(name))
    name = name.replace("\x00", "")
    name = re.split(r"[/\\]", name)[-1]
    name = name.strip().strip(".")
    name = _ILLEGAL_CHARS_RE.sub("_", name)
    name = name.rstrip(". ")
    if not name or name in (".", ".."):
        return "download"
    if _WINDOWS_RESERVED_RE.match(name) or name.upper() in _WINDOWS_RESERVED:
        name = "_" + name
    if len(name) > max_length:
        root, ext = os.path.splitext(name)
        ext = ext[:15]
        keep = max(1, max_length - len(ext))
        name = root[:keep].rstrip(". ") + ext
    return name or "download"


def is_within_directory(path: str, directory: str) -> bool:
    """True when ``path`` resolves inside ``directory`` (traversal guard)."""
    try:
        p = os.path.realpath(path)
        d = os.path.realpath(directory)
    except (OSError, ValueError):
        return False
    return p == d or p.startswith(d + os.sep)


def unique_path(directory: str, filename: str) -> str:
    """Return a non-colliding path: ``file.ext`` → ``file (1).ext`` …"""
    candidate = os.path.join(directory, filename)
    if not os.path.exists(candidate):
        return candidate
    root, ext = os.path.splitext(filename)
    i = 1
    while True:
        candidate = os.path.join(directory, f"{root} ({i}){ext}")
        if not os.path.exists(candidate):
            return candidate
        i += 1


# ---------------------------------------------------------------------------
# Disk helpers
# ---------------------------------------------------------------------------

def free_disk_space(path: str) -> Optional[int]:
    """Free bytes on the volume containing ``path`` (None when unknown)."""
    probe = path
    try:
        while probe and not os.path.exists(probe):
            parent = os.path.dirname(probe)
            if parent == probe:
                break
            probe = parent
        usage = shutil.disk_usage(probe or ".")
        return int(usage.free)
    except (OSError, ValueError):
        return None


def ensure_directory(path: str) -> None:
    """Create ``path`` if missing; raise OSError with a clear message."""
    try:
        os.makedirs(path, exist_ok=True)
    except OSError as exc:  # pragma: no cover - platform specific
        raise OSError(f"Cannot create directory '{path}': {exc}") from exc


def directory_writable(path: str) -> bool:
    if not os.path.isdir(path):
        return False
    return os.access(path, os.W_OK | os.X_OK)


# ---------------------------------------------------------------------------
# Checksums (streamed — never loads the whole file in RAM)
# ---------------------------------------------------------------------------

_SUPPORTED_HASHES = {"md5", "sha1", "sha256", "sha512"}


def compute_checksum(path: str, algo: str = "sha256",
                     chunk_size: int = 4 * 1024 * 1024,
                     progress_cb=None) -> str:
    """Hex digest of ``path`` using ``algo`` with bounded memory."""
    algo = algo.lower()
    if algo not in _SUPPORTED_HASHES:
        raise ValueError(f"unsupported checksum algorithm: {algo}")
    h = hashlib.new(algo)
    done = 0
    with open(path, "rb") as fh:
        while True:
            block = fh.read(chunk_size)
            if not block:
                break
            h.update(block)
            done += len(block)
            if progress_cb is not None:
                progress_cb(done)
    return h.hexdigest()


def checksum_matches(path: str, algo: str, expected: str, **kwargs) -> bool:
    return compute_checksum(path, algo, **kwargs).lower() == expected.strip().lower()


# ---------------------------------------------------------------------------
# App data location
# ---------------------------------------------------------------------------

def app_data_dir(app_name: str = "UltraDownload") -> str:
    """Per-user writable directory for the database, logs and settings."""
    if sys.platform.startswith("win"):
        base = os.environ.get("APPDATA") or os.path.expanduser("~")
    elif sys.platform == "darwin":  # pragma: no cover
        base = os.path.expanduser("~/Library/Application Support")
    else:
        base = os.environ.get("XDG_CONFIG_HOME") or os.path.expanduser("~/.config")
    path = os.path.join(base, app_name)
    os.makedirs(path, exist_ok=True)
    return path


def default_download_dir() -> str:
    home = os.path.expanduser("~")
    for name in ("Downloads", "downloads"):
        candidate = os.path.join(home, name)
        if os.path.isdir(candidate):
            return candidate
    return home


SENSITIVE_HEADERS = {"authorization", "cookie", "proxy-authorization", "x-api-key"}


def redact_headers(headers: dict) -> dict:
    """Copy of ``headers`` with sensitive values masked (for logs/UI)."""
    out = {}
    for k, v in (headers or {}).items():
        if k.lower() in SENSITIVE_HEADERS:
            out[k] = "***redacted***"
        else:
            out[k] = v
    return out


def redact_url(url: str) -> str:
    """Strip ``user:pass@`` credentials from a URL before logging it."""
    try:
        m = re.match(r"^(?P<scheme>[a-zA-Z][a-zA-Z0-9+.-]*://)(?P<rest>.*)$", url or "")
        if not m:
            return url
        rest = m.group("rest")
        if "@" in rest.split("/", 1)[0]:
            creds, _, host_part = rest.partition("@")
            user, _, _pw = creds.partition(":")
            return f"{m.group('scheme')}{user}:***@{host_part}"
        return url
    except Exception:  # pragma: no cover - defensive
        return url
