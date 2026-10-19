"""NovaCut AI Studio desktop shell and first functional editor workflow."""
from __future__ import annotations

import importlib.util
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import subprocess
import sys
import time

from PySide6.QtCore import QSettings, Qt, QTimer, QUrl, Signal
from PySide6.QtGui import QAction, QColor, QFont, QIcon, QKeySequence, QPixmap
from PySide6.QtMultimedia import QAudioOutput, QMediaPlayer
from PySide6.QtMultimediaWidgets import QVideoWidget
from PySide6.QtWidgets import (
    QApplication, QCheckBox, QComboBox, QDialog, QDockWidget, QDoubleSpinBox, QFileDialog, QFormLayout,
    QFrame, QGridLayout, QHBoxLayout, QInputDialog, QLabel, QLineEdit, QListWidget, QListWidgetItem, QMainWindow,
    QMenu, QMessageBox, QPushButton, QScrollArea, QSpinBox, QStackedLayout, QTabWidget,
    QTextEdit, QVBoxLayout, QWidget,
)

from .ai import (
    SubtitleSegment, ask_local_ollama, background_remove_image,
    export_subtitles, find_whisper_cli, model_path, ollama_models,
    transcribe_local, whisper_availability,
)
from .media import (
    create_proxy, create_thumbnail, detect_scenes, detect_silence,
    find_ffmpeg, format_media_info, generate_waveform, probe_media,
)
from .models import Clip, MediaAsset, Project, media_kind_for_path, new_id
from .project import (
    PROJECT_SUFFIX, app_data_dir, autosave_path, load_project,
    recovery_available, remove_autosave, save_autosave, save_project,
)
from .timeline import ProjectHistory, TimelineError, TimelineOperations
from .widgets import ExportDialog, MediaListWidget, ModelManagerDialog, TimelineWidget
from .workers import Worker


APP_NAME = "NovaCut AI Studio"
LOG = logging.getLogger("novacut")

STYLESHEET = r"""
* { font-family: "Segoe UI", "Arial", sans-serif; font-size: 10pt; }
QMainWindow, QWidget { background: #11151c; color: #e7ebf1; }
QMenuBar { background: #181d26; color: #e6ebf2; border-bottom: 1px solid #2b3340; }
QMenuBar::item { padding: 7px 11px; background: transparent; }
QMenuBar::item:selected, QMenu::item:selected { background: #2b3545; }
QMenu { background: #1a202a; border: 1px solid #374252; padding: 5px; }
QMenu::item { padding: 7px 28px 7px 18px; }
QToolBar { background: #181d26; border: 0; border-bottom: 1px solid #29313d; spacing: 6px; padding: 5px 8px; }
QToolButton, QPushButton { color: #e9eef5; background: #252d39; border: 1px solid #364252; border-radius: 5px; padding: 5px 10px; }
QToolButton:hover, QPushButton:hover { background: #303b4b; border-color: #54718e; }
QPushButton:pressed, QToolButton:pressed { background: #1b242e; }
QPushButton:disabled, QToolButton:disabled { color: #747f8e; background: #1a2028; border-color: #28303a; }
QLineEdit, QSpinBox, QDoubleSpinBox, QComboBox, QTextEdit, QPlainTextEdit, QTableWidget, QListWidget {
  background: #171c24; color: #e7ebf1; border: 1px solid #343e4c; border-radius: 4px; padding: 5px;
  selection-background-color: #246c7a;
}
QComboBox::drop-down { border: 0; width: 24px; }
QComboBox QAbstractItemView { background: #1c222c; color: #e7ebf1; selection-background-color: #246c7a; }
QSlider::groove:horizontal { height: 4px; background: #384353; border-radius: 2px; }
QSlider::handle:horizontal { width: 14px; margin: -5px 0; border-radius: 7px; background: #61cbb4; }
QCheckBox { spacing: 7px; }
QCheckBox::indicator { width: 14px; height: 14px; }
QCheckBox::indicator:checked { background: #51c3a8; border: 1px solid #6ce2c7; }
QDockWidget { color: #dce3ec; titlebar-close-icon: none; titlebar-normal-icon: none; }
QDockWidget::title { text-align: left; background: #1b212b; padding: 7px 10px; border: 1px solid #2b3441; }
QTabWidget::pane { border: 1px solid #2c3542; background: #11151c; }
QTabBar::tab { background: #1b212b; color: #aab5c4; padding: 8px 18px; border: 1px solid #2b3542; }
QTabBar::tab:selected { background: #232c39; color: #e9f4f2; border-bottom: 2px solid #5ac8b0; }
QStatusBar { background: #171c24; color: #aeb8c6; border-top: 1px solid #2b3340; }
QProgressBar { background: #202733; border: 1px solid #394453; border-radius: 4px; text-align: center; height: 17px; }
QProgressBar::chunk { background: #50bda5; border-radius: 3px; }
QScrollBar:vertical { background: #151a22; width: 12px; margin: 0; }
QScrollBar::handle:vertical { background: #374353; min-height: 24px; border-radius: 5px; }
QScrollBar:horizontal { background: #151a22; height: 12px; margin: 0; }
QScrollBar::handle:horizontal { background: #374353; min-width: 24px; border-radius: 5px; }
QLabel#sectionTitle { color: #dbe4ee; font-size: 11pt; font-weight: 700; letter-spacing: 0.5px; }
QLabel#muted { color: #9aa6b5; }
QFrame#aiCard { background: #191f29; border: 1px solid #2d3745; border-radius: 8px; }
QFrame#previewFrame { background: #080a0e; border: 1px solid #303947; }
"""


