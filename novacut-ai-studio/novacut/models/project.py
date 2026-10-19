"""Top-level project document combining settings, media library and timeline."""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from .. import PROJECT_FORMAT_VERSION
from ..core.constants import PROJECT_PRESETS
from .media import MediaItem
from .timeline import Timeline


@dataclass
class ProjectSettings:
    name: str = "Untitled project"
    preset_id: str = "landscape_1080"
    width: int = 1920
    height: int = 1080
    fps: float = 30.0
    sample_rate: int = 48000
    audio_channels: int = 2
    background: str = "#000000"
    render_background_alpha: bool = False

    def apply_preset(self, preset_id: str) -> None:
        if preset_id not in PROJECT_PRESETS:
            raise KeyError(f"Unknown preset {preset_id}")
        label, w, h, fps = PROJECT_PRESETS[preset_id]
        self.preset_id = preset_id
        self.width, self.height, self.fps = w, h, fps

    def to_dict(self) -> dict:
        return dict(self.__dict__)

    @classmethod
    def from_dict(cls, d: dict) -> "ProjectSettings":
        known = set(cls.__dataclass_fields__)  # type: ignore[attr-defined]
        return cls(**{k: v for k, v in d.items() if k in known})


@dataclass
class Project:
    settings: ProjectSettings = field(default_factory=ProjectSettings)
    timeline: Timeline = field(default_factory=Timeline.new_default)
    media: dict[str, MediaItem] = field(default_factory=dict)
    format_version: int = PROJECT_FORMAT_VERSION
    created_at: float = field(default_factory=time.time)
    modified_at: float = field(default_factory=time.time)
    # Runtime only (not serialised): absolute path of the .novacut file.
    path: Optional[str] = field(default=None, compare=False)
    dirty: bool = field(default=False, compare=False)

    # ------------------------------------------------------------- factory
    @classmethod
    def from_preset(cls, preset_id: str = "landscape_1080",
                    name: str = "Untitled project") -> "Project":
        settings = ProjectSettings(name=name)
        settings.apply_preset(preset_id)
        return cls(settings=settings, timeline=Timeline.new_default())

    # ------------------------------------------------------------- media
    def add_media(self, item: MediaItem) -> MediaItem:
        self.media[item.id] = item
        self.touch()
        return item

    def remove_media(self, media_id: str) -> Optional[MediaItem]:
        item = self.media.pop(media_id, None)
        if item is not None:
            self.touch()
        return item

    def get_media(self, media_id: Optional[str]) -> Optional[MediaItem]:
        if not media_id:
            return None
        return self.media.get(media_id)

    def media_used_by_timeline(self) -> set[str]:
        return {c.media_id for c in self.timeline.all_clips() if c.media_id}

    def touch(self) -> None:
        self.modified_at = time.time()
        self.dirty = True

    def to_dict(self) -> dict:
        return {
            "format_version": self.format_version,
            "created_at": self.created_at,
            "modified_at": self.modified_at,
            "settings": self.settings.to_dict(),
            "media": {k: v.to_dict() for k, v in self.media.items()},
            "timeline": self.timeline.to_dict(),
        }

    @classmethod
    def from_dict(cls, d: dict) -> "Project":
        version = int(d.get("format_version", 1))
        d = _migrate(d, version)
        settings = ProjectSettings.from_dict(d.get("settings", {}))
        timeline = Timeline.from_dict(d.get("timeline", {}))
        media = {k: MediaItem.from_dict(v) for k, v in d.get("media", {}).items()}
        return cls(
            settings=settings,
            timeline=timeline,
            media=media,
            format_version=PROJECT_FORMAT_VERSION,
            created_at=float(d.get("created_at", time.time())),
            modified_at=float(d.get("modified_at", time.time())),
        )


def _migrate(d: dict, version: int) -> dict:
    """Bring an older document up to the current format version."""
    if version > PROJECT_FORMAT_VERSION:
        raise ValueError(
            f"Project format v{version} is newer than this application "
            f"(supports up to v{PROJECT_FORMAT_VERSION})."
        )
    # Future migrations land here, e.g.:
    # if version < 2: ...
    d["format_version"] = PROJECT_FORMAT_VERSION
    return d


def portable_path(project_file: str | Path, media_path: str | Path) -> str:
    """Return a path relative to the project file when possible."""
    try:
        return str(Path(media_path).resolve().relative_to(
            Path(project_file).resolve().parent))
    except (ValueError, OSError):
        return str(media_path)
