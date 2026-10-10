"""Media converter, compressor, batch tools, GIF maker, frame/thumbnail extraction and metadata."""
from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from PIL import Image, ExifTags

from ..core import ffmpeg
from ..core.errors import AppError
from ..core.fileio import human_size

IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".gif"}
VIDEO_EXT = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"}
AUDIO_EXT = {".mp3", ".wav", ".aac", ".m4a", ".flac", ".ogg", ".opus"}

VIDEO_OUT = {".mp4": ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "160k"],
             ".mkv": ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "160k"],
             ".mov": ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "160k"],
             ".webm": ["-c:v", "libvpx-vp9", "-crf", "34", "-b:v", "0", "-c:a", "libopus", "-b:a", "128k"]}

def _ensure_ext(src: Path, allowed: set[str]) -> None:
    if src.suffix.lower() not in allowed:
        raise AppError(f"Unsupported input format: {src.suffix or 'no extension'}")
    if not src.is_file():
        raise AppError(f"File not found: {src.name}")


def convert_video(src: str, dst: str) -> Path:
    s, d = Path(src), Path(dst)
    _ensure_ext(s, VIDEO_EXT)
    if d.suffix.lower() not in VIDEO_OUT:
        raise AppError("Video output must be .mp4, .mkv, .mov or .webm.")
    ffmpeg.run(["-i", src, *VIDEO_OUT[d.suffix.lower()], "-movflags", "+faststart", str(d)]
               if d.suffix.lower() != ".webm" else ["-i", src, *VIDEO_OUT[".webm"], str(d)], timeout=7200)
    return d