def configure_logging() -> Path:
    folder = app_data_dir() / "Logs"
    folder.mkdir(parents=True, exist_ok=True)
    logfile = folder / "novacut.log"
    handler = RotatingFileHandler(logfile, maxBytes=2_000_000, backupCount=4, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(threadName)s %(message)s"))
    LOG.setLevel(logging.INFO)
    if not LOG.handlers:
        LOG.addHandler(handler)
        LOG.addHandler(logging.StreamHandler())
    return logfile


def _short_error(message: str) -> str:
    return message.split("\n\nTraceback", 1)[0].strip()


def _timecode(seconds: float, fps: float) -> str:
    seconds = max(0.0, seconds)
    hours = int(seconds // 3600)
    minutes = int(seconds // 60) % 60
    whole = int(seconds) % 60
    frame = int((seconds - int(seconds)) * max(1, fps))
    return f"{hours:02d}:{minutes:02d}:{whole:02d}:{frame:02d}"


class ProjectSettingsDialog(QDialog):
    def __init__(self, project: Project, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Project Settings")
        self.resize(390, 260)
        self.width_box = QSpinBox()
        self.width_box.setRange(16, 16384)
        self.width_box.setValue(project.width)
        self.height_box = QSpinBox()
        self.height_box.setRange(16, 16384)
        self.height_box.setValue(project.height)
        self.fps_box = QDoubleSpinBox()
        self.fps_box.setRange(1, 240)
        self.fps_box.setDecimals(3)
        self.fps_box.setValue(project.fps)
        self.preset = QComboBox()
        for label, width, height in (
            ("Landscape · 1920 × 1080", 1920, 1080),
            ("Landscape · 1280 × 720", 1280, 720),
            ("Portrait · 1080 × 1920", 1080, 1920),
            ("Square · 1080 × 1080", 1080, 1080),
            ("4K · 3840 × 2160", 3840, 2160),
            ("Custom", 0, 0),
        ):
            self.preset.addItem(label, (width, height))
        self.preset.currentIndexChanged.connect(self._apply_preset)
        form = QFormLayout()
        form.addRow("Preset", self.preset)
        form.addRow("Width", self.width_box)
        form.addRow("Height", self.height_box)
        form.addRow("Frame rate", self.fps_box)
        self.name = QLineEdit(project.name)
        form.addRow("Project name", self.name)
        buttons = QHBoxLayout()
        apply_button = QPushButton("Apply")
        cancel_button = QPushButton("Cancel")
        apply_button.clicked.connect(self.accept)
        cancel_button.clicked.connect(self.reject)
        buttons.addStretch(1)
        buttons.addWidget(cancel_button)
        buttons.addWidget(apply_button)
        layout = QVBoxLayout(self)
        layout.addLayout(form)
        note = QLabel("Changing the canvas is non-destructive. Review framing and text placement before export.")
        note.setObjectName("muted")
        note.setWordWrap(True)
        layout.addWidget(note)
        layout.addLayout(buttons)

    def _apply_preset(self, _index: int):
        data = self.preset.currentData()
        if data and data[0]:
            self.width_box.setValue(data[0])
            self.height_box.setValue(data[1])


class Inspector(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.project: Project | None = None
        self.clip_id = ""
        self._updating = False
        self.controls: dict[str, QWidget] = {}
        self.property_changed = None
        self.title_changed = None
        self.form = QFormLayout()
        self.form.setLabelAlignment(Qt.AlignmentFlag.AlignLeft)
        self.heading = QLabel("No selection")
        self.heading.setObjectName("sectionTitle")
        self.detail = QLabel("Select a clip on the timeline or import media to inspect it.")
        self.detail.setWordWrap(True)
        self.detail.setObjectName("muted")
        outer = QVBoxLayout(self)
        outer.setContentsMargins(10, 9, 10, 8)
        outer.addWidget(self.heading)
        outer.addWidget(self.detail)
        outer.addSpacing(8)
        fields = [
            ("start", "Timeline start", 0, 1_000_000, 3, 0.05),
            ("source_in", "Source in", 0, 1_000_000, 3, 0.05),
            ("source_out", "Source out", 0.001, 1_000_000, 3, 0.05),
            ("playback_rate", "Speed", 0.0625, 16, 3, 0.05),
            ("opacity", "Opacity", 0, 1, 2, 0.05),
            ("volume", "Volume", 0, 4, 2, 0.05),
            ("position_x", "Position X", -8192, 8192, 1, 10),
            ("position_y", "Position Y", -8192, 8192, 1, 10),
            ("scale", "Scale", 0.05, 8, 3, 0.05),
            ("rotation", "Rotation", -360, 360, 1, 5),
            ("fade_in", "Fade in", 0, 120, 2, 0.1),
            ("fade_out", "Fade out", 0, 120, 2, 0.1),
            ("brightness", "Exposure / brightness", -2, 2, 2, 0.05),
            ("contrast", "Contrast", 0, 4, 2, 0.05),
            ("saturation", "Saturation", 0, 4, 2, 0.05),
            ("crop_left", "Crop left %", 0, 0.95, 2, 0.01),
            ("crop_top", "Crop top %", 0, 0.95, 2, 0.01),
            ("crop_width", "Crop width %", 0.05, 1, 2, 0.01),
            ("crop_height", "Crop height %", 0.05, 1, 2, 0.01),
            ("bass_db", "Bass EQ (dB)", -24, 24, 1, 1),
            ("treble_db", "Treble EQ (dB)", -24, 24, 1, 1),
            ("denoise_strength", "Noise reduction", 6, 30, 1, 1),
        ]
        for name, label, minimum, maximum, decimals, step in fields:
            spin = QDoubleSpinBox()
            spin.setRange(minimum, maximum)
            spin.setDecimals(decimals)
            spin.setSingleStep(step)
            spin.setKeyboardTracking(False)
            self.controls[name] = spin
            self.form.addRow(label, spin)
            spin.valueChanged.connect(lambda value, key=name: self._emit_change(key, value))
        self.title_text = QLineEdit()
        self.title_text.editingFinished.connect(self._emit_title)
        self.controls["title"] = self.title_text
        self.form.addRow("Title text", self.title_text)
        self.title_color = QLineEdit("#ffffff")
        self.title_color.editingFinished.connect(self._emit_color)
        self.controls["title_color"] = self.title_color
        self.form.addRow("Text color", self.title_color)
        title_size = QSpinBox()
        title_size.setRange(8, 300)
        title_size.valueChanged.connect(lambda value: self._emit_change("title_size", value))
        self.controls["title_size"] = title_size
        self.form.addRow("Text size", title_size)
        self.denoise = QComboBox()
        self.denoise.addItems(["Off", "On · FFmpeg afftdn"])
        self.denoise.currentIndexChanged.connect(lambda index: self._emit_change("denoise", bool(index)))
        self.controls["denoise"] = self.denoise
        self.form.addRow("Local audio cleanup", self.denoise)
        self.chroma_key = QComboBox()
        self.chroma_key.addItems(["Off", "Key green"])
        self.chroma_key.currentIndexChanged.connect(lambda index: self._emit_change("chroma_key", bool(index)))
        self.controls["chroma_key"] = self.chroma_key
        self.form.addRow("Chroma key", self.chroma_key)
        self.chroma_color = QLineEdit("#00ff00")
        self.chroma_color.editingFinished.connect(lambda: self._emit_change("chroma_color", self.chroma_color.text()))
        self.controls["chroma_color"] = self.chroma_color
        self.form.addRow("Key color", self.chroma_color)
        self.lut_path = QLineEdit()
        self.lut_path.setPlaceholderText("Optional .cube LUT path")
        self.lut_path.editingFinished.connect(lambda: self._emit_change("lut_path", self.lut_path.text()))
        self.controls["lut_path"] = self.lut_path
        self.form.addRow("3D LUT (.cube)", self.lut_path)
        outer.addLayout(self.form)
        outer.addStretch(1)

    def _emit_change(self, name, value):
        if not self._updating and self.property_changed:
            self.property_changed(name, value)

    def _emit_title(self):
        if not self._updating and self.title_changed:
            self.title_changed("title", self.title_text.text())

    def _emit_color(self):
        if not self._updating and self.title_changed:
            self.title_changed("title_color", self.title_color.text())

    def set_project(self, project: Project, clip_id: str):
        self.project = project
        self.clip_id = clip_id
        clip = project.clip(clip_id) if clip_id else None
        self._updating = True
        self.form.setEnabled(clip is not None)
        if not clip:
            self.heading.setText("Project inspector")
            self.detail.setText(f"{project.width} × {project.height} · {project.fps:g} FPS\n"
                                f"{len(project.media)} media item(s) · {len(project.clips)} timeline clip(s)")
            self._updating = False
            return
        asset = project.asset(clip.media_id) if clip.type != "title" else None
        self.heading.setText(project.clip_label(clip))
        self.detail.setText("Title overlay · editable text clip" if clip.type == "title" else
                            format_media_info(asset) if asset else "Missing source media")
        values = {
            "start": clip.start, "source_in": clip.source_in, "source_out": clip.source_out,
            "playback_rate": clip.playback_rate, "opacity": clip.opacity, "volume": clip.volume,
            "position_x": clip.position_x, "position_y": clip.position_y, "scale": clip.scale,
            "rotation": clip.rotation, "fade_in": clip.fade_in, "fade_out": clip.fade_out,
            "brightness": clip.effects.get("brightness", 0.0),
            "contrast": clip.effects.get("contrast", 1.0),
            "saturation": clip.effects.get("saturation", 1.0),
            "crop_left": clip.effects.get("crop", {}).get("left", 0.0),
            "crop_top": clip.effects.get("crop", {}).get("top", 0.0),
            "crop_width": clip.effects.get("crop", {}).get("width", 1.0),
            "crop_height": clip.effects.get("crop", {}).get("height", 1.0),
            "bass_db": clip.effects.get("bass_db", 0.0),
            "treble_db": clip.effects.get("treble_db", 0.0),
            "denoise_strength": clip.effects.get("denoise_strength", 18.0),
        }
        for key, value in values.items():
            control = self.controls[key]
            if isinstance(control, QDoubleSpinBox):
                control.setValue(float(value))
        self.controls["title"].setVisible(clip.type == "title")
        self.controls["title_color"].setVisible(clip.type == "title")
        self.controls["title_size"].setVisible(clip.type == "title")
        self.title_text.setText(clip.title)
        self.title_color.setText(clip.title_color)
        self.controls["title_size"].setValue(clip.title_size)
        self.controls["denoise"].setCurrentIndex(1 if clip.effects.get("denoise") else 0)
        self.controls["chroma_key"].setCurrentIndex(1 if clip.effects.get("chroma_key") else 0)
        self.chroma_color.setText(str(clip.effects.get("chroma_color", "#00ff00")))
        self.lut_path.setText(str(clip.effects.get("lut_path", "")))
        if asset and not asset.has_audio:
            self.controls["volume"].setToolTip("This source has no detected audio stream.")
        self._updating = False


class AIStudioPage(QWidget):
    toolRequested = Signal(str)
    manageModelsRequested = Signal()
    refreshAssistantRequested = Signal()
    assistantRequested = Signal(str, str)
    applySilencesRequested = Signal()
    addMarkersRequested = Signal()
    splitScenesRequested = Signal()

    def __init__(self, parent=None):
        super().__init__(parent)
        self.cards: dict[str, QLabel] = {}
        self.result_kind = ""
        self.results = []
        self.model_combo = QComboBox()
        self.question = QLineEdit()
        self.answer = QTextEdit()
        self.answer.setReadOnly(True)
        self.answer.setPlaceholderText("Local assistant suggestions appear here. Nothing is applied to the timeline.")
        self.result_list = QListWidget()
        self.apply_silence_button = QPushButton("Apply selected cuts · undoable")
        self.add_markers_button = QPushButton("Add selected scene markers")
        self.split_scenes_button = QPushButton("Split selected clip at scenes")
        self.apply_silence_button.clicked.connect(self.applySilencesRequested)
        self.add_markers_button.clicked.connect(self.addMarkersRequested)
        self.split_scenes_button.clicked.connect(self.splitScenesRequested)
        self.apply_silence_button.hide()
        self.add_markers_button.hide()
        self.split_scenes_button.hide()
        self.result_list.setMinimumHeight(120)

        layout = QVBoxLayout(self)
        layout.setContentsMargins(18, 14, 18, 16)
        title = QLabel("Local AI Studio")
        title.setObjectName("sectionTitle")
        sub = QLabel("Optional local tools. Core editing stays offline; model inference runs on this computer only. Missing dependencies are shown honestly.")
        sub.setObjectName("muted")
        sub.setWordWrap(True)
        layout.addWidget(title)
        layout.addWidget(sub)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        container = QWidget()
        grid = QGridLayout(container)
        grid.setSpacing(10)
        card_specs = [
            ("subtitles", "Automatic subtitles", "Local Whisper transcription with editable, time-aligned title clips. Requires whisper.cpp, FFmpeg, and a locally installed model.", "Transcribe selected clip"),
            ("silence", "Silence detection", "Analyze audio locally, review proposed silent intervals, then apply ripple cuts with Undo available.", "Analyze silence"),
            ("scenes", "Scene detection", "Find shot boundaries locally with FFmpeg. Review proposed markers or splits before changing the edit.", "Detect scenes"),
            ("background", "Background removal", "Optional local U²-Net segmentation for still images. Video matte processing is not included in this version.", "Remove image background"),
            ("separation", "Audio separation", "Optional Demucs vocal/accompaniment separation. Requires a local package and cached weights; no model is fetched implicitly.", "Separate selected audio"),
            ("reframe", "Smart reframing", "Creates a centered vertical crop suggestion you can edit. Subject tracking is not available; review the crop manually.", "Suggest vertical crop"),
            ("cleanup", "Audio cleanup", "Local FFmpeg FFT denoising and simple EQ controls. Adjustable on the selected clip and applied during export.", "Toggle denoise"),
            ("assistant", "Local AI assistant", "Ask a locally hosted Ollama model for workflow advice. Only loopback addresses are accepted; suggestions never alter the timeline.", "Ask locally"),
        ]
        for index, (key, name, description, button_text) in enumerate(card_specs):
            card = QFrame()
            card.setObjectName("aiCard")
            card_layout = QVBoxLayout(card)
            card_layout.setContentsMargins(12, 10, 12, 11)
            head = QHBoxLayout()
            heading = QLabel(name)
            heading.setStyleSheet("font-size: 11pt; font-weight: 700; color: #edf2f7;")
            status = QLabel("Checking…")
            status.setObjectName("muted")
            status.setAlignment(Qt.AlignmentFlag.AlignRight | Qt.AlignmentFlag.AlignVCenter)
            head.addWidget(heading, 1)
            head.addWidget(status)
            card_layout.addLayout(head)
            text = QLabel(description)
            text.setObjectName("muted")
            text.setWordWrap(True)
            card_layout.addWidget(text)
            if key == "subtitles":
                row = QHBoxLayout()
                self.whisper_size = QComboBox()
                for size in ("tiny", "base", "small", "medium"):
                    self.whisper_size.addItem(size.title(), size)
                row.addWidget(QLabel("Model"))
                row.addWidget(self.whisper_size, 1)
                manage = QPushButton("Model Manager")
                manage.clicked.connect(self.manageModelsRequested)
                row.addWidget(manage)
                card_layout.addLayout(row)
            elif key == "assistant":
                assistant_row = QHBoxLayout()
                self.model_combo.setMinimumWidth(150)
                self.question.setPlaceholderText("Ask about edits, export, or workflow…")
                refresh = QPushButton("↻")
                refresh.setToolTip("Check locally installed Ollama models")
                refresh.clicked.connect(self.refreshAssistantRequested)
                assistant_row.addWidget(self.model_combo)
                assistant_row.addWidget(refresh)
                card_layout.addLayout(assistant_row)
                card_layout.addWidget(self.question)
                button = QPushButton("Ask locally")
                button.clicked.connect(self._ask)
                card_layout.addWidget(button)
                card_layout.addWidget(self.answer)
                button_text = ""
            if key != "assistant":
                button = QPushButton(button_text)
                button.clicked.connect(lambda _checked=False, selected=key: self.toolRequested.emit(selected))
                card_layout.addWidget(button)
            self.cards[key] = status
            grid.addWidget(card, index // 2, index % 2)
        grid.setColumnStretch(0, 1)
        grid.setColumnStretch(1, 1)
        scroll.setWidget(container)
        layout.addWidget(scroll, 1)

        results_box = QFrame()
        results_box.setObjectName("aiCard")
        results_layout = QVBoxLayout(results_box)
        results_layout.setContentsMargins(12, 9, 12, 10)
        results_head = QHBoxLayout()
        results_head.addWidget(QLabel("Review proposals"))
        results_head.addStretch(1)
        self.analysis_status = QLabel("Choose a tool above to analyze the selected clip.")
        self.analysis_status.setObjectName("muted")
        results_head.addWidget(self.analysis_status)
        results_layout.addLayout(results_head)
        results_layout.addWidget(self.result_list)
        proposal_buttons = QHBoxLayout()
        proposal_buttons.addWidget(self.apply_silence_button)
        proposal_buttons.addWidget(self.add_markers_button)
        proposal_buttons.addWidget(self.split_scenes_button)
        proposal_buttons.addStretch(1)
        results_layout.addLayout(proposal_buttons)
        layout.addWidget(results_box)

    def _ask(self):
        question = self.question.text().strip()
        model = str(self.model_combo.currentData() or self.model_combo.currentText()).strip()
        if not question or not model:
            self.analysis_status.setText("Choose an installed local model and enter a question.")
            return
        self.assistantRequested.emit(question, model)

    def set_status(self, key: str, text: str):
        if key in self.cards:
            self.cards[key].setText(text)

    def set_models(self, models: list[str]):
        selected = self.model_combo.currentData()
        self.model_combo.clear()
        for model in models:
            self.model_combo.addItem(model, model)
        if selected:
            index = self.model_combo.findData(selected)
            if index >= 0:
                self.model_combo.setCurrentIndex(index)
        if not models:
            self.model_combo.addItem("No local models", "")

    def set_assistant_answer(self, text: str):
        self.answer.setPlainText(text)

    def show_silences(self, intervals: list[tuple[float, float]]):
        self.result_kind = "silence"
        self.results = list(intervals)
        self.result_list.clear()
        self.apply_silence_button.setVisible(bool(intervals))
        self.add_markers_button.hide()
        self.split_scenes_button.hide()
        for left, right in intervals:
            item = QListWidgetItem(f"{left:7.2f} s  →  {right:7.2f} s   ·   {right - left:.2f} s silent")
            item.setData(Qt.ItemDataRole.UserRole, (left, right))
            item.setFlags(item.flags() | Qt.ItemFlag.ItemIsUserCheckable)
            item.setCheckState(Qt.CheckState.Checked)
            self.result_list.addItem(item)
        self.analysis_status.setText(f"Found {len(intervals)} candidate silent interval(s). Review before applying.")

    def show_scenes(self, times: list[float]):
        self.result_kind = "scenes"
        self.results = list(times)
        self.result_list.clear()
        self.apply_silence_button.hide()
        self.add_markers_button.setVisible(bool(times))
        self.split_scenes_button.setVisible(bool(times))
        for index, seconds in enumerate(times, 1):
            item = QListWidgetItem(f"Scene boundary {index:03d}  ·  {seconds:.3f} s")
            item.setData(Qt.ItemDataRole.UserRole, seconds)
            item.setFlags(item.flags() | Qt.ItemFlag.ItemIsUserCheckable)
            item.setCheckState(Qt.CheckState.Checked)
            self.result_list.addItem(item)
        self.analysis_status.setText(f"Found {len(times)} candidate boundary/boundaries. Review before applying.")

    def selected_proposals(self):
        values = []
        for index in range(self.result_list.count()):
            item = self.result_list.item(index)
            if item.checkState() == Qt.CheckState.Checked:
                values.append(item.data(Qt.ItemDataRole.UserRole))
        return values


class NovaCutMainWindow(QMainWindow):
    def __init__(self, start_project: str = "", smoke_test: bool = False):
        super().__init__()
        self.setWindowTitle(APP_NAME)
        self.setMinimumSize(1120, 700)
        self.resize(1500, 930)
        self.settings = QSettings("NovaCut", "NovaCut AI Studio")
        self.history = ProjectHistory(limit=120)
        self.project = Project.create()
        self.project.dirty = False
        self.selected_media_id = ""
        self.selected_clip_id = ""
        self._workers: list[Worker] = []
        self._pending_drops: dict[str, list[tuple[float, str]]] = {}
        self._silence_clip_id = ""
        self._scene_clip_id = ""
        self._current_preview_clip = ""
        self._preview_standalone = False
        self._is_playing = False
        self._transport_speed = 1.0
        self._last_tick = time.monotonic()
        self._pending_seek = 0.0
        self._closing = False
        self._smoke_test = smoke_test
        self.ffmpeg_path = str(self.settings.value("ffmpeg/path", ""))
        self.whisper_cli = str(self.settings.value("whisper/cli", ""))
        self._log_path = configure_logging()
        self._build_actions()
        self._build_ui()
        self._build_menus()
        self._wire_shortcuts()
        self._restore_window_state()
        self._refresh_all()
        self._update_ai_statuses()
        self._start_assistant_model_check()
        self.autosave_timer = QTimer(self)
        self.autosave_timer.setInterval(30_000)
        self.autosave_timer.timeout.connect(self._autosave)
        self.autosave_timer.start()
        if start_project:
            self.open_project(start_project, startup=True)
        else:
            self._offer_recovery()
        if smoke_test:
            QTimer.singleShot(900, self.close)

    # ----- UI composition -----
    def _build_actions(self):
        self.actions: dict[str, QAction] = {}
        specs = [
            ("new", "New Project", "Ctrl+N", self.new_project),
            ("open", "Open Project…", "Ctrl+O", self.choose_project),
            ("save", "Save Project", "Ctrl+S", self.save),
            ("save_as", "Save Project As…", "Ctrl+Shift+S", self.save_as),
            ("import", "Import Media…", "Ctrl+I", self.import_dialog),
            ("export", "Export Video…", "Ctrl+E", self.export_dialog),
            ("export_srt", "Export Subtitles (SRT)…", "", lambda: self.export_subtitles_dialog("srt")),
            ("export_vtt", "Export Subtitles (VTT)…", "", lambda: self.export_subtitles_dialog("vtt")),
            ("undo", "Undo", "Ctrl+Z", self.undo),
            ("redo", "Redo", "Ctrl+Y", self.redo),
            ("split", "Split at Playhead", "S", lambda: self._timeline_action("split", self.selected_clip_id)),
            ("duplicate", "Duplicate Clip", "Ctrl+D", lambda: self._timeline_action("duplicate", self.selected_clip_id)),
            ("delete", "Delete Clip", "Delete", lambda: self._timeline_action("delete", self.selected_clip_id)),
            ("play", "Play / Pause", "Space", self.toggle_play),
            ("settings", "Project Settings…", "", self.project_settings_dialog),
            ("models", "Local Model Manager…", "", self.open_model_manager),
            ("ffmpeg", "FFmpeg / AI Paths…", "", self.configure_paths),
            ("about", "About NovaCut", "", self.about),
        ]
        for key, text, shortcut, callback in specs:
            action = QAction(text, self)
            if shortcut:
                action.setShortcut(QKeySequence(shortcut))
            action.triggered.connect(callback)
            self.actions[key] = action

    def _build_ui(self):
        self.editor_tabs = QTabWidget()
        self.editor_tabs.setDocumentMode(True)
        self.editor_page = QWidget()
        self.ai_page = AIStudioPage()
        editor_layout = QVBoxLayout(self.editor_page)
        editor_layout.setContentsMargins(10, 8, 10, 9)
        editor_layout.setSpacing(7)
        preview_header = QHBoxLayout()
        preview_title = QLabel("PREVIEW")
        preview_title.setObjectName("sectionTitle")
        self.preview_info = QLabel("No active timeline clip")
        self.preview_info.setObjectName("muted")
        preview_header.addWidget(preview_title)
        preview_header.addStretch(1)
        preview_header.addWidget(self.preview_info)
        editor_layout.addLayout(preview_header)
        self.preview_frame = QFrame()
        self.preview_frame.setObjectName("previewFrame")
        stack = QStackedLayout(self.preview_frame)
        self.preview_stack = stack
        self.video_widget = QVideoWidget()
        self.video_widget.setMinimumSize(360, 210)
        self.video_widget.setSizePolicy(self.video_widget.sizePolicy().horizontalPolicy(), self.video_widget.sizePolicy().verticalPolicy())
        self.image_preview = QLabel()
        self.image_preview.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.image_preview.setStyleSheet("background: #080a0e;")
        self.preview_placeholder = QLabel("Import media, then drag a clip into the timeline\n\nDrop media from the bin onto any unlocked track")
        self.preview_placeholder.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.preview_placeholder.setStyleSheet("color: #738093; background: rgba(8, 10, 14, 150); font-size: 12pt;")
        stack.addWidget(self.video_widget)
        stack.addWidget(self.image_preview)
        stack.addWidget(self.preview_placeholder)
        stack.setCurrentWidget(self.video_widget)
        self.preview_overlay_labels: list[QLabel] = []
        editor_layout.addWidget(self.preview_frame, 1)

        transport = QHBoxLayout()
        self.btn_previous = QPushButton("◀|")
        self.btn_play = QPushButton("▶")
        self.btn_next = QPushButton("|▶")
        self.btn_play.setFixedWidth(54)
        self.btn_previous.setToolTip("Previous frame")
        self.btn_next.setToolTip("Next frame")
        self.btn_play.setToolTip("Play or pause the preview (Space)")
        self.time_label = QLabel("00:00:00:00")
        self.time_label.setMinimumWidth(120)
        self.time_label.setStyleSheet("font-family: Consolas, monospace; font-size: 12pt; color: #c8d7e7;")
        self.speed_combo = QComboBox()
        for speed in (0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0):
            self.speed_combo.addItem(f"{speed:g}×", speed)
        self.speed_combo.setCurrentIndex(3)
        self.speed_combo.setFixedWidth(85)
        self.use_proxies_checkbox = QCheckBox("Proxy preview")
        self.use_proxies_checkbox.setToolTip("Use generated low-resolution proxies for playback only. Exports always use original media.")
        self.use_proxies_checkbox.setChecked(self.settings.value("preview/use_proxies", False, type=bool))
        self.use_proxies_checkbox.toggled.connect(self._proxy_preview_toggled)
        self.transport_hint = QLabel("Clip preview · final render composites all tracks")
        self.transport_hint.setObjectName("muted")
        transport.addWidget(self.btn_previous)
        transport.addWidget(self.btn_play)
        transport.addWidget(self.btn_next)
        transport.addSpacing(12)
        transport.addWidget(self.time_label)
        transport.addWidget(self.speed_combo)
        transport.addWidget(self.use_proxies_checkbox)
        transport.addStretch(1)
        transport.addWidget(self.transport_hint)
        editor_layout.addLayout(transport)
        self.editor_tabs.addTab(self.editor_page, "✂  Editor")
        self.editor_tabs.addTab(self.ai_page, "✦  AI Studio")
        self.setCentralWidget(self.editor_tabs)

        self.media_list = MediaListWidget()
        self.media_list.itemSelectionChanged.connect(self._media_selection_changed)
        self.media_list.itemDoubleClicked.connect(self._media_double_clicked)
        self.media_list.filesDropped.connect(self.import_files)
        self.media_list.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.media_list.customContextMenuRequested.connect(self._media_context_menu)
        media_panel = QWidget()
        media_layout = QVBoxLayout(media_panel)
        media_layout.setContentsMargins(7, 7, 7, 7)
        media_header = QHBoxLayout()
        media_header.addWidget(QLabel("PROJECT MEDIA"))
        media_header.addStretch(1)
        import_button = QPushButton("＋ Import")
        import_button.clicked.connect(self.import_dialog)
        media_header.addWidget(import_button)
        media_layout.addLayout(media_header)
        media_layout.addWidget(self.media_list, 1)
        self.media_empty = QLabel("No media yet\nImport files or drag them here")
        self.media_empty.setAlignment(Qt.AlignmentFlag.AlignCenter)
        self.media_empty.setStyleSheet("color: #7b8797; padding: 18px;")
        media_layout.addWidget(self.media_empty)
        self.media_dock = QDockWidget("Media Bin", self)
        self.media_dock.setObjectName("MediaBinDock")
        self.media_dock.setWidget(media_panel)
        self.media_dock.setMinimumWidth(220)
        self.addDockWidget(Qt.DockWidgetArea.LeftDockWidgetArea, self.media_dock)

        self.inspector = Inspector()
        self.inspector.property_changed = self._clip_property_changed
        self.inspector.title_changed = self._clip_property_changed
        inspector_scroll = QScrollArea()
        inspector_scroll.setWidgetResizable(True)
        inspector_scroll.setWidget(self.inspector)
        inspector_scroll.setFrameShape(QFrame.Shape.NoFrame)
        self.inspector_dock = QDockWidget("Inspector", self)
        self.inspector_dock.setObjectName("InspectorDock")
        self.inspector_dock.setWidget(inspector_scroll)
        self.inspector_dock.setMinimumWidth(270)
        self.addDockWidget(Qt.DockWidgetArea.RightDockWidgetArea, self.inspector_dock)

        self.timeline = TimelineWidget()
        self.timeline.selectionChanged.connect(self._select_clip)
        self.timeline.playheadChanged.connect(self._playhead_changed)
        self.timeline.clipMoved.connect(self._clip_moved)
        self.timeline.clipDropped.connect(self._clips_dropped)
        self.timeline.operationRequested.connect(self._timeline_action)
        self.timeline.trackAction.connect(self._track_action)
        self.timeline.trackRequested.connect(self._add_track)
        self.timeline.markerRequested.connect(self._add_marker)
        self.timeline.titleRequested.connect(self.add_title_dialog)
        self.timeline_dock = QDockWidget("Timeline", self)
        self.timeline_dock.setObjectName("TimelineDock")
        self.timeline_dock.setWidget(self.timeline)
        self.timeline_dock.setMinimumHeight(230)
        self.addDockWidget(Qt.DockWidgetArea.BottomDockWidgetArea, self.timeline_dock)
        self.resizeDocks([self.media_dock], [270], Qt.Orientation.Horizontal)
        self.resizeDocks([self.inspector_dock], [320], Qt.Orientation.Horizontal)
        self.resizeDocks([self.timeline_dock], [315], Qt.Orientation.Vertical)

        toolbar = self.addToolBar("Main")
        toolbar.setObjectName("MainToolbar")
        toolbar.setMovable(False)
        toolbar.addAction(self.actions["new"])
        toolbar.addAction(self.actions["open"])
        toolbar.addAction(self.actions["save"])
        toolbar.addSeparator()
        toolbar.addAction(self.actions["import"])
        toolbar.addAction(self.actions["undo"])
        toolbar.addAction(self.actions["redo"])
        toolbar.addSeparator()
        toolbar.addAction(self.actions["settings"])
        toolbar.addAction(self.actions["models"])
        toolbar.addSeparator()
        toolbar.addAction(self.actions["export"])

        self.btn_play.clicked.connect(self.toggle_play)
        self.btn_previous.clicked.connect(lambda: self._step_frame(-1))
        self.btn_next.clicked.connect(lambda: self._step_frame(1))
        self.speed_combo.currentIndexChanged.connect(self._speed_changed)
        self.editor_tabs.currentChanged.connect(self._workspace_changed)
        self.ai_page.toolRequested.connect(self._ai_tool_requested)
        self.ai_page.manageModelsRequested.connect(self.open_model_manager)
        self.ai_page.refreshAssistantRequested.connect(self._start_assistant_model_check)
        self.ai_page.assistantRequested.connect(self._assistant_request)
        self.ai_page.applySilencesRequested.connect(self._apply_silence_proposals)
        self.ai_page.addMarkersRequested.connect(self._apply_scene_markers)
        self.ai_page.splitScenesRequested.connect(self._split_at_scenes)

        self.audio_output = QAudioOutput(self)
        self.audio_output.setVolume(0.8)
        self.player = QMediaPlayer(self)
        self.player.setAudioOutput(self.audio_output)
        self.player.setVideoOutput(self.video_widget)
        self.player.positionChanged.connect(self._player_position_changed)
        self.player.playbackStateChanged.connect(self._playback_state_changed)
        self.player.errorOccurred.connect(self._player_error)
        self.player.mediaStatusChanged.connect(self._media_status_changed)
        self.play_timer = QTimer(self)
        self.play_timer.setInterval(33)
        self.play_timer.timeout.connect(self._playback_tick)

        self.statusBar().showMessage(f"Ready · log: {self._log_path}", 6000)
        self.setWindowIcon(QIcon())

    def _build_menus(self):
        file_menu = self.menuBar().addMenu("&File")
        for key in ("new", "open", "save", "save_as"):
            file_menu.addAction(self.actions[key])
        file_menu.addSeparator()
        file_menu.addAction(self.actions["import"])
        file_menu.addSeparator()
        file_menu.addAction(self.actions["export"])
        file_menu.addAction(self.actions["export_srt"])
        file_menu.addAction(self.actions["export_vtt"])
        file_menu.addSeparator()
        file_menu.addAction(self.actions["ffmpeg"])
        file_menu.addSeparator()
        file_menu.addAction("Exit", self.close, "Alt+F4")
        edit_menu = self.menuBar().addMenu("&Edit")
        for key in ("undo", "redo"):
            edit_menu.addAction(self.actions[key])
        edit_menu.addSeparator()
        for key in ("split", "duplicate", "delete"):
            edit_menu.addAction(self.actions[key])
        view_menu = self.menuBar().addMenu("&View")
        view_menu.addAction(self.media_dock.toggleViewAction())
        view_menu.addAction(self.inspector_dock.toggleViewAction())
        view_menu.addAction(self.timeline_dock.toggleViewAction())
        ai_menu = self.menuBar().addMenu("&AI")
        ai_menu.addAction(self.actions["models"])
        ai_menu.addAction("Open AI Studio", lambda: self.editor_tabs.setCurrentWidget(self.ai_page))
        project_menu = self.menuBar().addMenu("&Project")
        project_menu.addAction(self.actions["settings"])
        help_menu = self.menuBar().addMenu("&Help")
        help_menu.addAction(self.actions["about"])

    def _wire_shortcuts(self):
        # QAction shortcuts are available from the main window without a custom
        # event loop, and respect focused text-edit widgets.
        for action in self.actions.values():
            if action.shortcut().toString():
                self.addAction(action)

    def _restore_window_state(self):
        geometry = self.settings.value("window/geometry")
        state = self.settings.value("window/state")
        if geometry:
            self.restoreGeometry(geometry)
        if state:
            self.restoreState(state)

    # ----- project lifecycle and history -----
    def _check_unsaved(self) -> bool:
        if not self.project.dirty:
            return True
        answer = QMessageBox.warning(
            self, "Unsaved project changes", "This project has unsaved changes.",
            QMessageBox.StandardButton.Save | QMessageBox.StandardButton.Discard | QMessageBox.StandardButton.Cancel,
            QMessageBox.StandardButton.Save,
        )
        if answer == QMessageBox.StandardButton.Save:
            return self.save()
        if answer == QMessageBox.StandardButton.Discard:
            remove_autosave(self.project)
            self.project.dirty = False
            return True
        return False

    def new_project(self):
        if not self._check_unsaved():
            return
        self.project = Project.create()
        self.project.dirty = False
        self.history.clear()
        self.selected_media_id = ""
        self.selected_clip_id = ""
        self._current_preview_clip = ""
        self._stop_playback()
        self._refresh_all()
        self._update_window_title()
        self.statusBar().showMessage("New project created", 3000)

    def choose_project(self):
        path, _ = QFileDialog.getOpenFileName(self, "Open NovaCut project", str(Path.home()), "NovaCut Project (*.novacut *.json)")
        if path:
            self.open_project(path)

    def open_project(self, path: str, startup: bool = False):
        if not startup and not self._check_unsaved():
            return
        try:
            project, warnings = load_project(path)
        except Exception as exc:
            LOG.exception("Could not open project %s", path)
            QMessageBox.critical(self, "Could not open project", _short_error(str(exc)))
            return
        if warnings:
            QMessageBox.warning(self, "Missing media", "Some project media could not be found:\n\n" + "\n".join(warnings[:12]))
        self.project = project
        self.history.clear()
        self.selected_media_id = ""
        self.selected_clip_id = ""
        self._stop_playback()
        self._refresh_all()
        self._update_window_title()
        self.statusBar().showMessage(f"Opened {path}", 4000)
        self._offer_recovery(project.path)

    def save(self) -> bool:
        if not self.project.path:
            return self.save_as()
        try:
            recovery_copy = autosave_path(self.project)
            save_project(self.project, self.project.path)
            recovery_copy.unlink(missing_ok=True)
            remove_autosave(self.project)
            self._update_window_title()
            self.statusBar().showMessage(f"Saved {self.project.path}", 4000)
            return True
        except Exception as exc:
            LOG.exception("Project save failed")
            QMessageBox.critical(self, "Save failed", _short_error(str(exc)))
            return False

    def save_as(self) -> bool:
        path, _ = QFileDialog.getSaveFileName(self, "Save NovaCut project", str(Path.home() / f"{self.project.name}{PROJECT_SUFFIX}"), "NovaCut Project (*.novacut)")
        if not path:
            return False
        if Path(path).suffix.lower() != PROJECT_SUFFIX:
            path += PROJECT_SUFFIX
        try:
            recovery_copy = autosave_path(self.project)
            save_project(self.project, path)
            recovery_copy.unlink(missing_ok=True)
            remove_autosave(self.project)
            self._update_window_title()
            self.statusBar().showMessage(f"Saved {self.project.path}", 4000)
            return True
        except Exception as exc:
            LOG.exception("Project save failed")
            QMessageBox.critical(self, "Save failed", _short_error(str(exc)))
            return False

    def _offer_recovery(self, project_path: str = ""):
        recovery, timestamp = recovery_available(project_path)
        if not recovery:
            return
        answer = QMessageBox.question(
            self, "Recover autosaved project?",
            f"A newer local recovery copy was saved at {timestamp}. Recover it now?\n\n{recovery}",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.Yes,
        )
        if answer != QMessageBox.StandardButton.Yes:
            return
        try:
            recovered, warnings = load_project(recovery)
            if warnings:
                QMessageBox.warning(self, "Missing media", "Some recovered media are unavailable:\n\n" + "\n".join(warnings[:10]))
            if not recovered.path or recovered.path.endswith(".autosave" + PROJECT_SUFFIX):
                recovered.path = ""
            recovered.dirty = True
            self.project = recovered
            self.history.clear()
            self._refresh_all()
            self._update_window_title()
            self.statusBar().showMessage("Recovered autosaved project · Save As to keep this work", 8000)
        except Exception as exc:
            LOG.exception("Recovery failed")
            QMessageBox.critical(self, "Recovery failed", _short_error(str(exc)))

    def _autosave(self):
        if not self.project.dirty or self._closing:
            return
        try:
            path = save_autosave(self.project)
            LOG.info("Autosaved recovery snapshot: %s", path)
            self.statusBar().showMessage("Local recovery snapshot saved", 2500)
        except Exception:
            LOG.exception("Autosave failed")
            self.statusBar().showMessage("Autosave failed; see application log", 5000)

    def _record_edit(self, before: dict, refresh: bool = True):
        after = self.project.to_dict()
        self.history.record(before, after)
        self.project.dirty = True
        self._update_window_title()
        if refresh:
            self._refresh_timeline_and_inspector()

    def undo(self):
        if not self.history.can_undo:
            return
        try:
            self.project = self.history.undo(self.project)
            self._refresh_all()
            self.statusBar().showMessage("Undo", 1800)
        except Exception as exc:
            QMessageBox.warning(self, "Undo unavailable", str(exc))

    def redo(self):
        if not self.history.can_redo:
            return
        try:
            self.project = self.history.redo(self.project)
            self._refresh_all()
            self.statusBar().showMessage("Redo", 1800)
        except Exception as exc:
            QMessageBox.warning(self, "Redo unavailable", str(exc))

    def _update_window_title(self):
        project_name = Path(self.project.path).name if self.project.path else self.project.name
        mark = " *" if self.project.dirty else ""
        self.setWindowTitle(f"{project_name}{mark} — {APP_NAME}")
        self.actions["undo"].setEnabled(self.history.can_undo)
        self.actions["redo"].setEnabled(self.history.can_redo)

    # ----- media bin and metadata workers -----
    def import_dialog(self):
        paths, _ = QFileDialog.getOpenFileNames(
            self, "Import video, audio, and images", str(Path.home()),
            "Media (*.mp4 *.m4v *.mov *.mkv *.avi *.webm *.wmv *.mpeg *.mpg *.mxf *.ts *.3gp *.mp3 *.wav *.m4a *.aac *.flac *.ogg *.opus *.wma *.aiff *.png *.jpg *.jpeg *.webp *.bmp *.tif *.tiff *.gif);;All files (*)",
        )
        if paths:
            self.import_files(paths)

    def import_files(self, paths: list[str], drop: tuple[float, str] | None = None):
        if isinstance(paths, str):
            paths = [paths]
        expanded: list[str] = []
        for entry in paths:
            path = Path(entry).expanduser()
            if path.is_dir():
                for child in path.rglob("*"):
                    if child.is_file() and media_kind_for_path(child):
                        expanded.append(str(child))
            else:
                expanded.append(str(path))
        existing = {str(Path(asset.path).expanduser().resolve()): key for key, asset in self.project.media.items()}
        imported_any = False
        for path in expanded:
            source = Path(path).expanduser()
            kind = media_kind_for_path(source)
            if not kind:
                self.statusBar().showMessage(f"Skipped unsupported file: {source.name}", 3500)
                continue
            try:
                resolved = str(source.resolve())
            except OSError:
                resolved = str(source)
            if resolved in existing:
                asset_id = existing[resolved]
                if drop:
                    self._queue_drop(asset_id, drop)
                continue
            if not source.is_file():
                self.statusBar().showMessage(f"File not found: {source}", 4000)
                continue
            asset = MediaAsset(id=new_id(), path=resolved, name=source.name, kind=kind, file_size=source.stat().st_size)
            self.project.media[asset.id] = asset
            self.project.dirty = True
            imported_any = True
            if drop:
                self._pending_drops.setdefault(asset.id, []).append(drop)
            self.selected_media_id = asset.id
            self._refresh_media_bin()
            self._update_window_title()
            self.statusBar().showMessage(f"Reading media metadata: {source.name}", 3000)
            asset_id = asset.id
            ffmpeg = self._ffmpeg()

            def work(cancel_event, signals, media_path=resolved, media_id=asset_id, media_kind=kind, ffmpeg_bin=ffmpeg):
                result = probe_media(media_path, ffmpeg_bin)
                result.id = media_id
                if cancel_event.is_set():
                    return result
                if result.kind in {"video", "image"}:
                    result.thumbnail_path = create_thumbnail(media_path, result.kind, ffmpeg_bin)
                if result.has_audio and result.duration > 0:
                    signals.message.emit(f"Building waveform cache · {Path(media_path).name}")
                    result.waveform = generate_waveform(media_path, result.duration, ffmpeg_bin)
                return result

            worker = Worker(work)
            worker.signals.result.connect(self._media_probe_complete)
            worker.signals.error.connect(lambda message, aid=asset_id: self._media_probe_error(aid, message))
            worker.signals.message.connect(lambda message: self.statusBar().showMessage(message, 2500))
            self._launch_worker(worker)
        if imported_any:
            self._refresh_media_bin()
            self._update_window_title()
        if not expanded:
            self.statusBar().showMessage("No supported media files were found", 3000)

    def _queue_drop(self, media_id: str, drop: tuple[float, str]):
        asset = self.project.asset(media_id)
        if asset and (asset.duration > 0 or asset.kind == "image"):
            self._add_media_to_timeline(media_id, drop[0], drop[1])
        else:
            self._pending_drops.setdefault(media_id, []).append(drop)

    def _media_probe_complete(self, asset: MediaAsset):
        if asset.id not in self.project.media:
            return
        self.project.media[asset.id] = asset
        self.project.dirty = True
        self._refresh_media_bin()
        self._refresh_timeline_and_inspector()
        if self.selected_media_id == asset.id and not self.selected_clip_id and not self._is_playing:
            self._preview_asset(asset)
        pending = self._pending_drops.pop(asset.id, [])
        for start, track_id in pending:
            self._add_media_to_timeline(asset.id, start, track_id)
        self._update_window_title()
        if asset.probe_error:
            self.statusBar().showMessage(f"Imported {asset.name}; metadata warning: {asset.probe_error[:100]}", 7000)
        else:
            self.statusBar().showMessage(f"Imported {asset.name} · {format_media_info(asset)}", 4000)
        self._update_ai_statuses()

    def _media_probe_error(self, asset_id: str, message: str):
        asset = self.project.asset(asset_id)
        if asset:
            asset.probe_error = _short_error(message)
            self._refresh_media_bin()
        LOG.error("Media probe failed: %s", message)
        self.statusBar().showMessage(f"Could not inspect media: {_short_error(message)[:160]}", 7000)

    def _proxy_complete(self, media_id: str, path: str):
        asset = self.project.asset(media_id)
        if not asset:
            return
        asset.proxy_path = path
        self.project.dirty = True
        self._refresh_media_bin()
        self._update_window_title()
        self.statusBar().showMessage(f"Proxy ready for preview: {Path(path).name} · export still uses original media", 5000)
        selected_clip = self.project.clip(self.selected_clip_id)
        if self.use_proxies_checkbox.isChecked() and (self.selected_media_id == media_id or (selected_clip and selected_clip.media_id == media_id)):
            self._current_preview_clip = ""
            if self.selected_clip_id:
                self._sync_preview(self.timeline.playhead, seek=True)
            else:
                self._preview_asset(asset)

    def _refresh_media_bin(self):
        selected = self.selected_media_id
        self.media_list.blockSignals(True)
        self.media_list.clear()
        for asset in self.project.media.values():
            icon = "🎬" if asset.kind == "video" else "♪" if asset.kind == "audio" else "▧"
            item = self._media_item(asset, icon)
            self.media_list.addItem(item)
            if asset.id == selected:
                item.setSelected(True)
        self.media_list.blockSignals(False)
        self.media_empty.setVisible(not bool(self.project.media))
        self.media_list.setVisible(bool(self.project.media))

    @staticmethod
    def _media_item(asset: MediaAsset, icon: str):
        from PySide6.QtGui import QIcon
        pixmap = QPixmap(asset.thumbnail_path) if asset.thumbnail_path else QPixmap()
        if not pixmap.isNull():
            item = QListWidgetItem(QIcon(pixmap), asset.name)
        else:
            item = QListWidgetItem(f"{icon}  {asset.name}")
        item.setData(Qt.ItemDataRole.UserRole, asset.path)
        item.setData(Qt.ItemDataRole.UserRole + 1, asset.id)
        item.setToolTip(format_media_info(asset) + (f"\n{asset.probe_error}" if asset.probe_error else ""))
        return item

    def _media_selection_changed(self):
        items = self.media_list.selectedItems()
        if not items:
            return
        media_id = str(items[0].data(Qt.ItemDataRole.UserRole + 1) or "")
        self.selected_clip_id = ""
        self.timeline.set_selection("")
        self.inspector.set_project(self.project, "")
        self.selected_media_id = media_id
        asset = self.project.asset(self.selected_media_id)
        if asset and not self._is_playing:
            self._preview_asset(asset)

    def _media_double_clicked(self, item):
        media_id = str(item.data(Qt.ItemDataRole.UserRole + 1) or "")
        self._add_media_to_timeline(media_id, self.timeline.playhead)

    def _media_context_menu(self, position):
        item = self.media_list.itemAt(position)
        if not item:
            return
        menu = QMenu(self)
        add_action = menu.addAction("Add to timeline at playhead")
        proxy_action = menu.addAction("Generate preview proxy…")
        show_action = menu.addAction("Show file in Explorer")
        remove_action = menu.addAction("Remove from project bin")
        action = menu.exec(self.media_list.mapToGlobal(position))
        asset_id = str(item.data(Qt.ItemDataRole.UserRole + 1) or "")
        asset = self.project.asset(asset_id)
        if action is add_action:
            self._add_media_to_timeline(asset_id, self.timeline.playhead)
        elif action is proxy_action and asset:
            if asset.kind != "video" or not asset.has_video:
                QMessageBox.information(self, "Video proxy", "Preview proxies are available for video media only.")
                return
            self.statusBar().showMessage(f"Generating proxy for {asset.name} in the background…", 4000)
            worker = Worker(lambda cancel, signals: create_proxy(
                asset.path, self._ffmpeg(), asset.duration,
                progress=lambda percent, text: signals.progress.emit(percent, text), cancel_event=cancel,
            ))
            worker.signals.result.connect(lambda path, media_id=asset_id: self._proxy_complete(media_id, path))
            worker.signals.error.connect(self._ai_error)
            worker.signals.progress.connect(lambda percent, text: self.statusBar().showMessage(text, 3000))
            self._launch_worker(worker)
        elif action is show_action and asset:
            if os.name == "nt":
                subprocess.Popen(["explorer", "/select,", asset.path])
            else:
                from PySide6.QtGui import QDesktopServices
                QDesktopServices.openUrl(QUrl.fromLocalFile(str(Path(asset.path).parent)))
        elif action is remove_action:
            self._remove_media(asset_id)

    def _remove_media(self, asset_id: str):
        if any(clip.media_id == asset_id for clip in self.project.clips):
            QMessageBox.warning(self, "Media is in use", "Remove clips using this media from the timeline before removing it from the project.")
            return
        before = self.project.to_dict()
        self.project.media.pop(asset_id, None)
        self.project.dirty = True
        self.selected_media_id = ""
        self._record_edit(before)
        self._refresh_media_bin()

    def _launch_worker(self, worker: Worker):
        self._workers.append(worker)
        worker.signals.finished.connect(lambda current=worker: self._worker_finished(current))
        from PySide6.QtCore import QThreadPool
        QThreadPool.globalInstance().start(worker)

    def _worker_finished(self, worker: Worker):
        try:
            self._workers.remove(worker)
        except ValueError:
            pass

    # ----- timeline edit operations -----
    def _refresh_timeline_and_inspector(self):
        self.timeline.set_project(self.project, self.selected_clip_id)
        self.inspector.set_project(self.project, self.selected_clip_id)
        self.timeline.set_playhead(self.timeline.playhead)
        self._update_title_overlays(self.timeline.playhead)
        self._update_window_title()

    def _refresh_all(self):
        self._refresh_media_bin()
        self.timeline.set_project(self.project, self.selected_clip_id)
        self.inspector.set_project(self.project, self.selected_clip_id)
        self.time_label.setText(_timecode(self.timeline.playhead, self.project.fps))
        self._update_title_overlays(self.timeline.playhead)
        self._update_window_title()
        self._update_ai_statuses()

    def _select_clip(self, clip_id: str):
        self.selected_clip_id = clip_id
        clip = self.project.clip(clip_id)
        self.inspector.set_project(self.project, clip_id)
        self.timeline.set_selection(clip_id)
        if clip:
            self.selected_media_id = clip.media_id
            self._refresh_media_selection()
            if not self._is_playing:
                self._sync_preview(max(clip.start, min(clip.end, self.timeline.playhead)), seek=True)

    def _refresh_media_selection(self):
        self.media_list.blockSignals(True)
        for index in range(self.media_list.count()):
            item = self.media_list.item(index)
            if str(item.data(Qt.ItemDataRole.UserRole + 1)) == self.selected_media_id:
                item.setSelected(True)
            else:
                item.setSelected(False)
        self.media_list.blockSignals(False)

    def _clip_moved(self, clip_id: str, start: float, track_id: str):
        before = self.project.to_dict()
        try:
            TimelineOperations.move(
                self.project, clip_id, start, track_id,
                snap=self.timeline.canvas.snap_enabled, playhead=self.timeline.playhead,
                pixels_per_second=self.timeline.pixels_per_second,
            )
            self.selected_clip_id = clip_id
            self._record_edit(before)
            self._sync_preview(self.timeline.playhead, seek=True)
        except TimelineError as exc:
            self.statusBar().showMessage(str(exc), 3500)
            self._refresh_timeline_and_inspector()

    def _clips_dropped(self, paths: list[str], start: float, track_id: str):
        for offset, path in enumerate(paths):
            self.import_files([path], drop=(start + offset * 0.15, track_id))

    def _add_media_to_timeline(self, media_id: str, start: float, track_id: str | None = None):
        before = self.project.to_dict()
        try:
            clip = TimelineOperations.add_media_clip(self.project, media_id, track_id, start)
            self.selected_clip_id = clip.id
            self.selected_media_id = media_id
            self._record_edit(before)
            self._sync_preview(start, seek=True)
            self.statusBar().showMessage(f"Added {self.project.clip_label(clip)} to the timeline", 2500)
        except TimelineError as exc:
            QMessageBox.information(self, "Cannot add clip", str(exc))

    def _timeline_action(self, operation: str, clip_id: str):
        if not clip_id:
            self.statusBar().showMessage("Select a timeline clip first", 2500)
            return
        before = self.project.to_dict()
        try:
            if operation == "split":
                right = TimelineOperations.split(self.project, clip_id, self.timeline.playhead)
                self.selected_clip_id = right.id
            elif operation == "duplicate":
                duplicate = TimelineOperations.duplicate(self.project, clip_id)
                self.selected_clip_id = duplicate.id
            elif operation == "delete":
                TimelineOperations.delete(self.project, clip_id, ripple=False)
                self.selected_clip_id = ""
            elif operation == "ripple_delete":
                TimelineOperations.delete(self.project, clip_id, ripple=True)
                self.selected_clip_id = ""
            self._record_edit(before)
            self._sync_preview(self.timeline.playhead, seek=True)
        except TimelineError as exc:
            QMessageBox.information(self, "Timeline edit", str(exc))

    def _clip_property_changed(self, name: str, value):
        clip = self.project.clip(self.selected_clip_id)
        if not clip:
            return
        before = self.project.to_dict()
        try:
            if name == "title":
                clip.title = str(value)
            elif name == "title_color":
                color = str(value).strip()
                if not color.startswith("#") or len(color) not in {4, 7}:
                    raise TimelineError("Text color must be a hex color such as #ffffff")
                clip.title_color = color
            elif name == "title_size":
                clip.title_size = int(value)
            elif name in {"start", "source_in", "source_out", "playback_rate", "opacity", "volume", "position_x", "position_y", "scale", "rotation", "fade_in", "fade_out"}:
                number = float(value)
                if name == "start":
                    clip.start = max(0.0, number)
                elif name == "source_in":
                    clip.source_in = max(0.0, min(number, clip.source_out - 1.0 / self.project.fps))
                elif name == "source_out":
                    asset = self.project.asset(clip.media_id) if clip.type != "title" else None
                    maximum = asset.duration if asset and asset.duration > 0 else float("inf")
                    clip.source_out = min(maximum, max(clip.source_in + 1.0 / self.project.fps, number))
                else:
                    setattr(clip, name, number)
                if clip.type != "title":
                    asset = self.project.asset(clip.media_id)
                    if asset and asset.duration > 0:
                        clip.source_out = min(clip.source_out, asset.duration)
            elif name in {"brightness", "contrast", "saturation", "bass_db", "treble_db", "denoise_strength", "denoise", "chroma_key"}:
                clip.effects[name] = bool(value) if name in {"denoise", "chroma_key"} else float(value)
            elif name in {"crop_left", "crop_top", "crop_width", "crop_height"}:
                crop = dict(clip.effects.get("crop", {"left": 0.0, "top": 0.0, "width": 1.0, "height": 1.0}))
                component = {"crop_left": "left", "crop_top": "top", "crop_width": "width", "crop_height": "height"}[name]
                crop[component] = float(value)
                crop["left"] = min(0.95, max(0.0, float(crop.get("left", 0.0))))
                crop["top"] = min(0.95, max(0.0, float(crop.get("top", 0.0))))
                crop["width"] = min(1.0 - crop["left"], max(0.05, float(crop.get("width", 1.0))))
                crop["height"] = min(1.0 - crop["top"], max(0.05, float(crop.get("height", 1.0))))
                clip.effects["crop"] = crop
            elif name == "chroma_color":
                color = str(value).strip()
                if color.startswith("#") and len(color) in {4, 7}:
                    clip.effects["chroma_color"] = color
                else:
                    raise TimelineError("Chroma key color must be a hex color such as #00ff00")
            elif name == "lut_path":
                lut_path = str(value).strip()
                if lut_path and (Path(lut_path).suffix.lower() != ".cube" or not Path(lut_path).is_file()):
                    raise TimelineError("Choose an existing .cube LUT file")
                clip.effects["lut_path"] = lut_path
            else:
                return
            self.project.dirty = True
            self._record_edit(before, refresh=False)
            self.timeline.set_project(self.project, clip.id)
            self.inspector.set_project(self.project, clip.id)
            self._sync_preview(self.timeline.playhead, seek=True)
        except (TimelineError, ValueError) as exc:
            QMessageBox.information(self, "Invalid clip property", str(exc))
            self.inspector.set_project(self.project, clip.id)

    def _add_track(self, kind: str):
        before = self.project.to_dict()
        track = TimelineOperations.add_track(self.project, kind)
        self._record_edit(before)
        self.statusBar().showMessage(f"Added {track.name}", 2500)

    def _track_action(self, track_id: str, action: str):
        track = self.project.track(track_id)
        if not track:
            return
        before = self.project.to_dict()
        if action == "lock":
            track.locked = not track.locked
        elif action == "mute":
            if track.kind == "audio":
                track.muted = not track.muted
            else:
                track.visible = not track.visible
        self.project.dirty = True
        self._record_edit(before)

    def _add_marker(self, seconds: float, name: str | None = None):
        if name is None:
            name, ok = QInputDialog.getText(self, "Add timeline marker", "Marker name:", text="Marker")
            if not ok:
                return
        before = self.project.to_dict()
        TimelineOperations.add_marker(self.project, seconds, name)
        self._record_edit(before)
        self.statusBar().showMessage(f"Marker added at {seconds:.2f}s", 2200)

    def add_title_dialog(self):
        text, ok = QInputDialog.getText(self, "Add title overlay", "Title text:", text="Your title")
        if not ok or not text.strip():
            return
        duration, ok = QInputDialog.getDouble(self, "Title duration", "Duration (seconds):", 5.0, 0.1, 600, 1)
        if not ok:
            return
        before = self.project.to_dict()
        try:
            clip = TimelineOperations.add_title(self.project, text, start=self.timeline.playhead, duration=duration)
            self.selected_clip_id = clip.id
            self._record_edit(before)
        except TimelineError as exc:
            QMessageBox.warning(self, "Cannot add title", str(exc))

    # ----- preview and transport -----
    def _update_title_overlays(self, seconds: float):
        """Show active editable text clips over the source-preview surface.

        This is a lightweight title preview, not a live compositor: visual effects
        and other video tracks are evaluated by the FFmpeg export graph.
        """
        if not hasattr(self, "preview_overlay_labels"):
            return
        active = []
        order = {track.id: index for index, track in enumerate(self.project.tracks)}
        for clip in self.project.clips:
            track = self.project.track(clip.track_id)
            if clip.type == "title" and track and track.visible and clip.start <= seconds < clip.end:
                active.append((order.get(track.id, 999), clip))
        active.sort(key=lambda item: (item[0], item[1].start))
        while len(self.preview_overlay_labels) < len(active):
            label = QLabel(self.preview_frame)
            label.setAttribute(Qt.WidgetAttribute.WA_TransparentForMouseEvents)
            label.setAttribute(Qt.WidgetAttribute.WA_TranslucentBackground)
            label.setAlignment(Qt.AlignmentFlag.AlignCenter)
            label.setWordWrap(True)
            self.preview_overlay_labels.append(label)
        scale = min(
            self.preview_frame.width() / max(1, self.project.width),
            self.preview_frame.height() / max(1, self.project.height),
        )
        display_width = max(80, int(self.project.width * scale * 0.92))
        offset_x = (self.preview_frame.width() - self.project.width * scale) / 2
        offset_y = (self.preview_frame.height() - self.project.height * scale) / 2
        for index, (_, clip) in enumerate(active):
            label = self.preview_overlay_labels[index]
            color = QColor(clip.title_color)
            if not color.isValid():
                color = QColor("#ffffff")
            alpha = clip.opacity
            local_time = seconds - clip.start
            if clip.fade_in > 0:
                alpha *= min(1.0, max(0.0, local_time / clip.fade_in))
            if clip.fade_out > 0:
                alpha *= min(1.0, max(0.0, (clip.end - seconds) / clip.fade_out))
            rgb = [color.red(), color.green(), color.blue()]
            font = QFont("Segoe UI")
            font.setPixelSize(max(12, round(clip.title_size * scale)))
            font.setBold(True)
            label.setFont(font)
            label.setText(clip.title)
            label.setStyleSheet(
                f"QLabel {{ color: rgba({rgb[0]}, {rgb[1]}, {rgb[2]}, {round(alpha * 255)}); "
                "background: transparent; padding: 4px; text-shadow: 1px 1px 2px #000000; }"
            )
            label.setFixedWidth(display_width)
            label.adjustSize()
            center_x = offset_x + (self.project.width / 2 + clip.position_x) * scale
            center_y = offset_y + (self.project.height / 2 + clip.position_y) * scale
            label.move(round(center_x - label.width() / 2), round(center_y - label.height() / 2))
            label.show()
            label.raise_()
        for label in self.preview_overlay_labels[len(active):]:
            label.hide()

    def _preview_path(self, asset: MediaAsset) -> str:
        if self.use_proxies_checkbox.isChecked() and asset.proxy_path and Path(asset.proxy_path).is_file():
            return asset.proxy_path
        return asset.path

    def _proxy_preview_toggled(self, enabled: bool):
        self.settings.setValue("preview/use_proxies", enabled)
        clip = self.project.clip(self.selected_clip_id)
        if clip and clip.type != "title":
            self._current_preview_clip = ""
            self._sync_preview(self.timeline.playhead, seek=True)
        elif self.selected_media_id:
            asset = self.project.asset(self.selected_media_id)
            if asset:
                self._preview_asset(asset)

    def _preview_asset(self, asset: MediaAsset):
        if asset.kind == "image":
            self._stop_playback()
            pixmap = QPixmap(asset.path)
            if pixmap.isNull():
                self.preview_placeholder.setText("Image could not be decoded")
                self.preview_stack.setCurrentWidget(self.preview_placeholder)
                return
            self.image_preview.setPixmap(pixmap.scaled(self.preview_frame.size(), Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
            self.preview_stack.setCurrentWidget(self.image_preview)
            self.preview_info.setText(f"{asset.name} · still image")
            self._preview_standalone = True
            self._current_preview_clip = ""
            self._update_title_overlays(-1)
            return
        if not asset.path or not Path(asset.path).exists():
            self.preview_placeholder.setText(f"Missing media: {asset.name}")
            self.preview_stack.setCurrentWidget(self.preview_placeholder)
            return
        self.preview_stack.setCurrentWidget(self.video_widget)
        self._preview_standalone = True
        self._current_preview_clip = ""
        self.player.pause()
        self.player.setSource(QUrl.fromLocalFile(self._preview_path(asset)))
        self.player.setPlaybackRate(self._transport_speed)
        proxy_note = " · proxy" if self._preview_path(asset) != asset.path else ""
        self.preview_info.setText(f"Source preview{proxy_note} · {asset.name} · timeline export composites all tracks")
        self._update_title_overlays(-1)

    def _active_preview_clip(self, seconds: float) -> Clip | None:
        for clip in self.project.active_video_clips(seconds):
            if clip.type != "title":
                asset = self.project.asset(clip.media_id)
                if asset and asset.kind == "video":
                    return clip
                if asset and asset.kind == "image":
                    # Images are displayed directly, even if a video under them exists.
                    return clip
        return None

    def _sync_preview(self, seconds: float, seek: bool = False):
        clip = self._active_preview_clip(seconds)
        if clip is None:
            if self._is_playing:
                audio_clip = next((c for c in self.project.clips if c.type != "title" and c.start <= seconds < c.end
                                   and (asset := self.project.asset(c.media_id)) and asset.kind == "audio"), None)
                clip = audio_clip
        if clip is None:
            self.player.pause()
            if not self._is_playing:
                self.preview_info.setText("No active clip at playhead · final render composites all tracks")
                self.preview_placeholder.setText("No active media at this time\nMove the playhead over a clip to preview")
                self.preview_stack.setCurrentWidget(self.preview_placeholder)
            self._current_preview_clip = ""
            self._update_title_overlays(seconds)
            return
        asset = self.project.asset(clip.media_id)
        if not asset:
            return
        if asset.kind == "image":
            self.player.pause()
            self.image_preview.setPixmap(QPixmap(asset.path).scaled(self.preview_frame.size(), Qt.AspectRatioMode.KeepAspectRatio, Qt.TransformationMode.SmoothTransformation))
            self.preview_stack.setCurrentWidget(self.image_preview)
            self._current_preview_clip = clip.id
            self._preview_standalone = False
            self.preview_info.setText(f"{asset.name} · image clip · transform controls are editable")
            self._update_title_overlays(seconds)
            return
        self.preview_stack.setCurrentWidget(self.video_widget)
        self._preview_standalone = False
        changed = self._current_preview_clip != clip.id
        if changed:
            self.player.pause()
            self.player.setSource(QUrl.fromLocalFile(self._preview_path(asset)))
            self._current_preview_clip = clip.id
            self.player.setPlaybackRate(clip.playback_rate * self._transport_speed)
            self.preview_info.setText(f"{asset.name} · active clip preview · multi-track composite appears on export")
            self._pending_seek = clip.source_in + max(0.0, seconds - clip.start) * clip.playback_rate
            QTimer.singleShot(180, self._apply_pending_seek)
            if self._is_playing:
                self.player.play()
        elif seek:
            target = clip.source_in + max(0.0, seconds - clip.start) * clip.playback_rate
            self.player.setPosition(max(0, int(target * 1000)))
            self.player.setPlaybackRate(clip.playback_rate * self._transport_speed)
            if self._is_playing:
                self.player.play()
        self._update_title_overlays(seconds)

    def _apply_pending_seek(self):
        clip = self.project.clip(self._current_preview_clip)
        if clip:
            self.player.setPosition(max(0, int(self._pending_seek * 1000)))
            self.player.setPlaybackRate(clip.playback_rate * self._transport_speed)
            if self._is_playing:
                self.player.play()

    def _playhead_changed(self, seconds: float):
        self.time_label.setText(_timecode(seconds, self.project.fps))
        self._sync_preview(seconds, seek=True)

    def _player_position_changed(self, milliseconds: int):
        if not self._is_playing or self._preview_standalone:
            return
        clip = self.project.clip(self._current_preview_clip)
        if not clip:
            return
        source_time = milliseconds / 1000.0
        timeline_time = clip.start + (source_time - clip.source_in) / max(0.01, clip.playback_rate)
        if clip.start <= timeline_time <= clip.end + 0.03:
            self.timeline.set_playhead(timeline_time)
            self.time_label.setText(_timecode(timeline_time, self.project.fps))
            self._update_title_overlays(timeline_time)

    def _playback_state_changed(self, state):
        playing = state == QMediaPlayer.PlaybackState.PlayingState
        if self._is_playing and not playing and not self._preview_standalone:
            # A source can finish before the project if the clip is trimmed.
            QTimer.singleShot(80, self._advance_if_needed)
        if not self._is_playing:
            self.btn_play.setText("▶")

    def _media_status_changed(self, status):
        if status == QMediaPlayer.MediaStatus.LoadedMedia and self._is_playing:
            self._apply_pending_seek()

    def _player_error(self, error, message):
        if error != QMediaPlayer.Error.NoError:
            LOG.warning("Qt Multimedia preview error %s: %s", error, message)
            self.statusBar().showMessage(f"Preview backend: {message or 'unsupported media or missing system codec'}", 6000)
            self.preview_info.setText("Preview backend could not decode this media; export uses FFmpeg")

    def _advance_if_needed(self):
        if not self._is_playing:
            return
        current = self.project.clip(self._current_preview_clip)
        if current and self.timeline.playhead >= current.end - 0.03:
            next_clip = min((clip for clip in self.project.clips if clip.type != "title" and clip.start >= current.end - 0.001),
                            key=lambda clip: clip.start, default=None)
            if next_clip:
                self.timeline.set_playhead(next_clip.start, notify=True)
                self._sync_preview(next_clip.start, seek=True)
            elif self.timeline.playhead >= self.project.duration - 0.03:
                self._stop_playback()

    def toggle_play(self):
        if self._is_playing:
            self._stop_playback()
            return
        if self.project.duration <= 0:
            asset = self.project.asset(self.selected_media_id)
            if asset and asset.kind != "image":
                self._preview_asset(asset)
                self._preview_standalone = True
                self._is_playing = True
                self.player.play()
                self.btn_play.setText("Ⅱ")
            else:
                self.statusBar().showMessage("Add a clip to the timeline before playback", 2500)
            return
        self._is_playing = True
        self._last_tick = time.monotonic()
        self.btn_play.setText("Ⅱ")
        self._preview_standalone = False
        self._sync_preview(self.timeline.playhead, seek=True)
        self.play_timer.start()
        if self._current_preview_clip:
            clip = self.project.clip(self._current_preview_clip)
            asset = self.project.asset(clip.media_id) if clip else None
            if asset and asset.kind != "image":
                self.player.play()

    def _stop_playback(self):
        self._is_playing = False
        self.play_timer.stop()
        self.player.pause()
        self.btn_play.setText("▶")

    def _playback_tick(self):
        if not self._is_playing:
            return
        now = time.monotonic()
        delta = min(0.2, max(0.0, now - self._last_tick))
        self._last_tick = now
        current = self.project.clip(self._current_preview_clip)
        if not current or current.type == "title":
            self._sync_preview(self.timeline.playhead, seek=True)
            current = self.project.clip(self._current_preview_clip)
        if current and current.type != "title":
            asset = self.project.asset(current.media_id)
            if asset and asset.kind == "image":
                new_time = self.timeline.playhead + delta * self._transport_speed
                if new_time >= current.end:
                    self._advance_if_needed()
                else:
                    self.timeline.set_playhead(new_time, notify=True)
        elif not current:
            self.timeline.set_playhead(self.timeline.playhead + delta * self._transport_speed, notify=True)
        if self.timeline.playhead >= self.project.duration - 0.02:
            self._stop_playback()

    def _step_frame(self, direction: int):
        self._stop_playback()
        next_time = max(0.0, self.timeline.playhead + direction / max(1.0, self.project.fps))
        self.timeline.set_playhead(next_time, notify=True)

    def _speed_changed(self, _index: int):
        self._transport_speed = float(self.speed_combo.currentData() or 1.0)
        clip = self.project.clip(self._current_preview_clip)
        if clip:
            self.player.setPlaybackRate(clip.playback_rate * self._transport_speed)

    # ----- project and view dialogs -----
    def project_settings_dialog(self):
        dialog = ProjectSettingsDialog(self.project, self)
        if dialog.exec() != QDialog.DialogCode.Accepted:
            return
        before = self.project.to_dict()
        self.project.name = dialog.name.text().strip() or "Untitled"
        self.project.width = dialog.width_box.value()
        self.project.height = dialog.height_box.value()
        self.project.fps = dialog.fps_box.value()
        self.project.dirty = True
        self._record_edit(before)

    def configure_paths(self):
        menu = QMenu(self)
        ffmpeg_action = menu.addAction("Choose FFmpeg executable…")
        whisper_action = menu.addAction("Choose whisper-cli executable…")
        action = menu.exec(self.cursor().pos())
        if action is ffmpeg_action:
            path, _ = QFileDialog.getOpenFileName(self, "Select FFmpeg executable", str(Path.home()), "Executable (ffmpeg.exe ffmpeg);;All files (*)")
            if path:
                self.ffmpeg_path = path
                self.settings.setValue("ffmpeg/path", path)
                self.statusBar().showMessage(f"FFmpeg set to {path}", 3000)
                self._update_ai_statuses()
        elif action is whisper_action:
            path, _ = QFileDialog.getOpenFileName(self, "Select Whisper.cpp CLI", str(Path.home()), "whisper-cli (whisper-cli.exe whisper-cli main.exe main);;All files (*)")
            if path:
                self.whisper_cli = path
                self.settings.setValue("whisper/cli", path)
                self._update_ai_statuses()

    def open_model_manager(self):
        dialog = ModelManagerDialog(self)
        dialog.exec()
        self._update_ai_statuses()

    def export_dialog(self):
        dialog = ExportDialog(self.project, self._ffmpeg(), self)
        dialog.exec()
        self._update_ai_statuses()

    def export_subtitles_dialog(self, fmt: str):
        if not any(clip.type == "title" for clip in self.project.clips):
            QMessageBox.information(self, "No subtitles", "The timeline has no title/subtitle clips to export.")
            return
        path, _ = QFileDialog.getSaveFileName(self, f"Export {fmt.upper()} subtitles", str(Path.home() / f"{self.project.name}.{fmt}"), f"{fmt.upper()} subtitles (*.{fmt})")
        if not path:
            return
        if Path(path).suffix.lower() != f".{fmt}":
            path += f".{fmt}"
        try:
            export_subtitles(self.project, path, fmt)
            self.statusBar().showMessage(f"Subtitles saved to {path}", 3500)
        except Exception as exc:
            QMessageBox.critical(self, "Subtitle export failed", str(exc))

    def about(self):
        QMessageBox.about(
            self, "About NovaCut AI Studio",
            "<b>NovaCut AI Studio</b><br>Local-first, non-destructive video editing prototype.<br><br>"
            "Timeline and project data are editable. FFmpeg, Qt Multimedia codecs, and AI models are optional local dependencies. "
            "The preview shows the active source clip; the export engine composites enabled tracks.\n\n"
            f"Application log: {self._log_path}",
        )

    # ----- AI Studio -----
    def _ffmpeg(self) -> str:
        return find_ffmpeg(self.ffmpeg_path) or ""

    def _update_ai_statuses(self):
        ffmpeg = self._ffmpeg()
        if ffmpeg:
            self.ai_page.set_status("silence", "Ready · local FFmpeg analysis")
            self.ai_page.set_status("scenes", "Ready · local FFmpeg scene filter")
            self.ai_page.set_status("cleanup", "Ready · FFmpeg afftdn + EQ at export")
        else:
            self.ai_page.set_status("silence", "Unavailable · install/select FFmpeg")
            self.ai_page.set_status("scenes", "Unavailable · install/select FFmpeg")
            self.ai_page.set_status("cleanup", "Unavailable · FFmpeg not found")
        whisper_ready, whisper_message, _ = whisper_availability(self.whisper_cli)
        self.ai_page.set_status("subtitles", ("Ready · " if whisper_ready else "Unavailable · ") + whisper_message)
        rembg_available = importlib.util.find_spec("rembg") is not None and importlib.util.find_spec("PIL") is not None
        model_present = model_path("u2net").is_file()
        if rembg_available and model_present:
            self.ai_page.set_status("background", "Ready · local U²-Net, still images only")
        elif not rembg_available:
            self.ai_page.set_status("background", "Unavailable · optional rembg/Pillow packages missing")
        else:
            self.ai_page.set_status("background", "Unavailable · local U²-Net model not installed")
        self.ai_page.set_status("reframe", "Manual centered crop only · no subject tracking model")
        demucs_ready, demucs_status = self._demucs_status()
        self.ai_page.set_status("separation", "Ready · local Demucs" if demucs_ready else f"Unavailable · {demucs_status}")

    def _demucs_status(self) -> tuple[bool, str]:
        if importlib.util.find_spec("demucs") is None:
            return False, "optional Demucs package missing"
        try:
            from demucs.pretrained import MODEL_URLS
            import torch
            url = MODEL_URLS.get("htdemucs")
            filename = Path(url).name if url else ""
            checkpoint = Path(torch.hub.get_dir()) / "checkpoints" / filename
            if checkpoint.is_file():
                return True, str(checkpoint)
        except Exception:
            pass
        return False, "no htdemucs checkpoint in the local cache"

    def _workspace_changed(self, index: int):
        if self.editor_tabs.widget(index) == self.ai_page:
            self._update_ai_statuses()
            self._start_assistant_model_check()

    def _start_assistant_model_check(self):
        self.ai_page.set_status("assistant", "Checking local Ollama on this computer…")
        worker = Worker(lambda cancel, signals: ollama_models())
        worker.signals.result.connect(self._assistant_models_received)
        worker.signals.error.connect(self._assistant_models_failed)
        self._launch_worker(worker)

    def _assistant_models_received(self, models: list[str]):
        self.ai_page.set_models(models)
        self.ai_page.set_status("assistant", f"Ready · {len(models)} local model(s) on loopback" if models else "Unavailable · Ollama has no installed local models")

    def _assistant_models_failed(self, message: str):
        self.ai_page.set_models([])
        self.ai_page.set_status("assistant", "Unavailable · Ollama not responding on loopback")
        LOG.info("Ollama check: %s", _short_error(message))

    def _assistant_request(self, question: str, model: str):
        summary = (
            f"name={self.project.name}, resolution={self.project.width}x{self.project.height}, fps={self.project.fps:g}, "
            f"duration={self.project.duration:.2f}s, tracks={len(self.project.tracks)}, clips={len(self.project.clips)}, "
            f"media={len(self.project.media)}"
        )
        self.ai_page.set_status("assistant", "Running local inference… (suggestions only)")
        worker = Worker(lambda cancel, signals: ask_local_ollama(question, model, summary, cancel_event=cancel))
        worker.signals.result.connect(self.ai_page.set_assistant_answer)
        worker.signals.error.connect(lambda message: self.ai_page.set_assistant_answer("Local assistant unavailable:\n" + _short_error(message)))
        worker.signals.finished.connect(lambda: self.ai_page.set_status("assistant", "Local response complete · no timeline edits were made"))
        self._launch_worker(worker)

    def _selected_clip_and_asset(self) -> tuple[Clip | None, MediaAsset | None]:
        clip = self.project.clip(self.selected_clip_id)
        if clip and clip.type != "title":
            return clip, self.project.asset(clip.media_id)
        asset = self.project.asset(self.selected_media_id)
        return None, asset

    def _ai_tool_requested(self, tool: str):
        clip, asset = self._selected_clip_and_asset()
        if tool in {"silence", "scenes", "subtitles", "background", "separation", "cleanup", "reframe"} and not asset and tool not in {"reframe"}:
            QMessageBox.information(self, "Select media", "Select a media item or timeline clip first.")
            return
        if tool == "silence":
            if not asset.has_audio:
                QMessageBox.information(self, "No audio", "The selected media has no detected audio stream.")
                return
            self._silence_clip_id = clip.id if clip else ""
            self.ai_page.analysis_status.setText("Analyzing audio locally. This may take a few moments…")
            noise, ok = QInputDialog.getDouble(self, "Silence threshold", "Noise threshold (dB):", -35.0, -90.0, 0.0, 1)
            if not ok:
                return
            min_silence, ok = QInputDialog.getDouble(self, "Minimum silence", "Minimum interval (seconds):", 0.5, 0.05, 120.0, 2)
            if not ok:
                return
            worker = Worker(lambda cancel, signals: detect_silence(asset.path, self._ffmpeg(), noise, min_silence, asset.duration, cancel))
            worker.signals.result.connect(self._silence_analysis_complete)
            worker.signals.error.connect(self._ai_error)
            self._launch_worker(worker)
        elif tool == "scenes":
            if not asset.has_video:
                QMessageBox.information(self, "No video", "Scene detection requires a video stream.")
                return
            self._scene_clip_id = clip.id if clip else ""
            threshold, ok = QInputDialog.getDouble(self, "Scene threshold", "Sensitivity (lower = more cuts):", 0.35, 0.05, 0.95, 2)
            if not ok:
                return
            self.ai_page.analysis_status.setText("Analyzing video locally…")
            worker = Worker(lambda cancel, signals: detect_scenes(asset.path, self._ffmpeg(), threshold, cancel))
            worker.signals.result.connect(self._scene_analysis_complete)
            worker.signals.error.connect(self._ai_error)
            self._launch_worker(worker)
        elif tool == "subtitles":
            size = str(self.ai_page.whisper_size.currentData())
            selected_model = model_path(f"whisper-{size}")
            cli = find_whisper_cli(self.whisper_cli)
            if not cli:
                QMessageBox.information(self, "Whisper unavailable", "whisper-cli was not found. Install Whisper.cpp separately and select its executable in File → FFmpeg / AI Paths…")
                return
            if not selected_model.is_file():
                QMessageBox.information(self, "Whisper model missing", f"The {size} model is not installed. Open Local Model Manager and explicitly download it first.")
                return
            if not asset.has_audio:
                QMessageBox.information(self, "No audio", "The selected media has no detected audio stream.")
                return
            self.ai_page.analysis_status.setText("Transcribing locally · no upload or remote API…")
            worker = Worker(lambda cancel, signals: transcribe_local(asset, size, self._ffmpeg(), self.whisper_cli,
                                                                    progress=signals.message.emit, cancel_event=cancel))
            worker.signals.result.connect(lambda result: self._transcription_complete(result, clip))
            worker.signals.error.connect(self._ai_error)
            worker.signals.message.connect(lambda message: self.statusBar().showMessage(message, 3000))
            self._launch_worker(worker)
        elif tool == "background":
            if not asset or asset.kind != "image":
                QMessageBox.information(self, "Still image required", "Background removal is currently implemented for still-image media only.")
                return
            output_dir = Path(asset.path).parent / "NovaCut Exports"
            output_path = output_dir / f"{Path(asset.path).stem}-background-removed.png"
            worker = Worker(lambda cancel, signals: background_remove_image(asset, output_path,
                                                                            progress=signals.message.emit))
            worker.signals.result.connect(self._background_remove_complete)
            worker.signals.error.connect(self._ai_error)
            worker.signals.message.connect(lambda message: self.statusBar().showMessage(message, 5000))
            self._launch_worker(worker)
        elif tool == "separation":
            ready, why = self._demucs_status()
            if not ready:
                QMessageBox.information(self, "Audio separation unavailable",
                                        why + "\n\nInstall Demucs and its checkpoint explicitly, then retry. NovaCut will not fetch model weights automatically.")
                return
            if not asset or not asset.has_audio:
                QMessageBox.information(self, "Audio required", "Choose a media item with audio.")
                return
            output_dir = Path(asset.path).parent / "NovaCut Exports"
            worker = Worker(lambda cancel, signals: self._run_demucs(asset.path, output_dir, cancel, signals))
            worker.signals.result.connect(lambda path: self._analysis_message(f"Vocal/accompaniment stems saved in {path}"))
            worker.signals.error.connect(self._ai_error)
            self._launch_worker(worker)
        elif tool == "cleanup":
            if not clip:
                QMessageBox.information(self, "Select a timeline clip", "Add/select an audio or video clip on the timeline to apply denoising.")
                return
            before = self.project.to_dict()
            clip.effects["denoise"] = not bool(clip.effects.get("denoise"))
            clip.effects.setdefault("denoise_strength", 18.0)
            clip.effects.setdefault("bass_db", 0.0)
            clip.effects.setdefault("treble_db", 0.0)
            self.project.dirty = True
            self._record_edit(before)
            self.statusBar().showMessage("FFmpeg local denoise toggled. Review the exported result; preview does not process audio effects.", 5500)
        elif tool == "reframe":
            self._suggest_vertical_reframe(clip, asset)

    def _silence_analysis_complete(self, intervals):
        self.ai_page.show_silences(intervals)
        self._silence_proposals = list(intervals)
        if not intervals:
            self.ai_page.analysis_status.setText("No silence intervals matched the selected threshold.")

    def _scene_analysis_complete(self, times):
        self.ai_page.show_scenes(times)
        self._scene_proposals = list(times)
        if not times:
            self.ai_page.analysis_status.setText("No scene boundaries matched this threshold.")

    def _ai_error(self, message: str):
        clean = _short_error(message)
        LOG.error("AI/local analysis error: %s", message)
        self.ai_page.analysis_status.setText("The local task could not be completed.")
        QMessageBox.warning(self, "Local tool unavailable or failed", clean[:2500])

    def _apply_silence_proposals(self):
        clip_id = self._silence_clip_id
        proposals = self.ai_page.selected_proposals()
        if not clip_id:
            QMessageBox.information(self, "No timeline clip", "Silence analysis was run on media-bin content. Select a timeline clip and analyze again to apply cuts.")
            return
        if not proposals:
            return
        answer = QMessageBox.question(self, "Apply proposed cuts?",
                                      f"Remove {len(proposals)} selected silent interval(s) from the clip and ripple-close that track? This edit is undoable.",
                                      QMessageBox.StandardButton.Apply | QMessageBox.StandardButton.Cancel,
                                      QMessageBox.StandardButton.Cancel)
        if answer != QMessageBox.StandardButton.Apply:
            return
        before = self.project.to_dict()
        try:
            segments = TimelineOperations.apply_silence_cuts(self.project, clip_id, proposals)
            self.selected_clip_id = segments[0].id
            self._record_edit(before)
            self.statusBar().showMessage(f"Applied {len(proposals)} silence cut(s) · Ctrl+Z to undo", 4000)
        except TimelineError as exc:
            QMessageBox.warning(self, "Could not apply cuts", str(exc))

    def _apply_scene_markers(self):
        proposals = self.ai_page.selected_proposals()
        if not proposals:
            return
        clip = self.project.clip(self._scene_clip_id)
        before = self.project.to_dict()
        for value in proposals:
            if clip:
                timeline_time = clip.start + (float(value) - clip.source_in) / clip.playback_rate
            else:
                timeline_time = float(value)
            if timeline_time >= 0:
                TimelineOperations.add_marker(self.project, timeline_time, "Scene")
        self._record_edit(before)
        self.statusBar().showMessage(f"Added {len(proposals)} scene marker(s) · review before editing", 3500)

    def _split_at_scenes(self):
        proposals = self.ai_page.selected_proposals()
        clip = self.project.clip(self._scene_clip_id)
        if not clip or clip.type == "title":
            QMessageBox.information(self, "Select a timeline clip", "Scene analysis must be run from a selected timeline video clip to create subclips.")
            return
        values = sorted(set(float(value) for value in proposals), reverse=True)
        before = self.project.to_dict()
        try:
            for source_time in values:
                timeline_time = clip.start + (source_time - clip.source_in) / clip.playback_rate
                if clip.start + 1 / self.project.fps < timeline_time < clip.end - 1 / self.project.fps:
                    TimelineOperations.split(self.project, clip.id, timeline_time)
            self._record_edit(before)
            self.statusBar().showMessage("Scene boundaries split into editable clips. Review the result.", 4000)
        except TimelineError as exc:
            QMessageBox.warning(self, "Scene split failed", str(exc))

    def _transcription_complete(self, segments: list[SubtitleSegment], clip: Clip | None):
        if not segments:
            self.ai_page.analysis_status.setText("Whisper returned no subtitle segments.")
            return
        answer = QMessageBox.question(self, "Import subtitles?",
                                      f"Whisper created {len(segments)} editable subtitle segment(s). Add them as title clips on the top video track?",
                                      QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.Cancel,
                                      QMessageBox.StandardButton.Yes)
        if answer != QMessageBox.StandardButton.Yes:
            self.ai_page.analysis_status.setText("Subtitles were not added to the timeline.")
            return
        video_tracks = [track for track in self.project.tracks if track.kind == "video" and not track.locked]
        if not video_tracks:
            QMessageBox.warning(self, "No unlocked video track", "Unlock or add a video track to place subtitles.")
            return
        target_track = video_tracks[0]
        before = self.project.to_dict()
        count = 0
        for segment in segments:
            left, right = segment.start, segment.end
            if clip:
                left = max(left, clip.source_in)
                right = min(right, clip.source_out)
                if right <= left:
                    continue
                timeline_start = clip.start + (left - clip.source_in) / clip.playback_rate
                duration = (right - left) / clip.playback_rate
            else:
                timeline_start, duration = left, right - left
            title = TimelineOperations.add_title(self.project, segment.text, target_track.id, timeline_start, duration)
            title.title_size = max(24, min(72, int(self.project.height * 0.045)))
            title.position_y = self.project.height * 0.35
            title.effects["subtitle"] = True
            count += 1
        if count:
            self.selected_clip_id = self.project.clips[-1].id
            self._record_edit(before)
            self.ai_page.analysis_status.setText(f"Imported {count} editable subtitle title clip(s). Export the complete timeline or subtitles as SRT/VTT.")
        else:
            self.ai_page.analysis_status.setText("No Whisper segments overlapped the selected clip range.")

    def _background_remove_complete(self, path):
        self.ai_page.analysis_status.setText(f"Transparent PNG saved locally: {path}")
        answer = QMessageBox.question(self, "Import result?", f"Background-removed image saved at:\n{path}\n\nAdd it to the project media bin?",
                                      QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                                      QMessageBox.StandardButton.Yes)
        if answer == QMessageBox.StandardButton.Yes:
            self.import_files([str(path)])

    def _suggest_vertical_reframe(self, clip: Clip | None, asset: MediaAsset | None):
        if not clip or not asset or asset.kind not in {"video", "image"}:
            QMessageBox.information(self, "Select a visual timeline clip", "Select a video or image clip first. Subject tracking is not available; this tool creates a centered, editable crop suggestion only.")
            return
        answer = QMessageBox.question(
            self, "Create vertical framing suggestion?",
            "This changes the project canvas to 1080 × 1920 and scales the selected clip for a centered crop. It does not detect or track a subject; review and adjust position manually. Continue?",
            QMessageBox.StandardButton.Apply | QMessageBox.StandardButton.Cancel,
            QMessageBox.StandardButton.Cancel,
        )
        if answer != QMessageBox.StandardButton.Apply:
            return
        before = self.project.to_dict()
        self.project.width, self.project.height = 1080, 1920
        if asset.width and asset.height:
            fit_height = min(1080 / asset.width, 1920 / asset.height) * asset.height
            clip.scale = min(8.0, max(1.0, 1920 / max(1.0, fit_height)))
        clip.position_x = 0
        clip.position_y = 0
        self.project.dirty = True
        self._record_edit(before)
        self.ai_page.analysis_status.setText("Centered 9:16 crop suggestion applied as editable project/clip transforms. Subject tracking is unavailable; adjust position manually.")

    @staticmethod
    def _run_demucs(media_path: str, output_dir: Path, cancel_event, signals):
        output_dir.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        try:
            import torch
            from demucs.pretrained import MODEL_URLS
            url = MODEL_URLS.get("htdemucs")
            if not url:
                raise RuntimeError("The installed Demucs package has no htdemucs model metadata")
            checkpoint = Path(torch.hub.get_dir()) / "checkpoints" / Path(url).name
            if not checkpoint.is_file():
                raise RuntimeError("The local htdemucs checkpoint is missing; refusing an automatic model download")
        except ImportError as exc:
            raise RuntimeError("Demucs and PyTorch are not installed") from exc
        command = [sys.executable, "-m", "demucs.separate", "-n", "htdemucs", "-o", str(output_dir), media_path]
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, errors="replace", env=env)
        log = []
        while True:
            if cancel_event.is_set():
                process.terminate()
                try:
                    process.wait(timeout=4)
                except subprocess.TimeoutExpired:
                    process.kill()
                raise InterruptedError("Audio separation cancelled")
            line = process.stdout.readline() if process.stdout else ""
            if line:
                log.append(line.rstrip())
                signals.message.emit(line.rstrip()[-250:])
            elif process.poll() is not None:
                break
            else:
                time.sleep(0.05)
        code = process.wait()
        if code:
            raise RuntimeError("Demucs failed:\n" + "\n".join(log[-25:]))
        return str(output_dir)

    def _analysis_message(self, text: str):
        self.ai_page.analysis_status.setText(text)
        QMessageBox.information(self, "Local AI task complete", text)

    # ----- project/browser integrations -----
    def resizeEvent(self, event):
        super().resizeEvent(event)
        if hasattr(self, "preview_overlay_labels") and hasattr(self, "timeline"):
            QTimer.singleShot(0, lambda: self._update_title_overlays(self.timeline.playhead))

    def closeEvent(self, event):
        if not self._check_unsaved():
            event.ignore()
            return
        self._closing = True
        self._stop_playback()
        self.autosave_timer.stop() if hasattr(self, "autosave_timer") else None
        for worker in list(self._workers):
            worker.cancel()
        self.settings.setValue("window/geometry", self.saveGeometry())
        self.settings.setValue("window/state", self.saveState())
        event.accept()


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    smoke = "--smoke" in argv
    argv = [value for value in argv if value != "--smoke"]
    project_path = argv[0] if argv else ""
    app = QApplication.instance() or QApplication([sys.argv[0], *argv])
    app.setApplicationName(APP_NAME)
    app.setOrganizationName("NovaCut")
    app.setStyle("Fusion")
    app.setStyleSheet(STYLESHEET)
    configure_logging()

    def excepthook(exc_type, exc, tb):
        LOG.critical("Unhandled UI error", exc_info=(exc_type, exc, tb))
        try:
            QMessageBox.critical(None, "NovaCut error", f"An unexpected error occurred.\n\n{exc}\n\nLog: {app_data_dir() / 'Logs' / 'novacut.log'}")
        except Exception:
            pass
    sys.excepthook = excepthook
    window = NovaCutMainWindow(project_path, smoke_test=smoke)
    window.show()
    return app.exec()
