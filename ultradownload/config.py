"""Application settings (persisted in SQLite via the Database class)."""

from __future__ import annotations

import sys
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path


__all__ = ["AppSettings", "PART_CHOICES", "default_settings", "load_settings", "save_settings"]

PART_CHOICES = [1, 4, 8, 16, 24, 32, 40]

DEFAULT_SETTINGS_KEY = "app_settings"


@dataclass
class AppSettings:
    default_dir: str = field(default_factory=lambda: str(
        Path.home() / "Downloads" if sys.platform != "win32"
        else Path.home() / "Downloads"))
    max_simultaneous_downloads: int = 3
    default_parts: int = 40
    connect_timeout: float = 10.0
    read_timeout: float = 30.0
    retry_count: int = 3
    global_speed_limit: float = 0.0          # bytes/s; 0 = unlimited
    start_minimized: bool = False
    theme: str = "dark"                      # "dark" | "midnight"
    accent: str = "blue"                     # "blue" | "purple"
    auto_cleanup_temp: bool = True           # remove temp parts after success
    confirm_cleanup: bool = True             # ask before deleting temp data
    minimize_to_tray: bool = False

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "AppSettings":
        known = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in (data or {}).items() if k in known})


def default_settings() -> AppSettings:
    return AppSettings()


def load_settings(db) -> AppSettings:
    return AppSettings.from_dict(db.get_setting(DEFAULT_SETTINGS_KEY, {}) or {})


def save_settings(db, settings: AppSettings) -> None:
    db.set_setting(DEFAULT_SETTINGS_KEY, settings.to_dict())
