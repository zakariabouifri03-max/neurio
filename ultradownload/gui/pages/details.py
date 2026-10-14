"""Download Details page: stats, controls, and the per-part grid."""

from __future__ import annotations

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (QFrame, QGridLayout, QHBoxLayout, QLabel,
                               QPushButton, QScrollArea, QVBoxLayout,
                               QWidget)

from ...utils import format_bytes, format_eta, format_speed
from ..widgets import PartWidget, StatusPill, open_in_file_manager


class DetailsPage(QWidget):
    back_requested = Signal()

    def __init__(self, manager, parent=None) -> None:
        super().__init__(parent)
        self.manager = manager
        self.task_id: str | None = None
        self._part_widgets: dict[int, PartWidget] = {}
        self._part_count_drawn = 0

        root = QVBoxLayout(self)
        root.setContentsMargins(28, 24, 28, 24)
        root.setSpacing(16)

        head = QHBoxLayout()
        back = QPushButton("← Back")
        back.setObjectName("secondary")
        back.clicked.connect(self.back_requested.emit)
        self.title_l = QLabel("Download")
        self.title_l.setObjectName("pageTitle")
        self.pill = StatusPill()
        head.addWidget(back)
        head.addWidget(self.title_l, 1)
        head.addWidget(self.pill)
        root.addLayout(head)

        self.url_l = QLabel("")
        self.url_l.setObjectName("faint")
        self.url_l.setTextInteractionFlags(Qt.TextSelectableByMouse)
        root.addWidget(self.url_l)

        # ---- stats grid ---------------------------------------------------
        stats_card = QFrame()
        stats_card.setObjectName("panel")
        grid = QGridLayout(stats_card)
        grid.setContentsMargins(22, 18, 22, 18)
        grid.setHorizontalSpacing(36)
        grid.setVerticalSpacing(12)
        self.stat_labels: dict[str, QLabel] = {}
        fields = [
            ("progress", "Overall Progress"),
            ("sizes", "Downloaded / Total"),
            ("remaining", "Remaining"),
            ("speed", "Overall Speed"),
            ("eta", "Estimated Time Left"),
            ("connections", "Active Connections"),
        ]
        for i, (key, title) in enumerate(fields):
            cap = QLabel(title.upper())
            cap.setObjectName("statTitle")
            val = QLabel("—")
            val.setStyleSheet("font-size: 18px; font-weight: 700;")
            self.stat_labels[key] = val
            row = (i // 3) * 2
            grid.addWidget(cap, row, i % 3)
            grid.addWidget(val, row + 1, i % 3)
        root.addWidget(stats_card)

        # ---- controls -----------------------------------------------------
        controls = QHBoxLayout()
        self.pause_btn = QPushButton("Pause")
        self.pause_btn.setObjectName("primary")
        self.pause_btn.clicked.connect(self._on_pause)
        self.resume_btn = QPushButton("Resume")
        self.resume_btn.setObjectName("primary")
        self.resume_btn.clicked.connect(self._on_resume)
        self.cancel_btn = QPushButton("Cancel")
        self.cancel_btn.setObjectName("danger")
        self.cancel_btn.clicked.connect(self._on_cancel)
        self.retry_btn = QPushButton("Retry")
        self.retry_btn.setObjectName("secondary")
        self.retry_btn.clicked.connect(self._on_retry)
        self.folder_btn = QPushButton("Open Folder")
        self.folder_btn.setObjectName("secondary")
        self.folder_btn.clicked.connect(self._on_folder)
        for b in (self.pause_btn, self.resume_btn, self.cancel_btn,
                  self.retry_btn):
            controls.addWidget(b)
        controls.addStretch()
        controls.addWidget(self.folder_btn)
        root.addLayout(controls)

        self.note_l = QLabel("")
        self.note_l.setObjectName("warn")
        self.note_l.setWordWrap(True)
        root.addWidget(self.note_l)

        # ---- parts grid ---------------------------------------------------
        parts_head = QHBoxLayout()
        self.parts_title = QLabel("Download Parts")
        self.parts_title.setObjectName("sectionTitle")
        parts_head.addWidget(self.parts_title)
        parts_head.addStretch()
        root.addLayout(parts_head)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        self.parts_container = QWidget()
        self.parts_layout = QGridLayout(self.parts_container)
        self.parts_layout.setContentsMargins(0, 0, 8, 0)
        self.parts_layout.setSpacing(10)
        scroll.setWidget(self.parts_container)
        root.addWidget(scroll, 1)

    # ------------------------------------------------------------------ data
    def set_task(self, task_id: str) -> None:
        self.task_id = task_id
        self._part_widgets.clear()
        self._part_count_drawn = 0
        while self.parts_layout.count():
            item = self.parts_layout.takeAt(0)
            if item.widget():
                item.widget().deleteLater()
        self.refresh()

    def refresh(self) -> None:
        if not self.task_id:
            return
        task = self.manager.task(self.task_id)
        if task is None:
            self.title_l.setText("Download not found")
            return
        snap = task.snapshot()
        self.title_l.setText(snap.get("filename") or "…")
        self.pill.set_status(snap.get("status", "queued"))
        self.url_l.setText(snap.get("url", ""))

        total = snap.get("total_size")
        done = snap.get("downloaded", 0)
        self.stat_labels["progress"].setText(f"{snap.get('progress', 0.0):.2f}%")
        self.stat_labels["sizes"].setText(
            f"{format_bytes(done)} / {format_bytes(total) if total else 'unknown'}")
        self.stat_labels["remaining"].setText(
            format_bytes(max(0, (total - done))) if total else "—")
        self.stat_labels["speed"].setText(format_speed(snap.get("speed")))
        self.stat_labels["eta"].setText(format_eta(snap.get("eta")))
        self.stat_labels["connections"].setText(str(snap.get("active_connections", 0)))

        status = snap.get("status")
        self.pause_btn.setEnabled(status in ("running", "queued"))
        self.resume_btn.setEnabled(status in ("paused", "failed", "cancelled", "queued"))
        self.retry_btn.setEnabled(status in ("failed", "cancelled"))
        self.cancel_btn.setEnabled(status in ("running", "queued", "paused", "merging"))

        notes = list(snap.get("notes") or [])
        if snap.get("error"):
            notes.append(f"Error: {snap['error']}")
        self.note_l.setText("   •   ".join(notes))
        self.note_l.setVisible(bool(notes))

        parts = snap.get("parts") or []
        cols = 4
        if len(parts) != self._part_count_drawn:
            while self.parts_layout.count():
                item = self.parts_layout.takeAt(0)
                if item.widget():
                    item.widget().deleteLater()
            self._part_widgets.clear()
            for p in parts:
                w = PartWidget(p["index"])
                self._part_widgets[p["index"]] = w
                self.parts_layout.addWidget(w, p["index"] // cols, p["index"] % cols)
            self._part_count_drawn = len(parts)
        for p in parts:
            w = self._part_widgets.get(p["index"])
            if w:
                w.update_part(p)
        self.parts_title.setText(f"Download Parts ({len(parts)})")

    # ------------------------------------------------------------- controls
    def _on_pause(self) -> None:
        if self.task_id:
            self.manager.pause_task_async(self.task_id)

    def _on_resume(self) -> None:
        if self.task_id:
            self.manager.start_task(self.task_id)

    def _on_cancel(self) -> None:
        from PySide6.QtWidgets import QMessageBox
        if not self.task_id:
            return
        ret = QMessageBox.question(
            self, "Cancel download",
            "Cancel this download?",
            QMessageBox.Yes | QMessageBox.No, QMessageBox.No)
        if ret != QMessageBox.Yes:
            return
        keep = QMessageBox.question(
            self, "Temporary data",
            "Keep the downloaded partial data on disk?",
            QMessageBox.Yes | QMessageBox.No, QMessageBox.Yes)
        self.manager.cancel_task(self.task_id, delete_parts=(keep != QMessageBox.Yes))

    def _on_retry(self) -> None:
        if self.task_id:
            self.manager.retry_task(self.task_id)

    def _on_folder(self) -> None:
        if not self.task_id:
            return
        task = self.manager.task(self.task_id)
        if task:
            open_in_file_manager(task.final_path)
