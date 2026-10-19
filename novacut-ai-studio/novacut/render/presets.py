"""Export settings and format/encoder presets."""
from __future__ import annotations

from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Optional

from ..core.constants import (EXPORT_RESOLUTIONS, EXPORT_FPS, VIDEO_CODECS,
                              AUDIO_CODECS)


@dataclass
class ExportSettings:
    output_path: str = ""
    container: str = ".mp4"
    resolution_key: str = "1080p"          # key into EXPORT_RESOLUTIONS or "Source"
    fps: float = 30.0
    video_codec_id: str = "h264_cpu"
    audio_codec_id: str = "aac"
    video_bitrate_k: int = 8000            # kbps; 0 = use crf
    crf: int = 20
    use_hardware: bool = False
    audio_bitrate_k: int = 192
    sample_rate: int = 48000
    audio_channels: int = 2
    use_proxies: bool = False
    burn_subtitles: Optional[str] = None   # path to .ass/.srt to burn in
    extra_metadata: bool = True

    def resolution(self, project_w: int, project_h: int) -> tuple[int, int]:
        preset = EXPORT_RESOLUTIONS.get(self.resolution_key)
        if preset is None:
            return project_w, project_h
        w, h = preset
        # Keep even dimensions for H.264/H.265.
        return w - w % 2, h - h % 2

    @property
    def video_encoder(self) -> str:
        return VIDEO_CODECS.get(self.video_codec_id, ("libx264", "", False))[0]

    @property
    def audio_encoder(self) -> str:
        return AUDIO_CODECS.get(self.audio_codec_id, ("aac", ""))[0]

    def validate(self) -> list[str]:
        problems: list[str] = []
        if not self.output_path:
            problems.append("No output path set.")
        if self.fps not in EXPORT_FPS:
            problems.append(f"Unusual frame rate: {self.fps}")
        if Path(self.output_path).suffix.lower() != self.container:
            problems.append("Output extension does not match the container.")
        return problems

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "ExportSettings":
        known = set(cls.__dataclass_fields__)  # type: ignore[attr-defined]
        return cls(**{k: v for k, v in d.items() if k in known})
