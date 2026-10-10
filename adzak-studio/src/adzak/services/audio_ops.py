"""Audio analysis and processing on top of FFmpeg.

Waveform data is produced by decoding to raw PCM with ffmpeg and reducing it
to peak buckets — cheap enough for long files.  Silence detection parses
ffmpeg's ``silencedetect`` filter output.
"""

from __future__ import annotations

import re
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..core.ffmpeg import find_ffmpeg, probe, run_ffmpeg
from ..core.logging_setup import get_logger
from .converter import ConvertError, _run

log = get_logger("audio_ops")


class AudioError(RuntimeError):
    pass


# ---------------------------------------------------------------------------
# Decoding / waveform
# ---------------------------------------------------------------------------

def decode_pcm(path: str | Path, sample_rate: int = 44100,
               mono: bool = True) -> np.ndarray:
    """Decode an audio (or video's audio) stream to float32 PCM [-1, 1]."""
    ff = find_ffmpeg()
    if not ff:
        raise AudioError("FFmpeg not found")
    channels = 1 if mono else 2
    cmd = [ff, "-hide_banner", "-i", str(path), "-vn",
           "-ac", str(channels), "-ar", str(sample_rate),
           "-f", "f32le", "-"]
    proc = subprocess.run(cmd, capture_output=True, timeout=600)
    if proc.returncode != 0:
        raise AudioError(f"decode failed: {proc.stderr.decode(errors='ignore')[-200:]}")
    arr = np.frombuffer(proc.stdout, dtype=np.float32)
    if not mono and arr.size:
        arr = arr.reshape(-1, 2)
    return arr


