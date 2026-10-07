"""Playback clock (frame accurate, decoupled from the renderer)."""
from __future__ import annotations

import time

from PySide6.QtCore import QObject, Qt, QTimer, Signal

from ..model.easing import clamp


class Player(QObject):
    """Drives the current frame over time.

    Uses a wall-clock accumulator so the timeline stays accurate even when the
    renderer cannot keep up (frames are simply skipped, like a real NLE).
    """

    frame_changed = Signal(float)
    playing_changed = Signal(bool)
    range_changed = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.fps: int = 24
        self.start_frame: int = 1
        self.end_frame: int = 72
        self.loop = True
        self._frame: float = 1.0
        self._playing = False
        self._timer = QTimer(self)
        self._timer.setTimerType(Qt.PreciseTimer)
        self._timer.timeout.connect(self._tick)
        self._last_time = 0.0
        self._accum = 0.0

    # ---------------------------------------------------------------- state
    @property
    def frame(self) -> float:
        return self._frame

    @property
    def frame_int(self) -> int:
        return int(round(self._frame))

    @property
    def playing(self) -> bool:
        return self._playing

    @property
    def duration(self) -> int:
        return max(1, self.end_frame - self.start_frame + 1)

    def set_range(self, start: int, end: int) -> None:
        self.start_frame = int(start)
        self.end_frame = max(int(start) + 1, int(end))
        self.range_changed.emit()

    def set_fps(self, fps: int) -> None:
        self.fps = max(1, min(120, int(fps)))
        if self._playing:
            self._timer.start(self._interval())

    def _interval(self) -> int:
        return max(4, int(1000.0 / max(1, self.fps)))

    # ------------------------------------------------------------- controls
    def play(self) -> None:
        if self._playing:
            return
        if self._frame >= self.end_frame - 0.001:
            self._frame = float(self.start_frame)
        self._playing = True
        self._last_time = time.perf_counter()
        self._accum = 0.0
        self._timer.start(self._interval())
        self.playing_changed.emit(True)
        self.frame_changed.emit(self._frame)

    def pause(self) -> None:
        if not self._playing:
            return
        self._playing = False
        self._timer.stop()
        self.playing_changed.emit(False)

    def stop(self) -> None:
        self.pause()
        self.seek(self.start_frame)

    def toggle(self) -> None:
        self.pause() if self._playing else self.play()

    def seek(self, frame: float, snap: bool = True) -> None:
        frame = clamp(float(frame), self.start_frame, self.end_frame)
        if snap:
            frame = float(round(frame))
        if abs(frame - self._frame) < 1e-6:
            return
        self._frame = frame
        self.frame_changed.emit(self._frame)

    def step(self, delta: int = 1) -> None:
        self.pause()
        self.seek(self._frame + delta)

    def step_seconds(self, seconds: float) -> None:
        self.pause()
        self.seek(self._frame + seconds * self.fps)

    def goto_start(self) -> None:
        self.pause()
        self.seek(self.start_frame)

    def goto_end(self) -> None:
        self.pause()
        self.seek(self.end_frame)

    # ----------------------------------------------------------------- tick
    def _tick(self) -> None:
        if not self._playing:
            return
        now = time.perf_counter()
        dt = max(0.0, now - self._last_time)
        self._last_time = now
        self._accum += dt
        step = 1.0 / max(1, self.fps)
        if self._accum < step * 0.5:
            return
        frames = self._accum / step
        self._accum -= frames * step
        new_frame = self._frame + frames
        if new_frame > self.end_frame + 0.999:
            if self.loop:
                span = max(1, self.end_frame - self.start_frame + 1)
                new_frame = self.start_frame + ((new_frame - self.start_frame) % span)
            else:
                self._frame = float(self.end_frame)
                self.frame_changed.emit(self._frame)
                self.pause()
                return
        self._frame = new_frame
        self.frame_changed.emit(self._frame)
