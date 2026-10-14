"""Download History page: finished downloads with reopen/restart actions."""

from __future__ import annotations

import os
import time
from typing import List

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (QAbstractItemView, QComboBox, QHBoxLayout,
                               QHeaderView, QLabel, QMessageBox, QPushButton,
                               QTableWidget, QTableWidgetItem, QVBoxLayout,
                               QWidget)

from ..manager import DownloadManager
from ..models import DownloadStatus, DownloadTask
from ..utils import format_bytes
from .main_window import open_in_file_manager


class HistoryPage(QWidget):
    open_details = Signal(int)

    FILTERS = ["All finished", "Completed", "Failed", "Cancelled"]

    def __init__(self, manager: DownloadManager, parent=None) -> None:
        super().__init__(parent)
        self.manager = manager
        self._tasks: List[DownloadTask] = []

        root = QVBoxLayout(self)
        root.setContentsMargins(22, 18, 22, 18)
        root.setSpacing(12)

        top = QHBoxLayout()
        title = QLabel("FINISHED DOWNLOADS")
        title.setObjectName("SectionTitle")
        top.addWidget(title)
        top.addSpacing(16)
        self.filter_combo = QComboBox()
        self.filter_combo.addItems(self.FILTERS)
        self.filter_combo.currentIndexChanged.connect(self.refresh)
        top.addWidget(self.filter_combo)
        top.addStretch(1)
        self.count_lbl = QLabel("")
        self.count_lbl.setObjectName("CardMeta")
        top.addWidget(self.count_lbl)
        root.addLayout(top)

        self.table = QTableWidget(0, 6)
        self.table.setHorizontalHeaderLabels(
            ["Status", "File", "Size", "Folder", "Finished", "Error"])
        self.table.verticalHeader().setVisible(False)
        self.table.setEditTriggers(
            QAbstractItemView.EditTrigger.NoEditTriggers)
        self.table.setSelectionBehavior(
            QAbstractItemView.SelectionBehavior.SelectRows)
        self.table.setSelectionMode(
            QAbstractItemView.SelectionMode.SingleSelection)
        self.table.setAlternatingRowColors(True)
        hdr = self.table.horizontalHeader()
        hdr.setSectionResizeMode(0, QHeaderView.ResizeMode.ResizeToContents)
        hdr.setSectionResizeMode(1, QHeaderView.ResizeMode.Stretch)
        hdr.setSectionResizeMode(2, QHeaderView.ResizeMode.ResizeToContents)
        hdr.setSectionResizeMode(3, QHeaderView.ResizeMode.ResizeToContents)
        hdr.setSectionResizeMode(4, QHeaderView.ResizeMode.ResizeToContents)
        hdr.setSectionResizeMode(5, QHeaderView.ResizeMode.Stretch)
        self.table.doubleClicked.connect(self._on_double_click)
        root.addWidget(self.table, 1)

        btns = QHBoxLayout()
        btns.addStretch(1)
        self.btn_folder = QPushButton("📁 Open location")
        self.btn_folder.clicked.connect(self._open_location)
        self.btn_restart = QPushButton("⟳ Restart download")
        self.btn_restart.clicked.connect(self._restart)
        self.btn_remove = QPushButton("Remove from history")
        self.btn_remove.setObjectName("DangerButton")
        self.btn_remove.clicked.connect(self._remove)
        for b in (self.btn_folder, self.btn_restart, self.btn_remove):
            btns.addWidget(b)
        root.addLayout(btns)

        manager.sig_completed.connect(lambda *_: self.refresh())
        manager.sig_failed.connect(lambda *_: self.refresh())
        manager.sig_state_changed.connect(lambda *_: self.refresh())

    # ------------------------------------------------------------------ data

    def refresh(self) -> None:
        mode = self.filter_combo.currentIndex()
        tasks = [t for t in self.manager.tasks.values() if t.status.is_finished]
        if mode == 1:
            tasks = [t for t in tasks if t.status == DownloadStatus.COMPLETED]
        elif mode == 2:
            tasks = [t for t in tasks if t.status == DownloadStatus.FAILED]
        elif mode == 3:
            tasks = [t for t in tasks
                     if t.status == DownloadStatus.CANCELLED]
        tasks.sort(key=lambda t: t.updated_at, reverse=True)
        self._tasks = tasks
        self.table.setRowCount(len(tasks))
        colors = {
            DownloadStatus.COMPLETED: "#34d399",
            DownloadStatus.FAILED: "#f87171",
            DownloadStatus.CANCELLED: "#9298ab",
        }
        for row, t in enumerate(tasks):
            status_item = QTableWidgetItem(t.status.value.upper())
            from PySide6.QtGui import QColor
            status_item.setForeground(QColor(colors.get(t.status,
                                                        QColor("#9298ab"))))
            name_item = QTableWidgetItem(t.filename)
            size_item = QTableWidgetItem(
                format_bytes(t.total_size) if t.total_size >= 0 else "—")
            folder_item = QTableWidgetItem(
                t.dest_dir if os.path.isdir(t.dest_dir) else "—")
            folder_item.setToolTip(t.dest_dir)
            when_item = QTableWidgetItem(
                time.strftime("%Y-%m-%d %H:%M", time.localtime(t.updated_at)))
            err_item = QTableWidgetItem(t.error or "")
            err_item.setToolTip(t.error or "")
            for col, item in enumerate((status_item, name_item, size_item,
                                        folder_item, when_item, err_item)):
                self.table.setItem(row, col, item)
            self.table.setRowHeight(row, 30)
        self.count_lbl.setText(f"{len(tasks)} record(s)")

    def _selected_task(self):
        row = self.table.currentRow()
        if 0 <= row < len(self._tasks):
            return self._tasks[row]
        return None

    # ---------------------------------------------------------------- actions

    def _on_double_click(self, index) -> None:
        row = index.row()
        if 0 <= row < len(self._tasks):
            self.open_details.emit(self._tasks[row].id)

    def _open_location(self) -> None:
        task = self._selected_task()
        if task is None:
            return
        target = task.final_path if os.path.exists(task.final_path) \
            else task.temp_path if os.path.exists(task.temp_path) \
            else task.dest_dir
        if not os.path.exists(target):
            QMessageBox.information(
                self, "UltraDownload",
                "Neither the file nor its folder exist any more.")
            return
        open_in_file_manager(target, select=True)

    def _restart(self) -> None:
        task = self._selected_task()
        if task is None:
            return
        if task.requires_auth:
            QMessageBox.information(
                self, "Credentials needed",
                "This download used authentication headers. For security "
                "they are never stored — please re-add the download from "
                "the Add dialog and provide the headers again.")
            return
        try:
            self.manager.add_download(
                task.url, task.dest_dir, filename=task.filename,
                part_count=task.part_count,
                checksum_algo=task.checksum_algo,
                checksum_value=task.checksum_value,
                priority=task.priority, speed_limit=task.speed_limit,
                auto_rename_on_conflict=True)
        except Exception as exc:
            QMessageBox.critical(self, "Restart failed", str(exc))

    def _remove(self) -> None:
        task = self._selected_task()
        if task is None:
            return
        try:
            self.manager.remove_record(task.id)
        except Exception as exc:
            QMessageBox.warning(self, "UltraDownload", str(exc))
