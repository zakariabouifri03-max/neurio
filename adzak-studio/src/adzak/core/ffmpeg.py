"""FFmpeg discovery and subprocess management.

ADZAK never bundles a hidden copy of FFmpeg that it pretends exists: if no
ffmpeg executable can be located the media features report themselves as
unavailable and the UI shows a clear message instead of failing silently.

Search order:
1. Explicit override (``ADZAK_FFMPEG`` env var or Settings > ffmpeg/path).
2. ``ffmpeg/bin`` next to the packaged executable (for Windows builds).
3. ``imageio-ffmpeg`` pip package (bundled static build) — used in dev/test.
4. ``ffmpeg`` on the system PATH.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Iterator

from . import paths
from .logging_setup import get_logger

log = get_logger("ffmpeg")


class FFmpegNotFound(RuntimeError):
    pass


@dataclass
class StreamInfo:
    index: int
    codec_type: str
    codec_name: str
    width: int | None = None
    height: int | None = None
    duration: float | None = None
    sample_rate: int | None = None
    channels: int | None = None
    fps: float | None = None
    bitrate: int | None = None
    raw: dict = field(default_factory=dict)


@dataclass
class MediaInfo:
    path: str
    duration: float
    size_bytes: int
    bitrate: int | None
    format_name: str
    streams: list[StreamInfo]

    @property
    def video_stream(self) -> StreamInfo | None:
        return next((s for s in self.streams if s.codec_type == "video"), None)

    @property
    def audio_stream(self) -> StreamInfo | None:
        return next((s for s in self.streams if s.codec_type == "audio"), None)

    def resolution(self) -> tuple[int, int] | None:
        v = self.video_stream
        return (v.width, v.height) if v and v.width else None


def _which(name: str) -> str | None:
    return shutil.which(name) or shutil.which(name + ".exe")


def find_ffmpeg(explicit: str | None = None) -> str | None:
    """Locate a usable ffmpeg binary, or return None."""
    candidates: list[str] = []
    env = os.environ.get("ADZAK_FFMPEG")
    if explicit:
        candidates.append(explicit)
    if env:
        candidates.append(env)
    bundled = paths.default_ffmpeg_dir()
    if bundled:
        candidates += [str(bundled / "ffmpeg.exe"), str(bundled / "ffmpeg")]
    for c in candidates:
        if c and Path(c).is_file():
            return c
    sys_path = _which("ffmpeg")
    if sys_path:
        return sys_path
    # Fallback: static build shipped with the imageio-ffmpeg wheel.
    try:
        import imageio_ffmpeg  # type: ignore

        exe = imageio_ffmpeg.get_ffmpeg_exe()
        if exe and Path(exe).is_file():
            return exe
    except Exception:
        pass
    return None


def ffprobe_available(ffmpeg_path: str) -> bool:
    """ffprobe ships separately; ADZAK can work without it (fallback probes)."""
    return shutil.which("ffprobe") is not None or Path(ffmpeg_path.replace("ffmpeg", "ffprobe")).is_file()


def probe(path: str | Path, ffmpeg_path: str | None = None) -> MediaInfo:
    """Extract container/stream information using ffprobe (JSON output)."""
    path = str(path)
    if not Path(path).is_file():
        raise FileNotFoundError(path)
    ff = ffmpeg_path or find_ffmpeg()
    if not ff:
        raise FFmpegNotFound("ffmpeg not found")
    ffprobe = shutil.which("ffprobe")
    if not ffprobe and ff.endswith("ffmpeg"):
        sibling = Path(ff).with_name("ffprobe")
        ffprobe = str(sibling) if sibling.is_file() else None
    if not ffprobe:
        # Minimal fallback probe using ffmpeg -i stderr parsing.
        return _fallback_probe(path, ff)
    cmd = [
        ffprobe, "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", path,
    ]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        data = json.loads(out.stdout or "{}")
    except (subprocess.TimeoutExpired, json.JSONDecodeError, OSError) as exc:
        raise RuntimeError(f"ffprobe failed: {exc}") from exc
    fmt = data.get("format", {})
    streams = []
    for s in data.get("streams", []):
        fps = None
        for key in ("avg_frame_rate", "r_frame_rate"):
            raw = s.get(key) or ""
            if "/" in raw:
                num, _, den = raw.partition("/")
                try:
                    if int(den):
                        fps = int(num) / int(den)
                        break
                except ValueError:
                    pass
        streams.append(StreamInfo(
            index=int(s.get("index", 0)),
            codec_type=s.get("codec_type", ""),
            codec_name=s.get("codec_name", ""),
            width=s.get("width"),
            height=s.get("height"),
            duration=float(s["duration"]) if s.get("duration") else None,
            sample_rate=int(s["sample_rate"]) if s.get("sample_rate") else None,
            channels=s.get("channels"),
            fps=fps,
            bitrate=int(s["bit_rate"]) if s.get("bit_rate") else None,
            raw=s,
        ))
    return MediaInfo(
        path=path,
        duration=float(fmt.get("duration", 0.0) or 0.0),
        size_bytes=int(fmt.get("size", 0) or 0),
        bitrate=int(fmt["bit_rate"]) if fmt.get("bit_rate") else None,
        format_name=fmt.get("format_name", ""),
        streams=streams,
    )


def _fallback_probe(path: str, ffmpeg: str) -> MediaInfo:
    """Parse `ffmpeg -i` stderr when ffprobe is not available."""
    out = subprocess.run([ffmpeg, "-hide_banner", "-i", path],
                         capture_output=True, text=True, timeout=60)
    text = out.stderr or ""
    duration = 0.0
    m = re.search(r"Duration:\s*(\d+):(\d+):([\d.]+)", text)
    if m:
        duration = int(m[1]) * 3600 + int(m[2]) * 60 + float(m[3])
    fmt = ""
    fm = re.search(r"Input #\d+,\s*([^,]+(?:,[^,]+)*?),\s*from", text)
    if fm:
        fmt = fm[1].strip()
    streams: list[StreamInfo] = []
    for i, sm in enumerate(re.finditer(
            r"Stream #\d+:\d+.*?:\s*(\w+):\s*(\w+)([^\n]*)", text)):
        kind, codec, rest = sm[1].lower(), sm[2].lower(), sm[3]
        width = height = None
        wm = re.search(r"(\d{2,5})x(\d{2,5})", rest)
        if wm:
            width, height = int(wm[1]), int(wm[2])
        fps = None
        fm = re.search(r"([\d.]+)\s+fps", rest)
        if fm:
            fps = float(fm[1])
        sr = None
        srm = re.search(r"(\d+)\s*Hz", rest)
        if srm:
            sr = int(srm[1])
        streams.append(StreamInfo(index=i, codec_type=kind, codec_name=codec,
                                  width=width, height=height, fps=fps, sample_rate=sr))
    return MediaInfo(path=path, duration=duration,
                     size_bytes=Path(path).stat().st_size, bitrate=None,
                     format_name=fmt, streams=streams)


def run_ffmpeg(args: list[str], ffmpeg_path: str | None = None,
               timeout: float | None = None) -> subprocess.CompletedProcess:
    ff = ffmpeg_path or find_ffmpeg()
    if not ff:
        raise FFmpegNotFound("ffmpeg is not installed or configured")
    cmd = [ff, "-hide_banner", "-y", *args]
    log.info("ffmpeg: %s", " ".join(cmd[:12]) + (" …" if len(cmd) > 12 else ""))
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


@dataclass
class FFmpegJob:
    """A running ffmpeg process with progress parsing.

    ``poll()`` parses the stderr that ffmpeg writes to the progress pipe /
    stderr and returns a 0..1 fraction when the total duration is known.
    """

    args: list[str]
    ffmpeg_path: str | None = None
    timeout: float | None = None
    _proc: subprocess.Popen | None = field(default=None, repr=False)
    _stderr_tail: str = field(default="", repr=False)
    _reader: threading.Thread | None = field(default=None, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    total_duration: float | None = None

    def start(self) -> None:
        ff = self.ffmpeg_path or find_ffmpeg()
        if not ff:
            raise FFmpegNotFound("ffmpeg is not installed or configured")
        cmd = [ff, "-hide_banner", "-nostdin", "-progress", "pipe:2", "-y", *self.args]
        log.info("ffmpeg job start: %s", " ".join(cmd[:10]))
        self._proc = subprocess.Popen(
            cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True,
        )
        # A reader thread drains stderr on every platform (select() does not
        # work on Windows pipes), keeping the pipe from blocking ffmpeg.
        self._reader = threading.Thread(target=self._drain, daemon=True)
        self._reader.start()

    def _drain(self) -> None:
        assert self._proc and self._proc.stderr
        try:
            for line in iter(self._proc.stderr.readline, ""):
                with self._lock:
                    self._stderr_tail = (self._stderr_tail + line)[-8000:]
        except (OSError, ValueError):
            pass

    def poll(self) -> tuple[float | None, bool]:
        """Return (progress_fraction_or_None, finished)."""
        if self._proc is None:
            return None, False
        with self._lock:
            m = re.search(r"out_time_ms=(\d+)", self._stderr_tail[-4000:])
        finished = self._proc.poll() is not None
        if m and self.total_duration:
            done = int(m[1]) / 1_000_000.0
            return min(done / self.total_duration, 1.0), finished
        return None, finished

    def wait(self, timeout: float | None = None) -> int:
        if self._proc is None:
            raise RuntimeError("job not started")
        rc = self._proc.wait(timeout=timeout)
        if self._reader:
            self._reader.join(timeout=2)
        return rc

    def returncode(self) -> int | None:
        return self._proc.returncode if self._proc else None

    def terminate(self) -> None:
        if self._proc and self._proc.poll() is None:
            self._proc.terminate()
            try:
                self._proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self._proc.kill()

    def stderr_tail(self, n: int = 2000) -> str:
        return self._stderr_tail[-n:]


def iter_stderr_lines(proc: subprocess.Popen) -> Iterator[str]:
    assert proc.stderr is not None
    for line in iter(proc.stderr.readline, ""):
        yield line


class CancelledError(RuntimeError):
    pass
