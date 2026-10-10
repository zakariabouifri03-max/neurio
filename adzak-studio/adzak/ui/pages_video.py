"""Video Studio: media bin, multi-track timeline, preview, inspector, export."""
from __future__ import annotations

from dataclasses import asdict
from pathlib import Path
import uuid

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QImage, QKeySequence, QShortcut
from PySide6.QtWidgets import (
    QCheckBox, QComboBox, QDialog, QDialogButtonBox, QDoubleSpinBox, QFormLayout, QHBoxLayout, QLabel,
    QLineEdit, QListWidget, QListWidgetItem, QProgressBar, QPushButton, QSlider, QSpinBox,
    QSplitter, QVBoxLayout, QWidget, QColorDialog, QScrollArea,
)

from ..core import projects
from ..core.errors import AppError
from ..core.history import History
from ..core.ffmpeg import probe
from ..core.i18n import tr
from ..core.paths import temp_dir
from ..video import analysis, presets, proxy
from ..video.model import Clip, Timeline
from ..video.render import export_timeline, preview_frame
from . import common
from .widgets import CanvasView, TimelineWidget
from .workers import Worker


class ExportDialog(QDialog):
    def __init__(self, parent, low_memory: bool):
        super().__init__(parent)
        self.setWindowTitle(tr("export"))
        self.setMinimumWidth(460)
        lay = QFormLayout(self)
        self.preset = QComboBox()
        self.preset.addItems(list(presets.EXPORT_PRESETS))
        self.note = QLabel()
        self.note.setObjectName("muted")
        self.note.setWordWrap(True)
        self.codec = QComboBox()
        self.codec.addItems(["h264", "h265", "vp9"])
        self.crf = QSpinBox()
        self.crf.setRange(0, 51)
        self.hw = QCheckBox("Use hardware encoder if this computer supports it (Intel Quick Sync)")
        self.threads = QSpinBox()
        self.threads.setRange(0, 64)
        self.threads.setToolTip("0 = automatic")
        self.threads.setSpecialValueText("Automatic")
        self.low_mem = QCheckBox("Low-memory encode (faster preset, lower peak memory)")
        self.low_mem.setChecked(low_memory)
        self.out = QLineEdit()
        browse = QPushButton("…")
        browse.clicked.connect(self._browse)
        row = QHBoxLayout()
        row.addWidget(self.out)
        row.addWidget(browse)
        lay.addRow("Preset", self.preset)
        lay.addRow("", self.note)
        lay.addRow("Codec", self.codec)
        lay.addRow("Quality (CRF, lower = better)", self.crf)
        lay.addRow("", self.hw)
        lay.addRow("Render threads", self.threads)
        lay.addRow("", self.low_mem)
        lay.addRow("Output file", row)
        box = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        box.accepted.connect(self.accept)
        box.rejected.connect(self.reject)
        lay.addRow(box)
        self.preset.currentTextChanged.connect(self._apply_preset)
        self._apply_preset(self.preset.currentText())

    def _apply_preset(self, name: str) -> None:
        p = presets.EXPORT_PRESETS[name]
        w, h = presets.preset_size(name)
        self.codec.setCurrentText(p["codec"])
        self.crf.setValue(p["crf"])
        self.note.setText(f"{w}×{h} · {p['fps']} fps · {p['note']}")
        cur = self.out.text()
        if not cur or Path(cur).suffix.lower() in (".mp4", ".mkv", ".webm"):
            base = Path(cur).with_suffix("") if cur else Path.home() / "Videos" / "adzak-export"
            self.out.setText(str(base.with_suffix(p["ext"])))

    def _browse(self) -> None:
        ext = Path(self.out.text() or "x.mp4").suffix or ".mp4"
        f = common.save_file(self, tr("export"), self.out.text() or f"export{ext}",
                             "Video (*.mp4 *.mov *.mkv *.webm)")
        if f:
            self.out.setText(f)

    def settings(self) -> dict:
        name = self.preset.currentText()
        p = presets.EXPORT_PRESETS[name]
        w, h = presets.preset_size(name)
        return {"width": w, "height": h, "fps": p["fps"], "codec": self.codec.currentText(),
                "crf": self.crf.value(), "hardware": self.hw.isChecked(), "threads": self.threads.value(),
                "preset": "veryfast" if self.low_mem.isChecked() else "medium", "out": self.out.text(),
                "short_px": p["short_px"], "aspect": p["aspect"]}


