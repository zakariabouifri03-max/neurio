"""Smart reframing: local object tracking -> editable vertical crop suggestions.

Tracking is a helper, not magic: results are presented as *suggestions* the
user reviews and edits. The fallback CamShift/MIL trackers can drift on fast
motion or occlusion, and the UI says so explicitly.
"""
from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..core.ffmpeg import find_ffmpeg
from ..core.logging_setup import get_logger
from .base import AITool, ToolStatus

log = get_logger("ai-reframe")


@dataclass
class ReframeKeyframe:
    time: float
    center_x: float          # normalized 0..1 in the source frame
    center_y: float
    confidence: float


class SmartReframe(AITool):
    id = "reframe"
    name = "Smart reframe"
    description = "Track a subject and propose vertical 9:16 framing keyframes."

    def check(self) -> ToolStatus:
        if not self.module_available("cv2"):
            return self.unavailable("OpenCV is not installed.")
        if not self.ffmpeg_available():
            return self.unavailable("FFmpeg was not found.")
        return self.available(resource_note=(
            "Tracking runs locally on CPU. It assists framing but is not "
            "perfect: review every suggestion before exporting."))

    # ------------------------------------------------------------- tracking
    def track(self, media_path: str, bbox: tuple[int, int, int, int] | None = None,
              sample_fps: float = 5.0, width: int = 320, height: int = 180,
              progress=None, should_cancel=None) -> list[ReframeKeyframe]:
        self.ensure_ready()
        import cv2
        frames = self._decode(media_path, sample_fps, width, height)
        if not frames:
            return []
        if bbox is None:
            # Default subject window: centered 40% x 60% of the frame.
            bbox = (int(width * 0.3), int(height * 0.2),
                    int(width * 0.4), int(height * 0.6))
        tracker = self._make_tracker(cv2)
        try:
            # OpenCV 5 returns None (void); older versions returned bool.
            tracker.init(np.ascontiguousarray(frames[0]),
                         tuple(int(v) for v in bbox))
        except Exception as exc:  # noqa: BLE001
            raise RuntimeError(f"Could not initialise tracker: {exc}") from exc
        keyframes: list[ReframeKeyframe] = []
        for i, frame in enumerate(frames):
            if should_cancel and should_cancel():
                raise RuntimeError("Reframe tracking cancelled")
            box, confidence = self._update(tracker, cv2, frame)
            x, y, w, h = box
            cx = float(np.clip((x + w / 2) / width, 0.0, 1.0))
            cy = float(np.clip((y + h / 2) / height, 0.0, 1.0))
            keyframes.append(ReframeKeyframe(i / sample_fps, cx, cy,
                                             float(confidence)))
            if progress:
                progress(i / len(frames), f"Tracking frame {i + 1}/{len(frames)}")
        return self._smooth(keyframes)

    def _make_tracker(self, cv2):
        # Prefer model-free MIL (ships with main OpenCV builds); fall back to
        # CamShift, which needs no contrib modules at all.
        if hasattr(cv2, "TrackerMIL_create"):
            return cv2.TrackerMIL_create()
        return _CamShiftFallback(cv2)

    def _update(self, tracker, cv2, frame):
        if hasattr(tracker, "update") and not isinstance(tracker, _CamShiftFallback):
            ok, box = tracker.update(frame)
            return box, 0.8 if ok else 0.2
        return tracker.update(frame)

    def _smooth(self, keyframes: list[ReframeKeyframe],
                window: int = 5) -> list[ReframeKeyframe]:
        """Simple moving average to avoid jittery crop centres."""
        if len(keyframes) < window:
            return keyframes
        xs = np.array([k.center_x for k in keyframes])
        ys = np.array([k.center_y for k in keyframes])
        kernel = np.ones(window) / window
        xs_s = np.convolve(xs, kernel, mode="same")
        ys_s = np.convolve(ys, kernel, mode="same")
        out = []
        for k, x, y in zip(keyframes, xs_s, ys_s):
            out.append(ReframeKeyframe(k.time, float(x), float(y),
                                        k.confidence))
        return out

    def _decode(self, media_path, sample_fps, width, height) -> list[np.ndarray]:
        ffmpeg = find_ffmpeg()
        cmd = [str(ffmpeg), "-hide_banner", "-loglevel", "error", "-i",
               str(media_path), "-vf",
               f"fps={sample_fps},scale={width}:{height}",
               "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                                stderr=subprocess.DEVNULL,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        size = width * height * 3
        frames: list[np.ndarray] = []
        assert proc.stdout is not None
        while True:
            raw = proc.stdout.read(size)
            if len(raw) < size:
                break
            frames.append(np.frombuffer(raw, np.uint8).reshape(height, width, 3))
        proc.wait(timeout=10)
        return frames


class _CamShiftFallback:
    """CamShift wrapper exposing the same init/update interface as trackers."""

    def __init__(self, cv2):
        self._cv2 = cv2
        self._box = (0, 0, 1, 1)
        self._hist = None

    def init(self, frame, bbox):
        x, y, w, h = (int(v) for v in bbox)
        self._box = (x, y, w, h)
        roi = frame[y:y + h, x:x + w]
        hsv = self._cv2.cvtColor(roi, self._cv2.COLOR_BGR2HSV)
        self._hist = self._cv2.calcHist([hsv], [0], None, [16], [0, 180])
        self._cv2.normalize(self._hist, self._hist, 0, 255, self._cv2.NORM_MINMAX)
        return True

    def update(self, frame):
        hsv = self._cv2.cvtColor(frame, self._cv2.COLOR_BGR2HSV)
        back = self._cv2.calcBackProject([hsv], [0], self._hist, [0, 180], 1)
        eps = (self._cv2.TERM_CRITERIA_EPS | self._cv2.TERM_CRITERIA_COUNT, 10, 1)
        try:
            ret, box = self._cv2.CamShift(back, self._box, eps)
            self._box = box
            x, y, w, h = box
            return (x, y, max(1, w), max(1, h)), 0.5
        except Exception:  # noqa: BLE001
            x, y, w, h = self._box
            return (x, y, max(1, w), max(1, h)), 0.2
