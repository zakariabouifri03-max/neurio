"""Preview panel: WYSIWYG frame display and transport controls."""
from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtGui import QPixmap
from PySide6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QPushButton,
                               QLabel, QSlider, QComboBox)

from ..core.timecode import fmt_timecode
from ..playback.frame_server import FrameServer


class PreviewPanel(QWidget):
    positionChanged = Signal(float)

    def __init__(self, controller, parent=None):
        super().__init__(parent)
        self.controller = controller
        self.server = FrameServer(self)
        self._position = 0.0
        layout = QVBoxLayout(self)
        layout.setContentsMargins(8, 8, 8, 8)

        self.screen = QLabel("Import media and drag a clip onto the timeline")
        self.screen.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.screen.setStyleSheet(
            "background:#000;border-radius:10px;color:#8a97a8;font-size:15px;")
        self.screen.setMinimumHeight(260)
        layout.addWidget(self.screen, 1)

        bar = QHBoxLayout()
        self.btn_play = QPushButton("▶ Play")
        self.btn_pause = QPushButton("⏸")
        self.btn_stop = QPushButton("⏹")
        self.btn_back = QPushButton("◀ frame")
        self.btn_fwd = QPushButton("frame ▶")
        for b in (self.btn_back, self.btn_play, self.btn_pause,
                  self.btn_stop, self.btn_fwd):
            bar.addWidget(b)
        self.speed = QComboBox()
        self.speed.addItems(["0.25x", "0.5x", "1x", "1.5x", "2x"])
        self.speed.setCurrentText("1x")
        bar.addWidget(self.speed)
        self.time_label = QLabel("00:00:00:00 / 00:00:00:00")
        bar.addStretch(1)
        bar.addWidget(self.time_label)
        layout.addLayout(bar)

        self.scrub = QSlider(Qt.Orientation.Horizontal)
        self.scrub.setRange(0, 1000)
        layout.addWidget(self.scrub)

        self.btn_play.clicked.connect(self.play)
        self.btn_pause.clicked.connect(self.pause)
        self.btn_stop.clicked.connect(self.stop)
        self.btn_back.clicked.connect(lambda: self.server.frame_step(-1))
        self.btn_fwd.clicked.connect(lambda: self.server.frame_step(1))
        self.scrub.sliderMoved.connect(self._scrub)
        self.server.frameReady.connect(self._on_frame)
        self.server.positionChanged.connect(self._on_position)
        self.server.endReached.connect(self._on_end)
        self.server.error.connect(lambda m: self._status(m))
        self.controller.projectChanged.connect(self._project_changed)
        self.controller.timelineChanged.connect(self._update_duration)

    # ------------------------------------------------------------- actions
    def _project_changed(self, project) -> None:
        quality = {"full": 1.0, "half": 0.5, "quarter": 0.25}.get(
            self.controller.config.get("preview_quality", "half"), 0.5)
        self.server.set_quality(quality)
        self.server.set_project(project)
        self._update_duration()

    def _update_duration(self) -> None:
        total = self.controller.project.timeline.duration()
        fps = self.controller.project.settings.fps
        self.time_label.setText(
            f"{fmt_timecode(self._position, fps)} / {fmt_timecode(total, fps)}")

    def play(self) -> None:
        if self.controller.project.timeline.duration() <= 0:
            self._status("The timeline is empty")
            return
        self.server.play(self._position)

    def pause(self) -> None:
        self.server.pause()

    def stop(self) -> None:
        self.server.stop()
        self._position = 0.0
        self.scrub.setValue(0)
        self.positionChanged.emit(0.0)

    def seek(self, time_s: float) -> None:
        self._position = max(0.0, time_s)
        self.server.seek(self._position)
        self.positionChanged.emit(self._position)

    def _scrub(self, value: int) -> None:
        total = self.controller.project.timeline.duration()
        self.seek(total * value / 1000.0)

    def _on_frame(self, image) -> None:
        pix = QPixmap.fromImage(image)
        self.screen.setPixmap(pix.scaled(
            self.screen.size(), Qt.AspectRatioMode.KeepAspectRatio,
            Qt.TransformationMode.SmoothTransformation))

    def _on_position(self, t: float) -> None:
        self._position = t
        total = max(0.001, self.controller.project.timeline.duration())
        self.scrub.setValue(int(min(1.0, t / total) * 1000))
        self._update_duration()
        self.positionChanged.emit(t)

    def _on_end(self) -> None:
        self._status("Playback finished")

    def _status(self, message: str) -> None:
        win = self.window()
        if win:
            win.statusBar().showMessage(message, 5000)
