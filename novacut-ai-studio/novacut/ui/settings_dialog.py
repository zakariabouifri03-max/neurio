"""Settings dialog: paths, preview, proxies, snapping and local assistant."""
from __future__ import annotations

from PySide6.QtWidgets import (QDialog, QVBoxLayout, QFormLayout, QLineEdit,
                               QComboBox, QSpinBox, QCheckBox, QPushButton,
                               QFileDialog, QHBoxLayout, QWidget)

from ..core.ffmpeg import find_ffmpeg, find_ffprobe


class SettingsDialog(QDialog):
    def __init__(self, config, parent=None):
        super().__init__(parent)
        self.config = config
        self.setWindowTitle("Settings")
        self.setMinimumWidth(560)
        layout = QVBoxLayout(self)
        form = QFormLayout()

        self.ffmpeg = QLineEdit(config.get("ffmpeg_path", "") or str(find_ffmpeg() or ""))
        browse_ff = QPushButton("Browse…")
        browse_ff.clicked.connect(self._pick_ffmpeg)
        form.addRow("FFmpeg executable", self._row(self.ffmpeg, browse_ff))

        self.ffprobe = QLineEdit(config.get("ffprobe_path", "") or str(find_ffprobe() or ""))
        browse_fp = QPushButton("Browse…")
        browse_fp.clicked.connect(lambda: self._pick(self.ffprobe, "ffprobe"))
        form.addRow("ffprobe executable", self._row(self.ffprobe, browse_fp))

        self.quality = QComboBox()
        self.quality.addItems(["full", "half", "quarter"])
        self.quality.setCurrentText(config.get("preview_quality", "half"))
        form.addRow("Preview quality", self.quality)

        self.proxy_height = QSpinBox()
        self.proxy_height.setRange(240, 2160)
        self.proxy_height.setSingleStep(20)
        self.proxy_height.setValue(int(config.get("proxy_height", 720)))
        form.addRow("Proxy height (px)", self.proxy_height)

        self.autosave = QCheckBox("Enable autosave / crash recovery")
        self.autosave.setChecked(bool(config.get("autosave", True)))
        form.addRow(self.autosave)

        self.interval = QSpinBox()
        self.interval.setRange(15, 3600)
        self.interval.setValue(int(config.get("autosave_interval_s", 60)))
        form.addRow("Autosave interval (s)", self.interval)

        self.snap = QCheckBox("Enable snapping")
        self.snap.setChecked(bool(config.get("snap_enabled", True)))
        form.addRow(self.snap)

        self.tolerance = QSpinBox()
        self.tolerance.setRange(1, 200)
        self.tolerance.setValue(int(config.get("snap_tolerance_s", 0.25) * 100))
        form.addRow("Snap tolerance (centiseconds)", self.tolerance)

        self.hw = QCheckBox("Prefer hardware acceleration with CPU fallback")
        self.hw.setChecked(bool(config.get("prefer_hwaccel", True)))
        form.addRow(self.hw)

        self.ollama_host = QLineEdit(config.get("ollama_host", "http://127.0.0.1:11434"))
        form.addRow("Ollama host (loopback only)", self.ollama_host)
        self.ollama_model = QLineEdit(config.get("ollama_model", "llama3.2:3b"))
        form.addRow("Ollama model", self.ollama_model)

        layout.addLayout(form)
        buttons = QHBoxLayout()
        buttons.addStretch(1)
        cancel = QPushButton("Cancel")
        cancel.clicked.connect(self.reject)
        save = QPushButton("Save")
        save.setObjectName("Primary")
        save.clicked.connect(self._save)
        buttons.addWidget(cancel)
        buttons.addWidget(save)
        layout.addLayout(buttons)

    @staticmethod
    def _row(edit: QLineEdit, button: QPushButton) -> QWidget:
        w = QWidget()
        h = QHBoxLayout(w)
        h.setContentsMargins(0, 0, 0, 0)
        h.addWidget(edit, 1)
        h.addWidget(button)
        return w

    def _pick_ffmpeg(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "Locate FFmpeg")
        if path:
            self.ffmpeg.setText(path)

    def _pick(self, edit: QLineEdit, name: str) -> None:
        path, _ = QFileDialog.getOpenFileName(self, f"Locate {name}")
        if path:
            edit.setText(path)

    def _save(self) -> None:
        self.config.set("ffmpeg_path", self.ffmpeg.text().strip())
        self.config.set("ffprobe_path", self.ffprobe.text().strip())
        self.config.set("preview_quality", self.quality.currentText())
        self.config.set("proxy_height", self.proxy_height.value())
        self.config.set("autosave", self.autosave.isChecked())
        self.config.set("autosave_interval_s", self.interval.value())
        self.config.set("snap_enabled", self.snap.isChecked())
        self.config.set("snap_tolerance_s", self.tolerance.value() / 100.0)
        self.config.set("prefer_hwaccel", self.hw.isChecked())
        self.config.set("ollama_host", self.ollama_host.text().strip())
        self.config.set("ollama_model", self.ollama_model.text().strip())
        self.accept()
