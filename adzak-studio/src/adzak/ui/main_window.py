"""Main window: sidebar navigation, menus, shortcuts, autosave, status bar."""

from __future__ import annotations

import json
from pathlib import Path

from PySide6.QtCore import Qt, QTimer
from PySide6.QtWidgets import (
    QApplication, QHBoxLayout, QLabel, QLineEdit, QListWidget, QListWidgetItem,
    QMainWindow, QMessageBox, QProgressBar, QPushButton, QStackedWidget,
    QStatusBar, QVBoxLayout, QWidget,
)

from .. import APP_NAME, __version__
from ..core.ffmpeg import find_ffmpeg
from ..core.i18n import LANGUAGES, Translator
from ..core.logging_setup import get_logger
from ..core.projects import ProjectManager, ProjectStore
from ..core.settings import Settings
from . import theme as theme_mod
from .dialogs import AboutDialog, NewProjectDialog, SettingsDialog
from .panels.ai_image import AIImagePanel
from .panels.ai_video import AIVideoPanel
from .panels.animation import AnimationPanel
from .panels.assistant import AssistantPanel
from .panels.audio_studio import AudioPanel
from .panels.converter_center import ConverterPanel
from .panels.dashboard import DashboardPanel
from .panels.design_studio import DesignPanel
from .panels.photo_editor import PhotoEditorPanel
from .panels.video_editor import VideoEditorPanel
from .workers import JobRunner

log = get_logger("main_window")

TOOLS = [
    ("dashboard", "tool.dashboard", "🏠"),
    ("video_editor", "tool.video_editor", "🎬"),
    ("photo_editor", "tool.photo_editor", "🖼"),
    ("design", "tool.design", "🎨"),
    ("ai_image", "tool.ai_image", "✨"),
    ("ai_video", "tool.ai_video", "🎞"),
    ("audio", "tool.audio", "🎧"),
    ("animation", "tool.animation", "🌀"),
    ("converter", "tool.converter", "🔁"),
    ("assistant", "tool.assistant", "💬"),
]


