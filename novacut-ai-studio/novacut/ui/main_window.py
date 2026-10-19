"""Main application window: menus, toolbar, docks and keyboard shortcuts."""
from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QAction, QKeySequence
from PySide6.QtWidgets import (QMainWindow, QDockWidget, QFileDialog, QMessageBox,
                               QDialog, QVBoxLayout, QComboBox, QLabel, QDialogButtonBox,
                               QWidget, QListWidget, QListWidgetItem, QApplication,
                               QPushButton)

from .. import APP_NAME, __version__
from ..core.constants import PROJECT_PRESETS
from ..core.logging_setup import get_logger
from ..diagnostics import diagnostics
from ..models.serialize import ProjectLoadError
from .ai_studio import AIStudioWindow
from .controller import ProjectController
from .export_dialog import ExportDialog
from .inspector import Inspector
from .media_bin import MediaBin
from .model_manager_dialog import ModelManagerDialog
from .preview import PreviewPanel
from .settings_dialog import SettingsDialog
from .theme import make_icon
from ..timeline_ui.timeline_panel import TimelinePanel

log = get_logger("main-window")


class NewProjectDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("New project")
        layout = QVBoxLayout(self)
        layout.addWidget(QLabel("Choose an aspect ratio preset:"))
        self.combo = QComboBox()
        for pid, (label, w, h, fps) in PROJECT_PRESETS.items():
            self.combo.addItem(f"{label} ({w}×{h} @ {fps:g}fps)", pid)
        layout.addWidget(self.combo)
        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def selected(self) -> str:
        return self.combo.currentData()


