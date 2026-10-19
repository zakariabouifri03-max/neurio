"""Multitrack timeline data model.

Everything here is plain serialisable data plus non-destructive query helpers.
Mutations performed through the UI are wrapped in undoable commands
(see :mod:`novacut.editing.operations`).
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass, field, asdict
from typing import Optional

from .enums import ClipKind, TrackKind, MarkerColor, TitleAnimation
from .effects import Effect, Transition, Keyframe
from .media import new_id


# --------------------------------------------------------------------- clips
@dataclass
class Clip:
    kind: str = ClipKind.VIDEO.value
    id: str = field(default_factory=lambda: new_id("clip"))
    track_id: str = ""
    media_id: Optional[str] = None
    name: str = ""
    # Position/length on the timeline (seconds).
    start: float = 0.0
    duration: float = 5.0
    # Source in-point (seconds). Source out-point is source_in + source_duration.
    source_in: float = 0.0
    source_duration: float = 5.0
    speed: float = 1.0
    enabled: bool = True
    locked: bool = False
    # Visual transform.
    pos_x: float = 0.0          # pixel offset from centered position
    pos_y: float = 0.0
    scale: float = 1.0
    rotation: float = 0.0       # degrees
    anchor_x: float = 0.5       # normalized 0..1
    anchor_y: float = 0.5
    opacity: float = 1.0
    crop_left: float = 0.0      # normalized 0..1
    crop_right: float = 0.0
    crop_top: float = 0.0
    crop_bottom: float = 0.0
    # Audio.
    gain: float = 1.0
    muted: bool = False
    fade_in: float = 0.0
    fade_out: float = 0.0
    # Effects / motion / transitions.
    effects: list[Effect] = field(default_factory=list)
    keyframes: list[Keyframe] = field(default_factory=list)
    transition_in: Optional[Transition] = None
    transition_out: Optional[Transition] = None
    # Generators.
    color: str = "#101317"      # COLOR clips
    text_params: dict = field(default_factory=lambda: {
        "text": "Title",
        "font_family": "Arial",
        "font_size": 72,
        "color": "#ffffff",
        "background": "",
        "stroke_color": "#000000",
        "stroke_width": 0,
        "bold": False,
        "italic": False,
        "align": "center",
        "position_x": 0.5,
        "position_y": 0.5,
        "box_width": 0.9,
        "animation": TitleAnimation.NONE.value,
    })

    # ------------------------------------------------------------- geometry
    @property
    def end(self) -> float:
        return self.start + self.duration

    @property
    def source_out(self) -> float:
        return self.source_in + self.source_duration

    def overlaps(self, start: float, end: float) -> bool:
        return self.start < end and self.end > start

    def value_at(self, prop: str, time: float, default: float | None = None) -> float:
        """Interpolated keyframe value for *prop* at timeline *time*."""
        keys = sorted((k for k in self.keyframes if k.property == prop),
                      key=lambda k: k.time)
        if not keys:
            return getattr(self, prop, default) if hasattr(self, prop) else default
        if time <= keys[0].time:
            return keys[0].value
        if time >= keys[-1].time:
            return keys[-1].value
        for a, b in zip(keys, keys[1:]):
            if a.time <= time <= b.time:
                span = b.time - a.time
                t = 0.0 if span == 0 else (time - a.time) / span
                t = _apply_easing(t, b.easing)
                return a.value + (b.value - a.value) * t
        return default

    def add_keyframe(self, prop: str, time: float, value: float,
                     easing: str = "linear") -> Keyframe:
        for k in self.keyframes:
            if k.property == prop and abs(k.time - time) < 1e-6:
                k.value, k.easing = value, easing
                return k
        kf = Keyframe(prop, time, value, easing)
        self.keyframes.append(kf)
        self.keyframes.sort(key=lambda k: k.time)
        return kf

    def remove_keyframe(self, keyframe_id: int) -> None:
        # Keyframes have no id; remove by object index via caller; kept simple.
        del self.keyframes[keyframe_id]

    # ---------------------------------------------------------- serialization
    def to_dict(self) -> dict:
        d = asdict(self)
        d["effects"] = [e.to_dict() for e in self.effects]
        d["keyframes"] = [k.to_dict() for k in self.keyframes]
        d["transition_in"] = self.transition_in.to_dict() if self.transition_in else None
        d["transition_out"] = self.transition_out.to_dict() if self.transition_out else None
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "Clip":
        d = dict(d)
        d["effects"] = [Effect.from_dict(e) for e in d.get("effects", [])]
        d["keyframes"] = [Keyframe.from_dict(k) for k in d.get("keyframes", [])]
        d["transition_in"] = Transition.from_dict(d["transition_in"]) if d.get("transition_in") else None
        d["transition_out"] = Transition.from_dict(d["transition_out"]) if d.get("transition_out") else None
        known = set(cls.__dataclass_fields__)  # type: ignore[attr-defined]
        return cls(**{k: v for k, v in d.items() if k in known})


def _apply_easing(t: float, easing: str) -> float:
    if easing == "ease_in":
        return t * t
    if easing == "ease_out":
        return 1.0 - (1.0 - t) ** 2
    if easing == "smooth":
        return t * t * (3.0 - 2.0 * t)
    return t


# --------------------------------------------------------------------- tracks
@dataclass
class Track:
    kind: str = TrackKind.VIDEO.value
    id: str = field(default_factory=lambda: new_id("track"))
    name: str = "Track"
    locked: bool = False
    hidden: bool = False
    clips: list[Clip] = field(default_factory=list)

    def sorted_clips(self) -> list[Clip]:
        return sorted(self.clips, key=lambda c: c.start)

    def clip_at(self, time: float) -> Optional[Clip]:
        for c in self.clips:
            if c.start <= time < c.end:
                return c
        return None

    def overlapping(self, start: float, end: float,
                    exclude: Optional[str] = None) -> list[Clip]:
        return [c for c in self.clips
                if c.id != exclude and c.overlaps(start, end)]

    def to_dict(self) -> dict:
        return {
            "kind": self.kind, "id": self.id, "name": self.name,
            "locked": self.locked, "hidden": self.hidden,
            "clips": [c.to_dict() for c in self.sorted_clips()],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Track":
        return cls(
            kind=d.get("kind", TrackKind.VIDEO.value),
            id=d.get("id", new_id("track")),
            name=d.get("name", "Track"),
            locked=d.get("locked", False),
            hidden=d.get("hidden", False),
            clips=[Clip.from_dict(c) for c in d.get("clips", [])],
        )


# -------------------------------------------------------------------- markers
@dataclass
class Marker:
    time: float
    label: str = ""
    color: str = MarkerColor.YELLOW.value
    id: str = field(default_factory=lambda: new_id("mk"))

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Marker":
        return cls(time=float(d["time"]), label=d.get("label", ""),
                   color=d.get("color", MarkerColor.YELLOW.value),
                   id=d.get("id", new_id("mk")))


# ------------------------------------------------------------------- timeline
@dataclass
class Timeline:
    tracks: list[Track] = field(default_factory=list)
    markers: list[Marker] = field(default_factory=list)
    duration_hint: float = 0.0          # 0 = derive from clips

    # ------------------------------------------------------------- queries
    def video_tracks(self) -> list[Track]:
        return [t for t in self.tracks if t.kind == TrackKind.VIDEO.value]

    def audio_tracks(self) -> list[Track]:
        return [t for t in self.tracks if t.kind == TrackKind.AUDIO.value]

    def track_by_id(self, track_id: str) -> Optional[Track]:
        return next((t for t in self.tracks if t.id == track_id), None)

    def clip_by_id(self, clip_id: str) -> Optional[Clip]:
        for t in self.tracks:
            for c in t.clips:
                if c.id == clip_id:
                    return c
        return None

    def all_clips(self) -> list[Clip]:
        return [c for t in self.tracks for c in t.clips]

    def duration(self) -> float:
        ends = [c.end for t in self.tracks for c in t.clips if c.enabled]
        return max(ends + [self.duration_hint, 0.0])

    def snap_candidates(self, include_markers: bool = True) -> list[float]:
        pts: list[float] = [0.0]
        for t in self.tracks:
            for c in t.clips:
                pts.extend((c.start, c.end))
        if include_markers:
            pts.extend(m.time for m in self.markers)
        return sorted(set(pts))

    def add_track(self, kind: str = TrackKind.VIDEO.value, name: str = "",
                  index: Optional[int] = None) -> Track:
        count_v = len(self.video_tracks()) + 1
        count_a = len(self.audio_tracks()) + 1
        track = Track(kind=kind,
                      name=name or (f"Video {count_v}" if kind == TrackKind.VIDEO.value
                                    else f"Audio {count_a}"))
        if index is None:
            self.tracks.append(track)
        else:
            self.tracks.insert(index, track)
        return track

    def remove_track(self, track_id: str) -> Optional[Track]:
        t = self.track_by_id(track_id)
        if t:
            self.tracks.remove(t)
        return t

    def add_clip(self, clip: Clip, track_id: str,
                 allow_overlap: bool = False) -> Clip:
        track = self.track_by_id(track_id)
        if track is None:
            raise KeyError(f"Unknown track {track_id}")
        if not allow_overlap and track.overlapping(clip.start, clip.end, clip.id):
            raise ValueError("Clip overlaps another clip on this track")
        clip.track_id = track_id
        track.clips.append(clip)
        track.clips.sort(key=lambda c: c.start)
        return clip

    def remove_clip(self, clip_id: str) -> Optional[Clip]:
        for t in self.tracks:
            for c in t.clips:
                if c.id == clip_id:
                    t.clips.remove(c)
                    return c
        return None

    def add_marker(self, time: float, label: str = "",
                   color: str = MarkerColor.YELLOW.value) -> Marker:
        m = Marker(time=time, label=label, color=color)
        self.markers.append(m)
        self.markers.sort(key=lambda x: x.time)
        return m

    def to_dict(self) -> dict:
        return {
            "tracks": [t.to_dict() for t in self.tracks],
            "markers": [m.to_dict() for m in self.markers],
            "duration_hint": self.duration_hint,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Timeline":
        return cls(
            tracks=[Track.from_dict(t) for t in d.get("tracks", [])],
            markers=[Marker.from_dict(m) for m in d.get("markers", [])],
            duration_hint=float(d.get("duration_hint", 0.0)),
        )

    @classmethod
    def new_default(cls) -> "Timeline":
        tl = cls()
        tl.add_track(TrackKind.VIDEO.value, "Video 1")
        tl.add_track(TrackKind.VIDEO.value, "Video 2")
        tl.add_track(TrackKind.AUDIO.value, "Audio 1")
        tl.add_track(TrackKind.AUDIO.value, "Audio 2")
        return tl
