"""Non-linear timeline model (Qt-free).

Tracks hold clips positioned in *timeline seconds*.  All editing operations
(split / trim / move / ripple-delete) are pure model operations returning
clips; the UI binds to this model and serialises it into the project file.

Keyframe support is generic: any animatable property (position, scale,
rotation, opacity, volume…) keeps a sorted list of keyframes with linear or
hold interpolation, evaluated with :func:`keyframe_value`.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any


def new_id() -> str:
    return uuid.uuid4().hex[:10]


@dataclass
class Keyframe:
    time: float
    value: float
    interp: str = "linear"  # linear | hold


def keyframe_value(keys: list[Keyframe], t: float, default: float = 0.0) -> float:
    if not keys:
        return default
    if t <= keys[0].time:
        return keys[0].value
    if t >= keys[-1].time:
        return keys[-1].value
    for a, b in zip(keys, keys[1:]):
        if a.time <= t <= b.time:
            if b.interp == "hold" or b.time == a.time:
                return a.value
            f = (t - a.time) / (b.time - a.time)
            return a.value + (b.value - a.value) * f
    return keys[-1].value


@dataclass
class Effect:
    """A parameterised effect applied at export time."""
    kind: str                 # brightness|contrast|saturation|speed|rotate|crop|
                              # chroma_key|fade_video|fade_audio|stabilize|denoise
    params: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {"kind": self.kind, "params": dict(self.params)}

    @classmethod
    def from_dict(cls, d: dict) -> "Effect":
        return cls(kind=d["kind"], params=dict(d.get("params", {})))


@dataclass
class Clip:
    source: str                      # media file path
    start: float                     # timeline position (s)
    in_point: float = 0.0            # source in (s)
    out_point: float | None = None   # source out (s); None = end of source
    name: str = ""
    id: str = field(default_factory=new_id)
    speed: float = 1.0               # 0.25 .. 4 ; negative = reverse
    volume: float = 1.0
    opacity: float = 1.0
    effects: list[Effect] = field(default_factory=list)
    keyframes: dict[str, list[Keyframe]] = field(default_factory=dict)
    transition_in: str | None = None     # none|fade|wipe
    transition_in_dur: float = 0.5
    source_duration: float | None = None

    # ------------------------------------------------------------
    @property
    def in_resolved(self) -> float:
        return max(0.0, self.in_point)

    @property
    def out_resolved(self) -> float:
        if self.out_point is None:
            return self.source_duration or (self.in_point + 1.0)
        return max(self.in_point + 0.04, self.out_point)

    @property
    def source_len(self) -> float:
        return self.out_resolved - self.in_resolved

    @property
    def duration(self) -> float:
        """Timeline duration taking speed into account."""
        return self.source_len / abs(self.speed) if self.speed else self.source_len

    @property
    def end(self) -> float:
        return self.start + self.duration

    def contains(self, t: float) -> bool:
        return self.start <= t < self.end

    def to_dict(self) -> dict:
        return {
            "id": self.id, "source": self.source, "name": self.name,
            "start": self.start, "in_point": self.in_point,
            "out_point": self.out_point, "speed": self.speed,
            "volume": self.volume, "opacity": self.opacity,
            "effects": [e.to_dict() for e in self.effects],
            "keyframes": {k: [{"t": kf.time, "v": kf.value, "i": kf.interp}
                              for kf in v] for k, v in self.keyframes.items()},
            "transition_in": self.transition_in,
            "transition_in_dur": self.transition_in_dur,
            "source_duration": self.source_duration,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Clip":
        c = cls(source=d["source"], start=d.get("start", 0.0),
                in_point=d.get("in_point", 0.0), out_point=d.get("out_point"),
                name=d.get("name", ""), id=d.get("id", new_id()),
                speed=d.get("speed", 1.0), volume=d.get("volume", 1.0),
                opacity=d.get("opacity", 1.0),
                transition_in=d.get("transition_in"),
                transition_in_dur=d.get("transition_in_dur", 0.5),
                source_duration=d.get("source_duration"))
        c.effects = [Effect.from_dict(e) for e in d.get("effects", [])]
        c.keyframes = {
            k: [Keyframe(kf["t"], kf["v"], kf.get("i", "linear")) for kf in v]
            for k, v in d.get("keyframes", {}).items()
        }
        return c


@dataclass
class Track:
    kind: str                        # video | audio
    name: str = ""
    id: str = field(default_factory=new_id)
    muted: bool = False
    locked: bool = False
    clips: list[Clip] = field(default_factory=list)

    def sorted_clips(self) -> list[Clip]:
        return sorted(self.clips, key=lambda c: c.start)

    def clip_at(self, t: float) -> Clip | None:
        for c in self.clips:
            if c.contains(t):
                return c
        return None

    def duration(self) -> float:
        return max((c.end for c in self.clips), default=0.0)

    def to_dict(self) -> dict:
        return {"id": self.id, "kind": self.kind, "name": self.name,
                "muted": self.muted, "locked": self.locked,
                "clips": [c.to_dict() for c in self.clips]}

    @classmethod
    def from_dict(cls, d: dict) -> "Track":
        t = cls(kind=d.get("kind", "video"), name=d.get("name", ""),
                id=d.get("id", new_id()), muted=d.get("muted", False),
                locked=d.get("locked", False))
        t.clips = [Clip.from_dict(c) for c in d.get("clips", [])]
        return t


class Timeline:
    """Multi-track timeline with validation."""

    def __init__(self, fps: float = 30.0):
        self.fps = fps
        self.tracks: list[Track] = []

    # ------------------------------------------------------------
    def add_track(self, kind: str = "video", name: str = "") -> Track:
        t = Track(kind=kind, name=name or f"{kind.capitalize()} {sum(1 for x in self.tracks if x.kind == kind) + 1}")
        self.tracks.append(t)
        return t

    def track(self, track_id: str) -> Track | None:
        return next((t for t in self.tracks if t.id == track_id), None)

    def find_clip(self, clip_id: str) -> tuple[Track, Clip] | None:
        for t in self.tracks:
            for c in t.clips:
                if c.id == clip_id:
                    return t, c
        return None

    def duration(self) -> float:
        return max((t.duration() for t in self.tracks), default=0.0)

    def overlaps(self, track: Track, start: float, duration: float,
                 ignore: Clip | None = None) -> Clip | None:
        end = start + duration
        for c in track.clips:
            if ignore is not None and c.id == ignore.id:
                continue
            if start < c.end and end > c.start:
                return c
        return None

    def add_clip(self, track: Track, clip: Clip, position: float | None = None) -> Clip:
        """Insert a clip, pushing it past overlaps instead of stacking."""
        if track.locked:
            raise ValueError("track is locked")
        clip.start = max(0.0, position if position is not None else clip.start)
        blocker = self.overlaps(track, clip.start, clip.duration)
        while blocker:
            clip.start = blocker.end + 0.001
            blocker = self.overlaps(track, clip.start, clip.duration)
        track.clips.append(clip)
        return clip

    def move_clip(self, clip_id: str, new_start: float) -> bool:
        loc = self.find_clip(clip_id)
        if not loc:
            return False
        track, clip = loc
        if track.locked:
            return False
        new_start = max(0.0, new_start)
        blocker = self.overlaps(track, new_start, clip.duration, ignore=clip)
        if blocker:
            return False
        clip.start = new_start
        return True

    def split_clip(self, clip_id: str, at: float) -> tuple[Clip, Clip] | None:
        """Split clip at timeline time ``at``; returns (left, right)."""
        loc = self.find_clip(clip_id)
        if not loc:
            return None
        track, clip = loc
        if not clip.contains(at) or abs(at - clip.start) < 0.02 \
                or abs(at - clip.end) < 0.02:
            return None
        offset = (at - clip.start) * abs(clip.speed)
        left = Clip(source=clip.source, start=clip.start,
                    in_point=clip.in_resolved,
                    out_point=clip.in_resolved + offset,
                    name=clip.name, speed=clip.speed, volume=clip.volume,
                    opacity=clip.opacity, effects=list(clip.effects),
                    source_duration=clip.source_duration,
                    transition_in=clip.transition_in,
                    transition_in_dur=clip.transition_in_dur)
        right = Clip(source=clip.source, start=at,
                     in_point=clip.in_resolved + offset,
                     out_point=clip.out_resolved,
                     name=clip.name, speed=clip.speed, volume=clip.volume,
                     opacity=clip.opacity, effects=list(clip.effects),
                     source_duration=clip.source_duration)
        track.clips.remove(clip)
        track.clips += [left, right]
        return left, right

    def trim_in(self, clip_id: str, new_in: float) -> bool:
        loc = self.find_clip(clip_id)
        if not loc:
            return False
        _, clip = loc
        new_in = max(0.0, min(new_in, clip.out_resolved - 0.04))
        delta = new_in - clip.in_resolved
        clip.in_point = new_in
        clip.start = max(0.0, clip.start + delta / abs(clip.speed))
        return True

    def trim_out(self, clip_id: str, new_out: float) -> bool:
        loc = self.find_clip(clip_id)
        if not loc:
            return False
        _, clip = loc
        clip.out_point = max(clip.in_resolved + 0.04, new_out)
        return True

    def remove_clip(self, clip_id: str, ripple: bool = False) -> bool:
        loc = self.find_clip(clip_id)
        if not loc:
            return False
        track, clip = loc
        track.clips.remove(clip)
        if ripple:
            gap = clip.duration
            for c in track.clips:
                if c.start >= clip.end - 1e-6:
                    c.start = max(0.0, c.start - gap)
        return True

    def set_speed(self, clip_id: str, speed: float) -> bool:
        loc = self.find_clip(clip_id)
        if not loc:
            return False
        _, clip = loc
        if speed == 0 or not (0.1 <= abs(speed) <= 8.0):
            return False
        clip.speed = speed
        return True

    # ------------------------------------------------------------
    def to_dict(self) -> dict:
        return {"fps": self.fps, "tracks": [t.to_dict() for t in self.tracks]}

    @classmethod
    def from_dict(cls, d: dict) -> "Timeline":
        tl = cls(fps=d.get("fps", 30.0))
        tl.tracks = [Track.from_dict(t) for t in d.get("tracks", [])]
        return tl
