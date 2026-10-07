"""Dialogs: new project, export, AI settings, preferences and about."""
from __future__ import annotations

import os

from PySide6.QtCore import QSize, Qt, Signal
from PySide6.QtGui import QColor, QIcon
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDialog, QDialogButtonBox, QFileDialog,
                               QFormLayout, QFrame, QGridLayout, QGroupBox, QHBoxLayout, QLabel,
                               QLineEdit, QListWidget, QListWidgetItem, QMessageBox, QProgressBar,
                               QPushButton, QScrollArea, QSpinBox, QTabWidget, QTableWidget,
                               QTableWidgetItem, QVBoxLayout, QWidget)

from .. import APP_NAME, ORG_NAME, __version__
from ..engine.exporter import FORMATS, RESOLUTIONS, ExportSettings, ExportThread, have_encoder
from ..engine import media
from ..ai.library import template_names
from .theme import C, app_icon, get_icon


class NewProjectDialog(QDialog):
    """Template picker with size / fps / name."""

    def __init__(self, session, parent=None):
        super().__init__(parent)
        self.session = session
        self.setWindowTitle("New project")
        self.setMinimumWidth(560)
        self.setWindowIcon(app_icon())
        lay = QVBoxLayout(self)
        lay.setSpacing(8)
        title = QLabel("Start a new animation")
        title.setObjectName("title")
        lay.addWidget(title)

        self.templates = QListWidget()
        for name in template_names():
            item = QListWidgetItem(name)
            item.setData(Qt.UserRole, name)
            self.templates.addItem(item)
        self.templates.setCurrentRow(0)
        self.templates.setMinimumHeight(170)
        lay.addWidget(self.templates)

        form = QFormLayout()
        self.name_edit = QLineEdit("My Animation")
        form.addRow("Project name", self.name_edit)
        self.size_combo = QComboBox()
        from ..model.document import Project
        for label, size in Project().resolution_presets():
            self.size_combo.addItem(label, size)
        self.size_combo.setCurrentIndex(2)
        form.addRow("Resolution", self.size_combo)
        self.fps_spin = QSpinBox()
        self.fps_spin.setRange(1, 120)
        self.fps_spin.setValue(24)
        self.fps_spin.setSuffix(" fps")
        form.addRow("Frame rate", self.fps_spin)
        lay.addLayout(form)

        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.button(QDialogButtonBox.Ok).setText("Create")
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        lay.addWidget(buttons)

    def template(self) -> str:
        item = self.templates.currentItem()
        return item.data(Qt.UserRole) if item else "2D Cartoon"


