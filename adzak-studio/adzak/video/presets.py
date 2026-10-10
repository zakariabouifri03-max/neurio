"""Export presets for common platforms. Presets are plain data so users can export them as JSON."""
from __future__ import annotations

import json
from pathlib import Path

from ..core.fileio import atomic_write_json
from .model import canvas_size

EXPORT_PRESETS: dict[str, dict] = {
    "YouTube 1080p (16:9)": {"aspect": "16:9", "short_px": 1080, "fps": 30, "codec": "h264", "crf": 21,
                             "ext": ".mp4", "note": "H.264, 8–12 Mbps equivalent, widely compatible"},
    "YouTube 4K (16:9)": {"aspect": "16:9", "short_px": 2160, "fps": 30, "codec": "h264", "crf": 23,
                          "ext": ".mp4", "note": "Needs a fast CPU; slow on Intel UHD 620 without hardware encoding"},
    "TikTok / Reels / Shorts (9:16)": {"aspect": "9:16", "short_px": 1080, "fps": 30, "codec": "h264", "crf": 23,
                                       "ext": ".mp4", "note": "1080×1920 vertical"},
    "Instagram Square (1:1)": {"aspect": "1:1", "short_px": 1080, "fps": 30, "codec": "h264", "crf": 23,
                               "ext": ".mp4", "note": "1080×1080 feed video"},
    "Instagram Portrait (4:5)": {"aspect": "4:5", "short_px": 1080, "fps": 30, "codec": "h264", "crf": 23,
                                 "ext": ".mp4", "note": "1080×1350 feed video"},
    "Archive H.265 (16:9 1080p)": {"aspect": "16:9", "short_px": 1080, "fps": 30, "codec": "h265", "crf": 26,
                                   "ext": ".mkv", "note": "Smaller files; encoding is slower than H.264"},
    "Web VP9 (16:9 720p)": {"aspect": "16:9", "short_px": 720, "fps": 30, "codec": "vp9", "crf": 34,
                            "ext": ".webm", "note": "Open format for websites; slow to encode"},
}


def preset_size(name: str) -> tuple[int, int]:
    p = EXPORT_PRESETS[name]
    return canvas_size(p["aspect"], p["short_px"])


def export_presets_json(path: str | Path) -> Path:
    return atomic_write_json(path, {"format": "adzak-export-presets", "version": 1, "presets": EXPORT_PRESETS})


def load_presets_json(path: str | Path) -> dict[str, dict]:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if data.get("format") != "adzak-export-presets":
        raise ValueError("Not an ADZAK export preset file.")
    return data["presets"]
