"""Undoable timeline editing commands."""
from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Any, Optional

from ..core.commands import Command
from ..models.timeline import Clip, Timeline, Track, Marker
from ..models.media import new_id


# --------------------------------------------------------------- clip commands
class AddClipCommand(Command):
    def __init__(self, timeline: Timeline, clip: Clip, track_id: str):
        super().__init__("Add clip")
        self.tl, self.clip, self.track_id = timeline, clip, track_id

    def do(self) -> None:
        self.tl.add_clip(self.clip, self.track_id, allow_overlap=True)

    def undo(self) -> None:
        self.tl.remove_clip(self.clip.id)


class RemoveClipCommand(Command):
    def __init__(self, timeline: Timeline, clip_id: str):
        super().__init__("Delete clip")
        self.tl, self.clip_id = timeline, clip_id
        self._clip: Optional[Clip] = None
        self._track_id = ""

    def do(self) -> None:
        clip = self.tl.clip_by_id(self.clip_id)
        if clip is None:
            return
        self._clip, self._track_id = clip, clip.track_id
        self.tl.remove_clip(self.clip_id)

    def undo(self) -> None:
        if self._clip:
            self.tl.add_clip(self._clip, self._track_id, allow_overlap=True)


class MoveClipCommand(Command):
    """Drag a clip to a new start time and/or track."""

    def __init__(self, timeline: Timeline, clip_id: str,
                 new_start: float, new_track_id: Optional[str] = None,
                 old_start: Optional[float] = None,
                 old_track_id: Optional[str] = None):
        super().__init__("Move clip")
        self.tl, self.clip_id = timeline, clip_id
        self.new_start, self.new_track = new_start, new_track_id
        # Explicit pre-drag state: the scene mutates clips live while dragging,
        # so the command must not infer "before" from current state.
        self._old_start = old_start if old_start is not None else 0.0
        self._old_track = old_track_id or ""

    def do(self) -> None:
        clip = self.tl.clip_by_id(self.clip_id)
        if clip is None:
            return
        if self._old_track == "":
            self._old_start, self._old_track = clip.start, clip.track_id
        clip.start = max(0.0, self.new_start)
        if self.new_track:
            track = self.tl.track_by_id(self.new_track)
            if track is not None:
                old = self.tl.track_by_id(clip.track_id)
                if old is not None:
                    old.clips.remove(clip)
                track.clips.append(clip)
                clip.track_id = track.id
                track.clips.sort(key=lambda c: c.start)

    def undo(self) -> None:
        clip = self.tl.clip_by_id(self.clip_id)
        if clip is None:
            return
        clip.start = self._old_start
        if self._old_track and self._old_track != clip.track_id:
            cur = self.tl.track_by_id(clip.track_id)
            old = self.tl.track_by_id(self._old_track)
            if cur and old:
                cur.clips.remove(clip)
                old.clips.append(clip)
                clip.track_id = old.id
                old.clips.sort(key=lambda c: c.start)


@dataclass
class TrimState:
    start: float
    duration: float
    source_in: float
    source_duration: float


class TrimClipCommand(Command):
    """Adjust one or both edges of a clip while keeping source timing valid."""

    def __init__(self, timeline: Timeline, clip_id: str,
                 *, new_start: Optional[float] = None,
                 new_end: Optional[float] = None,
                 source_limit: Optional[float] = None,
                 before: Optional[TrimState] = None):
        super().__init__("Trim clip")
        self.tl, self.clip_id = timeline, clip_id
        self.new_start, self.new_end = new_start, new_end
        self.source_limit = source_limit
        # Pre-drag snapshot supplied by the timeline scene (see MoveClipCommand).
        self._before: Optional[TrimState] = before
        self._after: Optional[TrimState] = None

    def do(self) -> None:
        clip = self.tl.clip_by_id(self.clip_id)
        if clip is None:
            return
        if self._before is None:
            self._before = TrimState(clip.start, clip.duration,
                                     clip.source_in, clip.source_duration)
        before = self._before
        # Compute every delta against the pre-drag snapshot: the timeline
        # scene mutates start/duration live and never touches source timing.
        start = self.new_start if self.new_start is not None else before.start
        end = self.new_end if self.new_end is not None else \
            before.start + before.duration
        start = max(0.0, start)
        end = max(start + 0.05, end)
        delta_left = start - before.start
        speed = max(clip.speed, 1e-6)
        new_source_in = max(0.0, before.source_in + delta_left * speed)
        new_source_duration = (end - start) * speed
        if self.source_limit is not None:
            max_src = max(0.0, self.source_limit - new_source_in)
            new_source_duration = min(new_source_duration, max_src)
            end = start + new_source_duration / speed
        clip.start, clip.duration = start, end - start
        clip.source_in, clip.source_duration = new_source_in, new_source_duration
        self._after = TrimState(clip.start, clip.duration,
                                clip.source_in, clip.source_duration)

    def undo(self) -> None:
        clip = self.tl.clip_by_id(self.clip_id)
        if clip is not None and self._before:
            clip.start, clip.duration = self._before.start, self._before.duration
            clip.source_in = self._before.source_in
            clip.source_duration = self._before.source_duration


