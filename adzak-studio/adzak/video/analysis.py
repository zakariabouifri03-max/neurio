"""Local, free analysis helpers: silence detection/removal, scene-change detection."""
from __future__ import annotations

import re
from dataclasses import dataclass

from ..core import ffmpeg


@dataclass
class Span:
    start: float
    end: float

    @property
    def duration(self) -> float:
        return self.end - self.start


_SIL_START = re.compile(r"silence_start: (-?\d+(?:\.\d+)?)")
_SIL_END = re.compile(r"silence_end: (-?\d+(?:\.\d+)?)")
_SCENE = re.compile(r"pts_time:(\d+(?:\.\d+)?)")


def detect_silence(path: str, *, noise_db: float = -35.0, min_silence: float = 0.5) -> list[Span]:
    if not -90 <= noise_db <= 0 or min_silence <= 0:
        raise ValueError("Invalid silence threshold.")
    tail = ffmpeg.run(["-i", path, "-vn", "-af",
                       f"silencedetect=noise={noise_db}dB:d={min_silence}", "-f", "null", "-"], timeout=900)
    spans: list[Span] = []
    starts = [float(m.group(1)) for m in _SIL_START.finditer(tail)]
    ends = [float(m.group(1)) for m in _SIL_END.finditer(tail)]
    for s, e in zip(starts, ends):
        spans.append(Span(max(0.0, s), max(0.0, e)))
    if len(starts) > len(ends):  # silence runs until the end of the file
        spans.append(Span(max(0.0, starts[-1]), float("inf")))
    return spans


def non_silent_spans(silences: list[Span], total: float, padding: float = 0.05) -> list[Span]:
    """Complement of silent spans within [0, total], keeping a small padding around speech."""
    out: list[Span] = []
    cursor = 0.0
    for s in sorted(silences, key=lambda x: x.start):
        end = min(s.end, total)
        if s.start > cursor:
            out.append(Span(max(0.0, cursor - padding), min(total, s.start + padding)))
        cursor = max(cursor, end)
    if cursor < total:
        out.append(Span(max(0.0, cursor - padding), total))
    merged: list[Span] = []
    for sp in out:
        if sp.duration <= 0.05:
            continue
        if merged and sp.start <= merged[-1].end:
            merged[-1] = Span(merged[-1].start, max(merged[-1].end, sp.end))
        else:
            merged.append(sp)
    return merged


def detect_scenes(path: str, threshold: float = 0.3) -> list[float]:
    if not 0.01 <= threshold <= 1.0:
        raise ValueError("Scene threshold must be between 0.01 and 1.0.")
    tail = ffmpeg.run(["-i", path, "-an", "-vf", f"select='gt(scene,{threshold})',showinfo",
                        "-f", "null", "-"], timeout=1800)
    return [float(m.group(1)) for m in _SCENE.finditer(tail)]
