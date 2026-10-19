"""Versioned, editable NovaCut project data model.

The model deliberately contains no Qt types so projects remain easy to inspect,
test, migrate, and process in worker threads.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field, fields
from pathlib import Path
from typing import Any
import math
import uuid

SCHEMA_VERSION = 1


def new_id() -> str:
    return uuid.uuid4().hex


@dataclass
class MediaAsset:
    id: str
    path: str
    name: str
    kind: str = "video"  # video, audio, image
    duration: float = 0.0
    width: int = 0
    height: int = 0
    fps: float = 0.0
    has_audio: bool = False
    has_video: bool = False
    file_size: int = 0
    thumbnail_path: str = ""
    proxy_path: str = ""
    waveform: list[float] = field(default_factory=list)
    probe_error: str = ""

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "MediaAsset":
        allowed = {f.name for f in fields(cls)}
        clean = {k: v for k, v in data.items() if k in allowed}
        clean["waveform"] = [float(x) for x in clean.get("waveform", [])]
        return cls(**clean)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Track:
    id: str
    name: str
    kind: str  # video or audio
    locked: bool = False
    muted: bool = False
    visible: bool = True

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Track":
        allowed = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in data.items() if k in allowed})

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Clip:
    id: str
    track_id: str
    start: float
    source_in: float
    source_out: float
    media_id: str = ""
    type: str = "media"  # media or title
    playback_rate: float = 1.0
    opacity: float = 1.0
    volume: float = 1.0
    position_x: float = 0.0
    position_y: float = 0.0
    scale: float = 1.0
    rotation: float = 0.0
    fade_in: float = 0.0
    fade_out: float = 0.0
    title: str = "Title"
    title_color: str = "#ffffff"
    title_size: int = 72
    effects: dict[str, Any] = field(default_factory=dict)

    @property
    def source_duration(self) -> float:
        return max(0.0, self.source_out - self.source_in)

    @property
    def duration(self) -> float:
        rate = max(0.01, self.playback_rate)
        return self.source_duration / rate

    @property
    def end(self) -> float:
        return self.start + self.duration

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Clip":
        allowed = {f.name for f in fields(cls)}
        clean = {k: v for k, v in data.items() if k in allowed}
        clean["effects"] = dict(clean.get("effects", {}))
        return cls(**clean)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Project:
    name: str = "Untitled"
    width: int = 1920
    height: int = 1080
    fps: float = 30.0
    media: dict[str, MediaAsset] = field(default_factory=dict)
    tracks: list[Track] = field(default_factory=list)
    clips: list[Clip] = field(default_factory=list)
    markers: list[dict[str, Any]] = field(default_factory=list)
    path: str = ""  # local path; not included in serialized project data
    dirty: bool = False

    @classmethod
    def create(cls, name: str = "Untitled") -> "Project":
        tracks = [
            Track(new_id(), "V3 · Overlay", "video"),
            Track(new_id(), "V2 · Video", "video"),
            Track(new_id(), "V1 · Main", "video"),
            Track(new_id(), "A1 · Audio", "audio"),
            Track(new_id(), "A2 · Music", "audio"),
        ]
        return cls(name=name, tracks=tracks)

    @property
    def duration(self) -> float:
        return max((clip.end for clip in self.clips), default=0.0)

    def track(self, track_id: str) -> Track | None:
        return next((t for t in self.tracks if t.id == track_id), None)

    def clip(self, clip_id: str) -> Clip | None:
        return next((c for c in self.clips if c.id == clip_id), None)

    def asset(self, media_id: str) -> MediaAsset | None:
        return self.media.get(media_id)

    def clip_label(self, clip: Clip) -> str:
        if clip.type == "title":
            return clip.title or "Title"
        asset = self.asset(clip.media_id)
        return asset.name if asset else "Missing media"

    def active_video_clips(self, time_seconds: float) -> list[Clip]:
        track_order = {track.id: index for index, track in enumerate(self.tracks)}
        active = []
        for clip in self.clips:
            track = self.track(clip.track_id)
            asset = self.asset(clip.media_id) if clip.type != "title" else None
            is_visual = clip.type == "title" or bool(asset and asset.kind in {"video", "image"})
            if is_visual and track and track.visible and clip.start <= time_seconds < clip.end:
                active.append(clip)
        return sorted(active, key=lambda c: track_order.get(c.track_id, 999))

    def to_dict(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "width": int(self.width),
            "height": int(self.height),
            "fps": float(self.fps),
            "media": {key: item.to_dict() for key, item in self.media.items()},
            "tracks": [track.to_dict() for track in self.tracks],
            "clips": [clip.to_dict() for clip in self.clips],
            "markers": [dict(marker) for marker in self.markers],
        }

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Project":
        if not isinstance(data, dict):
            raise ValueError("Project data must be a JSON object")
        project = cls(
            name=str(data.get("name") or "Untitled"),
            width=int(data.get("width", 1920)),
            height=int(data.get("height", 1080)),
            fps=float(data.get("fps", 30.0)),
            media={str(k): MediaAsset.from_dict(v) for k, v in data.get("media", {}).items()},
            tracks=[Track.from_dict(t) for t in data.get("tracks", [])],
            clips=[Clip.from_dict(c) for c in data.get("clips", [])],
            markers=[dict(m) for m in data.get("markers", [])],
        )
        if not project.tracks:
            project.tracks = cls.create(project.name).tracks
        project.validate()
        return project

    def validate(self) -> None:
        if self.width < 16 or self.height < 16 or self.width > 16384 or self.height > 16384:
            raise ValueError("Project resolution is outside the supported range")
        if not math.isfinite(self.fps) or not 1 <= self.fps <= 240:
            raise ValueError("Project frame rate must be between 1 and 240 FPS")
        track_ids = [track.id for track in self.tracks]
        if len(track_ids) != len(set(track_ids)):
            raise ValueError("Project contains duplicate track IDs")
        clip_ids = [clip.id for clip in self.clips]
        if len(clip_ids) != len(set(clip_ids)):
            raise ValueError("Project contains duplicate clip IDs")
        track_set = set(track_ids)
        for clip in self.clips:
            if clip.track_id not in track_set:
                raise ValueError(f"Clip {clip.id} references an unknown track")
            if clip.type != "title" and clip.media_id not in self.media:
                raise ValueError(f"Clip {clip.id} references missing project media")
            values = (clip.start, clip.source_in, clip.source_out, clip.playback_rate)
            if not all(math.isfinite(float(x)) for x in values):
                raise ValueError(f"Clip {clip.id} contains a non-finite time value")
            if clip.start < 0 or clip.source_in < 0 or clip.source_out <= clip.source_in:
                raise ValueError(f"Clip {clip.id} has invalid timing")
            if clip.playback_rate <= 0 or clip.playback_rate > 16:
                raise ValueError(f"Clip {clip.id} has an invalid playback rate")
            if not 0 <= clip.opacity <= 1:
                raise ValueError(f"Clip {clip.id} opacity must be between 0 and 1")
        for asset in self.media.values():
            if asset.kind not in {"video", "audio", "image"}:
                raise ValueError(f"Unsupported media kind: {asset.kind}")
            if asset.duration < 0 or not math.isfinite(float(asset.duration)):
                raise ValueError("Media duration must be finite and non-negative")

    def replace_from(self, data: dict[str, Any]) -> None:
        """Replace editable data in-place while preserving the local project path."""
        restored = self.from_dict(data)
        current_path = self.path
        self.name = restored.name
        self.width = restored.width
        self.height = restored.height
        self.fps = restored.fps
        self.media = restored.media
        self.tracks = restored.tracks
        self.clips = restored.clips
        self.markers = restored.markers
        self.path = current_path
        self.dirty = True


def media_kind_for_path(path: str | Path) -> str | None:
    ext = Path(path).suffix.lower()
    if ext in {".mp4", ".m4v", ".mov", ".mkv", ".avi", ".webm", ".wmv", ".mpeg", ".mpg", ".mxf", ".ts", ".3gp"}:
        return "video"
    if ext in {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".wma", ".aiff"}:
        return "audio"
    if ext in {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tif", ".tiff", ".gif"}:
        return "image"
    return None