class VideoPage(QWidget):
    """Owns one Timeline. All edits go through _commit so they are undoable and autosaved."""

    def __init__(self, parent, db, settings_getter):
        super().__init__(parent)
        self.db = db
        self._settings = settings_getter
        self.tl = Timeline()
        self.name = "Untitled video"
        self.path: str = ""
        self.dirty = False
        self.media: list[str] = []
        self.history = History(limit=60)
        self.proxies: dict[str, str] = {}
        self._worker: Worker | None = None
        self._preview_timer = QTimer(self)
        self._preview_timer.setSingleShot(True)
        self._preview_timer.timeout.connect(self.refresh_preview)
        self._build()
        self.setAcceptDrops(True)
        self._refresh_all()

    # ---------------------------------------------------------------- UI
    def _build(self) -> None:
        root = QVBoxLayout(self)
        bar = QHBoxLayout()
        self.btn_import = QPushButton("Import media")
        self.btn_import.setToolTip("Import video, audio or images (drag and drop works too)")
        self.btn_add = QPushButton("Add to timeline")
        self.btn_text = QPushButton("Add text")
        self.btn_split = QPushButton("Split at playhead  (Ctrl+B)")
        self.btn_delete = QPushButton("Delete clip  (Del)")
        self.btn_trim_head = QPushButton("Trim start to playhead")
        self.btn_trim_tail = QPushButton("Trim end to playhead")
        self.btn_silence = QPushButton("Remove silence")
        self.btn_silence.setToolTip("Detect silent parts of the selected audio/video clip and split it into speech segments")
        self.btn_scenes = QPushButton("Find scenes")
        self.btn_scenes.setToolTip("Find scene changes in the selected video clip (reports times only)")
        self.zoom = QSlider(Qt.Horizontal)
        self.zoom.setRange(10, 300)
        self.zoom.setValue(60)
        self.zoom.setFixedWidth(120)
        self.zoom.setToolTip("Timeline zoom")
        self.proxy_box = QCheckBox("Preview proxies")
        self.proxy_box.setToolTip("Use small proxy copies of footage for smoother previews (recommended on 8 GB PCs)")
        self.btn_undo = QPushButton("Undo")
        self.btn_redo = QPushButton("Redo")
        self.btn_export = QPushButton(tr("export"))
        self.btn_export.setObjectName("primary")
        for b in (self.btn_import, self.btn_add, self.btn_text, self.btn_split, self.btn_delete,
                  self.btn_trim_head, self.btn_trim_tail, self.btn_silence, self.btn_scenes, self.btn_undo,
                  self.btn_redo):
            bar.addWidget(b)
        bar.addStretch(1)
        bar.addWidget(QLabel("Zoom"))
        bar.addWidget(self.zoom)
        bar.addWidget(self.proxy_box)
        bar.addWidget(self.btn_export)
        root.addLayout(bar)

        split = QSplitter(Qt.Horizontal)
        # media bin
        left = QWidget()
        lv = QVBoxLayout(left)
        lv.addWidget(QLabel("Media"))
        self.bin = QListWidget()
        self.bin.setToolTip("Imported media. Select, then click Add to timeline.")
        self.bin.itemDoubleClicked.connect(lambda *_: self.add_selected_media())
        lv.addWidget(self.bin)
        self.lbl_drop = QLabel(tr("drop_hint"))
        self.lbl_drop.setObjectName("muted")
        lv.addWidget(self.lbl_drop)
        split.addWidget(left)
        # preview + timeline
        mid = QWidget()
        mv = QVBoxLayout(mid)
        self.preview = CanvasView()
        self.preview.setToolTip("Frame preview at the playhead")
        mv.addWidget(self.preview, 3)
        ctrl = QHBoxLayout()
        self.playhead_slider = QSlider(Qt.Horizontal)
        self.playhead_slider.setRange(0, 1000)
        self.playhead_lbl = QLabel("0.00 s")
        self.btn_refresh = QPushButton("Refresh preview")
        ctrl.addWidget(self.playhead_slider, 1)
        ctrl.addWidget(self.playhead_lbl)
        ctrl.addWidget(self.btn_refresh)
        mv.addLayout(ctrl)
        self.tl_widget = TimelineWidget()
        self.scroll = QScrollArea()
        self.scroll.setWidgetResizable(False)
        self.scroll.setWidget(self.tl_widget)
        self.scroll.setMinimumHeight(220)
        mv.addWidget(self.scroll, 2)
        self.progress = QProgressBar()
        self.progress.setVisible(False)
        self.btn_cancel = QPushButton(tr("cancel"))
        self.btn_cancel.setVisible(False)
        pr = QHBoxLayout()
        pr.addWidget(self.progress, 1)
        pr.addWidget(self.btn_cancel)
        mv.addLayout(pr)
        split.addWidget(mid)
        # inspector
        right = QWidget()
        rv = QVBoxLayout(right)
        rv.addWidget(QLabel("Clip properties"))
        self.insp = QFormLayout()
        self.f_speed = QDoubleSpinBox(); self.f_speed.setRange(0.25, 4.0); self.f_speed.setSingleStep(0.25)
        self.f_speed.setDecimals(2); self.f_speed.setSuffix("×")
        self.f_vol = QDoubleSpinBox(); self.f_vol.setRange(0, 200); self.f_vol.setSuffix(" %")
        self.f_rot = QComboBox(); self.f_rot.addItems(["0°", "90°", "180°", "270°"])
        self.f_rev = QCheckBox("Reverse playback")
        self.f_stab = QCheckBox("Stabilise (basic)")
        self.f_bright = QDoubleSpinBox(); self.f_bright.setRange(-1, 1); self.f_bright.setSingleStep(0.05)
        self.f_contrast = QDoubleSpinBox(); self.f_contrast.setRange(0, 2); self.f_contrast.setSingleStep(0.05)
        self.f_sat = QDoubleSpinBox(); self.f_sat.setRange(0, 3); self.f_sat.setSingleStep(0.05)
        self.f_gamma = QDoubleSpinBox(); self.f_gamma.setRange(0.1, 10); self.f_gamma.setSingleStep(0.05)
        self.f_opacity = QDoubleSpinBox(); self.f_opacity.setRange(0, 1); self.f_opacity.setSingleStep(0.05)
        self.f_chroma = QLineEdit(); self.f_chroma.setPlaceholderText("none, or #00FF00")
        self.f_chroma_sim = QDoubleSpinBox(); self.f_chroma_sim.setRange(0.01, 0.5); self.f_chroma_sim.setSingleStep(0.01)
        self.f_fade_in = QDoubleSpinBox(); self.f_fade_in.setRange(0, 60); self.f_fade_in.setSuffix(" s")
        self.f_fade_out = QDoubleSpinBox(); self.f_fade_out.setRange(0, 60); self.f_fade_out.setSuffix(" s")
        self.f_text = QLineEdit()
        self.f_text_size = QSpinBox(); self.f_text_size.setRange(8, 400)
        self.f_text_pos = QComboBox(); self.f_text_pos.addItems(["bottom", "center", "top"])
        self.f_text_color = QLineEdit("#FFFFFF")
        rows = [("Speed", self.f_speed), ("Volume", self.f_vol), ("Rotate", self.f_rot), ("", self.f_rev),
                ("", self.f_stab), ("Brightness", self.f_bright), ("Contrast", self.f_contrast),
                ("Saturation", self.f_sat), ("Exposure (gamma)", self.f_gamma), ("Opacity", self.f_opacity),
                ("Chroma key colour", self.f_chroma), ("Chroma similarity", self.f_chroma_sim),
                ("Fade in", self.f_fade_in), ("Fade out", self.f_fade_out), ("Text", self.f_text),
                ("Text size", self.f_text_size), ("Text position", self.f_text_pos),
                ("Text colour", self.f_text_color)]
        for label, w in rows:
            self.insp.addRow(label, w)
        rv.addLayout(self.insp)
        self.btn_apply = QPushButton("Apply to clip")
        self.btn_apply.setObjectName("primary")
        self.btn_pick_color = QPushButton("Pick chroma colour…")
        self.btn_pick_color.clicked.connect(self._pick_chroma)
        rv.addWidget(self.btn_apply)
        rv.addWidget(self.btn_pick_color)
        self.lbl_insp = QLabel("Select a clip on the timeline.")
        self.lbl_insp.setObjectName("muted")
        self.lbl_insp.setWordWrap(True)
        rv.addWidget(self.lbl_insp)
        rv.addStretch(1)
        split.addWidget(right)
        split.setSizes([220, 720, 300])
        root.addWidget(split, 1)
        self.set_inspector_enabled(False)

        self.btn_import.clicked.connect(self.import_media)
        self.btn_add.clicked.connect(self.add_selected_media)
        self.btn_text.clicked.connect(self.add_text_clip)
        self.btn_split.clicked.connect(self.split_clip)
        self.btn_delete.clicked.connect(self.delete_clip)
        self.btn_trim_head.clicked.connect(lambda: self.trim_to_playhead(head=True))
        self.btn_trim_tail.clicked.connect(lambda: self.trim_to_playhead(head=False))
        self.btn_silence.clicked.connect(self.remove_silence)
        self.btn_scenes.clicked.connect(self.find_scenes)
        self.zoom.valueChanged.connect(self.tl_widget.set_zoom)
        self.btn_undo.clicked.connect(self.undo)
        self.btn_redo.clicked.connect(self.redo)
        self.btn_export.clicked.connect(self.export)
        self.btn_refresh.clicked.connect(self.refresh_preview)
        self.btn_apply.clicked.connect(self.apply_inspector)
        self.btn_cancel.clicked.connect(self._cancel)
        self.proxy_box.toggled.connect(self._proxy_toggled)
        self.playhead_slider.valueChanged.connect(self._slider_moved)
        self.tl_widget.selectionChanged.connect(self._selected)
        self.tl_widget.playheadChanged.connect(self._set_playhead)
        self.tl_widget.clipMoved.connect(self._clip_moved)
        self.tl_widget.setToolTip("Click a clip to select it. Drag to move. Click the ruler to move the playhead.")
        QShortcut(QKeySequence("Delete"), self.tl_widget, activated=self.delete_clip,
                  context=Qt.WidgetWithChildrenShortcut)

    # ------------------------------------------------------------ helpers
    def playhead(self) -> float:
        return self.tl_widget.playhead

    def selected_clip(self) -> Clip | None:
        cid = self.tl_widget.selected
        if not cid:
            return None
        try:
            return self.tl.get(cid)
        except KeyError:
            return None

    def set_inspector_enabled(self, on: bool) -> None:
        for i in range(self.insp.rowCount()):
            for col in (0, 1):
                item = self.insp.itemAt(i, QFormLayout.FieldRole if col else QFormLayout.LabelRole)
                if item and item.widget():
                    item.widget().setEnabled(on)
        self.btn_apply.setEnabled(on)

    def _refresh_all(self) -> None:
        self.tl_widget.set_timeline(self.tl)
        self.btn_undo.setEnabled(self.history.can_undo)
        self.btn_redo.setEnabled(self.history.can_redo)
        self.playhead_lbl.setText(f"{self.playhead():.2f} s / {self.tl.duration():.2f} s")
        c = self.selected_clip()
        self.btn_split.setEnabled(bool(c))
        self.btn_delete.setEnabled(bool(c))
        self.btn_trim_head.setEnabled(bool(c))
        self.btn_trim_tail.setEnabled(bool(c))
        self.btn_silence.setEnabled(bool(c and c.kind in ("video", "audio")))
        self.btn_scenes.setEnabled(bool(c and c.kind == "video"))
        self.btn_export.setEnabled(bool(self.tl.clips))
        self.set_inspector_enabled(bool(c))
        self._load_inspector(c)
        self._schedule_preview()

    def _load_inspector(self, c: Clip | None) -> None:
        if not c:
            self.lbl_insp.setText("Select a clip on the timeline.")
            return
        self.lbl_insp.setText(f"{c.kind.title()} · start {c.start:.2f}s · length {c.duration:.2f}s")
        self.f_speed.setValue(c.speed)
        self.f_vol.setValue(c.volume * 100)
        self.f_rot.setCurrentIndex({0: 0, 90: 1, 180: 2, 270: 3}[c.rotate])
        self.f_rev.setChecked(c.reverse)
        self.f_stab.setChecked(c.stabilize)
        self.f_bright.setValue(c.brightness)
        self.f_contrast.setValue(c.contrast)
        self.f_sat.setValue(c.saturation)
        self.f_gamma.setValue(c.gamma)
        self.f_opacity.setValue(c.opacity)
        self.f_chroma.setText(c.chroma_color)
        self.f_chroma_sim.setValue(c.chroma_similarity)
        self.f_fade_in.setValue(c.fade_in)
        self.f_fade_out.setValue(c.fade_out)
        self.f_text.setText(c.text)
        self.f_text_size.setValue(c.text_size)
        self.f_text_pos.setCurrentText(c.text_position if c.text_position in ("top", "center", "bottom") else "bottom")
        self.f_text_color.setText(c.text_color)
        is_text = c.kind == "text"
        is_media = c.kind in ("video", "image")
        for w, on in ((self.f_speed, c.kind in ("video", "audio")), (self.f_rot, c.kind == "video"),
                      (self.f_rev, c.kind in ("video", "audio")), (self.f_stab, c.kind == "video"),
                      (self.f_bright, is_media), (self.f_contrast, is_media), (self.f_sat, is_media),
                      (self.f_gamma, is_media), (self.f_opacity, is_media), (self.f_chroma, c.kind == "video"),
                      (self.f_chroma_sim, c.kind == "video"), (self.f_text, is_text),
                      (self.f_text_size, is_text), (self.f_text_pos, is_text), (self.f_text_color, is_text),
                      (self.f_vol, c.kind in ("video", "audio"))):
            w.setEnabled(on)
        self.btn_pick_color.setEnabled(c.kind == "video")

    def _pick_chroma(self) -> None:
        col = QColorDialog.getColor(parent=self)
        if col.isValid():
            self.f_chroma.setText(col.name().upper())

    # ------------------------------------------------------- editing core
    def _commit(self, action: str, fn) -> None:
        """Run fn(tl) on the timeline with undo recording; on error keep state and show message."""
        before = self.tl.to_dict()
        try:
            fn(self.tl)
            self.tl.validate()
        except (ValueError, KeyError) as exc:
            self.tl = Timeline.from_dict(before)
            self._refresh_all()
            common.error(self, str(exc))
            return
        except AppError as exc:
            self.tl = Timeline.from_dict(before)
            self._refresh_all()
            common.error(self, exc.user_message)
            return
        self.history.push(before)
        self.dirty = True
        self._refresh_all()

    def undo(self) -> None:
        state = self.history.undo(self.tl.to_dict())
        if state is not None:
            self.tl = Timeline.from_dict(state)
            self.dirty = True
            self._refresh_all()

    def redo(self) -> None:
        state = self.history.redo(self.tl.to_dict())
        if state is not None:
            self.tl = Timeline.from_dict(state)
            self.dirty = True
            self._refresh_all()

    def import_media(self) -> None:
        files = common.open_files(self, tr("import"))
        self._add_media_files(files)

    def _add_media_files(self, files: list[str]) -> None:
        for f in files:
            if not common.is_media(f):
                common.error(self, f"Unsupported file type: {Path(f).name}")
                continue
            if f in self.media:
                continue
            try:
                info = probe(f) if common.kind_for(f) != "image" else None
            except AppError as exc:
                common.error(self, f"{Path(f).name}: {exc.user_message}")
                continue
            self.media.append(f)
            label = Path(f).name
            if info and info.duration:
                label += f"  ({info.duration:.1f}s)"
            item = QListWidgetItem(label)
            item.setData(Qt.UserRole, f)
            item.setToolTip(f)
            self.bin.addItem(item)
        self.lbl_drop.setText(f"{len(self.media)} media item(s). {tr('drop_hint')}")

    def add_selected_media(self) -> None:
        item = self.bin.currentItem()
        if not item:
            common.info(self, "Select media in the bin first (import it if the list is empty).")
            return
        path = item.data(Qt.UserRole)
        kind = common.kind_for(path)
        start = round(self.playhead(), 2)
        if kind == "image":
            dur = 5.0
            track = 0
        else:
            try:
                info = probe(path)
            except AppError as exc:
                common.error(self, exc.user_message)
                return
            dur = max(0.1, info.duration or 5.0)
            track = 0 if kind == "video" else 2
        clip = Clip(kind=kind, src=path, track=track, start=start, duration=round(dur, 3))
        if kind == "video":
            clip.volume = 1.0
        self._commit("add", lambda tl: tl.add(clip))
        self.tl_widget.selected = clip.id
        self._refresh_all()

    def add_text_clip(self) -> None:
        from PySide6.QtWidgets import QInputDialog

        text, ok = QInputDialog.getMultiLineText(self, "Add text", "Title, caption or subtitle text:")
        if not ok or not text.strip():
            return
        clip = Clip(kind="text", track=3, start=round(self.playhead(), 2), duration=3.0, text=text.strip(),
                    text_size=72)
        self._commit("text", lambda tl: tl.add(clip))
        self.tl_widget.selected = clip.id
        self._refresh_all()

    def split_clip(self) -> None:
        c = self.selected_clip()
        if not c:
            return
        t = self.playhead()
        self._commit("split", lambda tl: tl.split(c.id, t))

    def delete_clip(self) -> None:
        c = self.selected_clip()
        if not c:
            return
        self._commit("delete", lambda tl: tl.remove(c.id))
        self.tl_widget.selected = ""
        self._refresh_all()

    def trim_to_playhead(self, head: bool) -> None:
        c = self.selected_clip()
        if not c:
            return
        t = self.playhead()
        if head:
            amount = t - c.start
            if amount <= 0:
                common.info(self, "Move the playhead inside the clip first.")
                return
            self._commit("trim", lambda tl: tl.trim(c.id, head=amount))
        else:
            amount = c.end - t
            if amount <= 0:
                common.info(self, "Move the playhead inside the clip first.")
                return
            self._commit("trim", lambda tl: tl.trim(c.id, tail=amount))

    def apply_inspector(self) -> None:
        c = self.selected_clip()
        if not c:
            return
        vals = dict(
            speed=self.f_speed.value(), volume=self.f_vol.value() / 100.0,
            rotate=[0, 90, 180, 270][self.f_rot.currentIndex()], reverse=self.f_rev.isChecked(),
            stabilize=self.f_stab.isChecked(), brightness=self.f_bright.value(),
            contrast=self.f_contrast.value(), saturation=self.f_sat.value(), gamma=self.f_gamma.value(),
            opacity=self.f_opacity.value(), chroma_color=self.f_chroma.text().strip(),
            chroma_similarity=self.f_chroma_sim.value(), fade_in=self.f_fade_in.value(),
            fade_out=self.f_fade_out.value(), text=self.f_text.text(), text_size=self.f_text_size.value(),
            text_position=self.f_text_pos.currentText(), text_color=self.f_text_color.text().strip() or "#FFFFFF")

        def apply(tl: Timeline) -> None:
            t = tl.get(c.id)
            for k, v in vals.items():
                setattr(t, k, v)
            t.validate()
        self._commit("inspector", apply)

    def _clip_moved(self, cid: str, start: float, track: int) -> None:
        before = self.tl.to_dict()
        try:
            self.tl.move(cid, start, track)
            self.tl.validate()
        except ValueError as exc:
            self.tl = Timeline.from_dict(before)
            common.error(self, str(exc))
        self.history.push(before)
        self.dirty = True
        self._refresh_all()

    def remove_silence(self) -> None:
        c = self.selected_clip()
        if not c or c.kind not in ("video", "audio"):
            return
        self._run(lambda progress, cancel: analysis.detect_silence(c.src, noise_db=-35, min_silence=0.5),
                  "Analysing audio…", lambda spans: self._apply_silence(c.id, spans))

    def _apply_silence(self, cid: str, spans) -> None:
        clip = self.tl.get(cid)
        keep = analysis.non_silent_spans(spans, clip.duration)
        if not keep:
            common.error(self, "The whole clip is silent; nothing was changed.")
            return
        if len(keep) == 1 and keep[0].start <= 0.01 and keep[0].duration >= clip.duration - 0.05:
            common.info(self, "No silent parts were found in this clip.")
            return

        def replace(tl: Timeline) -> None:
            orig = tl.get(cid)
            tl.remove(cid)
            for seg in keep:
                off_start, off_dur = seg.start, seg.duration
                data = asdict(orig)
                data.update(id=uuid.uuid4().hex[:10], start=orig.start + off_start, duration=off_dur,
                            in_point=orig.in_point + off_start * orig.speed)
                tl.add(Clip(**data))
        self._commit("silence", replace)
        self.tl_widget.selected = ""
        self._refresh_all()
        common.info(self, f"Silence removed: the clip is now {len(keep)} speech segment(s).")

    def find_scenes(self) -> None:
        c = self.selected_clip()
        if not c or c.kind != "video":
            return
        self._run(lambda progress, cancel: analysis.detect_scenes(c.src, 0.3), "Finding scenes…",
                  self._show_scenes)

    def _show_scenes(self, times) -> None:
        if not times:
            common.info(self, "No clear scene changes were found.")
            return
        shown = ", ".join(f"{t:.2f}s" for t in times[:40])
        more = "" if len(times) <= 40 else f" (+{len(times) - 40} more)"
        common.info(self, f"Scene changes at: {shown}{more}\n\nUse the playhead to jump to these times and Split.")

    # ------------------------------------------------------------ preview
    def _selected(self, cid: str) -> None:
        self.tl_widget.selected = cid
        self._refresh_all()

    def _set_playhead(self, t: float) -> None:
        dur = max(self.tl.duration(), 0.001)
        self.playhead_slider.blockSignals(True)
        self.playhead_slider.setValue(int(min(1000, t / dur * 1000)))
        self.playhead_slider.blockSignals(False)
        self.playhead_lbl.setText(f"{t:.2f} s / {self.tl.duration():.2f} s")
        self._schedule_preview()

    def _slider_moved(self, v: int) -> None:
        dur = self.tl.duration()
        if dur <= 0:
            return
        self.tl_widget.playhead = dur * v / 1000.0
        self.tl_widget.update()
        self.playhead_lbl.setText(f"{self.playhead():.2f} s / {dur:.2f} s")
        self._schedule_preview()

    def _schedule_preview(self) -> None:
        self._preview_timer.start(300)

    def refresh_preview(self) -> None:
        if not self.tl.clips or self._worker is not None:
            return
        t = min(self.playhead(), max(0.0, self.tl.duration() - 0.05))
        height = int(self._settings().get("preview_height", 360))
        low = bool(self._settings().get("low_memory"))
        height = min(height, 240) if low else height
        out = temp_dir() / "preview.png"
        tl = Timeline.from_dict(self.tl.to_dict())
        smap = dict(self.proxies)

        def job(progress, cancel):
            return preview_frame(tl, t, out, height=height, work_dir=temp_dir(), source_map=smap)

        self._worker = Worker(lambda **kw: job(kw["progress"], kw["cancel"]))
        self._worker.succeeded.connect(self._preview_done)
        self._worker.failed.connect(self._preview_failed)
        self._worker.finished.connect(self._worker_cleanup)
        self._worker.start()

    def _preview_done(self, path) -> None:
        img = QImage(str(path))
        if not img.isNull():
            self.preview.set_image(img, img.width(), img.height())

    def _preview_failed(self, msg: str) -> None:
        self.preview.set_image(None, 1, 1)
        self.lbl_insp.setText("Preview unavailable: " + msg)

    def _worker_cleanup(self) -> None:
        self._worker = None

    def _proxy_toggled(self, on: bool) -> None:
        if not on:
            self.proxies = {}
            self._schedule_preview()
            return
        videos = sorted({c.src for c in self.tl.clips if c.kind == "video"})
        if not videos:
            return
        def job(progress, cancel):
            return {v: str(proxy.make_proxy(v, 360)) for v in videos}
        self._run(job, "Creating preview proxies…", self._proxies_ready)

    def _proxies_ready(self, mapping) -> None:
        self.proxies = mapping
        self._schedule_preview()

    # ------------------------------------------------------- long tasks
    def _run(self, fn, label: str, on_done) -> None:
        if self._worker is not None:
            common.info(self, "Please wait for the current task to finish.")
            return
        self.progress.setVisible(True)
        self.btn_cancel.setVisible(True)
        self.progress.setRange(0, 1000)
        self.progress.setValue(0)
        self.progress.setFormat(label)
        worker = Worker(lambda **kw: fn(kw["progress"], kw["cancel"]))
        worker.progress.connect(lambda f: self.progress.setValue(int(f * 1000)))
        worker.succeeded.connect(on_done)
        worker.failed.connect(self._task_failed)
        worker.finished.connect(self._task_finished)
        self._worker = worker
        worker.start()

    def _task_failed(self, msg: str) -> None:
        if msg != "Cancelled.":
            common.error(self, msg)

    def _task_finished(self) -> None:
        self.progress.setVisible(False)
        self.btn_cancel.setVisible(False)
        self._worker = None
        self._schedule_preview()

    def _cancel(self) -> None:
        if self._worker is not None:
            self._worker.cancel()

    def export(self) -> None:
        if not self.tl.clips:
            common.info(self, "Add media to the timeline before exporting.")
            return
        dlg = ExportDialog(self, bool(self._settings().get("low_memory")))
        if dlg.exec() != QDialog.Accepted:
            return
        s = dlg.settings()
        if not s["out"]:
            common.error(self, "Choose an output file.")
            return
        tl = Timeline.from_dict(self.tl.to_dict())
        work = temp_dir() / "render"
        threads = s["threads"] or int(self._settings().get("render_threads") or 0)
        hw = s["hardware"] or bool(self._settings().get("hardware_accel"))
        out = s["out"]

        def job(progress, cancel):
            return export_timeline(tl, out, width=s["width"], height=s["height"], fps=s["fps"],
                                   codec=s["codec"], crf=s["crf"], preset=s["preset"], threads=threads,
                                   hardware=hw, work_dir=work, on_progress=progress, cancel=cancel)

        self._run(lambda progress, cancel: job(progress, cancel), tr("exporting"),
                  lambda p: common.info(self, f"Export complete:\n{p}"))
        self.progress.setFormat(tr("exporting") + " %p%")

    # ------------------------------------------------------- project I/O
    def new_project(self, aspect: str = "16:9", short_px: int = 1080) -> None:
        self.tl = Timeline(aspect=aspect, short_px=short_px)
        self.history.clear()
        self.media.clear()
        self.bin.clear()
        self.path = ""
        self.name = "Untitled video"
        self.dirty = False
        self._refresh_all()

    def save_project(self, path: str = "") -> bool:
        path = path or self.path or common.save_file(self, tr("save"), f"{self.name}{projects.VIDEO_EXT}",
                                                     f"ADZAK project (*{projects.VIDEO_EXT})")
        if not path:
            return False
        if not path.endswith(projects.VIDEO_EXT):
            path += projects.VIDEO_EXT
        try:
            projects.save_video_project(path, self.name, self.tl)
        except (AppError, OSError) as exc:
            common.error(self, getattr(exc, "user_message", str(exc)))
            return False
        self.path = path
        self.name = Path(path).stem
        self.dirty = False
        self.db.upsert_project(self.name, "video", path)
        return True

    def open_project(self, path: str) -> None:
        try:
            name, tl = projects.load_video_project(path)
        except AppError as exc:
            common.error(self, exc.user_message)
            return
        self.tl = tl
        self.name = name
        self.path = path
        self.history.clear()
        self.media = sorted({c.src for c in tl.clips if c.kind != "text" and c.src})
        self.bin.clear()
        for m in self.media:
            it = QListWidgetItem(Path(m).name)
            it.setData(Qt.UserRole, m)
            self.bin.addItem(it)
        self.dirty = False
        self.db.upsert_project(name, "video", path)
        self._refresh_all()

    def autosave_payload(self) -> dict | None:
        if not self.dirty:
            return None
        return {"kind": "video", "name": self.name, "path": self.path, "timeline": self.tl.to_dict()}

    def restore_payload(self, payload: dict) -> None:
        self.tl = Timeline.from_dict(payload["timeline"])
        self.name = payload.get("name", "Recovered")
        self.path = payload.get("path", "")
        self.dirty = True
        self.history.clear()
        self.media = sorted({c.src for c in self.tl.clips if c.kind != "text" and c.src})
        self.bin.clear()
        for m in self.media:
            it = QListWidgetItem(Path(m).name)
            it.setData(Qt.UserRole, m)
            self.bin.addItem(it)
        self._refresh_all()

    # drag and drop
    def dragEnterEvent(self, e) -> None:
        if e.mimeData().hasUrls():
            e.acceptProposedAction()

    def dropEvent(self, e) -> None:
        files = [u.toLocalFile() for u in e.mimeData().urls() if u.isLocalFile()]
        self._add_media_files(files)
