"""Project files (.adzproj JSON for video, .adzimg for images), autosave and crash recovery."""
from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from ..video.model import Timeline
from .errors import AppError
from .fileio import atomic_write_json
from .paths import subdir

VIDEO_EXT = ".adzproj"
IMAGE_EXT = ".adzimg"
FORMAT_VERSION = 1


def save_video_project(path: str | Path, name: str, tl: Timeline) -> Path:
    tl.validate()
    data = {"format": "adzproj", "version": FORMAT_VERSION, "name": name, "timeline": tl.to_dict()}
    return atomic_write_json(path, data)


def load_video_project(path: str | Path) -> tuple[str, Timeline]:
    p = Path(path)
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise AppError("The project file could not be read. It may be damaged.", details=str(exc)) from exc
    if data.get("format") != "adzproj":
        raise AppError("This file is not an ADZAK video project.")
    if int(data.get("version", 0)) > FORMAT_VERSION:
        raise AppError("This project was made with a newer version of ADZAK Creative Studio.")
    return data.get("name", p.stem), Timeline.from_dict(data["timeline"])


def autosave_dir() -> Path:
    return subdir("autosave")


@dataclass
class AutosaveEntry:
    path: Path
    payload: dict[str, Any]
    saved_at: float


def write_autosave(key: str, payload: dict[str, Any]) -> Path:
    """Write a recovery snapshot. `key` identifies the work session (safe-named)."""
    safe_key = "".join(c for c in key if c.isalnum() or c in "-_") or "session"
    data = {"saved_at": time.time(), "payload": payload}
    return atomic_write_json(autosave_dir() / f"{safe_key}.autosave.json", data)


def find_autosaves() -> list[AutosaveEntry]:
    out = []
    for f in sorted(autosave_dir().glob("*.autosave.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            out.append(AutosaveEntry(f, data["payload"], float(data["saved_at"])))
        except (OSError, json.JSONDecodeError, KeyError, ValueError):
            f.unlink(missing_ok=True)  # corrupt snapshots are discarded silently
    return out


def discard_autosave(entry_path: Path) -> None:
    entry_path.unlink(missing_ok=True)


def clear_all_autosaves() -> None:
    for f in autosave_dir().glob("*.autosave.json"):
        f.unlink(missing_ok=True)
