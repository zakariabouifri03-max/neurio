"""Media converter & utility center — every tool performs a real operation."""

from __future__ import annotations

import json
from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QDoubleSpinBox, QFileDialog, QFormLayout, QGroupBox,
    QHBoxLayout, QLabel, QLineEdit, QListWidget, QListWidgetItem, QMessageBox,
    QProgressBar, QPushButton, QSpinBox, QTabWidget, QPlainTextEdit,
    QVBoxLayout, QWidget,
)

from ...core.jobs import Job
from ...services import converter, subtitles
from ...services.converter import ConvertError


class ConverterPanel(QWidget):
    def __init__(self, runner, tr=str, parent=None):
        super().__init__(parent)
        self.runner = runner
        self.tr = tr
        self.tabs = QTabWidget(self)
        v = QVBoxLayout(self)
        v.addWidget(self.tabs)
        self.progress = QProgressBar(); self.progress.setRange(0, 0)
        self.progress.setVisible(False)
        v.addWidget(self.progress)
        self.status = QLabel(""); self.status.setObjectName("hint")
        v.addWidget(self.status)

        self.tabs.addTab(self._video_tab(), "Video")
        self.tabs.addTab(self._audio_tab(), "Audio")
        self.tabs.addTab(self._image_tab(), "Images")
        self.tabs.addTab(self._gif_tab(), "GIF maker")
        self.tabs.addTab(self._metadata_tab(), "Metadata")
        self.tabs.addTab(self._batch_tab(), "Batch tools")
        self.tabs.addTab(self._subtitle_tab(), "Subtitles")
        self.runner.job_finished.connect(self._done)

    # ------------------------------------------------------------------
    def _pick_files(self, listw: QListWidget, filter_: str):
        files, _ = QFileDialog.getOpenFileNames(self, "Choose files", "", filter_)
        for f in files:
            item = QListWidgetItem(Path(f).name)
            item.setData(Qt.UserRole, f)
            listw.addItem(item)

    def _dest(self, default_name: str) -> str | None:
        path, _ = QFileDialog.getSaveFileName(self, "Save as", default_name)
        return path or None

    def _submit(self, fn, title, args):
        job = Job(fn=lambda report, cancel, a=args: fn(*a), title=title)
        self.progress.setVisible(True)
        self.status.setText(f"{title}…")
        self.runner.submit(job)

    # ---- video ---------------------------------------------------------
    def _video_tab(self):
        w = QWidget(); v = QVBoxLayout(w)
        self.v_list = QListWidget(); self.v_list.setSelectionMode(QListWidget.ExtendedSelection)
        add = QPushButton("Add videos…")
        add.clicked.connect(lambda: self._pick_files(
            self.v_list, "Video (*.mp4 *.mov *.mkv *.avi *.webm *.mpg *.wmv)"))
        f = QFormLayout()
        self.v_container = QComboBox(); self.v_container.addItems(["mp4", "mkv", "webm", "gif", "avi"])
        self.v_quality = QComboBox()
        self.v_quality.addItems(["High (CRF 18)", "Balanced (CRF 23)", "Small (CRF 28)", "Tiny (CRF 33)"])
        self.v_scale = QComboBox(); self.v_scale.addItems(["keep", "1920:-2", "1280:-2", "854:-2", "640:-2"])
        f.addRow("Convert to", self.v_container)
        f.addRow("Quality", self.v_quality)
        f.addRow("Resize", self.v_scale)
        go = QPushButton("Convert videos"); go.setObjectName("primary")
        go.clicked.connect(self.convert_videos)
        v.addWidget(self.v_list); v.addWidget(add); v.addLayout(f); v.addWidget(go)

        comp = QGroupBox("Compress a single video")
        cf = QFormLayout(comp)
        self.c_target = QDoubleSpinBox(); self.c_target.setRange(0, 10000); self.c_target.setValue(25)
        self.c_target.setSuffix(" MB  (0 = CRF mode)")
        cf.addRow("Target size", self.c_target)
        c_go = QPushButton("Compress…")
        c_go.clicked.connect(self.compress_video)
        cf.addRow(c_go)
        v.addWidget(comp)
        return w

    def convert_videos(self):
        items = [self.v_list.item(i).data(Qt.UserRole) for i in range(self.v_list.count())]
        if not items:
            return
        crf = [18, 23, 28, 33][self.v_quality.currentIndex()]
        ext = self.v_container.currentText()
        scale = None if self.v_scale.currentIndex() == 0 else self.v_scale.currentText()
        out_dir = QFileDialog.getExistingDirectory(self, "Output folder")
        if not out_dir:
            return

        def fn(*_):
            results = []
            for src in items:
                src = Path(src)
                dest = Path(out_dir) / (src.stem + "." + ext)
                if ext == "gif":
                    converter.make_gif(src, dest, 0, 5, 480, 12)
                else:
                    codec = "libx264"
                    converter.convert_video(src, dest, vcodec=codec, crf=crf, scale=scale)
                results.append(str(dest))
            return results

        self._submit(fn, f"Convert {len(items)} video(s)", ())

    def compress_video(self):
        src, _ = QFileDialog.getOpenFileName(self, "Video to compress", "",
                                             "Video (*.mp4 *.mov *.mkv *.avi *.webm)")
        if not src:
            return
        dest = self._dest(Path(src).stem + "_compressed.mp4")
        if not dest:
            return
        target = self.c_target.value() or None
        self._submit(converter.compress_video, "Compress video", (src, dest, target))

    # ---- audio ---------------------------------------------------------
    def _audio_tab(self):
        w = QWidget(); v = QVBoxLayout(w)
        self.a_list = QListWidget(); self.a_list.setSelectionMode(QListWidget.ExtendedSelection)
        add = QPushButton("Add audio / video files…")
        add.clicked.connect(lambda: self._pick_files(
            self.a_list, "Media (*.mp3 *.wav *.m4a *.aac *.ogg *.flac *.mp4 *.mov *.mkv)"))
        f = QFormLayout()
        self.a_preset = QComboBox()
        from ...services.presets import AUDIO_PRESETS
        for pid, p in AUDIO_PRESETS.items():
            self.a_preset.addItem(p.label, pid)
        self.a_extract = QCheckBox("Extract audio only (strip video)")
        self.a_extract.setChecked(True)
        f.addRow("Output format", self.a_preset)
        f.addRow("", self.a_extract)
        go = QPushButton("Convert audio"); go.setObjectName("primary")
        go.clicked.connect(self.convert_audio)
        v.addWidget(self.a_list); v.addWidget(add); v.addLayout(f); v.addWidget(go)
        return w

    def convert_audio(self):
        items = [self.a_list.item(i).data(Qt.UserRole) for i in range(self.a_list.count())]
        if not items:
            return
        out_dir = QFileDialog.getExistingDirectory(self, "Output folder")
        if not out_dir:
            return
        preset_id = self.a_preset.currentData()
        from ...services.presets import AUDIO_PRESETS
        preset = AUDIO_PRESETS[preset_id]

        def fn(*_):
            results = []
            for src in items:
                src = Path(src)
                dest = Path(out_dir) / (src.stem + "." + preset.container)
                converter.convert_audio(src, dest, preset_id)
                results.append(str(dest))
            return results

        self._submit(fn, f"Convert {len(items)} audio file(s)", ())

    # ---- images ----------------------------------------------------------
    def _image_tab(self):
        w = QWidget(); v = QVBoxLayout(w)
        self.i_list = QListWidget(); self.i_list.setSelectionMode(QListWidget.ExtendedSelection)
        add = QPushButton("Add images…")
        add.clicked.connect(lambda: self._pick_files(
            self.i_list, "Images (*.png *.jpg *.jpeg *.webp *.bmp *.tiff)"))
        f = QFormLayout()
        self.i_fmt = QComboBox(); self.i_fmt.addItems(["png", "jpg", "webp", "bmp", "tiff"])
        self.i_quality = QSpinBox(); self.i_quality.setRange(20, 100); self.i_quality.setValue(90)
        self.i_width = QSpinBox(); self.i_width.setRange(0, 16000); self.i_width.setValue(0)
        self.i_width.setSpecialValueText("keep size")
        f.addRow("Convert to", self.i_fmt)
        f.addRow("Quality (JPG/WebP)", self.i_quality)
        f.addRow("Resize width (0 = keep)", self.i_width)
        go = QPushButton("Convert images"); go.setObjectName("primary")
        go.clicked.connect(self.convert_images)
        v.addWidget(self.i_list); v.addWidget(add); v.addLayout(f); v.addWidget(go)
        return w

    def convert_images(self):
        items = [self.i_list.item(i).data(Qt.UserRole) for i in range(self.i_list.count())]
        if not items:
            return
        out_dir = QFileDialog.getExistingDirectory(self, "Output folder")
        if not out_dir:
            return
        fmt, q, width = self.i_fmt.currentText(), self.i_quality.value(), self.i_width.value()

        def fn(*_):
            results = []
            for src in items:
                src = Path(src)
                dest = Path(out_dir) / (src.stem + "." + fmt)
                if width > 0:
                    converter.resize_image(src, dest, width)
                else:
                    converter.convert_image(src, dest, q)
                results.append(str(dest))
            return results

        self._submit(fn, f"Convert {len(items)} image(s)", ())

    # ---- gif ---------------------------------------------------------------
    def _gif_tab(self):
        w = QWidget(); f = QFormLayout(w)
        self.g_src = QLineEdit(); self.g_src.setReadOnly(True)
        b = QPushButton("…"); b.setMaximumWidth(36)
        b.clicked.connect(lambda: self.g_src.setText(QFileDialog.getOpenFileName(
            self, "Source video", "", "Video (*.mp4 *.mov *.mkv *.avi *.webm)")[0]))
        row = QHBoxLayout(); row.addWidget(self.g_src, 1); row.addWidget(b)
        self.g_start = QDoubleSpinBox(); self.g_start.setRange(0, 99999)
        self.g_dur = QDoubleSpinBox(); self.g_dur.setRange(0.5, 30); self.g_dur.setValue(5)
        self.g_width = QSpinBox(); self.g_width.setRange(64, 1920); self.g_width.setValue(480)
        self.g_fps = QSpinBox(); self.g_fps.setRange(5, 30); self.g_fps.setValue(12)
        f.addRow("Video", row)
        f.addRow("Start (s)", self.g_start)
        f.addRow("Duration (s)", self.g_dur)
        f.addRow("Width", self.g_width)
        f.addRow("FPS", self.g_fps)
        go = QPushButton("Make GIF"); go.setObjectName("primary")
        go.clicked.connect(self.make_gif)
        f.addRow(go)
        return w

    def make_gif(self):
        src = self.g_src.text()
        if not src:
            return
        dest = self._dest(Path(src).stem + ".gif")
        if not dest:
            return
        self._submit(converter.make_gif, "Make GIF",
                     (src, dest, self.g_start.value(), self.g_dur.value(),
                      self.g_width.value(), self.g_fps.value()))

    # ---- metadata --------------------------------------------------------------
    def _metadata_tab(self):
        w = QWidget(); v = QVBoxLayout(w)
        row = QHBoxLayout()
        b_v = QPushButton("Inspect video…")
        b_i = QPushButton("Inspect image…")
        b_v.clicked.connect(lambda: self.inspect("video"))
        b_i.clicked.connect(lambda: self.inspect("image"))
        row.addWidget(b_v); row.addWidget(b_i); row.addStretch(1)
        v.addLayout(row)
        self.meta_out = QPlainTextEdit(); self.meta_out.setReadOnly(True)
        v.addWidget(self.meta_out, 1)
        return w

    def inspect(self, kind):
        if kind == "video":
            path, _ = QFileDialog.getOpenFileName(self, "Video file")
            if not path:
                return
            try:
                report = converter.video_metadata_report(path)
            except Exception as e:
                QMessageBox.critical(self, self.tr("common.error"), str(e)); return
        else:
            path, _ = QFileDialog.getOpenFileName(self, "Image file", "", "Images (*.png *.jpg *.jpeg *.webp *.bmp *.tiff *.gif)")
            if not path:
                return
            try:
                report = converter.image_metadata_report(path)
            except Exception as e:
                QMessageBox.critical(self, self.tr("common.error"), str(e)); return
        self.meta_out.setPlainText(json.dumps(report, indent=2, ensure_ascii=False))

    # ---- batch ----------------------------------------------------------------
    def _batch_tab(self):
        w = QWidget(); v = QVBoxLayout(w)
        self.b_list = QListWidget(); self.b_list.setSelectionMode(QListWidget.ExtendedSelection)
        add = QPushButton("Add files…")
        add.clicked.connect(lambda: self._pick_files(self.b_list, "All files (*)"))
        f = QFormLayout()
        self.b_pattern = QLineEdit("{name}_{index:03d}{ext}")
        self.b_pattern.setToolTip("Tokens: {name} {index} {ext} {date}")
        self.b_start = QSpinBox(); self.b_start.setRange(0, 99999); self.b_start.setValue(1)
        self.b_resize_w = QSpinBox(); self.b_resize_w.setRange(0, 16000); self.b_resize_w.setValue(0)
        self.b_resize_w.setSpecialValueText("off")
        f.addRow("Rename pattern", self.b_pattern)
        f.addRow("Start index", self.b_start)
        f.addRow("Resize width (images)", self.b_resize_w)
        row = QHBoxLayout()
        b_dry = QPushButton("Preview rename")
        b_go = QPushButton("Rename now")
        b_res = QPushButton("Resize images…")
        b_dry.clicked.connect(lambda: self.batch_rename(dry=True))
        b_go.clicked.connect(lambda: self.batch_rename(dry=False))
        b_res.clicked.connect(self.batch_resize)
        row.addWidget(b_dry); row.addWidget(b_go); row.addWidget(b_res)
        v.addWidget(self.b_list); v.addWidget(add); v.addLayout(f); v.addLayout(row)
        return w

    def _batch_files(self):
        return [self.b_list.item(i).data(Qt.UserRole) for i in range(self.b_list.count())]

    def batch_rename(self, dry: bool):
        files = self._batch_files()
        if not files:
            return
        try:
            pairs = converter.batch_rename(files, self.b_pattern.text(),
                                           self.b_start.value(), dry_run=dry)
        except Exception as e:
            QMessageBox.critical(self, self.tr("common.error"), str(e)); return
        lines = [f"{a.name}  →  {b.name}" for a, b in pairs]
        self.status.setText(("Preview (nothing changed): " if dry else "Renamed: ")
                            + f"{len(pairs)} files")
        self.meta_out.setPlainText("\n".join(lines))
        self.tabs.setCurrentIndex(4)  # show output in the Metadata tab

    def batch_resize(self):
        files = [f for f in self._batch_files()
                 if Path(f).suffix.lower() in converter.IMAGE_EXTS]
        if not files or self.b_resize_w.value() == 0:
            return
        out_dir = QFileDialog.getExistingDirectory(self, "Output folder")
        if not out_dir:
            return
        width = self.b_resize_w.value()

        def fn(*_):
            return [str(converter.resize_image(f, Path(out_dir) / Path(f).name, width))
                    for f in files]

        self._submit(fn, f"Resize {len(files)} images", ())

    # ---- subtitles --------------------------------------------------------------
    def _subtitle_tab(self):
        w = QWidget(); f = QFormLayout(w)
        self.s_src = QLineEdit(); self.s_src.setReadOnly(True)
        b = QPushButton("…"); b.setMaximumWidth(36)
        b.clicked.connect(lambda: self.s_src.setText(QFileDialog.getOpenFileName(
            self, "Subtitle file", "", "Subtitles (*.srt *.vtt)")[0]))
        row = QHBoxLayout(); row.addWidget(self.s_src, 1); row.addWidget(b)
        self.s_fmt = QComboBox(); self.s_fmt.addItems(["srt", "vtt", "txt"])
        self.s_offset = QDoubleSpinBox(); self.s_offset.setRange(-3600, 3600)
        self.s_offset.setSuffix(" s"); self.s_offset.setDecimals(2)
        f.addRow("Source", row)
        f.addRow("Convert to", self.s_fmt)
        f.addRow("Time shift", self.s_offset)
        go = QPushButton("Convert subtitles"); go.setObjectName("primary")
        go.clicked.connect(self.convert_subs)
        f.addRow(go)
        return w

    def convert_subs(self):
        src = self.s_src.text()
        if not src:
            return
        dest = self._dest(Path(src).stem + "." + self.s_fmt.currentText())
        if not dest:
            return
        try:
            subtitles.convert(src, dest, offset=self.s_offset.value())
            QMessageBox.information(self, self.tr("common.info"),
                                    self.tr("export.success") + f"\n{dest}")
        except Exception as e:
            QMessageBox.critical(self, self.tr("common.error"), str(e))

    # ------------------------------------------------------------------
    def showEvent(self, ev):
        super().showEvent(ev)

    def _done(self, job: Job):
        self.progress.setVisible(False)
        if job.result and job.result.ok:
            value = job.result.value
            n = len(value) if isinstance(value, list) else 1
            self.status.setText(f"✔ {job.title}: {n} output file(s) written")
        elif job.result and job.result.error != "cancelled":
            self.status.setText(f"✖ {job.title}: {job.result.error}")
            QMessageBox.critical(self, self.tr("common.error"), job.result.error)
