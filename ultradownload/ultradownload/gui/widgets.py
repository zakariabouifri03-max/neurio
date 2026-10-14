"""Reusable UI components: stat cards, status chips, download cards."""

from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (QFrame, QHBoxLayout, QLabel, QProgressBar,
                               QPushButton, QSizePolicy, QVBoxLayout,
                               QWidget)

from ..models import DownloadStatus
from ..utils import format_bytes, format_eta, format_speed

STATUS_LABELS = {
    DownloadStatus.QUEUED.value: "QUEUED",
    DownloadStatus.ACTIVE.value: "DOWNLOADING",
    DownloadStatus.PAUSED.value: "PAUSED",
    DownloadStatus.COMPLETED.value: "COMPLETED",
    DownloadStatus.FAILED.value: "FAILED",
    DownloadStatus.CANCELLED.value: "CANCELLED",
}


class StatusChip(QLabel):
    """Small colored pill showing a download status."""

    def __init__(self, status: str = "queued", parent=None) -> None:
        super().__init__(parent)
        self.setObjectName("StatusChip")
        self.set_status(status)

    def set_status(self, status: str) -> None:
        self.setProperty("status", status)
        self.setText(STATUS_LABELS.get(status, status.upper()))
        # re-polish so the dynamic property takes effect
        self.style().unpolish(self)
        self.style().polish(self)


class StatCard(QFrame):
    """Dashboard metric card: title, big value, optional sub-line."""

    def __init__(self, title: str, value: str = "--", sub: str = "",
                 parent=None) -> None:
        super().__init__(parent)
        self.setObjectName("StatCard")
        self.setMinimumWidth(170)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(16, 14, 16, 14)
        layout.setSpacing(4)
        self.title_lbl = QLabel(title.upper())
        self.title_lbl.setObjectName("StatCardTitle")
        self.value_lbl = QLabel(value)
        self.value_lbl.setObjectName("StatCardValue")
        self.sub_lbl = QLabel(sub)
        self.sub_lbl.setObjectName("StatCardSub")
        self.sub_lbl.setVisible(bool(sub))
        layout.addWidget(self.title_lbl)
        layout.addWidget(self.value_lbl)
        layout.addWidget(self.sub_lbl)

    def set_value(self, value: str, sub: str = "") -> None:
        self.value_lbl.setText(value)
        if sub:
            self.sub_lbl.setText(sub)
            self.sub_lbl.setVisible(True)
        elif self.sub_lbl.text() and not sub:
            self.sub_lbl.setVisible(False)


class DownloadCard(QFrame):
    """One active/queued download on the dashboard."""

    clicked = Signal(int)          # open details
    pause_resume_clicked = Signal(int)
    cancel_clicked = Signal(int)

    def __init__(self, task_id: int, parent=None) -> None:
        super().__init__(parent)
        self.setObjectName("DownloadCard")
        self.task_id = task_id
        self._status = DownloadStatus.QUEUED.value

        root = QVBoxLayout(self)
        root.setContentsMargins(16, 12, 16, 12)
        root.setSpacing(8)

        top = QHBoxLayout()
        top.setSpacing(10)
        self.filename_lbl = QLabel("file")
        self.filename_lbl.setObjectName("CardFilename")
        self.filename_lbl.setTextInteractionFlags(
            (Qt.TextInteractionFlag.TextSelectableByMouse | Qt.TextInteractionFlag.TextSelectableByKeyboard))
        self.chip = StatusChip()
        self.speed_lbl = QLabel("")
        self.speed_lbl.setObjectName("CardSpeed")
        self.speed_lbl.setAlignment(Qt.AlignmentFlag.AlignRight |
                                    Qt.AlignmentFlag.AlignVCenter)
        top.addWidget(self.filename_lbl, 1)
        top.addWidget(self.chip)
        top.addWidget(self.speed_lbl)
        root.addLayout(top)

        self.progress = QProgressBar()
        self.progress.setRange(0, 1000)
        self.progress.setValue(0)
        self.progress.setTextVisible(True)
        self.progress.setFormat("%p%")
        self.progress.setFixedHeight(10)
        root.addWidget(self.progress)

        bottom = QHBoxLayout()
        bottom.setSpacing(8)
        self.meta_lbl = QLabel("")
        self.meta_lbl.setObjectName("CardMeta")
        self.details_btn = QPushButton("Details")
        self.details_btn.setObjectName("CardButton")
        self.pause_btn = QPushButton("Pause")
        self.pause_btn.setObjectName("CardButton")
        self.cancel_btn = QPushButton("Cancel")
        self.cancel_btn.setObjectName("CardButton")
        bottom.addWidget(self.meta_lbl, 1)
        bottom.addWidget(self.details_btn)
        bottom.addWidget(self.pause_btn)
        bottom.addWidget(self.cancel_btn)
        root.addLayout(bottom)

        self.details_btn.clicked.connect(lambda: self.clicked.emit(self.task_id))
        self.pause_btn.clicked.connect(
            lambda: self.pause_resume_clicked.emit(self.task_id))
        self.cancel_btn.clicked.connect(
            lambda: self.cancel_clicked.emit(self.task_id))
        self.setSizePolicy(QSizePolicy.Policy.Expanding,
                           QSizePolicy.Policy.Fixed)

    # -- updates ---------------------------------------------------------
    def set_task(self, task: dict) -> None:
        self.filename_lbl.setText(task.get("filename", "?"))
        status = task.get("status", "queued")
        if status != self._status:
            self._status = status
            self.chip.set_status(status)
        active = status == DownloadStatus.ACTIVE.value
        pausable = status in (DownloadStatus.ACTIVE.value,
                              DownloadStatus.QUEUED.value)
        self.pause_btn.setText(
            "Resume" if status == DownloadStatus.PAUSED.value else "Pause")
        self.pause_btn.setEnabled(pausable or
                                  status == DownloadStatus.PAUSED.value)
        self.cancel_btn.setEnabled(
            status in (DownloadStatus.ACTIVE.value,
                       DownloadStatus.QUEUED.value,
                       DownloadStatus.PAUSED.value))

    def set_progress(self, prog: dict) -> None:
        downloaded = prog.get("downloaded", 0)
        total = prog.get("total", -1)
        speed = prog.get("speed", 0.0)
        eta = prog.get("eta")
        percent = prog.get("percent")
        if total and total > 0:
            self.progress.setRange(0, 1000)
            value = percent if percent is not None else \
                downloaded * 100.0 / total
            self.progress.setValue(int(min(1000, value * 10)))
            self.progress.setFormat(f"{value:.1f}%")
        else:
            self.progress.setRange(0, 0)   # busy indicator (unknown size)
        self.speed_lbl.setText(
            format_speed(speed) if self._status == DownloadStatus.ACTIVE.value
            else "")
        meta = []
        if total and total > 0:
            meta.append(f"{format_bytes(downloaded)} / {format_bytes(total)}")
        else:
            meta.append(f"{format_bytes(downloaded)} downloaded")
        if eta is not None and speed > 0 and \
                self._status == DownloadStatus.ACTIVE.value:
            meta.append(f"ETA {format_eta(eta)}")
        conn = prog.get("active_connections")
        if conn:
            meta.append(f"{conn} connections")
        self.meta_lbl.setText("   •   ".join(meta))


def spacer() -> QWidget:
    w = QWidget()
    w.setSizePolicy(QSizePolicy.Policy.Expanding,
                    QSizePolicy.Policy.Preferred)
    return w
