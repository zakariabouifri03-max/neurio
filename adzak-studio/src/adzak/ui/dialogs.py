"""Application dialogs: settings, new project, about."""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QDialog, QDialogButtonBox, QFileDialog, QFormLayout,
    QGroupBox, QHBoxLayout, QLabel, QLineEdit, QMessageBox, QPushButton,
    QSpinBox, QVBoxLayout,
)

from ..ai.keystorage import KeyStore
from ..ai.providers import PRESET_PROVIDERS
from ..core import paths
from ..core.ffmpeg import find_ffmpeg
from ..core.i18n import LANGUAGES
from ..core.settings import Settings


class NewProjectDialog(QDialog):
    def __init__(self, parent=None, tr=str):
        super().__init__(parent)
        self.tr = tr
        self.setWindowTitle(tr("action.new_project"))
        self.setMinimumWidth(420)
        form = QFormLayout(self)
        self.name = QLineEdit("My Project")
        self.kind = QComboBox()
        self.kind.addItems([
            ("Video project", "video"), ("Photo edit", "photo"),
            ("Graphic design", "design"), ("Audio project", "audio"),
            ("Animation", "animation"),
        ])
        self.kind.setItemData(0, "video"); self.kind.setItemData(1, "photo")
        self.kind.setItemData(2, "design"); self.kind.setItemData(3, "audio")
        self.kind.setItemData(4, "animation")
        self.preset = QComboBox()
        self.preset.addItems(["1920×1080 (16:9)", "1080×1920 (9:16)",
                              "1080×1080 (1:1)", "1080×1350 (4:5)", "3840×2160 (4K)"])
        self.preset.setCurrentIndex(0)
        self.fps = QSpinBox(); self.fps.setRange(12, 120); self.fps.setValue(30)
        form.addRow(tr("project.name"), self.name)
        form.addRow("Type", self.kind)
        form.addRow("Resolution", self.preset)
        form.addRow("FPS", self.fps)
        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.button(QDialogButtonBox.Ok).setText(tr("project.create"))
        buttons.button(QDialogButtonBox.Cancel).setText(tr("common.cancel"))
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        form.addRow(buttons)

    def resolution(self) -> tuple[int, int]:
        return {0: (1920, 1080), 1: (1080, 1920), 2: (1080, 1080),
                3: (1080, 1350), 4: (3840, 2160)}[self.preset.currentIndex()]

    def project_kind(self) -> str:
        return self.kind.currentData()


