"""Properties and effects inspector for the selected clip."""
from __future__ import annotations

from typing import Callable, Optional

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QFormLayout, QLabel,
                               QDoubleSpinBox, QSpinBox, QCheckBox, QPushButton,
                               QComboBox, QSlider, QScrollArea, QFrame,
                               QLineEdit, QTextEdit, QColorDialog, QGroupBox,
                               QSizePolicy)

from ..editing.operations import (SetClipPropertyCommand, SetSpeedCommand,
                                  TrimClipCommand)
from ..models.effects import Effect, EFFECT_CATALOG, Transition
from ..models.enums import EffectType, TransitionType, TitleAnimation
from . import theme


def _spin(minimum, maximum, value, step=0.1, suffix=""):
    s = QDoubleSpinBox()
    s.setRange(minimum, maximum)
    s.setValue(value)
    s.setSingleStep(step)
    s.setSuffix(suffix)
    s.setDecimals(2)
    return s


class Inspector(QScrollArea):
    def __init__(self, controller, playhead_provider: Optional[Callable[[], float]] = None,
                 parent=None):
        super().__init__(parent)
        self.controller = controller
        self.playhead = playhead_provider or (lambda: 0.0)
        self.setWidgetResizable(True)
        self.root = QWidget()
        self.setWidget(self.root)
        self.layout = QVBoxLayout(self.root)
        self.empty = QLabel("Select a clip to edit its properties")
        self.empty.setObjectName("Dim")
        self.layout.addWidget(self.empty)
        self.layout.addStretch(1)
        self.controller.selectionChanged.connect(self.refresh)
        self.controller.timelineChanged.connect(self.refresh)

    # ------------------------------------------------------------- refresh
    def refresh(self, *_args) -> None:
        while self.layout.count():
            item = self.layout.takeAt(0)
            w = item.widget()
            if w:
                w.deleteLater()
        clip = self.controller.selected_clip
        if clip is None:
            self.layout.addWidget(QLabel("Select a clip to edit its properties"))
            self.layout.addStretch(1)
            return
        self._build_timing(clip)
        if clip.kind not in ("audio",):
            self._build_transform(clip)
            self._build_effects(clip)
            self._build_transitions(clip)
        if clip.kind == "title":
            self._build_title(clip)
        if clip.kind != "title":
            self._build_audio(clip)
        self.layout.addStretch(1)

    def _set(self, clip, prop, value, label=None):
        self.controller.execute(SetClipPropertyCommand(
            self.controller.project.timeline, clip.id, prop, value,
            label or f"Edit {prop}"), merge=True)

    def _group(self, title: str) -> QFormLayout:
        box = QGroupBox(title)
        form = QFormLayout(box)
        self.layout.addWidget(box)
        return form

    # ------------------------------------------------------------- timing
    def _build_timing(self, clip) -> None:
        form = self._group("Timing")
        name = QLineEdit(clip.name)
        name.editingFinished.connect(
            lambda: self._set(clip, "name", name.text(), "Rename clip"))
        form.addRow("Name", name)
        start = _spin(0, 1e6, clip.start, 0.1, " s")
        duration = _spin(0.05, 1e6, clip.duration, 0.1, " s")
        source_in = _spin(0, 1e6, clip.source_in, 0.1, " s")
        speed = _spin(0.1, 16.0, clip.speed, 0.1, "x")
        form.addRow("Start", start)
        form.addRow("Duration", duration)
        form.addRow("Source in", source_in)
        form.addRow("Speed", speed)
        media = self.controller.project.get_media(clip.media_id)
        limit = media.effective_duration() if media and media.kind != "image" else None

        def commit_timing():
            self.controller.execute(TrimClipCommand(
                self.controller.project.timeline, clip.id,
                new_start=start.value(),
                new_end=start.value() + duration.value(),
                source_limit=limit))
            self.controller.execute(SetClipPropertyCommand(
                self.controller.project.timeline, clip.id, "source_in",
                source_in.value(), "Source in"), merge=False)

        start.editingFinished.connect(commit_timing)
        duration.editingFinished.connect(commit_timing)
        source_in.editingFinished.connect(commit_timing)
        speed.editingFinished.connect(lambda: self.controller.execute(
            SetSpeedCommand(self.controller.project.timeline, clip.id, speed.value())))

    # ---------------------------------------------------------- transform
    def _build_transform(self, clip) -> None:
        form = self._group("Transform & opacity")
        specs = [
            ("Position X", "pos_x", -4000, 4000, " px"),
            ("Position Y", "pos_y", -4000, 4000, " px"),
            ("Scale", "scale", 0.05, 10.0, "x"),
            ("Rotation", "rotation", -360, 360, "°"),
        ]
        for label, prop, lo, hi, suffix in specs:
            s = _spin(lo, hi, getattr(clip, prop), 0.05, suffix)
            s.editingFinished.connect(
                lambda s=s, p=prop: self._set(clip, p, s.value()))
            form.addRow(label, s)
        opacity = QSlider(Qt.Orientation.Horizontal)
        opacity.setRange(0, 100)
        opacity.setValue(int(clip.opacity * 100))
        opacity.valueChanged.connect(
            lambda v: self._set(clip, "opacity", v / 100.0, "Opacity drag"))
        form.addRow("Opacity", opacity)
        for label, prop in (("Crop L", "crop_left"), ("Crop R", "crop_right"),
                            ("Crop T", "crop_top"), ("Crop B", "crop_bottom")):
            s = _spin(0, 0.95, getattr(clip, prop), 0.02)
            s.editingFinished.connect(lambda s=s, p=prop: self._set(clip, p, s.value()))
            form.addRow(label, s)
        kf = QPushButton("◆ Add keyframes at playhead")
        kf.clicked.connect(lambda: self._add_keyframes(clip))
        form.addRow(kf)

    def _add_keyframes(self, clip) -> None:
        t = self.playhead()
        for prop in ("pos_x", "pos_y", "scale", "rotation", "opacity"):
            clip.add_keyframe(prop, t, getattr(clip, prop))
        self.controller.project.touch()
        self.controller.timelineChanged.emit()

    # ------------------------------------------------------------- effects
    def _build_effects(self, clip) -> None:
        box = QGroupBox("Effects")
        v = QVBoxLayout(box)
        for fx in clip.effects:
            v.addWidget(self._effect_widget(clip, fx))
        choices = QComboBox()
        choices.addItem("Add effect…")
        for etype, spec in EFFECT_CATALOG.items():
            if etype.startswith("audio"):
                continue
            choices.addItem(spec["label"], etype)
        add = QPushButton("Add")
        add.clicked.connect(lambda: self._add_effect(clip, choices))
        row = QWidget()
        row_l = QVBoxLayout(row)
        row_l.setContentsMargins(0, 0, 0, 0)
        h = QHBoxLayout()
        h.addWidget(choices, 1)
        h.addWidget(add)
        row_l.addLayout(h)
        v.addWidget(row)
        self.layout.addWidget(box)

    def _effect_widget(self, clip, fx) -> QWidget:
        frame = QFrame()
        frame.setStyleSheet(f"background:{theme.PALETTE['bg_2']};border-radius:8px;")
        v = QVBoxLayout(frame)
        header = QHBoxLayout()
        enable = QCheckBox(fx.label)
        enable.setChecked(fx.enabled)
        enable.toggled.connect(lambda checked: self._set_effect(clip, fx, "enabled", checked))
        header.addWidget(enable)
        header.addStretch(1)
        remove = QPushButton("✕")
        remove.setFixedWidth(30)
        remove.clicked.connect(lambda: self._remove_effect(clip, fx))
        header.addWidget(remove)
        v.addLayout(header)
        for name, meta in EFFECT_CATALOG.get(fx.type, {}).get("params", {}).items():
            default, lo, hi, step = meta
            if lo is None:  # string param (paths, colors)
                edit = QLineEdit(str(fx.get(name, default)))
                if name in ("color",):
                    pick = QPushButton("Pick color")
                    pick.clicked.connect(lambda e=edit: self._pick_color(e))
                    row = QWidget()
                    h = QHBoxLayout(row)
                    h.setContentsMargins(0, 0, 0, 0)
                    h.addWidget(edit, 1)
                    h.addWidget(pick)
                    v.addWidget(row)
                elif name == "lut_path":
                    from PySide6.QtWidgets import QFileDialog
                    row = QWidget()
                    h = QHBoxLayout(row)
                    h.setContentsMargins(0, 0, 0, 0)
                    h.addWidget(edit, 1)
                    browse = QPushButton("…")
                    browse.clicked.connect(
                        lambda e=edit: e.setText(QFileDialog.getOpenFileName(
                            self, "Choose LUT", "", "LUT (*.cube *.3dl)")[0]))
                    h.addWidget(browse)
                    v.addWidget(row)
                else:
                    v.addWidget(edit)
                edit.editingFinished.connect(
                    lambda e=edit, f=fx, n=name: self._set_effect_param(clip, f, n, e.text()))
                continue
            s = QSlider(Qt.Orientation.Horizontal)
            s.setRange(int(lo * 100), int(hi * 100))
            s.setValue(int(float(fx.get(name, default)) * 100))
            label = QLabel(f"{name}: {float(fx.get(name, default)):.2f}")
            s.valueChanged.connect(
                lambda val, l=label, n=name, f=fx: (
                    l.setText(f"{n}: {val / 100:.2f}"),
                    self._set_effect_param(clip, f, n, val / 100.0)))
            v.addWidget(label)
            v.addWidget(s)
        return frame

    def _pick_color(self, edit: QLineEdit) -> None:
        color = QColorDialog.getColor()
        if color.isValid():
            edit.setText(color.name())
            edit.editingFinished.emit()

    def _add_effect(self, clip, combo: QComboBox) -> None:
        etype = combo.currentData()
        if not etype:
            return
        clip.effects.append(Effect(etype))
        self.controller.project.touch()
        self.controller.timelineChanged.emit()

    def _remove_effect(self, clip, fx) -> None:
        clip.effects = [e for e in clip.effects if e.id != fx.id]
        self.controller.project.touch()
        self.controller.timelineChanged.emit()

    def _set_effect(self, clip, fx, name, value) -> None:
        setattr(fx, name, value)
        self.controller.project.touch()
        self.controller.timelineChanged.emit()

    def _set_effect_param(self, clip, fx, name, value) -> None:
        fx.set(name, value)
        self.controller.project.touch()
        self.controller.timelineChanged.emit()

    # -------------------------------------------------------- transitions
    def _build_transitions(self, clip) -> None:
        form = self._group("Transitions")
        for side, existing in (("In", clip.transition_in), ("Out", clip.transition_out)):
            combo = QComboBox()
            combo.addItem("None", None)
            for t in TransitionType:
                combo.addItem(t.value, t.value)
            if existing:
                idx = combo.findData(existing.type)
                if idx >= 0:
                    combo.setCurrentIndex(idx)
            dur = _spin(0.05, 10, existing.duration if existing else 0.5, 0.1, " s")
            combo.currentIndexChanged.connect(
                lambda _i, c=clip, s=side, cb=combo, d=dur:
                    self._set_transition(c, s, cb.currentData(), d.value()))
            dur.editingFinished.connect(
                lambda c=clip, s=side, cb=combo, d=dur:
                    self._set_transition(c, s, cb.currentData(), d.value()))
            form.addRow(f"{side} transition", combo)
            form.addRow(f"{side} duration", dur)

    def _set_transition(self, clip, side, ttype, duration) -> None:
        if not ttype:
            value = None
        else:
            current = clip.transition_in if side == "In" else clip.transition_out
            value = Transition(ttype, float(duration), side.lower())
        self._set(clip, "transition_" + side.lower(), value, "Transition")

    # -------------------------------------------------------------- title
    def _build_title(self, clip) -> None:
        form = self._group("Title text")
        text = QTextEdit(clip.text_params.get("text", ""))
        text.setMaximumHeight(90)
        form.addRow("Text", text)
        size = QSpinBox()
        size.setRange(8, 400)
        size.setValue(int(clip.text_params.get("font_size", 72)))
        form.addRow("Font size", size)
        anim = QComboBox()
        for a in TitleAnimation:
            anim.addItem(a.value, a.value)
        anim.setCurrentIndex(anim.findData(clip.text_params.get("animation", "none")))
        form.addRow("Animation", anim)
        color_btn = QPushButton("Text color")
        color_btn.clicked.connect(lambda: self._title_color(clip))
        form.addRow(color_btn)
        apply = QPushButton("Apply title changes")
        apply.clicked.connect(lambda: self._apply_title(clip, text, size, anim))
        form.addRow(apply)

    def _title_color(self, clip) -> None:
        color = QColorDialog.getColor()
        if color.isValid():
            clip.text_params["color"] = color.name()

    def _apply_title(self, clip, text, size, anim) -> None:
        clip.text_params["text"] = text.toPlainText()
        clip.text_params["font_size"] = size.value()
        clip.text_params["animation"] = anim.currentData()
        self.controller.project.touch()
        self.controller.timelineChanged.emit()

    # -------------------------------------------------------------- audio
    def _build_audio(self, clip) -> None:
        form = self._group("Audio")
        gain = QSlider(Qt.Orientation.Horizontal)
        gain.setRange(0, 200)
        gain.setValue(int(clip.gain * 100))
        gain.valueChanged.connect(lambda v: self._set(clip, "gain", v / 100.0, "Volume"))
        form.addRow("Volume", gain)
        fade_in = _spin(0, 60, clip.fade_in, 0.1, " s")
        fade_out = _spin(0, 60, clip.fade_out, 0.1, " s")
        fade_in.editingFinished.connect(lambda: self._set(clip, "fade_in", fade_in.value()))
        fade_out.editingFinished.connect(lambda: self._set(clip, "fade_out", fade_out.value()))
        form.addRow("Fade in", fade_in)
        form.addRow("Fade out", fade_out)
        mute = QCheckBox("Muted")
        mute.setChecked(clip.muted)
        mute.toggled.connect(lambda v: self._set(clip, "muted", v, "Mute"))
        form.addRow(mute)
