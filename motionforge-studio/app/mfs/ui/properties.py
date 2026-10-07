"""Right hand side properties: transform, brush, onion skin, camera, scene."""
from __future__ import annotations

import os

from PySide6.QtCore import QSize, Qt, Signal
from PySide6.QtGui import QColor
from PySide6.QtWidgets import (QCheckBox, QColorDialog, QComboBox, QDoubleSpinBox, QFormLayout,
                               QFrame, QGridLayout, QHBoxLayout, QLabel, QLineEdit, QPushButton,
                               QScrollArea, QSlider, QSpinBox, QTabWidget, QToolButton,
                               QVBoxLayout, QWidget)

from ..model.easing import EASING_LABELS
from ..model.keyframe import PROP_LABELS
from .theme import C, get_icon


def _spin(minimum: float, maximum: float, value: float, step: float = 1.0,
          suffix: str = "", decimals: int = 1, tooltip: str = "") -> QDoubleSpinBox:
    box = QDoubleSpinBox()
    box.setRange(minimum, maximum)
    box.setValue(value)
    box.setSingleStep(step)
    box.setDecimals(decimals)
    if suffix:
        box.setSuffix(f" {suffix}")
    if tooltip:
        box.setToolTip(tooltip)
    box.setKeyboardTracking(False)
    return box


class Collapsible(QWidget):
    """A titled, collapsible section (keeps the panels tidy in beginner mode)."""

    def __init__(self, title: str, expanded: bool = True, parent=None):
        super().__init__(parent)
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(3)
        self.button = QToolButton()
        self.button.setText(title)
        self.button.setCheckable(True)
        self.button.setChecked(expanded)
        self.button.setStyleSheet(
            f"QToolButton{{text-align:left;font-weight:600;color:{C.text_dim};"
            f"border:none;padding:4px 2px;}}"
            f"QToolButton:hover{{color:{C.text};}}")
        self.button.setArrowType(Qt.DownArrow if expanded else Qt.RightArrow)
        self.button.clicked.connect(self._toggle)
        root.addWidget(self.button)
        self.body = QWidget()
        self.form = QVBoxLayout(self.body)
        self.form.setContentsMargins(4, 2, 4, 6)
        self.form.setSpacing(4)
        root.addWidget(self.body)
        self.body.setVisible(expanded)

    def _toggle(self) -> None:
        visible = self.button.isChecked()
        self.body.setVisible(visible)
        self.button.setArrowType(Qt.DownArrow if visible else Qt.RightArrow)

    def add(self, widget: QWidget) -> None:
        self.form.addWidget(widget)

    def add_layout(self, layout) -> None:
        self.form.addLayout(layout)


