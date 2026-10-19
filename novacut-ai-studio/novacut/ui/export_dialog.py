"""Export window: format/codec options, progress, ETA and cancellation."""
from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QDialog, QVBoxLayout, QFormLayout, QComboBox,
                               QPushButton, QLineEdit, QCheckBox, QSpinBox,
                               QProgressBar, QLabel, QFileDialog, QHBoxLayout,
                               QGroupBox, QMessageBox, QWidget)

from ..core.constants import (EXPORT_RESOLUTIONS, EXPORT_FPS, VIDEO_CODECS,
                              AUDIO_CODECS, CONTAINER_FORMATS)
from ..core.ffmpeg import ffmpeg_supports_encoders
from ..core.workers import TaskWorker
from ..render.exporter import run_export, check_disk_space, ExportError
from ..render.presets import ExportSettings


class ExportDialog(QDialog):
    def __init__(self, controller, parent=None):
        super().__init__(parent)
        self.controller = controller
        self.setWindowTitle("Export project")
        self.setMinimumWidth(560)
        self._worker: TaskWorker | None = None
        layout = QVBoxLayout(self)

        form_group = QGroupBox("Output")
        form = QFormLayout(form_group)
        self.path_edit = QLineEdit()
        default = str(Path.home() / "NovaCut export.mp4")
        self.path_edit.setText(default)
        browse = QPushButton("Browse…")
        browse.clicked.connect(self._browse)
        path_row = QHBoxLayout()
        path_row.addWidget(self.path_edit, 1)
        path_row.addWidget(browse)
        form.addRow("File", self._wrap(path_row))

        self.container = QComboBox()
        for c in sorted(CONTAINER_FORMATS):
            self.container.addItem(c, c)
        self.container.setCurrentText(".mp4")
        form.addRow("Container", self.container)

        self.resolution = QComboBox()
        for key in EXPORT_RESOLUTIONS:
            self.resolution.addItem(key, key)
        self.resolution.setCurrentText("1080p")
        form.addRow("Resolution", self.resolution)

        self.fps = QComboBox()
        for f in EXPORT_FPS:
            self.fps.addItem(f"{f:g} fps", f)
        self.fps.setCurrentText("30 fps")
        form.addRow("Frame rate", self.fps)
        layout.addWidget(form_group)

        video_group = QGroupBox("Video")
        vform = QFormLayout(video_group)
        caps = ffmpeg_supports_encoders()
        self.codec = QComboBox()
        for cid, (encoder, label, hw) in VIDEO_CODECS.items():
            available = caps.get(encoder, False) or cid in ("h264_cpu", "h265_cpu")
            self.codec.addItem(("✓ " if available else "✗ ") + label, cid)
            if not available:
                model = self.codec.model()
                model.item(self.codec.count() - 1).setEnabled(False)
        vform.addRow("Encoder", self.codec)
        self.crf = QSpinBox()
        self.crf.setRange(0, 51)
        self.crf.setValue(20)
        vform.addRow("Quality (CRF, lower=better)", self.crf)
        self.bitrate = QSpinBox()
        self.bitrate.setRange(0, 200_000)
        self.bitrate.setValue(8000)
        self.bitrate.setSuffix(" kbps (0 = CRF only)")
        vform.addRow("Max bitrate", self.bitrate)
        self.hw = QCheckBox("Use hardware acceleration (auto CPU fallback)")
        self.hw.setChecked(bool(self.controller.config.get("prefer_hwaccel")))
        vform.addRow(self.hw)
        self.proxies = QCheckBox("Render from proxy media (faster, lower quality)")
        vform.addRow(self.proxies)
        self.subtitles = QLineEdit()
        self.subtitles.setPlaceholderText("Optional .srt/.ass to burn into video")
        sub_browse = QPushButton("Browse…")
        sub_browse.clicked.connect(self._pick_subtitles)
        sub_row = QHBoxLayout()
        sub_row.addWidget(self.subtitles, 1)
        sub_row.addWidget(sub_browse)
        vform.addRow("Burn subtitles", self._wrap(sub_row))
        layout.addWidget(video_group)

        audio_group = QGroupBox("Audio")
        aform = QFormLayout(audio_group)
        self.audio_codec = QComboBox()
        for cid, (encoder, label) in AUDIO_CODECS.items():
            self.audio_codec.addItem(label, cid)
        aform.addRow("Codec", self.audio_codec)
        self.sample_rate = QComboBox()
        for sr in (44100, 48000, 96000):
            self.sample_rate.addItem(str(sr), sr)
        self.sample_rate.setCurrentText("48000")
        aform.addRow("Sample rate", self.sample_rate)
        layout.addWidget(audio_group)

        self.progress = QProgressBar()
        self.progress.setRange(0, 100)
        layout.addWidget(self.progress)
        self.status = QLabel("Ready")
        self.status.setObjectName("Dim")
        layout.addWidget(self.status)

        buttons = QHBoxLayout()
        self.start_btn = QPushButton("Start export")
        self.start_btn.setObjectName("Primary")
        self.cancel_btn = QPushButton("Cancel")
        self.cancel_btn.setEnabled(False)
        self.close_btn = QPushButton("Close")
        buttons.addStretch(1)
        buttons.addWidget(self.close_btn)
        buttons.addWidget(self.cancel_btn)
        buttons.addWidget(self.start_btn)
        layout.addLayout(buttons)
        self.start_btn.clicked.connect(self.start)
        self.cancel_btn.clicked.connect(self._cancel)
        self.close_btn.clicked.connect(self.reject)

    @staticmethod
    def _wrap(row_layout) -> QWidget:
        w = QWidget()
        w.setLayout(row_layout)
        return w

    def _browse(self) -> None:
        path, _ = QFileDialog.getSaveFileName(
            self, "Export as", self.path_edit.text(),
            "Video (*.mp4 *.mov *.mkv *.webm *.avi);;Audio (*.wav)")
        if path:
            self.path_edit.setText(path)
            suffix = Path(path).suffix
            if suffix:
                self.container.setCurrentText(suffix)

    def _pick_subtitles(self) -> None:
        path, _ = QFileDialog.getOpenFileName(
            self, "Subtitle file", "", "Subtitles (*.srt *.ass *.vtt)")
        if path:
            self.subtitles.setText(path)

    def _build_settings(self) -> ExportSettings:
        sub_path = self.subtitles.text().strip()
        return ExportSettings(
            output_path=self.path_edit.text().strip(),
            container=self.container.currentData(),
            resolution_key=self.resolution.currentData(),
            fps=float(self.fps.currentData()),
            video_codec_id=self.codec.currentData(),
            audio_codec_id=self.audio_codec.currentData(),
            video_bitrate_k=self.bitrate.value(),
            crf=self.crf.value(),
            use_hardware=self.hw.isChecked(),
            sample_rate=int(self.sample_rate.currentData()),
            use_proxies=self.proxies.isChecked(),
            burn_subtitles=sub_path or None)

    def start(self) -> None:
        settings = self._build_settings()
        problems = settings.validate()
        ok, free, needed = check_disk_space(
            settings.output_path,
            max(50_000_000, self.controller.project.timeline.duration() * 2_000_000))
        if not ok:
            problems.append(
                f"Low disk space: ~{needed // 1_000_000} MB needed, "
                f"{free // 1_000_000} MB free.")
        if problems:
            QMessageBox.warning(self, "Export problems", "\n".join(problems))
            return
        self.start_btn.setEnabled(False)
        self.cancel_btn.setEnabled(True)

        def task(progress_cb, should_cancel):
            return run_export(self.controller.project, settings,
                              on_progress=lambda f, _s, eta: (
                                  progress_cb(f, f"Rendering {f * 100:.0f}%  "
                                              f"ETA {eta:.0f}s"),
                                  self.progress.setValue(int(f * 100))),
                              should_cancel=should_cancel)

        self._worker = TaskWorker(task)
        self._worker.progress.connect(
            lambda f, m: (self.progress.setValue(int(f * 100)), self.status.setText(m)))
        self._worker.failed.connect(self._failed)
        self._worker.cancelled.connect(self._cancelled)
        self._worker.finished.connect(self._finished)
        self._worker.start()

    def _cancel(self) -> None:
        if self._worker:
            self._worker.request_cancel()
            self.status.setText("Cancelling…")

    def _finished(self, report) -> None:
        self._reset_buttons()
        if report.ok:
            msg = (f"Export complete: {report.output_path}\n"
                   f"Duration {report.duration_s:.1f}s, encoder {report.used_encoder}"
                   + (" (CPU fallback)" if report.fell_back else ""))
            self.progress.setValue(100)
            self.status.setText("Done")
            QMessageBox.information(self, "Export", msg)
            self.accept()
        else:
            QMessageBox.warning(self, "Export failed", report.error)

    def _failed(self, message: str) -> None:
        self._reset_buttons()
        QMessageBox.critical(self, "Export error", message)

    def _cancelled(self) -> None:
        self._reset_buttons()
        self.status.setText("Cancelled")
        self.progress.setValue(0)

    def _reset_buttons(self) -> None:
        self.start_btn.setEnabled(True)
        self.cancel_btn.setEnabled(False)