def compress_video(src: str, dst: str, crf: int = 28, max_height: Optional[int] = None) -> tuple[Path, int, int]:
    """Re-encode smaller. Returns (output, input bytes, output bytes)."""
    s, d = Path(src), Path(dst)
    _ensure_ext(s, VIDEO_EXT)
    if not 18 <= crf <= 40:
        raise AppError("CRF must be between 18 (best quality) and 40 (smallest).")
    args = ["-i", src, "-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf), "-c:a", "aac", "-b:a", "128k"]
    if max_height:
        args += ["-vf", f"scale=-2:'min({int(max_height)},ih)'"]
    ffmpeg.run([*args, "-movflags", "+faststart", str(d)], timeout=7200)
    return d, s.stat().st_size, d.stat().st_size


def convert_audio(src: str, dst: str) -> Path:
    from ..audio.tools import AUDIO_FORMATS, _check_out

    s = Path(src)
    _ensure_ext(s, AUDIO_EXT | VIDEO_EXT)
    out = _check_out(dst)
    ffmpeg.run(["-i", src, "-vn", *AUDIO_FORMATS[out.suffix.lower()], str(out)], timeout=7200)
    return out


def convert_image(src: str, dst: str, quality: int = 90, background: str = "#FFFFFF") -> Path:
    s, d = Path(src), Path(dst)
    _ensure_ext(s, IMAGE_EXT)
    from ..image.document import EXPORT_FORMATS, export_image, Document

    ext = d.suffix.lower().lstrip(".")
    if ext not in EXPORT_FORMATS or ext == "pdf":
        raise AppError("Image output must be PNG, JPG, WebP, BMP or TIFF.")
    im = _load(s)
    doc = Document(im.width, im.height)
    doc.layers[0].image = im.convert("RGBA")
    return export_image(doc, d, quality=quality, background=background)


def _load(path: Path) -> Image.Image:
    try:
        im = Image.open(path)
        im.load()
        return im
    except Exception as exc:  # noqa: BLE001
        raise AppError(f"Could not read image: {path.name}", details=str(exc)) from exc


def compress_image(src: str, dst: str, quality: int = 75, max_side: Optional[int] = None) -> tuple[Path, int, int]:
    s, d = Path(src), Path(dst)
    _ensure_ext(s, IMAGE_EXT)
    if d.suffix.lower() not in (".jpg", ".jpeg", ".webp", ".png"):
        raise AppError("Compressed images must be saved as JPG, WebP or PNG.")
    if not 1 <= quality <= 100:
        raise AppError("Quality must be between 1 and 100.")
    im = _load(s)
    if max_side:
        im.thumbnail((max_side, max_side), Image.LANCZOS)
    fmt = {".jpg": "JPEG", ".jpeg": "JPEG", ".webp": "WEBP", ".png": "PNG"}[d.suffix.lower()]
    if fmt == "JPEG" and im.mode not in ("RGB", "L"):
        bg = Image.new("RGB", im.size, (255, 255, 255))
        rgba = im.convert("RGBA")
        bg.paste(rgba, mask=rgba.getchannel("A"))
        im = bg
    kwargs = {"quality": quality, "optimize": True} if fmt != "PNG" else {"optimize": True}
    if fmt == "PNG":
        im = im.quantize(colors=max(2, min(256, quality * 2 + 16)))  # palette PNG shrinks well
    im.save(d, fmt, **kwargs)
    return d, s.stat().st_size, d.stat().st_size


def batch_resize(files: list[str], out_dir: str, max_width: int, max_height: int) -> list[Path]:
    if max_width < 1 or max_height < 1:
        raise AppError("Maximum width and height must be at least 1 pixel.")
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    results = []
    for f in files:
        p = Path(f)
        _ensure_ext(p, IMAGE_EXT)
        im = _load(p)
        im.thumbnail((max_width, max_height), Image.LANCZOS)
        target = out / p.name
        if target.resolve() == p.resolve():
            raise AppError("Choose a different output folder so the originals are not overwritten.")
        im.save(target, quality=92) if target.suffix.lower() in (".jpg", ".jpeg") else im.save(target)
        results.append(target)
    return results


def plan_rename(files: list[str], pattern: str, start: int = 1) -> list[tuple[Path, Path]]:
    """Return (old, new) pairs. Tokens: {n} counter, {n:03d} padded counter, {name} original stem."""
    if "{n" not in pattern and "{name}" not in pattern:
        raise AppError("The pattern must contain {n} or {name}.")
    pairs = []
    for i, f in enumerate(files):
        p = Path(f)
        try:
            new_stem = pattern.format(n=start + i, name=p.stem)
        except (KeyError, IndexError, ValueError) as exc:
            raise AppError("The rename pattern is invalid. Example: photo_{n:03d}", details=str(exc)) from exc
        new_stem = re.sub(r'[<>:"/\\|?*]', "_", new_stem).strip()
        if not new_stem:
            raise AppError("The rename pattern produced an empty name.")
        pairs.append((p, p.with_name(new_stem + p.suffix.lower())))
    targets = [str(n).lower() for _, n in pairs]
    if len(set(targets)) != len(targets):
        raise AppError("The pattern would create duplicate file names.")
    return pairs


def apply_rename(pairs: list[tuple[Path, Path]]) -> int:
    existing = {p.name for p, _ in pairs}
    for _, new in pairs:
        if new.exists() and new.name not in existing:
            raise AppError(f"A file named {new.name} already exists. Nothing was renamed.")
    temp = [(old, old.with_name(f".adz-tmp-{i}{old.suffix}")) for i, (old, _) in enumerate(pairs)]
    for old, tmp in temp:  # two-phase rename avoids collisions
        if old != tmp:
            os.rename(old, tmp)
    for (_, tmp), (_, new) in zip(temp, pairs):
        os.rename(tmp, new)
    return len(pairs)


def extract_frames(video: str, out_dir: str, fps: float = 1.0, max_frames: int = 500) -> list[Path]:
    s = Path(video)
    _ensure_ext(s, VIDEO_EXT | {".gif"})
    if not 0.01 <= fps <= 60:
        raise AppError("Frames per second must be between 0.01 and 60.")
    info = ffmpeg.probe(video)
    if info.duration and info.duration * fps > max_frames:
        raise AppError(f"That would extract more than {max_frames} frames. Lower the frame rate.")
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    ffmpeg.run(["-i", video, "-vf", f"fps={fps}", "-frames:v", str(max_frames), str(out / f"{s.stem}_%05d.png")],
               timeout=3600)
    return sorted(out.glob(f"{s.stem}_*.png"))


def extract_thumbnail(video: str, dst: str, at_seconds: float = 1.0, width: int = 1280) -> Path:
    s = Path(video)
    _ensure_ext(s, VIDEO_EXT)
    if at_seconds < 0:
        raise AppError("Time must not be negative.")
    d = Path(dst)
    if d.suffix.lower() not in (".png", ".jpg", ".jpeg"):
        raise AppError("Thumbnails must be saved as PNG or JPG.")
    ffmpeg.run(["-ss", f"{at_seconds:.3f}", "-i", video, "-frames:v", "1", "-vf", f"scale={int(width)}:-2", str(d)],
               timeout=300)
    return d


def make_gif(video: str, dst: str, *, fps: int = 12, width: int = 480, start: float = 0.0,
             duration: float = 5.0) -> Path:
    s, d = Path(video), Path(dst)
    _ensure_ext(s, VIDEO_EXT)
    if d.suffix.lower() != ".gif":
        raise AppError("GIF output must end in .gif")
    if not 1 <= fps <= 30 or not 1 <= duration <= 30 or not 32 <= width <= 1920:
        raise AppError("GIF settings are out of range (fps 1–30, width 32–1920, duration 1–30 s).")
    flt = f"fps={fps},scale={width}:-1:flags=lanczos"
    ffmpeg.run(["-ss", f"{start:.3f}", "-t", f"{duration:.3f}", "-i", video, "-filter_complex",
                f"[0:v]{flt},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer",
                "-loop", "0", str(d)], timeout=1800)
    return d


def gif_from_images(images: list[str], dst: str, frame_ms: int = 500) -> Path:
    if len(images) < 2:
        raise AppError("Choose at least two images for an animated GIF.")
    if not 20 <= frame_ms <= 10000:
        raise AppError("Frame duration must be between 20 and 10000 ms.")
    frames = []
    base = None
    for f in images:
        im = _load(Path(f)).convert("RGBA")
        if base is None:
            base = im.size
        im = im.resize(base, Image.LANCZOS).convert("P", palette=Image.ADAPTIVE)
        frames.append(im)
    d = Path(dst)
    frames[0].save(d, save_all=True, append_images=frames[1:], duration=frame_ms, loop=0, optimize=True)
    return d


@dataclass
class Metadata:
    kind: str
    lines: list[tuple[str, str]]


def metadata(path: str) -> Metadata:
    p = Path(path)
    if not p.is_file():
        raise AppError(f"File not found: {p.name}")
    ext = p.suffix.lower()
    rows: list[tuple[str, str]] = [("File", p.name), ("Size", human_size(p.stat().st_size))]
    if ext in IMAGE_EXT:
        im = _load(p)
        rows += [("Format", im.format or ext), ("Dimensions", f"{im.width} × {im.height}"),
                 ("Mode", im.mode)]
        try:
            exif = im.getexif()
            names = {v: k for k, v in ExifTags.TAGS.items()}
            for tag in ("Make", "Model", "DateTime", "Software"):
                if tag in names and names[tag] in exif:
                    rows.append((tag, str(exif[names[tag]])))
        except Exception:  # noqa: BLE001 - EXIF is optional
            pass
        return Metadata("image", rows)
    info = ffmpeg.probe(path)
    rows += [("Container", info.container), ("Duration", f"{info.duration:.2f} s"),
             ("Bitrate", f"{info.bitrate_kbps:.0f} kb/s")]
    if info.has_video:
        rows += [("Video codec", info.video_codec), ("Resolution", f"{info.width} × {info.height}"),
                 ("Frame rate", f"{info.fps:.2f} fps")]
    if info.has_audio:
        rows += [("Audio codec", info.audio_codec), ("Sample rate", f"{info.sample_rate} Hz"),
                 ("Channels", info.channels)]
    return Metadata("video" if info.has_video else "audio", rows)


def estimate_size(duration_s: float, video_kbps: float = 0.0, audio_kbps: float = 128.0) -> int:
    """Estimated output bytes for a stream of the given bitrates (bitrate × duration)."""
    if duration_s < 0 or video_kbps < 0 or audio_kbps < 0:
        raise AppError("Duration and bitrates must be positive.")
    return int((video_kbps + audio_kbps) * 1000 / 8 * duration_s)


def estimate_image_size(width: int, height: int, fmt: str, quality: int = 85) -> int:
    """Rough estimate for planning only: raw RGB size scaled by a format-specific ratio."""
    ratio = {"png": 0.6, "jpg": 0.08 + 0.9 * (quality / 100) ** 3 * 0.12, "webp": 0.05, "bmp": 1.0}.get(fmt, 0.5)
    return int(width * height * 3 * ratio)
