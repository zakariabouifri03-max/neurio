"""Settings dialog. Secrets are written to the OS credential store only; they are never shown back."""
from __future__ import annotations

from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QDialog, QDialogButtonBox, QFormLayout, QHBoxLayout, QLabel, QLineEdit, QMessageBox,
    QPushButton, QSpinBox,
)

from ..core import ffmpeg, secrets
from ..core.errors import AppError
from ..core.i18n import LANGUAGES


class SettingsDialog(QDialog):
    def __init__(self, parent, db):
        super().__init__(parent)
        self.db = db
        self.setWindowTitle("Settings")
        self.setMinimumWidth(520)
        lay = QFormLayout(self)
        self.language = QComboBox()
        for code, name in LANGUAGES.items():
            self.language.addItem(name, code)
        self.language.setCurrentIndex(max(0, self.language.findData(db.get_setting("language"))))
        self.lang_note = QLabel("Language changes apply the next time you start the app.")
        self.lang_note.setObjectName("muted")
        self.theme = QComboBox(); self.theme.addItem("Dark", "dark"); self.theme.addItem("Light", "light")
        self.theme.setCurrentIndex(max(0, self.theme.findData(db.get_setting("theme"))))
        self.low_mem = QCheckBox("Low-memory mode (smaller previews, proxies, lighter encodes)")
        self.low_mem.setChecked(bool(db.get_setting("low_memory")))
        self.preview_h = QSpinBox(); self.preview_h.setRange(144, 1080); self.preview_h.setValue(int(db.get_setting("preview_height")))
        self.preview_h.setSuffix(" px")
        self.threads = QSpinBox(); self.threads.setRange(0, 64); self.threads.setSpecialValueText("Automatic")
        self.threads.setValue(int(db.get_setting("render_threads")))
        self.hw = QCheckBox("Try hardware encoding (Intel Quick Sync) when available")
        self.hw.setChecked(bool(db.get_setting("hardware_accel")))
        self.cache = QSpinBox(); self.cache.setRange(16, 20000); self.cache.setValue(int(db.get_setting("cache_limit_mb")))
        self.cache.setSuffix(" MB")
        self.autosave = QSpinBox(); self.autosave.setRange(1, 30); self.autosave.setValue(int(db.get_setting("autosave_minutes")))
        self.autosave.setSuffix(" min")
        lay.addRow(QLabel("<b>Interface</b>"))
        lay.addRow("Language", self.language)
        lay.addRow("", self.lang_note)
        lay.addRow("Theme", self.theme)
        lay.addRow(QLabel("<b>Performance</b>"))
        lay.addRow("", self.low_mem)
        lay.addRow("Preview height", self.preview_h)
        lay.addRow("Render threads", self.threads)
        lay.addRow("", self.hw)
        lay.addRow("Cache limit (proxies & previews)", self.cache)
        lay.addRow("Autosave every", self.autosave)
        lay.addRow(QLabel("<b>AI provider (optional)</b>"))
        self.provider = QComboBox(); self.provider.addItem("None (offline only)", "none")
        self.provider.addItem("OpenAI-compatible HTTPS endpoint", "openai_compatible")
        cfg = db.get_setting("ai_provider")
        self.provider.setCurrentIndex(max(0, self.provider.findData(cfg.get("kind", "none"))))
        self.base_url = QLineEdit(cfg.get("base_url", "")); self.model = QLineEdit(cfg.get("model", ""))
        self.key = QLineEdit(); self.key.setEchoMode(QLineEdit.Password)
        self.key.setPlaceholderText("Stored in Windows Credential Manager — never shown again")
        self.key_state = QLabel(self._key_text())
        self.key_state.setObjectName("muted")
        save_key = QPushButton("Save key"); save_key.clicked.connect(self._save_key)
        clear_key = QPushButton("Remove key"); clear_key.clicked.connect(self._clear_key)
        kr = QHBoxLayout(); kr.addWidget(save_key); kr.addWidget(clear_key)
        lay.addRow("Provider", self.provider)
        lay.addRow("Base URL (https)", self.base_url)
        lay.addRow("Model", self.model)
        lay.addRow("API key", self.key)
        lay.addRow("", self.key_state)
        lay.addRow("", kr)
        note = QLabel("Your provider bills your account for requests. A key may also be supplied through the "
                      "ADZAK_AI_API_KEY environment variable.")
        note.setWordWrap(True); note.setObjectName("muted")
        lay.addRow(note)
        ff = QLabel(self._ffmpeg_text()); ff.setWordWrap(True); ff.setObjectName("muted")
        lay.addRow("FFmpeg", ff)
        box = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        box.accepted.connect(self._accept)
        box.rejected.connect(self.reject)
        lay.addRow(box)

    def _key_text(self) -> str:
        try:
            return "A key is configured." if secrets.get_api_key() else "No key configured (offline tools still work)."
        except Exception:  # noqa: BLE001
            return "Credential store unavailable."

    def _ffmpeg_text(self) -> str:
        try:
            return f"Found: {ffmpeg.find_ffmpeg()}"
        except AppError as exc:
            return exc.user_message

    def _save_key(self) -> None:
        value = self.key.text().strip()
        if not value:
            return
        try:
            secrets.set_api_key(value)
        except AppError as exc:
            QMessageBox.warning(self, "Error", exc.user_message)
            return
        self.key.clear()
        self.key_state.setText(self._key_text())

    def _clear_key(self) -> None:
        secrets.delete_api_key()
        self.key_state.setText(self._key_text())

    def _accept(self) -> None:
        url = self.base_url.text().strip()
        if self.provider.currentData() == "openai_compatible" and not url.startswith("https://"):
            QMessageBox.warning(self, "Settings", "The provider URL must start with https://")
            return
        self.db.set_setting("language", self.language.currentData())
        self.db.set_setting("theme", self.theme.currentData())
        self.db.set_setting("low_memory", self.low_mem.isChecked())
        self.db.set_setting("preview_height", self.preview_h.value())
        self.db.set_setting("render_threads", self.threads.value())
        self.db.set_setting("hardware_accel", self.hw.isChecked())
        self.db.set_setting("cache_limit_mb", self.cache.value())
        self.db.set_setting("autosave_minutes", self.autosave.value())
        self.db.set_setting("ai_provider", {"kind": self.provider.currentData(), "base_url": url,
                                             "model": self.model.text().strip()})
        self.accept()
