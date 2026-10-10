"""Subtitle parsing, timing and format conversion (SRT ⇄ VTT ⇄ TXT).

Parsing is dependency-free and forgiving: malformed timestamps raise a clear
error rather than silently corrupting timings.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path


class SubtitleError(RuntimeError):
    pass


@dataclass
class Cue:
    start: float
    end: float
    text: str

    def shift(self, delta: float) -> "Cue":
        return Cue(max(0.0, self.start + delta), max(0.0, self.end + delta), self.text)


def _ts_to_seconds(ts: str) -> float:
    ts = ts.strip().replace(",", ".").replace("。", ".")
    m = re.match(r"(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)", ts)
    if not m:
        raise SubtitleError(f"bad timestamp: {ts!r}")
    h = int(m[1] or 0)
    mi = int(m[2])
    sec = float(m[3])
    if mi > 59 or sec >= 61:
        raise SubtitleError(f"bad timestamp values: {ts!r}")
    return h * 3600 + mi * 60 + sec


def _seconds_to_srt_ts(t: float) -> str:
    ms = int(round(t * 1000))
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def _seconds_to_vtt_ts(t: float) -> str:
    return _seconds_to_srt_ts(t).replace(",", ".")


def parse_srt(text: str) -> list[Cue]:
    cues: list[Cue] = []
    blocks = re.split(r"\n\s*\n", text.strip().replace("\r\n", "\n").replace("\ufeff", ""))
    for block in blocks:
        lines = [l for l in block.strip().split("\n") if l.strip()]
        if not lines:
            continue
        # first line may be the index
        tsi = 0
        if re.fullmatch(r"\d+", lines[0]):
            tsi = 1
        if tsi >= len(lines):
            continue
        m = re.match(r"(.+?)\s*-->\s*(.+)", lines[tsi])
        if not m:
            raise SubtitleError(f"expected a timing line, got: {lines[tsi]!r}")
        start = _ts_to_seconds(m[1])
        end = _ts_to_seconds(m[2])
        if end < start:
            raise SubtitleError("cue end is before its start")
        cues.append(Cue(start, end, "\n".join(lines[tsi + 1:])))
    return cues


def parse_vtt(text: str) -> list[Cue]:
    text = re.sub(r"^WEBVTT.*?\n", "", text.strip().replace("\r\n", "\n"), flags=re.S)
    text = text.replace("WEBVTT", "")
    return parse_srt(text)


def parse(text: str, fmt: str) -> list[Cue]:
    fmt = fmt.lower().lstrip(".")
    if fmt == "srt":
        return parse_srt(text)
    if fmt == "vtt":
        return parse_vtt(text)
    raise SubtitleError(f"unsupported subtitle format: {fmt}")


def load(path: str | Path) -> list[Cue]:
    p = Path(path)
    return parse(p.read_text(encoding="utf-8-sig"), p.suffix)


def write_srt(cues: list[Cue]) -> str:
    out = []
    for i, c in enumerate(cues, 1):
        out.append(f"{i}\n{_seconds_to_srt_ts(c.start)} --> {_seconds_to_srt_ts(c.end)}\n{c.text}\n")
    return "\n".join(out)


def write_vtt(cues: list[Cue]) -> str:
    out = ["WEBVTT", ""]
    for c in cues:
        out.append(f"{_seconds_to_vtt_ts(c.start)} --> {_seconds_to_vtt_ts(c.end)}\n{c.text}\n")
    return "\n".join(out)


def write_txt(cues: list[Cue]) -> str:
    return "\n".join(c.text for c in cues) + "\n"


def convert(src: str | Path, dest: str | Path, offset: float = 0.0,
            fps_scale: float = 1.0) -> Path:
    """Convert between subtitle formats, optionally shifting/scaling time."""
    src, dest = Path(src), Path(dest)
    cues = load(src)
    if fps_scale != 1.0 and fps_scale > 0:
        cues = [Cue(c.start * fps_scale, c.end * fps_scale, c.text) for c in cues]
    if offset:
        cues = [c.shift(offset) for c in cues]
    fmt = dest.suffix.lower().lstrip(".")
    if fmt == "srt":
        text = write_srt(cues)
    elif fmt == "vtt":
        text = write_vtt(cues)
    elif fmt == "txt":
        text = write_txt(cues)
    else:
        raise SubtitleError(f"unsupported target format: .{fmt}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(text, encoding="utf-8")
    return dest


def estimate_reading_duration(cues: list[Cue], chars_per_second: float = 17.0) -> float:
    """Rough 'comfortable' duration for auto-timing generated captions."""
    return sum(max(1.2, len(c.text) / chars_per_second) for c in cues)
