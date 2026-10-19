"""Dedicated AI Studio window: eight independent local AI tools."""
from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt, QUrl
from PySide6.QtGui import QDesktopServices, QPixmap
from PySide6.QtWidgets import (QMainWindow, QWidget, QVBoxLayout, QTabWidget,
                               QLabel, QPushButton, QComboBox, QDoubleSpinBox,
                               QCheckBox, QProgressBar, QTableWidget,
                               QTableWidgetItem, QFileDialog, QMessageBox,
                               QHBoxLayout, QSlider, QTextEdit, QGroupBox,
                               QFormLayout, QLineEdit, QHeaderView, QSpinBox)

from ..ai.assistant import LocalAssistant, AssistantMessage
from ..ai.audio_cleanup import AudioCleanup
from ..ai.background import BackgroundRemover
from ..ai.reframe import SmartReframe
from ..ai.scenes import SceneDetector
from ..ai.separation import AudioSeparator
from ..ai.silence import SilenceDetector
from ..ai.subtitles import (SubtitleEngine, SubtitleSegment, SubtitleStyle,
                            write_srt, write_vtt, write_ass)
from ..core.workers import TaskWorker
from ..models.enums import ClipKind


def _status_banner(status) -> QLabel:
    label = QLabel()
    label.setWordWrap(True)
    if status.available:
        text = "✅ Ready"
        if status.requirements:
            text += f" — {status.requirements}"
        if status.resource_note:
            text += f"\nℹ {status.resource_note}"
        label.setStyleSheet("color:#37c97f;")
    else:
        text = "⛔ Unavailable: " + status.reason
        if status.needs_model:
            text += "\nOpen Tools ▸ Model Manager to install it."
        label.setStyleSheet("color:#f5a623;")
    label.setText(text)
    return label


