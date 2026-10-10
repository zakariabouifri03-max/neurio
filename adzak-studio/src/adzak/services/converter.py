"""Media conversion, compression and utility operations (all real FFmpeg/Pillow).

Every public function performs the operation and returns the real output
path(s); failures raise with the underlying ffmpeg error text.
"""

from __future__ import annotations

import re
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from ..core.ffmpeg import find_ffmpeg, probe, run_ffmpeg
from ..core.logging_setup import get_logger
from .presets import AUDIO_PRESETS, IMAGE_FORMATS

log = get_logger("converter")

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".mpg", ".mpeg", ".wmv", ".ts", ".flv", ".3gp"}
AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".opus", ".flac", ".wma"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif", ".gif"}


class ConvertError(RuntimeError):
    pass


def _ffmpeg_or_raise() -> str:
    ff = find_ffmpeg()
    if not ff:
        raise ConvertError("FFmpeg not found. Install FFmpeg or set the path in Settings.")
    return ff


def _run(args: list[str]) -> subprocess.CompletedProcess:
    proc = run_ffmpeg(args, timeout=3600)
    if proc.returncode != 0:
        raise ConvertError(f"ffmpeg failed: {proc.stderr.strip()[-300:]}")
    return proc


# ---------------------------------------------------------------------------
# Video
# ---------------------------------------------------------------------------

def convert_video(src: str | Path, dest: str | Path, vcodec: str = "libx264",
                  acodec: str = "aac", crf: int = 20, preset: str = "veryfast",
                  scale: str | None = None, fps: float | None = None,
                  start: float | None = None, end: float | None = None) -> Path:
    """Convert / transcode a video file."""
    ff = _ffmpeg_or_raise()
    src, dest = Path(src), Path(dest)
    if not src.is_file():
        raise FileNotFoundError(src)
    dest.parent.mkdir(parents=True, exist_ok=True)
    args: list[str] = []
    if start is not None:
        args += ["-ss", f"{start:.3f}"]
    args += ["-i", str(src)]
    if end is not None:
        args += ["-to", f"{end:.3f}" if start is None else f"{end - start:.3f}"]
    vf = []
    if scale:
        vf.append(f"scale={scale}")
    if vf:
        args += ["-vf", ",".join(vf)]
    if fps:
        args += ["-r", f"{fps:g}"]
    if dest.suffix.lower() == ".gif":
        args += ["-c:v", "gif"]
    else:
        args += ["-c:v", vcodec, "-preset", preset, "-crf", str(crf),
                 "-pix_fmt", "yuv420p"]
        if src.suffix.lower() in AUDIO_EXTS or probe(src).audio_stream:
            args += ["-c:a", acodec, "-b:a", "160k"]
        else:
            args += ["-an"]
    args.append(str(dest))
    _run(args)
    return dest


def compress_video(src: str | Path, dest: str | Path,
                   target_mb: float | None = None, crf: int = 26) -> Path:
    """Compress a video, optionally aiming for a target size in MB.

    Target-size mode uses real two-pass x264 encoding; the pass-log files are
    written next to the output and removed afterwards.
    """
    src, dest = Path(src), Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    info = probe(src)
    if target_mb and info.duration > 0:
        total_kbps = target_mb * 8 * 1000 / info.duration
        v_kbps = max(200, int(total_kbps - 128))
        prefix = str(dest.with_suffix("")) 
        _run(["-i", str(src), "-c:v", "libx264", "-b:v", f"{v_kbps}k",
              "-pass", "1", "-passlogfile", prefix, "-an", "-f", "null",
              "-" if _is_windows_like() else "/dev/null"])
        try:
            _run(["-i", str(src), "-c:v", "libx264", "-b:v", f"{v_kbps}k",
                  "-pass", "2", "-passlogfile", prefix,
                  "-c:a", "aac", "-b:a", "128k", str(dest)])
        finally:
            for leftover in dest.parent.glob(dest.stem + "-0.log*"):
                leftover.unlink(missing_ok=True)
        return dest
    args = ["-i", str(src), "-c:v", "libx264", "-crf", str(crf),
            "-preset", "veryfast", "-c:a", "aac", "-b:a", "128k", str(dest)]
    _run(args)
    return dest


def _is_windows_like() -> bool:
    import sys
    return sys.platform.startswith("win")


