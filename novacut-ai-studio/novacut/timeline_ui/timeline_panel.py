"""Timeline panel: toolbar + graphics view, bound to the controller."""
from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QPushButton,
                               QLabel, QComboBox, QDoubleSpinBox, QCheckBox)

from ..core.timecode import fmt_timecode
from ..editing.operations import (AddTrackCommand, RemoveTrackCommand,
                                  SplitClipCommand, SetClipPropertyCommand)
from ..models.enums import TrackKind
from .timeline_widget import TimelineScene, TimelineView, RULER_HEIGHT


class TimelinePanel(QWidget):
    seekRequested = Signal(float)

    def __init__(self, controller, parent=None):
        super().__init__(parent)
        self.controller = controller
        self.scene = TimelineScene()
        self.view = TimelineView(self.scene)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(6, 6, 6, 6)
        layout.setSpacing(6)

        bar = QHBoxLayout()
        self.btn_zoom_out = QPushButton("−")
        self.btn_zoom_in = QPushButton("+")
        self.btn_zoom_out.setFixedWidth(34)
        self.btn_zoom_in.setFixedWidth(34)
        self.btn_zoom_out.clicked.connect(lambda: self.scene.set_zoom(
            self.scene.pixels_per_second / 1.25))
        self.btn_zoom_in.clicked.connect(lambda: self.scene.set_zoom(
            self.scene.pixels_per_second * 1.25))
        bar.addWidget(QLabel("Timeline"))
        bar.addStretch(1)
        self.snap_check = QCheckBox("Snap")
        self.snap_check.setChecked(True)
        self.snap_check.toggled.connect(self._on_snap_toggle)
        bar.addWidget(self.snap_check)
        self.btn_split = QPushButton("Split at playhead")
        self.btn_split.clicked.connect(self._split_selected)
        bar.addWidget(self.btn_split)
        bar.addWidget(self.btn_zoom_out)
        bar.addWidget(self.btn_zoom_in)
        self.btn_add_v = QPushButton("+ Video track")
        self.btn_add_a = QPushButton("+ Audio track")
        self.btn_add_v.clicked.connect(lambda: self._add_track(TrackKind.VIDEO.value))
        self.btn_add_a.clicked.connect(lambda: self._add_track(TrackKind.AUDIO.value))
        bar.addWidget(self.btn_add_v)
        bar.addWidget(self.btn_add_a)
        layout.addLayout(bar)
        layout.addWidget(self.view, 1)

        self.time_label = QLabel("00:00:00:00")
        layout.addWidget(self.time_label)

        self.scene.commandRequested.connect(self.controller.execute)
        self.view.commandRequested.connect(self.controller.execute)
        self.view.seekRequested.connect(self.seekRequested)
        self.view.clipSelected.connect(self.controller.select_clip)
        self.controller.timelineChanged.connect(self.refresh)

    def _on_snap_toggle(self, checked: bool) -> None:
        if self.scene.snapping:
            self.scene.snapping.enabled = checked

    def _add_track(self, kind: str) -> None:
        self.controller.execute(AddTrackCommand(self.controller.project.timeline, kind))

    def _split_selected(self) -> None:
        clip = self.controller.selected_clip
        if clip is None:
            return
        t = self.scene._playhead_time()
        if clip.start < t < clip.end:
            self.controller.execute(
                SplitClipCommand(self.controller.project.timeline, clip.id, t))

    def refresh(self) -> None:
        self.scene.set_project(self.controller.project)
        if self.scene.snapping:
            self.scene.snapping.enabled = self.snap_check.isChecked()

    def set_playhead(self, time_s: float) -> None:
        self.scene.update_playhead(time_s)
        self.time_label.setText(
            fmt_timecode(time_s, self.controller.project.settings.fps))