class SplitClipCommand(Command):
    """Split one clip into two at timeline time *t*."""

    def __init__(self, timeline: Timeline, clip_id: str, t: float):
        super().__init__("Split clip")
        self.tl, self.clip_id, self.t = timeline, clip_id, t
        self._left_id = self._right_id = ""

    def do(self) -> None:
        original = self.tl.clip_by_id(self.clip_id)
        if original is None or not (original.start < self.t < original.end):
            return
        left_dur = self.t - original.start
        right_dur = original.end - self.t
        src_cut = original.source_in + left_dur * original.speed

        left = copy.deepcopy(original)
        # Keep the original id on the left half so chained splits (and the
        # UI selection) keep referring to a valid, live clip.
        left.id = original.id
        left.duration = left_dur
        left.source_duration = left_dur * original.speed
        left.transition_out = None
        left.keyframes = [k for k in left.keyframes if k.time <= self.t]

        right = copy.deepcopy(original)
        right.id = new_id("clip")
        right.start = self.t
        right.duration = right_dur
        right.source_in = src_cut
        right.source_duration = original.source_out - src_cut
        right.transition_in = None
        right.keyframes = [k for k in right.keyframes if k.time >= self.t]

        self.tl.remove_clip(original.id)
        self.tl.add_clip(left, original.track_id, allow_overlap=True)
        self.tl.add_clip(right, original.track_id, allow_overlap=True)
        self._left_id, self._right_id = left.id, right.id

    def undo(self) -> None:
        # Restore by merging the two halves back into a single reconstructed clip.
        left = self.tl.clip_by_id(self._left_id)
        right = self.tl.clip_by_id(self._right_id)
        if left is None or right is None:
            return
        merged = copy.deepcopy(left)
        merged.id = self.clip_id
        merged.duration = left.duration + right.duration
        merged.source_duration = left.source_duration + right.source_duration
        merged.transition_out = right.transition_out
        merged.keyframes = sorted(left.keyframes + right.keyframes,
                                  key=lambda k: k.time)
        track_id = left.track_id
        self.tl.remove_clip(left.id)
        self.tl.remove_clip(right.id)
        self.tl.add_clip(merged, track_id, allow_overlap=True)


class RippleDeleteCommand(Command):
    """Delete a clip and pull every later clip on the same track left."""

    def __init__(self, timeline: Timeline, clip_id: str):
        super().__init__("Ripple delete")
        self.tl, self.clip_id = timeline, clip_id
        self._clip: Optional[Clip] = None
        self._moved: list[tuple[str, float]] = []

    def do(self) -> None:
        clip = self.tl.clip_by_id(self.clip_id)
        if clip is None:
            return
        self._clip = copy.deepcopy(clip)
        track = self.tl.track_by_id(clip.track_id)
        shift = clip.duration
        self.tl.remove_clip(clip.id)
        self._moved = []
        if track:
            for other in track.clips:
                if other.start >= clip.end - 1e-9:
                    self._moved.append((other.id, other.start))
                    other.start = max(0.0, other.start - shift)

    def undo(self) -> None:
        if self._clip is None:
            return
        for cid, old_start in self._moved:
            c = self.tl.clip_by_id(cid)
            if c:
                c.start = old_start
        self.tl.add_clip(self._clip, self._clip.track_id, allow_overlap=True)


