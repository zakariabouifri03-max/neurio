"""Non-linear timeline model: tracks are implicit via Clip.track; times are in seconds."""
from __future__ import annotations

import uuid
from dataclasses import asdict, dataclass, field, fields
from typing import Any, Optional

ASPECTS = {"16:9": (16, 9), "9:16": (9, 16), "1:1": (1, 1), "4:5": (4, 5)}
CLIP_KINDS = ("video", "audio", "image", "text")
MIN_CLIP = 0.04


def canvas_size(aspect: str, short_px: int) -> tuple[int, int]:
    """Canvas size whose *short side* (for landscape: height, portrait: width) is short_px. Even dims."""
    if aspect not in ASPECTS:
        raise ValueError(f"Unsupported aspect ratio: {aspect}")
    rw, rh = ASPECTS[aspect]
    if rw > rh:
        h = short_px
        w = round(short_px * rw / rh)
    elif rw < rh:
        w = short_px
        h = round(short_px * rh / rw)
    else:
        w = h = short_px
    return w + (w % 2), h + (h % 2)


@dataclass
class Clip:
    kind: str
    src: str = ""
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:10])
    track: int = 0
    start: float = 0.0          # position on the timeline (s)
    duration: float = 5.0       # length on the timeline (s)
    in_point: float = 0.0       # offset into the source (s), scaled by speed
    speed: float = 1.0          # 0.25..4; <1 = slow motion
    volume: float = 1.0         # 0..2 (audio)
    fade_in: float = 0.0
    fade_out: float = 0.0
    reverse: bool = False
    rotate: int = 0             # 0, 90, 180, 270 clockwise
    crop: list[float] = field(default_factory=lambda: [0.0, 0.0, 1.0, 1.0])  # x, y, w, h fractions
    brightness: float = 0.0     # -1..1
    contrast: float = 1.0       # 0..2
    saturation: float = 1.0     # 0..3
    gamma: float = 1.0          # 0.1..10 (exposure-like)
    opacity: float = 1.0        # 0..1
    chroma_color: str = ""      # e.g. "#00FF00" to key out; "" disables
    chroma_similarity: float = 0.12
    stabilize: bool = False
    text: str = ""
    text_size: int = 72
    text_color: str = "#FFFFFF"
    text_stroke: int = 0
    text_position: str = "bottom"  # top | center | bottom | "x,y"

    def validate(self) -> None:
        if self.kind not in CLIP_KINDS:
            raise ValueError(f"Unknown clip kind: {self.kind}")
        if self.kind in ("video", "audio", "image") and not self.src:
            raise ValueError("This clip has no source file.")
        if self.kind == "text" and not self.text.strip():
            raise ValueError("Text clips need some text.")
        if self.duration < MIN_CLIP:
            raise ValueError("Clips must be at least 0.04 seconds long.")
        if self.start < 0 or self.in_point < 0:
            raise ValueError("Times cannot be negative.")
        if not 0.25 <= self.speed <= 4.0:
            raise ValueError("Speed must be between 0.25x and 4x.")
        if not 0.0 <= self.volume <= 2.0:
            raise ValueError("Volume must be between 0 and 200%.")
        if self.rotate not in (0, 90, 180, 270):
            raise ValueError("Rotation must be 0, 90, 180 or 270 degrees.")
        if len(self.crop) != 4 or not all(0.0 <= v <= 1.0 for v in self.crop):
            raise ValueError("Crop values must be fractions between 0 and 1.")
        x, y, w, h = self.crop
        if w <= 0 or h <= 0 or x + w > 1.0001 or y + h > 1.0001:
            raise ValueError("Crop rectangle is outside the frame.")
        if not -1.0 <= self.brightness <= 1.0:
            raise ValueError("Brightness must be between -1 and 1.")
        if not 0.0 <= self.contrast <= 2.0 or not 0.0 <= self.saturation <= 3.0:
            raise ValueError("Contrast or saturation is out of range.")
        if not 0.1 <= self.gamma <= 10.0:
            raise ValueError("Gamma must be between 0.1 and 10.")
        if not 0.0 <= self.opacity <= 1.0:
            raise ValueError("Opacity must be between 0 and 1.")
        if self.fade_in < 0 or self.fade_out < 0 or self.fade_in + self.fade_out > self.duration + 1e-6:
            raise ValueError("Fades are longer than the clip.")

    @property
    def end(self) -> float:
        return self.start + self.duration

    @property
    def source_end(self) -> float:
        return self.in_point + self.duration * self.speed


