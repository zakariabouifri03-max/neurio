"""Project dashboard: welcome, recent projects, quick actions."""

from __future__ import annotations

import time

from PySide6.QtCore import Qt, Signal
from PySide6.QtWidgets import (
    QFileDialog, QHBoxLayout, QLabel, QListWidget, QListWidgetItem,
    QMessageBox, QPushButton, QVBoxLayout, QWidget,
)

from ...core.projects import ProjectManager


class DashboardPanel(QWidget):
    open_project_requested = Signal(str)     # folder path
    new_project_requested = Signal()

    def __init__(self, manager: ProjectManager, tr=str, parent=None):
        super().__init__(parent)
        self.manager = manager
        self.tr = tr

        root = QVBoxLayout(self)
        root.setContentsMargins(28, 24, 28, 16)

        title = QLabel(tr("dashboard.welcome"))
        title.setObjectName("sidebar-title")
        title.setStyleSheet("font-size:20px;")
        root.addWidget(title)
        hint = QLabel(tr("help.onboarding"))
        hint.setObjectName("hint")
        root.addWidget(hint)
        root.addSpacing(10)

        bar = QHBoxLayout()
        new_btn = QPushButton(tr("action.new_project"))
        new_btn.setObjectName("primary")
        new_btn.clicked.connect(self.new_project_requested.emit)
        open_btn = QPushButton(tr("action.open_project"))
        open_btn.clicked.connect(self._open_folder)
        bar.addWidget(new_btn); bar.addWidget(open_btn); bar.addStretch(1)
        root.addLayout(bar)

        rec = QLabel(tr("dashboard.recent"))
        rec.setStyleSheet("font-weight:600; margin-top:12px;")
        root.addWidget(rec)

        self.list = QListWidget()
        self.list.setAlternatingRowColors(True)
        self.list.itemDoubleClicked.connect(self._item_opened)
        root.addWidget(self.list, 1)

        self.empty_label = QLabel(tr("dashboard.empty"))
        self.empty_label.setObjectName("hint")
        root.addWidget(self.empty_label)

        self.refresh()

    def refresh(self) -> None:
        self.list.clear()
        projects = self.manager.store.list_recent(20)
        self.empty_label.setVisible(not projects)
        self.list.setVisible(bool(projects))
        for p in projects:
            when = time.strftime("%Y-%m-%d %H:%M", time.localtime(p.modified))
            item = QListWidgetItem(f"{p.name}    [{p.kind}]    {when}\n{p.path}")
            item.setData(Qt.UserRole, p.path)
            self.list.addItem(item)

    def _item_opened(self, item: QListWidgetItem) -> None:
        self.open_project_requested.emit(item.data(Qt.UserRole))

    def _open_folder(self) -> None:
        folder = QFileDialog.getExistingDirectory(self, self.tr("action.open_project"))
        if folder:
            self.open_project_requested.emit(folder)