class AIStudioWindow(QMainWindow):
    def __init__(self, controller, parent=None):
        super().__init__(parent)
        self.controller = controller
        self.setWindowTitle("NovaCut AI Studio — local, offline")
        self.resize(980, 720)
        tabs = QTabWidget()
        self.setCentralWidget(tabs)
        self.progress = QProgressBar()
        self.progress.setRange(0, 100)
        self.status = QLabel("Idle")

        tabs.addTab(self._subtitles_tab(), "Subtitles")
        tabs.addTab(self._silence_tab(), "Silence cut")
        tabs.addTab(self._background_tab(), "Background")
        tabs.addTab(self._separation_tab(), "Separation")
        tabs.addTab(self._scenes_tab(), "Scene detect")
        tabs.addTab(self._reframe_tab(), "Smart reframe")
        tabs.addTab(self._cleanup_tab(), "Audio cleanup")
        tabs.addTab(self._assistant_tab(), "Assistant")

        dock = QWidget()
        dock_l = QVBoxLayout(dock)
        dock_l.addWidget(self.progress)
        dock_l.addWidget(self.status)
        self._dock = dock
        # Progress strip lives in the bottom of the central widget.
        central = QWidget()
        outer = QVBoxLayout(central)
        outer.addWidget(tabs, 1)
        outer.addWidget(dock)
        self.setCentralWidget(central)

    # ------------------------------------------------------------- helpers
    def _run(self, task, on_finished, allow_when=True):
        if not allow_when:
            QMessageBox.warning(self, "Unavailable",
                                "This tool is not available. See its status note.")
            return
        worker = TaskWorker(task)
        worker.progress.connect(
            lambda f, m: (self.progress.setValue(int(f * 100)), self.status.setText(m)))
        worker.failed.connect(lambda e: (self.progress.setValue(0),
                                         self.status.setText("Failed"),
                                         QMessageBox.critical(self, "AI tool error", e)))
        worker.cancelled.connect(lambda: self.status.setText("Cancelled"))
        worker.finished.connect(on_finished)
        worker.start()
        self._worker = worker

    def _clip_combo(self, kinds=("video", "audio", "image", "title")) -> QComboBox:
        combo = QComboBox()
        for clip in self.controller.project.timeline.all_clips():
            if clip.kind in kinds:
                combo.addItem(f"{clip.name} [{clip.start:.1f}s]", clip.id)
        return combo

    def _clip(self, combo: QComboBox):
        cid = combo.currentData()
        return self.controller.project.timeline.clip_by_id(cid) if cid else None

    def _media_path_for_clip(self, clip) -> str | None:
        item = self.controller.project.get_media(clip.media_id) if clip else None
        return item.path if item and not item.missing else None

    # ----------------------------------------------------------- subtitles
    def _subtitles_tab(self) -> QWidget:
        tab = QWidget()
        layout = QVBoxLayout(tab)
        engine = SubtitleEngine()
        layout.addWidget(_status_banner(engine.check()))
        form = QFormLayout()
        self.sub_clip = self._clip_combo(("video", "audio"))
        self.sub_size = QComboBox()
        self.sub_size.addItems(["tiny", "base", "small", "medium", "large-v3"])
        self.sub_size.setCurrentText("base")
        self.sub_lang = QLineEdit()
        self.sub_lang.setPlaceholderText("auto-detect (e.g. en, fr, ar)")
        form.addRow("Source clip", self.sub_clip)
        form.addRow("Model size", self.sub_size)
        form.addRow("Language", self.sub_lang)
        layout.addLayout(form)
        self.sub_table = QTableWidget(0, 3)
        self.sub_table.setHorizontalHeaderLabels(["Start", "End", "Text"])
        self.sub_table.horizontalHeader().setSectionResizeMode(
            2, QHeaderView.ResizeMode.Stretch)
        layout.addWidget(self.sub_table, 1)
        row = QHBoxLayout()
        run = QPushButton("Transcribe locally")
        run.setObjectName("Primary")
        run.clicked.connect(self._run_subtitles)
        row.addWidget(run)
        for label, ext in (("Export SRT", ".srt"), ("Export VTT", ".vtt"),
                           ("Export styled ASS", ".ass")):
            btn = QPushButton(label)
            btn.clicked.connect(lambda _=False, e=ext: self._export_subtitles(e))
            row.addWidget(btn)
        row.addStretch(1)
        layout.addLayout(row)
        hint = QLabel("Burn-in: export an SRT/ASS, then pick it in the Export dialog.")
        hint.setObjectName("Dim")
        layout.addWidget(hint)
        self._sub_engine = engine
        return tab

    def _run_subtitles(self):
        clip = self._clip(self.sub_clip)
        path = self._media_path_for_clip(clip)
        if not path:
            QMessageBox.warning(self, "Subtitles", "Choose a clip with available media.")
            return
        lang = self.sub_lang.text().strip() or None

        def task(progress, should_cancel):
            return self._sub_engine.transcribe(
                path, self.sub_size.currentText(), lang, progress, should_cancel)

        def done(segments):
            self.sub_table.setRowCount(len(segments))
            for r, seg in enumerate(segments):
                self.sub_table.setItem(r, 0, QTableWidgetItem(f"{seg.start:.3f}"))
                self.sub_table.setItem(r, 1, QTableWidgetItem(f"{seg.end:.3f}"))
                self.sub_table.setItem(r, 2, QTableWidgetItem(seg.text))
            self.status.setText(f"{len(segments)} subtitle segments")

        self._run(task, done, engine_available := self._sub_engine.check().available)

    def _collect_segments(self) -> list[SubtitleSegment]:
        segments = []
        for r in range(self.sub_table.rowCount()):
            try:
                segments.append(SubtitleSegment(
                    float(self.sub_table.item(r, 0).text()),
                    float(self.sub_table.item(r, 1).text()),
                    self.sub_table.item(r, 2).text()))
            except (AttributeError, ValueError):
                continue
        return segments

    def _export_subtitles(self, ext: str):
        segments = self._collect_segments()
        if not segments:
            QMessageBox.information(self, "Subtitles", "Transcribe first.")
            return
        path, _ = QFileDialog.getSaveFileName(self, "Save subtitles",
                                              f"subtitles{ext}")
        if not path:
            return
        s = self.controller.project.settings
        if ext == ".ass":
            write_ass(segments, path, SubtitleStyle(), s.width, s.height)
        elif ext == ".srt":
            write_srt(segments, path)
        else:
            write_vtt(segments, path)
        self.status.setText(f"Wrote {path}")

    # ------------------------------------------------------------- silence
    def _silence_tab(self) -> QWidget:
        tab = QWidget()
        layout = QVBoxLayout(tab)
        tool = SilenceDetector()
        layout.addWidget(_status_banner(tool.check()))
        form = QFormLayout()
        self.sil_clip = self._clip_combo(("video", "audio"))
        self.sil_threshold = QDoubleSpinBox()
        self.sil_threshold.setRange(-90, 0)
        self.sil_threshold.setValue(-35)
        self.sil_threshold.setSuffix(" dB")
        self.sil_min = QDoubleSpinBox()
        self.sil_min.setRange(0.05, 30)
        self.sil_min.setValue(0.5)
        self.sil_min.setSuffix(" s")
        form.addRow("Clip", self.sil_clip)
        form.addRow("Threshold", self.sil_threshold)
        form.addRow("Minimum duration", self.sil_min)
        layout.addLayout(form)
        self.sil_table = QTableWidget(0, 2)
        self.sil_table.setHorizontalHeaderLabels(["Start", "End"])
        layout.addWidget(self.sil_table, 1)
        row = QHBoxLayout()
        detect = QPushButton("Detect silences")
        detect.setObjectName("Primary")
        detect.clicked.connect(self._detect_silence)
        apply = QPushButton("Apply ripple cuts (undoable)")
        apply.clicked.connect(self._apply_silence)
        row.addWidget(detect)
        row.addWidget(apply)
        row.addStretch(1)
        layout.addLayout(row)
        self._silence_tool = tool
        self._silence_intervals = []
        return tab

    def _detect_silence(self):
        clip = self._clip(self.sil_clip)
        path = self._media_path_for_clip(clip)
        if not path:
            return

        def task(progress, should_cancel):
            return self._silence_tool.detect(
                path, self.sil_threshold.value(), self.sil_min.value(), should_cancel)

        def done(intervals):
            self._silence_intervals = intervals
            self.sil_table.setRowCount(len(intervals))
            for r, iv in enumerate(intervals):
                self.sil_table.setItem(r, 0, QTableWidgetItem(f"{iv.start:.3f}"))
                self.sil_table.setItem(r, 1, QTableWidgetItem(f"{iv.end:.3f}"))
            self.status.setText(f"{len(intervals)} silent intervals — review before applying")

        self._run(task, done, self._silence_tool.check().available)

    def _apply_silence(self):
        clip = self._clip(self.sil_clip)
        if not clip or not self._silence_intervals:
            return
        if QMessageBox.question(self, "Confirm cuts",
                                "Apply ripple-delete cuts for these intervals?") \
                != QMessageBox.StandardButton.Yes:
            return
        macro = self._silence_tool.cut_commands(
            self.controller.project.timeline, clip.id, self._silence_intervals)
        self.controller.execute(macro)
        self.status.setText("Silence cuts applied (undo restores them)")

    # ---------------------------------------------------------- background
    def _background_tab(self) -> QWidget:
        tab = QWidget()
        layout = QVBoxLayout(tab)
        tool = BackgroundRemover()
        layout.addWidget(_status_banner(tool.check()))
        form = QFormLayout()
        self.bg_clip = self._clip_combo(("video", "image"))
        self.bg_replace = QLineEdit()
        self.bg_replace.setPlaceholderText("Leave empty for transparency, or #RRGGBB / image path")
        form.addRow("Clip", self.bg_clip)
        form.addRow("Replacement", self.bg_replace)
        layout.addLayout(form)
        self.bg_preview = QLabel("Preview appears here")
        self.bg_preview.setMinimumHeight(220)
        self.bg_preview.setAlignment(Qt.AlignmentFlag.AlignCenter)
        layout.addWidget(self.bg_preview, 1)
        row = QHBoxLayout()
        preview = QPushButton("Preview first frame")
        process = QPushButton("Process whole clip")
        preview.clicked.connect(self._bg_preview)
        process.clicked.connect(self._bg_process)
        row.addWidget(preview)
        row.addWidget(process)
        row.addStretch(1)
        layout.addLayout(row)
        self._bg_tool = tool
        return tab

    def _bg_preview(self):
        clip = self._clip(self.bg_clip)
        path = self._media_path_for_clip(clip)
        if not path:
            return

        def task(progress, should_cancel):
            return self._bg_tool.process_image(path)

        def done(out):
            self.bg_preview.setPixmap(QPixmap(out).scaled(
                self.bg_preview.size(), Qt.AspectRatioMode.KeepAspectRatio))
            self.status.setText(f"Preview: {out}")

        self._run(task, done, self._bg_tool.check().available)

    def _bg_process(self):
        clip = self._clip(self.bg_clip)
        path = self._media_path_for_clip(clip)
        if not path:
            return
        out, _ = QFileDialog.getSaveFileName(self, "Save cutout", "cutout.mov")
        if not out:
            return

        def task(progress, should_cancel):
            return self._bg_tool.process_clip(
                path, out, self.bg_replace.text() or None, progress, should_cancel)

        self._run(task, lambda p: self.status.setText(f"Saved {p}"),
                  self._bg_tool.check().available)

    # ---------------------------------------------------------- separation
    def _separation_tab(self) -> QWidget:
        tab = QWidget()
        layout = QVBoxLayout(tab)
        tool = AudioSeparator()
        layout.addWidget(_status_banner(tool.check()))
        form = QFormLayout()
        self.sep_clip = self._clip_combo(("audio", "video"))
        form.addRow("Audio clip", self.sep_clip)
        layout.addLayout(form)
        self.sep_table = QTableWidget(0, 2)
        self.sep_table.setHorizontalHeaderLabels(["Stem", "Path"])
        self.sep_table.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.ResizeMode.Stretch)
        layout.addWidget(self.sep_table, 1)
        run = QPushButton("Separate vocals / accompaniment")
        run.setObjectName("Primary")
        run.clicked.connect(self._run_separation)
        layout.addWidget(run)
        self._sep_tool = tool
        return tab

    def _run_separation(self):
        clip = self._clip(self.sep_clip)
        path = self._media_path_for_clip(clip)
        if not path:
            return

        def task(progress, should_cancel):
            return self._sep_tool.separate(path, progress=progress,
                                           should_cancel=should_cancel)

        def done(stems: dict):
            self.sep_table.setRowCount(len(stems))
            for r, (name, p) in enumerate(stems.items()):
                self.sep_table.setItem(r, 0, QTableWidgetItem(name))
                self.sep_table.setItem(r, 1, QTableWidgetItem(p))
            self.status.setText(f"{len(stems)} stems written")

        self._run(task, done, self._sep_tool.check().available)

    # -------------------------------------------------------------- scenes
    def _scenes_tab(self) -> QWidget:
        tab = QWidget()
        layout = QVBoxLayout(tab)
        tool = SceneDetector()
        layout.addWidget(_status_banner(tool.check()))
        form = QFormLayout()
        self.sc_clip = self._clip_combo(("video",))
        self.sc_threshold = QDoubleSpinBox()
        self.sc_threshold.setRange(0.05, 1.0)
        self.sc_threshold.setSingleStep(0.05)
        self.sc_threshold.setValue(0.45)
        form.addRow("Clip", self.sc_clip)
        form.addRow("Sensitivity", self.sc_threshold)
        layout.addLayout(form)
        self.sc_table = QTableWidget(0, 2)
        self.sc_table.setHorizontalHeaderLabels(["Time (s)", "Score"])
        layout.addWidget(self.sc_table, 1)
        row = QHBoxLayout()
        detect = QPushButton("Detect scenes")
        detect.setObjectName("Primary")
        markers = QPushButton("Add as timeline markers")
        detect.clicked.connect(self._detect_scenes)
        markers.clicked.connect(self._scene_markers)
        row.addWidget(detect)
        row.addWidget(markers)
        row.addStretch(1)
        layout.addLayout(row)
        self._scene_tool = tool
        self._scenes = []
        return tab

    def _detect_scenes(self):
        clip = self._clip(self.sc_clip)
        path = self._media_path_for_clip(clip)
        if not path:
            return

        def task(progress, should_cancel):
            return self._scene_tool.detect(
                path, threshold=self.sc_threshold.value(),
                progress=progress, should_cancel=should_cancel)

        def done(boundaries):
            self._scenes = boundaries
            self.sc_table.setRowCount(len(boundaries))
            for r, b in enumerate(boundaries):
                self.sc_table.setItem(r, 0, QTableWidgetItem(f"{b.time:.3f}"))
                self.sc_table.setItem(r, 1, QTableWidgetItem(f"{b.score:.2f}"))
            self.status.setText(f"{len(boundaries)} scene boundaries — review first")

        self._run(task, done, self._scene_tool.check().available)

    def _scene_markers(self):
        clip = self._clip(self.sc_clip)
        if not self._scenes:
            return
        created = self._scene_tool.apply_as_markers(
            self.controller.project.timeline, self._scenes, clip)
        self.controller.project.touch()
        self.controller.timelineChanged.emit()
        self.status.setText(f"Added {len(created)} markers")

    # ------------------------------------------------------------- reframe
    def _reframe_tab(self) -> QWidget:
        tab = QWidget()
        layout = QVBoxLayout(tab)
        tool = SmartReframe()
        layout.addWidget(_status_banner(tool.check()))
        form = QFormLayout()
        self.rf_clip = self._clip_combo(("video",))
        form.addRow("Clip", self.rf_clip)
        layout.addLayout(form)
        self.rf_table = QTableWidget(0, 3)
        self.rf_table.setHorizontalHeaderLabels(["Time", "Center X", "Center Y"])
        layout.addWidget(self.rf_table, 1)
        row = QHBoxLayout()
        track = QPushButton("Track subject")
        track.setObjectName("Primary")
        apply = QPushButton("Apply as position keyframes (editable)")
        track.clicked.connect(self._track_reframe)
        apply.clicked.connect(self._apply_reframe)
        row.addWidget(track)
        row.addWidget(apply)
        row.addStretch(1)
        layout.addLayout(row)
        warn = QLabel("Tracking is an assist, not perfection: review every suggestion.")
        warn.setObjectName("Dim")
        layout.addWidget(warn)
        self._reframe_tool = tool
        self._reframe_kfs = []
        return tab

    def _track_reframe(self):
        clip = self._clip(self.rf_clip)
        path = self._media_path_for_clip(clip)
        if not path:
            return

        def task(progress, should_cancel):
            return self._reframe_tool.track(
                path, progress=progress, should_cancel=should_cancel)

        def done(kfs):
            self._reframe_kfs = kfs
            self.rf_table.setRowCount(len(kfs))
            for r, k in enumerate(kfs):
                self.rf_table.setItem(r, 0, QTableWidgetItem(f"{k.time:.2f}"))
                self.rf_table.setItem(r, 1, QTableWidgetItem(f"{k.center_x:.2f}"))
                self.rf_table.setItem(r, 2, QTableWidgetItem(f"{k.center_y:.2f}"))

        self._run(task, done, self._reframe_tool.check().available)

    def _apply_reframe(self):
        clip = self._clip(self.rf_clip)
        if not clip or not self._reframe_kfs:
            return
        s = self.controller.project.settings
        # Map normalized subject centre to a pixel pan for vertical framing.
        span = max(1.0, s.width)
        for k in self._reframe_kfs:
            t = clip.start + k.time
            clip.add_keyframe("pos_x", t, (0.5 - k.center_x) * span)
        self.controller.project.touch()
        self.controller.timelineChanged.emit()
        self.status.setText("Position keyframes added — edit them in the inspector")

    # ------------------------------------------------------------- cleanup
    def _cleanup_tab(self) -> QWidget:
        tab = QWidget()
        layout = QVBoxLayout(tab)
        tool = AudioCleanup()
        layout.addWidget(_status_banner(tool.check()))
        form = QFormLayout()
        self.ac_clip = self._clip_combo(("audio", "video"))
        self.ac_intensity = QSlider(Qt.Orientation.Horizontal)
        self.ac_intensity.setRange(0, 100)
        self.ac_intensity.setValue(50)
        self.ac_voice = QCheckBox("Voice enhancement mode")
        form.addRow("Clip", self.ac_clip)
        form.addRow("Intensity", self.ac_intensity)
        form.addRow(self.ac_voice)
        layout.addLayout(form)
        row = QHBoxLayout()
        preview = QPushButton("Make 5s A/B preview")
        process = QPushButton("Process & import")
        preview.clicked.connect(self._cleanup_preview)
        process.clicked.connect(self._cleanup_process)
        row.addWidget(preview)
        row.addWidget(process)
        row.addStretch(1)
        layout.addLayout(row)
        self._cleanup_tool = tool
        return tab

    def _cleanup_preview(self):
        clip = self._clip(self.ac_clip)
        path = self._media_path_for_clip(clip)
        if not path:
            return

        def task(progress, should_cancel):
            return self._cleanup_tool.preview_pair(
                path, self.ac_intensity.value() / 100.0,
                self.ac_voice.isChecked(), seconds=5.0)

        def done(paths):
            original, cleaned = paths
            QDesktopServices.openUrl(QUrl.fromLocalFile(original))
            QDesktopServices.openUrl(QUrl.fromLocalFile(cleaned))
            self.status.setText(f"Preview files: {cleaned}")

        self._run(task, done, self._cleanup_tool.check().available)

    def _cleanup_process(self):
        clip = self._clip(self.ac_clip)
        path = self._media_path_for_clip(clip)
        if not path:
            return
        out, _ = QFileDialog.getSaveFileName(self, "Save cleaned audio",
                                              Path(path).stem + "_clean.wav")
        if not out:
            return

        def task(progress, should_cancel):
            return self._cleanup_tool.process(
                path, out, self.ac_intensity.value() / 100.0,
                self.ac_voice.isChecked(), progress=progress,
                should_cancel=should_cancel)

        def done(p):
            self.controller.import_files([p])
            self.status.setText(f"Cleaned audio imported: {p}")

        self._run(task, done, self._cleanup_tool.check().available)

    # ----------------------------------------------------------- assistant
    def _assistant_tab(self) -> QWidget:
        tab = QWidget()
        layout = QVBoxLayout(tab)
        self.assistant = LocalAssistant()
        layout.addWidget(_status_banner(self.assistant.check()))
        self.assistant_output = QTextEdit()
        self.assistant_output.setReadOnly(True)
        self.assistant_output.setPlaceholderText(
            "Suggestions appear here. The assistant cannot modify the timeline.")
        layout.addWidget(self.assistant_output, 1)
        self.assistant_input = QLineEdit()
        self.assistant_input.setPlaceholderText(
            "Ask: how should I structure this 60-second vertical edit?")
        send = QPushButton("Ask local model")
        send.setObjectName("Primary")
        send.clicked.connect(self._ask_assistant)
        row = QHBoxLayout()
        row.addWidget(self.assistant_input, 1)
        row.addWidget(send)
        layout.addLayout(row)
        banner = QLabel("The assistant is advisory only — no edits are applied without you.")
        banner.setObjectName("Dim")
        layout.addWidget(banner)
        return tab

    def _ask_assistant(self):
        question = self.assistant_input.text().strip()
        if not question:
            return
        if not self.assistant.check().available:
            QMessageBox.warning(self, "Assistant", self.assistant.check().reason)
            return

        def task(progress, should_cancel):
            return self.assistant.suggest_workflow(self.controller.project, question)

        def done(reply):
            self.assistant_output.setPlainText(reply)
            self.status.setText("Suggestion received — apply manually if you agree")

        self._run(task, done, True)
