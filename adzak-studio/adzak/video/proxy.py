"""Low-resolution preview proxies for heavy footage (used for previews on low-memory PCs)."""
from __future__ import annotations

import hashlib
from pathlib import Path

from ..core import ffmpeg
from ..core.errors import AppError
from ..core.paths import subdir


def proxy_path_for(src: str | Path) -> Path:
    p = Path(src)
    try:
        stamp = f"{p.resolve()}|{p.stat().st_mtime_ns}|{p.stat().st_size}"
    except OSError as exc:
        raise AppError(f"File not found: {p.name}") from exc
    digest = hashlib.sha1(stamp.encode("utf-8")).hexdigest()[:16]
    return subdir("proxies") / f"{p.stem[:40]}-{digest}.proxy.mp4"


def make_proxy(src: str | Path, height: int = 360) -> Path:
    """Create (or reuse) a small H.264 proxy with the same duration, for preview only."""
    if not 144 <= height <= 1080:
        raise AppError("Proxy height must be between 144 and 1080 pixels.")
    info = ffmpeg.probe(src)
    if not info.has_video:
        raise AppError("Proxies are only needed for video files.")
    out = proxy_path_for(src)
    if out.is_file() and out.stat().st_size > 0:
        return out
    tmp = out.with_name(out.stem + ".tmp.mp4")
    ffmpeg.run(["-i", str(src), "-vf", f"scale=-2:{height}", "-c:v", "libx264", "-preset", "ultrafast",
                "-crf", "30", "-an", "-movflags", "+faststart", str(tmp)], timeout=3600)
    tmp.replace(out)
    return out
