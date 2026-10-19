"""Silence detection via FFmpeg's silencedetect and undoable cut proposals."""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from ..core.commands import Command, MacroCommand
from ..core.ffmpeg import CancellableProcess, find_ffmpeg
from ..core.logging_setup import get_logger
from ..editing.operations import RippleDeleteCommand, SplitClipCommand
from .base import AITool, ToolStatus

log = get_logger("ai-silence")
_START_RE = re.compile(r"silence_start:\s*([-\d.]+)")
_END_RE = re.compile(r"silence_end:\s*([-\d.]+)")


@dataclass
class SilenceInterval:
    start: float
    end: float

    @property
    def duration(self) -> float:
        return max(0.0, self.end - self.start)


class SilenceDetector(AITool):
    id = "silence"
    name = "Silence detection"
    description = "Find silent intervals and preview ripple-delete cuts."

    def check(self) -> ToolStatus:
        if not self.ffmpeg_available():
            return self.unavailable("FFmpeg was not found.")
        return self.available()

    # ------------------------------------------------------------- analysis
    def detect(self, media_path: str, threshold_db: float = -35.0,
               min_duration: float = 0.5,
               should_cancel=None) -> list[SilenceInterval]:
        """Run silencedetect on *media_path* and return source-timed intervals."""
        self.ensure_ready()
        ffmpeg = find_ffmpeg()
        cmd = [str(ffmpeg), "-hide_banner", "-i", str(media_path), "-af",
               f"silencedetect=noise={threshold_db}dB:d={min_duration}",
               "-f", "null", "-"]
        runner = CancellableProcess()
        text: list[str] = []
        result = runner.run(cmd, on_line=lambda line: text.append(line))
        if should_cancel and should_cancel():
            raise RuntimeError("Silence detection cancelled")
        if not result.ok:
            raise RuntimeError(f"silencedetect failed: {result.stderr[-300:]}")
        return self._parse("\n".join(text))

    @staticmethod
    def _parse(stderr: str) -> list[SilenceInterval]:
        starts = [float(m.group(1)) for m in _START_RE.finditer(stderr)]
        ends = [float(m.group(1)) for m in _END_RE.finditer(stderr)]
        intervals: list[SilenceInterval] = []
        for i, start in enumerate(starts):
            end = ends[i] if i < len(ends) else start
            if end > start:
                intervals.append(SilenceInterval(max(0.0, start), max(0.0, end)))
        return intervals

    # ------------------------------------------------------------- editing
    def cut_commands(self, timeline, clip_id: str,
                     intervals: list[SilenceInterval]) -> MacroCommand:
        """Translate source-timed intervals into one undoable macro.

        Intervals are applied back-to-front so earlier split positions stay
        valid; the middle piece is resolved by position at execution time.
        """
        clip = timeline.clip_by_id(clip_id)
        if clip is None:
            raise KeyError(clip_id)
        speed = max(clip.speed, 1e-6)
        cuts: list[tuple[float, float]] = []
        for iv in intervals:
            a = clip.start + (iv.start - clip.source_in) / speed
            b = clip.start + (iv.end - clip.source_in) / speed
            a = max(clip.start + 0.02, min(a, clip.end - 0.02))
            b = max(a + 0.02, min(b, clip.end - 0.02))
            if b > a:
                cuts.append((a, b))
        macro: list = []
        track_id = clip.track_id
        for a, b in sorted(cuts, reverse=True):
            macro.append(SplitClipCommand(timeline, clip_id, b))
            macro.append(SplitClipCommand(timeline, clip_id, a))
            macro.append(_RippleDeleteAtPosition(timeline, track_id, a))
        return MacroCommand("Remove silences", macro)


class _RippleDeleteAtPosition:
    """Resolves the clip covering *position* lazily (ids change after splits)."""

    def __init__(self, timeline, track_id: str, position: float):
        self.label = "Ripple delete silence"
        self.tl, self.track_id, self.position = timeline, track_id, position
        self._inner: Optional[RippleDeleteCommand] = None

    def do(self) -> None:
        track = self.tl.track_by_id(self.track_id)
        if track is None:
            return
        target = next((c for c in track.clips
                       if abs(c.start - self.position) < 0.05), None)
        if target is None:
            return
        self._inner = RippleDeleteCommand(self.tl, target.id)
        self._inner.do()

    def undo(self) -> None:
        if self._inner:
            self._inner.undo()