class MainWindow(QMainWindow):
    def __init__(self, controller: ProjectController):
        super().__init__()
        self.controller = controller
        self.setWindowTitle(APP_NAME)
        self.resize(1440, 900)
        self.setMinimumSize(1100, 680)
        self.ai_window: AIStudioWindow | None = None

        # Central preview.
        self.preview = PreviewPanel(controller)
        self.setCentralWidget(self.preview)

        # Docks.
        self.media_bin = MediaBin(controller)
        self.timeline = TimelinePanel(controller)
        self.inspector = Inspector(
            controller, playhead_provider=lambda: self.timeline.scene._playhead_time())
        self._add_dock("Media", self.media_bin,
                       Qt.DockWidgetArea.LeftDockWidgetArea)
        self._add_dock("Inspector", self.inspector,
                       Qt.DockWidgetArea.RightDockWidgetArea)
        timeline_dock = self._add_dock(
            "Timeline", self.timeline, Qt.DockWidgetArea.BottomDockWidgetArea)
        self.resizeDocks([timeline_dock], [320], Qt.Orientation.Vertical)

        self.preview.positionChanged.connect(self.timeline.set_playhead)
        self.timeline.seekRequested.connect(self.preview.seek)
        controller.projectChanged.connect(self._on_project_changed)

        self._build_menus()
        self._build_toolbar()
        self.statusBar().showMessage("Ready")
        controller.statusMessage.connect(lambda m: self.statusBar().showMessage(m, 6000))
        controller.dirtyChanged.connect(self._update_title)

        # Initial render.
        self.timeline.refresh()
        self.preview._project_changed(controller.project)
        self._update_title(False)
        QTimer.singleShot(300, self._offer_recovery)

    # ------------------------------------------------------------- docks
    def _add_dock(self, title: str, widget: QWidget, area) -> QDockWidget:
        dock = QDockWidget(title, self)
        dock.setWidget(widget)
        dock.setAllowedAreas(Qt.DockWidgetArea.AllDockWidgetAreas)
        self.addDockWidget(area, dock)
        return dock

    # ------------------------------------------------------------- menus
    def _build_menus(self) -> None:
        bar = self.menuBar()
        file_menu = bar.addMenu("&File")
        self._action(file_menu, "New project…", self.new_project, QKeySequence.New)
        self._action(file_menu, "Open…", self.open_project, QKeySequence.Open)
        file_menu.addSeparator()
        self._action(file_menu, "Save", self.save_project, QKeySequence.Save)
        self._action(file_menu, "Save as…", self.save_as, QKeySequence.SaveAs)
        file_menu.addSeparator()
        self._action(file_menu, "Export…", self.export_project, "Ctrl+E")
        file_menu.addSeparator()
        self._action(file_menu, "Exit", self.close, "Ctrl+Q")

        edit_menu = bar.addMenu("&Edit")
        self._action(edit_menu, "Undo", self.controller.undo, QKeySequence.Undo)
        self._action(edit_menu, "Redo", self.controller.redo, QKeySequence.Redo)
        edit_menu.addSeparator()
        self._action(edit_menu, "Split clip at playhead", self._split, "S")
        self._action(edit_menu, "Delete clip", self._delete, QKeySequence.Delete)
        self._action(edit_menu, "Ripple delete", self._ripple_delete, "Shift+Del")
        self._action(edit_menu, "Duplicate clip", self._duplicate, "Ctrl+D")
        self._action(edit_menu, "Add marker", self._add_marker, "M")

        view_menu = bar.addMenu("&View")
        self._action(view_menu, "Zoom timeline in",
                     lambda: self.timeline.scene.set_zoom(
                         self.timeline.scene.pixels_per_second * 1.25), "Ctrl++")
        self._action(view_menu, "Zoom timeline out",
                     lambda: self.timeline.scene.set_zoom(
                         self.timeline.scene.pixels_per_second / 1.25), "Ctrl+-")
        self._action(view_menu, "Play / pause", self._toggle_play, "Space")

        ai_menu = bar.addMenu("&AI Studio")
        self._action(ai_menu, "Open AI Studio…", self.open_ai_studio, "Ctrl+I")
        self._action(ai_menu, "Model Manager…", self.open_model_manager)

        tools_menu = bar.addMenu("&Tools")
        self._action(tools_menu, "Settings…", self.open_settings)
        self._action(tools_menu, "Diagnostics…", self.open_diagnostics)

        help_menu = bar.addMenu("&Help")
        self._action(help_menu, f"About {APP_NAME}", self.about)

    def _action(self, menu, text, slot, shortcut=None) -> QAction:
        action = QAction(text, self)
        if shortcut:
            action.setShortcut(shortcut)
        action.triggered.connect(lambda checked=False: slot())
        menu.addAction(action)
        return action

    def _build_toolbar(self) -> None:
        tb = self.addToolBar("Main")
        tb.setMovable(False)
        for glyph, tip, slot in (
            ("📄", "New", self.new_project),
            ("📂", "Open", self.open_project),
            ("💾", "Save", self.save_project),
            ("✂", "Split", self._split),
            ("🗑", "Ripple delete", self._ripple_delete),
            ("📋", "Duplicate", self._duplicate),
            ("⏮", "Frame back", lambda: self.preview.server.frame_step(-1)),
            ("⏭", "Frame forward", lambda: self.preview.server.frame_step(1)),
        ):
            action = QAction(make_icon(glyph), tip, self)
            action.setToolTip(tip)
            action.triggered.connect(lambda checked=False, s=slot: s())
            tb.addAction(action)
        tb.addSeparator()
        ai = QAction(make_icon("✨", "#9b6dff"), "AI Studio", self)
        ai.triggered.connect(self.open_ai_studio)
        tb.addAction(ai)
        export = QAction(make_icon("🎞", "#37c97f"), "Export", self)
        export.triggered.connect(self.export_project)
        tb.addAction(export)

    # ------------------------------------------------------------- file
    def new_project(self) -> None:
        dlg = NewProjectDialog(self)
        if dlg.exec() == QDialog.DialogCode.Accepted:
            self.controller.new_project(dlg.selected())
            self.timeline.refresh()

    def open_project(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self, "Open project", "", "NovaCut project (*.novacut)")
        if not path:
            return
        try:
            self.controller.open_project(path)
        except ProjectLoadError as exc:
            QMessageBox.critical(self, "Cannot open project", str(exc))
        self.timeline.refresh()

    def save_project(self) -> None:
        if not self.controller.project.path:
            self.save_as()
            return
        try:
            self.controller.save_project()
        except Exception as exc:  # noqa: BLE001
            QMessageBox.critical(self, "Save failed", str(exc))

    def save_as(self) -> None:
        path, _ = QFileDialog.getSaveFileName(
            self, "Save project",
            self.controller.project.settings.name + ".novacut",
            "NovaCut project (*.novacut)")
        if not path:
            return
        bundle = QMessageBox.question(
            self, "Bundle media",
            "Copy media files into the project archive for full portability?") \
            == QMessageBox.StandardButton.Yes
        self.controller.save_project(path, bundle_media=bundle)

    def export_project(self) -> None:
        ExportDialog(self.controller, self).exec()

    # ------------------------------------------------------------- edits
    def _selected_clip(self):
        return self.controller.selected_clip

    def _split(self) -> None:
        from ..editing.operations import SplitClipCommand
        clip = self._selected_clip()
        if not clip:
            return
        t = self.timeline.scene._playhead_time()
        if clip.start < t < clip.end:
            self.controller.execute(
                SplitClipCommand(self.controller.project.timeline, clip.id, t))

    def _delete(self) -> None:
        from ..editing.operations import RemoveClipCommand
        clip = self._selected_clip()
        if clip:
            self.controller.execute(
                RemoveClipCommand(self.controller.project.timeline, clip.id))

    def _ripple_delete(self) -> None:
        from ..editing.operations import RippleDeleteCommand
        clip = self._selected_clip()
        if clip:
            self.controller.execute(
                RippleDeleteCommand(self.controller.project.timeline, clip.id))

    def _duplicate(self) -> None:
        from ..editing.operations import DuplicateClipCommand
        clip = self._selected_clip()
        if clip:
            self.controller.execute(
                DuplicateClipCommand(self.controller.project.timeline, clip.id))

    def _add_marker(self) -> None:
        from ..editing.operations import AddMarkerCommand
        self.controller.execute(AddMarkerCommand(
            self.controller.project.timeline,
            self.timeline.scene._playhead_time(), "Marker"))

    def _toggle_play(self) -> None:
        if self.preview.server.is_playing:
            self.preview.pause()
        else:
            self.preview.play()

    # ------------------------------------------------------------- panels
    def open_ai_studio(self) -> None:
        if self.ai_window is None:
            self.ai_window = AIStudioWindow(self.controller, self)
        self.ai_window.show()
        self.ai_window.raise_()

    def open_model_manager(self) -> None:
        ModelManagerDialog(self).exec()

    def open_settings(self) -> None:
        SettingsDialog(self.controller.config, self).exec()

    def open_diagnostics(self) -> None:
        from PySide6.QtWidgets import QPlainTextEdit, QHBoxLayout
        dlg = QDialog(self)
        dlg.setWindowTitle("Diagnostics")
        dlg.resize(760, 560)
        layout = QVBoxLayout(dlg)
        text = QPlainTextEdit()
        text.setReadOnly(True)
        text.setPlainText(diagnostics.render_text())
        layout.addWidget(text)
        close = QDialogButtonBox(QDialogButtonBox.StandardButton.Close)
        close.rejected.connect(dlg.reject)
        close.accepted.connect(dlg.accept)
        save_btn = QPushButton("Save report")
        save_btn.clicked.connect(self._save_diagnostics)
        row = QWidget()
        h = QHBoxLayout(row)
        h.addWidget(save_btn)
        h.addStretch(1)
        h.addWidget(close)
        layout.addWidget(row)
        dlg.exec()

    def _save_diagnostics(self) -> None:
        path, _ = QFileDialog.getSaveFileName(self, "Save diagnostics",
                                              "novacut-diagnostics.txt")
        if path:
            diagnostics.save_report(path)
            self.statusBar().showMessage(f"Diagnostics saved to {path}", 5000)

    def about(self) -> None:
        QMessageBox.about(
            self, f"About {APP_NAME}",
            f"<h3>{APP_NAME} {__version__}</h3>"
            "<p>Professional offline video editing with local, privacy-preserving "
            "AI tools.</p><p>Built with Python, PySide6, FFmpeg and OpenCV.<br>"
            "See THIRD_PARTY_NOTICES.md for component licenses.</p>")

    # ------------------------------------------------------------- state
    def _on_project_changed(self, project) -> None:
        self.timeline.refresh()
        self._update_title(False)

    def _update_title(self, dirty: bool | None = None) -> None:
        project = self.controller.project
        name = project.settings.name
        path = project.path or "unsaved"
        flag = "• " if (dirty if dirty is not None else project.dirty) else ""
        self.setWindowTitle(f"{flag}{name} — {APP_NAME} ({Path(path).name})")

    def _offer_recovery(self) -> None:
        sessions = self.controller.recovery.find_recoverable()
        if not sessions:
            return
        items = [f"{s.name} — autosaved {Path(s.autosave_path).name}" for s in sessions]
        choice, ok = QInputChoice.get(
            self, "Crash recovery",
            "NovaCut found autosaved sessions. Recover one?", items)
        if ok and 0 <= choice < len(sessions):
            try:
                project = self.controller.recovery.load_autosave(
                    sessions[choice].autosave_path)
                self.controller.project = project
                self.controller.library.project = project
                self.controller.projectChanged.emit(project)
                self.controller.timelineChanged.emit()
                self.statusBar().showMessage("Recovered autosaved project")
            except Exception as exc:  # noqa: BLE001
                QMessageBox.warning(self, "Recovery failed", str(exc))

    def closeEvent(self, event) -> None:
        if self.controller.project.dirty:
            answer = QMessageBox.question(
                self, "Unsaved changes",
                "Save your project before exiting?",
                QMessageBox.StandardButton.Save
                | QMessageBox.StandardButton.Discard
                | QMessageBox.StandardButton.Cancel)
            if answer == QMessageBox.StandardButton.Cancel:
                event.ignore()
                return
            if answer == QMessageBox.StandardButton.Save:
                self.save_project()
        self.preview.server.stop()
        self.controller.shutdown()
        event.accept()


class QInputChoice(QDialog):
    """Single-choice list dialog used for crash recovery."""

    def __init__(self, title: str, message: str, items: list[str], parent=None):
        super().__init__(parent)
        self.setWindowTitle(title)
        layout = QVBoxLayout(self)
        layout.addWidget(QLabel(message))
        self.list = QListWidget()
        for item in items:
            self.list.addItem(QListWidgetItem(item))
        self.list.setCurrentRow(0)
        layout.addWidget(self.list)
        buttons = QDialogButtonBox(
            QDialogButtonBox.StandardButton.Ok | QDialogButtonBox.StandardButton.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    @classmethod
    def get(cls, parent, title, message, items):
        dlg = cls(title, message, items, parent)
        ok = dlg.exec() == QDialog.DialogCode.Accepted
        return dlg.list.currentRow(), ok
