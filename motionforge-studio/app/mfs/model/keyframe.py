"""Keyframes and animation tracks.

A :class:`Track` holds the animation curve of a single scalar property
(``pos.x``, ``rotation``, ``opacity`` ...).  Tracks are interpolated by the
engine every frame - the value the user sees on the canvas is always the value
the engine computed, which is what makes exported video identical to the
preview.
"""
from __future__ import annotations

import itertools
import math
from dataclasses import dataclass, field

from .easing import apply_easing, lerp, lerp_angle

_ids = itertools.count(1)


def new_id(prefix: str = "id") -> str:
    return f"{prefix}{next(_ids):05d}"


@dataclass
class Keyframe:
    frame: int
    value: float
    easing: str = "ease_in_out"
    bezier: tuple[float, float, float, float] = (0.42, 0.0, 0.58, 1.0)
    uid: str = field(default_factory=lambda: new_id("k"))

    def to_dict(self) -> dict:
        d = {
            "frame": self.frame,
            "value": self.value,
            "easing": self.easing,
            "uid": self.uid,
        }
        if self.easing == "custom":
            d["bezier"] = list(self.bezier)
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "Keyframe":
        b = d.get("bezier") or (0.42, 0.0, 0.58, 1.0)
        return cls(
            frame=int(d["frame"]),
            value=float(d["value"]),
            easing=d.get("easing", "ease_in_out"),
            bezier=tuple(b),  # type: ignore[arg-type]
            uid=d.get("uid") or new_id("k"),
        )


