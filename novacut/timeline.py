"""Non-destructive timeline operations and bounded undo/redo history."""
from __future__ import annotations

from copy import deepcopy
from typing import Iterable

from .models import Clip, Project, Track, new_id


class TimelineError(ValueError):
    """A requested edit cannot be applied to the current timeline."""


class TimelineOperations:
    @staticmethod
    def _require_track(project: Project, track_id: str) -> Track:
        track = project.track(track_id)
        if track is None:
            raise TimelineError("The target track no longer exists")
        if track.locked:
            raise TimelineError(f"{track.name} is locked")
        return track

    @staticmethod
    def _compatible(project: Project, clip: Clip, track: Track) -> bool:
        if clip.type == "title":
            return track.kind == "video"
        asset = project.asset(clip.media_id)
        if not asset:
            return False
        return track.kind == ("audio" if asset.kind == "audio" else "video")

    @classmethod
    def add_media_clip(
        cls,
        project: Project,
        media_id: str,
        track_id: str | None = None,
        start: float = 0.0,
        source_in: float = 0.0,
        source_out: float | None = None,
        still_duration: float = 5.0,
    ) -> Clip:
        asset = project.asset(media_id)
        if asset is None:
            raise TimelineError("The selected media is no longer in the project bin")
        if source_out is None:
            source_out = asset.duration if asset.duration > 0 else (still_duration if asset.kind == "image" else 0.0)
        if source_out <= source_in:
            raise TimelineError("Media duration is unknown. Check that FFmpeg is installed, then re-import the file.")
        if track_id is None:
            wanted = "audio" if asset.kind == "audio" else "video"
            candidates = [t for t in project.tracks if t.kind == wanted and not t.locked]
            if not candidates:
                raise TimelineError(f"Add an unlocked {wanted} track first")
            track_id = candidates[-1].id
        track = cls._require_track(project, track_id)
        clip = Clip(
            id=new_id(), track_id=track.id, start=max(0.0, float(start)),
            source_in=max(0.0, float(source_in)), source_out=float(source_out),
            media_id=media_id,
        )
        if not cls._compatible(project, clip, track):
            raise TimelineError(f"{asset.kind.title()} media cannot be placed on a {track.kind} track")
        project.clips.append(clip)
        project.dirty = True
        return clip

    @classmethod
    def add_title(
        cls,
        project: Project,
        text: str = "Your title",
        track_id: str | None = None,
        start: float = 0.0,
        duration: float = 5.0,
    ) -> Clip:
        if not text.strip():
            raise TimelineError("Title text cannot be empty")
        if duration <= 0:
            raise TimelineError("Title duration must be greater than zero")
        if track_id is None:
            tracks = [t for t in project.tracks if t.kind == "video" and not t.locked]
            if not tracks:
                raise TimelineError("Add an unlocked video track first")
            track_id = tracks[0].id
        track = cls._require_track(project, track_id)
        if track.kind != "video":
            raise TimelineError("Titles must be placed on a video track")
        clip = Clip(
            id=new_id(), track_id=track.id, start=max(0.0, float(start)),
            source_in=0.0, source_out=float(duration), type="title", title=text,
        )
        project.clips.append(clip)
        project.dirty = True
        return clip

    @classmethod
    def split(cls, project: Project, clip_id: str, timeline_time: float) -> Clip:
        clip = project.clip(clip_id)
        if clip is None:
            raise TimelineError("Select a clip before splitting")
        cls._require_track(project, clip.track_id)
        epsilon = 1e-7
        if not clip.start + epsilon < timeline_time < clip.end - epsilon:
            raise TimelineError("The playhead must be inside the selected clip to split it")
        source_delta = (timeline_time - clip.start) * clip.playback_rate
        split_source = clip.source_in + source_delta
        right = deepcopy(clip)
        right.id = new_id()
        right.start = timeline_time
        right.source_in = split_source
        right.fade_in = 0.0
        clip.source_out = split_source
        clip.fade_out = 0.0
        project.clips.append(right)
        project.dirty = True
        return right

    @classmethod
    def trim(cls, project: Project, clip_id: str, edge: str, timeline_time: float) -> None:
        clip = project.clip(clip_id)
        if clip is None:
            raise TimelineError("Select a clip before trimming")
        cls._require_track(project, clip.track_id)
        min_duration = 1.0 / max(1.0, project.fps)
        if edge == "start":
            new_start = min(float(timeline_time), clip.end - min_duration)
            new_start = max(0.0, new_start)
            source_shift = (new_start - clip.start) * clip.playback_rate
            new_source_in = clip.source_in + source_shift
            if new_source_in < 0:
                new_source_in = 0.0
                new_start = clip.start - (clip.source_in / clip.playback_rate)
            clip.start = new_start
            clip.source_in = new_source_in
        elif edge == "end":
            new_end = max(float(timeline_time), clip.start + min_duration)
            new_source_out = clip.source_in + (new_end - clip.start) * clip.playback_rate
            asset = project.asset(clip.media_id) if clip.type != "title" else None
            source_limit = asset.duration if asset and asset.duration > 0 else float("inf")
            clip.source_out = min(new_source_out, source_limit)
        else:
            raise TimelineError("Trim edge must be 'start' or 'end'")
        clip.fade_in = min(clip.fade_in, clip.duration)
        clip.fade_out = min(clip.fade_out, clip.duration)
        project.dirty = True

    @classmethod
    def move(
        cls,
        project: Project,
        clip_id: str,
        start: float,
        track_id: str | None = None,
        snap: bool = True,
        playhead: float | None = None,
        pixels_per_second: float = 90.0,
    ) -> float:
        clip = project.clip(clip_id)
        if clip is None:
            raise TimelineError("Select a clip before moving it")
        source_track = cls._require_track(project, clip.track_id)
        target_id = track_id or clip.track_id
        target_track = cls._require_track(project, target_id)
        if not cls._compatible(project, clip, target_track):
            raise TimelineError("Clips can only be moved to a compatible track")
        candidate = max(0.0, float(start))
        if snap:
            candidate = cls.snap_time(project, candidate, clip_id, playhead, pixels_per_second)
        if abs(candidate - clip.start) > 1e-9 or source_track.id != target_track.id:
            clip.start = candidate
            clip.track_id = target_track.id
            project.dirty = True
        return candidate

    @staticmethod
    def snap_time(
        project: Project,
        proposed_time: float,
        moving_clip_id: str = "",
        playhead: float | None = None,
        pixels_per_second: float = 90.0,
        threshold_px: float = 8.0,
    ) -> float:
        threshold = threshold_px / max(1.0, pixels_per_second)
        candidates = [0.0]
        if playhead is not None:
            candidates.append(playhead)
        for clip in project.clips:
            if clip.id == moving_clip_id:
                continue
            candidates.extend((clip.start, clip.end))
        candidates.extend(float(marker.get("time", 0.0)) for marker in project.markers)
        nearest = min(candidates, key=lambda value: abs(value - proposed_time), default=proposed_time)
        return nearest if abs(nearest - proposed_time) <= threshold else proposed_time

    @classmethod
    def duplicate(cls, project: Project, clip_id: str, offset: float | None = None) -> Clip:
        original = project.clip(clip_id)
        if original is None:
            raise TimelineError("Select a clip before duplicating it")
        cls._require_track(project, original.track_id)
        duplicate = deepcopy(original)
        duplicate.id = new_id()
        duplicate.start = original.end if offset is None else max(0.0, original.start + float(offset))
        project.clips.append(duplicate)
        project.dirty = True
        return duplicate

    @classmethod
    def delete(cls, project: Project, clip_id: str, ripple: bool = False) -> Clip:
        clip = project.clip(clip_id)
        if clip is None:
            raise TimelineError("Select a clip before deleting it")
        track = cls._require_track(project, clip.track_id)
        project.clips.remove(clip)
        if ripple:
            duration = clip.duration
            for other in project.clips:
                if other.track_id == track.id and other.start >= clip.end - 1e-7:
                    other.start = max(0.0, other.start - duration)
        project.dirty = True
        return clip

    @classmethod
    def apply_silence_cuts(
        cls,
        project: Project,
        clip_id: str,
        intervals: Iterable[tuple[float, float]],
    ) -> list[Clip]:
        """Remove source-relative silence intervals from one clip and close its gap.

        Intervals are in seconds from the beginning of the media file, matching
        FFmpeg's silencedetect output. Resulting segments are ordinary editable clips.
        """
        clip = project.clip(clip_id)
        if clip is None or clip.type == "title":
            raise TimelineError("Select a media clip before applying silence cuts")
        track = cls._require_track(project, clip.track_id)
        source_start, source_end = clip.source_in, clip.source_out
        cuts: list[tuple[float, float]] = []
        for left, right in intervals:
            left, right = max(source_start, float(left)), min(source_end, float(right))
            if right > left:
                cuts.append((left, right))
        cuts.sort()
        merged: list[list[float]] = []
        for left, right in cuts:
            if merged and left <= merged[-1][1] + 1e-6:
                merged[-1][1] = max(merged[-1][1], right)
            else:
                merged.append([left, right])
        if not merged:
            raise TimelineError("No silence intervals overlap the selected clip")
        survivors: list[tuple[float, float]] = []
        cursor = source_start
        for left, right in merged:
            if left > cursor:
                survivors.append((cursor, left))
            cursor = max(cursor, right)
        if cursor < source_end:
            survivors.append((cursor, source_end))
        if not survivors:
            raise TimelineError("The proposed cuts would remove the entire clip")

        original_start, rate = clip.start, clip.playback_rate
        old_end = clip.end
        kept: list[Clip] = []
        timeline_cursor = original_start
        for index, (left, right) in enumerate(survivors):
            segment = clip if index == 0 else deepcopy(clip)
            if index:
                segment.id = new_id()
            segment.source_in, segment.source_out = left, right
            segment.start = timeline_cursor
            segment.fade_in = clip.fade_in if index == 0 else 0.0
            segment.fade_out = clip.fade_out if index == len(survivors) - 1 else 0.0
            project.clips.append(segment) if index else None
            kept.append(segment)
            timeline_cursor += (right - left) / rate
        project.clips[:] = [item for item in project.clips if item is not clip or item is kept[0]]
        removed_duration = max(0.0, old_end - timeline_cursor)
        if removed_duration:
            for other in project.clips:
                if other.id not in {segment.id for segment in kept} and other.track_id == track.id and other.start >= old_end - 1e-7:
                    other.start = max(0.0, other.start - removed_duration)
        project.dirty = True
        return kept

    @staticmethod
    def add_track(project: Project, kind: str) -> Track:
        if kind not in {"video", "audio"}:
            raise TimelineError("Track kind must be video or audio")
        existing = [int(t.name[1:t.name.find(" ") or None]) for t in project.tracks if t.kind == kind and t.name[1:2].isdigit()]
        number = max(existing, default=0) + 1
        label = "Video" if kind == "video" else "Audio"
        track = Track(new_id(), f"{kind[0].upper()}{number} · {label}", kind)
        if kind == "video":
            # Lower index means higher compositing priority.
            first_video = next((i for i, t in enumerate(project.tracks) if t.kind == "video"), 0)
            project.tracks.insert(first_video, track)
        else:
            project.tracks.append(track)
        project.dirty = True
        return track

    @staticmethod
    def add_marker(project: Project, time_seconds: float, name: str = "Marker") -> dict:
        marker = {"id": new_id(), "time": max(0.0, float(time_seconds)), "name": name or "Marker", "color": "#f5c451"}
        project.markers.append(marker)
        project.markers.sort(key=lambda item: float(item.get("time", 0.0)))
        project.dirty = True
        return marker


