"""Reusable GUI widgets: animated progress, stat cards, download cards, parts."""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt, QTimer, Signal
from PySide6.QtWidgets import (QFrame, QHBoxLayout, QLabel, QProgressBar,
                               QPushButton, QVBoxLayout, QWidget)

from ..utils import format_bytes, format_eta, format_speed

STATUS_COLORS = {
    "queued": ("#8b98ad", "Queued"),
    "running": ("#4f8cff", "Downloading"),
    "merging": ("#8b7cf6", "Assembling"),
    "paused": ("#ffb02e", "Paused"),
    "completed": ("#3ddc84", "Complete"),
    "failed": ("#ff5c6c", "Failed"),
    "cancelled": ("#6b7488", "Cancelled"),
}


class StatusPill(QLabel):
    """Small rounded status badge."""

    def __init__(self, parent=None) -> None:
        super().__init__(parent)
        self.setAlignment(Qt.AlignCenter)
        self.setFixedHeight(24)
        self.set_status("queued")

    def set_status(self, status: str) -> None:
        color, label = STATUS_COLORS.get(status, ("#8b98ad", status.title()))
        self.setText(label)
        self.setStyleSheet(
            f"background: {color}22; color: {color}; border-radius: 12px;"
            f"padding: 2px 12px; font-size: 11px; font-weight: 600;")


class AnimatedProgressBar(QProgressBar):
    """Progress bar that eases toward the real value (no fake data)."""

    def __init__(self, parent=None, big: bool = False) -> None:
        super().__init__(parent)
        self.setTextVisible(False)
        self.setRange(0, 1000)  # 0.1% granularity for smooth motion
        self._target = 0.0
        self._current = 0.0
        if big:
            self.setObjectName("big")
        self._timer = QTimer(self)
        self._timer.setInterval(16)
        self._timer.timeout.connect(self._tick)
        self._animating = False

    def set_progress(self, percent: float) -> None:
        self._target = max(0.0, min(100.0, percent)) * 10.0
        if not self._animating:
            self._animating = True
            self._timer.start()

    def _tick(self) -> None:
        diff = self._target - self._current
        if abs(diff) < 2.0:
            self._current = self._target
            self._animating = False
            self._timer.stop()
        else:
            self._current += diff * 0.22
        super().setValue(int(self._current))


class StatCard(QFrame):
    def __init__(self, title: str, glyph: str = "●", parent=None) -> None:
        super().__init__(parent)
        self.setObjectName("card")
        lay = QVBoxLayout(self)
        lay.setContentsMargins(18, 16, 18, 16)
        lay.setSpacing(4)
        top = QHBoxLayout()
        icon = QLabel(glyph)
        icon.setStyleSheet("font-size: 18px; color: #4f8cff;")
        title_l = QLabel(title.upper())
        title_l.setObjectName("statTitle")
        top.addWidget(icon)
        top.addWidget(title_l)
        top.addStretch()
        self.value_l = QLabel("—")
        self.value_l.setObjectName("statValue")
        self.sub_l = QLabel("")
        self.sub_l.setObjectName("faint")
        lay.addLayout(top)
        lay.addWidget(self.value_l)
        lay.addWidget(self.sub_l)

    def set_value(self, value: str, sub: str = "") -> None:
        self.value_l.setText(value)
        self.sub_l.setText(sub)
        self.sub_l.setVisible(bool(sub))


