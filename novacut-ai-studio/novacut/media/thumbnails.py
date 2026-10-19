"""Thumbnail and waveform generation with on-disk caching (SQLite indexed)."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Optional

import numpy as np

from ..core import paths
from ..core.constants import THUMB_WIDTH, THUMB_HEIGHT, WAVEFORM_BINS
from ..core.ffmpeg import find_ffmpeg, run_simple
from ..core.logging_setup import get_logger
from . import cache

log = get_logger("thumbnails")


def _ffmpeg() -> Path:
    exe = find_ffmpeg()
    if exe is None:
        raise RuntimeError("FFmpeg is required for thumbnail generation.")
    return exe


# ------------------------------------------------------------------ thumbnails
def thumbnail(source: str, time_s: float = 0.0,
              file_hash: str = "", width: int = THUMB_WIDTH,
              height: int = THUMB_HEIGHT) -> Optional[str]:
    """Single-frame JPEG thumbnail, cached by source hash + time."""
    source = str(source)
    key = file_hash or Path(source).stem
    params = f"{width}x{height}@{time_s:.3f}"
    cached = cache.get_asset(key, "thumb", params)
    if cached:
        return cached
    out = paths.THUMB_DIR / f"{key}_t{int(time_s * 1000):08d}.jpg"
    cmd = [
        str(_ffmpeg()), "-y", "-hide_banner", "-loglevel", "error",
        "-ss", f"{max(0.0, time_s):.3f}", "-i", source,
        "-frames:v", "1", "-vf",
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:color=black",
        str(out),
    ]
    res = run_simple(cmd, timeout_s=60)
    if not res.ok or not out.exists():
        log.warning("Thumbnail failed for %s: %s", source, res.stderr[-300:])
        return None
    cache.store_asset(key, "thumb", str(out), params)
    return str(out)


def thumbnail_strip(source: str, duration: float, count: int,
                    file_hash: str = "",
                    progress=None, should_cancel=None) -> list[str]:
    """Generate *count* evenly spaced thumbnails used by the timeline."""
    if duration <= 0:
        single = thumbnail(source, 0.0, file_hash)
        return [single] if single else []
    results: list[str] = []
    for i in range(count):
        if should_cancel and should_cancel():
            return results
        t = min(duration - 0.05, duration * (i + 0.5) / count)
        thumb = thumbnail(source, max(0.0, t), file_hash)
        if thumb:
            results.append(thumb)
        if progress:
            progress((i + 1) / count, "Generating thumbnails")
    return results


# ------------------------------------------------------------------- waveforms
def waveform(source: str, file_hash: str = "", bins: int = WAVEFORM_BINS,
             should_cancel=None) -> Optional[np.ndarray]:
    """Decode mono PCM and reduce it to a normalised RMS envelope (0..1)."""
    key = file_hash or Path(source).stem
    cached = cache.get_asset(key, "waveform", str(bins))
    if cached:
        try:
            return np.load(cached)
        except OSError:
            pass
    cmd = [
        str(_ffmpeg()), "-hide_banner", "-loglevel", "error",
        "-i", str(source), "-ac", "1", "-ar", "16000",
        "-f", "s16le", "-",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    raw, _ = proc.communicate()
    if proc.returncode != 0 or not raw:
        return None
    samples = np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0
    if samples.size == 0:
        return None
    trimmed = samples[: samples.size - samples.size % bins] if bins else samples
    chunks = trimmed.reshape(bins, -1) if bins and trimmed.size else samples.reshape(1, -1)
    env = np.sqrt(np.mean(chunks ** 2, axis=1))
    peak = float(env.max()) or 1.0
    env = np.clip(env / peak, 0.0, 1.0)
    out = paths.WAVE_DIR / f"{key}_wave_{bins}.npy"
    np.save(out, env)
    cache.store_asset(key, "waveform", str(out), str(bins))
    return env


def waveform_peak_db(source: str) -> float:
    """Mean volume in dB used by silence detection diagnostics."""
    env = waveform(str(source), bins=256)
    if env is None or env.size == 0:
        return -96.0
    rms = float(np.sqrt(np.mean(env ** 2)))
    return 20.0 * np.log10(max(rms, 1e-6))
