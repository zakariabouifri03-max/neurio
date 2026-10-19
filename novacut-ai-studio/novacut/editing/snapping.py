"""Snapping engine: clip edges, playhead, markers and grid positions."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

from ..core.timecode import snap
from ..models.timeline import Timeline


@dataclass
class SnapResult:
    time: float
    snapped: bool
    target: str = ""


class SnappingEngine:
    def __init__(self, timeline: Timeline, enabled: bool = True,
                 tolerance_s: float = 0.25):
        self.timeline = timeline
        self.enabled = enabled
        self.tolerance = tolerance_s

    def candidates(self, clip_id: Optional[str] = None,
                   include_playhead: float | None = None) -> list[float]:
        pts = list(self.timeline.snap_candidates())
        if include_playhead is not None:
            pts.append(include_playhead)
        # Clip-internal source boundaries are not added; edges are enough.
        return [p for p in pts if p >= 0.0]

    def snap_time(self, time: float, clip_id: Optional[str] = None,
                  playhead: float | None = None) -> SnapResult:
        if not self.enabled:
            return SnapResult(time, False)
        candidates = self.candidates(clip_id, playhead)
        snapped = snap(time, candidates, self.tolerance)
        if abs(snapped - time) < 1e-9:
            return SnapResult(time, False)
        target = "marker" if snapped in [m.time for m in self.timeline.markers] \
            else "edge"
        if playhead is not None and abs(snapped - playhead) < 1e-9:
            target = "playhead"
        return SnapResult(snapped, True, target)