class PropertiesPanel(QWidget):
    """Transform / brush / onion / camera / scene settings."""

    def __init__(self, session, parent=None):
        super().__init__(parent)
        self.session = session
        self._updating = False
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)

        self.tabs = QTabWidget()
        self.tabs.setDocumentMode(True)
        root.addWidget(self.tabs)

        self.tabs.addTab(self._build_transform(), "Transform")
        self.tabs.addTab(self._build_brush(), "Brush")
        self.tabs.addTab(self._build_onion(), "Onion")
        self.tabs.addTab(self._build_camera(), "Camera")
        self.tabs.addTab(self._build_scene(), "Scene")

        s = session
        s.canvas_changed.connect(self.sync)
        s.layer_selected.connect(lambda *_: self.sync())
        s.frame_changed.connect(lambda *_: self.sync())
        s.brush_changed.connect(self.sync_brush)
        s.scene_changed.connect(self.sync)
        s.project_changed.connect(self.sync)
        self.sync()
        self.sync_brush()

    # ------------------------------------------------------------------ tabs
    def _build_transform(self) -> QWidget:
        area = QScrollArea()
        area.setWidgetResizable(True)
        area.setFrameShape(QFrame.NoFrame)
        holder = QWidget()
        lay = QVBoxLayout(holder)
        lay.setContentsMargins(8, 8, 8, 8)
        lay.setSpacing(8)

        self.layer_label = QLabel("No layer")
        self.layer_label.setObjectName("title")
        lay.addWidget(self.layer_label)
        self.layer_kind = QLabel("")
        self.layer_kind.setObjectName("hint")
        lay.addWidget(self.layer_kind)

        self.reset_btn = QPushButton("Reset transform")
        self.reset_btn.setToolTip("Reset position, rotation and scale of this layer")
        self.reset_btn.clicked.connect(self.reset_transform)
        lay.addWidget(self.reset_btn)

        self.key_row = QHBoxLayout()
        key_btn = QPushButton("Key frame")
        key_btn.setObjectName("primary")
        key_btn.setToolTip("Key the current transform at the playhead (K)")
        key_btn.clicked.connect(lambda: self.session.key_transform())
        self.key_row.addWidget(key_btn)
        del_btn = QPushButton("Delete keys")
        del_btn.setToolTip("Remove transform keys at the playhead")
        del_btn.clicked.connect(lambda: self.session.delete_keys_at())
        self.key_row.addWidget(del_btn)
        lay.addLayout(self.key_row)

        self.ease_combo = QComboBox()
        for key, label in EASING_LABELS:
            self.ease_combo.addItem(label, key)
        self.ease_combo.setToolTip("Interpolation of the key at the playhead")
        self.ease_combo.currentIndexChanged.connect(
            lambda: self.session.set_key_easing(self.ease_combo.currentData()))
        lay.addWidget(self.ease_combo)

        self.spins: dict[str, QDoubleSpinBox] = {}
        form = QFormLayout()
        form.setLabelAlignment(Qt.AlignRight)
        form.setContentsMargins(0, 0, 0, 0)
        form.setSpacing(4)
        for prop in ("pos.x", "pos.y", "rotation", "scale.x", "scale.y", "skew.x", "skew.y",
                     "opacity", "anchor.x", "anchor.y"):
            box = _spin(-100000, 100000, 0.0, 1.0, "", 2, PROP_LABELS.get(prop, prop))
            if prop.startswith("scale") or prop == "opacity":
                box.setSuffix(" %")
            box.setSingleStep(1.0 if prop != "opacity" else 5.0)
            box.valueChanged.connect(lambda v, p=prop: self._on_transform(p, v))
            self.spins[prop] = box
            row = QHBoxLayout()
            row.addWidget(box, 1)
            key_dot = QToolButton()
            key_dot.setText("◆")
            key_dot.setToolTip("Key this property at the playhead")
            key_dot.setFixedWidth(20)
            key_dot.clicked.connect(lambda _c=False, p=prop: self.session.key_transform(p))
            row.addWidget(key_dot)
            form.addRow(PROP_LABELS.get(prop, prop), row)
        lay.addLayout(form)

        lay.addStretch(1)
        area.setWidget(holder)
        return area

    def _build_brush(self) -> QWidget:
        holder = QWidget()
        lay = QVBoxLayout(holder)
        lay.setContentsMargins(8, 8, 8, 8)
        lay.setSpacing(6)

        self.brush_combo = QComboBox()
        from ..engine.brushes import default_brushes
        for brush in default_brushes():
            self.brush_combo.addItem(brush.name, brush)
        self.brush_combo.setToolTip("Brush preset")
        self.brush_combo.currentIndexChanged.connect(self._on_brush_preset)
        lay.addWidget(self.brush_combo)

        self.brush_spins: dict[str, QDoubleSpinBox] = {}
        specs = [
            ("size", "Size", 0.5, 400, " px"),
            ("opacity", "Opacity", 1, 100, " %"),
            ("hardness", "Hardness", 0, 100, " %"),
            ("smoothing", "Smoothing", 0, 95, " %"),
            ("stabilize", "Stabilizer", 0, 95, " %"),
            ("spacing", "Spacing", 1, 200, " %"),
            ("taper_in", "Taper in", 0, 100, " %"),
            ("taper_out", "Taper out", 0, 100, " %"),
            ("texture", "Texture", 0, 100, " %"),
        ]
        form = QFormLayout()
        form.setSpacing(4)
        form.setContentsMargins(0, 0, 0, 0)
        for key, label, lo, hi, suffix in specs:
            box = _spin(lo, hi, 0, 1, suffix, 0, f"Brush {label.lower()}")
            box.valueChanged.connect(lambda v, k=key: self._on_brush(k, v))
            self.brush_spins[key] = box
            form.addRow(label, box)
        lay.addLayout(form)

        checks = QHBoxLayout()
        self.pressure_size = QCheckBox("Pressure → size")
        self.pressure_size.setToolTip("Tablet pressure controls the stroke width")
        self.pressure_size.clicked.connect(
            lambda: self.session.set_brush_prop("pressure_size", self.pressure_size.isChecked()))
        checks.addWidget(self.pressure_size)
        lay.addLayout(checks)

        checks2 = QHBoxLayout()
        self.pressure_opacity = QCheckBox("Pressure → opacity")
        self.pressure_opacity.clicked.connect(
            lambda: self.session.set_brush_prop("pressure_opacity",
                                                self.pressure_opacity.isChecked()))
        checks2.addWidget(self.pressure_opacity)
        lay.addLayout(checks2)

        colors = QHBoxLayout()
        self.primary_btn = QPushButton("Primary colour")
        self.primary_btn.setToolTip("Main drawing colour (X swaps with secondary)")
        self.primary_btn.clicked.connect(lambda: self._pick_color("primary"))
        colors.addWidget(self.primary_btn)
        self.secondary_btn = QPushButton("Secondary")
        self.secondary_btn.clicked.connect(lambda: self._pick_color("secondary"))
        colors.addWidget(self.secondary_btn)
        lay.addLayout(colors)

        sample = QFrame()
        sample.setFixedHeight(4)
        sample.setStyleSheet(f"background:{C.accent};border-radius:2px;")
        lay.addWidget(sample)

        tools_row = QHBoxLayout()
        self.sample_layers = QCheckBox("Fill samples all layers")
        self.sample_layers.setToolTip("Bucket fill reads the whole visible artwork")
        self.sample_layers.clicked.connect(
            lambda: self._setting("drawing", "sample_all_layers", self.sample_layers.isChecked()))
        tools_row.addWidget(self.sample_layers)
        lay.addLayout(tools_row)

        fill_row = QHBoxLayout()
        fill_row.addWidget(QLabel("Fill gap"))
        self.gap_spin = QSpinBox()
        self.gap_spin.setRange(0, 8)
        self.gap_spin.setToolTip("Close small gaps in the line art when filling (0 = off)")
        self.gap_spin.valueChanged.connect(
            lambda v: self._setting("drawing", "gap_close", int(v)))
        fill_row.addWidget(self.gap_spin)
        fill_row.addWidget(QLabel("Tolerance"))
        self.tol_spin = QSpinBox()
        self.tol_spin.setRange(1, 255)
        self.tol_spin.setToolTip("Colour tolerance used by the bucket")
        self.tol_spin.valueChanged.connect(
            lambda v: self._setting("drawing", "fill_tolerance", int(v)))
        fill_row.addWidget(self.tol_spin)
        lay.addLayout(fill_row)

        shape_row = QHBoxLayout()
        shape_row.addWidget(QLabel("Shape"))
        self.shape_combo = QComboBox()
        for key, label in (("line", "Line"), ("rect", "Rectangle"), ("ellipse", "Circle"),
                           ("polygon", "Polygon"), ("bezier", "Bezier curve")):
            self.shape_combo.addItem(label, key)
        self.shape_combo.currentIndexChanged.connect(
            lambda: self._setting("drawing", "shape_kind", self.shape_combo.currentData()))
        shape_row.addWidget(self.shape_combo, 1)
        lay.addLayout(shape_row)

        sides_row = QHBoxLayout()
        sides_row.addWidget(QLabel("Polygon sides"))
        self.sides_spin = QSpinBox()
        self.sides_spin.setRange(3, 24)
        self.sides_spin.setValue(5)
        sides_row.addWidget(self.sides_spin)
        lay.addLayout(sides_row)
        self.sides_spin.valueChanged.connect(
            lambda v: self._setting("drawing", "shape_sides", int(v)))

        self.filled_check = QCheckBox("Filled shape")
        self.filled_check.clicked.connect(
            lambda: self._setting("drawing", "shape_filled", self.filled_check.isChecked()))
        lay.addWidget(self.filled_check)

        text_row = QHBoxLayout()
        text_row.addWidget(QLabel("Text size"))
        self.text_size = QSpinBox()
        self.text_size.setRange(8, 600)
        self.text_size.setValue(96)
        self.text_size.valueChanged.connect(
            lambda v: self._setting("drawing", "text_size", int(v)))
        text_row.addWidget(self.text_size)
        lay.addLayout(text_row)

        lay.addStretch(1)
        return holder

    def _build_onion(self) -> QWidget:
        holder = QWidget()
        lay = QVBoxLayout(holder)
        lay.setContentsMargins(8, 8, 8, 8)
        lay.setSpacing(6)
        self.onion_enabled = QCheckBox("Enable onion skin")
        self.onion_enabled.setToolTip("Show the previous and next drawings while you work")
        self.onion_enabled.clicked.connect(
            lambda: self.session.toggle_onion(self.onion_enabled.isChecked()))
        lay.addWidget(self.onion_enabled)

        self.onion_prev = QCheckBox("Show previous frames")
        self.onion_prev.clicked.connect(
            lambda: self._onion("show_prev", self.onion_prev.isChecked()))
        lay.addWidget(self.onion_prev)
        self.onion_next = QCheckBox("Show next frames")
        self.onion_next.clicked.connect(
            lambda: self._onion("show_next", self.onion_next.isChecked()))
        lay.addWidget(self.onion_next)

        form = QFormLayout()
        form.setSpacing(4)
        self.onion_prev_n = QSpinBox()
        self.onion_prev_n.setRange(0, 12)
        self.onion_prev_n.valueChanged.connect(lambda v: self._onion("prev_frames", int(v)))
        form.addRow("Previous frames", self.onion_prev_n)
        self.onion_next_n = QSpinBox()
        self.onion_next_n.setRange(0, 12)
        self.onion_next_n.valueChanged.connect(lambda v: self._onion("next_frames", int(v)))
        form.addRow("Next frames", self.onion_next_n)
        self.onion_opacity = QSpinBox()
        self.onion_opacity.setRange(5, 100)
        self.onion_opacity.setSuffix(" %")
        self.onion_opacity.valueChanged.connect(lambda v: self._onion("opacity", int(v)))
        form.addRow("Opacity", self.onion_opacity)
        lay.addLayout(form)

        self.onion_prev_color = QPushButton("Previous colour")
        self.onion_prev_color.clicked.connect(lambda: self._onion_color("prev_color"))
        lay.addWidget(self.onion_prev_color)
        self.onion_next_color = QPushButton("Next colour")
        self.onion_next_color.clicked.connect(lambda: self._onion_color("next_color"))
        lay.addWidget(self.onion_next_color)

        self.onion_tint = QCheckBox("Tint (red / green)")
        self.onion_tint.clicked.connect(lambda: self._onion("tint", self.onion_tint.isChecked()))
        lay.addWidget(self.onion_tint)
        self.onion_falloff = QCheckBox("Fade distant frames")
        self.onion_falloff.clicked.connect(
            lambda: self._onion("alpha_falloff", self.onion_falloff.isChecked()))
        lay.addWidget(self.onion_falloff)
        lay.addStretch(1)
        return holder

    def _build_camera(self) -> QWidget:
        holder = QWidget()
        lay = QVBoxLayout(holder)
        lay.setContentsMargins(8, 8, 8, 8)
        lay.setSpacing(6)
        self.camera_view_check = QCheckBox("Look through camera")
        self.camera_view_check.setToolTip("Preview exactly what will be exported")
        self.camera_view_check.clicked.connect(self._toggle_camera_view)
        lay.addWidget(self.camera_view_check)

        row = QHBoxLayout()
        row.addWidget(QLabel("Camera"))
        self.camera_combo = QComboBox()
        self.camera_combo.setToolTip("Active camera of this scene")
        self.camera_combo.currentIndexChanged.connect(self._on_camera_selected)
        row.addWidget(self.camera_combo, 1)
        add = QToolButton()
        add.setIcon(get_icon("add", C.text_dim))
        add.setToolTip("Add a camera")
        add.clicked.connect(lambda: (self.session.scene.add_camera(),
                                     self.sync(), self.session.timeline_changed.emit()))
        row.addWidget(add)
        lay.addLayout(row)

        form = QFormLayout()
        form.setSpacing(4)
        self.cam_spins: dict[str, QDoubleSpinBox] = {}
        for key, label, lo, hi, suffix in (
            ("x", "Position X", -200000, 200000, " px"),
            ("y", "Position Y", -200000, 200000, " px"),
            ("zoom", "Zoom", 5, 800, " %"),
            ("rotation", "Rotation", -360, 360, "°"),
        ):
            box = _spin(lo, hi, 0, 1, suffix, 1)
            box.valueChanged.connect(lambda v, k=key: self._on_camera(k, v))
            self.cam_spins[key] = box
            row2 = QHBoxLayout()
            row2.addWidget(box, 1)
            dot = QToolButton()
            dot.setText("◆")
            dot.setFixedWidth(20)
            dot.setToolTip("Key this camera value at the playhead")
            dot.clicked.connect(lambda _c=False, k=key: self._key_camera(k))
            row2.addWidget(dot)
            form.addRow(label, row2)
        lay.addLayout(form)

        btns = QHBoxLayout()
        shake = QPushButton("Add shake")
        shake.setToolTip("Add a deterministic camera shake starting here")
        shake.clicked.connect(self._add_shake)
        btns.addWidget(shake)
        clear = QPushButton("Clear shake")
        clear.clicked.connect(lambda: (self.session.scene.camera().clear_shake(),
                                       self.session.canvas_changed.emit()))
        btns.addWidget(clear)
        lay.addLayout(btns)

        shot_btn = QPushButton("Add storyboard shot here")
        shot_btn.clicked.connect(self._add_shot)
        lay.addWidget(shot_btn)

        self.shot_list = QLabel("")
        self.shot_list.setWordWrap(True)
        self.shot_list.setObjectName("hint")
        lay.addWidget(self.shot_list)
        lay.addStretch(1)
        return holder

    def _build_scene(self) -> QWidget:
        holder = QWidget()
        lay = QVBoxLayout(holder)
        lay.setContentsMargins(8, 8, 8, 8)
        lay.setSpacing(6)

        form = QFormLayout()
        form.setSpacing(4)
        self.scene_name = QLineEdit()
        self.scene_name.editingFinished.connect(
            lambda: self.session.rename_scene(self.session.scene.uid, self.scene_name.text()))
        form.addRow("Scene name", self.scene_name)

        self.fps_spin = QSpinBox()
        self.fps_spin.setRange(1, 120)
        self.fps_spin.setSuffix(" fps")
        self.fps_spin.setToolTip("Frames per second (1–120)")
        self.fps_spin.valueChanged.connect(lambda v: self.session.set_fps(int(v)))
        form.addRow("Frame rate", self.fps_spin)

        self.start_spin = QSpinBox()
        self.start_spin.setRange(0, 100000)
        self.start_spin.valueChanged.connect(self._range_changed)
        form.addRow("Start frame", self.start_spin)
        self.end_spin = QSpinBox()
        self.end_spin.setRange(1, 100000)
        self.end_spin.valueChanged.connect(self._range_changed)
        form.addRow("End frame", self.end_spin)
        lay.addLayout(form)

        size_row = QHBoxLayout()
        self.size_combo = QComboBox()
        for label, size in self.session.project.resolution_presets():
            self.size_combo.addItem(label, size)
        self.size_combo.setToolTip("Scene resolution")
        self.size_combo.currentIndexChanged.connect(self._on_size)
        size_row.addWidget(self.size_combo, 1)
        lay.addLayout(size_row)

        self.bg_btn = QPushButton("Scene background colour")
        self.bg_btn.clicked.connect(self._pick_background)
        lay.addWidget(self.bg_btn)

        self.grid_check = QCheckBox("Show grid")
        self.grid_check.clicked.connect(self._toggle_grid)
        lay.addWidget(self.grid_check)
        self.checker_check = QCheckBox("Transparency checkerboard")
        self.checker_check.clicked.connect(
            lambda: self._setting("canvas", "checker", self.checker_check.isChecked()))
        lay.addWidget(self.checker_check)

        self.autosave_check = QCheckBox("Autosave recovery copies")
        self.autosave_check.setToolTip("Autosave writes a recovery copy next to your projects")
        self.autosave_check.clicked.connect(
            lambda: self._setting("autosave", "enabled", self.autosave_check.isChecked()))
        lay.addWidget(self.autosave_check)

        row = QHBoxLayout()
        row.addWidget(QLabel("Autosave every"))
        self.autosave_min = QSpinBox()
        self.autosave_min.setRange(1, 120)
        self.autosave_min.setSuffix(" min")
        self.autosave_min.valueChanged.connect(self._autosave_interval)
        row.addWidget(self.autosave_min)
        lay.addLayout(row)

        lay.addWidget(QLabel("Scene notes"))
        from PySide6.QtWidgets import QPlainTextEdit
        self.notes = QPlainTextEdit()
        self.notes.setPlaceholderText("Notes for this scene…")
        self.notes.setFixedHeight(70)
        self.notes.textChanged.connect(
            lambda: setattr(self.session.scene, "notes", self.notes.toPlainText()))
        lay.addWidget(self.notes)

        lay.addStretch(1)
        return holder

    # ------------------------------------------------------------------ sync
    def sync(self) -> None:
        if self._updating:
            return
        self._updating = True
        try:
            session = self.session
            scene = session.scene
            layer = session.active_layer()
            frame = session.frame
            self.layer_label.setText(layer.name if layer else "No layer")
            if layer is not None:
                anim = layer.transform.animated_props()
                self.layer_kind.setText(
                    f"{layer.kind} layer · frame {frame} · "
                    f"{'animated: ' + ', '.join(anim) if anim else 'no animation yet'}")
                value = layer.transform.value_at(frame)
                mapping = {
                    "pos.x": value.x, "pos.y": value.y, "rotation": value.rotation,
                    "scale.x": value.scale_x, "scale.y": value.scale_y,
                    "skew.x": value.skew_x, "skew.y": value.skew_y,
                    "opacity": value.opacity, "anchor.x": value.anchor_x,
                    "anchor.y": value.anchor_y,
                }
                for prop, box in self.spins.items():
                    box.blockSignals(True)
                    box.setValue(float(mapping.get(prop, 0.0)))
                    box.blockSignals(False)
            # scene
            self.scene_name.setText(scene.name)
            self.fps_spin.blockSignals(True)
            self.fps_spin.setValue(scene.fps)
            self.fps_spin.blockSignals(False)
            self.start_spin.blockSignals(True)
            self.start_spin.setValue(scene.frame_start)
            self.start_spin.blockSignals(False)
            self.end_spin.blockSignals(True)
            self.end_spin.setValue(max(scene.frame_end, scene.total_frames()))
            self.end_spin.blockSignals(False)
            idx = self.size_combo.findData((scene.width, scene.height))
            self.size_combo.blockSignals(True)
            self.size_combo.setCurrentIndex(idx if idx >= 0 else 2)
            self.size_combo.blockSignals(False)
            onion = session.project.settings.get("onion", {})
            self.onion_enabled.setChecked(bool(onion.get("enabled", True)))
            self.onion_prev.setChecked(bool(onion.get("show_prev", True)))
            self.onion_next.setChecked(bool(onion.get("show_next", True)))
            for widget, key, default in ((self.onion_prev_n, "prev_frames", 2),
                                         (self.onion_next_n, "next_frames", 1),
                                         (self.onion_opacity, "opacity", 45)):
                widget.blockSignals(True)
                widget.setValue(int(onion.get(key, default)))
                widget.blockSignals(False)
            self.onion_tint.setChecked(bool(onion.get("tint", True)))
            self.onion_falloff.setChecked(bool(onion.get("alpha_falloff", True)))
            self.grid_check.setChecked(bool(session.project.settings.get("grid", {})
                                            .get("visible", False)))
            self.checker_check.setChecked(bool(session.project.settings.get("canvas", {})
                                               .get("checker", True)))
            self.autosave_check.setChecked(bool(session.project.settings.get("autosave", {})
                                                .get("enabled", True)))
            self.autosave_min.blockSignals(True)
            self.autosave_min.setValue(int(session.project.settings.get("autosave", {})
                                           .get("interval_sec", 180)) // 60)
            self.autosave_min.blockSignals(False)
            if self.notes.toPlainText() != scene.notes:
                self.notes.blockSignals(True)
                self.notes.setPlainText(scene.notes)
                self.notes.blockSignals(False)
            # camera
            self.camera_combo.blockSignals(True)
            self.camera_combo.clear()
            for camera in scene.cameras:
                self.camera_combo.addItem(camera.name, camera.uid)
            active = scene.active_camera_uid
            for i in range(self.camera_combo.count()):
                if self.camera_combo.itemData(i) == active:
                    self.camera_combo.setCurrentIndex(i)
                    break
            self.camera_combo.blockSignals(False)
            cam = scene.camera()
            values = cam.value_at(frame)
            for key, box in self.cam_spins.items():
                box.blockSignals(True)
                box.setValue(float(values.get(key, 0.0)))
                box.blockSignals(False)
            self.camera_view_check.setChecked(session.camera_view)
            self.shot_list.setText("Shots: " + (", ".join(
                f"{s.name} ({s.start}-{s.end})" for s in scene.shots) or "none yet"))
        finally:
            self._updating = False

    def sync_brush(self) -> None:
        brush = self.session.brush
        self._updating = True
        try:
            values = {
                "size": brush.size, "opacity": brush.opacity * 100.0,
                "hardness": brush.hardness * 100.0, "smoothing": brush.smoothing * 100.0,
                "stabilize": brush.stabilize * 100.0, "spacing": brush.spacing * 100.0,
                "taper_in": brush.taper_in * 100.0, "taper_out": brush.taper_out * 100.0,
                "texture": brush.texture * 100.0,
            }
            for key, box in self.brush_spins.items():
                box.blockSignals(True)
                box.setValue(float(values.get(key, 0.0)))
                box.blockSignals(False)
            self.pressure_size.setChecked(brush.pressure_size)
            self.pressure_opacity.setChecked(brush.pressure_opacity)
            self.primary_btn.setStyleSheet(
                f"background:{self.session.primary_color.name()};color:#fff;")
            self.secondary_btn.setStyleSheet(
                f"background:{self.session.secondary_color.name()};color:#fff;")
            drawing = self.session.project.settings.get("drawing", {})
            self.gap_spin.blockSignals(True)
            self.gap_spin.setValue(int(drawing.get("gap_close", 2)))
            self.gap_spin.blockSignals(False)
            self.tol_spin.blockSignals(True)
            self.tol_spin.setValue(int(drawing.get("fill_tolerance", 32)))
            self.tol_spin.blockSignals(False)
            self.sample_layers.setChecked(bool(drawing.get("sample_all_layers", False)))
            idx = self.shape_combo.findData(drawing.get("shape_kind", "line"))
            self.shape_combo.blockSignals(True)
            self.shape_combo.setCurrentIndex(max(0, idx))
            self.shape_combo.blockSignals(False)
            self.sides_spin.blockSignals(True)
            self.sides_spin.setValue(int(drawing.get("shape_sides", 5)))
            self.sides_spin.blockSignals(False)
            self.filled_check.setChecked(bool(drawing.get("shape_filled", False)))
            self.text_size.blockSignals(True)
            self.text_size.setValue(int(drawing.get("text_size", 96)))
            self.text_size.blockSignals(False)
        finally:
            self._updating = False

    # --------------------------------------------------------------- actions
    def _on_transform(self, prop: str, value: float) -> None:
        if self._updating:
            return
        layer = self.session.active_layer()
        if layer is None:
            return
        self.session.set_transform_prop(layer, prop, float(value), merge=True)

    def _on_brush(self, key: str, value: float) -> None:
        if self._updating:
            return
        value = float(value)
        if key in ("opacity", "hardness", "smoothing", "stabilize", "spacing", "taper_in",
                   "taper_out", "texture"):
            value /= 100.0
        self.session.set_brush_prop(key, value)

    def _on_brush_preset(self, index: int) -> None:
        if self._updating:
            return
        brush = self.brush_combo.itemData(index)
        if brush is not None:
            self.session.set_brush(brush)
            self.session.status(f"Brush: {brush.name}")

    def _pick_color(self, which: str) -> None:
        current = self.session.primary_color if which == "primary" else self.session.secondary_color
        color = QColorDialog.getColor(current, self, "Choose colour")
        if not color.isValid():
            return
        if which == "primary":
            self.session.primary_color = color
            self.session.set_brush_prop("color", (color.red(), color.green(), color.blue(),
                                                  color.alpha()))
        else:
            self.session.secondary_color = color
        self.sync_brush()

    def _setting(self, section: str, key: str, value) -> None:
        if self._updating:
            return
        self.session.project.settings.setdefault(section, {})[key] = value
        self.session.canvas_changed.emit()
        self.session.mark_dirty(True)

    def _onion(self, key: str, value) -> None:
        if self._updating:
            return
        self.session.set_onion_prop(key, value)

    def _onion_color(self, key: str) -> None:
        color = QColorDialog.getColor(QColor(self.session.project.settings.get("onion", {})
                                             .get(key, "#ff5c7a")), self, "Onion colour")
        if color.isValid():
            self.session.set_onion_prop(key, color.name())

    def _toggle_camera_view(self) -> None:
        self.session.camera_view = self.camera_view_check.isChecked()
        self.session.canvas_changed.emit()
        self.session.status("Camera view" if self.session.camera_view else "Edit view")

    def _on_camera(self, key: str, value: float) -> None:
        if self._updating:
            return
        cam = self.session.scene.camera()
        prop = {"x": "pos_x", "y": "pos_y", "zoom": "zoom", "rotation": "rotation"}[key]
        track = getattr(cam, prop)
        old = track.value_at(self.session.frame)
        track.set_key(self.session.frame, float(value))

        def do(v):
            track.set_key(self.session.frame, float(v))
            self.session.canvas_changed.emit()

        self.session.command(f"Camera {key}", lambda: do(old), lambda: do(value), merge=True)

    def _key_camera(self, key: str) -> None:
        cam = self.session.scene.camera()
        prop = {"x": "pos_x", "y": "pos_y", "zoom": "zoom", "rotation": "rotation"}[key]
        track = getattr(cam, prop)
        track.set_key(self.session.frame, track.value_at(self.session.frame))
        self.session.timeline_changed.emit()

    def _add_shake(self) -> None:
        cam = self.session.scene.camera()
        cam.add_shake(self.session.frame)
        self.session.timeline_changed.emit()
        self.session.status("Camera shake added")

    def _add_shot(self) -> None:
        from ..model.camera import Shot
        scene = self.session.scene
        start = self.session.frame
        shot = Shot(f"Shot {len(scene.shots) + 1}", start, start + 48,
                    scene.active_camera_uid)
        scene.shots.append(shot)
        self.session.command("Add shot", lambda: scene.shots.remove(shot),
                             lambda: scene.shots.append(shot))
        self.sync()
        self.session.timeline_changed.emit()

    def _on_camera_selected(self, index: int) -> None:
        if self._updating:
            return
        uid = self.camera_combo.itemData(index)
        if uid:
            self.session.scene.active_camera_uid = uid
            self.session.canvas_changed.emit()
            self.sync()

    def _range_changed(self) -> None:
        if self._updating:
            return
        self.session.set_scene_range(self.start_spin.value(),
                                     max(self.start_spin.value() + 1, self.end_spin.value()))

    def _on_size(self, index: int) -> None:
        if self._updating:
            return
        size = self.size_combo.itemData(index)
        if not size or size[0] == 0:
            return
        scene = self.session.scene
        old = (scene.width, scene.height)

        def do(value):
            scene.width, scene.height = value
            for layer in scene.layers:
                layer.size = value
                for ref in layer.cels.values():
                    if hasattr(ref.cel, "resize"):
                        ref.cel.resize(value)
            for rig in scene.rigs.values():
                pass
            self.session.canvas_changed.emit()
            self.session.timeline_changed.emit()

        self.session.command("Scene size", lambda: do(old), lambda: do(tuple(size)))
        self.session.canvas_changed.emit()

    def _pick_background(self) -> None:
        color = QColorDialog.getColor(QColor(self.session.scene.background_color), self,
                                      "Scene background")
        if color.isValid():
            self.session.set_scene_background(color.name())
            self.sync()

    def _toggle_grid(self) -> None:
        if self._updating:
            return
        grid = self.session.project.settings.setdefault("grid", {"visible": False})
        grid["visible"] = self.grid_check.isChecked()
        self.session.canvas_changed.emit()

    def _autosave_interval(self, minutes: int) -> None:
        if self._updating:
            return
        self.session.project.settings.setdefault("autosave", {})["interval_sec"] = int(minutes) * 60
        self.session.start_autosave()

    def reset_transform(self) -> None:
        layer = self.session.active_layer()
        if layer is None:
            return
        before = layer.transform.to_dict()
        from ..model.keyframe import TransformTracks
        layer.transform = TransformTracks()
        after = layer.transform.to_dict()

        def do(state):
            layer.transform = TransformTracks.from_dict(state)
            self.session.canvas_changed.emit()
            self.session.timeline_changed.emit()

        self.session.command("Reset transform", lambda: do(before), lambda: do(after))
        self.sync()
        self.session.canvas_changed.emit()


_ = (os, QGridLayout, Signal, QSize)