class ExportDialog(QDialog):
    """Full export dialog: format, resolution, fps, range, quality, audio."""

    def __init__(self, session, parent=None):
        super().__init__(parent)
        self.session = session
        self.setWindowTitle("Export animation")
        self.setMinimumWidth(560)
        self.setWindowIcon(app_icon())
        self._thread: ExportThread | None = None
        scene = session.scene

        lay = QVBoxLayout(self)
        lay.setSpacing(8)
        tabs = QTabWidget()
        tabs.setDocumentMode(True)
        lay.addWidget(tabs)

        page = QWidget()
        form = QFormLayout(page)
        form.setSpacing(6)

        self.format_combo = QComboBox()
        for fmt in FORMATS:
            label = {"mp4": "MP4 video (H.264)", "webm": "WebM (VP9)",
                     "gif": "Animated GIF", "png": "PNG sequence",
                     "jpeg": "JPEG sequence"}.get(fmt, fmt)
            self.format_combo.addItem(label, fmt)
        self.format_combo.currentIndexChanged.connect(self._format_changed)
        form.addRow("Format", self.format_combo)

        self.resolution_combo = QComboBox()
        for label, size in RESOLUTIONS.items():
            self.resolution_combo.addItem(label, size)
        self.resolution_combo.setCurrentIndex(2)
        self.resolution_combo.currentIndexChanged.connect(self._resolution_changed)
        form.addRow("Resolution", self.resolution_combo)

        size_row = QHBoxLayout()
        self.width_spin = QSpinBox()
        self.width_spin.setRange(16, 7680)
        self.width_spin.setValue(scene.width)
        self.height_spin = QSpinBox()
        self.height_spin.setRange(16, 4320)
        self.height_spin.setValue(scene.height)
        size_row.addWidget(self.width_spin)
        size_row.addWidget(QLabel("×"))
        size_row.addWidget(self.height_spin)
        form.addRow("Custom size", size_row)

        self.fps_combo = QComboBox()
        for fps in (24, 30, 60, 120):
            self.fps_combo.addItem(f"{fps} fps", fps)
        self.fps_combo.setCurrentIndex(0)
        form.addRow("Frame rate", self.fps_combo)

        range_row = QHBoxLayout()
        self.start_spin = QSpinBox()
        self.start_spin.setRange(0, 1000000)
        self.start_spin.setValue(scene.frame_start)
        self.end_spin = QSpinBox()
        self.end_spin.setRange(1, 1000000)
        self.end_spin.setValue(max(scene.total_frames(), scene.frame_end))
        range_row.addWidget(self.start_spin)
        range_row.addWidget(QLabel("→"))
        range_row.addWidget(self.end_spin)
        form.addRow("Frame range", range_row)

        self.quality_slider = QSpinBox()
        self.quality_slider.setRange(1, 100)
        self.quality_slider.setValue(90)
        form.addRow("Quality", self.quality_slider)

        self.transparent = QCheckBox("Transparent background (where the format allows it)")
        form.addRow("", self.transparent)
        self.with_audio = QCheckBox("Include the audio tracks")
        self.with_audio.setChecked(bool(scene.audio_tracks))
        form.addRow("", self.with_audio)
        self.with_camera = QCheckBox("Render through the camera")
        self.with_camera.setChecked(True)
        form.addRow("", self.with_camera)
        self.all_scenes = QCheckBox("Export every scene (in order)")
        form.addRow("", self.all_scenes)
        tabs.addTab(page, "Video")

        self.path_edit = QLineEdit("")
        path_row = QHBoxLayout()
        path_row.addWidget(self.path_edit, 1)
        browse = QPushButton("Browse…")
        browse.clicked.connect(self._browse)
        path_row.addWidget(browse)
        lay.addWidget(QLabel("Output"))
        lay.addLayout(path_row)

        self.info = QLabel("")
        self.info.setObjectName("hint")
        lay.addWidget(self.info)

        self.progress = QProgressBar()
        self.progress.setVisible(False)
        lay.addWidget(self.progress)

        buttons = QHBoxLayout()
        self.export_btn = QPushButton("Export")
        self.export_btn.setObjectName("primary")
        self.export_btn.clicked.connect(self.run_export)
        buttons.addWidget(self.export_btn)
        self.cancel_btn = QPushButton("Cancel")
        self.cancel_btn.clicked.connect(self._cancel)
        buttons.addWidget(self.cancel_btn)
        close_btn = QPushButton("Close")
        close_btn.clicked.connect(self.reject)
        buttons.addWidget(close_btn)
        buttons.addStretch(1)
        lay.addLayout(buttons)

        self._format_changed()
        self._update_info()

    # ------------------------------------------------------------------ form
    def _format_changed(self) -> None:
        fmt = self.format_combo.currentData()
        is_sequence = fmt in ("png", "jpeg")
        video = fmt in ("mp4", "webm")
        self.with_audio.setEnabled(video)
        self.transparent.setEnabled(fmt in ("png", "webm"))
        self.quality_slider.setEnabled(fmt in ("mp4", "webm", "jpeg"))
        default = {"mp4": "animation.mp4", "webm": "animation.webm", "gif": "animation.gif",
                   "png": "frames", "jpeg": "frames"}[fmt]
        if not self.path_edit.text() or self.path_edit.text().endswith(
                (".mp4", ".webm", ".gif")) or self.path_edit.text() in ("frames",):
            base = os.path.splitext(self.path_edit.text())[0] if self.path_edit.text() else ""
            self.path_edit.setText(os.path.join(os.path.dirname(base), default).lstrip("/")
                                   if base else default)
        if not have_encoder() and fmt in ("mp4", "webm", "gif"):
            self.info.setText("⚠ FFmpeg was not found — install the bundled build or export a "
                              "PNG / JPEG sequence.")
        else:
            self._update_info()

    def _resolution_changed(self) -> None:
        size = self.resolution_combo.currentData()
        if size and size[0]:
            self.width_spin.setValue(size[0])
            self.height_spin.setValue(size[1])
        self._update_info()

    def _update_info(self) -> None:
        frames = max(1, self.end_spin.value() - self.start_spin.value() + 1)
        fps = self.fps_combo.currentData() or 24
        self.info.setText(f"{frames} frames · {frames / fps:.1f} s · "
                          f"{self.width_spin.value()}×{self.height_spin.value()} · "
                          f"encoder: {'bundled FFmpeg ✓' if have_encoder() else 'missing'}")

    def _browse(self) -> None:
        fmt = self.format_combo.currentData()
        if fmt in ("png", "jpeg"):
            path = QFileDialog.getExistingDirectory(self, "Export folder")
        else:
            filters = {"mp4": "MP4 video (*.mp4)", "webm": "WebM (*.webm)",
                       "gif": "GIF (*.gif)"}
            path, _f = QFileDialog.getSaveFileName(self, "Export to", "",
                                                   filters.get(fmt, "All files (*)"))
        if path:
            self.path_edit.setText(path)

    def settings(self) -> ExportSettings:
        return ExportSettings(
            path=self.path_edit.text(),
            fmt=self.format_combo.currentData(),
            width=self.width_spin.value(), height=self.height_spin.value(),
            fps=int(self.fps_combo.currentData() or 24),
            quality=self.quality_slider.value(),
            transparent=self.transparent.isChecked(),
            frame_start=self.start_spin.value(), frame_end=self.end_spin.value(),
            all_scenes=self.all_scenes.isChecked(),
            with_audio=self.with_audio.isChecked(), with_camera=self.with_camera.isChecked(),
        )

    # ------------------------------------------------------------------- run
    def run_export(self) -> None:
        settings = self.settings()
        if not settings.path:
            QMessageBox.warning(self, "Export", "Choose an output path first.")
            return
        if settings.fmt in ("mp4", "webm", "gif") and not have_encoder():
            QMessageBox.warning(self, "Export",
                                "FFmpeg was not found, so video export is unavailable.\n"
                                "Export a PNG or JPEG sequence instead.")
            return
        self.export_btn.setEnabled(False)
        self.progress.setVisible(True)
        self.progress.setValue(0)
        thread = ExportThread(self.session.project, settings, self)
        self._thread = thread
        thread.progress.connect(self._on_progress)
        thread.finished_ok.connect(self._on_done)
        thread.failed.connect(self._on_failed)
        thread.start()

    def _on_progress(self, done: int, total: int, message: str) -> None:
        self.progress.setMaximum(max(1, total))
        self.progress.setValue(done)
        self.info.setText(message)

    def _on_done(self, path: str, seconds: float) -> None:
        self.progress.setVisible(False)
        self.export_btn.setEnabled(True)
        self.info.setText(f"Exported to {path} in {seconds:.1f}s")
        QMessageBox.information(self, "Export finished", f"Saved:\n{path}")

    def _on_failed(self, message: str) -> None:
        self.progress.setVisible(False)
        self.export_btn.setEnabled(True)
        self.info.setText("Export failed: " + message)
        QMessageBox.critical(self, "Export failed", message)

    def _cancel(self) -> None:
        if self._thread is not None and self._thread.isRunning():
            self._thread.cancel()
            self.info.setText("Cancelling…")
            return
        self.reject()


