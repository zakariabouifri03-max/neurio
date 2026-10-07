"""FFmpeg integration: native video encode (MP4 / WebM / GIF) and audio decode.

MotionForge ships a static ffmpeg binary next to the executable.  When it is
missing the application degrades gracefully: PNG/JPEG sequences still export
(they are written with Qt) and the UI explains what is unavailable.
"""
from __future__ import annotations

import os
import sys
import shutil
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass

from PySide6.QtCore import QObject, QThread, Signal
from PySide6.QtGui import QImage

try:
    import numpy as np
except Exception:  # pragma: no cover
    np = None  # type: ignore


# --------------------------------------------------------------------------
# locating ffmpeg
# --------------------------------------------------------------------------
def app_root() -> str:
    """Directory that contains the frozen app (or the source tree)."""
    if getattr(sys, "frozen", False):
        return os.path.dirname(os.path.abspath(sys.executable))
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.abspath(os.path.join(here, "..", ".."))


def _candidates(name: str) -> list[str]:
    exe = f"{name}.exe" if os.name == "nt" else name
    root = app_root()
    return [
        os.path.join(root, "ffmpeg", exe),
        os.path.join(root, "bin", exe),
        os.path.join(root, exe),
        shutil.which(exe) or "",
        shutil.which(name) or "",
    ]


def _imageio_ffmpeg() -> str | None:
    """The static ffmpeg that ships with the application (imageio-ffmpeg)."""
    try:
        import imageio_ffmpeg
        path = imageio_ffmpeg.get_ffmpeg_exe()
        if path and os.path.isfile(path):
            return path
    except Exception:
        return None
    return None


def ffmpeg_path() -> str | None:
    override = os.environ.get("MFS_FFMPEG")
    if override and os.path.exists(override):
        return override
    for c in _candidates("ffmpeg"):
        if c and os.path.isfile(c) and os.access(c, os.X_OK):
            return c
    return _imageio_ffmpeg()


def have_ffmpeg() -> bool:
    return ffmpeg_path() is not None


def ffmpeg_version() -> str:
    path = ffmpeg_path()
    if not path:
        return ""
    try:
        out = subprocess.run([path, "-version"], capture_output=True, text=True, timeout=8)
        return out.stdout.splitlines()[0] if out.stdout else ""
    except Exception:
        return ""


NO_WINDOW = 0x08000000 if os.name == "nt" else 0     # CREATE_NO_WINDOW


def _popen(args: list[str], **kw) -> subprocess.Popen:
    kw.setdefault("stdin", subprocess.PIPE)
    kw.setdefault("stdout", subprocess.PIPE)
    kw.setdefault("stderr", subprocess.PIPE)
    if os.name == "nt":
        kw.setdefault("creationflags", NO_WINDOW)
    return subprocess.Popen(args, **kw)


# --------------------------------------------------------------------------
# images -> raw bytes
# --------------------------------------------------------------------------
def image_to_rgb24(img: QImage) -> bytes:
    conv = img.convertToFormat(QImage.Format_RGB888)
    w, h, bpl = conv.width(), conv.height(), conv.bytesPerLine()
    if bpl == w * 3:
        return bytes(conv.constBits())
    if np is not None:
        arr = np.frombuffer(bytes(conv.constBits()), dtype=np.uint8).reshape(h, bpl)
        return arr[:, : w * 3].tobytes()
    out = bytearray()
    for y in range(h):
        line = conv.constScanLine(y)
        out += bytes(line)[: w * 3]
    return bytes(out)


def image_to_rgba(img: QImage) -> bytes:
    conv = img.convertToFormat(QImage.Format_RGBA8888)
    w, h, bpl = conv.width(), conv.height(), conv.bytesPerLine()
    if bpl == w * 4:
        return bytes(conv.constBits())
    if np is not None:
        arr = np.frombuffer(bytes(conv.constBits()), dtype=np.uint8).reshape(h, bpl)
        return arr[:, : w * 4].tobytes()
    out = bytearray()
    for y in range(h):
        out += bytes(conv.constScanLine(y))[: w * 4]
    return bytes(out)