def extract_audio(src: str | Path, dest: str | Path,
                  codec: str = "aac", container: str = "m4a") -> Path:
    ff = _ffmpeg_or_raise()
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    _run(["-i", str(src), "-vn", "-c:a", codec, str(dest)])
    return dest


def extract_frames(src: str | Path, out_dir: str | Path,
                   fps: float = 1.0, pattern: str = "frame_%04d.png") -> list[Path]:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    _run(["-i", str(src), "-vf", f"fps={fps:g}", str(out_dir / pattern)])
    return sorted(out_dir.glob(pattern.replace("%04d", "*").replace("%d", "*")))


def make_thumbnail(src: str | Path, dest: str | Path, at: float = 1.0,
                   width: int = 480) -> Path:
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    _run(["-ss", f"{max(at, 0):.3f}", "-i", str(src),
          "-frames:v", "1", "-vf", f"scale={width}:-1", str(dest)])
    return dest


def make_gif(src: str | Path, dest: str | Path, start: float = 0.0,
             duration: float = 5.0, width: int = 480, fps: int = 12) -> Path:
    """High-quality GIF via ffmpeg palette generation (two passes)."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    palette = dest.with_name(dest.stem + "_palette.png")
    vf = f"fps={fps},scale={width}:-1:flags=lanczos"
    _run(["-ss", f"{start:.2f}", "-t", f"{duration:.2f}", "-i", str(src),
          "-vf", f"{vf},palettegen=stats_mode=diff", str(palette)])
    _run(["-ss", f"{start:.2f}", "-t", f"{duration:.2f}", "-i", str(src),
          "-i", str(palette), "-lavfi", f"{vf}[x];[x][1:v]paletteuse=dither=bayer",
          str(dest)])
    palette.unlink(missing_ok=True)
    return dest


def estimate_video_size_mb(width: int, height: int, fps: float, duration_s: float,
                           crf: int = 23) -> float:
    bpp = 0.07 * (23.0 / max(crf, 1))
    return round(width * height * fps * bpp / 1000 * duration_s / 8 / 1000, 1)


# ---------------------------------------------------------------------------
# Audio
# ---------------------------------------------------------------------------

def convert_audio(src: str | Path, dest: str | Path, preset_id: str = "mp3-192") -> Path:
    ff = _ffmpeg_or_raise()
    preset = AUDIO_PRESETS.get(preset_id)
    if not preset:
        raise ConvertError(f"Unknown audio preset: {preset_id}")
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    args = ["-i", str(src), "-vn", "-c:a", preset.codec]
    if preset.bitrate_k:
        args += ["-b:a", f"{preset.bitrate_k}k"]
    args += ["-ar", str(preset.sample_rate), str(dest)]
    _run(args)
    return dest


def trim_audio(src: str | Path, dest: str | Path, start: float, end: float) -> Path:
    """Trim an audio file. Re-encodes (frame-accurate) rather than stream-copy,
    because stream copies of compressed audio can only cut at frame boundaries."""
    if end <= start:
        raise ConvertError("trim end must be after start")
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    codec_by_ext = {".wav": ["-c:a", "pcm_s16le"],
                    ".mp3": ["-c:a", "libmp3lame", "-b:a", "192k"],
                    ".m4a": ["-c:a", "aac", "-b:a", "192k"],
                    ".ogg": ["-c:a", "libopus", "-b:a", "160k"]}
    codec = codec_by_ext.get(dest.suffix.lower(), ["-c:a", "aac", "-b:a", "192k"])
    _run(["-i", str(src), "-ss", f"{start:.3f}", "-to", f"{end:.3f}",
          "-vn", *codec, str(dest)])
    return dest


def merge_audio(files: list[str | Path], dest: str | Path) -> Path:
    """Concatenate audio files with the concat demuxer."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    listfile = dest.with_name(dest.stem + "_concat.txt")
    listfile.write_text(
        "\n".join(f"file '{Path(f).as_posix()}'" for f in files), encoding="utf-8")
    try:
        _run(["-f", "concat", "-safe", "0", "-i", str(listfile),
              "-c:a", "aac", "-b:a", "192k", str(dest)])
    finally:
        listfile.unlink(missing_ok=True)
    return dest


# ---------------------------------------------------------------------------
# Images
# ---------------------------------------------------------------------------