class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.settings = Settings()
        self.tr_obj = Translator(self.settings.get("ui/language", "en"))
        self.project_manager = ProjectManager()
        self.runner = JobRunner(self)
        self.project = None

        self.setWindowTitle(APP_NAME)
        self.resize(1440, 860)
        self.setMinimumSize(1100, 700)

        self._build_ui()
        self._build_menus()
        self.apply_theme()
        self.apply_language()

        # Autosave every 45 s while a project is open and dirty.
        self._autosave_timer = QTimer(self)
        self._autosave_timer.setInterval(45_000)
        self._autosave_timer.timeout.connect(self.autosave_tick)
        self._autosave_timer.start()

        self.runner.job_finished.connect(self._job_status)
        self.statusBar().showMessage(self.tr("status.ready"))
        if not find_ffmpeg(self.settings.get("ffmpeg/path", "")):
            self.statusBar().showMessage(self.tr("error.no_ffmpeg"))

    # ------------------------------------------------------------------
    def tr(self, key: str, **fmt) -> str:
        return self.tr_obj.tr(key, **fmt)

    def _build_ui(self) -> None:
        central = QWidget()
        root = QHBoxLayout(central)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        # sidebar
        sidebar = QWidget()
        sidebar.setStyleSheet("background:#14161a;")
        sv = QVBoxLayout(sidebar)
        sv.setContentsMargins(8, 12, 8, 12)
        logo = QLabel("ADZAK")
        logo.setObjectName("sidebar-title")
        sv.addWidget(logo)
        self.search = QLineEdit()
        self.search.setPlaceholderText(self.tr("search.tools"))
        self.search.textChanged.connect(self._filter_tools)
        sv.addWidget(self.search)
        self.tool_list = QListWidget()
        self.tool_list.setIconSize(self.tool_list.iconSize())
        self.tool_list.setSpacing(2)
        for key, i18n_key, icon in TOOLS:
            item = QListWidgetItem(f"{icon}  {self.tr(i18n_key)}")
            item.setData(Qt.UserRole, (key, i18n_key))
            self.tool_list.addItem(item)
        self.tool_list.currentRowChanged.connect(self._switch_panel)
        sv.addWidget(self.tool_list, 1)
        self.ff_label = QLabel("")
        self.ff_label.setObjectName("hint")
        self.ff_label.setWordWrap(True)
        sv.addWidget(self.ff_label)
        sidebar.setFixedWidth(220)

        # stacked panels
        self.stack = QStackedWidget()
        self.dashboard = DashboardPanel(self.project_manager, self.tr)
        self.video_editor = VideoEditorPanel(self.runner, self.settings, self.tr)
        self.photo_editor = PhotoEditorPanel(self.tr)
        self.design = DesignPanel(self.tr)
        self.ai_image = AIImagePanel(self.runner, self.settings, self.tr)
        self.ai_video = AIVideoPanel(self.runner, self.tr)
        self.audio = AudioPanel(self.runner, self.tr)
        self.animation = AnimationPanel(self.runner, self.tr)
        self.converter = ConverterPanel(self.runner, self.tr)
        self.assistant = AssistantPanel(self.settings, self.tr)
        for w in (self.dashboard, self.video_editor, self.photo_editor,
                  self.design, self.ai_image, self.ai_video, self.audio,
                  self.animation, self.converter, self.assistant):
            self.stack.addWidget(w)
        self._panel_by_key = {
            "dashboard": self.dashboard, "video_editor": self.video_editor,
            "photo_editor": self.photo_editor, "design": self.design,
            "ai_image": self.ai_image, "ai_video": self.ai_video,
            "audio": self.audio, "animation": self.animation,
            "converter": self.converter, "assistant": self.assistant,
        }
        self.dashboard.open_project_requested.connect(self.open_project_path)
        self.dashboard.new_project_requested.connect(self.new_project)

        root.addWidget(sidebar)
        root.addWidget(self.stack, 1)
        self.setCentralWidget(central)

        sb = QStatusBar()
        self.setStatusBar(sb)
        self.job_progress = QProgressBar()
        self.job_progress.setRange(0, 0)
        self.job_progress.setVisible(False)
        self.job_progress.setMaximumWidth(180)
        sb.addPermanentWidget(self.job_progress)

    def _build_menus(self) -> None:
        mb = self.menuBar()
        fm = mb.addMenu(self.tr("menu.file"))
        fm.addAction(self.tr("action.new_project"), self.new_project, "Ctrl+N")
        fm.addAction(self.tr("action.open_project"), self.open_project, "Ctrl+O")
        self.act_save = fm.addAction(self.tr("action.save_project"), self.save_project, "Ctrl+S")
        fm.addSeparator()
        fm.addAction(self.tr("action.settings"), self.open_settings, "Ctrl+,")
        fm.addSeparator()
        fm.addAction(self.tr("action.quit"), self.close, "Ctrl+Q")

        em = mb.addMenu(self.tr("menu.edit"))
        em.addAction(self.tr("action.undo"), self.undo, "Ctrl+Z")
        em.addAction(self.tr("action.redo"), self.redo, "Ctrl+Y")

        vm = mb.addMenu(self.tr("menu.view"))
        self.act_theme = vm.addAction("Toggle light/dark theme", self.toggle_theme, "Ctrl+T")

        hm = mb.addMenu(self.tr("menu.help"))
        hm.addAction(self.tr("action.about"), lambda: AboutDialog(self).exec())
        hm.addAction("Onboarding", self.show_onboarding, "F1")

    # ------------------------------------------------------------------
    def _filter_tools(self, text: str) -> None:
        text = text.lower()
        for i in range(self.tool_list.count()):
            item = self.tool_list.item(i)
            item.setHidden(text not in item.text().lower())

    def _switch_panel(self, row: int) -> None:
        if row < 0:
            return
        item = self.tool_list.item(row)
        key, _ = item.data(Qt.UserRole)
        self.stack.setCurrentWidget(self._panel_by_key[key])

    # ---- projects ------------------------------------------------------
    def new_project(self) -> None:
        dlg = NewProjectDialog(self, self.tr)
        if dlg.exec() != dlg.Accepted:
            return
        w, h = dlg.resolution()
        proj = self.project_manager.create(dlg.name.text(), dlg.project_kind(),
                                           w, h, dlg.fps.value())
        self._activate_project(proj)
        self.statusBar().showMessage(f"Project created: {proj.root}", 5000)

    def open_project(self) -> None:
        from PySide6.QtWidgets import QFileDialog
        folder = QFileDialog.getExistingDirectory(self, self.tr("action.open_project"))
        if folder:
            self.open_project_path(folder)

    def open_project_path(self, folder: str) -> None:
        try:
            proj = self.project_manager.open(folder)
        except (FileNotFoundError, ValueError, json.JSONDecodeError) as e:
            QMessageBox.critical(self, self.tr("common.error"), str(e))
            return
        self._activate_project(proj)
        self.statusBar().showMessage(f"Opened {proj.meta.name}", 5000)

    def _activate_project(self, proj) -> None:
        self.project = proj
        self.video_editor.set_project(proj)
        self.dashboard.refresh()
        if proj.state.get("kind") in {"video", "mixed"}:
            self.tool_list.setCurrentRow(1)
        elif proj.state.get("kind") == "photo":
            self.tool_list.setCurrentRow(2)
        elif proj.state.get("kind") == "design":
            self.tool_list.setCurrentRow(3)
        elif proj.state.get("kind") == "audio":
            self.tool_list.setCurrentRow(6)
        elif proj.state.get("kind") == "animation":
            self.tool_list.setCurrentRow(7)

    def save_project(self) -> None:
        if not self.project:
            QMessageBox.information(self, self.tr("common.info"),
                                    "No project open.")
            return
        # pull latest timeline state from the editor before saving
        self.project.state["timeline"] = self.video_editor.timeline.to_dict()
        path = self.project.save()
        self.project_manager.store.upsert(self.project.meta)
        self.statusBar().showMessage(f"Saved {path}", 4000)

    def autosave_tick(self) -> None:
        if self.project and self.project.dirty:
            try:
                self.project.state["timeline"] = self.video_editor.timeline.to_dict()
                snap = self.project.autosave()
                log.info("autosave → %s", snap.name)
            except OSError as e:
                log.warning("autosave failed: %s", e)

    # ---- edit ------------------------------------------------------------
    def undo(self) -> None:
        panel = self.stack.currentWidget()
        stack = getattr(panel, "undo", None)
        if stack and stack.undo():
            self.statusBar().showMessage(self.tr("action.undo"), 1500)

    def redo(self) -> None:
        panel = self.stack.currentWidget()
        stack = getattr(panel, "undo", None)
        if stack and stack.redo():
            self.statusBar().showMessage(self.tr("action.redo"), 1500)

    # ---- settings ----------------------------------------------------------
    def open_settings(self) -> None:
        dlg = SettingsDialog(self.settings, self, self.tr)
        if dlg.exec() == dlg.Accepted:
            self.apply_theme()
            self.apply_language()

    def apply_theme(self) -> None:
        self.setStyleSheet(theme_mod.stylesheet(self.settings.get("ui/theme", "dark")))

    def toggle_theme(self) -> None:
        cur = self.settings.get("ui/theme", "dark")
        self.settings.set("ui/theme", "light" if cur == "dark" else "dark")
        self.apply_theme()

    def apply_language(self) -> None:
        lang = self.settings.get("ui/language", "en")
        self.tr_obj.set_language(lang)
        self.setLayoutDirection(Qt.RightToLeft if self.tr_obj.is_rtl() else Qt.LeftToRight)
        self.search.setPlaceholderText(self.tr("search.tools"))
        for i in range(self.tool_list.count()):
            item = self.tool_list.item(i)
            key, i18n_key = item.data(Qt.UserRole)
            icon = next(ic for k, _, ic in TOOLS if k == key)
            item.setText(f"{icon}  {self.tr(i18n_key)}")
        self.setWindowTitle(f"{APP_NAME} — {__version__}")

    def show_onboarding(self) -> None:
        QMessageBox.information(self, APP_NAME, self.tr("help.onboarding"))

    # ---- jobs ----------------------------------------------------------------
    def _job_status(self, job) -> None:
        self.job_progress.setVisible(False)
        if job.result and not job.result.ok and job.result.error != "cancelled":
            self.statusBar().showMessage(f"✖ {job.title}: {job.result.error[:120]}", 8000)
        else:
            self.statusBar().showMessage(f"✔ {job.title}", 4000)

    def closeEvent(self, ev) -> None:  # noqa: N802
        try:
            if self.project:
                self.autosave_tick()
                if self.project.dirty:
                    reply = QMessageBox.question(
                        self, APP_NAME,
                        "Save project before closing?",
                        QMessageBox.Save | QMessageBox.Discard | QMessageBox.Cancel)
                    if reply == QMessageBox.Save:
                        self.save_project()
                    elif reply == QMessageBox.Cancel:
                        ev.ignore()
                        return
        except Exception as e:  # never trap the user on exit
            log.warning("close save failed: %s", e)
        self.runner._queue.clear()
        ev.accept()
