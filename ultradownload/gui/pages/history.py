"""Download History: completed / cancelled / failed downloads."""

from __future__ import annotations

import time

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (QHBoxLayout, QHeaderView, QLabel, QPushButton,
                               QTableWidget, QTableWidgetItem, QVBoxLayout,
                               QWidget)

from ...utils import format_bytes
from ..widgets import STATUS_COLORS, open_in_file_manager

FILTERS = [
    ("All", None),
    ("Completed", ("completed",)),
    ("Failed", ("failed",)),
    ("Cancelled", ("cancelled",)),
]


class HistoryPage(QWidget):
    open_details = Signal(str)

    def __init__(self, manager, parent=None) -> None:
        super().__init__(parent)
        self.manager = manager
        self._filter: tuple | None = None

        root = QVBoxLayout(self)
        root.setContentsMargins(28, 24, 28, 24)
        root.setSpacing(14)

        head = QHBoxLayout()
        title = QLabel("Download History")
        title.setObjectName("pageTitle")
        head.addWidget(title)
        head.addStretch()
        self.filter_buttons = []
        for label, statuses in FILTERS:
            b = QPushButton(label)
            b.setObjectName("secondary")
            b.setCheckable(True)
            b.clicked.connect(lambda _=False, s=statuses, bb=b: self._set_filter(s, bb))
            head.addWidget(b)
            self.filter_buttons.append(b)
        self.filter_buttons[0].setChecked(True)
        root.addLayout(head)

        self.table = QTableWidget(0, 6)
        self.table.setHorizontalHeaderLabels(
            ["Filename", "Size", "Status", "Finished", "URL", "Actions"])
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(4, QHeaderView.Stretch)
        self.table.horizontalHeader().setSectionResizeMode(5, QHeaderView.Fixed)
        self.table.setColumnWidth(5, 320)
        self.table.setColumnWidth(1, 110)
        self.table.setColumnWidth(2, 110)
        self.table.setColumnWidth(3, 150)
        self.table.setAlternatingRowColors(True)
        self.table.setSelectionBehavior(QTableWidget.SelectRows)
        self.table.setEditTriggers(QTableWidget.NoEditTriggers)
        self.table.verticalHeader().setVisible(False)
        root.addWidget(self.table, 1)

    def _set_filter(self, statuses, button) -> None:
        for b in self.filter_buttons:
            b.setChecked(b is button)
        self._filter = statuses
        self.refresh()

    def refresh(self) -> None:
        tasks = self.manager.history_tasks()
        if self._filter:
            tasks = [t for t in tasks if t.status.value in self._filter]
        self.table.setRowCount(len(tasks))
        for row, t in enumerate(tasks):
            snap = t.snapshot()
            name_item = QTableWidgetItem(snap.get("filename") or "…")
            name_item.setData(Qt.UserRole, t.id)
            self.table.setItem(row, 0, name_item)
            self.table.setItem(row, 1, QTableWidgetItem(
                format_bytes(snap.get("total_size"))))

            status = snap.get("status", "")
            color, label = STATUS_COLORS.get(status, ("#8b98ad", status))
            st_item = QTableWidgetItem(label)
            st_item.setForeground(Qt.GlobalColor.white)
            st_item.setBackground(Qt.GlobalColor.transparent)
            st_item.setData(Qt.ForegroundRole, None)
            from PySide6.QtGui import QColor, QBrush
            st_item.setForeground(QBrush(QColor(color)))
            self.table.setItem(row, 2, st_item)

            ts = snap.get("completed_at") or snap.get("created_at")
            when = time.strftime("%Y-%m-%d %H:%M", time.localtime(ts)) if ts else "—"
            self.table.setItem(row, 3, QTableWidgetItem(when))
            url_item = QTableWidgetItem(snap.get("url", ""))
            url_item.setToolTip(snap.get("url", ""))
            self.table.setItem(row, 4, url_item)

            actions = QWidget()
            lay = QHBoxLayout(actions)
            lay.setContentsMargins(6, 2, 6, 2)
            lay.setSpacing(6)
            open_b = QPushButton("Open Folder")
            open_b.setObjectName("smallTool")
            open_b.clicked.connect(lambda _=False, p=snap.get("final_path"): open_in_file_manager(p))
            lay.addWidget(open_b)
            if status in ("failed", "cancelled"):
                restart_b = QPushButton("Restart")
                restart_b.setObjectName("smallTool")
                restart_b.clicked.connect(
                    lambda _=False, tid=t.id: self._restart(tid))
                lay.addWidget(restart_b)
            remove_b = QPushButton("Remove")
            remove_b.setObjectName("smallTool")
            remove_b.clicked.connect(lambda _=False, tid=t.id: self._remove(tid))
            lay.addWidget(remove_b)
            lay.addStretch()
            self.table.setCellWidget(row, 5, actions)

        self.table.resizeRowsToContents()

    def _restart(self, task_id: str) -> None:
        self.manager.start_task(task_id)

    def _remove(self, task_id: str) -> None:
        from PySide6.QtWidgets import QMessageBox
        ret = QMessageBox.question(
            self, "Remove download",
            "Remove this entry from history?\n"
            "The downloaded file will NOT be deleted.",
            QMessageBox.Yes | QMessageBox.No, QMessageBox.No)
        if ret == QMessageBox.Yes:
            self.manager.remove_task(task_id, delete_parts=True)
            self.refresh()
