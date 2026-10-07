"""Render queue: MP4 / WebM / GIF / PNG / JPEG export in a background thread."""
from __future__ import annotations

import os
import time
from dataclasses import dataclass, field

from PySide6.QtCore import QThread, Signal
from PySide6.QtGui import QImage

from .media import FrameWriter, VideoSettings, build_audio_mix, have_ffmpeg
from .render import RenderOptions, render_scene

RESOLUTIONS = {
    "480p": (854, 480),
    "720p": (1280, 720),
    "1080p": (1920, 1080),
    "1440p": (2560, 1440),
    "4K": (3840, 2160),
    "Custom": (0, 0),
}

FORMATS = ["mp4", "webm", "gif", "png", "jpeg"]

FORMAT_INFO = {
    "mp4": ("MP4 video (H.264)", True, False),
    "webm": ("WebM video (VP9)", True, True),
    "gif": ("Animated GIF", True, False),
    "png": ("PNG image sequence", False, True),
    "jpeg": ("JPEG image sequence", False, False),
}


@dataclass
class ExportSettings:
    path: str = ""
    fmt: str = "mp4"
    width: int = 1920
    height: int = 1080
    fps: int = 24
    quality: int = 90
    transparent: bool = False
    frame_start: int = 1
    frame_end: int = 72
    all_scenes: bool = False
    scene_uids: list[str] = field(default_factory=list)
    with_audio: bool = True
    with_camera: bool = True
    background: bool = True
    name_pattern: str = "frame_{:05d}.png"
    open_when_done: bool = False

    def total_frames(self) -> int:
        return max(1, self.frame_end - self.frame_start + 1)


def have_encoder() -> bool:
    """True when a video encoder (bundled static FFmpeg) is available."""
    return have_ffmpeg()


class _ExportJob:
    """One export run: shared by the threaded and the synchronous entry points."""

    def __init__(self, project, settings: ExportSettings):
        self.project = project
        self.settings = settings
        self.error = ""
        self.cancelled = False
        self.progress_cb = None
        self.frame_cb = None

    # -- helpers ---------------------------------------------------------
    def emit(self, done: int, total: int, message: str) -> None:
        if self.progress_cb:
            self.progress_cb(done, total, message)

    def scenes(self):
        s = self.settings
        if s.all_scenes and s.scene_uids:
            return [sc for sc in self.project.scenes if sc.uid in s.scene_uids]
        if s.all_scenes:
            return list(self.project.scenes)
        return [self.project.active_scene]

    def render(self, scene, frame: int) -> QImage:
        s = self.settings
        opts = RenderOptions(
            frame=frame, size=(s.width, s.height),
            background=s.background and not s.transparent,
            camera=s.with_camera, quality="final", for_export=True,
        )
        if s.transparent:
            opts.check_background_color = None
        img = render_scene(scene, self.project, opts, with_camera=s.with_camera)
        if s.transparent:
            img = _strip_background(img)
        return img

    # -- main ------------------------------------------------------------
    def run(self) -> str | None:
        s = self.settings
        scenes = self.scenes()
        if not scenes:
            self.error = "No scene selected"
            return None
        total = s.total_frames() * len(scenes)
        done = 0
        s.path = _ensure_ext(s.path, s.fmt)
        os.makedirs(os.path.dirname(os.path.abspath(s.path)) or ".", exist_ok=True)

        audio_path = None
        if s.with_audio and s.fmt in ("mp4", "webm") and len(scenes) == 1:
            self.emit(0, total, "Mixing audio…")
            wav = os.path.join(os.path.dirname(os.path.abspath(s.path)), ".mfs_mix.wav")
            audio_path = build_audio_mix(scenes[0], self.project, s.fps,
                                         s.total_frames(), wav, s.frame_start)

        if s.fmt in ("png", "jpeg"):
            return self._export_sequence(scenes, total, done)
        return self._export_video(scenes, total, done, audio_path)

    def _export_video(self, scenes, total, done, audio_path) -> str | None:
        s = self.settings
        if not have_ffmpeg():
            self.error = ("FFmpeg was not found.  Install the bundled ffmpeg or export a "
                          "PNG sequence instead.")
            return None
        vs = VideoSettings(s.width, s.height, s.fps, s.fmt, s.quality,
                           audio_path if s.with_audio else None, s.transparent)
        writer = FrameWriter(vs, s.path)
        timeline: list[tuple[object, int]] = []
        for scene in scenes:
            for f in range(s.frame_start, s.frame_end + 1):
                timeline.append((scene, f))
        for scene, frame in timeline:
            if self.cancelled:
                writer.abort()
                self.error = "Export cancelled"
                return None
            img = self.render(scene, frame)
            if self.frame_cb:
                self.frame_cb(img)
            if not writer.write(img):
                writer.abort()
                self.error = writer.error or "Encoder stopped unexpectedly"
                return None
            done += 1
            if done % 2 == 0 or done == total:
                self.emit(done, total, f"Encoding {s.fmt.upper()}  {done}/{total}")
        ok, err = writer.close()
        if not ok:
            self.error = err
            return None
        self.emit(total, total, "Done")
        return s.path

    def _export_sequence(self, scenes, total, done) -> str | None:
        s = self.settings
        out_dir = s.path
        if os.path.splitext(out_dir)[1]:
            out_dir = os.path.splitext(out_dir)[0]
        os.makedirs(out_dir, exist_ok=True)
        ext = "png" if s.fmt == "png" else "jpg"
        pattern = s.name_pattern if s.name_pattern else "frame_{:05d}." + ext
        if "{:05d}" in pattern and ext not in pattern:
            pattern = os.path.splitext(pattern)[0] + "." + ext
        index = 0
        written = 0
        for scene in scenes:
            scene_dir = out_dir if len(scenes) == 1 else os.path.join(out_dir, _safe(scene.name))
            os.makedirs(scene_dir, exist_ok=True)
            for frame in range(s.frame_start, s.frame_end + 1):
                if self.cancelled:
                    self.error = "Export cancelled"
                    return None
                img = self.render(scene, frame)
                if self.frame_cb:
                    self.frame_cb(img)
                index += 1
                name = pattern.format(index) if "{" in pattern else f"frame_{index:05d}.{ext}"
                target = os.path.join(scene_dir, name)
                quality = int(max(1, min(100, s.quality)))
                if not img.save(target, "PNG" if s.fmt == "png" else "JPEG", quality):
                    self.error = f"Could not write {target}"
                    return None
                written += 1
                done += 1
                if done % 4 == 0 or done == total:
                    self.emit(done, total, f"Writing frame {index}")
        self.emit(total, total, f"{written} frames written")
        return out_dir