def waveform_peaks(path: str | Path, buckets: int = 600,
                   sample_rate: int = 44100) -> tuple[np.ndarray, float]:
    """Return (peaks array in [-1,1], duration_seconds)."""
    pcm = decode_pcm(path, sample_rate=sample_rate, mono=True)
    if pcm.size == 0:
        return np.zeros(buckets, dtype=np.float32), 0.0
    duration = pcm.size / sample_rate
    buckets = max(8, min(buckets, pcm.size // 4 or 8))
    chunk = pcm.size // buckets
    trimmed = pcm[: chunk * buckets].reshape(buckets, chunk)
    hi = trimmed.max(axis=1)
    lo = trimmed.min(axis=1)
    peaks = np.maximum(np.abs(hi), np.abs(lo))
    return peaks.astype(np.float32), duration


# ---------------------------------------------------------------------------
# Effects
# ---------------------------------------------------------------------------

def normalize(src: str | Path, dest: str | Path, target_peak_db: float = -1.0) -> Path:
    """Two-step loudness normalisation: volumedetect → volume filter."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    det = run_ffmpeg(["-i", str(src), "-af", "volumedetect", "-f", "null",
                      "-"] , timeout=600)
    m = re.search(r"max_volume:\s*(-?[\d.]+) dB", det.stderr)
    if not m:
        raise AudioError("could not detect volume")
    current = float(m[1])
    gain = target_peak_db - current
    _run(["-i", str(src), "-af", f"volume={gain:+.2f}dB", str(dest)])
    return dest


def fade(src: str | Path, dest: str | Path, fade_in: float = 0.0,
         fade_out: float = 1.0, duration: float | None = None) -> Path:
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    if duration is None:
        duration = probe(src).duration
    filters = []
    if fade_in > 0:
        filters.append(f"afade=t=in:st=0:d={fade_in:.2f}")
    if fade_out > 0:
        st = max(0.0, duration - fade_out)
        filters.append(f"afade=t=out:st={st:.2f}:d={fade_out:.2f}")
    if not filters:
        raise AudioError("nothing to fade")
    _run(["-i", str(src), "-af", ",".join(filters), str(dest)])
    return dest


def equalize(src: str | Path, dest: str | Path,
             bands: dict[str, float]) -> Path:
    """Apply EQ bands, e.g. {'60': +3, '1k': -2}. Uses ffmpeg `equalizer`."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    chain = ",".join(
        f"equalizer=f={freq}:t=q:w=1:g={gain:+.2f}" for freq, gain in bands.items()
    )
    _run(["-i", str(src), "-af", chain, str(dest)])
    return dest


@dataclass
class SilenceSpan:
    start: float
    end: float

    @property
    def length(self) -> float:
        return self.end - self.start


def detect_silence(src: str | Path, threshold_db: float = -35.0,
                   min_duration: float = 0.6) -> list[SilenceSpan]:
    proc = run_ffmpeg(["-i", str(src), "-af",
                       f"silencedetect=noise={threshold_db}dB:d={min_duration}",
                       "-f", "null", "-"], timeout=600)
    text = proc.stderr
    starts = [float(m[1]) for m in re.finditer(r"silence_start:\s*(-?[\d.]+)", text)]
    ends = [float(m[1]) for m in re.finditer(r"silence_end:\s*(-?[\d.]+)", text)]
    spans: list[SilenceSpan] = []
    for i, s in enumerate(starts):
        e = ends[i] if i < len(ends) else s + min_duration
        spans.append(SilenceSpan(s, e))
    return spans


def remove_silence(src: str | Path, dest: str | Path,
                   threshold_db: float = -35.0, min_duration: float = 0.6,
                   keep_padding: float = 0.12) -> Path:
    """Cut silent spans out of a file by selecting and concatenating loud parts."""
    info = probe(src)
    spans = detect_silence(src, threshold_db, min_duration)
    if not spans:
        raise AudioError("no silence detected — nothing to remove")
    keep: list[tuple[float, float]] = []
    cursor = 0.0
    for sp in spans:
        s = max(cursor, sp.start - keep_padding)
        e = min(info.duration, sp.end + keep_padding)
        if s > cursor + 0.05:
            keep.append((cursor, s))
        cursor = e
    if cursor < info.duration - 0.05:
        keep.append((cursor, info.duration))
    if not keep:
        raise AudioError("entire file is silence")
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    parts = []
    try:
        for i, (s, e) in enumerate(keep):
            part = dest.with_name(f"{dest.stem}_part{i}.wav")
            _run(["-i", str(src), "-ss", f"{s:.3f}", "-to", f"{e:.3f}",
                  "-c:a", "pcm_s16le", str(part)])
            parts.append(part)
        if len(parts) == 1:
            parts[0].replace(dest)
        else:
            listfile = dest.with_name(dest.stem + "_list.txt")
            listfile.write_text("\n".join(f"file '{p.as_posix()}'" for p in parts),
                                encoding="utf-8")
            try:
                _run(["-f", "concat", "-safe", "0", "-i", str(listfile),
                      "-c:a", "pcm_s16le", str(dest.with_suffix(".wav"))])
                dest.with_suffix(".wav").replace(dest)
            finally:
                listfile.unlink(missing_ok=True)
    finally:
        for p in parts:
            p.unlink(missing_ok=True)
    return dest


def speed_change(src: str | Path, dest: str | Path, factor: float) -> Path:
    """Change tempo without pitch shift (0.5×–2× via atempo chain)."""
    if not (0.25 <= factor <= 4.0):
        raise AudioError("speed factor must be within 0.25 and 4")
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    chain = []
    f = factor
    while f > 2.0:
        chain.append("atempo=2.0")
        f /= 2.0
    while f < 0.5:
        chain.append("atempo=0.5")
        f /= 0.5
    chain.append(f"atempo={f:.4f}")
    _run(["-i", str(src), "-filter:a", ",".join(chain), str(dest)])
    return dest


# ---------------------------------------------------------------------------
# Recording (device capture) — platform-specific commands
# ---------------------------------------------------------------------------

def record_command(dest: str | Path, device: str | None = None,
                   duration: float | None = None) -> list[str]:
    """Return the ffmpeg command to record microphone audio.

    ADZAK uses the OS-native capture backend; on Windows this is
    ``dshow`` (DirectShow), on macOS ``avfoundation`` and on Linux ALSA.
    """
    ff = find_ffmpeg()
    if not ff:
        raise AudioError("FFmpeg not found")
    args = [ff, "-hide_banner", "-y"]
    if sys.platform == "win32":
        args += ["-f", "dshow", "-i", f"audio={device or 'Microphone'}"]
    elif sys.platform == "darwin":
        args += ["-f", "avfoundation", "-i", f":{device or '0'}"]
    else:
        args += ["-f", "alsa", "-i", device or "default"]
    if duration:
        args += ["-t", f"{duration:.2f}"]
    args += ["-c:a", "pcm_s16le", str(dest)]
    return args
