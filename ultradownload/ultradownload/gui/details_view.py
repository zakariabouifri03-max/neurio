"""Download Details page: overall stats, controls and the per-part grid."""

from __future__ import annotations

import os
from typing import Dict, List, Optional

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (QAbstractItemView, QFrame, QGridLayout,
                               QHBoxLayout, QHeaderView, QLabel, QMessageBox,
                               QProgressBar, QPushButton, QTableWidget,
                               QTableWidgetItem, QTextEdit, QVBoxLayout,
                               QWidget)

from ..manager import DownloadManager
from ..models import DownloadStatus
from ..utils import format_bytes, format_eta, format_speed
from .fsx import open_file, open_in_file_manager
from .widgets import StatusChip


class DetailsPage(QWidget):
    back_requested = Signal()

    COLUMNS = ["#", "Byte range", "Progress", "Downloaded", "Speed", "Status"]

    def __init__(self, manager: DownloadManager, parent=None) -> None:
        super().__init__(parent)
        self.manager = manager
        self.task_id: Optional[int] = None
        self._part_rows: Dict[int, dict] = {}

        root = QVBoxLayout(self)
        root.setContentsMargins(22, 18, 22, 18)
        root.setSpacing(12)

        # --- back row ----------------------------------------------------
        top = QHBoxLayout()
        btn_back = QPushButton("←  Back")
        btn_back.setObjectName("GhostButton")
        btn_back.clicked.connect(self.back_requested)
        top.addWidget(btn_back)
        top.addStretch(1)
        root.addLayout(top)

        # --- header panel --------------------------------------------------
        header = QFrame()
        header.setObjectName("DetailsHeader")
        hlay = QVBoxLayout(header)
        hlay.setContentsMargins(18, 14, 18, 14)
        hlay.setSpacing(10)

        row1 = QHBoxLayout()
        self.name_lbl = QLabel("—")
        self.name_lbl.setObjectName("CardFilename")
        self.name_lbl.setTextInteractionFlags(
            (Qt.TextInteractionFlag.TextSelectableByMouse | Qt.TextInteractionFlag.TextSelectableByKeyboard))
        self.chip = StatusChip()
        row1.addWidget(self.name_lbl, 1)
        row1.addWidget(self.chip)
        hlay.addLayout(row1)

        self.error_lbl = QLabel("")
        self.error_lbl.setObjectName("ErrorBanner")
        self.error_lbl.setWordWrap(True)
        self.error_lbl.setVisible(False)
        hlay.addWidget(self.error_lbl)

        self.progress = QProgressBar()
        self.progress.setObjectName("BigProgress")
        self.progress.setRange(0, 1000)
        self.progress.setFormat("%p%")
        hlay.addWidget(self.progress)

        grid = QGridLayout()
        grid.setHorizontalSpacing(28)
        grid.setVerticalSpacing(8)
        self.stat_labels: Dict[str, QLabel] = {}
        stats = [
            ("size", "TOTAL SIZE"), ("done", "DOWNLOADED"),
            ("left", "REMAINING"), ("speed", "SPEED"),
            ("eta", "TIME LEFT"), ("conn", "CONNECTIONS"),
            ("parts", "PARTS"), ("dest", "DESTINATION"),
        ]
        for i, (key, title) in enumerate(stats):
            t = QLabel(title)
            t.setObjectName("DetailLabel")
            v = QLabel("—")
            v.setObjectName("DetailValue")
            if key == "dest":
                v.setTextInteractionFlags(
                    (Qt.TextInteractionFlag.TextSelectableByMouse | Qt.TextInteractionFlag.TextSelectableByKeyboard))
            grid.addWidget(t, (i // 4) * 2, i % 4)
            grid.addWidget(v, (i // 4) * 2 + 1, i % 4)
            self.stat_labels[key] = v
        hlay.addLayout(grid)

        # controls
        row = QHBoxLayout()
        row.setSpacing(8)
        self.btn_pause = QPushButton("⏸ Pause")
        self.btn_resume = QPushButton("▶ Resume")
        self.btn_retry = QPushButton("⟳ Retry failed parts")
        self.btn_cancel = QPushButton("✕ Cancel")
        self.btn_cancel.setObjectName("DangerButton")
        self.btn_open_folder = QPushButton("📁 Open folder")
        self.btn_open_file = QPushButton("🚀 Open file")
        for b in (self.btn_pause, self.btn_resume, self.btn_retry,
                  self.btn_cancel, self.btn_open_folder, self.btn_open_file):
            b.setObjectName(b.objectName() or "CardButton")
            row.addWidget(b)
        row.addStretch(1)
        hlay.addLayout(row)
        root.addWidget(header)

        self.btn_pause.clicked.connect(self._pause)
        self.btn_resume.clicked.connect(lambda: self.manager.resume(self.task_id))
        self.btn_retry.clicked.connect(lambda: self.manager.retry(self.task_id))
        self.btn_cancel.clicked.connect(self._cancel)
        self.btn_open_folder.clicked.connect(self._open_folder)
        self.btn_open_file.clicked.connect(self._open_file)

        # --- parts table ----------------------------------------------------
        title = QLabel("PART PROGRESS — EACH BYTE RANGE DOWNLOADS IN PARALLEL")
        title.setObjectName("SectionTitle")
        root.addWidget(title)

        self.table = QTableWidget(0, len(self.COLUMNS))
        self.table.setHorizontalHeaderLabels(self.COLUMNS)
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(
            QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table.setSelectionMode(
            QAbstractItemView.SelectionMode.NoSelection)
        self.table.setAlternatingRowColors(True)
        self.table.verticalHeader().setDefaultSectionSize(26)
        hdr = self.table.horizontalHeader()
        hdr.setSectionResizeMode(0, QHeaderView.ResizeMode.Fixed)
        hdr.setSectionResizeMode(1, QHeaderView.ResizeMode.ResizeToContents)
        hdr.setSectionResizeMode(2, QHeaderView.ResizeMode.Stretch)
        hdr.setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)
        hdr.setSectionResizeMode(4, QHeaderView.ResizeMode.ResizeToContents)
        hdr.setSectionResizeMode(5, QHeaderView.ResizeMode.ResizeToContents)
        self.table.setColumnWidth(0, 44)
        root.addWidget(self.table, 1)

        # --- log -------------------------------------------------------------
        log_title = QLabel("EVENT LOG")
        log_title.setObjectName("SectionTitle")
        root.addWidget(log_title)
        self.log_area = QTextEdit()
        self.log_area.setObjectName("LogArea")
        self.log_area.setReadOnly(True)
        self.log_area.setFixedHeight(110)
        root.addWidget(self.log_area)

        manager.sig_progress.connect(self._on_progress)
        manager.sig_parts.connect(self._on_parts)
        manager.sig_state_changed.connect(self._on_state)
        manager.sig_log.connect(self._on_log)
        manager.sig_completed.connect(
            lambda tid, p: self._on_state(tid, DownloadStatus.COMPLETED.value))
        manager.sig_failed.connect(
            lambda tid, e: self._on_state(tid, DownloadStatus.FAILED.value))

    # ------------------------------------------------------------------- load

    def load(self, task_id: int) -> None:
        self.task_id = task_id
        self.log_area.clear()
        task = self.manager.tasks.get(task_id)
        if task is None:
            return
        self.name_lbl.setText(task.filename)
        self.chip.set_status(task.status.value)
        self._build_part_rows(task.part_count if task.parts else 0)
        if task.parts:
            self._on_parts(task_id, [p.to_dict() for p in task.parts])
        prog = self.manager.progress_of(task_id)
        self._refresh_static(task)
        if prog:
            self._on_progress(task_id, prog)
        self._update_buttons(task)
        self.error_lbl.setVisible(bool(task.error) and
                                  task.status == DownloadStatus.FAILED)
        self.error_lbl.setText(task.error or "")

    def _refresh_static(self, task) -> None:
        total = task.total_size
        self.stat_labels["size"].setText(
            format_bytes(total) if total >= 0 else "unknown")
        self.stat_labels["parts"].setText(
            f"{len(task.parts) or task.part_count}"
            + ("" if task.range_support.value != "no"
               else "  (single stream — no range support)"))
        self.stat_labels["dest"].setText(os.path.join(task.dest_dir,
                                                      task.filename))
        self.stat_labels["dest"].setToolTip(task.dest_dir)

    def _build_part_rows(self, count: int) -> None:
        self.table.setRowCount(count)
        self._part_rows.clear()
        for i in range(count):
            idx_item = QTableWidgetItem(str(i + 1))
            idx_item.setTextAlignment(Qt.AlignmentFlag.AlignCenter)
            range_item = QTableWidgetItem("—")
            range_item.setFont(range_item.font())
            bar = QProgressBar()
            bar.setObjectName("PartProgress")
            bar.setRange(0, 1000)
            bar.setValue(0)
            bar.setTextVisible(False)
            done_item = QTableWidgetItem("—")
            speed_item = QTableWidgetItem("—")
            status_item = QTableWidgetItem("pending")
            self.table.setCellWidget(i, 2, bar)
            self.table.setItem(i, 0, idx_item)
            self.table.setItem(i, 1, range_item)
            self.table.setItem(i, 3, done_item)
            self.table.setItem(i, 4, speed_item)
            self.table.setItem(i, 5, status_item)
            self._part_rows[i] = {"bar": bar, "range": range_item,
                                  "done": done_item, "speed": speed_item,
                                  "status": status_item}

    # ----------------------------------------------------------------- events

    def _on_parts(self, task_id: int, parts: List[dict]) -> None:
        if task_id != self.task_id:
            return
        if len(parts) != self.table.rowCount():
            self._build_part_rows(len(parts))
        for p in parts:
            row = self._part_rows.get(p["index"])
            if row is None:
                continue
            row["range"].setText(f"{p['start']:,} – {p['end']:,}")
            row["range"].setToolTip(
                f"HTTP Range: bytes={p['start']}-{p['end']}")
            row["bar"].setValue(int(min(1000, p["progress"] * 10)))
            row["done"].setText(
                f"{format_bytes(p['downloaded'])} / {format_bytes(p['size'])}")
            row["speed"].setText(
                format_speed(p["speed"]) if p["speed"] > 0 else "—")
            status = p["status"]
            row["status"].setText(status)
            color = {
                "running": "#7c5cff", "completed": "#34d399",
                "failed": "#f87171", "paused": "#fbbf24",
            }.get(status, "#9298ab")
            row["status"].setForeground(Qt.GlobalColor.white)
            from PySide6.QtGui import QColor
            row["status"].setForeground(QColor(color))
            if p.get("error"):
                row["status"].setToolTip(p["error"])

    def _on_progress(self, task_id: int, prog: dict) -> None:
        if task_id != self.task_id:
            return
        downloaded = prog.get("downloaded", 0)
        total = prog.get("total", -1)
        speed = prog.get("speed", 0.0)
        eta = prog.get("eta")
        if total and total > 0:
            pct = prog.get("percent")
            pct = pct if pct is not None else downloaded * 100.0 / total
            self.progress.setRange(0, 1000)
            self.progress.setValue(int(min(1000, pct * 10)))
            self.progress.setFormat(f"{pct:.1f}%")
            self.stat_labels["left"].setText(
                format_bytes(max(0, total - downloaded)))
        else:
            self.progress.setRange(0, 0)
            self.stat_labels["left"].setText("unknown")
        self.stat_labels["done"].setText(format_bytes(downloaded))
        self.stat_labels["speed"].setText(format_speed(speed))
        self.stat_labels["eta"].setText(format_eta(eta))
        self.stat_labels["conn"].setText(str(prog.get("active_connections", 0)))

    def _on_state(self, task_id: int, status: str) -> None:
        if task_id != self.task_id:
            return
        task = self.manager.tasks.get(task_id)
        self.chip.set_status(status)
        self.error_lbl.setVisible(status == DownloadStatus.FAILED.value
                                  and bool(task and task.error))
        if task:
            self.error_lbl.setText(task.error or "")
            self._update_buttons(task)

    def _update_buttons(self, task) -> None:
        s = task.status
        self.btn_pause.setEnabled(s in (DownloadStatus.ACTIVE,
                                        DownloadStatus.QUEUED))
        self.btn_resume.setEnabled(s == DownloadStatus.PAUSED)
        self.btn_retry.setEnabled(s in (DownloadStatus.FAILED,
                                        DownloadStatus.CANCELLED))
        self.btn_cancel.setEnabled(s in (DownloadStatus.ACTIVE,
                                         DownloadStatus.QUEUED,
                                         DownloadStatus.PAUSED))
        final_exists = os.path.exists(task.final_path)
        self.btn_open_file.setVisible(s == DownloadStatus.COMPLETED
                                      and final_exists)
        self.btn_open_folder.setVisible(final_exists or
                                        os.path.exists(task.dest_dir))

    def _on_log(self, task_id: int, message: str, level: str) -> None:
        if task_id != self.task_id:
            return
        import time as _time
        stamp = _time.strftime("%H:%M:%S")
        color = {"error": "#f87171", "warning": "#fbbf24"}.get(
            level, "#9298ab")
        self.log_area.append(
            f'<span style="color:#626a80">{stamp}</span> '
            f'<span style="color:{color}">{message}</span>')

    # ---------------------------------------------------------------- actions

    def _pause(self) -> None:
        if self.task_id is not None:
            self.manager.pause(self.task_id)

    def _cancel(self) -> None:
        task = self.manager.tasks.get(self.task_id)
        if task is None:
            return
        auto = self.manager.setting_bool("auto_cleanup_temp")
        if auto:
            self.manager.cancel(task.id, delete_temp=True)
            return
        box = QMessageBox(self)
        box.setWindowTitle("Cancel download")
        box.setText(f"Cancel '{task.filename}'?\n\nKeep the temporary data "
                    "to resume later, or delete it to free disk space.")
        keep = box.addButton("Cancel & keep data",
                             QMessageBox.ButtonRole.AcceptRole)
        delete = box.addButton("Cancel & delete data",
                               QMessageBox.ButtonRole.DestructiveRole)
        box.addButton("Go back", QMessageBox.ButtonRole.RejectRole)
        box.exec()
        clicked = box.clickedButton()
        if clicked is keep:
            self.manager.cancel(task.id, delete_temp=False)
        elif clicked is delete:
            self.manager.cancel(task.id, delete_temp=True)

    def _open_folder(self) -> None:
        task = self.manager.tasks.get(self.task_id)
        if task is None:
            return
        target = task.final_path if os.path.exists(task.final_path) \
            else task.dest_dir
        open_in_file_manager(target, select=True)

    def _open_file(self) -> None:
        task = self.manager.tasks.get(self.task_id)
        if task is None:
            return
        open_file(task.final_path, self)
