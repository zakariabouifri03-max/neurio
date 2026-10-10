"""Media converter & utility center, audio studio and AI assistant pages."""
from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt
from PySide6.QtGui import QBrush, QColor
from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QDoubleSpinBox, QFormLayout, QGroupBox, QHBoxLayout, QLabel, QLineEdit,
    QListWidget, QPushButton, QSlider, QSpinBox, QTableWidget, QTableWidgetItem, QTabWidget, QTextEdit,
    QVBoxLayout, QWidget, QHeaderView, QProgressBar,
)

from ..ai import assistant as ai
from ..ai.capabilities import CAPABILITIES, STATUS_LABELS, UNAVAILABLE
from ..audio import tools as audio
from ..core import ffmpeg
from ..core.errors import AppError
from ..core.fileio import human_size
from ..core.i18n import tr
from ..core.paths import temp_dir
from ..utils import converters as conv
from ..utils import subtitles
from ..video import presets
from . import common
from .widgets import WaveformWidget
from .workers import Worker


class Picker(QWidget):
    def __init__(self, mode: str, flt: str = "", placeholder: str = ""):
        super().__init__()
        self.mode = mode  # open | save | dir
        self.flt = flt
        self.edit = QLineEdit()
        self.edit.setPlaceholderText(placeholder)
        btn = QPushButton("…")
        btn.setFixedWidth(34)
        btn.setToolTip("Browse")
        btn.clicked.connect(self._browse)
        lay = QHBoxLayout(self)
        lay.setContentsMargins(0, 0, 0, 0)
        lay.addWidget(self.edit, 1)
        lay.addWidget(btn)

    def path(self) -> str:
        return self.edit.text().strip()

    def set_path(self, p: str) -> None:
        self.edit.setText(p)

    def _browse(self) -> None:
        if self.mode == "open":
            f = common.open_file(self, "Open", self.flt)
        elif self.mode == "save":
            f = common.save_file(self, "Save as", self.edit.text() or "output", self.flt)
        else:
            from PySide6.QtWidgets import QFileDialog
            f = QFileDialog.getExistingDirectory(self, "Folder", self.edit.text() or "")
        if f:
            self.edit.setText(f)


class TaskHost(QWidget):
    """Mixin-style base: runs a backend function in a worker and shows status/progress."""

    def __init__(self):
        super().__init__()
        self._worker: Worker | None = None
        self.status = QLabel("")
        self.status.setWordWrap(True)
        self.status.setObjectName("muted")
        self.progress = QProgressBar()
        self.progress.setVisible(False)

    def run_task(self, fn, label: str, on_done=None) -> None:
        if self._worker is not None:
            common.info(self, "Please wait for the current task to finish.")
            return
        self.status.setText(label)
        self.progress.setVisible(True)
        self.progress.setRange(0, 1000)
        self.progress.setValue(0)
        w = Worker(lambda **kw: fn(kw["progress"], kw["cancel"]))
        w.progress.connect(lambda f: self.progress.setValue(int(f * 1000)))
        w.succeeded.connect(lambda r: self._done(r, on_done))
        w.failed.connect(lambda m: self._failed(m))
        w.finished.connect(self._finished)
        self._worker = w
        w.start()

    def _done(self, result, on_done) -> None:
        self.status.setText(tr("done"))
        if on_done:
            on_done(result)

    def _failed(self, msg: str) -> None:
        self.status.setText(msg)
        if msg != "Cancelled.":
            common.error(self, msg)

    def _finished(self) -> None:
        self.progress.setVisible(False)
        self._worker = None


def _row(form: QFormLayout, label: str, w: QWidget) -> None:
    form.addRow(label, w)