# --------------------------------------------------------------------------
# audio decoding
# --------------------------------------------------------------------------
def decode_wav_native(path: str, rate: int = 22050) -> tuple:
    """Decode a PCM WAV without ffmpeg (used for lip sync / waveforms offline)."""
    import wave as _wave
    try:
        with _wave.open(path, "rb") as fh:
            channels = fh.getnchannels()
            width = fh.getsampwidth()
            src_rate = fh.getframerate()
            frames = fh.readframes(fh.getnframes())
    except Exception:
        return None
    if width not in (1, 2, 3, 4) or src_rate <= 0:
        return None
    if width == 1:
        raw = [(v - 128) / 128.0 for v in frames]
    elif width == 2:
        count = len(frames) // 2
        import array as _array
        arr = _array.array("h")
        arr.frombytes(frames[: count * 2])
        if sys.byteorder == "big":
            arr.byteswap()
        raw = [v / 32768.0 for v in arr]
    elif width == 3:
        raw = []
        for i in range(0, len(frames) - 2, 3):
            value = int.from_bytes(frames[i:i + 3], "little", signed=True)
            raw.append(value / 8388608.0)
    else:
        count = len(frames) // 4
        import array as _array
        arr = _array.array("i")
        arr.frombytes(frames[: count * 4])
        if sys.byteorder == "big":
            arr.byteswap()
        raw = [v / 2147483648.0 for v in arr]
    if channels > 1:
        mono = []
        for i in range(0, len(raw) - channels + 1, channels):
            mono.append(sum(raw[i:i + channels]) / channels)
        raw = mono
    if src_rate != rate and raw:
        step = src_rate / float(rate)
        count = max(1, int(len(raw) / step))
        resampled = []
        for i in range(count):
            pos = i * step
            idx = int(pos)
            frac = pos - idx
            a = raw[min(idx, len(raw) - 1)]
            b = raw[min(idx + 1, len(raw) - 1)]
            resampled.append(a + (b - a) * frac)
        raw = resampled
    if np is not None:
        return np.asarray(raw, dtype="float32"), rate
    return raw, rate


def decode_audio(path: str, rate: int = 22050) -> tuple[list[float], int]:
    """Decode an audio file to mono float samples.

    WAV files are decoded natively (so the app works without FFmpeg); anything
    else goes through the bundled static FFmpeg.
    """
    if os.path.isfile(path) and os.path.splitext(path)[1].lower() in (".wav", ".wave", ".aif",
                                                                     ".aiff"):
        native = decode_wav_native(path, rate)
        if native is not None and len(native[0]):
            return native
    ff = ffmpeg_path()
    if not ff or not os.path.isfile(path):
        return [], rate
    args = [ff, "-v", "error", "-i", path, "-f", "f32le", "-ac", "1", "-ar", str(rate), "-"]
    try:
        proc = _popen(args)
        raw, _err = proc.communicate(timeout=600)
    except Exception:
        return [], rate
    if np is not None and raw:
        arr = np.frombuffer(raw, dtype="<f4")
        return arr.astype("float32"), rate
    import struct
    n = len(raw) // 4
    return list(struct.unpack(f"<{n}f", raw[: n * 4])), rate


def audio_duration(path: str) -> float:
    if os.path.isfile(path) and os.path.splitext(path)[1].lower() in (".wav", ".wave", ".aif",
                                                                      ".aiff"):
        import wave as _wave
        try:
            with _wave.open(path, "rb") as fh:
                return fh.getnframes() / float(fh.getframerate() or 1)
        except Exception:
            pass
    ff = ffmpeg_path()
    if not ff or not os.path.isfile(path):
        return 0.0
    try:
        proc = _popen([ff, "-v", "error", "-i", path, "-f", "null", "-"])
        proc.communicate(timeout=120)
        err = proc.stderr.read().decode("utf8", "ignore") if proc.stderr else ""
    except Exception:
        err = ""
    return 0.0


