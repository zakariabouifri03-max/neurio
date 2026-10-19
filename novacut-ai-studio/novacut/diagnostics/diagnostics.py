"""System/FFmpeg/capability diagnostics and one-click report export."""
from __future__ import annotations

import json
import platform
import sys
from datetime import datetime
from pathlib import Path

from .. import __version__
from ..core import paths
from ..core.ffmpeg import (find_ffmpeg, find_ffprobe, run_simple,
                           ffmpeg_supports_encoders, ffmpeg_supports_filter)
from ..core.logging_setup import ring_buffer
from ..ai import model_manager


def ffmpeg_version() -> str:
    exe = find_ffmpeg()
    if exe is None:
        return "not found"
    res = run_simple([str(exe), "-version"], timeout_s=15)
    return res.stdout.splitlines()[0] if res.ok else "error"


def collect_diagnostics() -> dict:
    encoders = ffmpeg_supports_encoders() if find_ffmpeg() else {}
    filters = {}
    if find_ffmpeg():
        filters = {name: ffmpeg_supports_filter(name) for name in (
            "drawtext", "subtitles", "xfade", "chromakey", "lut3d",
            "afftdn", "silencedetect", "geq", "alphamerge")}
    return {
        "app": {"name": "NovaCut AI Studio", "version": __version__,
                "python": sys.version.split()[0],
                "time": datetime.now().isoformat(timespec="seconds")},
        "system": {"platform": platform.platform(),
                   "machine": platform.machine(),
                   "processor": platform.processor(),
                   "paths": {"data": str(paths.DATA_DIR),
                             "cache": str(paths.CACHE_DIR),
                             "models": str(paths.MODELS_DIR)}},
        "ffmpeg": {"executable": str(find_ffmpeg() or ""),
                   "ffprobe": str(find_ffprobe() or ""),
                   "version": ffmpeg_version(),
                   "encoders": encoders, "filters": filters},
        "ai_dependencies": model_manager.dependency_report(),
        "logs_tail": ring_buffer().splitlines()[-200:],
    }


def render_text(report: dict | None = None) -> str:
    report = report or collect_diagnostics()
    lines = ["=" * 70, "NovaCut AI Studio - diagnostics report",
             "=" * 70, json.dumps(report["app"], indent=2),
             "", json.dumps(report["system"], indent=2), "",
             "FFmpeg:", json.dumps(report["ffmpeg"], indent=2), "",
             "AI dependencies:", json.dumps(report["ai_dependencies"], indent=2),
             "", "-" * 70, "Recent log lines:", "-" * 70]
    lines += report.get("logs_tail", [])
    return "\n".join(lines)


def save_report(target: str | Path) -> Path:
    target = Path(target)
    target.write_text(render_text(), encoding="utf-8")
    return target
