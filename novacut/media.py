"""Local media probing, analysis, and small disk-backed cache helpers."""
from __future__ import annotations

import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import struct
import subprocess
import time
from typing import Callable

from .models import MediaAsset, media_kind_for_path
from .project import cache_dir


class MediaError(RuntimeError):
    pass


def find_ffmpeg(configured: str = "") -> str | None:
    candidates: list[str] = []
    if configured:
        candidates.append(configured)
    env_path = os.environ.get("NOVACUT_FFMPEG")
    if env_path:
        candidates.append(env_path)
    try:
        import sys
        root = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
        candidates.extend((str(root / "ffmpeg" / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")),
                          str(Path(sys.executable).parent / "ffmpeg" / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg"))))
    except Exception:
        pass
    for candidate in candidates:
        if Path(candidate).is_file():
            return str(Path(candidate).resolve())
    return shutil.which("ffmpeg")


def find_ffprobe(ffmpeg_path: str | None = None) -> str | None:
    if ffmpeg_path:
        sibling = Path(ffmpeg_path).with_name("ffprobe.exe" if os.name == "nt" else "ffprobe")
        if sibling.is_file():
            return str(sibling)
    configured = os.environ.get("NOVACUT_FFPROBE")
    if configured and Path(configured).is_file():
        return configured
    return shutil.which("ffprobe")


def ffmpeg_capabilities(ffmpeg_path: str | None = None) -> dict[str, set[str]]:
    binary = ffmpeg_path or find_ffmpeg()
    if not binary:
        return {"encoders": set(), "filters": set()}
    encoders: set[str] = set()
    filters: set[str] = set()
    try:
        result = subprocess.run([binary, "-hide_banner", "-encoders"], capture_output=True, text=True, timeout=12)
        for line in result.stdout.splitlines():
            match = re.search(r"^\s*[VAS\.][A-Z\.]{5}\s+([\w.-]+)", line)
            if match:
                encoders.add(match.group(1))
        result = subprocess.run([binary, "-hide_banner", "-filters"], capture_output=True, text=True, timeout=12)
        for line in result.stdout.splitlines():
            match = re.search(r"^\s*[TSC\.]{3}\s+([\w.-]+)", line)
            if match:
                filters.add(match.group(1))
    except (OSError, subprocess.TimeoutExpired):
        pass
    return {"encoders": encoders, "filters": filters}


def _fraction(value: str | None) -> float:
    if not value or value in {"N/A", "0/0"}:
        return 0.0
    try:
        if "/" in value:
            numerator, denominator = value.split("/", 1)
            denominator_value = float(denominator)
            return float(numerator) / denominator_value if denominator_value else 0.0
        return float(value)
    except (ValueError, ZeroDivisionError):
        return 0.0


def probe_media(path: str | Path, ffmpeg_path: str | None = None) -> MediaAsset:
    source = Path(path).expanduser().resolve()
    if not source.is_file():
        raise MediaError(f"File not found: {source}")
    kind = media_kind_for_path(source)
    if kind is None:
        raise MediaError(f"Unsupported media type: {source.suffix or source.name}")
    asset = MediaAsset(
        id="", path=str(source), name=source.name, kind=kind,
        file_size=source.stat().st_size,
    )
    if kind == "image":
        try:
            from PySide6.QtGui import QImageReader
            reader = QImageReader(str(source))
            size = reader.size()
            asset.width, asset.height = size.width(), size.height()
            asset.has_video = True
            if asset.width <= 0 or asset.height <= 0:
                asset.probe_error = reader.errorString() or "Image dimensions could not be read"
        except ImportError:
            asset.probe_error = "Image reader unavailable"
        return asset

    ffmpeg_path = ffmpeg_path or find_ffmpeg()
    ffprobe = find_ffprobe(ffmpeg_path)
    if ffprobe:
        try:
            result = subprocess.run(
                [ffprobe, "-v", "error", "-show_entries",
                 "format=duration:stream=codec_type,width,height,avg_frame_rate,r_frame_rate,duration,channels",
                 "-of", "json", str(source)],
                capture_output=True, text=True, timeout=25,
            )
            if result.returncode == 0:
                data = json.loads(result.stdout or "{}")
                streams = data.get("streams", [])
                video = next((s for s in streams if s.get("codec_type") == "video"), None)
                audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
                fmt = data.get("format", {})
                asset.duration = _number(fmt.get("duration"))
                if video:
                    asset.has_video = True
                    asset.width = int(video.get("width", 0) or 0)
                    asset.height = int(video.get("height", 0) or 0)
                    asset.fps = _fraction(video.get("avg_frame_rate") or video.get("r_frame_rate"))
                    if not asset.duration:
                        asset.duration = _number(video.get("duration"))
                if audio:
                    asset.has_audio = True
                    if not asset.duration:
                        asset.duration = _number(audio.get("duration"))
                if not asset.has_video and asset.has_audio:
                    asset.kind = "audio"
                if asset.duration > 0:
                    return asset
                asset.probe_error = "The media file has no readable duration"
                return asset
            asset.probe_error = result.stderr.strip()[-600:] or "FFprobe could not inspect this file"
        except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as exc:
            asset.probe_error = str(exc)

    # FFmpeg is also useful for probing when a separate ffprobe executable is absent.
    if ffmpeg_path:
        try:
            result = subprocess.run(
                [ffmpeg_path, "-hide_banner", "-i", str(source)],
                capture_output=True, text=True, timeout=25,
            )
            details = result.stderr
            duration_match = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", details)
            if duration_match:
                h, m, s = duration_match.groups()
                asset.duration = int(h) * 3600 + int(m) * 60 + float(s)
            video_match = re.search(r"Video:.*?(\d{2,5})x(\d{2,5}).*?(\d+(?:\.\d+)?)\s*(?:fps|tbr)", details, re.S)
            audio_match = re.search(r"Audio:", details)
            if video_match:
                asset.has_video = True
                asset.width, asset.height = int(video_match.group(1)), int(video_match.group(2))
                asset.fps = float(video_match.group(3))
            asset.has_audio = bool(audio_match)
            if not asset.has_video and asset.has_audio:
                asset.kind = "audio"
            if asset.duration > 0:
                asset.probe_error = ""
                return asset
            if details:
                asset.probe_error = details.strip()[-600:]
        except (OSError, subprocess.TimeoutExpired) as exc:
            asset.probe_error = str(exc)
    else:
        asset.probe_error = "FFmpeg/FFprobe not found; metadata and export are unavailable"
    return asset


def _number(value: object) -> float:
    try:
        result = float(value)
        return result if math.isfinite(result) and result > 0 else 0.0
    except (TypeError, ValueError):
        return 0.0


def _cache_key(path: Path) -> str:
    stat = path.stat()
    signature = f"{path.resolve()}|{stat.st_size}|{stat.st_mtime_ns}".encode("utf-8", "replace")
    return hashlib.sha256(signature).hexdigest()


def create_thumbnail(path: str | Path, kind: str, ffmpeg_path: str | None = None) -> str:
    source = Path(path).expanduser().resolve()
    if not source.is_file():
        return ""
    folder = cache_dir() / "thumbnails"
    folder.mkdir(parents=True, exist_ok=True)
    output = folder / f"{_cache_key(source)}.jpg"
    if output.exists():
        return str(output)
    if kind == "image":
        try:
            from PySide6.QtGui import QImageReader
            reader = QImageReader(str(source))
            reader.setAutoTransform(True)
            reader.setScaledSize(reader.size().scaled(320, 180, 1))
            image = reader.read()
            if not image.isNull() and image.save(str(output), "JPEG", 86):
                return str(output)
        except Exception:
            return ""
        return ""
    binary = ffmpeg_path or find_ffmpeg()
    if not binary:
        return ""
    try:
        result = subprocess.run(
            [binary, "-hide_banner", "-loglevel", "error", "-ss", "1", "-i", str(source),
             "-frames:v", "1", "-vf", "scale=320:180:force_original_aspect_ratio=decrease,pad=320:180:(ow-iw)/2:(oh-ih)/2:color=0x171b25", "-q:v", "3", "-y", str(output)],
            capture_output=True, timeout=20,
        )
        if result.returncode == 0 and output.is_file():
            return str(output)
    except (OSError, subprocess.TimeoutExpired):
        pass
    output.unlink(missing_ok=True)
    return ""


def generate_waveform(path: str | Path, duration: float, ffmpeg_path: str | None = None, buckets: int = 500) -> list[float]:
    source = Path(path).expanduser().resolve()
    if not source.is_file() or duration <= 0:
        return []
    folder = cache_dir() / "waveforms"
    folder.mkdir(parents=True, exist_ok=True)
    cache = folder / f"{_cache_key(source)}.json"
    if cache.exists():
        try:
            values = json.loads(cache.read_text(encoding="utf-8"))
            if isinstance(values, list):
                return [float(v) for v in values]
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            pass
    binary = ffmpeg_path or find_ffmpeg()
    if not binary:
        return []
    sample_rate = 4000
    buckets = min(2000, max(32, int(buckets)))
    samples_per_bucket = max(1.0, duration * sample_rate / buckets)
    peaks = [0] * buckets
    sample_index = 0
    try:
        process = subprocess.Popen(
            [binary, "-hide_banner", "-loglevel", "error", "-i", str(source), "-vn", "-ac", "1", "-ar", str(sample_rate), "-f", "s16le", "pipe:1"],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        assert process.stdout is not None
        while True:
            chunk = process.stdout.read(65536)
            if not chunk:
                break
            even_length = len(chunk) - (len(chunk) % 2)
            for (sample,) in struct.iter_unpack("<h", chunk[:even_length]):
                bucket = min(buckets - 1, int(sample_index / samples_per_bucket))
                peaks[bucket] = max(peaks[bucket], abs(sample))
                sample_index += 1
        _, error = process.communicate(timeout=4)
        if process.returncode != 0 or sample_index == 0:
            return []
        result = [round(value / 32768.0, 4) for value in peaks]
        cache.write_text(json.dumps(result), encoding="utf-8")
        return result
    except (OSError, subprocess.TimeoutExpired):
        try:
            process.kill()  # type: ignore[possibly-undefined]
        except Exception:
            pass
        return []


def create_proxy(
    path: str | Path,
    ffmpeg_path: str | None = None,
    duration: float = 0.0,
    progress: Callable[[int, str], None] | None = None,
    cancel_event=None,
    width: int = 1280,
) -> str:
    source = Path(path).expanduser().resolve()
    binary = ffmpeg_path or find_ffmpeg()
    if not binary:
        raise MediaError("FFmpeg is not installed. Proxy generation is unavailable.")
    if not source.is_file():
        raise MediaError(f"Media file not found: {source}")
    target_dir = cache_dir() / "proxies"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{_cache_key(source)}-{width}.mp4"
    if target.is_file() and target.stat().st_size > 1_000:
        if progress:
            progress(100, "Existing proxy is ready")
        return str(target)
    temp = target.with_name(target.stem + ".partial.mp4")
    command = [binary, "-hide_banner", "-y", "-loglevel", "warning", "-stats_period", "0.5",
               "-progress", "pipe:1", "-nostats", "-i", str(source), "-vf",
               f"scale={int(width)}:-2:force_original_aspect_ratio=decrease", "-c:v", "libx264",
               "-preset", "ultrafast", "-crf", "28", "-c:a", "aac", "-b:a", "96k",
               "-movflags", "+faststart", "-f", "mp4", str(temp)]
    try:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   text=True, errors="replace", bufsize=1)
    except OSError as exc:
        raise MediaError(f"Could not start FFmpeg: {exc}") from exc
    lines: list[str] = []
    try:
        while True:
            if cancel_event is not None and cancel_event.is_set():
                process.terminate()
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    process.kill()
                raise MediaError("Proxy generation cancelled")
            line = process.stdout.readline() if process.stdout else ""
            if line:
                stripped = line.strip()
                if "=" in stripped:
                    key, value = stripped.split("=", 1)
                    if key in {"out_time_ms", "out_time_us"} and duration > 0 and progress:
                        try:
                            percent = min(99, int((int(value) / 1_000_000) * 100 / duration))
                            progress(percent, f"Generating preview proxy · {percent}%")
                        except ValueError:
                            pass
                else:
                    lines.append(stripped)
                    lines[:] = lines[-20:]
            elif process.poll() is not None:
                break
            else:
                time.sleep(0.05)
        code = process.wait()
        if code != 0 or not temp.is_file() or temp.stat().st_size < 1_000:
            raise MediaError("FFmpeg proxy generation failed:\n" + "\n".join(lines[-12:]))
        temp.replace(target)
        if progress:
            progress(100, "Proxy ready · originals are still used for export")
        return str(target)
    except Exception:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
        temp.unlink(missing_ok=True)
        raise


def _run_analysis(command: list[str], cancel_event=None) -> str:
    try:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, errors="replace")
    except OSError as exc:
        raise MediaError(f"Could not start FFmpeg: {exc}") from exc
    start = time.monotonic()
    while True:
        if cancel_event is not None and cancel_event.is_set():
            process.terminate()
            try:
                stdout, stderr = process.communicate(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                stdout, stderr = process.communicate()
            raise MediaError("Analysis cancelled")
        try:
            stdout, stderr = process.communicate(timeout=0.25)
            break
        except subprocess.TimeoutExpired:
            if time.monotonic() - start > 60 * 60:
                process.kill()
                process.communicate()
                raise MediaError("Analysis timed out after one hour")
    details = f"{stdout or ''}\n{stderr or ''}"
    if process.returncode != 0:
        raise MediaError(details.strip()[-1200:] or "FFmpeg analysis failed")
    return details


def detect_silence(
    path: str | Path,
    ffmpeg_path: str | None = None,
    noise_db: float = -35.0,
    min_duration: float = 0.5,
    duration: float = 0.0,
    cancel_event=None,
) -> list[tuple[float, float]]:
    binary = ffmpeg_path or find_ffmpeg()
    if not binary:
        raise MediaError("FFmpeg is not installed. Silence analysis is unavailable.")
    if not -90 <= noise_db <= 0 or not 0.05 <= min_duration <= 120:
        raise MediaError("Silence threshold or minimum duration is outside the supported range")
    output = _run_analysis(
        [binary, "-hide_banner", "-nostats", "-i", str(Path(path).resolve()), "-vn", "-af",
         f"silencedetect=noise={noise_db:.2f}dB:d={min_duration:.3f}", "-f", "null", "-"], cancel_event,
    )
    starts = re.findall(r"silence_start:\s*(-?\d+(?:\.\d+)?)", output)
    ends = re.findall(r"silence_end:\s*(-?\d+(?:\.\d+)?)", output)
    intervals: list[tuple[float, float]] = []
    for index, start in enumerate(starts):
        left = max(0.0, float(start))
        right = float(ends[index]) if index < len(ends) else max(left, duration)
        if right > left:
            intervals.append((left, right))
    return intervals


def detect_scenes(
    path: str | Path,
    ffmpeg_path: str | None = None,
    threshold: float = 0.35,
    cancel_event=None,
) -> list[float]:
    binary = ffmpeg_path or find_ffmpeg()
    if not binary:
        raise MediaError("FFmpeg is not installed. Scene detection is unavailable.")
    if not 0.05 <= threshold <= 0.95:
        raise MediaError("Scene threshold must be between 0.05 and 0.95")
    output = _run_analysis(
        [binary, "-hide_banner", "-nostats", "-i", str(Path(path).resolve()), "-vf",
         f"select='gt(scene,{threshold:.3f})',showinfo", "-an", "-f", "null", "-"], cancel_event,
    )
    times = [float(value) for value in re.findall(r"pts_time:([0-9]+(?:\.[0-9]+)?)", output)]
    return sorted(set(times))


def format_media_info(asset: MediaAsset) -> str:
    if asset.probe_error:
        return f"Metadata issue: {asset.probe_error}"
    size_mb = asset.file_size / (1024 * 1024)
    if asset.kind == "image":
        return f"Image · {asset.width} × {asset.height} · {size_mb:.1f} MB"
    parts = [asset.kind.title(), f"{asset.duration:.2f} sec", f"{size_mb:.1f} MB"]
    if asset.width and asset.height:
        parts.append(f"{asset.width} × {asset.height}")
    if asset.fps:
        parts.append(f"{asset.fps:.2f} fps")
    return " · ".join(parts)