def probe_duration(path: str) -> float:
    """Duration of a media file (native for WAV, ffmpeg banner otherwise)."""
    if os.path.isfile(path) and os.path.splitext(path)[1].lower() in (".wav", ".wave"):
        native = audio_duration(path)
        if native:
            return native
    ff = ffmpeg_path()
    if not ff or not os.path.isfile(path):
        return 0.0
    try:
        proc = _popen([ff, "-hide_banner", "-i", path])
        _out, err = proc.communicate(timeout=30)
        text = err.decode("utf8", "ignore")
    except Exception:
        return 0.0
    for line in text.splitlines():
        if "Duration:" in line:
            try:
                stamp = line.split("Duration:")[1].split(",")[0].strip()
                h, m, s = stamp.split(":")
                return int(h) * 3600 + int(m) * 60 + float(s)
            except Exception:
                continue
    return 0.0


def extract_video_frame(path: str, time_sec: float = 0.0) -> QImage:
    """Grab one frame from a video/GIF so it can be imported as artwork."""
    ff = ffmpeg_path()
    if not ff or not os.path.isfile(path):
        return QImage()
    args = [ff, "-v", "error", "-ss", f"{max(0.0, time_sec):.3f}", "-i", path,
            "-frames:v", "1", "-f", "image2pipe", "-vcodec", "png", "-"]
    try:
        proc = _popen(args)
        raw, _err = proc.communicate(timeout=60)
    except Exception:
        return QImage()
    img = QImage()
    img.loadFromData(raw)
    return img


# --------------------------------------------------------------------------
# video encoding
# --------------------------------------------------------------------------
@dataclass
class VideoSettings:
    width: int = 1920
    height: int = 1080
    fps: int = 24
    fmt: str = "mp4"                 # mp4 | webm | gif
    quality: int = 90                # 1..100 (maps to crf)
    audio_path: str | None = None
    transparent: bool = False
    bitrate_kbps: int = 0            # 0 = quality based

    @property
    def crf(self) -> int:
        q = max(1, min(100, self.quality))
        return int(round(34 - (q / 100.0) * 20))   # 90 -> crf 16, 50 -> crf 24


def encode_args(settings: VideoSettings, out_path: str,
                input_pix_fmt: str = "rgb24") -> list[str]:
    ff = ffmpeg_path()
    assert ff
    args = [ff, "-y", "-hide_banner", "-loglevel", "error",
            "-f", "rawvideo", "-pix_fmt", input_pix_fmt,
            "-s", f"{settings.width}x{settings.height}",
            "-r", str(settings.fps), "-i", "-"]
    if settings.audio_path and os.path.isfile(settings.audio_path):
        args += ["-i", settings.audio_path]
    if settings.fmt == "mp4":
        args += ["-c:v", "libx264", "-preset", "veryfast", "-crf", str(settings.crf),
                 "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-r", str(settings.fps)]
        if settings.audio_path:
            args += ["-c:a", "aac", "-b:a", "192k", "-shortest"]
    elif settings.fmt == "webm":
        pix = "yuva420p" if settings.transparent else "yuv420p"
        args += ["-c:v", "libvpx-vp9", "-crf", str(settings.crf), "-b:v", "0",
                 "-pix_fmt", pix, "-row-mt", "1", "-deadline", "good", "-cpu-used", "2"]
        if settings.audio_path:
            args += ["-c:a", "libopus", "-b:a", "160k", "-shortest"]
    elif settings.fmt == "gif":
        args += ["-vf", f"fps={settings.fps},split[a][b];[a]palettegen=max_colors=256[p];"
                        f"[b][p]paletteuse=dither=sierra2_4a", "-loop", "0"]
    args += [out_path]
    return args