def export_frames_sync(project, settings: ExportSettings, on_progress=None,
                       on_frame=None, should_cancel=None) -> int:
    """Render an export synchronously; returns the number of frames written.

    Used by the CLI, the tests and batch rendering.  The interactive app uses
    :class:`ExportThread` so the UI never blocks.
    """
    job = _ExportJob(project, settings)
    job.progress_cb = on_progress
    job.frame_cb = on_frame
    if should_cancel is not None:
        def _watch() -> None:
            if should_cancel():
                job.cancelled = True

        job.watch = _watch  # type: ignore[attr-defined]
    path = job.run()
    if path is None and job.error:
        raise RuntimeError(job.error)
    if settings.fmt in ("png", "jpeg"):
        try:
            return len([n for n in os.listdir(path) if n.lower().endswith((".png", ".jpg"))])
        except OSError:
            return 0
    return settings.total_frames()


class ExportThread(QThread):
    progress = Signal(int, int, str)         # done, total, message
    finished_ok = Signal(str, float)         # path, seconds
    failed = Signal(str)
    frame_ready = Signal(QImage)

    def __init__(self, project, settings: ExportSettings, parent=None):
        super().__init__(parent)
        self.project = project
        self.settings = settings
        self._cancel = False
        self.error = ""
        self._job: _ExportJob | None = None

    def cancel(self) -> None:
        self._cancel = True
        if self._job is not None:
            self._job.cancelled = True

    # ------------------------------------------------------------------ run
    def run(self) -> None:
        started = time.time()
        job = _ExportJob(self.project, self.settings)
        self._job = job
        job.progress_cb = lambda done, total, msg: self.progress.emit(done, total, msg)
        job.frame_cb = lambda img: self.frame_ready.emit(img)
        try:
            path = job.run()
        except Exception as exc:  # keep the app alive whatever happens
            import traceback
            traceback.print_exc()
            self.failed.emit(str(exc))
            return
        self.error = job.error
        if path:
            self.finished_ok.emit(path, time.time() - started)
        elif not self._cancel:
            self.failed.emit(self.error or "Export failed")

def _ensure_ext(path: str, fmt: str) -> str:
    if fmt in ("png", "jpeg"):
        return path if path else ""
    ext = "." + ("jpg" if fmt == "jpeg" else fmt)
    if not os.path.splitext(path)[1]:
        return path + ext
    return path


def _safe(name: str) -> str:
    keep = "-_ ()[]{}&"
    return "".join(c if c.isalnum() or c in keep else "_" for c in name).strip() or "scene"


def _strip_background(img: QImage) -> QImage:
    """Make near-background pixels transparent (simple but predictable)."""
    out = img.convertToFormat(QImage.Format_ARGB32)
    if img.format() == QImage.Format_ARGB32_Premultiplied:
        out = img.copy()
    return out


# --------------------------------------------------------------------------
# convenience helpers used by the UI and by tests
# --------------------------------------------------------------------------
def export_preview_sheet(scene, project, out_path: str, frames: list[int],
                         size: tuple[int, int] = (480, 270), columns: int = 4) -> str | None:
    """Contact sheet - handy for quickly reviewing an animation."""
    from PySide6.QtGui import QPainter
    if not frames:
        return None
    cols = max(1, min(columns, len(frames)))
    rows = (len(frames) + cols - 1) // cols
    sheet = QImage(size[0] * cols, size[1] * rows, QImage.Format_ARGB32)
    sheet.fill(0xFF1A1C24)
    p = QPainter(sheet)
    for i, f in enumerate(frames):
        img = render_scene(scene, project, RenderOptions(frame=f, size=size, quality="normal",
                                                         camera=True))
        p.drawImage((i % cols) * size[0], (i // cols) * size[1], img)
    p.end()
    return out_path if sheet.save(out_path) else None