class ConverterPage(TaskHost):
    def __init__(self):
        super().__init__()
        root = QVBoxLayout(self)
        root.addWidget(QLabel("Convert, compress and batch-process media. Everything runs on this computer."))
        self.tabs = QTabWidget()
        root.addWidget(self.tabs, 1)
        root.addWidget(self.progress)
        root.addWidget(self.status)
        self.tabs.addTab(self._video_convert(), "Video convert")
        self.tabs.addTab(self._video_compress(), "Video compress")
        self.tabs.addTab(self._audio_convert(), "Audio convert")
        self.tabs.addTab(self._image_convert(), "Image convert")
        self.tabs.addTab(self._image_compress(), "Image compress")
        self.tabs.addTab(self._batch_resize(), "Batch resize")
        self.tabs.addTab(self._batch_rename(), "Batch rename")
        self.tabs.addTab(self._gif_video(), "GIF from video")
        self.tabs.addTab(self._gif_images(), "GIF from images")
        self.tabs.addTab(self._frames(), "Frames & thumbnail")
        self.tabs.addTab(self._subs(), "Subtitles")
        self.tabs.addTab(self._info(), "Info & size estimate")

    def _page(self, *widgets) -> QWidget:
        w = QWidget()
        v = QVBoxLayout(w)
        for x in widgets:
            v.addWidget(x) if isinstance(x, QWidget) else v.addLayout(x)
        v.addStretch(1)
        return w

    def _button(self, text: str, fn, primary: bool = True) -> QPushButton:
        b = QPushButton(text)
        if primary:
            b.setObjectName("primary")
        b.clicked.connect(fn)
        return b

    def _video_convert(self) -> QWidget:
        inp, out = Picker("open", common.VIDEO_FILTER), Picker("save", "Video (*.mp4 *.mkv *.mov *.webm)")
        f = QFormLayout(); _row(f, "Input video", inp); _row(f, "Output", out)
        go = self._button("Convert", lambda: self.run_task(
            lambda progress, cancel: conv.convert_video(inp.path(), out.path()), "Converting video…",
            lambda p: common.info(self, f"Saved: {p}")))
        return self._page(f, go)

    def _video_compress(self) -> QWidget:
        inp, out = Picker("open", common.VIDEO_FILTER), Picker("save", "MP4 (*.mp4)")
        crf = QSpinBox(); crf.setRange(18, 40); crf.setValue(28)
        crf.setToolTip("Higher = smaller file, lower quality. 23–28 is a good range.")
        mh = QComboBox(); mh.addItems(["Keep original", "720p", "480p"])
        f = QFormLayout(); _row(f, "Input video", inp); _row(f, "Output (.mp4)", out)
        _row(f, "Quality (CRF)", crf); _row(f, "Max height", mh)
        heights = {"Keep original": None, "720p": 720, "480p": 480}

        def done(res):
            p, before, after = res
            common.info(self, f"Saved {p.name}\n{human_size(before)} → {human_size(after)} "
                              f"({100 * (1 - after / max(before, 1)):.0f}% smaller)")
        go = self._button("Compress", lambda: self.run_task(
            lambda progress, cancel: conv.compress_video(inp.path(), out.path(), crf.value(), heights[mh.currentText()]),
            "Compressing video…", done))
        return self._page(f, go)

    def _audio_convert(self) -> QWidget:
        inp = Picker("open", common.MEDIA_FILTER)
        out = Picker("save", "Audio (*.mp3 *.wav *.m4a *.aac *.flac *.ogg *.opus)")
        f = QFormLayout(); _row(f, "Input (audio or video)", inp); _row(f, "Output", out)
        go = self._button("Convert audio", lambda: self.run_task(
            lambda progress, cancel: conv.convert_audio(inp.path(), out.path()), "Converting audio…",
            lambda p: common.info(self, f"Saved: {p}")))
        return self._page(f, go)

    def _image_convert(self) -> QWidget:
        inp = Picker("open", common.IMAGE_FILTER)
        out = Picker("save", "Images (*.png *.jpg *.webp *.bmp *.tiff)")
        q = QSpinBox(); q.setRange(1, 100); q.setValue(90)
        f = QFormLayout(); _row(f, "Input image", inp); _row(f, "Output", out); _row(f, "Quality (JPG/WebP)", q)
        go = self._button("Convert image", lambda: self.run_task(
            lambda progress, cancel: conv.convert_image(inp.path(), out.path(), q.value()), "Converting…",
            lambda p: common.info(self, f"Saved: {p}")))
        return self._page(f, go)

    def _image_compress(self) -> QWidget:
        inp = Picker("open", common.IMAGE_FILTER)
        out = Picker("save", "Images (*.jpg *.webp *.png)")
        q = QSpinBox(); q.setRange(1, 100); q.setValue(75)
        side = QSpinBox(); side.setRange(0, 10000); side.setValue(0); side.setSpecialValueText("No limit")
        side.setSuffix(" px")
        f = QFormLayout(); _row(f, "Input image", inp); _row(f, "Output", out)
        _row(f, "Quality", q); _row(f, "Longest side", side)

        def done(res):
            p, before, after = res
            common.info(self, f"Saved {p.name}\n{human_size(before)} → {human_size(after)}")
        go = self._button("Compress image", lambda: self.run_task(
            lambda progress, cancel: conv.compress_image(inp.path(), out.path(), q.value(),
                                                         side.value() or None),
            "Compressing…", done))
        return self._page(f, go)

    def _file_list(self, flt: str) -> tuple[QListWidget, QPushButton]:
        lst = QListWidget()
        add = QPushButton("Add files…")
        add.clicked.connect(lambda: [lst.addItem(p) for p in common.open_files(self, "Add files", flt)
                                     if not lst.findItems(p, Qt.MatchExactly)])
        clear = QPushButton("Clear")
        clear.clicked.connect(lst.clear)
        return lst, add, clear

    def _batch_resize(self) -> QWidget:
        lst, add, clear = self._file_list(common.IMAGE_FILTER)
        out = Picker("dir")
        w = QSpinBox(); w.setRange(1, 20000); w.setValue(1280)
        h = QSpinBox(); h.setRange(1, 20000); h.setValue(720)
        f = QFormLayout(); _row(f, "Output folder", out); _row(f, "Max width", w); _row(f, "Max height", h)
        files_row = QHBoxLayout(); files_row.addWidget(add); files_row.addWidget(clear)
        go = self._button("Resize all", lambda: self.run_task(
            lambda progress, cancel: conv.batch_resize(self._items(lst), out.path(), w.value(), h.value()),
            "Resizing…", lambda res: common.info(self, f"Resized {len(res)} image(s) into {out.path()}")))
        return self._page(lst, files_row, f, go)

    def _items(self, lst: QListWidget) -> list[str]:
        return [lst.item(i).text() for i in range(lst.count())]

    def _batch_rename(self) -> QWidget:
        lst, add, clear = self._file_list(common.MEDIA_FILTER)
        pattern = QLineEdit("photo_{n:03d}")
        pattern.setToolTip("Tokens: {n} = counter, {n:03d} = zero-padded counter, {name} = original name")
        preview = QTextEdit(); preview.setReadOnly(True)
        files_row = QHBoxLayout(); files_row.addWidget(add); files_row.addWidget(clear)

        def do_preview():
            try:
                pairs = conv.plan_rename(self._items(lst), pattern.text())
                preview.setPlainText("\n".join(f"{o.name}  →  {n.name}" for o, n in pairs))
            except AppError as exc:
                preview.setPlainText(exc.user_message)

        def do_apply():
            try:
                pairs = conv.plan_rename(self._items(lst), pattern.text())
                n = conv.apply_rename(pairs)
            except AppError as exc:
                common.error(self, exc.user_message)
                return
            lst.clear()
            common.info(self, f"Renamed {n} file(s).")
        f = QFormLayout(); _row(f, "Pattern", pattern)
        pv = self._button("Preview names", do_preview, primary=False)
        ap = self._button("Rename files", do_apply)
        return self._page(lst, files_row, f, pv, preview, ap)

    def _gif_video(self) -> QWidget:
        inp = Picker("open", common.VIDEO_FILTER); out = Picker("save", "GIF (*.gif)")
        start = QDoubleSpinBox(); start.setRange(0, 36000); start.setSuffix(" s")
        dur = QDoubleSpinBox(); dur.setRange(1, 30); dur.setValue(5); dur.setSuffix(" s")
        fps = QSpinBox(); fps.setRange(1, 30); fps.setValue(12)
        width = QSpinBox(); width.setRange(32, 1920); width.setValue(480); width.setSuffix(" px")
        f = QFormLayout(); _row(f, "Video", inp); _row(f, "Output", out); _row(f, "Start", start)
        _row(f, "Duration", dur); _row(f, "Frames/s", fps); _row(f, "Width", width)
        go = self._button("Make GIF", lambda: self.run_task(
            lambda progress, cancel: conv.make_gif(inp.path(), out.path(), fps=fps.value(), width=width.value(),
                                                   start=start.value(), duration=dur.value()),
            "Making GIF…", lambda p: common.info(self, f"Saved: {p}")))
        return self._page(f, go)

    def _gif_images(self) -> QWidget:
        lst, add, clear = self._file_list(common.IMAGE_FILTER)
        out = Picker("save", "GIF (*.gif)")
        ms = QSpinBox(); ms.setRange(20, 10000); ms.setValue(500); ms.setSuffix(" ms")
        f = QFormLayout(); _row(f, "Output", out); _row(f, "Frame duration", ms)
        files_row = QHBoxLayout(); files_row.addWidget(add); files_row.addWidget(clear)
        go = self._button("Make animated GIF", lambda: self.run_task(
            lambda progress, cancel: conv.gif_from_images(self._items(lst), out.path(), ms.value()),
            "Making GIF…", lambda p: common.info(self, f"Saved: {p}")))
        return self._page(lst, files_row, f, go)

    def _frames(self) -> QWidget:
        inp = Picker("open", common.VIDEO_FILTER)
        outdir = Picker("dir")
        fps = QDoubleSpinBox(); fps.setRange(0.01, 60); fps.setValue(1.0); fps.setSuffix(" per second")
        t = QDoubleSpinBox(); t.setRange(0, 36000); t.setValue(1.0); t.setSuffix(" s")
        thumb = Picker("save", "PNG (*.png)")
        f = QFormLayout(); _row(f, "Video", inp); _row(f, "Output folder", outdir); _row(f, "Frames per second", fps)
        g = QFormLayout(); _row(g, "Thumbnail time", t); _row(g, "Thumbnail file", thumb)
        go = self._button("Extract frames", lambda: self.run_task(
            lambda progress, cancel: conv.extract_frames(inp.path(), outdir.path(), fps.value()),
            "Extracting frames…", lambda res: common.info(self, f"Extracted {len(res)} frame(s).")))
        go2 = self._button("Extract thumbnail", lambda: self.run_task(
            lambda progress, cancel: conv.extract_thumbnail(inp.path(), thumb.path(), t.value()),
            "Extracting thumbnail…", lambda p: common.info(self, f"Saved: {p}")), primary=False)
        return self._page(f, go, g, go2)

    def _subs(self) -> QWidget:
        inp = Picker("open", "Subtitles (*.srt *.vtt)")
        out = Picker("save", "Subtitles (*.srt *.vtt)")
        shift = QDoubleSpinBox(); shift.setRange(-600, 600); shift.setSuffix(" s")
        shift.setToolTip("Negative moves subtitles earlier, positive later")
        f = QFormLayout(); _row(f, "Input", inp); _row(f, "Output (.srt or .vtt)", out); _row(f, "Timing shift", shift)
        go = self._button("Convert subtitles", lambda: self.run_task(
            lambda progress, cancel: subtitles.convert_file(inp.path(), out.path(), shift.value()),
            "Converting…", lambda p: common.info(self, f"Saved: {p}")))
        notice = QLabel("Automatic subtitles from speech are not available in this build (see Assistant › Capabilities).")
        notice.setObjectName("muted"); notice.setWordWrap(True)
        return self._page(f, go, notice)

    def _info(self) -> QWidget:
        inp = Picker("open", common.MEDIA_FILTER)
        table = QTableWidget(0, 2)
        table.setHorizontalHeaderLabels(["Property", "Value"])
        table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        read = self._button("Read metadata", lambda: self.run_task(
            lambda progress, cancel: conv.metadata(inp.path()), "Reading…", lambda md: self._fill(table, md)))
        dur = QDoubleSpinBox(); dur.setRange(0, 36000); dur.setValue(60); dur.setSuffix(" s")
        vk = QDoubleSpinBox(); vk.setRange(0, 100000); vk.setValue(4000); vk.setSuffix(" kb/s video")
        ak = QDoubleSpinBox(); ak.setRange(0, 1000); ak.setValue(128); ak.setSuffix(" kb/s audio")
        est = QLabel("")
        def estimate():
            b = conv.estimate_size(dur.value(), vk.value(), ak.value())
            est.setText(f"Estimated size: {human_size(b)}")
        calc = self._button("Estimate size", estimate, primary=False)
        f = QFormLayout(); _row(f, "Duration", dur); _row(f, "Video bitrate", vk); _row(f, "Audio bitrate", ak)
        return self._page(inp, read, table, f, calc, est)

    def _fill(self, table: QTableWidget, md) -> None:
        table.setRowCount(len(md.lines))
        for r, (k, v) in enumerate(md.lines):
            table.setItem(r, 0, QTableWidgetItem(k))
            table.setItem(r, 1, QTableWidgetItem(str(v)))

    def export_presets(self) -> None:
        f = common.save_file(self, "Export presets", "adzak-export-presets.json", "JSON (*.json)")
        if f:
            presets.export_presets_json(f)
            common.info(self, f"Presets saved to {f}")