class FrameWriter(QObject):
    """Streams rendered frames straight into ffmpeg (no temp files)."""

    failed = Signal(str)

    def __init__(self, settings: VideoSettings, path: str, parent=None):
        super().__init__(parent)
        self.settings = settings
        self.path = path
        self.proc: subprocess.Popen | None = None
        self.error = ""
        if not have_ffmpeg():
            raise RuntimeError("FFmpeg was not found - video export needs the bundled ffmpeg.")
        pix = "rgba" if (settings.transparent and settings.fmt == "webm") else "rgb24"
        self.pix = pix
        self.proc = _popen(encode_args(settings, path, pix))

    def write(self, img: QImage) -> bool:
        if self.proc is None or self.proc.stdin is None:
            return False
        if img.width() != self.settings.width or img.height() != self.settings.height:
            img = img.scaled(self.settings.width, self.settings.height, Qt.IgnoreAspectRatio, Qt.SmoothTransformation)
        data = image_to_rgba(img) if self.pix == "rgba" else image_to_rgb24(img)
        try:
            self.proc.stdin.write(data)
            return True
        except (BrokenPipeError, OSError) as exc:
            self.error = str(exc)
            return False

    def close(self) -> tuple[bool, str]:
        if self.proc is None:
            return False, "encoder was not started"
        try:
            if self.proc.stdin:
                self.proc.stdin.close()
                self.proc.stdin = None      # communicate() must not flush it twice
            _out, err = self.proc.communicate(timeout=1800)
        except Exception as exc:
            self.error = str(exc)
            return False, self.error
        if self.proc.returncode != 0:
            self.error = (err or b"").decode("utf8", "ignore")[-4000:]
            return False, self.error
        return True, ""

    def abort(self) -> None:
        if self.proc is not None:
            try:
                self.proc.kill()
            except Exception:
                pass


# --------------------------------------------------------------------------
# audio mixing for export
# --------------------------------------------------------------------------
def build_audio_mix(scene, project, fps: int, total_frames: int, out_path: str,
                    start_frame: int = 1) -> str | None:
    """Mix every audio track of the scene into a single wav for muxing."""
    tracks = [t for t in scene.audio_tracks if not t.muted and t.asset_id]
    if not tracks:
        return None
    solo = scene.has_solo()
    if solo:
        tracks = [t for t in tracks if t.solo]
    if not tracks:
        return None
    ff = ffmpeg_path()
    if not ff:
        return None
    inputs: list[str] = []
    filters: list[str] = []
    labels: list[str] = []
    for i, track in enumerate(tracks):
        asset = project.asset(track.asset_id)
        if asset is None or not asset.data:
            continue
        suffix = asset.ext or ".wav"
        tmp = os.path.join(tempfile.gettempdir(), f"mfs_audio_{track.uid}{suffix}")
        try:
            with open(tmp, "wb") as fh:
                fh.write(asset.data)
        except Exception:
            continue
        inputs += ["-i", tmp]
        idx = len(inputs) // 2 - 1
        delay_ms = int(round((track.start_frame - start_frame) / max(1, fps) * 1000.0))
        gains = [f"volume={max(0.0, track.volume / 100.0):.3f}"]
        if track.trim_start:
            gains.insert(0, f"atrim=start={track.trim_start:.3f},asetpts=PTS-STARTPTS")
        if track.fade_in > 0:
            gains.append(f"afade=t=in:st=0:d={track.fade_in / max(1, fps):.3f}")
        if track.fade_out > 0:
            total = max(0.05, track.frames(fps) / max(1, fps))
            gains.append(f"afade=t=out:st={max(0.0, total - track.fade_out / max(1, fps)):.3f}"
                         f":d={track.fade_out / max(1, fps):.3f}")
        filters.append(f"[{idx}:a]{','.join(gains)},adelay={max(0, delay_ms)}|{max(0, delay_ms)}"
                       f"[a{idx}]")
        labels.append(f"[a{idx}]")
    if not inputs:
        return None
    if len(labels) == 1:
        chain = f"{filters[0]};{labels[0]}anull[out]"
    else:
        chain = ";".join(filters) + ";" + "".join(labels) + \
            f"amix=inputs={len(labels)}:duration=longest:normalize=0[out]"
    args = [ff, "-y", "-hide_banner", "-loglevel", "error", *inputs,
            "-filter_complex", chain, "-map", "[out]",
            "-t", f"{total_frames / max(1, fps):.3f}", out_path]
    try:
        proc = _popen(args, stdin=subprocess.DEVNULL)
        _o, err = proc.communicate(timeout=900)
        if proc.returncode != 0:
            print("[mfs] audio mix failed:", (err or b"").decode("utf8", "ignore")[-800:])
            return None
    except Exception as exc:
        print("[mfs] audio mix error:", exc)
        return None
    return out_path


def find_ffmpeg_for_packaging() -> str | None:
    """Used by the packaging script to locate a static ffmpeg to bundle."""
    return ffmpeg_path()


_ = time
