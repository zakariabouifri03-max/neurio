"""Time and timecode helpers. All timeline time is stored in seconds (float)."""
from __future__ import annotations

import math


def fmt_timecode(seconds: float, fps: float = 30.0) -> str:
    """Format seconds as HH:MM:SS:FF (frame-rounded, no drop-frame)."""
    if seconds is None or math.isnan(seconds):
        seconds = 0.0
    seconds = max(0.0, float(seconds))
    total_frames = int(round(seconds * fps))
    ff = total_frames % int(round(fps))
    total_seconds = total_frames // int(round(fps))
    s = total_seconds % 60
    m = (total_seconds // 60) % 60
    h = total_seconds // 3600
    return f"{h:02d}:{m:02d}:{s:02d}:{ff:02d}"


def fmt_clock(seconds: float) -> str:
    """Human readable HH:MM:SS.mmm used in tooltips and logs."""
    seconds = max(0.0, float(seconds or 0.0))
    ms = int(round((seconds - int(seconds)) * 1000))
    total = int(seconds)
    s = total % 60
    m = (total // 60) % 60
    h = total // 3600
    return f"{h:02d}:{m:02d}:{s:02d}.{ms:03d}"


def parse_timecode(text: str, fps: float = 30.0) -> float:
    """Parse HH:MM:SS:FF, MM:SS:FF, SS:FF or plain seconds."""
    text = text.strip().replace(";", ":")
    parts = text.split(":")
    try:
        if len(parts) == 1:
            return float(parts[0])
        nums = [float(p) for p in parts]
    except ValueError as exc:
        raise ValueError(f"Invalid timecode: {text!r}") from exc
    if len(parts) == 4:
        h, m, s, f = nums
    elif len(parts) == 3:
        h, m, s, f = 0.0, *nums
    elif len(parts) == 2:
        h = m = 0.0
        m, s, f = 0.0, *nums
    else:
        raise ValueError(f"Invalid timecode: {text!r}")
    return h * 3600 + m * 60 + s + f / fps


def frame_to_seconds(frame: int, fps: float) -> float:
    return int(frame) / float(fps)


def seconds_to_frame(seconds: float, fps: float) -> int:
    return int(round(float(seconds) * float(fps)))


def snap(value: float, candidates, tolerance: float) -> float:
    """Snap *value* to the nearest candidate within *tolerance* seconds."""
    best, best_delta = value, tolerance
    for c in candidates:
        d = abs(c - value)
        if d <= best_delta:
            best, best_delta = c, d
    return best
