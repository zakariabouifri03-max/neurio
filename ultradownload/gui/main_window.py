"""Main window: sidebar navigation + stacked pages + live updates."""

from __future__ import annotations

import logging
import shutil

from PySide6.QtCore import Qt, QTimer
from PySide6.QtWidgets import (QButtonGroup, QHBoxLayout, QLabel, QMainWindow,
                               QPushButton, QStackedWidget, QStatusBar,
                               QVBoxLayout, QWidget)

from .. import __version__
from .pages.add_download import AddDownloadPage
from .pages.dashboard import DashboardPage
from .pages.details import DetailsPage
from .pages.history import HistoryPage
from .pages.settings_page import SettingsPage
from .signals import QtBridge

log = logging.getLogger("ultradownload.gui")


class MainWindow(QMainWindow):
    def __init__(self, manager, bridge: QtBridge) -> None:
        super().__init__()
        self.manager = manager
        self.bridge = bridge
        self.setWindowTitle("UltraDownload — Parallel Download Manager")
        self.resize(1220, 800)
        self.setMinimumSize(980, 680)

        central = QWidget()
        central.setObjectName("root")
        self.setCentralWidget(central)
        outer = QHBoxLayout(central)
        outer.setContentsMargins(0, 0, 0, 0)
        outer.setSpacing(0)

        # ---------------- sidebar -----------------------------------------
        sidebar = QWidget()
        sidebar.setObjectName("sidebar")
        sidebar.setFixedWidth(224)
        side_lay = QVBoxLayout(sidebar)
        side_lay.setContentsMargins(8, 18, 8, 18)
        side_lay.setSpacing(2)

        title = QLabel("⬢ UltraDownload")
        title.setObjectName("appTitle")
        sub = QLabel("Parallel download manager")
        sub.setObjectName("appSubtitle")
        side_lay.addWidget(title)
        side_lay.addWidget(sub)

        self.nav_group = QButtonGroup(self)
        self.nav_group.setExclusive(True)
        self.nav_buttons: list[QPushButton] = []
        for i, (label, glyph) in enumerate([
            ("Dashboard", "▦"),
            ("Add Download", "＋"),
            ("History", "◷"),
            ("Settings", "⚙"),
        ]):
            b = QPushButton(f"{glyph}   {label}")
            b.setObjectName("navButton")
            b.setCheckable(True)
            b.setCursor(Qt.PointingHandCursor)
            self.nav_group.addButton(b, i)
            self.nav_buttons.append(b)
            side_lay.addWidget(b)
        side_lay.addStretch()

        version = QLabel(f"UltraDownload v{__version__}\nPython · PySide6")
        version.setObjectName("faint")
        side_lay.addWidget(version)
        outer.addWidget(sidebar)

        # ---------------- pages -------------------------------------------
        self.stack = QStackedWidget()
        self.dashboard = DashboardPage(manager)
        self.add_page = AddDownloadPage(manager)
        self.details = DetailsPage(manager)
        self.history = HistoryPage(manager)
        self.settings_page = SettingsPage(manager, on_settings_changed=self.apply_theme)
        for p in (self.dashboard, self.add_page, self.details,
                  self.history, self.settings_page):
            self.stack.addWidget(p)
        outer.addWidget(self.stack, 1)

        self.nav_group.idClicked.connect(self._on_nav)
        self.dashboard.open_details.connect(self.show_details)
        self.dashboard.add_requested.connect(lambda: self._on_nav(1))
        self.details.back_requested.connect(lambda: self._on_nav(0))
        self.add_page.download_added.connect(self._on_added)

        self.nav_buttons[0].setChecked(True)

        # status bar
        sb = QStatusBar()
        self.setStatusBar(sb)
        self.status_speed = QLabel("0 B/s")
        self.status_disk = QLabel("")
        sb.addPermanentWidget(self.status_speed)
        sb.addPermanentWidget(self.status_disk)

        # live refresh: engine events drive the UI via the bridge
        bridge.task_updated.connect(self._on_task_updated)
        bridge.status_changed.connect(self._on_status_changed)
        bridge.log_message.connect(self._on_log)

        self._ticker = QTimer(self)
        self._ticker.setInterval(500)
        self._ticker.timeout.connect(self._tick_stats)
        self._ticker.start()

        self._on_nav(0)

    # ------------------------------------------------------------------ nav
    def _nav_targets(self):
        return [self.dashboard, self.add_page, self.history, self.settings_page]

    def _on_nav(self, index: int) -> None:
        self.nav_buttons[index].setChecked(True)
        self.stack.setCurrentWidget(self._nav_targets()[index])
        if index == 0:
            self.dashboard.refresh()
        elif index == 2:
            self.history.refresh()

    def show_details(self, task_id: str) -> None:
        self.details.set_task(task_id)
        self.stack.setCurrentWidget(self.details)

    def _on_added(self, task_id: str) -> None:
        self.show_details(task_id)

    # ------------------------------------------------------------ live data
    def _on_task_updated(self, task_id: str) -> None:
        current = self.stack.currentWidget()
        if current is self.dashboard:
            self.dashboard.refresh()
        elif current is self.details:
            self.details.refresh()

    def _on_status_changed(self, task_id: str) -> None:
        current = self.stack.currentWidget()
        if current is self.dashboard:
            self.dashboard.refresh()
        elif current is self.details:
            self.details.refresh()
        elif current is self.history:
            self.history.refresh()

    def _on_log(self, task_id: str, message: str) -> None:
        self.statusBar().showMessage(message, 8000)

    def _tick_stats(self) -> None:
        from ..utils import format_bytes, format_speed
        totals = self.manager.totals()
        self.status_speed.setText(f"Total speed: {format_speed(totals['speed'])}")
        try:
            free = shutil.disk_usage(self.manager.settings.default_dir).free
            self.status_disk.setText(f"Free: {format_bytes(free)}")
        except OSError:
            pass

    def apply_theme(self) -> None:
        from .theme import build_qss
        from PySide6.QtWidgets import QApplication
        qapp = QApplication.instance()
        if qapp is not None:
            qapp.setStyleSheet(
                build_qss(self.manager.settings.theme, self.manager.settings.accent))

    # ------------------------------------------------------------- lifecycle
    def closeEvent(self, event) -> None:  # noqa: N802
        try:
            self.manager.shutdown()
        except Exception:
            log.exception("shutdown failed")
        super().closeEvent(event)
