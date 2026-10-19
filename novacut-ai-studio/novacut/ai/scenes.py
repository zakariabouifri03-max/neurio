"""Local shot-boundary detection using OpenCV histogram comparison."""
from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import numpy as np

from ..core.ffmpeg import find_ffmpeg
from ..core.logging_setup import get_logger
from .base import AITool, ToolStatus

log = get_logger("ai-scenes")


@dataclass
class SceneBoundary:
    time: float
    score: float


class SceneDetector(AITool):
    id = "scenes"
    name = "Scene detection"
    description = "Detect shot boundaries and create markers or subclips."

    def check(self) -> ToolStatus:
        if not self.module_available("cv2"):
            return self.unavailable("OpenCV is not installed.")
        if not self.ffmpeg_available():
            return self.unavailable("FFmpeg was not found.")
        return self.available()

    def detect(self, media_path: str, threshold: float = 0.45,
               sample_fps: float = 5.0, width: int = 160, height: int = 90,
               progress=None, should_cancel=None) -> list[SceneBoundary]:
        """Decode downscaled frames and score consecutive HSV histogram distance."""
        self.ensure_ready()
        import cv2
        ffmpeg = find_ffmpeg()
        cmd = [
            str(ffmpeg), "-hide_banner", "-loglevel", "error", "-i", str(media_path),
            "-vf", f"fps={sample_fps},scale={width}:{height}",
            "-f", "rawvideo", "-pix_fmt", "bgr24", "-",
        ]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        frame_size = width * height * 3
        prev_hist = None
        boundaries: list[SceneBoundary] = []
        index = 0
        assert proc.stdout is not None
        while True:
            if should_cancel and should_cancel():
                proc.terminate()
                raise RuntimeError("Scene detection cancelled")
            raw = proc.stdout.read(frame_size)
            if len(raw) < frame_size:
                break
            frame = np.frombuffer(raw, dtype=np.uint8).reshape(height, width, 3)
            hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
            hist = cv2.calcHist([hsv], [0, 1], None, [32, 32], [0, 180, 0, 256])
            cv2.normalize(hist, hist)
            if prev_hist is not None:
                # 1.0 = identical; low correlation means a hard cut.
                score = 1.0 - float(cv2.compareHist(prev_hist, hist,
                                                     cv2.HISTCMP_CORREL))
                if score >= threshold:
                    boundaries.append(SceneBoundary(index / sample_fps, score))
            prev_hist = hist
            index += 1
            if progress and index % sample_fps == 0:
                progress(min(1.0, index / (sample_fps * 600)),
                         f"Analysed {index // sample_fps}s")
        proc.wait(timeout=10)
        log.info("Scene detection found %d boundaries", len(boundaries))
        return boundaries

    def apply_as_markers(self, timeline, boundaries: list[SceneBoundary],
                         clip=None) -> list:
        """Convert boundaries to timeline markers (reviewable before applying)."""
        created = []
        if clip is None:
            for b in boundaries:
                created.append(timeline.add_marker(b.time, f"Scene {len(created) + 1}"))
            return created
        speed = max(clip.speed, 1e-6)
        for b in boundaries:
            t = clip.start + (b.time - clip.source_in) / speed
            if clip.start < t < clip.end:
                created.append(timeline.add_marker(t, f"Scene {len(created) + 1}"))
        return created
