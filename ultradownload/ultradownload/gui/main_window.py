"""Main application window: sidebar navigation, top bar, page stack,
system tray and graceful shutdown."""

from __future__ import annotations

import logging
import os

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QAction, QCloseEvent, QIcon
from PySide6.QtWidgets import (QApplication, QFrame, QHBoxLayout, QLabel,
                               QMainWindow, QMessageBox, QPushButton,
                               QStackedWidget, QSystemTrayIcon, QVBoxLayout,
                               QWidget)

from .. import __version__
from ..manager import DownloadManager
from ..models import DownloadStatus
from ..utils import format_speed
from . import theme
from .add_dialog import AddDownloadDialog
from .dashboard import DashboardPage
from .details_view import DetailsPage
from .fsx import open_file, open_in_file_manager  # noqa: F401 (re-exported)
from .history_view import HistoryPage
from .settings_view import SettingsPage

log = logging.getLogger(__name__)


class MainWindow(QMainWindow):
    def __init__(self, manager: DownloadManager,
                 icon_path: str = "", parent=None) -> None:
        super().__init__(parent)
        self.manager = manager
        self.setWindowTitle("UltraDownload — Download Manager")
        self.resize(1240, 780)
        self.setMinimumSize(980, 620)
        if icon_path and os.path.exists(icon_path):
            self.setWindowIcon(QIcon(icon_path))

        central = QWidget()
        self.setCentralWidget(central)
        root = QHBoxLayout(central)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        # ---------------- sidebar ----------------
        self.sidebar = self._build_sidebar()
        root.addWidget(self.sidebar)

        # ---------------- right column ----------------
        right = QVBoxLayout()
        right.setContentsMargins(0, 0, 0, 0)
        right.setSpacing(0)
        right.addWidget(self._build_topbar())

        self.stack = QStackedWidget()
        self.dashboard = DashboardPage(manager)
        self.history = HistoryPage(manager)
        self.settings = SettingsPage(manager, self)
        self.details = DetailsPage(manager, self)
        self.stack.addWidget(self.dashboard)    # 0
        self.stack.addWidget(self.history)      # 1
        self.stack.addWidget(self.settings)     # 2
        self.stack.addWidget(self.details)      # 3
        right.addWidget(self.stack, 1)
        root.addLayout(right, 1)

        # ---------------- wiring ----------------
        self.dashboard.open_details.connect(self.show_details)
        self.history.open_details.connect(self.show_details)
        self.details.back_requested.connect(
            lambda: self._navigate(self._last_nav or 0))
        self.settings.accent_changed.connect(self._apply_accent)
        manager.sig_log.connect(self._on_log)
        manager.sig_completed.connect(self._on_completed)
        manager.sig_failed.connect(self._on_failed)
        manager.sig_stats.connect(self._on_stats)

        self._last_nav = 0
        self._nav_buttons: list[QPushButton] = []
        self._register_nav(self.nav_dashboard, 0)
        self._register_nav(self.nav_history, 1)
        self._register_nav(self.nav_settings, 2)
        self._navigate(0)

        # ---------------- tray ----------------
        self.tray: QSystemTrayIcon | None = None
        if QSystemTrayIcon.isSystemTrayAvailable():
            self.tray = QSystemTrayIcon(self.windowIcon(), self)
            self.tray.setToolTip("UltraDownload")
            menu_actions = []
            act_show = QAction("Show UltraDownload", self)
            act_show.triggered.connect(self.show_and_raise)
            act_pause = QAction("Pause all", self)
            act_pause.triggered.connect(manager.pause_all)
            act_resume = QAction("Resume all", self)
            act_resume.triggered.connect(manager.resume_all)
            act_quit = QAction("Quit", self)
            act_quit.triggered.connect(self.close)
            from PySide6.QtWidgets import QMenu
            tray_menu = QMenu()
            for a in (act_show, act_pause, act_resume, act_quit):
                tray_menu.addAction(a)
                menu_actions.append(a)
            self.tray.setContextMenu(tray_menu)
            self.tray.activated.connect(self._on_tray_activated)
            self.tray.show()
            self._tray_menu = tray_menu   # keep a reference alive

        self.statusBar().showMessage("Ready")

    # ---------------------------------------------------------------- build

    def _build_sidebar(self) -> QFrame:
        bar = QFrame()
        bar.setObjectName("Sidebar")
        bar.setFixedWidth(216)
        lay = QVBoxLayout(bar)
        lay.setContentsMargins(16, 20, 16, 16)
        lay.setSpacing(6)

        title_row = QHBoxLayout()
        title_row.setSpacing(0)
        t1 = QLabel("Ultra")
        t1.setObjectName("AppTitle")
        t2 = QLabel("Download")
        t2.setObjectName("AppTitleAccent")
        title_row.addWidget(t1)
        title_row.addWidget(t2)
        lay.addLayout(title_row)
        sub = QLabel("PARALLEL DOWNLOAD ENGINE")
        sub.setObjectName("AppSubtitle")
        lay.addWidget(sub)
        lay.addSpacing(22)

        def nav_btn(text: str) -> QPushButton:
            b = QPushButton(text)
            b.setObjectName("NavButton")
            b.setCheckable(True)
            b.setCursor(Qt.CursorShape.PointingHandCursor)
            lay.addWidget(b)
            return b

        self.nav_dashboard = nav_btn("⬇   Dashboard")
        self.nav_history = nav_btn("🕘   History")
        self.nav_settings = nav_btn("⚙   Settings")
        lay.addStretch(1)
        foot = QLabel(f"v{__version__}\n40-part parallel engine")
        foot.setObjectName("SidebarFooter")
        lay.addWidget(foot)
        return bar

    def _build_topbar(self) -> QFrame:
        bar = QFrame()
        bar.setObjectName("TopBar")
        bar.setFixedHeight(60)
        lay = QHBoxLayout(bar)
        lay.setContentsMargins(22, 10, 22, 10)
        lay.setSpacing(12)
        self.page_title = QLabel("Dashboard")
        self.page_title.setObjectName("PageTitle")
        lay.addWidget(self.page_title)
        lay.addStretch(1)

        self.chip_speed = QLabel("0 B/s")
        self.chip_speed.setObjectName("GlobalChip")
        self.chip_conn = QLabel("0 conn")
        self.chip_conn.setObjectName("GlobalChip")
        lay.addWidget(self.chip_speed)
        lay.addWidget(self.chip_conn)

        self.btn_pause_all = QPushButton("Pause all")
        self.btn_pause_all.setObjectName("GhostButton")
        self.btn_pause_all.clicked.connect(self.manager.pause_all)
        self.btn_resume_all = QPushButton("Resume all")
        self.btn_resume_all.setObjectName("GhostButton")
        self.btn_resume_all.clicked.connect(self.manager.resume_all)
        self.btn_add = QPushButton("＋  Add Download")
        self.btn_add.setObjectName("PrimaryButton")
        self.btn_add.setCursor(Qt.CursorShape.PointingHandCursor)
        self.btn_add.clicked.connect(self.show_add_dialog)
        lay.addWidget(self.btn_pause_all)
        lay.addWidget(self.btn_resume_all)
        lay.addWidget(self.btn_add)
        return bar

    def _register_nav(self, button: QPushButton, index: int) -> None:
        self._nav_buttons.append(button)
        button.clicked.connect(lambda _=False, i=index: self._navigate(i))

    def _navigate(self, index: int) -> None:
        if index in (0, 1, 2):
            self._last_nav = index
        for i, b in enumerate(self._nav_buttons):
            checked = (i == index)
            b.setChecked(checked)
            b.setProperty("checked", "true" if checked else "false")
            b.style().unpolish(b)
            b.style().polish(b)
        self.stack.setCurrentIndex(index)
        titles = ["Dashboard", "Download History", "Settings",
                  "Download Details"]
        self.page_title.setText(titles[index])
        if index == 1:
            self.history.refresh()

    # ---------------------------------------------------------------- pages

    def show_add_dialog(self, preset_url: str = "") -> None:
        dlg = AddDownloadDialog(self.manager, preset_url=preset_url,
                                parent=self)
        dlg.exec()

    def show_details(self, task_id: int) -> None:
        self.details.load(task_id)
        self._navigate(3)

    def show_and_raise(self) -> None:
        self.showNormal()
        self.raise_()
        self.activateWindow()

    def _on_tray_activated(self, reason) -> None:
        if reason == QSystemTrayIcon.ActivationReason.Trigger:
            if self.isVisible():
                self.hide()
            else:
                self.show_and_raise()

    # ---------------------------------------------------------------- theme

    def _apply_accent(self, accent: str) -> None:
        theme.apply_theme(QApplication.instance(), accent)

    # ---------------------------------------------------------------- events

    def _on_log(self, task_id: int, message: str, level: str) -> None:
        prefix = {"warning": "⚠ ", "error": "✖ "}.get(level, "")
        self.statusBar().showMessage(prefix + message, 6000)

    def _on_completed(self, task_id: int, path: str) -> None:
        task = self.manager.tasks.get(task_id)
        name = task.filename if task else os.path.basename(path)
        self.statusBar().showMessage(f"✔ Completed: {name}", 10000)
        if self.tray is not None and not self.isActiveWindow():
            self.tray.showMessage("Download complete", name,
                                  QSystemTrayIcon.MessageIcon.Information,
                                  5000)

    def _on_failed(self, task_id: int, error: str) -> None:
        task = self.manager.tasks.get(task_id)
        name = task.filename if task else f"#{task_id}"
        self.statusBar().showMessage(f"✖ {name}: {error}", 12000)

    def _on_stats(self, stats: dict) -> None:
        speed = stats.get("speed", 0.0)
        limit = stats.get("global_limit", 0)
        text = format_speed(speed)
        if limit:
            text += f"  / cap {format_speed(limit)}"
        self.chip_speed.setText(text)
        self.chip_conn.setText(
            f"{stats.get('connections', 0)} conn · "
            f"{stats.get('active', 0)} active")

    def closeEvent(self, event: QCloseEvent) -> None:
        active = [t for t in self.manager.tasks.values()
                  if t.status in (DownloadStatus.ACTIVE,
                                  DownloadStatus.QUEUED)]
        if active:
            answer = QMessageBox.question(
                self, "Downloads in progress",
                f"{len(active)} download(s) are still active or queued.\n\n"
                "Quit anyway? Progress is saved and downloads will be "
                "paused — you can resume them on the next start.",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No)
            if answer != QMessageBox.StandardButton.Yes:
                event.ignore()
                return
        self.manager.shutdown(wait_seconds=8)
        if self.tray is not None:
            self.tray.hide()
        event.accept()
