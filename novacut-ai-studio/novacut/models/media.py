"""Media library item: a reference to a file on disk plus cached metadata."""
from __future__ import annotations

import hashlib
import time
import uuid
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Optional

from ..core.constants import VIDEO_EXTENSIONS, AUDIO_EXTENSIONS, IMAGE_EXTENSIONS
from ..core.ffmpeg import MediaMetadata


def new_id(prefix: str = "id") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:12]}"


def kind_for_path(path: str | Path) -> str:
    ext = Path(path).suffix.lower()
    if ext in VIDEO_EXTENSIONS:
        return "video"
    if ext in AUDIO_EXTENSIONS:
        return "audio"
    if ext in IMAGE_EXTENSIONS:
        return "image"
    return "unknown"


def quick_hash(path: str | Path, chunk: int = 1 << 20, max_chunks: int = 16) -> str:
    """Fast partial hash used for identity/cache keys (not cryptographic)."""
    p = Path(path)
    h = hashlib.sha1()
    try:
        size = p.stat().st_size
        h.update(str(size).encode())
        with p.open("rb") as f:
            for i in range(max_chunks):
                block = f.read(chunk)
                if not block:
                    break
                h.update(block)
    except OSError:
        return ""
    return h.hexdigest()


@dataclass
class MediaItem:
    """A non-destructive reference. Source files are never modified."""

    path: str
    id: str = field(default_factory=lambda: new_id("media"))
    name: str = ""
    kind: str = "unknown"
    duration: float = 0.0
    width: int = 0
    height: int = 0
    fps: float = 0.0
    has_video: bool = False
    has_audio: bool = False
    audio_channels: int = 0
    audio_sample_rate: int = 0
    video_codec: str = ""
    audio_codec: str = ""
    rotation: int = 0
    file_hash: str = ""
    proxy_path: str = ""
    thumbnail_path: str = ""
    waveform_path: str = ""
    missing: bool = False
    imported_at: float = field(default_factory=time.time)
    tags: list[str] = field(default_factory=list)
    notes: str = ""

    def __post_init__(self) -> None:
        if not self.name:
            self.name = Path(self.path).stem
        if self.kind == "unknown":
            self.kind = kind_for_path(self.path)

    @classmethod
    def from_path(cls, path: str | Path, metadata: Optional[MediaMetadata] = None) -> "MediaItem":
        p = Path(path)
        item = cls(path=str(p), name=p.stem, kind=kind_for_path(p))
        if metadata is not None:
            item.apply_metadata(metadata)
        item.file_hash = quick_hash(p)
        return item

    def apply_metadata(self, m: MediaMetadata) -> None:
        self.duration = m.duration
        self.width, self.height = m.width, m.height
        self.fps = m.fps
        self.has_video, self.has_audio = m.has_video, m.has_audio
        self.audio_channels, self.audio_sample_rate = m.audio_channels, m.audio_sample_rate
        self.video_codec, self.audio_codec = m.video_codec, m.audio_codec
        self.rotation = m.rotation
        self.missing = not m.exists

    def effective_duration(self) -> float:
        """Images have no intrinsic duration; callers default to 5 s."""
        return self.duration if self.duration > 0 else 5.0

    def to_dict(self) -> dict:
        d = asdict(self)
        p = Path(self.path)
        d["abs_path"] = str(p.resolve()) if p.exists() else str(p)
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "MediaItem":
        d = dict(d)
        d.pop("abs_path", None)
        known = {f for f in cls.__dataclass_fields__}  # type: ignore[attr-defined]
        return cls(**{k: v for k, v in d.items() if k in known})