class DuplicateClipCommand(Command):
    def __init__(self, timeline: Timeline, clip_id: str,
                 offset_s: float = 0.5, track_id: Optional[str] = None):
        super().__init__("Duplicate clip")
        self.tl, self.clip_id, self.offset = timeline, clip_id, offset_s
        self.track_id = track_id
        self._new_id = ""

    def do(self) -> None:
        src = self.tl.clip_by_id(self.clip_id)
        if src is None:
            return
        dup = copy.deepcopy(src)
        dup.id = new_id("clip")
        dup.start = src.end + self.offset
        target = self.track_id or src.track_id
        self.tl.add_clip(dup, target, allow_overlap=True)
        self._new_id = dup.id

    def undo(self) -> None:
        self.tl.remove_clip(self._new_id)


class SetClipPropertyCommand(Command):
    """Generic property edit (transform, gain, opacity...). Coalesces drags."""

    def __init__(self, timeline: Timeline, clip_id: str, property: str,
                 value: Any, label: str = "Edit property"):
        super().__init__(label)
        self.tl, self.clip_id, self.prop, self.value = timeline, clip_id, property, value
        self._old: Any = None

    def do(self) -> None:
        clip = self.tl.clip_by_id(self.clip_id)
        if clip is None or not hasattr(clip, self.prop):
            return
        self._old = getattr(clip, self.prop)
        setattr(clip, self.prop, self.value)

    def merge_with(self, previous: Command) -> bool:
        if isinstance(previous, SetClipPropertyCommand) \
                and previous.clip_id == self.clip_id \
                and previous.prop == self.prop:
            # Keep the previous command on the stack: make it restore the
            # pre-gesture value on undo and the latest value on redo.
            previous.value = self.value
            return True
        return False

    def undo(self) -> None:
        clip = self.tl.clip_by_id(self.clip_id)
        if clip is not None:
            setattr(clip, self.prop, self._old)


class SetSpeedCommand(Command):
    def __init__(self, timeline: Timeline, clip_id: str, speed: float):
        super().__init__("Change speed")
        self.tl, self.clip_id, self.speed = timeline, clip_id, max(0.1, speed)
        self._before: tuple[float, float, float] = (0, 0, 0)

    def do(self) -> None:
        clip = self.tl.clip_by_id(self.clip_id)
        if clip is None:
            return
        self._before = (clip.speed, clip.duration, clip.source_duration)
        clip.speed = self.speed
        clip.source_duration = clip.duration * self.speed

    def undo(self) -> None:
        clip = self.tl.clip_by_id(self.clip_id)
        if clip:
            clip.speed, clip.duration, clip.source_duration = self._before


# --------------------------------------------------------------- track commands
class AddTrackCommand(Command):
    def __init__(self, timeline: Timeline, kind: str, name: str = ""):
        super().__init__("Add track")
        self.tl, self.kind, self.name = timeline, kind, name
        self._id = ""

    def do(self) -> None:
        self._id = self.tl.add_track(self.kind, self.name).id

    def undo(self) -> None:
        self.tl.remove_track(self._id)


class RemoveTrackCommand(Command):
    def __init__(self, timeline: Timeline, track_id: str):
        super().__init__("Remove track")
        self.tl, self.track_id = timeline, track_id
        self._track: Optional[Track] = None
        self._index = -1

    def do(self) -> None:
        track = self.tl.track_by_id(self.track_id)
        if track:
            self._index = self.tl.tracks.index(track)
            self._track = copy.deepcopy(track)
            self.tl.remove_track(self.track_id)

    def undo(self) -> None:
        if self._track:
            self.tl.tracks.insert(self._index, self._track)


# -------------------------------------------------------------- marker commands
class AddMarkerCommand(Command):
    def __init__(self, timeline: Timeline, time: float, label: str = ""):
        super().__init__("Add marker")
        self.tl, self.time, self.label = timeline, time, label
        self._id = ""

    def do(self) -> None:
        self._id = self.tl.add_marker(self.time, self.label).id

    def undo(self) -> None:
        self.tl.markers = [m for m in self.tl.markers if m.id != self._id]


class RemoveMarkerCommand(Command):
    def __init__(self, timeline: Timeline, marker_id: str):
        super().__init__("Remove marker")
        self.tl, self.marker_id = timeline, marker_id
        self._marker: Optional[Marker] = None

    def do(self) -> None:
        m = next((x for x in self.tl.markers if x.id == self.marker_id), None)
        if m:
            self._marker = copy.deepcopy(m)
            self.tl.markers.remove(m)

    def undo(self) -> None:
        if self._marker:
            self.tl.markers.append(self._marker)
            self.tl.markers.sort(key=lambda x: x.time)