@dataclass
class Track:
    """An animation curve for one scalar property."""

    name: str = "value"
    default: float = 0.0
    keys: list[Keyframe] = field(default_factory=list)
    angular: bool = False
    unit: str = ""
    minimum: float | None = None
    maximum: float | None = None
    enabled: bool = True

    # ---------------------------------------------------------------- queries
    @property
    def animated(self) -> bool:
        return len(self.keys) > 0

    def sorted_keys(self) -> list[Keyframe]:
        return sorted(self.keys, key=lambda k: k.frame)

    def frames(self) -> list[int]:
        return [k.frame for k in self.sorted_keys()]

    def key_at(self, frame: int) -> Keyframe | None:
        for k in self.keys:
            if k.frame == frame:
                return k
        return None

    def range(self) -> tuple[int, int] | None:
        if not self.keys:
            return None
        fr = self.frames()
        return (fr[0], fr[-1])

    # ------------------------------------------------------------ evaluation
    def value_at(self, frame: float) -> float:
        if not self.keys:
            return self.default
        keys = self.sorted_keys()
        if frame <= keys[0].frame:
            return keys[0].value
        if frame >= keys[-1].frame:
            return keys[-1].value
        for i in range(len(keys) - 1):
            a, b = keys[i], keys[i + 1]
            if a.frame <= frame <= b.frame:
                span = b.frame - a.frame
                if span <= 0:
                    return b.value
                t = (frame - a.frame) / span
                e = apply_easing(a.easing, t, a.bezier)
                if a.easing in ("hold", "step"):
                    return a.value
                return lerp_angle(a.value, b.value, e) if self.angular else lerp(a.value, b.value, e)
        return keys[-1].value

    def restore_key(self, data: dict) -> Keyframe:
        """Re-insert a previously removed key (keeps uid / easing / bezier)."""
        key = Keyframe.from_dict(data)
        self.keys = [k for k in self.keys if k.frame != key.frame]
        self.keys.append(key)
        self.keys.sort(key=lambda k: k.frame)
        return key

    # ------------------------------------------------------------- mutation
    def set_key(self, frame: int, value: float, easing: str | None = None,
                bezier: tuple[float, float, float, float] | None = None) -> Keyframe:
        """Create or update the key at ``frame`` (returns the key)."""
        if self.minimum is not None:
            value = max(self.minimum, value)
        if self.maximum is not None:
            value = min(self.maximum, value)
        k = self.key_at(frame)
        if k is None:
            k = Keyframe(frame=frame, value=value)
            if easing:
                k.easing = easing
            if bezier:
                k.bezier = bezier
            # inherit easing of the preceding key (typical DCC behaviour)
            prev = [x for x in self.sorted_keys() if x.frame < frame]
            if prev and easing is None:
                k.easing = prev[-1].easing
                k.bezier = prev[-1].bezier
            self.keys.append(k)
        else:
            k.value = value
            if easing:
                k.easing = easing
            if bezier:
                k.bezier = bezier
                k.easing = "custom"
        self.keys.sort(key=lambda x: x.frame)
        return k

    def remove_key(self, frame: int) -> bool:
        k = self.key_at(frame)
        if k is None:
            return False
        self.keys.remove(k)
        return True

    def move_key(self, frame: int, new_frame: int) -> bool:
        if new_frame < 0:
            return False
        k = self.key_at(frame)
        if k is None:
            return False
        other = self.key_at(new_frame)
        if other is not None and other is not k:
            self.keys.remove(other)
        k.frame = int(new_frame)
        self.keys.sort(key=lambda x: x.frame)
        return True

    def retime(self, factor: float, offset: int = 0) -> None:
        for k in self.keys:
            k.frame = max(0, int(round(k.frame * factor)) + offset)
        self.keys.sort(key=lambda x: x.frame)

    def clear(self) -> None:
        self.keys.clear()

    def copy(self) -> "Track":
        t = Track(self.name, self.default, [Keyframe.from_dict(k.to_dict()) for k in self.keys],
                  self.angular, self.unit, self.minimum, self.maximum, self.enabled)
        return t

    # ------------------------------------------------------------------- io
    def to_dict(self) -> dict:
        return {
            "name": self.name,
            "default": self.default,
            "angular": self.angular,
            "unit": self.unit,
            "minimum": self.minimum,
            "maximum": self.maximum,
            "enabled": self.enabled,
            "keys": [k.to_dict() for k in self.sorted_keys()],
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Track":
        t = cls(
            name=d.get("name", "value"),
            default=float(d.get("default", 0.0)),
            angular=bool(d.get("angular", False)),
            unit=d.get("unit", ""),
            minimum=d.get("minimum"),
            maximum=d.get("maximum"),
            enabled=bool(d.get("enabled", True)),
        )
        t.keys = [Keyframe.from_dict(k) for k in d.get("keys", [])]
        t.keys.sort(key=lambda k: k.frame)
        return t


# --------------------------------------------------------------------------
# transform bundles
# --------------------------------------------------------------------------
TRANSFORM_PROPS = (
    "pos.x", "pos.y", "rotation", "scale.x", "scale.y",
    "skew.x", "skew.y", "opacity", "anchor.x", "anchor.y",
)

PROP_LABELS = {
    "pos.x": "Position X",
    "pos.y": "Position Y",
    "rotation": "Rotation",
    "scale.x": "Scale X",
    "scale.y": "Scale Y",
    "skew.x": "Skew X",
    "skew.y": "Skew Y",
    "opacity": "Opacity",
    "anchor.x": "Anchor X",
    "anchor.y": "Anchor Y",
}


def make_transform_tracks() -> dict[str, Track]:
    return {
        "pos.x": Track("pos.x", 0.0, unit="px"),
        "pos.y": Track("pos.y", 0.0, unit="px"),
        "rotation": Track("rotation", 0.0, angular=True, unit="deg"),
        "scale.x": Track("scale.x", 100.0, unit="%"),
        "scale.y": Track("scale.y", 100.0, unit="%"),
        "skew.x": Track("skew.x", 0.0, angular=True, unit="deg"),
        "skew.y": Track("skew.y", 0.0, angular=True, unit="deg"),
        "opacity": Track("opacity", 100.0, unit="%", minimum=0.0, maximum=100.0),
        "anchor.x": Track("anchor.x", 0.0, unit="px"),
        "anchor.y": Track("anchor.y", 0.0, unit="px"),
    }


@dataclass
class TransformValue:
    """Resolved transform for a layer/character at a point in time."""

    x: float = 0.0
    y: float = 0.0
    rotation: float = 0.0
    scale_x: float = 100.0
    scale_y: float = 100.0
    skew_x: float = 0.0
    skew_y: float = 0.0
    opacity: float = 100.0
    anchor_x: float = 0.0
    anchor_y: float = 0.0

    def is_identity(self) -> bool:
        return (
            self.x == 0.0 and self.y == 0.0 and self.rotation == 0.0
            and self.scale_x == 100.0 and self.scale_y == 100.0
            and self.skew_x == 0.0 and self.skew_y == 0.0
            and self.anchor_x == 0.0 and self.anchor_y == 0.0
        )

    def to_dict(self) -> dict:
        return {
            "x": self.x, "y": self.y, "rotation": self.rotation,
            "scale_x": self.scale_x, "scale_y": self.scale_y,
            "skew_x": self.skew_x, "skew_y": self.skew_y,
            "opacity": self.opacity,
            "anchor_x": self.anchor_x, "anchor_y": self.anchor_y,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "TransformValue":
        return cls(
            x=d.get("x", 0.0), y=d.get("y", 0.0), rotation=d.get("rotation", 0.0),
            scale_x=d.get("scale_x", 100.0), scale_y=d.get("scale_y", 100.0),
            skew_x=d.get("skew_x", 0.0), skew_y=d.get("skew_y", 0.0),
            opacity=d.get("opacity", 100.0),
            anchor_x=d.get("anchor_x", 0.0), anchor_y=d.get("anchor_y", 0.0),
        )

    def blend(self, other: "TransformValue", t: float) -> "TransformValue":
        def m(a: float, b: float, ang: bool = False) -> float:
            return lerp_angle(a, b, t) if ang else lerp(a, b, t)
        return TransformValue(
            x=m(self.x, other.x), y=m(self.y, other.y),
            rotation=m(self.rotation, other.rotation, True),
            scale_x=m(self.scale_x, other.scale_x), scale_y=m(self.scale_y, other.scale_y),
            skew_x=m(self.skew_x, other.skew_x), skew_y=m(self.skew_y, other.skew_y),
            opacity=m(self.opacity, other.opacity),
            anchor_x=m(self.anchor_x, other.anchor_x), anchor_y=m(self.anchor_y, other.anchor_y),
        )


class TransformTracks:
    """Bundle of per-property tracks for one animated object."""

    def __init__(self, tracks: dict[str, Track] | None = None):
        self.tracks: dict[str, Track] = tracks or make_transform_tracks()

    def __setitem__(self, key: str, track: Track) -> None:
        self.tracks[key] = track

    def __getitem__(self, key: str) -> Track:
        if key not in self.tracks:
            self.tracks[key] = Track(key, 0.0)
        return self.tracks[key]

    def get(self, key: str) -> Track | None:
        return self.tracks.get(key)

    def value_at(self, frame: float) -> TransformValue:
        t = self.tracks
        return TransformValue(
            x=t["pos.x"].value_at(frame), y=t["pos.y"].value_at(frame),
            rotation=t["rotation"].value_at(frame),
            scale_x=t["scale.x"].value_at(frame), scale_y=t["scale.y"].value_at(frame),
            skew_x=t["skew.x"].value_at(frame), skew_y=t["skew.y"].value_at(frame),
            opacity=t["opacity"].value_at(frame),
            anchor_x=t["anchor.x"].value_at(frame), anchor_y=t["anchor.y"].value_at(frame),
        )

    def animated_props(self) -> list[str]:
        return [k for k, t in self.tracks.items() if t.animated]

    def key_frames(self) -> set[int]:
        out: set[int] = set()
        for t in self.tracks.values():
            out.update(t.frames())
        return out

    def set_from_value(self, value: TransformValue, frame: int, only_animated: bool = False) -> None:
        mapping = {
            "pos.x": value.x, "pos.y": value.y, "rotation": value.rotation,
            "scale.x": value.scale_x, "scale.y": value.scale_y,
            "skew.x": value.skew_x, "skew.y": value.skew_y,
            "opacity": value.opacity,
            "anchor.x": value.anchor_x, "anchor.y": value.anchor_y,
        }
        for prop, val in mapping.items():
            tr = self.tracks.get(prop)
            if tr is None:
                continue
            if only_animated and not tr.animated:
                continue
            tr.set_key(int(frame), float(val))

    def shift(self, frames: int) -> None:
        for t in self.tracks.values():
            for k in t.keys:
                k.frame += frames

    def to_dict(self) -> dict:
        return {k: t.to_dict() for k, t in self.tracks.items()}

    @classmethod
    def from_dict(cls, d: dict) -> "TransformTracks":
        tracks = make_transform_tracks()
        for k, v in (d or {}).items():
            tracks[k] = Track.from_dict(v)
        return cls(tracks)

    def copy(self) -> "TransformTracks":
        return TransformTracks.from_dict(self.to_dict())
