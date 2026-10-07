"""2D camera system: position / zoom / rotation keyframes, shake, shots."""
from __future__ import annotations

import math
import random
from dataclasses import dataclass, field

from .keyframe import Track, new_id


@dataclass
class Shot:
    """A storyboard entry: which camera covers which frame range."""

    name: str = "Shot"
    start: int = 1
    end: int = 48
    camera_uid: str = ""
    note: str = ""
    uid: str = field(default_factory=lambda: new_id("shot"))
    color: str = "#4f8cff"

    def contains(self, frame: int) -> bool:
        return self.start <= frame <= self.end

    def to_dict(self) -> dict:
        return {"uid": self.uid, "name": self.name, "start": self.start, "end": self.end,
                "camera_uid": self.camera_uid, "note": self.note, "color": self.color}

    @classmethod
    def from_dict(cls, d: dict) -> "Shot":
        s = cls(d.get("name", "Shot"), int(d.get("start", 1)), int(d.get("end", 48)),
                d.get("camera_uid", ""), d.get("note", ""), color=d.get("color", "#4f8cff"))
        s.uid = d.get("uid") or s.uid
        return s


class Camera:
    """Virtual 2D camera.  Values are in scene/canvas pixels."""

    def __init__(self, name: str = "Camera 1", size: tuple[int, int] = (1920, 1080)):
        self.uid: str = new_id("cam")
        self.name = name
        self.width, self.height = int(size[0]), int(size[1])
        self.pos_x = Track("pos.x", self.width / 2, unit="px")
        self.pos_y = Track("pos.y", self.height / 2, unit="px")
        self.zoom = Track("zoom", 100.0, unit="%")
        self.rotation = Track("rotation", 0.0, angular=True, unit="deg")
        self.roll = Track("roll", 0.0, unit="%")  # unused placeholder for future

        self.shake_amplitude = 0.0
        self.shake_frequency = 8.0
        self.shake_decay = 0.9
        self.shake_duration = 12
        self.shake_frame = -1
        self.shake_seed = 1234

        self.follow_layer_uid: str | None = None
        self.follow_smoothing = 0.5
        self.follow_offset = (0.0, 0.0)
        self.locked = False

    # ------------------------------------------------------------------ util
    def value_at(self, frame: float) -> dict[str, float]:
        return {
            "x": self.pos_x.value_at(frame),
            "y": self.pos_y.value_at(frame),
            "zoom": max(1.0, self.zoom.value_at(frame)),
            "rotation": self.rotation.value_at(frame),
            "shake_x": 0.0,
            "shake_y": 0.0,
            "shake_rot": 0.0,
        }

    def shake_at(self, frame: float) -> tuple[float, float, float]:
        """Deterministic camera shake around ``shake_frame``."""
        if self.shake_frame < 0 or self.shake_amplitude <= 0.0:
            return 0.0, 0.0, 0.0
        dt = frame - self.shake_frame
        if dt < 0 or dt > self.shake_duration:
            return 0.0, 0.0, 0.0
        fade = math.pow(self.shake_decay, dt)
        rng = random.Random(self.shake_seed)
        out = []
        for _ in range(3):
            phase = rng.random() * math.tau
            out.append(math.sin(dt * self.shake_frequency * math.tau / 24.0 + phase) * fade)
        a = self.shake_amplitude
        return out[0] * a, out[1] * a, out[2] * a * 1.6

    def key_frames(self) -> set[int]:
        frames: set[int] = set()
        for t in (self.pos_x, self.pos_y, self.zoom, self.rotation):
            frames.update(t.frames())
        return frames

    @property
    def animated(self) -> bool:
        return bool(self.key_frames())

    def add_shake(self, frame: int, amplitude: float = 18.0, duration: int = 12,
                  frequency: float = 8.0) -> None:
        self.shake_frame = int(frame)
        self.shake_amplitude = float(amplitude)
        self.shake_duration = int(duration)
        self.shake_frequency = float(frequency)
        self.shake_seed = random.randint(1, 100000)
        keys = sorted(self.key_frames())
        self.shake_prev_zoom = self.zoom.value_at(frame)
        _ = keys

    def clear_shake(self) -> None:
        self.shake_frame = -1
        self.shake_amplitude = 0.0

    def to_dict(self) -> dict:
        return {
            "uid": self.uid, "name": self.name, "width": self.width, "height": self.height,
            "pos_x": self.pos_x.to_dict(), "pos_y": self.pos_y.to_dict(),
            "zoom": self.zoom.to_dict(), "rotation": self.rotation.to_dict(),
            "shake_amplitude": self.shake_amplitude, "shake_frequency": self.shake_frequency,
            "shake_decay": self.shake_decay, "shake_duration": self.shake_duration,
            "shake_frame": self.shake_frame, "shake_seed": self.shake_seed,
            "follow_layer_uid": self.follow_layer_uid,
            "follow_smoothing": self.follow_smoothing,
            "follow_offset": list(self.follow_offset),
            "locked": self.locked,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Camera":
        cam = cls(d.get("name", "Camera 1"), (d.get("width", 1920), d.get("height", 1080)))
        cam.uid = d.get("uid") or cam.uid
        cam.pos_x = Track.from_dict(d.get("pos_x", {}))
        cam.pos_y = Track.from_dict(d.get("pos_y", {}))
        cam.zoom = Track.from_dict(d.get("zoom", {}))
        cam.rotation = Track.from_dict(d.get("rotation", {}))
        cam.shake_amplitude = float(d.get("shake_amplitude", 0.0))
        cam.shake_frequency = float(d.get("shake_frequency", 8.0))
        cam.shake_decay = float(d.get("shake_decay", 0.9))
        cam.shake_duration = int(d.get("shake_duration", 12))
        cam.shake_frame = int(d.get("shake_frame", -1))
        cam.shake_seed = int(d.get("shake_seed", 1234))
        cam.follow_layer_uid = d.get("follow_layer_uid")
        cam.follow_smoothing = float(d.get("follow_smoothing", 0.5))
        cam.follow_offset = tuple(d.get("follow_offset", (0.0, 0.0)))  # type: ignore[arg-type]
        cam.locked = bool(d.get("locked", False))
        return cam

    def clone(self, new_uid: bool = True) -> "Camera":
        cam = Camera.from_dict(self.to_dict())
        if new_uid:
            cam.uid = new_id("cam")
        return cam
