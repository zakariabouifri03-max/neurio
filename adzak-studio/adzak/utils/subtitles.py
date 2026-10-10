"""Subtitle parsing and conversion between SRT and WebVTT (pure Python, no network)."""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

from ..core.errors import AppError
from ..core.fileio import atomic_write_bytes

_TIME = re.compile(r"(\d{1,2}):(\d{2}):(\d{2})[,.](\d{3})")


@dataclass
class Cue:
    start: float
    end: float
    text: str


def _to_seconds(m: re.Match) -> float:
    h, mi, s, ms = (int(x) for x in m.groups())
    return h * 3600 + mi * 60 + s + ms / 1000.0


def _fmt(t: float, sep: str) -> str:
    t = max(0.0, t)
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d}{sep}{ms:03d}"


def parse(text: str) -> list[Cue]:
    cues: list[Cue] = []
    blocks = re.split(r"\r?\n\s*\r?\n", text.replace("\ufeff", "").strip())
    for block in blocks:
        lines = [ln.rstrip() for ln in block.splitlines() if ln.strip() != ""]
        if not lines:
            continue
        if lines[0].upper().startswith("WEBVTT") or lines[0].upper().startswith("NOTE"):
            continue
        idx = next((i for i, ln in enumerate(lines) if "-->" in ln), None)
        if idx is None:
            continue
        times = _TIME.findall(lines[idx])
        parts = lines[idx].split("-->")
        if len(times) < 2 or len(parts) != 2:
            raise AppError("Subtitle timing line is malformed.", details=lines[idx])
        start_m = _TIME.search(parts[0])
        end_m = _TIME.search(parts[1])
        if not start_m or not end_m:
            raise AppError("Subtitle timing line is malformed.", details=lines[idx])
        start, end = _to_seconds(start_m), _to_seconds(end_m)
        if end < start:
            raise AppError("A subtitle ends before it starts.", details=lines[idx])
        body = "\n".join(lines[idx + 1:]).strip()
        body = re.sub(r"<[^>]+>", "", body)  # strip inline markup
        cues.append(Cue(start, end, body))
    return cues


def to_srt(cues: list[Cue]) -> str:
    out = []
    for i, c in enumerate(cues, 1):
        out.append(f"{i}\n{_fmt(c.start, ',')} --> {_fmt(c.end, ',')}\n{c.text}\n")
    return "\n".join(out)


def to_vtt(cues: list[Cue]) -> str:
    out = ["WEBVTT", ""]
    for c in cues:
        out.append(f"{_fmt(c.start, '.')} --> {_fmt(c.end, '.')}\n{c.text}\n")
    return "\n".join(out)


def shift(cues: list[Cue], seconds: float) -> list[Cue]:
    """Synchronise subtitles by shifting every cue (negative = earlier)."""
    out = []
    for c in cues:
        s, e = c.start + seconds, c.end + seconds
        if e <= 0:
            continue
        out.append(Cue(max(0.0, s), e, c.text))
    return out


def convert_file(src: str | Path, dst: str | Path, shift_seconds: float = 0.0) -> Path:
    src, dst = Path(src), Path(dst)
    if src.suffix.lower() not in (".srt", ".vtt"):
        raise AppError("Subtitle input must be .srt or .vtt.")
    if dst.suffix.lower() not in (".srt", ".vtt"):
        raise AppError("Subtitle output must be .srt or .vtt.")
    try:
        text = src.read_text(encoding="utf-8-sig")
    except UnicodeDecodeError as exc:
        raise AppError("Subtitle file must be UTF-8 encoded.") from exc
    cues = shift(parse(text), shift_seconds)
    if not cues:
        raise AppError("No subtitles were found in this file.")
    body = to_vtt(cues) if dst.suffix.lower() == ".vtt" else to_srt(cues)
    return atomic_write_bytes(dst, body.encode("utf-8"))
