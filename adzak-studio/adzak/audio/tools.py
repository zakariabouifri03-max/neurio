"""Audio editing through FFmpeg: waveform peaks, trim, merge, normalise, denoise, EQ, extraction."""
from __future__ import annotations

from pathlib import Path
from typing import Optional

import numpy as np

from ..core import ffmpeg
from ..core.errors import AppError

# output extension -> (codec args)
AUDIO_FORMATS = {
    ".wav": ["-c:a", "pcm_s16le"],
    ".mp3": ["-c:a", "libmp3lame", "-q:a", "2"],
    ".m4a": ["-c:a", "aac", "-b:a", "192k"],
    ".aac": ["-c:a", "aac", "-b:a", "192k"],
    ".flac": ["-c:a", "flac"],
    ".ogg": ["-c:a", "libvorbis", "-q:a", "5"],
    ".opus": ["-c:a", "libopus", "-b:a", "128k"],
}


def _check_out(path: str | Path) -> Path:
    out = Path(path)
    if out.suffix.lower() not in AUDIO_FORMATS:
        raise AppError("Choose an output format: " + ", ".join(AUDIO_FORMATS))
    return out


def waveform_peaks(path: str | Path, bins: int = 800) -> np.ndarray:
    """Return `bins` peak amplitudes in 0..1 by decoding mono 2 kHz audio (low memory)."""
    if bins < 10 or bins > 10000:
        raise ValueError("Waveform resolution must be 10..10000 bins.")
    proc = ffmpeg.run_quiet(["-i", str(path), "-vn", "-ac", "1", "-ar", "2000", "-f", "s16le", "-"], timeout=900)
    samples = np.frombuffer(proc.stdout, dtype=np.int16).astype(np.float32) / 32768.0
    if samples.size == 0:
        raise AppError("This file has no decodable audio.")
    idx = np.linspace(0, samples.size, bins + 1).astype(np.int64)
    peaks = np.array([np.abs(samples[a:b]).max() if b > a else 0.0 for a, b in zip(idx[:-1], idx[1:])])
    return np.clip(peaks, 0, 1)


def trim(src: str, dst: str, start: float, end: Optional[float] = None) -> Path:
    if start < 0 or (end is not None and end <= start):
        raise AppError("Trim end must be after the trim start.")
    out = _check_out(dst)
    args = ["-ss", f"{start:.3f}"]
    if end is not None:
        args += ["-to", f"{end:.3f}"]
    ffmpeg.run([*args, "-i", src, "-vn", *AUDIO_FORMATS[out.suffix.lower()], str(out)], timeout=900)
    return out


def merge(srcs: list[str], dst: str) -> Path:
    if len(srcs) < 2:
        raise AppError("Choose at least two audio files to merge.")
    out = _check_out(dst)
    args: list[str] = []
    for s in srcs:
        args += ["-i", s]
    fg = "".join(f"[{i}:a]" for i in range(len(srcs))) + f"concat=n={len(srcs)}:v=0:a=1[a]"
    ffmpeg.run([*args, "-filter_complex", fg, "-map", "[a]", *AUDIO_FORMATS[out.suffix.lower()], str(out)],
               timeout=1800)
    return out


def process(src: str, dst: str, *, normalize_lufs: Optional[float] = None, denoise: int = 0,
            bass_db: float = 0.0, treble_db: float = 0.0, volume_db: float = 0.0,
            fade_in: float = 0.0, fade_out: float = 0.0, duration: Optional[float] = None) -> Path:
    """Chain of effects applied in one FFmpeg pass."""
    out = _check_out(dst)
    filters: list[str] = []
    if denoise:
        if not 0 <= denoise <= 97:
            raise AppError("Noise reduction must be between 0 and 97 dB.")
        filters.append(f"afftdn=nr={denoise}")
    if bass_db or treble_db:
        if not (-20 <= bass_db <= 20 and -20 <= treble_db <= 20):
            raise AppError("EQ gain must be between -20 and +20 dB.")
        if bass_db:
            filters.append(f"bass=g={bass_db}")
        if treble_db:
            filters.append(f"treble=g={treble_db}")
    if volume_db:
        filters.append(f"volume={volume_db}dB")
    if normalize_lufs is not None:
        if not -40 <= normalize_lufs <= -5:
            raise AppError("Target loudness must be between -40 and -5 LUFS.")
        filters.append(f"loudnorm=I={normalize_lufs}:TP=-1.5:LRA=11")
    if fade_in > 0:
        filters.append(f"afade=t=in:st=0:d={fade_in}")
    if fade_out > 0:
        if duration is None:
            raise AppError("A fade-out needs the audio duration.")
        filters.append(f"afade=t=out:st={max(0.0, duration - fade_out):.3f}:d={fade_out}")
    args = ["-i", src, "-vn"]
    if filters:
        args += ["-af", ",".join(filters)]
    args += [*AUDIO_FORMATS[out.suffix.lower()], str(out)]
    ffmpeg.run(args, timeout=1800)
    return out


def extract_audio(video: str, dst: str) -> Path:
    info = ffmpeg.probe(video)
    if not info.has_audio:
        raise AppError("This video has no audio track to extract.")
    out = _check_out(dst)
    ffmpeg.run(["-i", video, "-vn", *AUDIO_FORMATS[out.suffix.lower()], str(out)], timeout=1800)
    return out
