"""Motion editor: the professional curve / graph editor for animation keys."""
from __future__ import annotations

from PySide6.QtCore import QPointF, QRectF, Qt, Signal
from PySide6.QtGui import (QBrush, QColor, QFont, QLinearGradient, QPainter, QPainterPath, QPen,
                           QPolygonF)
from PySide6.QtWidgets import (QCheckBox, QComboBox, QHBoxLayout, QLabel, QPushButton, QToolButton,
                               QVBoxLayout, QWidget)

from ..model.easing import EASING_LABELS, apply_easing
from .theme import C, get_icon

PROP_COLORS = {
    "pos.x": "#4f8cff",
    "pos.y": "#7ee0c1",
    "rotation": "#ffb347",
    "scale.x": "#f78fb3",
    "scale.y": "#c792ea",
    "opacity": "#ffd166",
    "skew.x": "#66d9ef",
    "skew.y": "#a6e22e",
    "bone.rotation": "#ff7ab6",
    "camera": "#9ad0ff",
}

PADDING = 26


class GraphEditor(QWidget):
    """Curves for position / rotation / scale / opacity with draggable handles."""

    status = Signal(str)

    def __init__(self, session, parent=None):
        super().__init__(parent)
        self.session = session
        self.setMinimumHeight(150)
        self.setMouseTracking(True)
        self.show_bones = False
        self.normalise = True
        self._props: list[str] = ["pos.x", "pos.y", "rotation"]
        self._drag = None
        self._hover = None
        self.zoom_x = 1.0
        self.zoom_y = 1.0
        self.pan_x = 0.0
        self.pan_y = 0.0
        self._build_controls()
        s = session
        s.canvas_changed.connect(self.update)
        s.timeline_changed.connect(self.update)
        s.layer_selected.connect(lambda *_: self.update())
        s.frame_changed.connect(lambda *_: self.update())
        s.selection_changed.connect(self.update)

    # ---------------------------------------------------------------- chrome
    def _build_controls(self) -> None:
        bar = QHBoxLayout(self)
        bar.setContentsMargins(4, 2, 4, 2)
        bar.setSpacing(4)
        self._bar = bar
        self.title = QLabel("Motion editor")
        self.title.setObjectName("section")
        bar.addWidget(self.title)
        self.prop_button = QToolButton()
        self.prop_button.setText("Channels")
        self.prop_button.setPopupMode(QToolButton.InstantPopup)
        menu = self._channel_menu()
        self.prop_button.setMenu(menu)
        bar.addWidget(self.prop_button)
        bar.addStretch(1)
        self.fit_btn = QPushButton("Fit")
        self.fit_btn.setToolTip("Frame the curves")
        self.fit_btn.clicked.connect(self.fit)
        bar.addWidget(self.fit_btn)
        self.auto_btn = QPushButton("Auto smoothing")
        self.auto_btn.setCheckable(True)
        self.auto_btn.setChecked(True)
        self.auto_btn.setToolTip("Smooth the motion between keys automatically")
        self.auto_btn.clicked.connect(self._apply_auto_smoothing)
        bar.addWidget(self.auto_btn)
        self.ease_combo = QComboBox()
        for key, label in EASING_LABELS:
            self.ease_combo.addItem(label, key)
        self.ease_combo.setToolTip("Apply an easing preset to the selected key")
        self.ease_combo.currentIndexChanged.connect(self._apply_easing)
        bar.addWidget(self.ease_combo)
        self.bone_check = QCheckBox("Bones")
        self.bone_check.setToolTip("Show bone rotation curves as well")
        self.bone_check.clicked.connect(self._toggle_bones)
        bar.addWidget(self.bone_check)

    def _channel_menu(self):
        from PySide6.QtWidgets import QMenu
        menu = QMenu(self)
        for prop in ("pos.x", "pos.y", "rotation", "scale.x", "scale.y", "opacity",
                     "skew.x", "skew.y"):
            action = menu.addAction(prop)
            action.setCheckable(True)
            action.setChecked(prop in self._props)
            action.toggled.connect(lambda checked, p=prop: self._toggle_prop(p, checked))
        return menu

    def _toggle_prop(self, prop: str, checked: bool) -> None:
        if checked and prop not in self._props:
            self._props.append(prop)
        elif not checked and prop in self._props:
            self._props.remove(prop)
        self.update()

    def _toggle_bones(self) -> None:
        self.show_bones = self.bone_check.isChecked()
        self.update()

    def _apply_easing(self) -> None:
        self.session.set_key_easing(self.ease_combo.currentData())

    def _apply_auto_smoothing(self) -> None:
        self.session.apply_auto_smoothing(self.auto_btn.isChecked())

    # ------------------------------------------------------------- geometry
    def _tracks(self):
        session = self.session
        layer = session.active_layer()
        out: list[tuple[str, object, str]] = []
        if layer is None:
            return out
        for prop in self._props:
            track = layer.transform.tracks.get(prop)
            if track is not None and track.keys:
                out.append((prop, track, PROP_COLORS.get(prop, C.accent)))
        if self.show_bones:
            rig = session.active_rig()
            if rig is not None:
                for bone in rig.ordered_bones():
                    if bone.rotation.keys:
                        out.append((f"{bone.name} rot", bone.rotation, PROP_COLORS["bone.rotation"]))
        cam = session.scene.camera()
        for name, track in (("camera.x", cam.pos_x), ("camera.y", cam.pos_y),
                            ("camera.zoom", cam.zoom)):
            if track.keys:
                out.append((name, track, PROP_COLORS["camera"]))
        return out

    def fit(self) -> None:
        self.zoom_x = 1.0
        self.zoom_y = 1.0
        self.pan_x = 0.0
        self.pan_y = 0.0
        self.update()

    def _frame_range(self) -> tuple[float, float]:
        scene = self.session.scene
        start = float(scene.frame_start) + self.pan_x
        end = float(max(scene.total_frames(), scene.frame_end))
        span = max(4.0, (end - start) / self.zoom_x)
        return start, start + span

    def _value_range(self) -> tuple[float, float]:
        tracks = self._tracks()
        lo, hi = 0.0, 100.0
        first = True
        for _name, track, _color in tracks:
            for key in track.keys:
                value = float(key.value)
                if first:
                    lo = hi = value
                    first = False
                lo = min(lo, value)
                hi = max(hi, value)
        if hi - lo < 1e-6:
            hi = lo + 100.0
        pad = (hi - lo) * 0.16
        mid = (hi + lo) * 0.5
        span = (hi - lo + pad * 2) / self.zoom_y
        span = max(1.0, span)
        return mid - span / 2 + self.pan_y, mid + span / 2 + self.pan_y

    def _x(self, frame: float) -> float:
        f0, f1 = self._frame_range()
        rect = self.width() - PADDING * 2
        return PADDING + (frame - f0) / max(1e-6, f1 - f0) * rect

    def _y(self, value: float) -> float:
        v0, v1 = self._value_range()
        rect = self.height() - PADDING * 2
        return self.height() - PADDING - (value - v0) / max(1e-6, v1 - v0) * rect

    def _key_at(self, pos: QPointF):
        best = None
        best_d = 9.0
        for name, track, color in self._tracks():
            for key in track.keys:
                x = self._x(key.frame)
                y = self._y(float(key.value))
                d = ((x - pos.x()) ** 2 + (y - pos.y()) ** 2) ** 0.5
                if d < best_d:
                    best = (name, track, key, color, x, y)
                    best_d = d
        return best

    def _handle_at(self, pos: QPointF):
        for name, track, color in self._tracks():
            for key in track.keys:
                if not key.bezier:
                    continue
                x = self._x(key.frame)
                y = self._y(float(key.value))
                next_key = next((k for k in track.sorted_keys() if k.frame > key.frame), None)
                if next_key is None:
                    continue
                controls = ((key.bezier[0], key.bezier[1]), (key.bezier[2], key.bezier[3]))
                for index, (cx, cy) in enumerate(controls):
                    hx = x + cx * (self._x(next_key.frame) - x)
                    hy = y + cy * (self._y(float(next_key.value)) - y)
                    if abs(hx - pos.x()) < 7 and abs(hy - pos.y()) < 7:
                        return name, track, key, index
        return None

    # ------------------------------------------------------------- painting
    def paintEvent(self, event) -> None:
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing, True)
        p.fillRect(self.rect(), QColor(C.graph_bg))
        tracks = self._tracks()
        if not tracks:
            p.setPen(QPen(QColor(C.text_faint)))
            p.drawText(self.rect(), Qt.AlignCenter,
                       "No animated channels yet — key a transform (K) to see curves here")
            p.end()
            return
        v0, v1 = self._value_range()
        f0, f1 = self._frame_range()
        # grid
        p.setPen(QPen(QColor(255, 255, 255, 18), 1))
        steps = 6
        for i in range(steps + 1):
            y = PADDING + (self.height() - PADDING * 2) * i / steps
            p.drawLine(QPointF(PADDING, y), QPointF(self.width() - PADDING, y))
            value = v1 - (v1 - v0) * i / steps
            p.setPen(QPen(QColor(C.text_faint)))
            p.drawText(QPointF(4, y + 4), f"{value:.0f}")
            p.setPen(QPen(QColor(255, 255, 255, 18), 1))
        p.drawLine(QPointF(PADDING, self.height() - PADDING),
                   QPointF(self.width() - PADDING, self.height() - PADDING))
        # frame ruler
        f = int(f0)
        while f <= f1:
            x = self._x(f)
            p.setPen(QPen(QColor(255, 255, 255, 22), 1))
            p.drawLine(QPointF(x, self.height() - PADDING), QPointF(x, self.height() - PADDING + 5))
            p.setPen(QPen(QColor(C.text_faint)))
            p.drawText(QPointF(x + 2, self.height() - 8), str(f))
            f += max(1, int((f1 - f0) / 12))
        # playhead
        x = self._x(self.session.current_frame)
        p.setPen(QPen(QColor(C.timeline_playhead), 1.4))
        p.drawLine(QPointF(x, PADDING * 0.4), QPointF(x, self.height() - PADDING))

        for name, track, color in tracks:
            pen = QPen(QColor(color), 1.8)
            p.setPen(pen)
            path = QPainterPath()
            keys = track.sorted_keys()
            for i, key in enumerate(keys):
                px, py = self._x(key.frame), self._y(float(key.value))
                if i == 0:
                    path.moveTo(px, py)
                    continue
                prev = keys[i - 1]
                c1, c2 = _control_points(prev, key, self._x, self._y)
                path.cubicTo(c1[0], c1[1], c2[0], c2[1], px, py)
            p.drawPath(path)
            # key dots
            for key in keys:
                px, py = self._x(key.frame), self._y(float(key.value))
                selected = key.frame == self.session.frame
                p.setBrush(QBrush(QColor("#ffffff" if selected else color)))
                p.setPen(QPen(QColor(0, 0, 0, 120), 1))
                size = 4.6 if selected else 3.6
                p.drawPolygon(QPolygonF([QPointF(px, py - size), QPointF(px + size, py),
                                         QPointF(px, py + size), QPointF(px - size, py)]))
                # bezier handles
                next_key = next((k for k in keys if k.frame > key.frame), None)
                if next_key is not None and key.bezier:
                    for (cx, cy) in ((key.bezier[0], key.bezier[1]),
                                     (key.bezier[2], key.bezier[3])):
                        hx = px + cx * (self._x(next_key.frame) - px)
                        hy = py + cy * (self._y(float(next_key.value)) - py)
                        p.setPen(QPen(QColor(color), 1, Qt.DashLine))
                        p.drawLine(QPointF(px, py), QPointF(hx, hy))
                        p.setBrush(QBrush(QColor("#ffffff")))
                        p.setPen(QPen(QColor(color), 1))
                        p.drawEllipse(QPointF(hx, hy), 3.4, 3.4)
        # legend
        font = QFont(p.font())
        font.setPointSizeF(8.0)
        p.setFont(font)
        for i, (name, _track, color) in enumerate(tracks[:8]):
            p.setPen(QPen(QColor(color)))
            p.drawText(QPointF(PADDING + 6, PADDING - 8 - i * 0), "")
            p.setPen(QPen(QColor(color)))
            p.drawText(QPointF(PADDING + i * 92.0, 14), name)
        grad = QLinearGradient(0, 0, 0, 14)
        grad.setColorAt(0, QColor(0, 0, 0, 140))
        grad.setColorAt(1, QColor(0, 0, 0, 0))
        p.fillRect(QRectF(0, 0, self.width(), 14), QBrush(grad))
        p.end()

    # ------------------------------------------------------------ interaction
    def mousePressEvent(self, event) -> None:
        pos = QPointF(event.position())
        handle = self._handle_at(pos)
        if handle is not None and event.button() == Qt.LeftButton:
            name, track, key, handle_index = handle
            self._drag = {"mode": "handle", "track": track, "key": key,
                          "handle": handle_index, "before": key.bezier}
            return
        hit = self._key_at(pos)
        if hit is None:
            if event.button() == Qt.MiddleButton:
                self._drag = {"mode": "pan", "pos": pos, "pan": (self.pan_x, self.pan_y)}
            return
        name, track, key, color, _x, _y = hit
        self.session.set_frame(key.frame)
        if event.button() == Qt.LeftButton:
            self._drag = {"mode": "key", "track": track, "key": key, "name": name,
                          "start": (key.frame, float(key.value)),
                          "start_pos": pos}
            self.status.emit(f"{name} key at frame {key.frame} = {key.value:.2f}")

    def mouseMoveEvent(self, event) -> None:
        pos = QPointF(event.position())
        if self._drag is None:
            self._hover = self._key_at(pos)
            self.update()
            return
        mode = self._drag["mode"]
        if mode == "pan":
            delta = pos - self._drag["pos"]
            self.pan_x = self._drag["pan"][0] - delta.x() * 2
            self.pan_y = self._drag["pan"][1] + delta.y() * 2
            self.update()
            return
        if mode == "key":
            track = self._drag["track"]
            key = self._drag["key"]
            before = self._drag["before"] if "before" in self._drag else None
            if before is None:
                self._drag["before"] = track.to_dict()
            delta = pos - self._drag["start_pos"]
            frame = max(0, int(round(self._drag["start"][0] + delta.x() / 8.0)))
            value = self._drag["start"][1] - delta.y() * 0.5
            key.frame = frame
            key.value = value
            self.session.timeline_changed.emit()
            self.session.canvas_changed.emit()
            self.status.emit(f"frame {key.frame} · value {key.value:.2f}")
            self.update()
            return
        if mode == "handle":
            track = self._drag["track"]
            key = self._drag["key"]
            next_key = next((k for k in track.sorted_keys() if k.frame > key.frame), None)
            if next_key is None:
                return
            x0, y0 = self._x(key.frame), self._y(float(key.value))
            x1, y1 = self._x(next_key.frame), self._y(float(next_key.value))
            index = self._drag["handle"]
            if abs(x1 - x0) < 1e-3:
                return
            cx = (pos.x() - x0) / (x1 - x0)
            cy = (pos.y() - y0) / (y1 - y0) if abs(y1 - y0) > 1e-3 else 0.0
            values = list(key.bezier or (0.42, 0.0, 0.58, 1.0))
            if index == 0:
                values[0] = max(0.0, min(1.0, cx))
                values[1] = cy
            else:
                values[2] = max(0.0, min(1.0, cx))
                values[3] = cy
            key.bezier = tuple(values)
            key.easing = "bezier"
            self.session.canvas_changed.emit()
            self.session.timeline_changed.emit()
            self.update()

    def mouseReleaseEvent(self, event) -> None:
        drag = self._drag
        self._drag = None
        if drag is None:
            return
        if drag["mode"] in ("key", "handle"):
            track = drag["track"]
            before = drag.get("before")
            if before is None:
                return
            after = track.to_dict()
            session = self.session

            def do(state, forward: bool):
                restored = track.__class__.from_dict(state)
                track.keys = restored.keys
                session.timeline_changed.emit()
                session.canvas_changed.emit()

            session.command("Edit motion curve", lambda: do(before, False), lambda: do(after, True))
        self.update()

    def wheelEvent(self, event) -> None:
        factor = 1.15 if event.angleDelta().y() > 0 else 1 / 1.15
        if event.modifiers() & Qt.ShiftModifier:
            self.zoom_y *= factor
        else:
            self.zoom_x *= factor
        self.zoom_x = max(0.15, min(12.0, self.zoom_x))
        self.zoom_y = max(0.15, min(40.0, self.zoom_y))
        self.update()

    def mouseDoubleClickEvent(self, event) -> None:
        hit = self._key_at(QPointF(event.position()))
        if hit is None:
            return
        _name, track, key, _color, _x, _y = hit
        session = self.session
        before = track.to_dict()
        track.remove_key(key.frame)
        after = track.to_dict()

        def do(state):
            restored = track.__class__.from_dict(state)
            track.keys = restored.keys
            session.timeline_changed.emit()
            session.canvas_changed.emit()

        session.command("Delete key", lambda: do(before), lambda: do(after))
        self.update()


def _control_points(prev, key, xf, yf):
    """Cubic control points between two keys, honouring their easing."""
    x0, y0 = xf(prev.frame), yf(float(prev.value))
    x1, y1 = xf(key.frame), yf(float(key.value))
    bezier = getattr(prev, "bezier", None)
    if bezier:
        c1x = x0 + bezier[0] * (x1 - x0)
        c1y = y0 + bezier[1] * (y1 - y0)
        c2x = x0 + bezier[2] * (x1 - x0)
        c2y = y0 + bezier[3] * (y1 - y0)
        return (c1x, c1y), (c2x, c2y)
    easing = getattr(prev, "easing", "linear") or "linear"
    samples = [apply_easing(easing, t / 6.0) for t in range(7)]
    c1 = samples[2]
    c2 = samples[4]
    return (x0 + (x1 - x0) / 3.0, y0 + (y1 - y0) * c1), (x0 + (x1 - x0) * 2 / 3.0,
                                                         y0 + (y1 - y0) * c2)


_ = (QCheckBox, get_icon)
