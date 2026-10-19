"""JSON-backed user settings with safe defaults."""
from __future__ import annotations

import json
from copy import deepcopy
from typing import Any

from . import paths

DEFAULTS: dict[str, Any] = {
    "theme": "dark",
    "ui_scale": 1.0,
    "preview_quality": "half",       # full | half | quarter
    "generate_proxies": False,
    "proxy_height": 720,
    "thumbnails_on_timeline": True,
    "waveforms_on_timeline": True,
    "autosave": True,
    "autosave_interval_s": 60,
    "snap_enabled": True,
    "snap_tolerance_s": 0.25,
    "default_transition_s": 0.5,
    "ffmpeg_path": "",               # empty = auto-detect
    "ffprobe_path": "",
    "prefer_hwaccel": True,
    "audio_volume": 1.0,
    "muted": False,
    "ollama_host": "http://127.0.0.1:11434",
    "ollama_model": "llama3.2:3b",
    "subtitles_engine": "faster_whisper",
    "last_project_dir": "",
    "last_export_dir": "",
}


class Config:
    def __init__(self) -> None:
        self._data = deepcopy(DEFAULTS)
        self.load()

    def load(self) -> None:
        try:
            raw = json.loads(paths.CONFIG_PATH.read_text(encoding="utf-8"))
            if isinstance(raw, dict):
                self._data.update(raw)
        except FileNotFoundError:
            pass
        except Exception:
            # Corrupt config must never prevent startup.
            from .logging_setup import get_logger
            get_logger("config").exception("Failed to read config; using defaults")

    def save(self) -> None:
        paths.ensure_dirs()
        tmp = paths.CONFIG_PATH.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(self._data, indent=2), encoding="utf-8")
        tmp.replace(paths.CONFIG_PATH)

    def get(self, key: str, default: Any = None) -> Any:
        return self._data.get(key, DEFAULTS.get(key, default))

    def set(self, key: str, value: Any) -> None:
        self._data[key] = value
        self.save()

    def as_dict(self) -> dict[str, Any]:
        return deepcopy(self._data)