_CLIP_FIELDS = {f.name for f in fields(Clip)}


@dataclass
class Timeline:
    aspect: str = "16:9"
    short_px: int = 1080
    fps: int = 30
    clips: list[Clip] = field(default_factory=list)

    @property
    def size(self) -> tuple[int, int]:
        return canvas_size(self.aspect, self.short_px)

    def duration(self) -> float:
        return max((c.end for c in self.clips), default=0.0)

    def get(self, clip_id: str) -> Clip:
        for c in self.clips:
            if c.id == clip_id:
                return c
        raise KeyError(f"No clip with id {clip_id}")

    def add(self, clip: Clip) -> Clip:
        clip.validate()
        self.clips.append(clip)
        return clip

    def remove(self, clip_id: str) -> None:
        self.get(clip_id)
        self.clips = [c for c in self.clips if c.id != clip_id]

    def split(self, clip_id: str, t: float) -> tuple[Clip, Clip]:
        """Split clip at timeline time t. Returns (left, right); the original id is kept on the left."""
        c = self.get(clip_id)
        if not (c.start + MIN_CLIP < t < c.end - MIN_CLIP):
            raise ValueError("The playhead must be inside the clip (not at its edges).")
        offset = t - c.start
        right = Clip(**{**asdict(c), "id": uuid.uuid4().hex[:10], "start": t,
                        "duration": c.duration - offset,
                        "in_point": c.in_point + offset * c.speed,
                        "fade_in": 0.0, "fade_out": c.fade_out})
        c.duration = offset
        c.fade_out = 0.0
        self.clips.append(right)
        return c, right

    def trim(self, clip_id: str, *, head: float = 0.0, tail: float = 0.0) -> None:
        """Remove `head` seconds from the start and `tail` seconds from the end (timeline seconds)."""
        c = self.get(clip_id)
        if head < 0 or tail < 0 or head + tail > c.duration - MIN_CLIP:
            raise ValueError("Trim would leave the clip empty.")
        if head:
            c.in_point += head * c.speed
            c.start += head
            c.duration -= head
        if tail:
            c.duration -= tail

    def move(self, clip_id: str, start: float, track: Optional[int] = None) -> None:
        if start < 0:
            raise ValueError("A clip cannot start before 0 seconds.")
        c = self.get(clip_id)
        c.start = start
        if track is not None:
            c.track = max(0, int(track))

    def sorted_clips(self) -> list[Clip]:
        return sorted(self.clips, key=lambda c: (c.track, c.start))

    def validate(self) -> None:
        if self.aspect not in ASPECTS:
            raise ValueError("Unsupported aspect ratio.")
        if not 240 <= self.short_px <= 4320:
            raise ValueError("Resolution must be between 240 and 4320 pixels.")
        if not 1 <= self.fps <= 120:
            raise ValueError("Frame rate must be between 1 and 120 fps.")
        for c in self.clips:
            c.validate()

    # --- serialization -----------------------------------------------------
    def to_dict(self) -> dict[str, Any]:
        return {"aspect": self.aspect, "short_px": self.short_px, "fps": self.fps,
                "clips": [asdict(c) for c in self.clips]}

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Timeline":
        clips = []
        for raw in data.get("clips", []):
            clean = {k: v for k, v in raw.items() if k in _CLIP_FIELDS}
            clip = Clip(**clean)
            clip.validate()
            clips.append(clip)
        tl = cls(aspect=data.get("aspect", "16:9"), short_px=int(data.get("short_px", 1080)),
                 fps=int(data.get("fps", 30)), clips=clips)
        tl.validate()
        return tl