class AudioPage(TaskHost):
    def __init__(self):
        super().__init__()
        self.src = ""
        self.peaks = None
        root = QVBoxLayout(self)
        top = QHBoxLayout()
        self.open_btn = QPushButton("Open audio or video")
        self.open_btn.setObjectName("primary")
        self.open_btn.clicked.connect(self.open_file)
        self.file_lbl = QLabel("No file loaded")
        self.file_lbl.setObjectName("muted")
        top.addWidget(self.open_btn); top.addWidget(self.file_lbl, 1)
        root.addLayout(top)
        self.wave = WaveformWidget()
        root.addWidget(self.wave)
        root.addWidget(self.progress)
        root.addWidget(self.status)
        grid = QHBoxLayout()
        left = QGroupBox("Edit"); lf = QFormLayout(left)
        self.t_start = QDoubleSpinBox(); self.t_start.setRange(0, 36000); self.t_start.setSuffix(" s")
        self.t_end = QDoubleSpinBox(); self.t_end.setRange(0, 36000); self.t_end.setSuffix(" s")
        self.t_end.setToolTip("0 = until the end")
        self.norm = QCheckBox("Normalise loudness to"); self.lufs = QSpinBox(); self.lufs.setRange(-40, -5)
        self.lufs.setValue(-16); self.lufs.setSuffix(" LUFS")
        self.denoise = QSlider(Qt.Horizontal); self.denoise.setRange(0, 60); self.denoise.setValue(0)
        self.denoise.setToolTip("Noise reduction strength (0 = off)")
        self.bass = QDoubleSpinBox(); self.bass.setRange(-20, 20); self.bass.setSuffix(" dB")
        self.treble = QDoubleSpinBox(); self.treble.setRange(-20, 20); self.treble.setSuffix(" dB")
        self.vol = QDoubleSpinBox(); self.vol.setRange(-30, 30); self.vol.setSuffix(" dB")
        self.fin = QDoubleSpinBox(); self.fin.setRange(0, 30); self.fin.setSuffix(" s")
        self.fout = QDoubleSpinBox(); self.fout.setRange(0, 30); self.fout.setSuffix(" s")
        for label, w in (("Start", self.t_start), ("End", self.t_end), ("", self.norm), ("Target", self.lufs),
                         ("Noise reduction", self.denoise), ("Bass", self.bass), ("Treble", self.treble),
                         ("Volume", self.vol), ("Fade in", self.fin), ("Fade out", self.fout)):
            lf.addRow(label, w)
        self.btn_apply = QPushButton("Render edited file…")
        self.btn_apply.setObjectName("primary")
        self.btn_apply.clicked.connect(self.render_edit)
        lf.addRow(self.btn_apply)
        grid.addWidget(left, 2)
        right = QGroupBox("Tools"); rf = QVBoxLayout(right)
        self.btn_extract = QPushButton("Extract audio from a video…")
        self.btn_extract.clicked.connect(self.extract)
        self.merge_list = QListWidget()
        self.merge_list.setToolTip("Files are joined in this order")
        mb = QHBoxLayout()
        add = QPushButton("Add to merge list…"); add.clicked.connect(self._add_merge)
        clr = QPushButton("Clear"); clr.clicked.connect(self.merge_list.clear)
        mb.addWidget(add); mb.addWidget(clr)
        self.btn_merge = QPushButton("Merge list → file…"); self.btn_merge.clicked.connect(self.merge)
        rf.addWidget(self.btn_extract)
        rf.addWidget(QLabel("Merge (in order):"))
        rf.addWidget(self.merge_list)
        rf.addLayout(mb); rf.addWidget(self.btn_merge)
        na = QLabel("Not available in this build: speech-to-text, text-to-speech, voice recording.")
        na.setWordWrap(True); na.setObjectName("warn")
        rf.addWidget(na)
        rf.addStretch(1)
        grid.addWidget(right, 2)
        root.addLayout(grid, 1)
        self._enable(False)

    def _enable(self, on: bool) -> None:
        for w in (self.btn_apply, self.btn_extract):
            w.setEnabled(on)

    def open_file(self) -> None:
        f = common.open_file(self, "Open", common.MEDIA_FILTER)
        if not f:
            return
        try:
            info = ffmpeg.probe(f)
            if not info.has_audio:
                raise AppError("This file has no audio track.")
            self.src = f
            self.file_lbl.setText(f"{Path(f).name} · {info.duration:.1f}s")
            self.t_end.setValue(round(info.duration, 2))
            self._enable(True)
        except AppError as exc:
            common.error(self, exc.user_message)
            return
        self.run_task(lambda progress, cancel: audio.waveform_peaks(f, 900), "Reading waveform…",
                      self._peaks_ready)

    def _peaks_ready(self, peaks) -> None:
        self.peaks = peaks
        self.wave.set_peaks(peaks)

    def render_edit(self) -> None:
        if not self.src:
            return
        out = common.save_file(self, "Save audio", "edited.wav", "Audio (*.wav *.mp3 *.m4a *.flac *.ogg *.opus)")
        if not out:
            return
        start = self.t_start.value()
        end = self.t_end.value() or None
        duration = (end - start) if end else None
        lufs = self.lufs.value() if self.norm.isChecked() else None

        def job(progress, cancel):
            tmp = temp_dir() / f"audio-stage-{Path(out).stem}.wav"
            if start > 0 or end:
                audio.trim(self.src, str(tmp), start, end)
                src = str(tmp)
            else:
                src = self.src
            return audio.process(src, out, normalize_lufs=lufs, denoise=self.denoise.value(),
                                 bass_db=self.bass.value(), treble_db=self.treble.value(),
                                 volume_db=self.vol.value(), fade_in=self.fin.value(),
                                 fade_out=self.fout.value(), duration=duration)
        self.run_task(job, "Rendering…", lambda p: common.info(self, f"Saved: {p}"))

    def extract(self) -> None:
        if not self.src:
            return
        out = common.save_file(self, "Extract audio", "audio.m4a", "Audio (*.m4a *.wav *.mp3 *.flac)")
        if out:
            self.run_task(lambda progress, cancel: audio.extract_audio(self.src, out), "Extracting audio…",
                          lambda p: common.info(self, f"Saved: {p}"))

    def _add_merge(self) -> None:
        for f in common.open_files(self, "Add audio", common.AUDIO_FILTER + ""):
            self.merge_list.addItem(f)

    def merge(self) -> None:
        files = [self.merge_list.item(i).text() for i in range(self.merge_list.count())]
        if len(files) < 2:
            common.info(self, "Add at least two files to the merge list.")
            return
        out = common.save_file(self, "Merged audio", "merged.mp3", "Audio (*.mp3 *.wav *.m4a *.flac *.ogg)")
        if out:
            self.run_task(lambda progress, cancel: audio.merge(files, out), "Merging…",
                          lambda p: common.info(self, f"Saved: {p}"))


