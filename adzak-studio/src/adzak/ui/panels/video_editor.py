"""Video editing studio panel.

Real functionality:
- media bin (files copied into the project), drag onto timeline via buttons,
- multi-track timeline with split / trim / move / delete / speed / effects,
- preview frame extracted with FFmpeg at the playhead position,
- undo/redo for timeline mutations,
- export dialog driving the real FFmpeg render pipeline with progress,
- voice-over recording (microphone capture via ffmpeg),
- aspect-ratio and preview-quality controls.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

from PySide6.QtCore import QSize, Qt, QTimer
from PySide6.QtGui import QImage, QPixmap
from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QDialog, QDialogButtonBox, QDoubleSpinBox, QFileDialog,
    QFormLayout, QGroupBox, QHBoxLayout, QLabel, QLineEdit, QListWidget,
    QListWidgetItem, QMenu, QMessageBox, QProgressBar, QPushButton, QSlider,
    QSpinBox, QSplitter, QToolButton, QVBoxLayout, QWidget,
)

from ...core.ffmpeg import find_ffmpeg, probe, run_ffmpeg
from ...core.jobs import Job
from ...core.logging_setup import get_logger
from ...core.projects import Project
from ...core.undo import Command, UndoStack
from ...services.exporter import RenderSettings, build_render_args, render
from ...services.presets import ASPECT_RATIOS, PRESETS
from ...services.timeline import Clip, Effect, Timeline
from ..widgets.timeline_widget import TimelineWidget

log = get_logger("video_editor")

VIDEO_EXTS = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v", ".mpg", ".wmv"}
AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}


class ExportDialog(QDialog):
    """Real export settings — drives services.exporter."""

    def __init__(self, timeline: Timeline, project: Project, settings, tr=str, parent=None):
        super().__init__(parent)
        self.timeline, self.project, self.app_settings = timeline, project, settings
        self.tr = tr
        self.setWindowTitle(tr("export.title"))
        self.setMinimumWidth(460)
        form = QFormLayout(self)

        self.preset = QComboBox()
        for pid, p in PRESETS.items():
            self.preset.addItem(p.label, pid)
        self.aspect = QComboBox()
        for name, ar in ASPECT_RATIOS.items():
            self.aspect.addItem(ar.name, name)
        self.codec = QComboBox()
        self.codec.addItems(["H.264 (libx264)", "H.265 (libx265, slower)"])
        self.crf = QSpinBox(); self.crf.setRange(10, 40); self.crf.setValue(20)
        self.speed = QComboBox()
        self.speed.addItems(["veryfast (low-end PC)", "medium (balanced)", "slow (best size)"])
        self.speed.setCurrentIndex(0)
        self.srt = QLineEdit(); self.srt.setPlaceholderText("optional .srt path")
        srt_btn = QPushButton("…"); srt_btn.setMaximumWidth(34)
        srt_btn.clicked.connect(self._pick_srt)
        srt_row = QHBoxLayout(); srt_row.addWidget(self.srt, 1); srt_row.addWidget(srt_btn)
        self.size_label = QLabel("")
        self.size_label.setObjectName("hint")

        form.addRow(tr("export.preset"), self.preset)
        form.addRow("Aspect ratio", self.aspect)
        form.addRow("Codec", self.codec)
        form.addRow("Quality (CRF, lower = better)", self.crf)
        form.addRow("Encode speed", self.speed)
        form.addRow("Burn subtitles (.srt)", srt_row)
        form.addRow("Estimated size", self.size_label)

        self.preset.currentIndexChanged.connect(self._update_estimate)
        self.aspect.currentIndexChanged.connect(self._update_estimate)
        self._update_estimate()

        buttons = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        buttons.button(QDialogButtonBox.Ok).setText(tr("export.start"))
        buttons.button(QDialogButtonBox.Cancel).setText(tr("common.cancel"))
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        form.addRow(buttons)

    def _pick_srt(self) -> None:
        p, _ = QFileDialog.getOpenFileName(self, "Subtitles", "", "Subtitles (*.srt *.vtt)")
        if p:
            self.srt.setText(p)

    def _update_estimate(self) -> None:
        p = PRESETS[self.preset.currentData()]
        ar = ASPECT_RATIOS[self.aspect.currentData()]
        mb = p.estimated_size_mb(self.timeline.duration() or 1.0)
        self.size_label.setText(
            f"≈ {mb} MB for {self.timeline.duration():.1f}s "
            f"({ar.w}×{ar.h} @ {p.fps:g} fps)")

    def build_settings(self, out_path: str) -> RenderSettings:
        p = PRESETS[self.preset.currentData()]
        ar = ASPECT_RATIOS[self.aspect.currentData()]
        preview_map = {"full": 1.0, "half": 0.5, "quarter": 0.25}
        return RenderSettings(
            out_path=out_path,
            width=ar.w, height=ar.h, fps=p.fps,
            vcodec="libx265" if self.codec.currentIndex() == 1 else p.vcodec,
            acodec=p.acodec, crf=self.crf.value(),
            x264_preset=self.speed.currentText().split(" ")[0],
            audio_bitrate_k=p.audio_bitrate_k,
            threads=int(self.app_settings.get("render/threads", 0)),
            burn_subtitles=self.srt.text().strip() or None,
            scale_preview=1.0,
        )


class VideoEditorPanel(QWidget):
    def __init__(self, runner, app_settings, tr=str, parent=None):
        super().__init__(parent)
        self.runner = runner
        self.app_settings = app_settings
        self.tr = tr
        self.project: Project | None = None
        self.timeline = Timeline()
        self.undo = UndoStack()
        self.undo.on_change = self._after_edit
        self._export_job: Job | None = None
        self._recording = None

        self._build_ui()
        self._wire()

    # ------------------------------------------------------------------
    def _build_ui(self) -> None:
        root = QVBoxLayout(self)
        root.setContentsMargins(8, 8, 8, 8)

        top = QHBoxLayout()
        self.btn_import = QPushButton(self.tr("action.import_media"))
        self.btn_track = QPushButton(self.tr("timeline.add_track"))
        self.btn_split = QPushButton(self.tr("timeline.split"))
        self.btn_delete = QPushButton(self.tr("timeline.delete"))
        self.btn_export = QPushButton(self.tr("export.title"))
        self.btn_export.setObjectName("primary")
        self.btn_record = QPushButton("🎙 Record voice-over")
        self.aspect = QComboBox()
        for name, ar in ASPECT_RATIOS.items():
            self.aspect.addItem(name, name)
        top.addWidget(self.btn_import); top.addWidget(self.btn_track)
        top.addWidget(self.btn_split); top.addWidget(self.btn_delete)
        top.addWidget(self.btn_record)
        top.addStretch(1)
        top.addWidget(QLabel("Aspect")); top.addWidget(self.aspect)
        top.addWidget(self.btn_export)
        root.addLayout(top)

        splitter = QSplitter(Qt.Vertical)

        mid = QHBoxLayout()
        left = QVBoxLayout()
        left.addWidget(QLabel("<b>Media bin</b>"))
        self.bin = QListWidget()
        self.bin.setToolTip("Import video/audio, then use → Video / → Audio to place on the timeline")
        left.addWidget(self.bin, 1)
        place = QHBoxLayout()
        self.to_video = QPushButton("→ Video track")
        self.to_audio = QPushButton("→ Audio track")
        place.addWidget(self.to_video); place.addWidget(self.to_audio)
        left.addLayout(place)

        right = QVBoxLayout()
        self.preview = QLabel(alignment=Qt.AlignCenter)
        self.preview.setMinimumSize(320, 180)
        self.preview.setStyleSheet("background:#000; border-radius:8px;")
        self.preview.setText("Preview")
        right.addWidget(self.preview, 1)
        clipbox = QGroupBox("Selected clip")
        cf = QFormLayout(clipbox)
        self.speed_spin = QDoubleSpinBox()
        self.speed_spin.setRange(-4.0, 4.0); self.speed_spin.setSingleStep(0.25)
        self.speed_spin.setSpecialValueText(" ")
        self.volume_spin = QDoubleSpinBox()
        self.volume_spin.setRange(0.0, 4.0); self.volume_spin.setValue(1.0)
        self.volume_spin.setSingleStep(0.1)
        self.fx_combo = QComboBox()
        self.fx_combo.addItems(["none", "brightness", "contrast", "saturation",
                                "exposure", "hue", "rotate 90°", "rotate 180°",
                                "chroma key (green)", "denoise", "stabilize",
                                "fade in (video)", "fade in (audio)"])
        self.fx_value = QDoubleSpinBox()
        self.fx_value.setRange(-10, 10); self.fx_value.setValue(1.0)
        self.fx_apply = QPushButton("Add effect")
        self.fade_check = QCheckBox("Transition: fade-in on cut")
        cf.addRow("Speed (1 = normal, − = reverse)", self.speed_spin)
        cf.addRow("Volume", self.volume_spin)
        cf.addRow("Effect", self.fx_combo)
        cf.addRow("Effect value", self.fx_value)
        cf.addRow("", self.fx_apply)
        cf.addRow("", self.fade_check)
        right.addWidget(clipbox)
        mid_widget = QWidget(); mid_widget.setLayout(mid)
        mid.addLayout(left, 2); mid.addLayout(right, 3)
        splitter.addWidget(mid_widget)

        tl_widget = QWidget(); tl_v = QVBoxLayout(tl_widget); tl_v.setContentsMargins(0, 0, 0, 0)
        self.timeline_widget = TimelineWidget()
        tl_v.addWidget(self.timeline_widget, 1)
        transport = QHBoxLayout()
        self.play_btn = QToolButton(); self.play_btn.setText("▶")
        self.time_label = QLabel("0:00.0 / 0:00.0")
        self.progress = QProgressBar(); self.progress.setRange(0, 1000)
        self.progress.setVisible(False)
        transport.addWidget(self.play_btn); transport.addWidget(self.time_label)
        transport.addWidget(self.progress, 1)
        tl_v.addLayout(transport)
        splitter.addWidget(tl_widget)
        splitter.setSizes([340, 260])
        root.addWidget(splitter, 1)

    def _wire(self) -> None:
        self.btn_import.clicked.connect(self.import_media)
        self.btn_track.clicked.connect(self._add_track_menu)
        self.btn_split.clicked.connect(self.split_at_playhead)
        self.btn_delete.clicked.connect(self.delete_selected)
        self.btn_export.clicked.connect(self.open_export)
        self.btn_record.clicked.connect(self.record_voiceover)
        self.to_video.clicked.connect(lambda: self.place_selected("video"))
        self.to_audio.clicked.connect(lambda: self.place_selected("audio"))
        self.timeline_widget.playhead_changed.connect(self._on_playhead)
        self.timeline_widget.selection_changed.connect(self._on_select)
        self.timeline_widget.clip_moved.connect(self._on_clip_moved)
        self.timeline_widget.clip_trimmed.connect(self._on_clip_trimmed)
        self.timeline_widget.context_menu_requested.connect(self._clip_context_menu)
        self.fx_apply.clicked.connect(self._apply_effect)
        self.fade_check.toggled.connect(self._toggle_fade)
        self.speed_spin.valueChanged.connect(self._set_speed)
        self.volume_spin.valueChanged.connect(self._set_volume)
        self.runner.job_finished.connect(self._job_finished)
        self.runner.job_progress.connect(self._job_progress)
        self._play_timer = QTimer(self)
        self._play_timer.setInterval(100)
        self._play_timer.timeout.connect(self._play_tick)
        self.play_btn.clicked.connect(self.toggle_play)

    # ------------------------------------------------------------------
    def set_project(self, project: Project | None) -> None:
        self.project = project
        self.bin.clear()
        self.undo.clear()
        if project is None:
            self.timeline = Timeline()
        else:
            self.timeline = Timeline.from_dict(project.state.get("timeline", {"fps": 30}))
            for entry in project.state.get("bin", []):
                item = QListWidgetItem(Path(entry).name)
                item.setData(Qt.UserRole, entry)
                self.bin.addItem(item)
        self.timeline_widget.set_timeline(self.timeline)
        self.timeline_widget.update()
        self._refresh_time_label()

    def _after_edit(self) -> None:
        self.timeline_widget.update()
        if self.project:
            self.project.state["timeline"] = self.timeline.to_dict()
            self.project.dirty = True
        self._refresh_time_label()

    # ------------------------------------------------------------------
    def import_media(self) -> None:
        if not self.project:
            QMessageBox.warning(self, self.tr("common.warning"),
                                "Create or open a project first.")
            return
        files, _ = QFileDialog.getOpenFileNames(
            self, self.tr("action.import_media"), "",
            "Media (*.mp4 *.mov *.mkv *.avi *.webm *.mp3 *.wav *.m4a *.aac *.ogg *.flac *.png *.jpg)")
        for f in files:
            try:
                dest = self.project.import_media(f)
            except OSError as e:
                QMessageBox.critical(self, self.tr("common.error"), str(e))
                continue
            self.project.state.setdefault("bin", []).append(str(dest))
            item = QListWidgetItem(dest.name)
            item.setData(Qt.UserRole, str(dest))
            self.bin.addItem(item)
        self.project.dirty = True

    def place_selected(self, kind: str) -> None:
        item = self.bin.currentItem()
        if not item or not self.project:
            return
        path = item.data(Qt.UserRole)
        try:
            info = probe(path)
        except Exception as e:
            QMessageBox.critical(self, self.tr("common.error"),
                                 self.tr("common.error") + f": {e}")
            return
        track_kind = kind
        if kind == "video" and info.video_stream is None and info.audio_stream:
            track_kind = "audio"
        track = self._ensure_track(track_kind)
        if info.video_stream is not None and track_kind == "video":
            w, h = self._project_resolution()
            if info.video_stream.width and info.video_stream.width > max(w, 2560):
                QMessageBox.information(
                    self, self.tr("common.info"),
                    "This clip is very high-resolution. Consider enabling proxy "
                    "editing (Settings → preview quality) on low-end hardware.")
        clip = Clip(source=path, start=self.timeline_widget.playhead,
                    name=Path(path).name, source_duration=info.duration,
                    out_point=info.duration or None)
        snapshot = self.timeline.to_dict()
        self.timeline.add_clip(track, clip)
        self.undo.push(Command(f"add {clip.name}", lambda: None,
                               lambda: self._restore(snapshot)), execute=False)
        self._after_edit()

    def _ensure_track(self, kind: str):
        for t in self.timeline.tracks:
            if t.kind == kind:
                return t
        return self.timeline.add_track(kind)

    def _project_resolution(self) -> tuple[int, int]:
        if self.project:
            s = self.project.state.get("settings", {})
            return s.get("width", 1920), s.get("height", 1080)
        return 1920, 1080

    def _add_track_menu(self) -> None:
        menu = QMenu(self)
        menu.addAction("Video track", lambda: self._add_track("video"))
        menu.addAction("Audio track", lambda: self._add_track("audio"))
        menu.exec(self.btn_track.mapToGlobal(self.btn_track.rect().bottomLeft()))

    def _add_track(self, kind: str) -> None:
        snapshot = self.timeline.to_dict()
        self.timeline.add_track(kind)
        self.undo.push(Command("add track", lambda: None,
                               lambda: self._restore(snapshot)), execute=False)
        self._after_edit()

    def _restore(self, snapshot: dict) -> None:
        self.timeline = Timeline.from_dict(json.loads(json.dumps(snapshot)))
        self.timeline_widget.set_timeline(self.timeline)
        self._after_edit()

    # ------------------------------------------------------------------
    def split_at_playhead(self) -> None:
        t = self.timeline_widget.playhead
        clip = self._selected_clip()
        targets = [clip] if clip else []
        if not targets:
            for track in self.timeline.tracks:
                c = track.clip_at(t)
                if c:
                    targets.append(c)
        if not targets:
            return
        snapshot = self.timeline.to_dict()
        for c in targets:
            self.timeline.split_clip(c.id, t)
        self.undo.push(Command(self.tr("timeline.split"), lambda: None,
                               lambda: self._restore(snapshot)), execute=False)
        self._after_edit()

    def delete_selected(self) -> None:
        clip = self._selected_clip()
        if not clip:
            return
        snapshot = self.timeline.to_dict()
        self.timeline.remove_clip(clip.id, ripple=True)
        self.undo.push(Command(self.tr("timeline.delete"), lambda: None,
                               lambda: self._restore(snapshot)), execute=False)
        self.timeline_widget.selected_clip = None
        self._after_edit()

    def _selected_clip(self) -> Clip | None:
        loc = self.timeline.find_clip(self.timeline_widget.selected_clip or "")
        return loc[1] if loc else None

    def _on_clip_moved(self, clip_id: str, new_start: float) -> None:
        self.timeline.move_clip(clip_id, new_start)
        self._after_edit()

    def _on_clip_trimmed(self, clip_id: str, side: str, value: float) -> None:
        if side == "in":
            self.timeline.trim_in(clip_id, value)
        else:
            self.timeline.trim_out(clip_id, value)
        self._after_edit()

    def _set_speed(self, value: float) -> None:
        clip = self._selected_clip()
        if clip and value != 0:
            self.timeline.set_speed(clip.id, value)
            self._after_edit()

    def _set_volume(self, value: float) -> None:
        clip = self._selected_clip()
        if clip:
            clip.volume = value
            self._after_edit()

    def _apply_effect(self) -> None:
        clip = self._selected_clip()
        if not clip:
            return
        choice = self.fx_combo.currentText()
        v = self.fx_value.value()
        fx_map = {
            "brightness": ("brightness", {"value": v * 0.1}),
            "contrast": ("contrast", {"value": 1.0 + v * 0.1}),
            "saturation": ("saturation", {"value": 1.0 + v * 0.1}),
            "exposure": ("exposure", {"value": 1.0 + v * 0.05}),
            "hue": ("hue", {"value": v * 10}),
            "rotate 90°": ("rotate", {"degrees": 90}),
            "rotate 180°": ("rotate", {"degrees": 180}),
            "chroma key (green)": ("chroma_key", {"color": "0x00FF00"}),
            "denoise": ("denoise", {"strength": max(1.0, v)}),
            "stabilize": ("stabilize", {}),
            "fade in (video)": ("fade_video", {"duration": 0.5}),
            "fade in (audio)": ("fade_audio", {"duration": 0.5}),
        }
        if choice in fx_map:
            kind, params = fx_map[choice]
            clip.effects = [e for e in clip.effects if e.kind != kind]
            clip.effects.append(Effect(kind, params))
            self._after_edit()

    def _toggle_fade(self, checked: bool) -> None:
        clip = self._selected_clip()
        if clip:
            clip.transition_in = "fade" if checked else None
            self._after_edit()

    def _clip_context_menu(self, clip_id: str, pos) -> None:
        menu = QMenu(self)
        if clip_id:
            self.timeline_widget.selected_clip = clip_id
            menu.addAction(self.tr("timeline.split"), self.split_at_playhead)
            menu.addAction(self.tr("timeline.delete"), self.delete_selected)
        else:
            menu.addAction(self.tr("timeline.add_track"), self._add_track_menu)
        if pos is not None:
            menu.exec(pos)

    # ------------------------------------------------------------------
    def _on_select(self, clip_id: str) -> None:
        clip = self._selected_clip()
        if clip:
            self.speed_spin.blockSignals(True)
            self.volume_spin.blockSignals(True)
            self.speed_spin.setValue(clip.speed)
            self.volume_spin.setValue(clip.volume)
            self.fade_check.blockSignals(True)
            self.fade_check.setChecked(clip.transition_in == "fade")
            self.speed_spin.blockSignals(False)
            self.volume_spin.blockSignals(False)
            self.fade_check.blockSignals(False)

    def _on_playhead(self, t: float) -> None:
        self._refresh_time_label()
        self._show_preview_frame(t)

    def _refresh_time_label(self) -> None:
        t = self.timeline_widget.playhead
        d = self.timeline.duration()
        def fmt(x): return f"{int(x // 60)}:{x % 60:04.1f}"
        self.time_label.setText(f"{fmt(t)} / {fmt(d)}")

    def _show_preview_frame(self, t: float) -> None:
        """Extract the frame at the playhead from the top-most clip there."""
        if not find_ffmpeg():
            self.preview.setText(self.tr("error.no_ffmpeg"))
            return
        clip = None
        for track in self.timeline.tracks:
            if track.kind != "video":
                continue
            clip = track.clip_at(t)
            if clip:
                break
        if not clip:
            self.preview.setText("— no clip at playhead —")
            return
        src_t = clip.in_resolved + (t - clip.start) * abs(clip.speed)
        quality = self.app_settings.get("preview/resolution", "half")
        scale = {"full": 960, "half": 480, "quarter": 240}.get(quality, 480)
        from ...core import paths
        stamp = int(time.time() * 1000) % 1000000
        tmp = paths.cache_dir() / f"prev_{stamp}.jpg"
        try:
            proc = run_ffmpeg(["-ss", f"{max(src_t, 0):.3f}", "-i", clip.source,
                               "-frames:v", "1", "-vf", f"scale={scale}:-1",
                               "-q:v", "5", str(tmp)], timeout=30)
        except Exception as e:
            self.preview.setText(f"preview unavailable: {str(e)[:60]}")
            return
        if proc.returncode == 0 and tmp.is_file():
            img = QImage(str(tmp))
            if not img.isNull():
                self.preview.setPixmap(
                    QPixmap.fromImage(img).scaled(
                        self.preview.size(), Qt.KeepAspectRatio, Qt.SmoothTransformation))
                return
        self.preview.setText("preview unavailable")

    # ------------------------------------------------------------------
    def toggle_play(self) -> None:
        if self._play_timer.isActive():
            self._play_timer.stop()
            self.play_btn.setText("▶")
        else:
            self._play_timer.start()
            self.play_btn.setText("⏸")

    def _play_tick(self) -> None:
        t = self.timeline_widget.playhead + 0.1
        if t > self.timeline.duration():
            t = 0.0
            self.toggle_play()
        self.timeline_widget.playhead = t
        self.timeline_widget.playhead_changed.emit(t)
        self.timeline_widget.update()

    # ------------------------------------------------------------------
    def record_voiceover(self) -> None:
        if not self.project or not find_ffmpeg():
            return
        from ...services.audio_ops import record_command
        dest = self.project.media_dir / f"voiceover_{int(time.time())}.wav"
        cmd = record_command(dest, duration=120)
        reply = QMessageBox.question(
            self, "Record voice-over",
            "Record from your default microphone for up to 2 minutes?\n"
            "Press OK to start; press the button again to stop.\n\n"
            f"Command: {' '.join(cmd[:6])} …")
        if reply != QMessageBox.StandardButton.Yes:
            return
        import subprocess
        self._recording = subprocess.Popen(cmd, stdout=subprocess.DEVNULL,
                                           stderr=subprocess.DEVNULL)
        self.btn_record.setText("⏹ Stop recording")
        self.btn_record.clicked.disconnect()
        self.btn_record.clicked.connect(self._stop_recording)

    def _stop_recording(self) -> None:
        if self._recording:
            self._recording.terminate()
            try:
                self._recording.wait(timeout=5)
            except Exception:
                self._recording.kill()
            self._recording = None
        self.btn_record.setText("🎙 Record voice-over")
        self.btn_record.clicked.disconnect()
        self.btn_record.clicked.connect(self.record_voiceover)
        latest = sorted(self.project.media_dir.glob("voiceover_*.wav"))
        if latest:
            self.project.state.setdefault("bin", []).append(str(latest[-1]))
            item = QListWidgetItem(latest[-1].name)
            item.setData(Qt.UserRole, str(latest[-1]))
            self.bin.addItem(item)
            QMessageBox.information(self, self.tr("common.info"),
                                    f"Recorded {latest[-1].name}. Use '→ Audio track' to place it.")

    # ------------------------------------------------------------------
    def open_export(self) -> None:
        if not self.project:
            return
        if self.timeline.duration() <= 0:
            QMessageBox.warning(self, self.tr("common.warning"),
                                "The timeline is empty — add clips first.")
            return
        if not find_ffmpeg():
            QMessageBox.critical(self, self.tr("common.error"), self.tr("error.no_ffmpeg"))
            return
        dlg = ExportDialog(self.timeline, self.project, self.app_settings, self.tr, self)
        if dlg.exec() != QDialog.Accepted:
            return
        out = self.project.export_dir / f"{self.project.meta.name}_{int(time.time())}.mp4"
        rs = dlg.build_settings(str(out))
        tl_copy = Timeline.from_dict(json.loads(json.dumps(self.timeline.to_dict())))

        def work(report, cancel_event):
            def progress_cb(frac):
                report(frac, "encoding")
                if cancel_event.is_set():
                    raise RuntimeError("cancelled")
            return render(tl_copy, rs, on_progress=progress_cb,
                          cancel=cancel_event.is_set)

        job = Job(fn=work, title=f"Export {out.name}")
        self._export_job = job
        self.progress.setVisible(True)
        self.progress.setValue(0)
        self.runner.submit(job)

    def _job_progress(self, job: Job) -> None:
        if job is self._export_job:
            self.progress.setValue(int(job.progress * 1000))

    def _job_finished(self, job: Job) -> None:
        if job is not self._export_job:
            return
        self.progress.setVisible(False)
        if job.result and job.result.ok:
            out = Path(job.result.value)
            reply = QMessageBox.information(
                self, self.tr("export.title"),
                self.tr("export.success") + f"\n{out}\n({out.stat().st_size / 1e6:.1f} MB)")
        else:
            QMessageBox.critical(self, self.tr("export.failed"),
                                 (job.result.error if job.result else "unknown error"))
        self._export_job = None
