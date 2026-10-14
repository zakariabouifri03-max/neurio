"""Dashboard: totals, active download cards, queue list."""

from __future__ import annotations

import shutil

from PySide6.QtCore import Signal
from PySide6.QtWidgets import (QFrame, QHBoxLayout, QLabel, QPushButton,
                               QScrollArea, QSizePolicy, QVBoxLayout, QWidget)

from ...utils import format_bytes, format_speed
from ..widgets import DownloadCard, EmptyState, StatCard


class DashboardPage(QWidget):
    open_details = Signal(str)
    add_requested = Signal()

    def __init__(self, manager, parent=None) -> None:
        super().__init__(parent)
        self.manager = manager
        self._cards: dict[str, DownloadCard] = {}

        root = QVBoxLayout(self)
        root.setContentsMargins(28, 24, 28, 24)
        root.setSpacing(18)

        head = QHBoxLayout()
        title = QLabel("Dashboard")
        title.setObjectName("pageTitle")
        add_btn = QPushButton("＋  New Download")
        add_btn.setObjectName("primary")
        add_btn.clicked.connect(self.add_requested.emit)
        head.addWidget(title)
        head.addStretch()
        head.addWidget(add_btn)
        root.addLayout(head)

        # ---- stat cards -------------------------------------------------
        stats = QHBoxLayout()
        stats.setSpacing(14)
        self.speed_card = StatCard("Total Speed", "⚡")
        self.downloaded_card = StatCard("Downloaded", "⇩")
        self.active_card = StatCard("Active", "◉")
        self.completed_card = StatCard("Completed", "✓")
        self.disk_card = StatCard("Free Disk Space", "⛁")
        for c in (self.speed_card, self.downloaded_card, self.active_card,
                  self.completed_card, self.disk_card):
            c.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
            stats.addWidget(c)
        root.addLayout(stats)

        # ---- active section ---------------------------------------------
        sec = QHBoxLayout()
        sec_l = QLabel("Active Downloads")
        sec_l.setObjectName("sectionTitle")
        self.pause_all_btn = QPushButton("Pause All")
        self.pause_all_btn.setObjectName("smallTool")
        self.pause_all_btn.clicked.connect(self.manager.pause_all)
        self.resume_all_btn = QPushButton("Resume All")
        self.resume_all_btn.setObjectName("smallTool")
        self.resume_all_btn.clicked.connect(self.manager.resume_all)
        sec.addWidget(sec_l)
        sec.addStretch()
        sec.addWidget(self.pause_all_btn)
        sec.addWidget(self.resume_all_btn)
        root.addLayout(sec)

        self.cards_area = QScrollArea()
        self.cards_area.setWidgetResizable(True)
        self.cards_container = QWidget()
        self.cards_layout = QVBoxLayout(self.cards_container)
        self.cards_layout.setContentsMargins(0, 0, 8, 0)
        self.cards_layout.setSpacing(12)
        self.cards_layout.addStretch()
        self.cards_area.setWidget(self.cards_container)
        self.cards_area.setMinimumHeight(220)
        root.addWidget(self.cards_area, 1)

        # ---- queue section ----------------------------------------------
        q_head = QHBoxLayout()
        q_l = QLabel("Download Queue")
        q_l.setObjectName("sectionTitle")
        q_head.addWidget(q_l)
        q_head.addStretch()
        root.addLayout(q_head)

        self.queue_box = QFrame()
        self.queue_box.setObjectName("panel")
        self.queue_layout = QVBoxLayout(self.queue_box)
        self.queue_layout.setContentsMargins(14, 12, 14, 12)
        self.queue_layout.setSpacing(8)
        root.addWidget(self.queue_box)

    # ------------------------------------------------------------------ data
    def refresh(self) -> None:
        totals = self.manager.totals()
        self.speed_card.set_value(format_speed(totals["speed"]))
        self.downloaded_card.set_value(format_bytes(totals["downloaded"]))
        self.active_card.set_value(str(totals["active"]),
                                   f"{totals['queued']} queued")
        self.completed_card.set_value(str(totals["completed"]))

        try:
            free = shutil.disk_usage(self.manager.settings.default_dir).free
            self.disk_card.set_value(format_bytes(free))
        except OSError:
            self.disk_card.set_value("—")

        active = [t for t in self.manager.tasks()
                  if t.status.value in ("running", "merging", "paused")]
        running_ids = {t.id for t in active}

        # remove stale cards
        for tid in list(self._cards):
            if tid not in running_ids:
                card = self._cards.pop(tid)
                self.cards_layout.removeWidget(card)
                card.deleteLater()

        for t in active:
            card = self._cards.get(t.id)
            if card is None:
                card = DownloadCard(t.id, t.filename or "…")
                card.pause_clicked.connect(self._on_pause)
                card.cancel_clicked.connect(self._on_cancel)
                card.details_clicked.connect(self.open_details.emit)
                self.cards_layout.insertWidget(self.cards_layout.count() - 1, card)
                self._cards[t.id] = card
            card.update_task(t.snapshot())

        if not self._cards:
            if not getattr(self, "_empty", None):
                self._empty = EmptyState(
                    "No active downloads.\nClick “New Download” to add a URL.")
                self.cards_layout.insertWidget(0, self._empty)
        elif getattr(self, "_empty", None):
            self.cards_layout.removeWidget(self._empty)
            self._empty.deleteLater()
            self._empty = None

        self._refresh_queue()

    def _refresh_queue(self) -> None:
        while self.queue_layout.count():
            item = self.queue_layout.takeAt(0)
            w = item.widget()
            if w:
                w.deleteLater()
        queued = [t for t in self.manager.tasks() if t.status.value == "queued"]
        if not queued:
            lab = QLabel("The queue is empty.")
            lab.setObjectName("faint")
            self.queue_layout.addWidget(lab)
            return
        for t in queued:
            row = QHBoxLayout()
            row.setSpacing(8)
            name = QLabel(f"{t.filename or t.url}")
            name.setObjectName("dim")
            name.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Fixed)
            prio = QLabel(f"priority {t.priority}")
            prio.setObjectName("faint")
            up = QPushButton("▲")
            up.setObjectName("smallTool")
            up.clicked.connect(lambda _=False, tid=t.id: self.manager.move_up(tid))
            down = QPushButton("▼")
            down.setObjectName("smallTool")
            down.clicked.connect(lambda _=False, tid=t.id: self.manager.move_down(tid))
            row.addWidget(name, 1)
            row.addWidget(prio)
            row.addWidget(up)
            row.addWidget(down)
            wrap = QWidget()
            wrap.setLayout(row)
            self.queue_layout.addWidget(wrap)

    def _on_pause(self, task_id: str) -> None:
        t = self.manager.task(task_id)
        if t is None:
            return
        if t.status.value in ("running", "queued"):
            self.manager.pause_task_async(task_id)
        else:
            self.manager.resume_task(task_id)

    def _on_cancel(self, task_id: str) -> None:
        from PySide6.QtWidgets import QMessageBox
        ret = QMessageBox.question(
            self, "Cancel download",
            "Cancel this download?\n\nYou can choose to keep the partial "
            "data for a later restart.",
            QMessageBox.Yes | QMessageBox.No, QMessageBox.No)
        if ret != QMessageBox.Yes:
            return
        keep = QMessageBox.question(
            self, "Temporary data",
            "Keep the downloaded partial data on disk?",
            QMessageBox.Yes | QMessageBox.No, QMessageBox.Yes)
        self.manager.cancel_task(task_id, delete_parts=(keep != QMessageBox.Yes))
