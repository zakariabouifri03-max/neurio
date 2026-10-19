"""FFmpeg / ffprobe discovery, probing and a cancellable process runner.

Discovery order:
  1. Explicit path from user settings
  2. ``ffmpeg`` / ``ffprobe`` on PATH
  3. A ``bin`` directory shipped next to the application (Windows installer)
  4. The static binary provided by the ``imageio-ffmpeg`` package (fallback)
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

from . import paths
from .logging_setup import get_logger

log = get_logger("ffmpeg")


class FFmpegNotFoundError(RuntimeError):
    pass


# ---------------------------------------------------------------- discovery
def _candidate_names(exe: str) -> list[str]:
    return [exe + (".exe" if sys.platform == "win32" else ""), exe]


def _bundled_dir() -> Path:
    # PyInstaller unpacks data next to sys.executable / __file__.
    roots = [Path(sys.executable).parent, Path(__file__).resolve().parents[2]]
    for root in roots:
        for sub in ("bin", "ffmpeg", "third_party/ffmpeg"):
            d = root / sub
            if d.exists():
                return d
    return Path("__nonexistent__")


def find_ffmpeg() -> Optional[Path]:
    from ..core.config import Config  # local import: avoid import cycles
    cfg_path = ""
    try:
        cfg_path = Config().get("ffmpeg_path", "")  # fresh read, cheap
    except Exception:
        pass
    if cfg_path and Path(cfg_path).exists():
        return Path(cfg_path)
    found = shutil.which("ffmpeg")
    if found:
        return Path(found)
    bundle = _bundled_dir()
    for name in _candidate_names("ffmpeg"):
        p = bundle / name
        if p.exists():
            return p
    try:
        import imageio_ffmpeg  # type: ignore
        return Path(imageio_ffmpeg.get_ffmpeg_exe())
    except Exception:
        return None


def find_ffprobe() -> Optional[Path]:
    cfg_path = ""
    try:
        from ..core.config import Config
        cfg_path = Config().get("ffprobe_path", "")
    except Exception:
        pass
    if cfg_path and Path(cfg_path).exists():
        return Path(cfg_path)
    found = shutil.which("ffprobe")
    if found:
        return Path(found)
    bundle = _bundled_dir()
    for name in _candidate_names("ffprobe"):
        p = bundle / name
        if p.exists():
            return p
    # imageio-ffmpeg ships only ffmpeg; ffprobe may sit next to it.
    try:
        import imageio_ffmpeg  # type: ignore
        sibling = Path(imageio_ffmpeg.get_ffmpeg_exe()).parent
        for name in _candidate_names("ffprobe"):
            p = sibling / name
            if p.exists():
                return p
    except Exception:
        pass
    return None


def require_ffmpeg() -> Path:
    exe = find_ffmpeg()
    if exe is None:
        raise FFmpegNotFoundError(
            "FFmpeg was not found. Install FFmpeg or set its path in Settings."
        )
    return exe


# ------------------------------------------------------------------ probing
@dataclass
class MediaMetadata:
    path: str
    exists: bool = True
    duration: float = 0.0
    width: int = 0
    height: int = 0
    fps: float = 0.0
    has_video: bool = False
    has_audio: bool = False
    audio_channels: int = 0
    audio_sample_rate: int = 0
    audio_codec: str = ""
    video_codec: str = ""
    pixel_format: str = ""
    bitrate: int = 0
    rotation: int = 0
    is_image: bool = False
    tags: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return dict(self.__dict__)


_FPS_RE = re.compile(r"(\d+)/(\d+)")


def _parse_fps(rate: str) -> float:
    if not rate or rate == "0/0":
        return 0.0
    m = _FPS_RE.match(rate)
    if m:
        num, den = int(m.group(1)), int(m.group(2))
        return num / den if den else 0.0
    try:
        return float(rate)
    except ValueError:
        return 0.0


def probe(path: str | os.PathLike, ffprobe: Optional[Path] = None) -> MediaMetadata:
    """Read container/stream metadata without decoding the whole file."""
    p = Path(path)
    meta = MediaMetadata(path=str(p))
    if not p.exists():
        meta.exists = False
        return meta
    ext = p.suffix.lower()
    from ..core.constants import IMAGE_EXTENSIONS
    if ext in IMAGE_EXTENSIONS:
        meta.is_image = True
        meta.has_video = True  # treated as a visual source by the timeline
        meta.duration = 0.0
        # Dimensions via ffmpeg fallback below.
    ffprobe = ffprobe or find_ffprobe()
    if ffprobe is None:
        # Last resort: parse `ffmpeg -i` stderr.
        return _probe_via_ffmpeg(p, meta)
    cmd = [
        str(ffprobe), "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", str(p),
    ]
    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        if out.returncode != 0:
            log.warning("ffprobe failed for %s: %s", p, out.stderr.strip())
            return _probe_via_ffmpeg(p, meta)
        data = json.loads(out.stdout or "{}")
    except Exception as exc:
        log.warning("ffprobe error for %s: %s", p, exc)
        return _probe_via_ffmpeg(p, meta)
    fmt = data.get("format", {})
    try:
        meta.duration = float(fmt.get("duration", 0.0) or 0.0)
        meta.bitrate = int(float(fmt.get("bit_rate", 0) or 0))
        meta.tags = fmt.get("tags", {}) or {}
    except (TypeError, ValueError):
        pass
    for stream in data.get("streams", []):
        codec_type = stream.get("codec_type")
        if codec_type == "video" and not meta.has_video:
            meta.has_video = True
            meta.width = int(stream.get("width", 0) or 0)
            meta.height = int(stream.get("height", 0) or 0)
            meta.fps = _parse_fps(stream.get("avg_frame_rate", "0/0")) or \
                _parse_fps(stream.get("r_frame_rate", "0/0"))
            meta.video_codec = stream.get("codec_name", "")
            meta.pixel_format = stream.get("pix_fmt", "")
            rotation = 0
            for side_data in stream.get("side_data_list", []) or []:
                rotation = int(side_data.get("rotation", 0) or 0)
            meta.rotation = rotation
        elif codec_type == "audio" and not meta.has_audio:
            meta.has_audio = True
            meta.audio_channels = int(stream.get("channels", 0) or 0)
            meta.audio_sample_rate = int(stream.get("sample_rate", 0) or 0)
            meta.audio_codec = stream.get("codec_name", "")
    if meta.is_image and meta.duration == 0.0:
        meta.duration = 0.0
    return meta


def _probe_via_ffmpeg(path: Path, meta: MediaMetadata) -> MediaMetadata:
    ffmpeg = find_ffmpeg()
    if ffmpeg is None:
        return meta
    proc = subprocess.run(
        [str(ffmpeg), "-hide_banner", "-i", str(path)],
        capture_output=True, text=True, timeout=60,
    )
    text = proc.stderr
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+\.\d+)", text)
    if m:
        h, mn, s = m.groups()
        meta.duration = int(h) * 3600 + int(mn) * 60 + float(s)
    m = re.search(r"(\d{2,5})x(\d{2,5})", text)
    if m and not meta.width:
        meta.width, meta.height = int(m.group(1)), int(m.group(2))
        meta.has_video = True
    m = re.search(r"(\d+(?:\.\d+)?)\s+fps", text)
    if m:
        meta.fps = float(m.group(1))
    if "Audio:" in text:
        meta.has_audio = True
        m = re.search(r"Audio:\s*\w+", text)
        if m:
            meta.audio_codec = m.group(0).split()[-1]
        m = re.search(r"(\d+)\s+Hz", text)
        if m:
            meta.audio_sample_rate = int(m.group(1))
    return meta


# ------------------------------------------------------------- process runner
@dataclass
class ProcessResult:
    returncode: int
    stdout: str
    stderr: str

    @property
    def ok(self) -> bool:
        return self.returncode == 0


class CancellableProcess:
    """Run a subprocess with progress callbacks, cancellation and timeouts."""

    def __init__(self) -> None:
        self._proc: Optional[subprocess.Popen] = None
        self._cancel = threading.Event()
        self._lock = threading.Lock()

    def cancel(self) -> None:
        self._cancel.set()
        with self._lock:
            if self._proc and self._proc.poll() is None:
                log.info("Cancelling subprocess pid=%s", self._proc.pid)
                self._proc.terminate()

    @property
    def cancelled(self) -> bool:
        return self._cancel.is_set()

    def run(
        self,
        cmd: list[str],
        *,
        total_duration: float = 0.0,
        on_progress: Optional[Callable[[float, float], None]] = None,
        on_line: Optional[Callable[[str], None]] = None,
        timeout_s: float = 0.0,
        cwd: Optional[str] = None,
    ) -> ProcessResult:
        """Run *cmd*. Progress is parsed from ffmpeg ``-progress pipe`` output.

        ``on_progress(fraction, seconds)`` is called when total_duration > 0.
        """
        log.debug("RUN %s", " ".join(str(c) for c in cmd))
        creationflags = 0
        if sys.platform == "win32":
            creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        self._cancel.clear()
        with self._lock:
            self._proc = subprocess.Popen(
                [str(c) for c in cmd],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                bufsize=1,
                cwd=cwd,
                creationflags=creationflags,
            )
        proc = self._proc
        stderr_lines: list[str] = []

        def _drain_stderr() -> None:
            assert proc.stderr is not None
            for line in proc.stderr:
                stderr_lines.append(line)
                if on_line:
                    on_line(line.rstrip())

        t = threading.Thread(target=_drain_stderr, daemon=True)
        t.start()
        last_fraction = -1.0
        try:
            assert proc.stdout is not None
            for line in proc.stdout:
                if self._cancel.is_set() and proc.poll() is None:
                    proc.terminate()
                    break
                line = line.strip()
                if line.startswith("out_time_ms=") or line.startswith("out_time_us="):
                    try:
                        val = int(line.split("=", 1)[1])
                        seconds = val / 1_000_000.0 if "us" in line else val / 1000.0
                    except ValueError:
                        continue
                    if total_duration > 0 and on_progress:
                        fraction = max(0.0, min(1.0, seconds / total_duration))
                        if fraction - last_fraction >= 0.002 or fraction >= 0.999:
                            last_fraction = fraction
                            on_progress(fraction, seconds)
                elif line == "progress=end" and total_duration > 0 and on_progress:
                    on_progress(1.0, total_duration)
        finally:
            try:
                rc = proc.wait(timeout=timeout_s or None)
            except subprocess.TimeoutExpired:
                proc.kill()
                rc = proc.wait()
            t.join(timeout=5)
        return ProcessResult(rc, "", "".join(stderr_lines))


def run_simple(cmd: list[str], timeout_s: float = 120) -> ProcessResult:
    creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if sys.platform == "win32" else 0
    try:
        proc = subprocess.run(
            [str(c) for c in cmd], capture_output=True, text=True,
            timeout=timeout_s, creationflags=creationflags,
        )
    except subprocess.TimeoutExpired as exc:
        return ProcessResult(-1, exc.stdout or "", (exc.stderr or "") + "\n[timeout]")
    return ProcessResult(proc.returncode, proc.stdout, proc.stderr)


# ------------------------------------------------------------- capabilities
_HW_CACHE: Optional[dict[str, bool]] = None


def ffmpeg_supports_encoders() -> dict[str, bool]:
    """Return availability map for the encoders the export dialog offers."""
    global _HW_CACHE
    if _HW_CACHE is not None:
        return dict(_HW_CACHE)
    caps: dict[str, bool] = {}
    ffmpeg = find_ffmpeg()
    if ffmpeg is None:
        _HW_CACHE = caps
        return caps
    res = run_simple([str(ffmpeg), "-hide_banner", "-encoders"], timeout_s=30)
    text = res.stdout + res.stderr
    for cid, (encoder, _label, hw) in [
        ("h264_cpu", ("libx264", "", False)),
        ("h265_cpu", ("libx265", "", False)),
        ("h264_nvenc", ("h264_nvenc", "", True)),
        ("hevc_nvenc", ("hevc_nvenc", "", True)),
        ("h264_qsv", ("h264_qsv", "", True)),
        ("hevc_qsv", ("hevc_qsv", "", True)),
        ("h264_amf", ("h264_amf", "", True)),
        ("hevc_amf", ("hevc_amf", "", True)),
        ("aac", ("aac", "", False)),
        ("libmp3lame", ("libmp3lame", "", False)),
        ("libopus", ("libopus", "", False)),
    ]:
        caps[cid] = bool(re.search(rf"\b{re.escape(encoder)}\b", text))
    _HW_CACHE = caps
    log.info("Encoder support: %s", caps)
    return dict(caps)


_FILTER_CACHE: Optional[set[str]] = None


def ffmpeg_supports_filter(name: str) -> bool:
    """True when the discovered FFmpeg build contains filter *name*."""
    global _FILTER_CACHE
    if _FILTER_CACHE is None:
        ffmpeg = find_ffmpeg()
        if ffmpeg is None:
            return False
        res = run_simple([str(ffmpeg), "-hide_banner", "-filters"], timeout_s=30)
        _FILTER_CACHE = set(re.findall(r"^\s*[TS.->|]+\s+([A-Za-z0-9_]+)",
                                       res.stdout, flags=re.MULTILINE))
    return name in _FILTER_CACHE


def pick_hwaccel_decoder(path: str) -> list[str]:
    """Best-effort hardware decoder flags; caller must fall back on failure."""
    if sys.platform != "win32":
        return []
    # Only used when the user enabled hardware acceleration; the export engine
    # retries without these flags if the decoder rejects them.
    return ["-hwaccel", "auto"]