class AISettingsDialog(QDialog):
    """Provider abstraction: offline, OpenAI compatible, local server or custom."""

    def __init__(self, session, parent=None):
        super().__init__(parent)
        self.session = session
        self.setWindowTitle("AI settings")
        self.setMinimumWidth(540)
        from ..ai.providers import default_registry, load_ai_settings, save_ai_settings
        self._registry = default_registry()
        self._save = save_ai_settings
        settings = load_ai_settings()
        self._settings = settings

        lay = QVBoxLayout(self)
        lay.setSpacing(8)
        intro = QLabel("MotionForge is fully functional without any AI provider — the built-in "
                       "offline director turns plain English into editable keyframes. Connect a "
                       "cloud or local model for richer planning. Your key is stored on this "
                       "computer only, never inside a project file and never in the source code.")
        intro.setWordWrap(True)
        intro.setObjectName("hint")
        lay.addWidget(intro)

        form = QFormLayout()
        self.provider_combo = QComboBox()
        for info in self._registry.infos():
            self.provider_combo.addItem(info.name, info.id)
        index = self.provider_combo.findData(settings.get("provider", "offline"))
        self.provider_combo.setCurrentIndex(max(0, index))
        self.provider_combo.currentIndexChanged.connect(self._provider_changed)
        form.addRow("Provider", self.provider_combo)

        self.base_url = QLineEdit()
        self.base_url.setPlaceholderText("https://api.openai.com/v1")
        form.addRow("Base URL", self.base_url)

        self.model_combo = QComboBox()
        self.model_combo.setEditable(True)
        form.addRow("Model", self.model_combo)

        key_row = QHBoxLayout()
        self.key_edit = QLineEdit()
        self.key_edit.setEchoMode(QLineEdit.Password)
        self.key_edit.setPlaceholderText("paste your key  (MFS_AI_API_KEY also works)")
        key_row.addWidget(self.key_edit, 1)
        test = QPushButton("Test")
        test.setToolTip("Send a tiny request to check the connection")
        test.clicked.connect(self._test)
        key_row.addWidget(test)
        form.addRow("API key", key_row)

        self.temp_spin = QSpinBox()
        self.temp_spin.setRange(0, 100)
        self.temp_spin.setValue(int(float(settings.get("temperature", 0.4)) * 100))
        self.temp_spin.setSuffix(" %")
        form.addRow("Temperature", self.temp_spin)
        lay.addLayout(form)

        self.notes = QLabel("")
        self.notes.setObjectName("hint")
        self.notes.setWordWrap(True)
        lay.addWidget(self.notes)

        buttons = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self._save_settings)
        buttons.rejected.connect(self.reject)
        lay.addWidget(buttons)
        self._provider_changed()

    def _provider_changed(self) -> None:
        provider_id = self.provider_combo.currentData()
        info = self._registry.info(provider_id)
        entry = (self._settings.get("providers") or {}).get(provider_id, {})
        self.notes.setText((info.description or "") + (f"  ({info.docs})" if info.docs else ""))
        self.key_edit.setEnabled(bool(info.needs_key))
        self.base_url.setEnabled(provider_id not in ("offline",))
        self.model_combo.setEnabled(provider_id != "offline")
        self.model_combo.clear()
        for model in info.models:
            self.model_combo.addItem(model)
        self.model_combo.setCurrentText(entry.get("model") or self._settings.get("model", "")
                                        or (info.models[0] if info.models else ""))
        self.base_url.setText(entry.get("base_url") or self._settings.get("base_url", "")
                              or info.base_url)
        self.key_edit.setText(entry.get("api_key", ""))

    def _current_settings(self) -> dict:
        provider_id = self.provider_combo.currentData()
        settings = dict(self._settings)
        settings["provider"] = provider_id
        settings["base_url"] = self.base_url.text().strip()
        settings["model"] = self.model_combo.currentText().strip()
        settings["temperature"] = self.temp_spin.value() / 100.0
        providers = dict(settings.get("providers") or {})
        providers[provider_id] = {
            "api_key": self.key_edit.text().strip(),
            "base_url": self.base_url.text().strip(),
            "model": self.model_combo.currentText().strip(),
        }
        settings["providers"] = providers
        return settings

    def _test(self) -> None:
        from ..ai.providers import build_provider
        try:
            provider = build_provider(self._current_settings(), self._registry)
            if provider.id == "offline":
                self.notes.setText("✓ Built-in offline director ready — no key needed.")
                return
            reply = provider.complete("You are a test.", "Reply with the single word: ready",
                                      max_tokens=8)
            self.notes.setText(f"✓ {provider.name} replied: {reply.strip()[:80]}")
        except Exception as exc:
            self.notes.setText(f"✗ {exc}")

    def _save_settings(self) -> None:
        self._save(self._current_settings())
        self.accept()


