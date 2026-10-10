"""FFmpeg discovery, probing and cancellable execution with progress reporting.

FFmpeg is located in this order: ADZAK_FFMPEG env var, an ffmpeg bundled next
to the application, ffmpeg on PATH, then the binary shipped by the optional
`imageio-ffmpeg` package. FFmpeg is never installed system-wide by the app.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import sys
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

from .errors import AppError, FFmpegNotFound, OperationCancelled
from .log import get_logger

log = get_logger("ffmpeg")
_cached_path: Optional[str] = None


def _creationflags() -> int:
    return getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0


def find_ffmpeg(refresh: bool = False) -> str:
    global _cached_path
    if _cached_path and not refresh:
        return _cached_path
    candidates: list[str] = []
    env = os.environ.get("ADZAK_FFMPEG")
    if env:
        candidates.append(env)
    base = Path(getattr(sys, "_MEIPASS", Path(sys.argv[0]).resolve().parent))
    exe = "ffmpeg.exe" if sys.platform == "win32" else "ffmpeg"
    candidates += [str(base / "ffmpeg" / exe), str(base / exe)]
    which = shutil.which("ffmpeg")
    if which:
        candidates.append(which)
    try:  # optional bundled binary
        import imageio_ffmpeg  # type: ignore

        candidates.append(imageio_ffmpeg.get_ffmpeg_exe())
    except Exception:  # noqa: BLE001 - optional dependency
        pass
    for c in candidates:
        if c and Path(c).is_file():
            _cached_path = c
            log.info("Using FFmpeg at %s", c)
            return c
    raise FFmpegNotFound(
        "FFmpeg was not found. Reinstall ADZAK Creative Studio or set the ADZAK_FFMPEG "
        "environment variable to ffmpeg.exe."
    )


def _run_capture(args: list[str], timeout: float = 120) -> subprocess.CompletedProcess:
    cmd = [find_ffmpeg(), "-hide_banner", "-nostdin", *args]
    log.debug("ffmpeg %s", " ".join(args[:40]))
    try:
        return subprocess.run(
            cmd, capture_output=True, timeout=timeout, creationflags=_creationflags()
        )
    except subprocess.TimeoutExpired as exc:
        raise AppError("FFmpeg took too long and was stopped.", details=str(exc)) from exc


def encoders() -> set[str]:
    out = _run_capture(["-encoders"]).stdout.decode("utf-8", "replace")
    names = set()
    for line in out.splitlines():
        m = re.match(r"\s*[VAS][A-Z.]{5}\s+(\S+)", line)
        if m:
            names.add(m.group(1))
    return names


@dataclass
class MediaInfo:
    path: str
    duration: float = 0.0
    width: int = 0
    height: int = 0
    fps: float = 0.0
    video_codec: str = ""
    audio_codec: str = ""
    sample_rate: int = 0
    channels: str = ""
    bitrate_kbps: float = 0.0
    has_video: bool = False
    has_audio: bool = False
    size_bytes: int = 0
    container: str = ""
    raw: str = field(default="", repr=False)


_DUR_RE = re.compile(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)")
_BR_RE = re.compile(r"bitrate:\s*(\d+)\s*kb/s")
_VID_RE = re.compile(r"Stream #\d+:\d+[^:]*: Video: (\w+)")
_AUD_RE = re.compile(r"Stream #\d+:\d+[^:]*: Audio: (\w+)")
_RES_RE = re.compile(r"[, ](\d{2,5})x(\d{2,5})[ ,\[]")
_FPS_RE = re.compile(r"(\d+(?:\.\d+)?) fps")
_SR_RE = re.compile(r"(\d+) Hz")
_INPUT_RE = re.compile(r"Input #0, ([^,]+)")


def probe(path: str | Path) -> MediaInfo:
    p = Path(path)
    if not p.is_file():
        raise AppError(f"File not found: {p.name}")
    res = _run_capture(["-i", str(p)], timeout=60)
    text = res.stderr.decode("utf-8", "replace")
    if "Invalid data" in text or "could not find codec" in text or "No such file" in text:
        if "Stream #" not in text:
            raise AppError(f"Unsupported or damaged media file: {p.name}", details=text[-800:])
    info = MediaInfo(path=str(p), raw=text, size_bytes=p.stat().st_size)
    m = _DUR_RE.search(text)
    if m:
        info.duration = int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))
    m = _BR_RE.search(text)
    if m:
        info.bitrate_kbps = float(m.group(1))
    m = _INPUT_RE.search(text)
    if m:
        info.container = m.group(1)
    for line in text.splitlines():
        if "Stream #" not in line:
            continue
        if not info.has_video and (mv := _VID_RE.search(line)):
            info.has_video = True
            info.video_codec = mv.group(1)
            if (mr := _RES_RE.search(line)):
                info.width, info.height = int(mr.group(1)), int(mr.group(2))
            if (mf := _FPS_RE.search(line)):
                info.fps = float(mf.group(1))
        elif not info.has_audio and (ma := _AUD_RE.search(line)):
            info.has_audio = True
            info.audio_codec = ma.group(1)
            if (ms := _SR_RE.search(line)):
                info.sample_rate = int(ms.group(1))
            parts = line.split(",")
            if len(parts) > 2:
                info.channels = parts[2].strip()
    if not info.has_video and not info.has_audio and info.duration <= 0:
        raise AppError(f"No audio or video stream found in {p.name}")
    return info


def probe_cached(path: str | Path, cache: dict) -> MediaInfo:
    key = str(path)
    if key not in cache:
        cache[key] = probe(path)
    return cache[key]


_TIME_RE = re.compile(r"out_time_us=(\d+)")


def run(
    args: list[str],
    *,
    duration: float = 0.0,
    on_progress: Optional[Callable[[float], None]] = None,
    cancel: Optional[threading.Event] = None,
    timeout: Optional[float] = None,
) -> str:
    """Run ffmpeg with `args` (without the binary). Reports progress 0..1 when duration is known.

    Returns the stderr tail on success. Raises AppError on failure and OperationCancelled
    when `cancel` is set.
    """
    cmd = [find_ffmpeg(), "-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats", *args]
    log.info("ffmpeg run: %s", " ".join(Path(a).name if "/" in a or "\\" in a else a for a in cmd[1:8]))
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        creationflags=_creationflags(),
    )
    err_chunks: list[str] = []

    def _drain_err() -> None:
        assert proc.stderr is not None
        for raw in proc.stderr:
            err_chunks.append(raw.decode("utf-8", "replace"))
            if len(err_chunks) > 400:
                del err_chunks[:200]

    t = threading.Thread(target=_drain_err, daemon=True)
    t.start()
    assert proc.stdout is not None
    try:
        for raw in proc.stdout:
            if cancel is not None and cancel.is_set():
                proc.kill()
                proc.wait()
                raise OperationCancelled("Operation cancelled.")
            line = raw.decode("utf-8", "replace").strip()
            if on_progress and duration > 0:
                m = _TIME_RE.match(line)
                if m:
                    on_progress(min(1.0, int(m.group(1)) / 1_000_000 / duration))
        code = proc.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        proc.kill()
        proc.wait()
        raise AppError("The operation took too long and was stopped.")
    t.join(timeout=5)
    tail = "".join(err_chunks)
    if code != 0:
        last = [ln for ln in tail.splitlines() if ln.strip()][-6:]
        raise AppError(
            "FFmpeg could not complete the operation. Check the input files and settings.",
            details="\n".join(last),
        )
    if on_progress:
        on_progress(1.0)
    return tail


def run_quiet(args: list[str], timeout: float = 600) -> subprocess.CompletedProcess:
    """Run ffmpeg synchronously, returning the completed process (stderr captured)."""
    res = _run_capture(["-y", *args], timeout=timeout)
    if res.returncode != 0:
        tail = res.stderr.decode("utf-8", "replace").strip().splitlines()[-6:]
        raise AppError("FFmpeg could not complete the operation.", details="\n".join(tail))
    return res


def parse_seconds(text: str) -> float:
    h, m, s = text.split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)
