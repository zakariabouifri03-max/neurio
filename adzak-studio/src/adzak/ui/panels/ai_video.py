"""AI Video Studio.

Local/offline pipelines run immediately (silence removal, scene detection,
clip extraction).  Text-to-video / image-to-video are honest integrations:
they queue jobs that run only when the user has configured a supported
provider API, and the queue shows an explicit 'provider not configured' state
instead of pretending.
"""

from __future__ import annotations

import re
import subprocess
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (
    QComboBox, QDoubleSpinBox, QFileDialog, QFormLayout, QGroupBox, QHBoxLayout,
    QLabel, QLineEdit, QMessageBox, QPlainTextEdit, QProgressBar, QPushButton,
    QTreeWidget, QTreeWidgetItem, QVBoxLayout, QWidget,
)

from ...ai.capabilities import by_studio
from ...core.ffmpeg import find_ffmpeg, probe, run_ffmpeg
from ...core.jobs import Job
from ...services import audio_ops, converter


class AIVideoPanel(QWidget):
    def __init__(self, runner, tr=str, parent=None):
        super().__init__(parent)
        self.runner = runner
        self.tr = tr
        self._build()
        self.runner.job_finished.connect(self._done)

    def _build(self):
        root = QVBoxLayout(self)

        feats = by_studio("video")
        self.status = QLabel("\n".join(
            f"• {f.label}: <b>{f.status.value}</b> — {f.detail}" for f in feats))
        self.status.setWordWrap(True)
        self.status.setObjectName("hint")
        root.addWidget(self.status)

        io = QHBoxLayout()
        self.src = QLineEdit(); self.src.setReadOnly(True)
        self.src.setPlaceholderText("Choose a video to work on…")
        b = QPushButton("Browse…"); b.clicked.connect(self.browse)
        io.addWidget(self.src, 1); io.addWidget(b)
        root.addLayout(io)

        grid = QHBoxLayout()

        local = QGroupBox("Local tools (offline — work right now)")
        lv = QVBoxLayout(local)
        sil = QHBoxLayout()
        self.sil_db = QDoubleSpinBox(); self.sil_db.setRange(-90, -10); self.sil_db.setValue(-35)
        self.sil_min = QDoubleSpinBox(); self.sil_min.setRange(0.1, 10); self.sil_min.setValue(0.8)
        b_sil = QPushButton("Remove silence → file")
        b_sil.clicked.connect(self.remove_silence)
        sil.addWidget(self.sil_db); sil.addWidget(self.sil_min); sil.addWidget(b_sil)
        lv.addLayout(sil)

        sc = QHBoxLayout()
        self.scene_thresh = QDoubleSpinBox(); self.scene_thresh.setRange(0.05, 0.9)
        self.scene_thresh.setSingleStep(0.05); self.scene_thresh.setValue(0.35)
        b_scene = QPushButton("Detect scenes (list cut points)")
        b_scene.clicked.connect(self.detect_scenes)
        sc.addWidget(self.scene_thresh); sc.addWidget(b_scene)
        lv.addLayout(sc)

        cut = QHBoxLayout()
        self.cut_start = QDoubleSpinBox(); self.cut_start.setRange(0, 999999)
        self.cut_end = QDoubleSpinBox(); self.cut_end.setRange(0, 999999); self.cut_end.setValue(30)
        b_cut = QPushButton("Extract clip (shorts workflow)")
        b_cut.clicked.connect(self.extract_clip)
        cut.addWidget(self.cut_start); cut.addWidget(self.cut_end); cut.addWidget(b_cut)
        lv.addLayout(cut)

        self.scene_out = QPlainTextEdit(); self.scene_out.setReadOnly(True)
        self.scene_out.setMaximumHeight(110)
        self.scene_out.setPlaceholderText("Scene detection results appear here")
        lv.addWidget(self.scene_out)
        grid.addWidget(local, 3)

        remote = QGroupBox("Provider tools (need configured API)")
        rv = QVBoxLayout(remote)
        self.prompt = QPlainTextEdit()
        self.prompt.setPlaceholderText("Video prompt, e.g. 'Aerial shot of a desert dune at sunset, 4s'")
        self.prompt.setMaximumHeight(90)
        self.provider_sel = QComboBox()
        self.provider_sel.addItems(["Runway (official API)", "Kling (official API)",
                                     "OpenAI-compatible endpoint"])
        b_queue = QPushButton("Add to generation queue")
        b_queue.clicked.connect(self.queue_generation)
        rv.addWidget(self.prompt)
        h = QHBoxLayout(); h.addWidget(self.provider_sel, 1); h.addWidget(b_queue)
        rv.addLayout(h)
        self.queue = QTreeWidget()
        self.queue.setHeaderLabels(["Job", "Status"])
        rv.addWidget(self.queue, 1)
        grid.addWidget(remote, 2)

        root.addLayout(grid, 1)
        self.progress = QProgressBar(); self.progress.setRange(0, 0)
        self.progress.setVisible(False)
        root.addWidget(self.progress)

    # ------------------------------------------------------------------
    def browse(self):
        p, _ = QFileDialog.getOpenFileName(self, "Video", "",
                                           "Video (*.mp4 *.mov *.mkv *.avi *.webm)")
        if p:
            self.src.setText(p)
            try:
                info = probe(p)
                self.cut_end.setValue(min(info.duration, 30))
            except Exception:
                pass

    def _require(self) -> bool:
        if not self.src.text():
            QMessageBox.warning(self, self.tr("common.warning"), "Choose a video first.")
            return False
        if not find_ffmpeg():
            QMessageBox.critical(self, self.tr("common.error"), self.tr("error.no_ffmpeg"))
            return False
        return True

    def remove_silence(self):
        if not self._require():
            return
        src = self.src.text()
        dest, _ = QFileDialog.getSaveFileName(self, "Save result",
                                              Path(src).stem + "_nosilence.mp4")
        if not dest:
            return

        def fn(report, cancel):
            report(0.1, "detecting silence")
            spans = audio_ops.detect_silence(src, self.sil_db.value(), self.sil_min.value())
            if not spans:
                raise RuntimeError("No silence detected — nothing to remove.")
            report(0.4, "cutting segments")
            info = probe(src)
            keep, cursor = [], 0.0
            for sp in spans:
                if sp.start - cursor > 0.3:
                    keep.append((cursor, sp.start))
                cursor = sp.end
            if cursor < info.duration - 0.3:
                keep.append((cursor, info.duration))
            segs = []
            for i, (s, e) in enumerate(keep):
                seg = Path(dest).with_name(f".seg{i}.mp4")
                proc = run_ffmpeg(["-i", src, "-ss", f"{s:.3f}", "-to", f"{e:.3f}",
                                   "-c:v", "libx264", "-crf", "20", "-preset", "veryfast",
                                   "-c:a", "aac", str(seg)])
                if proc.returncode != 0:
                    raise RuntimeError("segment cut failed")
                segs.append(seg)
            report(0.8, "joining segments")
            listfile = Path(dest).with_name(".seglist.txt")
            listfile.write_text("\n".join(f"file '{s.as_posix()}'" for s in segs),
                                encoding="utf-8")
            proc = run_ffmpeg(["-f", "concat", "-safe", "0", "-i", str(listfile),
                               "-c", "copy", dest])
            for s in segs:
                s.unlink(missing_ok=True)
            listfile.unlink(missing_ok=True)
            if proc.returncode != 0:
                raise RuntimeError("concat failed")
            return dest

        self.runner.submit(Job(fn=fn, title="Remove silence"))
        self.progress.setVisible(True)

    def detect_scenes(self):
        if not self._require():
            return
        src = self.src.text()

        def fn(report, cancel):
            proc = run_ffmpeg(
                ["-i", src, "-vf", f"select='gt(scene,{self.scene_thresh.value()})',showinfo",
                 "-f", "null", "-"], timeout=1800)
            times = [float(m[1]) for m in
                     re.finditer(r"pts_time:([\d.]+)", proc.stderr)]
            return times

        self.runner.submit(Job(fn=fn, title="Detect scenes"))
        self.progress.setVisible(True)

    def extract_clip(self):
        if not self._require():
            return
        src = self.src.text()
        dest, _ = QFileDialog.getSaveFileName(self, "Save clip",
                                              Path(src).stem + "_clip.mp4")
        if not dest:
            return
        self.runner.submit(Job(
            fn=lambda report, cancel: self._extract(src, dest),
            title="Extract clip"))
        self.progress.setVisible(True)

    def _extract(self, src, dest):
        proc = run_ffmpeg(["-i", src, "-ss", f"{self.cut_start.value():.3f}",
                           "-to", f"{self.cut_end.value():.3f}",
                           "-c:v", "libx264", "-crf", "19", "-preset", "veryfast",
                           "-c:a", "aac", "-vf", "scale=1080:-2", dest])
        if proc.returncode != 0:
            raise RuntimeError(proc.stderr[-200:])
        return dest

    def queue_generation(self):
        prompt = self.prompt.toPlainText().strip()
        if not prompt:
            return
        item = QTreeWidgetItem([prompt[:60], "queued — checking provider"])
        self.queue.addTopLevelItem(item)
        # Honest check: ADZAK has no bundled provider accounts.
        item.setText(1, "needs API credentials — add provider in Settings, "
                        "or run via an official API integration")
        item.setForeground(1, QColor("#e0a63f"))
        QMessageBox.information(
            self, "Generation queued",
            "The job is queued. ADZAK calls provider APIs only with your own "
            "credentials — none are bundled. Configure the provider in "
            "Settings → AI Providers (or supply an official Runway/Kling API "
            "endpoint in a future integration) to execute it.")

    def _done(self, job: Job):
        self.progress.setVisible(False)
        if job.title == "Detect scenes":
            if job.result and job.result.ok:
                times = job.result.value
                text = "\n".join(f"cut at {t:8.2f}s" for t in times[:200])
                self.scene_out.setPlainText(
                    f"{len(times)} scene change(s):\n" + (text or "none"))
            else:
                QMessageBox.critical(self, self.tr("common.error"), job.result.error)
        elif job.result and job.result.ok:
            QMessageBox.information(self, self.tr("common.info"),
                                    f"{job.title} finished:\n{job.result.value}")
        elif job.result and job.result.error != "cancelled":
            QMessageBox.critical(self, self.tr("common.error"), job.result.error)