class ProjectHistory:
    """Snapshot-based history; edits remain data and are never destructively rendered."""

    def __init__(self, limit: int = 100):
        self.limit = max(1, int(limit))
        self._undo: list[dict] = []
        self._redo: list[dict] = []

    @property
    def can_undo(self) -> bool:
        return bool(self._undo)

    @property
    def can_redo(self) -> bool:
        return bool(self._redo)

    def record(self, before: dict, after: dict | None = None) -> None:
        if after is not None and before == after:
            return
        self._undo.append(deepcopy(before))
        if len(self._undo) > self.limit:
            self._undo.pop(0)
        self._redo.clear()

    def undo(self, project: Project) -> Project:
        if not self._undo:
            raise TimelineError("There is no edit to undo")
        self._redo.append(deepcopy(project.to_dict()))
        restored = Project.from_dict(self._undo.pop())
        restored.path = project.path
        restored.dirty = True
        return restored

    def redo(self, project: Project) -> Project:
        if not self._redo:
            raise TimelineError("There is no edit to redo")
        self._undo.append(deepcopy(project.to_dict()))
        restored = Project.from_dict(self._redo.pop())
        restored.path = project.path
        restored.dirty = True
        return restored

    def clear(self) -> None:
        self._undo.clear()
        self._redo.clear()
