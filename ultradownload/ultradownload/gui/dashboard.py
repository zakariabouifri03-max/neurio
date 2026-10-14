"""Dashboard page: aggregate statistics + live download cards + queue."""

from __future__ import annotations

from typing import Dict

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (QHBoxLayout, QLabel, QMessageBox, QScrollArea,
                               QSizePolicy, QVBoxLayout, QWidget)

from ..manager import DownloadManager
from ..models import DownloadStatus
from ..utils import format_bytes, format_speed
from .widgets import DownloadCard, StatCard


class DashboardPage(QWidget):
    open_details = Signal(int)

    STATUS_ORDER = {
        DownloadStatus.ACTIVE.value: 0,
        DownloadStatus.PAUSED.value: 1,
        DownloadStatus.QUEUED.value: 2,
    }

    def __init__(self, manager: DownloadManager, parent=None) -> None:
        super().__init__(parent)
        self.manager = manager
        self.cards: Dict[int, DownloadCard] = {}

        root = QVBoxLayout(self)
        root.setContentsMargins(22, 18, 22, 18)
        root.setSpacing(16)

        # --- stat cards ------------------------------------------------
        stats_row = QHBoxLayout()
        stats_row.setSpacing(14)
        self.card_speed = StatCard("Total speed", "--", "aggregate")
        self.card_downloaded = StatCard("Downloaded", "0 B", "this library")
        self.card_active = StatCard("Active", "0", "downloads running")
        self.card_completed = StatCard("Completed", "0", "files finished")
        self.card_disk = StatCard("Disk free", "--", "destination volume")
        for c in (self.card_speed, self.card_downloaded, self.card_active,
                  self.card_completed, self.card_disk):
            stats_row.addWidget(c, 1)
        root.addLayout(stats_row)

        # --- downloads list ---------------------------------------------
        head = QHBoxLayout()
        title = QLabel("ACTIVE DOWNLOADS & QUEUE")
        title.setObjectName("SectionTitle")
        head.addWidget(title)
        head.addStretch(1)
        self.count_lbl = QLabel("")
        self.count_lbl.setObjectName("SectionTitle")
        head.addWidget(self.count_lbl)
        root.addLayout(head)

        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(True)
        self.scroll.setFrameShape(QScrollArea.Shape.NoFrame)
        self.scroll.setHorizontalScrollBarPolicy(
            Qt.ScrollBarPolicy.ScrollBarAlwaysOff)
        holder = QWidget()
        self.list_lay = QVBoxLayout(holder)
        self.list_lay.setContentsMargins(0, 0, 8, 0)
        self.list_lay.setSpacing(10)
        self.empty_lbl = QLabel(
            "No active downloads.\nClick “＋ Add Download” to paste a direct "
            "link and start a 40-part parallel download.")
        self.empty_lbl.setObjectName("CardMeta")
        self.empty_lbl.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.empty_lbl.setMinimumHeight(120)
        self.list_lay.addWidget(self.empty_lbl)
        self.list_lay.addStretch(1)
        self.scroll.setWidget(holder)
        root.addWidget(self.scroll, 1)

        # --- manager signals ---------------------------------------------
        manager.sig_download_added.connect(lambda _id: self.refresh_list())
        manager.sig_download_updated.connect(lambda _id, _t: self.refresh_list())
        manager.sig_state_changed.connect(self._on_state)
        manager.sig_progress.connect(self._on_progress)
        manager.sig_stats.connect(self._on_stats)
        manager.sig_queue_changed.connect(self.refresh_list)
        self.refresh_list()

    # ------------------------------------------------------------------ list

    def refresh_list(self) -> None:
        shown = [t for t in self.manager.tasks.values()
                 if not t.status.is_finished]
        shown.sort(key=lambda t: (self.STATUS_ORDER.get(t.status.value, 9),
                                  -t.priority, t.created_at))
        # remove stale cards
        for tid in list(self.cards):
            if tid not in {t.id for t in shown}:
                card = self.cards.pop(tid)
                self.list_lay.removeWidget(card)
                card.deleteLater()
        # add / reorder
        for pos, task in enumerate(shown):
            card = self.cards.get(task.id)
            if card is None:
                card = DownloadCard(task.id)
                card.clicked.connect(self.open_details)
                card.pause_resume_clicked.connect(self._pause_resume)
                card.cancel_clicked.connect(self._cancel)
                self.cards[task.id] = card
                card.set_task(task.to_dict())
                prog = self.manager.progress_of(task.id)
                if prog:
                    card.set_progress(prog)
            self.list_lay.removeWidget(card)
            self.list_lay.insertWidget(pos, card)
        self.empty_lbl.setVisible(not shown)
        n_active = sum(1 for t in shown
                       if t.status == DownloadStatus.ACTIVE)
        n_queued = sum(1 for t in shown
                       if t.status == DownloadStatus.QUEUED)
        self.count_lbl.setText(
            f"{len(shown)} in list · {n_active} active · {n_queued} queued")

    def _on_state(self, task_id: int, status: str) -> None:
        card = self.cards.get(task_id)
        task = self.manager.tasks.get(task_id)
        if card is not None and task is not None:
            card.set_task(task.to_dict())
        self.refresh_list()

    def _on_progress(self, task_id: int, prog: dict) -> None:
        card = self.cards.get(task_id)
        if card is not None:
            card.set_progress(prog)

    def _on_stats(self, stats: dict) -> None:
        limit = stats.get("global_limit", 0)
        speed_txt = format_speed(stats.get("speed", 0.0))
        self.card_speed.set_value(
            speed_txt, f"cap {format_speed(limit)}" if limit else "aggregate")
        self.card_downloaded.set_value(
            format_bytes(stats.get("total_downloaded", 0)),
            f"{stats.get('connections', 0)} connections open")
        self.card_active.set_value(
            str(stats.get("active", 0)),
            f"{stats.get('queued', 0)} queued · {stats.get('paused', 0)} paused")
        self.card_completed.set_value(
            str(stats.get("completed", 0)),
            f"{stats.get('failed', 0)} failed")
        disk = stats.get("disk_free")
        self.card_disk.set_value(
            format_bytes(disk) if disk is not None else "unknown",
            "destination volume")

    # ---------------------------------------------------------------- actions

    def _pause_resume(self, task_id: int) -> None:
        task = self.manager.tasks.get(task_id)
        if task is None:
            return
        if task.status == DownloadStatus.PAUSED:
            self.manager.resume(task_id)
        else:
            self.manager.pause(task_id)

    def _cancel(self, task_id: int) -> None:
        task = self.manager.tasks.get(task_id)
        if task is None:
            return
        auto = self.manager.setting_bool("auto_cleanup_temp")
        if auto:
            delete = True
        else:
            box = QMessageBox(self)
            box.setWindowTitle("Cancel download")
            box.setText(
                f"Cancel '{task.filename}'?\n\n"
                "Partial data is stored in a temporary file. Keep it to "
                "resume later, or delete it to free disk space now.")
            keep = box.addButton("Cancel & keep data",
                                 QMessageBox.ButtonRole.AcceptRole)
            delete_btn = box.addButton("Cancel & delete data",
                                       QMessageBox.ButtonRole.DestructiveRole)
            box.addButton("Go back", QMessageBox.ButtonRole.RejectRole)
            box.exec()
            clicked = box.clickedButton()
            if clicked is keep:
                delete = False
            elif clicked is delete_btn:
                delete = True
            else:
                return
        self.manager.cancel(task_id, delete_temp=delete)
