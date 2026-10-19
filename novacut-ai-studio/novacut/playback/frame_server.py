"""WYSIWYG preview: the same filter graph as export, decoded to raw frames.

A single FFmpeg process renders the composed timeline (all tracks, effects,
transitions, titles) to RGB24 frames on stdout and, separately, PCM audio.
Seeking restarts the pipeline with an accurate output-side ``-ss``.
"""
from __future__ import annotations

import subprocess
import threading
from pathlib import Path
from typing import Optional

from PySide6.QtCore import QObject, Signal, QThread, QMutex, QWaitCondition

from ..core import paths
from ..core.ffmpeg import find_ffmpeg
from ..core.logging_setup import get_logger
from ..render.filtergraph import FilterGraphBuilder

log = get_logger("playback")


class _ReaderThread(QThread):
    frame = Signal(object)          # bytes
    ended = Signal()
    failed = Signal(str)

    def __init__(self, proc: subprocess.Popen, frame_size: int):
        super().__init__()
        self._proc = proc
        self._size = frame_size
        self._stop = False

    def stop(self) -> None:
        self._stop = True

    def run(self) -> None:
        assert self._proc.stdout is not None
        try:
            while not self._stop:
                buf = self._read_exact(self._size)
                if buf is None:
                    break
                self.frame.emit(buf)
            if not self._stop:
                self.ended.emit()
        except Exception as exc:  # noqa: BLE001
            self.failed.emit(str(exc))

    def _read_exact(self, size: int) -> Optional[bytes]:
        chunks: list[bytes] = []
        remaining = size
        while remaining > 0:
            chunk = self._proc.stdout.read(remaining)
            if not chunk:
                return None
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)


class FrameServer(QObject):
    """Owns the preview FFmpeg processes and emits decoded frames."""

    frameReady = Signal(object)     # QImage
    positionChanged = Signal(float)
    endReached = Signal()
    error = Signal(str)
    stateChanged = Signal(str)      # stopped | playing | paused

    def __init__(self, parent=None):
        super().__init__(parent)
        self._proc: Optional[subprocess.Popen] = None
        self._reader: Optional[_ReaderThread] = None
        self._audio = None
        self._project = None
        self._quality_scale = 1.0
        self._width = self._height = 0
        self._fps = 30.0
        self._start_at = 0.0
        self._running = False
        self._mutex = QMutex()

    # ------------------------------------------------------------- setup
    def set_project(self, project) -> None:
        self.stop()
        self._project = project
        if project:
            self._fps = project.settings.fps
            self._apply_quality_size()

    def set_quality(self, scale: float) -> None:
        self._quality_scale = scale
        if self._project:
            self._apply_quality_size()

    def _apply_quality_size(self) -> None:
        s = self._project.settings
        self._width = max(2, int(s.width * self._quality_scale) // 2 * 2)
        self._height = max(2, int(s.height * self._quality_scale) // 2 * 2)

    # ----------------------------------------------------------- controls
    def play(self, from_time: Optional[float] = None) -> None:
        if self._project is None:
            return
        if from_time is not None:
            self._start_at = max(0.0, from_time)
        self._launch()

    def pause(self) -> None:
        self.stop()
        self.stateChanged.emit("paused")

    def stop(self) -> None:
        self._running = False
        self._terminate_proc()
        if self._reader:
            self._reader.stop()
            self._reader.wait(2000)
            self._reader = None
        if self._audio:
            self._audio.stop()
            self._audio = None
        self.stateChanged.emit("stopped")

    def seek(self, time_s: float) -> None:
        was_running = self._running
        self.stop()
        self._start_at = max(0.0, time_s)
        if was_running:
            self.play()
        else:
            # Decode and show a single frame.
            self._launch(single_frame=True)

    def frame_step(self, delta: int = 1) -> None:
        self.seek(self._start_at + delta / max(1.0, self._fps))

    @property
    def is_playing(self) -> bool:
        return self._running

    # ------------------------------------------------------------- launch
    def _build_script(self) -> tuple[list[str], str, list[str]]:
        builder = FilterGraphBuilder(self._project, use_proxies=True,
                                     terminate_audio_sink=True)
        input_args, script, maps, _duration = builder.build()
        # Downscale for preview at the tail of the graph.
        script += (";\n[" + maps[1].strip("[]") + "]scale="
                   + f"{self._width}:{self._height}"
                   + f":flags=fast_bilinear,fps={self._fps}[pv]")
        paths.ensure_dirs()
        script_path = paths.CACHE_DIR / "preview_filter.txt"
        script_path.write_text(script, encoding="utf-8")
        return input_args, str(script_path), maps

    def _launch(self, single_frame: bool = False) -> None:
        ffmpeg = find_ffmpeg()
        if ffmpeg is None:
            self.error.emit("FFmpeg not found; preview unavailable.")
            return
        self._terminate_proc()
        try:
            input_args, script_path, _maps = self._build_script()
        except Exception as exc:  # noqa: BLE001 - missing media etc.
            self.error.emit(str(exc))
            return
        cmd = [str(ffmpeg), "-hide_banner", "-loglevel", "error", "-nostdin"]
        cmd += input_args
        cmd += ["-filter_complex_script", script_path]
        if self._start_at > 0:
            cmd += ["-ss", f"{self._start_at:.3f}"]
        if single_frame:
            cmd += ["-frames:v", "1"]
        cmd += ["-map", "[pv]", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        try:
            self._proc = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                bufsize=self._width * self._height * 3,
                creationflags=creationflags)
        except FileNotFoundError as exc:
            self.error.emit(str(exc))
            return
        self._running = not single_frame
        frame_size = self._width * self._height * 3
        self._reader = _ReaderThread(self._proc, frame_size)
        self._reader.frame.connect(self._on_frame)
        self._reader.ended.connect(self._on_ended)
        self._reader.failed.connect(self.error)
        self._reader.start()
        if not single_frame:
            self._start_audio(input_args, script_path)
        self.stateChanged.emit("playing" if self._running else "paused")

    def _start_audio(self, input_args, script_path) -> None:
        try:
            from .audio_feed import AudioFeed
            ffmpeg = find_ffmpeg()
            if ffmpeg is None:
                return
            self._audio = AudioFeed(self._project, input_args, script_path,
                                    self._start_at)
            self._audio.start()
        except Exception as exc:  # noqa: BLE001 - audio must never break video
            log.warning("Audio preview unavailable: %s", exc)
            self._audio = None

    # ------------------------------------------------------------- events
    def _on_frame(self, buf: bytes) -> None:
        from PySide6.QtGui import QImage
        img = QImage(bytes(buf), self._width, self._height,
                     self._width * 3, QImage.Format.Format_RGB888).copy()
        self.frameReady.emit(img)
        # Approximate wall-clock position from frame count and fps.
        if not hasattr(self, "_frame_count"):
            self._frame_count = 0
        self._frame_count += 1
        self.positionChanged.emit(self._start_at + self._frame_count / self._fps)

    def _on_ended(self) -> None:
        self._running = False
        self.endReached.emit()
        self.stateChanged.emit("stopped")

    def _terminate_proc(self) -> None:
        if self._proc and self._proc.poll() is None:
            try:
                self._proc.terminate()
                self._proc.wait(timeout=2)
            except Exception:  # noqa: BLE001
                try:
                    self._proc.kill()
                except Exception:
                    pass
        self._proc = None
        self._frame_count = 0