class DownloadCard(QFrame):
    """One active download with live progress and controls."""

    pause_clicked = Signal(str)
    cancel_clicked = Signal(str)
    details_clicked = Signal(str)

    def __init__(self, task_id: str, filename: str, parent=None) -> None:
        super().__init__(parent)
        self.setObjectName("card")
        self.task_id = task_id
        self._paused_once = False

        lay = QVBoxLayout(self)
        lay.setContentsMargins(18, 14, 18, 14)
        lay.setSpacing(10)

        head = QHBoxLayout()
        self.name_l = QLabel(filename)
        self.name_l.setObjectName("sectionTitle")
        self.name_l.setWordWrap(True)
        self.pill = StatusPill()
        head.addWidget(self.name_l, 1)
        head.addWidget(self.pill, 0, Qt.AlignRight)
        lay.addLayout(head)

        self.bar = AnimatedProgressBar(big=True)
        lay.addWidget(self.bar)

        mid = QHBoxLayout()
        self.pct_l = QLabel("0%")
        self.pct_l.setStyleSheet("font-weight: 700;")
        self.size_l = QLabel("—")
        self.size_l.setObjectName("dim")
        self.speed_l = QLabel("0 B/s")
        self.speed_l.setObjectName("dim")
        self.eta_l = QLabel("—")
        self.eta_l.setObjectName("dim")
        for w in (self.pct_l, self.size_l, self.speed_l, self.eta_l):
            mid.addWidget(w)
        mid.addStretch()
        lay.addLayout(mid)

        btns = QHBoxLayout()
        self.pause_btn = QPushButton("Pause")
        self.pause_btn.setObjectName("smallTool")
        self.pause_btn.clicked.connect(lambda: self.pause_clicked.emit(self.task_id))
        self.cancel_btn = QPushButton("Cancel")
        self.cancel_btn.setObjectName("smallTool")
        self.cancel_btn.clicked.connect(lambda: self.cancel_clicked.emit(self.task_id))
        self.details_btn = QPushButton("Details")
        self.details_btn.setObjectName("smallTool")
        self.details_btn.clicked.connect(lambda: self.details_clicked.emit(self.task_id))
        btns.addWidget(self.pause_btn)
        btns.addWidget(self.cancel_btn)
        btns.addStretch()
        btns.addWidget(self.details_btn)
        lay.addLayout(btns)

    def update_task(self, snap: dict) -> None:
        self.name_l.setText(snap.get("filename") or "…")
        self.pill.set_status(snap.get("status", "queued"))
        self.bar.set_progress(snap.get("progress", 0.0))
        self.pct_l.setText(f"{snap.get('progress', 0.0):.1f}%")
        total = snap.get("total_size")
        done = snap.get("downloaded", 0)
        self.size_l.setText(
            f"{format_bytes(done)} / {format_bytes(total) if total else '?'}")
        self.speed_l.setText(format_speed(snap.get("speed")))
        self.eta_l.setText(f"ETA {format_eta(snap.get('eta'))}")
        status = snap.get("status")
        self.pause_btn.setEnabled(status in ("running", "paused"))
        self.pause_btn.setText("Pause" if status == "running" else "Resume")


class PartWidget(QFrame):
    """Grid item for one download part (the 40-part monitor)."""

    def __init__(self, index: int, parent=None) -> None:
        super().__init__(parent)
        self.setObjectName("card")
        lay = QVBoxLayout(self)
        lay.setContentsMargins(12, 10, 12, 10)
        lay.setSpacing(6)

        head = QHBoxLayout()
        self.title_l = QLabel(f"Part {index + 1}")
        self.title_l.setStyleSheet("font-weight: 600; font-size: 12px;")
        self.status_l = QLabel("Queued")
        self.status_l.setObjectName("faint")
        head.addWidget(self.title_l)
        head.addStretch()
        head.addWidget(self.status_l)
        lay.addLayout(head)

        self.bar = QProgressBar()
        self.bar.setObjectName("mini")
        self.bar.setRange(0, 1000)
        self.bar.setTextVisible(False)
        lay.addWidget(self.bar)

        info = QHBoxLayout()
        self.bytes_l = QLabel("0 B")
        self.bytes_l.setObjectName("faint")
        self.speed_l = QLabel("")
        self.speed_l.setObjectName("faint")
        info.addWidget(self.bytes_l)
        info.addStretch()
        info.addWidget(self.speed_l)
        lay.addLayout(info)
        self.setMinimumWidth(180)

    def update_part(self, snap: dict) -> None:
        length = snap.get("length") or 0
        done = snap.get("downloaded", 0)
        self.bar.setValue(int(min(1000, done * 1000 / length)) if length else 0)
        status = snap.get("status", "queued")
        color = STATUS_COLORS.get(status, ("#8b98ad", status))[0]
        self.status_l.setText(STATUS_COLORS.get(status, ("", status))[1])
        self.status_l.setStyleSheet(f"color: {color}; font-size: 11px;")
        self.bytes_l.setText(f"{format_bytes(done)} / {format_bytes(length)}")
        speed = snap.get("speed", 0.0)
        self.speed_l.setText(format_speed(speed) if speed else "")


class EmptyState(QWidget):
    """Centered hint when a list has no items."""

    def __init__(self, text: str, parent=None) -> None:
        super().__init__(parent)
        lay = QVBoxLayout(self)
        lay.addStretch()
        lab = QLabel(text)
        lab.setObjectName("faint")
        lab.setAlignment(Qt.AlignCenter)
        lab.setWordWrap(True)
        lay.addWidget(lab)
        lay.addStretch()


def open_in_file_manager(path: str | Path) -> bool:
    """Open the folder containing *path* (or the folder itself)."""
    from PySide6.QtCore import QUrl
    from PySide6.QtGui import QDesktopServices
    p = Path(path)
    target = p if p.is_dir() else p.parent
    return QDesktopServices.openUrl(QUrl.fromLocalFile(str(target)))