def convert_image(src: str | Path, dest: str | Path,
                  quality: int = 90) -> Path:
    """Convert between image formats with Pillow (PNG/JPG/WebP/BMP/TIFF)."""
    from PIL import Image

    src, dest = Path(src), Path(dest)
    if not src.is_file():
        raise FileNotFoundError(src)
    dest.parent.mkdir(parents=True, exist_ok=True)
    fmt = dest.suffix.lower().lstrip(".")
    if fmt == "jpeg":
        fmt = "jpg"
    if fmt not in IMAGE_FORMATS:
        raise ConvertError(f"Unsupported target image format: .{fmt}")
    img = Image.open(src)
    if fmt in {"jpg", "bmp"} and img.mode in {"RGBA", "LA", "P"}:
        img = img.convert("RGB")
    save_kwargs: dict = {}
    if fmt == "jpg":
        save_kwargs = {"quality": int(quality), "optimize": True}
    elif fmt == "webp":
        save_kwargs = {"quality": int(quality), "method": 4}
    img.save(dest, **save_kwargs)
    return dest


def resize_image(src: str | Path, dest: str | Path, width: int,
                 height: int | None = None) -> Path:
    from PIL import Image

    src, dest = Path(src), Path(dest)
    with Image.open(src) as img:
        ratio = (height / img.height) if height else (width / img.width)
        new_h = height or max(1, round(img.height * ratio))
        out = img.resize((width, new_h), Image.LANCZOS)
        fmt = dest.suffix.lower().lstrip(".")
        if fmt in {"jpg", "jpeg", "bmp"} and out.mode in {"RGBA", "LA", "P"}:
            out = out.convert("RGB")
        out.save(dest, quality=90)
    return dest


def batch_convert_images(files: list[str | Path], out_dir: str | Path,
                         fmt: str = "png", quality: int = 90) -> list[Path]:
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    out: list[Path] = []
    for f in files:
        f = Path(f)
        out.append(convert_image(f, out_dir / (f.stem + "." + fmt), quality))
    return out


# ---------------------------------------------------------------------------
# Metadata
# ---------------------------------------------------------------------------

def video_metadata_report(path: str | Path) -> dict:
    info = probe(path)
    v = info.video_stream
    a = info.audio_stream
    return {
        "file": str(path),
        "size_mb": round(info.size_bytes / 1_048_576, 2),
        "duration_s": round(info.duration, 2),
        "container": info.format_name,
        "bitrate_kbps": (info.bitrate // 1000) if info.bitrate else None,
        "video": None if not v else {
            "codec": v.codec_name, "resolution": f"{v.width}x{v.height}",
            "fps": round(v.fps, 3) if v.fps else None,
        },
        "audio": None if not a else {
            "codec": a.codec_name, "sample_rate": a.sample_rate,
            "channels": a.channels,
        },
    }


def image_metadata_report(path: str | Path) -> dict:
    from PIL import Image, ExifTags

    p = Path(path)
    with Image.open(p) as img:
        report = {
            "file": str(p),
            "format": img.format,
            "mode": img.mode,
            "width": img.width,
            "height": img.height,
            "size_kb": round(p.stat().st_size / 1024, 1),
        }
        exif = img.getexif()
        if exif:
            named = {}
            for tag_id, value in list(exif.items())[:12]:
                tag = ExifTags.TAGS.get(tag_id, str(tag_id))
                try:
                    named[tag] = str(value)[:64]
                except Exception:
                    continue
            report["exif"] = named
        return report


# ---------------------------------------------------------------------------
# Batch rename
# ---------------------------------------------------------------------------

def batch_rename(files: list[str | Path], pattern: str = "{name}_{index:03d}{ext}",
                 start_index: int = 1, dry_run: bool = False) -> list[tuple[Path, Path]]:
    """Rename files using a pattern. Supported tokens: {name} {index} {ext} {date}.

    Returns a list of (old, new) pairs. With ``dry_run`` nothing is touched.
    """
    results: list[tuple[Path, Path]] = []
    used = set()
    for i, f in enumerate(files):
        f = Path(f)
        if not f.is_file():
            continue
        new_name = pattern.format(name=f.stem, index=start_index + i,
                                  ext=f.suffix,
                                  date=__import__("time").strftime("%Y%m%d"))
        new_name = re.sub(r'[<>:"/\\|?*]', "_", new_name)
        dest = f.with_name(new_name)
        n = 1
        while dest in used or (dest.exists() and dest != f):
            dest = f.with_name(f"{dest.stem}_{n}{dest.suffix}")
            n += 1
        used.add(dest)
        results.append((f, dest))
        if not dry_run and dest != f:
            f.rename(dest)
    return results