class SettingsDialog(QDialog):
    def __init__(self, settings: Settings, parent=None, tr=str):
        super().__init__(parent)
        self.settings = settings
        self.tr = tr
        self.keys = KeyStore()
        self.setWindowTitle(tr("action.settings"))
        self.setMinimumSize(560, 460)

        root = QVBoxLayout(self)

        general = QGroupBox(tr("action.settings"))
        f = QFormLayout(general)
        self.theme = QComboBox(); self.theme.addItems(["dark", "light"])
        self.theme.setCurrentText(settings.get("ui/theme", "dark"))
        self.language = QComboBox()
        for code, label in LANGUAGES.items():
            self.language.addItem(label, code)
        self.language.setCurrentIndex(
            self.language.findData(settings.get("ui/language", "en")))
        self.low_mem = QCheckBox()
        self.low_mem.setChecked(bool(settings.get("ui/low_memory_mode")))
        self.preview_q = QComboBox()
        self.preview_q.addItems(["full", "half", "quarter"])
        self.preview_q.setCurrentText(settings.get("preview/resolution", "half"))
        self.threads = QSpinBox(); self.threads.setRange(0, 32)
        self.threads.setValue(int(settings.get("render/threads", 0)))
        self.cache_mb = QSpinBox(); self.cache_mb.setRange(128, 65536)
        self.cache_mb.setValue(int(settings.get("cache/max_mb", 2048)))
        self.ffmpeg_path = QLineEdit(settings.get("ffmpeg/path", ""))
        browse = QPushButton(tr("common.browse"))
        browse.clicked.connect(self._browse_ffmpeg)
        row = QHBoxLayout(); row.addWidget(self.ffmpeg_path, 1); row.addWidget(browse)
        f.addRow(tr("settings.theme"), self.theme)
        f.addRow(tr("settings.language"), self.language)
        f.addRow(tr("settings.low_memory"), self.low_mem)
        f.addRow(tr("settings.preview_quality"), self.preview_q)
        f.addRow(tr("settings.threads"), self.threads)
        f.addRow(tr("settings.cache_limit"), self.cache_mb)
        f.addRow(tr("settings.ffmpeg_path"), row)
        clear = QPushButton(tr("settings.cleanup_cache"))
        clear.clicked.connect(self._clear_cache)
        f.addRow("", clear)
        root.addWidget(general)

        ai = QGroupBox("AI Providers")
        af = QFormLayout(ai)
        self.provider = QComboBox()
        self.provider.addItems(list(PRESET_PROVIDERS))
        self.provider.setCurrentText(settings.get("ai/provider", "openai") or "openai")
        self.base_url = QLineEdit(settings.get("ai/base_url", PRESET_PROVIDERS["openai"].base_url))
        self.chat_model = QLineEdit(settings.get("ai/chat_model", "gpt-4o-mini"))
        self.image_model = QLineEdit(settings.get("ai/image_model", ""))
        self.api_key = QLineEdit(); self.api_key.setEchoMode(QLineEdit.Password)
        self.api_key.setPlaceholderText("paste key (stored encrypted, never logged)")
        af.addRow("Provider", self.provider)
        af.addRow("Base URL", self.base_url)
        af.addRow("Chat model", self.chat_model)
        af.addRow("Image model", self.image_model)
        af.addRow("API key", self.api_key)
        note = QLabel("Keys are stored with Windows DPAPI on Windows. Without a key, "
                      "offline assistant features still work; API features show as unavailable.")
        note.setObjectName("hint"); note.setWordWrap(True)
        af.addRow(note)
        root.addWidget(ai)

        buttons = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        buttons.button(QDialogButtonBox.Save).setText(tr("common.apply"))
        buttons.button(QDialogButtonBox.Cancel).setText(tr("common.cancel"))
        buttons.accepted.connect(self._save)
        buttons.rejected.connect(self.reject)
        root.addWidget(buttons)

    def _browse_ffmpeg(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "Locate ffmpeg", "",
                                              "ffmpeg (ffmpeg.exe ffmpeg)")
        if path:
            self.ffmpeg_path.setText(path)

    def _clear_cache(self) -> None:
        cache = paths.cache_dir()
        count = 0
        for child in cache.rglob("*"):
            if child.is_file():
                child.unlink(missing_ok=True)
                count += 1
        QMessageBox.information(self, self.tr("common.info"),
                                f"Removed {count} cached files.")

    def _save(self) -> None:
        s = self.settings
        s.set("ui/theme", self.theme.currentText())
        s.set("ui/language", self.language.currentData())
        s.set("ui/low_memory_mode", self.low_mem.isChecked())
        s.set("preview/resolution", self.preview_q.currentText())
        s.set("render/threads", self.threads.value())
        s.set("cache/max_mb", self.cache_mb.value())
        s.set("ffmpeg/path", self.ffmpeg_path.text().strip())
        prov = self.provider.currentText()
        s.set("ai/provider", prov)
        s.set("ai/base_url", self.base_url.text().strip())
        s.set("ai/chat_model", self.chat_model.text().strip())
        s.set("ai/image_model", self.image_model.text().strip())
        key = self.api_key.text().strip()
        if key:
            self.keys.set_key(prov, key)
        self.accept()


class AboutDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        from .. import APP_NAME, __version__
        self.setWindowTitle(f"About {APP_NAME}")
        v = QVBoxLayout(self)
        la = QLabel(f"<h2>{APP_NAME}</h2><p>Version {__version__}</p>")
        la.setTextFormat(Qt.RichText)
        v.addWidget(la)
        txt = QLabel(
            "An all-in-one creative studio: video editing, photo editing, graphic "
            "design, audio, animation, media conversion and AI tools.\n\n"
            "Built with Python, PySide6 (Qt 6), FFmpeg, Pillow and NumPy.\n"
            "FFmpeg is distributed under the LGPL — see LICENSES.md in the install folder.\n\n"
            "Offline tools work without any account or API key. AI features that need "
            "external services are marked and only run when you add your own credentials.")
        txt.setWordWrap(True)
        v.addWidget(txt)
        b = QDialogButtonBox(QDialogButtonBox.Close)
        b.rejected.connect(self.reject); b.clicked.connect(self.accept)
        v.addWidget(b)
        self.setMinimumWidth(520)
