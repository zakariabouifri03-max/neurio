"""Audio studio: waveform, trim, normalize, EQ, fade, silence cut, recording."""

from __future__ import annotations

import subprocess
from pathlib import Path

from PySide6.QtCore import QSize, Qt
from PySide6.QtGui import QColor, QImage, QPainter, QPixmap
from PySide6.QtWidgets import (
    QComboBox, QDoubleSpinBox, QFileDialog, QFormLayout, QGroupBox, QHBoxLayout,
    QLabel, QLineEdit, QMessageBox, QProgressBar, QPushButton, QVBoxLayout,
    QWidget,
)

from ...core.jobs import Job
from ...services import audio_ops, converter


class AudioPanel(QWidget):
    def __init__(self, runner, tr=str, parent=None):
        super().__init__(parent)
        self.runner = runner
        self.tr = tr
        self.path: str | None = None
        self.duration = 0.0
        self._rec_proc = None
        self._build()
        self.runner.job_finished.connect(self._done)

    def _build(self):
        root = QVBoxLayout(self)

        load_row = QHBoxLayout()
        self.file_label = QLineEdit(); self.file_label.setReadOnly(True)
        self.file_label.setPlaceholderText("Load an audio or video file…")
        b_load = QPushButton("Open…")
        b_load.clicked.connect(self.load_file)
        b_record = QPushButton("🎙 Record")
        b_record.clicked.connect(self.toggle_record)
        self.rec_spin = QDoubleSpinBox(); self.rec_spin.setRange(1, 600); self.rec_spin.setValue(30)
        self.rec_spin.setSuffix(" s")
        load_row.addWidget(self.file_label, 1); load_row.addWidget(b_load)
        load_row.addWidget(self.rec_spin); load_row.addWidget(b_record)
        root.addLayout(load_row)

        self.wave = QLabel(alignment=Qt.AlignCenter)
        self.wave.setMinimumHeight(140)
        self.wave.setStyleSheet("background:#101216; border-radius:8px;")
        self.wave.setText("Waveform")
        root.addWidget(self.wave)

        info = QLabel("")
        info.setObjectName("hint")
        self.info = info
        root.addWidget(info)

        ops = QGroupBox("Operations (each writes a real output file)")
        f = QFormLayout(ops)
        trim = QHBoxLayout()
        self.t_start = QDoubleSpinBox(); self.t_start.setRange(0, 99999)
        self.t_end = QDoubleSpinBox(); self.t_end.setRange(0, 99999); self.t_end.setValue(10)
        b_trim = QPushButton("Trim → file")
        b_trim.clicked.connect(self.trim)
        trim.addWidget(QLabel("from")); trim.addWidget(self.t_start)
        trim.addWidget(QLabel("to")); trim.addWidget(self.t_end)
        trim.addWidget(b_trim); trim.addStretch(1)
        f.addRow("Cut / trim", trim)

        b_norm = QPushButton("Normalise loudness")
        b_norm.clicked.connect(self.normalize)
        f.addRow("", b_norm)

        fade = QHBoxLayout()
        self.f_in = QDoubleSpinBox(); self.f_in.setRange(0, 60); self.f_in.setValue(0.5)
        self.f_out = QDoubleSpinBox(); self.f_out.setRange(0, 60); self.f_out.setValue(1.0)
        b_fade = QPushButton("Apply fades")
        b_fade.clicked.connect(self.fade)
        fade.addWidget(QLabel("in")); fade.addWidget(self.f_in)
        fade.addWidget(QLabel("out")); fade.addWidget(self.f_out)
        fade.addWidget(b_fade); fade.addStretch(1)
        f.addRow("Fade", fade)

        eq = QHBoxLayout()
        self.eq_bass = QDoubleSpinBox(); self.eq_bass.setRange(-20, 20); self.eq_bass.setSuffix(" dB @ 80 Hz")
        self.eq_mid = QDoubleSpinBox(); self.eq_mid.setRange(-20, 20); self.eq_mid.setSuffix(" dB @ 1 kHz")
        self.eq_treble = QDoubleSpinBox(); self.eq_treble.setRange(-20, 20); self.eq_treble.setSuffix(" dB @ 8 kHz")
        b_eq = QPushButton("Apply EQ")
        b_eq.clicked.connect(self.equalize)
        eq.addWidget(self.eq_bass); eq.addWidget(self.eq_mid); eq.addWidget(self.eq_treble)
        eq.addWidget(b_eq); eq.addStretch(1)
        f.addRow("Equalizer", eq)

        sil = QHBoxLayout()
        self.sil_thresh = QDoubleSpinBox(); self.sil_thresh.setRange(-90, -10); self.sil_thresh.setValue(-35)
        self.sil_min = QDoubleSpinBox(); self.sil_min.setRange(0.1, 10); self.sil_min.setValue(0.8)
        b_sil = QPushButton("Detect")
        b_cut = QPushButton("Remove silence → file")
        b_sil.clicked.connect(self.detect_silence)
        b_cut.clicked.connect(self.remove_silence)
        sil.addWidget(self.sil_thresh); sil.addWidget(self.sil_min)
        sil.addWidget(b_sil); sil.addWidget(b_cut); sil.addStretch(1)
        f.addRow("Silence (dB / min s)", sil)

        speed = QHBoxLayout()
        self.speed = QDoubleSpinBox(); self.speed.setRange(0.25, 4.0); self.speed.setValue(1.0)
        self.speed.setSingleStep(0.25)
        b_speed = QPushButton("Change tempo → file")
        b_speed.clicked.connect(self.change_speed)
        speed.addWidget(self.speed); speed.addWidget(b_speed); speed.addStretch(1)
        f.addRow("Tempo", speed)

        exp = QHBoxLayout()
        self.export_preset = QComboBox()
        from ...services.presets import AUDIO_PRESETS
        for pid, p in AUDIO_PRESETS.items():
            self.export_preset.addItem(p.label, pid)
        b_exp = QPushButton("Export / convert…")
        b_exp.clicked.connect(self.export_audio)
        exp.addWidget(self.export_preset); exp.addWidget(b_exp); exp.addStretch(1)
        f.addRow("Export", exp)

        root.addWidget(ops)
        self.progress = QProgressBar(); self.progress.setRange(0, 0)
        self.progress.setVisible(False)
        root.addWidget(self.progress)

    # ------------------------------------------------------------------
    def _require(self) -> bool:
        if not self.path:
            QMessageBox.warning(self, self.tr("common.warning"), "Load a file first.")
            return False
        return True

    def load_file(self):
        path, _ = QFileDialog.getOpenFileName(
            self, "Open media", "",
            "Audio/Video (*.mp3 *.wav *.m4a *.aac *.ogg *.flac *.mp4 *.mov *.mkv *.webm)")
        if path:
            self.path = path
            self.file_label.setText(path)
            self._draw_waveform()

    def _draw_waveform(self):
        try:
            peaks, dur = audio_ops.waveform_peaks(self.path, buckets=800)
        except Exception as e:
            self.wave.setText(f"no audio stream: {e}")
            return
        self.duration = dur
        w, h = max(400, self.wave.width()), max(120, self.wave.height())
        img = QImage(w, h, QImage.Format_ARGB32)
        img.fill(QColor("#101216"))
        p = QPainter(img)
        p.setPen(QColor("#3b6ef5"))
        n = peaks.size
        mid = h / 2
        for i in range(min(n, w)):
            idx = int(i * n / w)
            v = float(peaks[idx]) * (h / 2 - 4)
            p.drawLine(i, int(mid - v), i, int(mid + v))
        p.end()
        self.wave.setPixmap(QPixmap.fromImage(img))
        self.info.setText(f"{Path(self.path).name} — {dur:.2f}s")
        self.t_end.setValue(min(dur, 10))

    def resizeEvent(self, ev):
        super().resizeEvent(ev)
        if self.path:
            self._draw_waveform()

    # ------------------------------------------------------------------
    def _submit(self, fn, title, args):
        job = Job(fn=lambda report, cancel, a=args: fn(*a), title=title)
        self.progress.setVisible(True)
        self.runner.submit(job)

    def _dest(self, name) -> str | None:
        path, _ = QFileDialog.getSaveFileName(self, "Save as", name)
        return path or None

    def trim(self):
        if not self._require():
            return
        dest = self._dest(Path(self.path).stem + "_trim.wav")
        if dest:
            self._submit(converter.trim_audio, "Trim audio",
                         (self.path, dest, self.t_start.value(), self.t_end.value()))

    def normalize(self):
        if not self._require():
            return
        dest = self._dest(Path(self.path).stem + "_normalized.wav")
        if dest:
            self._submit(audio_ops.normalize, "Normalise", (self.path, dest))

    def fade(self):
        if not self._require():
            return
        dest = self._dest(Path(self.path).stem + "_faded.wav")
        if dest:
            self._submit(audio_ops.fade, "Fade", (self.path, dest,
                                                  self.f_in.value(), self.f_out.value()))

    def equalize(self):
        if not self._require():
            return
        dest = self._dest(Path(self.path).stem + "_eq.wav")
        if dest:
            bands = {"80": self.eq_bass.value(), "1000": self.eq_mid.value(),
                     "8000": self.eq_treble.value()}
            self._submit(audio_ops.equalize, "Equalize", (self.path, dest, bands))

    def detect_silence(self):
        if not self._require():
            return
        try:
            spans = audio_ops.detect_silence(self.path, self.sil_thresh.value(),
                                              self.sil_min.value())
        except Exception as e:
            QMessageBox.critical(self, self.tr("common.error"), str(e)); return
        if not spans:
            QMessageBox.information(self, self.tr("common.info"),
                                    "No silence found with these settings.")
        else:
            text = "\n".join(f"{s.start:7.2f}s → {s.end:7.2f}s ({s.length:.2f}s)"
                             for s in spans)
            QMessageBox.information(self, "Silent spans", text)

    def remove_silence(self):
        if not self._require():
            return
        dest = self._dest(Path(self.path).stem + "_nosilence.wav")
        if dest:
            self._submit(audio_ops.remove_silence, "Remove silence",
                         (self.path, dest, self.sil_thresh.value(), self.sil_min.value()))

    def change_speed(self):
        if not self._require():
            return
        dest = self._dest(Path(self.path).stem + f"_{self.speed.value():g}x.wav")
        if dest:
            self._submit(audio_ops.speed_change, "Change tempo",
                         (self.path, dest, self.speed.value()))

    def export_audio(self):
        if not self._require():
            return
        preset_id = self.export_preset.currentData()
        from ...services.presets import AUDIO_PRESETS
        preset = AUDIO_PRESETS[preset_id]
        dest = self._dest(Path(self.path).stem + "." + preset.container)
        if dest:
            self._submit(converter.convert_audio, "Export audio",
                         (self.path, dest, preset_id))

    # ------------------------------------------------------------------
    def toggle_record(self):
        if self._rec_proc:
            self._rec_proc.terminate()
            self._rec_proc = None
            QMessageBox.information(self, self.tr("common.info"), "Recording stopped.")
            return
        dest = QFileDialog.getSaveFileName(self, "Save recording", "recording.wav",
                                           "WAV (*.wav)")[0]
        if not dest:
            return
        try:
            cmd = audio_ops.record_command(dest, duration=self.rec_spin.value())
        except Exception as e:
            QMessageBox.critical(self, self.tr("common.error"), str(e)); return
        self._rec_proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL,
                                          stderr=subprocess.DEVNULL)
        QMessageBox.information(self, "Recording…",
                                f"Recording for up to {self.rec_spin.value():.0f}s. "
                                "Press Record again to stop early.")

    def _done(self, job: Job):
        self.progress.setVisible(False)
        if job.result and job.result.ok:
            out = job.result.value
            QMessageBox.information(self, self.tr("common.info"),
                                    f"{job.title} finished:\n{out}")
        elif job.result and job.result.error != "cancelled":
            QMessageBox.critical(self, self.tr("common.error"), job.result.error)
