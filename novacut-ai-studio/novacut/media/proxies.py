"""Proxy media: lightweight H.264/AAC transcodes for smooth low-res editing."""
from __future__ import annotations

from pathlib import Path

from ..core import paths
from ..core.ffmpeg import CancellableProcess, find_ffmpeg
from ..core.logging_setup import get_logger
from ..models.media import MediaItem

log = get_logger("proxies")


def proxy_path_for(item: MediaItem, height: int = 720) -> Path:
    suffix = ".mp4"
    if item.kind == "audio":
        suffix = ".m4a"
    return paths.PROXY_DIR / f"{item.file_hash or item.id}_proxy_{height}{suffix}"


def generate_proxy(item: MediaItem, height: int = 720,
                   progress=None, should_cancel=None) -> str:
    """Create (or reuse) a proxy for *item*. Returns its path."""
    ffmpeg = find_ffmpeg()
    if ffmpeg is None:
        raise RuntimeError("FFmpeg is required to generate proxies.")
    out = proxy_path_for(item, height)
    if out.exists() and item.proxy_path == str(out):
        return str(out)
    out.parent.mkdir(parents=True, exist_ok=True)

    if item.kind == "audio":
        cmd = [str(ffmpeg), "-y", "-i", item.path, "-vn",
               "-c:a", "aac", "-b:a", "128k", str(out)]
    else:
        # Scale down, preserve aspect with even dimensions; easy-to-decode codec.
        vf = (f"scale=-2:'min({height},ih)':flags=fast_bilinear,"
              f"fps={max(24, int(item.fps or 30))}")
        cmd = [
            str(ffmpeg), "-y", "-hide_banner", "-i", item.path,
            "-vf", vf,
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
            "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart",
            "-progress", "pipe:1", str(out),
        ]
    runner = CancellableProcess()

    def _on_progress(fraction: float, _seconds: float) -> None:
        if progress:
            progress(fraction, "Creating proxy")
        if should_cancel and should_cancel():
            runner.cancel()

    result = runner.run(cmd, total_duration=item.duration, on_progress=_on_progress)
    if runner.cancelled:
        out.unlink(missing_ok=True)
        raise RuntimeError("Proxy generation cancelled")
    if not result.ok:
        out.unlink(missing_ok=True)
        raise RuntimeError(f"Proxy failed: {result.stderr[-400:]}")
    item.proxy_path = str(out)
    log.info("Proxy created: %s", out)
    return str(out)
