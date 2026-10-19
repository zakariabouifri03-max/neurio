"""Filesystem locations for config, cache, logs, models and autosaves.

Works on Windows, Linux and macOS. On Windows everything lives under
``%LOCALAPPDATA%/NovaCut`` (or ``%APPDATA%`` fallback).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path


def _app_data_root() -> Path:
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
        if base:
            return Path(base) / "NovaCut"
    elif sys.platform == "darwin":
        return Path.home() / "Library" / "Application Support" / "NovaCut"
    base = os.environ.get("XDG_DATA_HOME") or str(Path.home() / ".local" / "share")
    return Path(base) / "novacut"


def _cache_root() -> Path:
    if sys.platform == "win32":
        base = os.environ.get("LOCALAPPDATA") or os.environ.get("APPDATA")
        if base:
            return Path(base) / "NovaCut" / "Cache"
    elif sys.platform == "darwin":
        return Path.home() / "Library" / "Caches" / "NovaCut"
    base = os.environ.get("XDG_CACHE_HOME") or str(Path.home() / ".cache")
    return Path(base) / "novacut"


DATA_DIR = _app_data_root()
CACHE_DIR = _cache_root()
LOG_DIR = DATA_DIR / "logs"
MODELS_DIR = DATA_DIR / "models"
AUTOSAVE_DIR = DATA_DIR / "autosave"
PROXY_DIR = CACHE_DIR / "proxies"
THUMB_DIR = CACHE_DIR / "thumbs"
WAVE_DIR = CACHE_DIR / "waveforms"
DB_PATH = CACHE_DIR / "library.sqlite3"
CONFIG_PATH = DATA_DIR / "config.json"
RESOURCES_DIR = Path(__file__).resolve().parent.parent / "resources"

# Allow redirecting every writable location (used by tests and portable mode).
def override_root(root: str | os.PathLike) -> None:
    global DATA_DIR, CACHE_DIR, LOG_DIR, MODELS_DIR, AUTOSAVE_DIR, PROXY_DIR
    global THUMB_DIR, WAVE_DIR, DB_PATH, CONFIG_PATH
    root = Path(root)
    DATA_DIR = root / "data"
    CACHE_DIR = root / "cache"
    LOG_DIR = DATA_DIR / "logs"
    MODELS_DIR = DATA_DIR / "models"
    AUTOSAVE_DIR = DATA_DIR / "autosave"
    PROXY_DIR = CACHE_DIR / "proxies"
    THUMB_DIR = CACHE_DIR / "thumbs"
    WAVE_DIR = CACHE_DIR / "waveforms"
    DB_PATH = CACHE_DIR / "library.sqlite3"
    CONFIG_PATH = DATA_DIR / "config.json"
    ensure_dirs()


def ensure_dirs() -> None:
    for p in (DATA_DIR, CACHE_DIR, LOG_DIR, MODELS_DIR, AUTOSAVE_DIR,
              PROXY_DIR, THUMB_DIR, WAVE_DIR):
        p.mkdir(parents=True, exist_ok=True)