class AssistantPage(QWidget):
    def __init__(self, get_settings):
        super().__init__()
        self._get_settings = get_settings
        self._worker: Worker | None = None
        self.offline, self.provider = ai.build_assistant(get_settings())
        root = QVBoxLayout(self)
        self.mode_lbl = QLabel()
        self.mode_lbl.setWordWrap(True)
        root.addWidget(self.mode_lbl)
        split = QHBoxLayout()
        left = QVBoxLayout()
        self.transcript = QTextEdit(); self.transcript.setReadOnly(True)
        self.transcript.setPlaceholderText("Ask how to edit, or use the quick tools below.")
        left.addWidget(self.transcript, 1)
        row = QHBoxLayout()
        self.input = QLineEdit(); self.input.setPlaceholderText("Ask a question or enter a topic…")
        self.input.returnPressed.connect(self.ask)
        send = QPushButton("Ask"); send.setObjectName("primary"); send.clicked.connect(self.ask)
        row.addWidget(self.input, 1); row.addWidget(send)
        left.addLayout(row)
        quick = QHBoxLayout()
        for label, fn in (("Titles", self.quick_titles), ("Hashtags", self.quick_tags),
                          ("45 s script", self.quick_script), ("Image prompt", self.quick_prompt)):
            b = QPushButton(label); b.clicked.connect(fn); quick.addWidget(b)
        self.platform = QComboBox(); self.platform.addItems(["youtube", "tiktok", "instagram", "shorts"])
        ex = QPushButton("Export advice"); ex.clicked.connect(self.quick_export)
        quick.addWidget(self.platform); quick.addWidget(ex)
        left.addLayout(quick)
        split.addLayout(left, 3)
        cap = QVBoxLayout()
        cap.addWidget(QLabel("What runs where"))
        self.table = QTableWidget(len(CAPABILITIES), 3)
        self.table.setHorizontalHeaderLabels(["Feature", "Status", "Notes"])
        self.table.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        for r, c in enumerate(CAPABILITIES):
            self.table.setItem(r, 0, QTableWidgetItem(c.name))
            st = QTableWidgetItem(STATUS_LABELS[c.status])
            if c.status == UNAVAILABLE:
                st.setForeground(QBrush(QColor("#f0b429")))
            self.table.setItem(r, 1, st)
            self.table.setItem(r, 2, QTableWidgetItem(c.note))
        self.table.resizeRowsToContents()
        cap.addWidget(self.table, 1)
        split.addLayout(cap, 4)
        root.addLayout(split, 1)
        self._update_mode()

    def _update_mode(self) -> None:
        if self.provider:
            self.mode_lbl.setText("Online assistant enabled with your API key (the provider bills your account).")
        else:
            self.mode_lbl.setText("Offline mode: built-in help and generators. Add an API key in Settings to enable "
                                  "the online assistant. No key is needed for the offline tools.")

    def refresh_provider(self) -> None:
        self.offline, self.provider = ai.build_assistant(self._get_settings())
        self._update_mode()

    def _say(self, who: str, text: str) -> None:
        self.transcript.append(f"<b>{who}:</b> {text}")

    def ask(self) -> None:
        q = self.input.text().strip()
        if not q:
            return
        self.input.clear()
        self._say("You", q)
        if self.provider is None:
            self._say("Assistant", self.offline.answer(q).replace("\n", "<br>"))
            return
        if self._worker is not None:
            return
        provider = self.provider
        messages = [{"role": "system", "content": "You help people edit videos, photos and designs in ADZAK Creative Studio. Be concise."},
                    {"role": "user", "content": q}]
        self._worker = Worker(lambda **kw: provider.chat(messages))
        self._worker.succeeded.connect(lambda txt: self._say("Assistant", str(txt).replace("\n", "<br>")))
        self._worker.failed.connect(lambda m: self._say("Assistant", f"<i>{m}</i>"))
        self._worker.finished.connect(lambda: setattr(self, "_worker", None))
        self._worker.start()

    def _topic(self) -> str:
        return self.input.text().strip() or "my video"

    def quick_titles(self) -> None:
        self._say("Titles", "<br>".join(self.offline.titles(self._topic())))

    def quick_tags(self) -> None:
        self._say("Hashtags", " ".join(self.offline.hashtags(self._topic(), self.platform.currentText())))

    def quick_script(self) -> None:
        self._say("Script", self.offline.script_outline(self._topic(), 45).replace("\n", "<br>"))

    def quick_prompt(self) -> None:
        self._say("Image prompt", self.offline.image_prompt(self._topic()))

    def quick_export(self) -> None:
        self._say("Export", self.offline.export_advice(self.platform.currentText()))