class PreferencesDialog(QDialog):
    """Beginner/Pro mode, preview quality, shortcut list, autosave, paths."""

    def __init__(self, session, parent=None):
        super().__init__(parent)
        self.session = session
        self.setWindowTitle("Preferences")
        self.setMinimumSize(560, 460)
        lay = QVBoxLayout(self)
        tabs = QTabWidget()
        tabs.setDocumentMode(True)
        lay.addWidget(tabs)

        # --- general
        general = QWidget()
        gform = QFormLayout(general)
        self.mode_combo = QComboBox()
        self.mode_combo.addItem("Beginner — big simple controls", False)
        self.mode_combo.addItem("Pro — every panel visible", True)
        self.mode_combo.setCurrentIndex(0 if session.beginner_mode else 1)
        self.mode_combo.setToolTip("You can switch at any time")
        self.mode_combo.currentIndexChanged.connect(
            lambda: session.set_mode(self.mode_combo.currentData()))
        gform.addRow("Interface", self.mode_combo)

        self.quality_combo = QComboBox()
        for key, label in (("draft", "Draft (fastest)"), ("normal", "Normal"),
                           ("high", "High"), ("final", "Final (slowest)")):
            self.quality_combo.addItem(label, key)
        index = self.quality_combo.findData(session.preview_quality)
        self.quality_combo.setCurrentIndex(max(0, index))
        self.quality_combo.currentIndexChanged.connect(
            lambda: session.set_preview_quality(self.quality_combo.currentData()))
        gform.addRow("Preview quality", self.quality_combo)

        self.autosave_check = QCheckBox("Autosave recovery copies")
        self.autosave_check.setChecked(bool(session.project.settings.get("autosave", {})
                                            .get("enabled", True)))
        self.autosave_check.clicked.connect(self._autosave_toggle)
        gform.addRow("", self.autosave_check)

        self.autosave_spin = QSpinBox()
        self.autosave_spin.setRange(1, 120)
        self.autosave_spin.setSuffix(" min")
        self.autosave_spin.setValue(int(session.project.settings.get("autosave", {})
                                        .get("interval_sec", 180)) // 60)
        self.autosave_spin.valueChanged.connect(self._autosave_interval)
        gform.addRow("Autosave every", self.autosave_spin)

        self.depth_spin = QSpinBox()
        self.depth_spin.setRange(0, 5000)
        self.depth_spin.setSpecialValueText("Unlimited")
        self.depth_spin.setValue(int(session.project.settings.get("history", {})
                                     .get("depth", 0)))
        self.depth_spin.valueChanged.connect(self._history_depth)
        gform.addRow("Undo depth", self.depth_spin)
        tabs.addTab(general, "General")

        # --- shortcuts
        shortcuts = QWidget()
        s_lay = QVBoxLayout(shortcuts)
        table = QTableWidget(0, 2)
        table.setHorizontalHeaderLabels(["Action", "Shortcut"])
        table.horizontalHeader().setStretchLastSection(True)
        for action, keys in DEFAULT_SHORTCUTS:
            row = table.rowCount()
            table.insertRow(row)
            item = QTableWidgetItem(action)
            item.setFlags(item.flags() & ~Qt.ItemIsEditable)
            table.setItem(row, 0, item)
            table.setItem(row, 1, QTableWidgetItem(keys))
        s_lay.addWidget(table)
        note = QLabel("Shortcuts are stored with the project; the manager applies them the next "
                      "time the window opens.")
        note.setObjectName("hint")
        note.setWordWrap(True)
        s_lay.addWidget(note)
        tabs.addTab(shortcuts, "Shortcuts")

        # --- system
        system = QWidget()
        form = QFormLayout(system)
        form.addRow("FFmpeg", QLabel(media.ffmpeg_version() or "not found"))
        form.addRow("Application folder", QLabel(os.path.dirname(os.path.dirname(__file__))))
        from ..io.project_file import list_autosaves
        form.addRow("Recent autosaves", QLabel(str(len(list_autosaves()))))
        form.addRow("Version", QLabel(f"{APP_NAME} {__version__}"))
        tabs.addTab(system, "System")

        buttons = QDialogButtonBox(QDialogButtonBox.Close)
        buttons.rejected.connect(self.reject)
        buttons.accepted.connect(self.accept)
        buttons.clicked.connect(lambda _b: self.accept())
        lay.addWidget(buttons)

    def _autosave_toggle(self) -> None:
        self.session.project.settings.setdefault("autosave", {})[
            "enabled"] = self.autosave_check.isChecked()
        self.session.start_autosave()

    def _autosave_interval(self, minutes: int) -> None:
        self.session.project.settings.setdefault("autosave", {})["interval_sec"] = minutes * 60
        self.session.start_autosave()

    def _history_depth(self, depth: int) -> None:
        self.session.project.settings.setdefault("history", {})["depth"] = depth
        self.session.history.depth = depth


DEFAULT_SHORTCUTS = [
    ("Play / Pause", "Space"),
    ("Previous frame", "←"),
    ("Next frame", "→"),
    ("First frame", "Home"),
    ("Last frame", "End"),
    ("Add frame", "F"),
    ("Duplicate frame", "D"),
    ("Delete frame", "Delete"),
    ("Undo", "Ctrl+Z"),
    ("Redo", "Ctrl+Y  /  Ctrl+Shift+Z"),
    ("New project", "Ctrl+N"),
    ("Open project", "Ctrl+O"),
    ("Save project", "Ctrl+S"),
    ("Save as", "Ctrl+Shift+S"),
    ("Export", "Ctrl+E"),
    ("Import", "Ctrl+I"),
    ("Key transform", "K"),
    ("Key whole pose", "Shift+K"),
    ("Onion skin toggle", "O"),
    ("Cycle tools", "B / P / E / G / T / M"),
    ("Zoom in / out", "Ctrl+=  /  Ctrl+-"),
    ("Fit to window", "Ctrl+0"),
    ("Toggle rig overlay", "R"),
    ("Toggle grid", "Ctrl+'")
]


class AboutDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle(f"About {APP_NAME}")
        self.setFixedWidth(460)
        lay = QVBoxLayout(self)
        logo = QLabel()
        logo.setPixmap(app_icon().pixmap(96, 96))
        logo.setAlignment(Qt.AlignCenter)
        lay.addWidget(logo)
        title = QLabel(f"{APP_NAME} {__version__}")
        title.setObjectName("title")
        title.setAlignment(Qt.AlignCenter)
        lay.addWidget(title)
        text = QLabel(
            "A complete 2D animation studio for Windows.\n\n"
            "Frame by frame drawing · vector tools · layers · timeline · rigging with IK ·\n"
            "keyframe animation · graph editor · audio · camera · scenes ·\n"
            "asset and animation libraries · AI animation assistant · video export.\n\n"
            f"{ORG_NAME} · your projects stay on your computer.")
        text.setAlignment(Qt.AlignCenter)
        text.setWordWrap(True)
        text.setObjectName("hint")
        lay.addWidget(text)
        buttons = QDialogButtonBox(QDialogButtonBox.Close)
        buttons.rejected.connect(self.reject)
        lay.addWidget(buttons)


class RecoveryDialog(QDialog):
    """Offered when an autosave from a previous session is found."""

    def __init__(self, autosaves: list, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Recover project")
        self.setMinimumWidth(460)
        lay = QVBoxLayout(self)
        label = QLabel("MotionForge found autosaved work from a previous session:")
        label.setWordWrap(True)
        lay.addWidget(label)
        self.list = QListWidget()
        for entry in autosaves:
            item = QListWidgetItem(f"{entry.get('name', 'project')} · {entry.get('path', '')}")
            item.setData(Qt.UserRole, entry)
            self.list.addItem(item)
        self.list.setCurrentRow(0)
        lay.addWidget(self.list)
        buttons = QDialogButtonBox(QDialogButtonBox.Open | QDialogButtonBox.Discard)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        lay.addWidget(buttons)

    def chosen(self):
        item = self.list.currentItem()
        return item.data(Qt.UserRole) if item else None


_ = (QFrame, QGroupBox, QGridLayout, QIcon, QColor, QSize, QScrollArea, get_icon, Signal)
