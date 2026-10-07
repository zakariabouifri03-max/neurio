"""The professional timeline: cels, keyframes, exposure, audio, camera, shots.

The widget paints itself and virtualises rows, so projects with hundreds of
layers and thousands of frames stay responsive.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from PySide6.QtCore import QPoint, QPointF, QRect, QRectF, Qt, Signal
from PySide6.QtGui import (QBrush, QColor, QFont, QFontMetrics, QLinearGradient, QPainter,
                           QPainterPath, QPen, QPolygonF)
from PySide6.QtWidgets import QMenu, QScrollBar, QSizePolicy, QWidget

from ..model.layer import Layer
from .theme import C, get_icon

HEADER_W = 196
RULER_H = 26
ROW_H = 21
MARKER_H = 16
MIN_PPF = 2.0
MAX_PPF = 40.0
DRAG_THRESHOLD = 4


@dataclass
class Row:
    kind: str                    # layer | bone | camera | audio | shot | marker | summary
    uid: str = ""
    label: str = ""
    depth: int = 0
    layer: Layer | None = None
    bone_uid: str = ""
    audio: object = None
    height: int = ROW_H
    expandable: bool = False
    expanded: bool = False


class TimelineWidget(QWidget):
    """Custom painted timeline bound to an EditorSession."""

    status = Signal(str)

    def __init__(self, session, parent=None):
        super().__init__(parent)
        self.session = session
        self.setMouseTracking(True)
        self.setFocusPolicy(Qt.StrongFocus)
        self.setMinimumHeight(150)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.pixels_per_frame = 12.0
        self.scroll_x = 0.0
        self.scroll_y = 0
        self.vbar = QScrollBar(Qt.Vertical, self)
        self.vbar.setVisible(False)
        self.vbar.valueChanged.connect(self._on_vscroll)
        self._rows: list[Row] = []
        self._rows_dirty = True
        self._expanded: set[str] = set()
        self._drag = None
        self._hover_frame = -1
        self._hover_row = -1
        self._scrub = False
        self._audio_cache: dict[str, QPainterPath] = {}

        s = session
        s.layers_changed.connect(self.refresh)
        s.timeline_changed.connect(self.refresh)
        s.scene_changed.connect(self.refresh)
        s.frame_changed.connect(lambda *_: self.update())
        s.layer_selected.connect(lambda *_: self.update())
        s.rig_changed.connect(self.refresh)
        s.project_changed.connect(self.refresh)
        s.selection_changed.connect(lambda: self.update())

    # =====================================================================
    # model
    # =====================================================================
    def refresh(self) -> None:
        self._rows_dirty = True
        self._audio_cache.clear()
        self.update()

    def rows(self) -> list[Row]:
        if not self._rows_dirty:
            return self._rows
        session = self.session
        scene = session.scene
        out: list[Row] = []
        out.append(Row("marker", "markers", "Markers", height=MARKER_H))
        for layer in reversed(scene.layers):
            depth = self._depth_of(layer)
            row = Row("layer", layer.uid, layer.name, depth=depth, layer=layer,
                      expandable=layer.kind == "rig")
            row.expanded = layer.uid in self._expanded
            out.append(row)
            if layer.kind == "rig" and row.expanded:
                rig = scene.rigs.get(layer.rig_id or "")
                if rig is not None:
                    for bone in rig.ordered_bones():
                        out.append(Row("bone", bone.uid, bone.name, depth=depth + 1,
                                       layer=layer, bone_uid=bone.uid, height=18))
        out.append(Row("camera", "camera", "Camera", layer=None))
        for track in scene.audio_tracks:
            out.append(Row("audio", track.uid, track.name, audio=track))
        out.append(Row("shot", "shots", "Shots", height=MARKER_H))
        self._rows = out
        self._rows_dirty = False
        return out

    def _depth_of(self, layer: Layer) -> int:
        depth = 0
        parent = layer.parent_uid
        guard = 0
        while parent and guard < 32:
            parent_layer = self.session.scene.layer(parent)
            if parent_layer is None:
                break
            depth += 1
            parent = parent_layer.parent_uid
            guard += 1
        return depth

    def total_height(self) -> int:
        return sum(r.height for r in self.rows()) + 6

    def _visible_rows(self) -> tuple[list[tuple[int, Row, int]], int]:
        out = []
        y = 0
        top = self.scroll_y
        bottom = top + self.height() - RULER_H
        for index, row in enumerate(self.rows()):
            if y + row.height > top and y < bottom:
                out.append((index, row, y - top))
            y += row.height
        return out, y

    # =====================================================================
    # geometry
    # =====================================================================
    def frame_at(self, x: float) -> int:
        scene = self.session.scene
        f = scene.frame_start + int((x - HEADER_W + self.scroll_x) // self.pixels_per_frame)
        return int(max(0, f))

    def x_for_frame(self, frame: float) -> float:
        return HEADER_W - self.scroll_x + (frame - self.session.scene.frame_start) * \
            self.pixels_per_frame

    def row_at(self, y: float) -> tuple[int, Row] | None:
        if y < RULER_H:
            return None
        rows, _total = self._visible_rows()
        for index, row, ry in rows:
            if ry <= y <= ry + row.height:
                return index, row
        return None

    def _content_width(self) -> float:
        return self.width() - HEADER_W

    # =====================================================================
    # painting
    # =====================================================================
    def paintEvent(self, event) -> None:
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing, False)
        p.fillRect(self.rect(), QColor(C.timeline_bg))
        scene = self.session.scene
        session = self.session
        rows, total_h = self._visible_rows()
        f0 = self.frame_at(HEADER_W)
        f1 = self.frame_at(self.width())

        # ---- rows background
        p.save()
        p.setClipRect(HEADER_W, RULER_H, self.width() - HEADER_W, self.height() - RULER_H)
        for i, row, y in rows:
            top = RULER_H + y
            color = C.timeline_row if i % 2 == 0 else C.timeline_row_alt
            if row.kind == "layer" and row.layer is session.active_layer():
                color = "#232b3d"
            p.fillRect(QRectF(0, top, self.width(), row.height), QColor(color))
            if row.height > ROW_H:
                p.fillRect(QRectF(0, top, self.width(), row.height), QColor(0, 0, 0, 30))
        # vertical frame grid
        step = self._grid_step()
        pen = QPen(QColor(C.border), 1)
        p.setPen(pen)
        f = max(scene.frame_start, (f0 // step) * step)
        while f <= f1:
            x = self.x_for_frame(f)
            p.setPen(QPen(QColor(70, 78, 96, 90 if f % (step * 5) else 150), 1))
            p.drawLine(QPointF(x, RULER_H), QPointF(x, self.height()))
            f += step
        p.restore()

        # ---- content
        p.save()
        p.setClipRect(HEADER_W, RULER_H, self.width() - HEADER_W, self.height() - RULER_H)
        for i, row, y in rows:
            self._paint_row(p, row, i, y)
        # playhead
        x = self.x_for_frame(session.current_frame)
        grad = QLinearGradient(x - 8, 0, x + 8, 0)
        grad.setColorAt(0.0, QColor(255, 92, 122, 0))
        grad.setColorAt(0.5, QColor(255, 92, 122, 60))
        grad.setColorAt(1.0, QColor(255, 92, 122, 0))
        p.fillRect(QRectF(x - 8, RULER_H, 16, self.height()), QBrush(grad))
        p.setPen(QPen(QColor(C.timeline_playhead), 1.6))
        p.drawLine(QPointF(x, RULER_H - 4), QPointF(x, self.height()))
        p.setBrush(QBrush(QColor(C.timeline_playhead)))
        p.setPen(Qt.NoPen)
        p.drawPolygon(QPolygonF([QPointF(x - 5, RULER_H - 12), QPointF(x + 5, RULER_H - 12),
                                 QPointF(x, RULER_H - 4)]))
        # selection rectangle of cels
        for layer_uid, frame in session.selected_cels:
            layer = scene.layer(layer_uid)
            if layer is None:
                continue
            y = self._row_y(layer.uid)
            if y is None:
                continue
            span = layer.cel_span(frame) or (frame, frame)
            rect = QRectF(self.x_for_frame(span[0]), RULER_H + y + 2,
                          max(3.0, (span[1] - span[0] + 1) * self.pixels_per_frame), ROW_H - 5)
            p.setPen(QPen(QColor(C.accent), 1.4))
            p.setBrush(Qt.NoBrush)
            p.drawRect(rect)
        p.restore()

        # ---- ruler
        self._paint_ruler(p, f0, f1)

        # ---- header column
        self._paint_header(p, rows)

        # ---- borders
        p.setPen(QPen(QColor(C.border), 1))
        p.drawLine(QPointF(HEADER_W, 0), QPointF(HEADER_W, self.height()))
        p.drawLine(QPointF(0, RULER_H), QPointF(self.width(), RULER_H))
        p.end()

    def _grid_step(self) -> int:
        ppf = self.pixels_per_frame
        for step in (1, 2, 5, 10, 12, 24, 48, 96, 240, 480):
            if step * ppf >= 56:
                return step
        return 960

    def _paint_ruler(self, p: QPainter, f0: int, f1: int) -> None:
        scene = self.session.scene
        p.fillRect(QRectF(0, 0, self.width(), RULER_H), QColor(C.bg_alt))
        # range highlight
        x0 = self.x_for_frame(scene.frame_start)
        x1 = self.x_for_frame(scene.frame_end + 1)
        p.fillRect(QRectF(max(HEADER_W, x0), 0, max(0, x1 - max(HEADER_W, x0)), RULER_H),
                   QColor(79, 140, 255, 26))
        step = self._grid_step()
        label_step = step
        font = QFont(p.font())
        font.setPointSizeF(8.0)
        p.setFont(font)
        fm = QFontMetrics(font)
        if self.pixels_per_frame >= 6:
            label_step = step
        else:
            label_step = step
        f = max(scene.frame_start, (f0 // label_step) * label_step)
        p.setPen(QPen(QColor(C.text_faint)))
        while f <= f1:
            x = self.x_for_frame(f)
            p.setPen(QPen(QColor(C.border_light), 1))
            p.drawLine(QPointF(x, RULER_H - 7), QPointF(x, RULER_H))
            label = str(f)
            if fm.horizontalAdvance(label) + 6 < label_step * self.pixels_per_frame:
                p.setPen(QPen(QColor(C.text_dim)))
                p.drawText(QPointF(x + 3, RULER_H - 9), label)
            f += label_step
        # markers
        for mk in scene.markers:
            x = self.x_for_frame(mk.frame)
            if x < HEADER_W - 20 or x > self.width():
                continue
            p.setPen(QPen(QColor(mk.color), 1.2))
            p.setBrush(QBrush(QColor(mk.color)))
            p.drawPolygon(QPolygonF([QPointF(x, 3), QPointF(x + 6, 8), QPointF(x, 13),
                                     QPointF(x - 6, 8)]))
        # loop/range handle
        p.setPen(QPen(QColor(C.accent), 2))
        p.drawLine(QPointF(x0, 1), QPointF(x0, RULER_H - 1))
        p.drawLine(QPointF(x1, 1), QPointF(x1, RULER_H - 1))

    def _paint_header(self, p: QPainter, rows) -> None:
        session = self.session
        p.fillRect(QRectF(0, 0, HEADER_W, self.height()), QColor(C.bg_alt))
        p.fillRect(QRectF(0, 0, HEADER_W, RULER_H), QColor(C.panel))
        p.setPen(QPen(QColor(C.text_dim)))
        f = QFont(p.font())
        f.setPointSizeF(8.2)
        f.setBold(True)
        p.setFont(f)
        p.drawText(QRectF(8, 0, HEADER_W - 16, RULER_H), Qt.AlignVCenter | Qt.AlignLeft,
                   "TRACKS")
        f.setBold(False)
        p.setFont(f)
        for index, row, y in rows:
            top = RULER_H + y
            rect = QRectF(0, top, HEADER_W, row.height)
            if row.kind == "layer":
                layer = row.layer
                active = layer is session.active_layer()
                if active:
                    p.fillRect(rect, QColor(79, 140, 255, 30))
                p.fillRect(QRectF(0, top, 3, row.height), QColor(layer.color_tag))
                x = 8 + row.depth * 12
                # expander
                if row.expandable:
                    p.setPen(QPen(QColor(C.text_dim), 1.2))
                    cx, cy = x + 4, top + row.height / 2
                    if row.expanded:
                        p.drawLine(QPointF(cx - 4, cy - 2), QPointF(cx + 4, cy - 2))
                        p.drawLine(QPointF(cx, cy - 2), QPointF(cx, cy + 3))
                    else:
                        p.drawLine(QPointF(cx - 2, cy - 4), QPointF(cx - 2, cy + 4))
                        p.drawLine(QPointF(cx - 2, cy), QPointF(cx + 3, cy))
                    x += 14
                p.setPen(QPen(QColor(C.text if active else C.text_dim)))
                name = row.label
                fm = QFontMetrics(p.font())
                available = HEADER_W - x - 62
                if fm.horizontalAdvance(name) > available:
                    name = fm.elidedText(name, Qt.ElideRight, int(available))
                p.drawText(QRectF(x, top, available, row.height),
                           Qt.AlignVCenter | Qt.AlignLeft, name)
                # toggle buttons
                bx = HEADER_W - 54
                self._draw_toggle(p, bx, top + row.height / 2, "eye" if layer.visible else "eye_off",
                                  layer.visible)
                self._draw_toggle(p, bx + 18, top + row.height / 2, "lock" if layer.locked else "unlock",
                                  layer.locked)
                self._draw_toggle(p, bx + 36, top + row.height / 2, "add", False)
            else:
                p.setPen(QPen(QColor(C.text_dim if row.kind != "bone" else C.text_faint)))
                label = row.label
                indent = 10 + row.depth * 12
                p.drawText(QRectF(indent, top, HEADER_W - indent - 8, row.height),
                           Qt.AlignVCenter | Qt.AlignLeft, label)

    def _draw_toggle(self, p: QPainter, x: float, y: float, icon_name: str,
                     state: bool) -> None:
        size = 13
        rect = QRectF(x, y - size / 2, size, size)
        p.setPen(Qt.NoPen)
        p.setBrush(QBrush(QColor(C.panel_high if state else C.panel_alt)))
        p.drawRoundedRect(rect, 3, 3)
        color = C.accent if state else C.text_faint
        pm = get_icon(icon_name, color).pixmap(11, 11)
        p.drawPixmap(rect.topLeft() + QPointF(1, 1), pm)

    def _row_y(self, uid: str) -> int | None:
        rows, _ = self._visible_rows()
        for _i, row, y in rows:
            if row.uid == uid:
                return y
        return None

    def _paint_row(self, p: QPainter, row: Row, index: int, y: float) -> None:
        session = self.session
        scene = session.scene
        top = RULER_H + y
        ppf = self.pixels_per_frame
        f0 = self.frame_at(HEADER_W)
        f1 = self.frame_at(self.width())
        p.setRenderHint(QPainter.Antialiasing, True)

        if row.kind == "layer":
            layer = row.layer
            if layer is None:
                return
            keys = layer.cel_keys()
            for i, k in enumerate(keys):
                if k > f1:
                    break
                span = layer.cel_span(k) or (k, k)
                end = span[1]
                if end < f0:
                    continue
                x = self.x_for_frame(k)
                w = max(4.0, (end - k + 1) * ppf)
                rect = QRectF(x, top + 2, w, ROW_H - 5)
                hold = layer.is_hold_frame(k)
                base = QColor(layer.color_tag)
                color = QColor(base)
                color.setAlpha(90 if hold else 200)
                p.setPen(QPen(QColor(base.darker(140)), 1))
                p.setBrush(QBrush(color))
                p.drawRoundedRect(rect, 3, 3)
                if not hold:
                    p.setBrush(QBrush(QColor("#ffffff")))
                    p.setPen(Qt.NoPen)
                    p.drawEllipse(QPointF(x + 3.5, top + ROW_H / 2.0), 2.4, 2.4)
                if layer.kind == "vector":
                    p.setPen(QPen(QColor(0, 0, 0, 60), 1))
                    p.drawLine(QPointF(x + 5, top + 4), QPointF(x + 5, top + ROW_H - 5))
            # transform keys
            self._paint_keys(p, top, layer.transform.key_frames(), C.timeline_key)
            if layer.kind == "rig":
                rig = scene.rigs.get(layer.rig_id or "")
                if rig is not None and not row.expanded:
                    frames = set()
                    for bone in rig.bones.values():
                        frames |= set(bone.rotation.frames())
                    self._paint_keys(p, top, frames, "#7ee0c1", size=3.2)
                    for chain in rig.ik_chains:
                        frames = set(chain.target_x.frames()) | set(chain.target_y.frames())
                        self._paint_keys(p, top, frames, C.bone_ik, size=3.0)
        elif row.kind == "bone":
            rig = session.scene.rigs.get(row.layer.rig_id or "") if row.layer else None
            if rig is None:
                return
            bone = rig.bones.get(row.bone_uid)
            if bone is None:
                return
            frames = set(bone.rotation.frames())
            if bone.offset_x.keys or bone.offset_y.keys:
                self._paint_keys(p, top, set(bone.offset_x.frames()) | set(bone.offset_y.frames()),
                                 "#8ea2ff", size=3.0)
            self._paint_keys(p, top, frames, C.timeline_key, size=3.4)
            p.setPen(QPen(QColor(C.text_faint), 1))
            p.drawLine(QPointF(HEADER_W, top + row.height - 1), QPointF(self.width(), top + row.height - 1))
        elif row.kind == "camera":
            cam = scene.camera_at(session.frame)
            for camera in scene.cameras:
                frames = camera.key_frames()
                color = C.warn if camera.uid == scene.active_camera_uid else C.text_faint
                self._paint_keys(p, top, frames, color)
            # shot bands
            for shot in scene.shots:
                x = self.x_for_frame(shot.start)
                w = max(4.0, (shot.end - shot.start + 1) * ppf)
                p.setPen(Qt.NoPen)
                c = QColor(shot.color)
                c.setAlpha(70)
                p.setBrush(QBrush(c))
                p.drawRoundedRect(QRectF(x, top + row.height - 5, w, 3), 1.5, 1.5)
            _ = cam
        elif row.kind == "audio":
            track = row.audio
            span = max(1, track.frames(scene.fps))
            x = self.x_for_frame(track.start_frame)
            w = max(4.0, span * ppf)
            rect = QRectF(x, top + 2, w, row.height - 5)
            grad = QLinearGradient(rect.topLeft(), rect.bottomLeft())
            grad.setColorAt(0.0, QColor(61, 220, 151, 150))
            grad.setColorAt(1.0, QColor(61, 220, 151, 70))
            p.setBrush(QBrush(grad))
            p.setPen(QPen(QColor(61, 220, 151, 200), 1))
            p.drawRoundedRect(rect, 3, 3)
            # waveform
            if track.waveform:
                p.setPen(QPen(QColor(10, 30, 22, 200), 1))
                mid = top + row.height / 2.0
                n = len(track.waveform)
                step_px = max(1.0, self.pixels_per_frame / 2.0)
                xs = max(0.0, rect.left())
                while xs < rect.right():
                    idx = int((xs - rect.left()) / max(1.0, rect.width()) * n)
                    idx = max(0, min(n - 1, idx))
                    amp = track.waveform[idx] * (row.height - 8) / 2.0
                    p.drawLine(QPointF(xs, mid - amp), QPointF(xs, mid + amp))
                    xs += step_px
            for key in track.volume_track.frames():
                self._paint_keys(p, top, {key}, C.good, size=3.0)
            if track.muted:
                p.fillRect(rect, QColor(0, 0, 0, 90))
        elif row.kind == "marker":
            for mk in scene.markers:
                x = self.x_for_frame(mk.frame)
                p.setPen(QPen(QColor(mk.color), 1.2))
                p.setBrush(QBrush(QColor(mk.color)))
                p.drawPolygon(QPolygonF([QPointF(x, top + 3), QPointF(x + 6, top + row.height / 2),
                                         QPointF(x, top + row.height - 3),
                                         QPointF(x - 6, top + row.height / 2)]))
                p.setPen(QPen(QColor(C.text_dim)))
                p.drawText(QPointF(x + 8, top + row.height - 5), mk.name[:18])
        elif row.kind == "shot":
            for shot in scene.shots:
                x = self.x_for_frame(shot.start)
                w = max(6.0, (shot.end - shot.start + 1) * ppf)
                p.setPen(QPen(QColor(shot.color), 1))
                c = QColor(shot.color)
                c.setAlpha(40)
                p.setBrush(QBrush(c))
                p.drawRoundedRect(QRectF(x, top + 2, w, row.height - 5), 3, 3)
                p.setPen(QPen(QColor(C.text)))
                p.drawText(QRectF(x + 4, top, w - 8, row.height), Qt.AlignVCenter, shot.name[:24])
        p.setRenderHint(QPainter.Antialiasing, False)

    def _paint_keys(self, p: QPainter, top: float, frames, color: str, size: float = 3.6) -> None:
        ppf = self.pixels_per_frame
        f0 = self.frame_at(HEADER_W)
        f1 = self.frame_at(self.width())
        p.setPen(Qt.NoPen)
        for frame in sorted(frames):
            if frame < f0 - 2 or frame > f1 + 2:
                continue
            x = self.x_for_frame(frame)
            cy = top + ROW_H - 5
            p.setBrush(QBrush(QColor(color)))
            p.drawPolygon(QPolygonF([QPointF(x, cy - size), QPointF(x + size, cy),
                                     QPointF(x, cy + size), QPointF(x - size, cy)]))
        _ = ppf

    # =====================================================================
    # interaction
    # =====================================================================
    def mousePressEvent(self, event) -> None:
        pos = QPointF(event.position())
        session = self.session
        self.setFocus()
        if event.button() == Qt.MiddleButton:
            self._drag = {"mode": "pan", "x": pos.x(), "scroll": self.scroll_x}
            self.setCursor(Qt.ClosedHandCursor)
            return
        if event.button() == Qt.RightButton:
            self._context_menu(event)
            return
        if event.button() != Qt.LeftButton:
            return

        if pos.y() < RULER_H:
            if pos.x() > HEADER_W:
                self._scrub = True
                self._set_frame_from_x(pos.x())
            return

        if pos.x() <= HEADER_W:
            self._header_click(pos)
            return

        hit = self.row_at(pos.y())
        if hit is None:
            return
        index, row = hit
        frame = self.frame_at(pos.x())
        if row.kind == "layer":
            session.active_layer_uid = row.uid
            session.layer_selected.emit(row.uid)
            layer = row.layer
            keys = layer.cel_keys()
            clicked_key = None
            for k in keys:
                span = layer.cel_span(k) or (k, k)
                if span[0] <= frame <= span[1]:
                    clicked_key = k
                    break
            session.selected_cels = [(row.uid, clicked_key if clicked_key is not None else frame)]
            self._drag = {
                "mode": "cel", "layer": row.layer, "frame": frame,
                "key": clicked_key, "start_x": pos.x(), "moved": False,
                "orig": dict(layer.cels), "orig_selected": list(session.selected_cels),
            }
            self._set_frame_from_x(pos.x())
            session.selection_changed.emit()
        elif row.kind == "bone":
            rig = session.scene.rigs.get(row.layer.rig_id or "") if row.layer else None
            if rig is not None:
                session.selected_bones = [row.bone_uid]
                session.selection_changed.emit()
                session.rig_changed.emit()
                bone = rig.bones.get(row.bone_uid)
                if bone is not None:
                    self._drag = {
                        "mode": "bone_keys", "bone": bone, "frame": frame,
                        "orig": {p: getattr(bone, p).to_dict()
                                 for p in ("rotation", "offset_x", "offset_y", "scale")},
                        "start_x": pos.x(), "moved": False,
                    }
            self._set_frame_from_x(pos.x())
        elif row.kind == "camera":
            cam = session.scene.camera()
            self._drag = {
                "mode": "camera_keys", "camera": cam, "frame": frame,
                "orig": {p: getattr(cam, p).to_dict()
                         for p in ("pos_x", "pos_y", "zoom", "rotation")},
                "start_x": pos.x(), "moved": False,
            }
            self._set_frame_from_x(pos.x())
        elif row.kind == "audio":
            track = row.audio
            self._drag = {
                "mode": "audio", "track": track, "frame": frame,
                "start_frame": track.start_frame, "start_x": pos.x(), "moved": False,
            }
            self._set_frame_from_x(pos.x())
        elif row.kind in ("marker", "shot"):
            self._set_frame_from_x(pos.x())
            self._drag = {"mode": "scrub", "start_x": pos.x(), "moved": False}
        self.update()

    def _header_click(self, pos: QPointF) -> None:
        session = self.session
        hit = self.row_at(pos.y())
        if hit is None:
            return
        index, row = hit
        if row.kind == "layer":
            layer = row.layer
            bx = HEADER_W - 54
            if pos.x() >= bx - 6 and pos.x() <= bx + 13:
                session.set_layer_prop(layer.uid, "visible", not layer.visible, "Toggle visibility")
                return
            if bx + 12 <= pos.x() <= bx + 31:
                session.set_layer_prop(layer.uid, "locked", not layer.locked, "Toggle lock")
                return
            if bx + 30 <= pos.x() <= bx + 49:
                self._layer_menu(pos, layer)
                return
            if row.expandable and pos.x() < bx - 10:
                if layer.uid in self._expanded:
                    self._expanded.discard(layer.uid)
                else:
                    self._expanded.add(layer.uid)
                self.refresh()
                return
            session.active_layer_uid = layer.uid
            session.layer_selected.emit(layer.uid)
            self.update()

    def mouseMoveEvent(self, event) -> None:
        pos = QPointF(event.position())
        if self._drag is None:
            row = self.row_at(pos.y())
            self._hover_row = row[0] if row else -1
            self._hover_frame = self.frame_at(pos.x())
            self.update()
            return
        mode = self._drag.get("mode")
        if mode == "pan":
            self.scroll_x = max(0.0, self._drag["scroll"] - (pos.x() - self._drag["x"]))
            self.update()
            return
        if mode in ("scrub",):
            self._set_frame_from_x(pos.x())
            self._drag["moved"] = True
            return
        if mode == "cel":
            delta = int(round((pos.x() - self._drag["start_x"]) / self.pixels_per_frame))
            if delta != 0:
                self._drag["moved"] = True
            target = max(0, self._drag["frame"] + delta)
            self._drag["target"] = target
            self.update()
            return
        if mode in ("bone_keys", "camera_keys"):
            delta = int(round((pos.x() - self._drag["start_x"]) / self.pixels_per_frame))
            if delta != 0:
                self._drag["moved"] = True
            self._drag["delta"] = delta
            self.update()
            return
        if mode == "audio":
            delta = int(round((pos.x() - self._drag["start_x"]) / self.pixels_per_frame))
            self._drag["moved"] = delta != 0
            track = self._drag["track"]
            track.start_frame = max(self.session.scene.frame_start,
                                    self._drag["start_frame"] + delta)
            self.update()

    def mouseReleaseEvent(self, event) -> None:
        drag = self._drag
        self._drag = None
        self.setCursor(Qt.ArrowCursor)
        if drag is None:
            return
        mode = drag.get("mode")
        session = self.session
        if mode == "cel" and drag.get("moved"):
            layer = drag["layer"]
            target = max(0, drag.get("target", drag["frame"]))
            source = drag["key"] if drag["key"] is not None else drag["frame"]
            before = dict(drag["orig"])
            if source in before and target != source:
                ref = before[source]
                if target in before:
                    # swap so no drawing is lost
                    before[source] = before[target]
                    before[target] = ref
                else:
                    del before[source]
                    before[target] = ref
                layer.cels = dict(before)
                after = dict(layer.cels)

                def do(state):
                    layer.cels = dict(state)
                    session.timeline_changed.emit()
                    session.canvas_changed.emit()

                session.command("Move cel", lambda: do(before), lambda: do(after))
                session.selected_cels = [(layer.uid, target)]
                session.set_frame(target)
                session.status(f"Moved cel to frame {target}")
        elif mode == "bone_keys" and drag.get("moved"):
            bone = drag["bone"]
            delta = drag.get("delta", 0)
            snapshots = drag["orig"]
            if delta:
                for prop in ("rotation", "offset_x", "offset_y", "scale"):
                    getattr(bone, prop).shift(delta)
                after = {p: getattr(bone, p).to_dict() for p in
                         ("rotation", "offset_x", "offset_y", "scale")}

                def do(state):
                    for prop, snap in state.items():
                        track = getattr(bone, prop)
                        restored = track.__class__.from_dict(snap)
                        setattr(bone, prop, restored)
                    session.timeline_changed.emit()
                    session.canvas_changed.emit()

                session.command("Move keys", lambda: do(snapshots), lambda: do(after))
        elif mode == "camera_keys" and drag.get("moved"):
            cam = drag["camera"]
            delta = drag.get("delta", 0)
            snapshots = drag["orig"]
            if delta:
                for prop in ("pos_x", "pos_y", "zoom", "rotation"):
                    getattr(cam, prop).shift(delta)
                after = {p: getattr(cam, p).to_dict() for p in
                         ("pos_x", "pos_y", "zoom", "rotation")}

                def do(state):
                    for prop, snap in state.items():
                        track = getattr(cam, prop)
                        restored = track.__class__.from_dict(snap)
                        setattr(cam, prop, restored)
                    session.timeline_changed.emit()

                session.command("Move camera keys", lambda: do(snapshots), lambda: do(after))
        elif mode == "audio" and drag.get("moved"):
            track = drag["track"]
            old = drag["start_frame"]
            new = track.start_frame
            session.command("Move audio",
                            lambda: (setattr(track, "start_frame", old), session.timeline_changed.emit()),
                            lambda: (setattr(track, "start_frame", new), session.timeline_changed.emit()))
        self.update()

    def mouseDoubleClickEvent(self, event) -> None:
        pos = QPointF(event.position())
        hit = self.row_at(pos.y())
        if hit is None or pos.x() <= HEADER_W:
            return
        index, row = hit
        frame = self.frame_at(pos.x())
        session = self.session
        if row.kind == "marker":
            self._add_marker(frame)
        elif row.kind == "shot":
            self._add_shot(frame)
        elif row.kind == "layer":
            session.active_layer_uid = row.uid
            session.layer_selected.emit(row.uid)
            layer = row.layer
            hit_cel = layer.cel_at(frame)
            if hit_cel is None:
                session.add_frame()
            else:
                self._cel_menu(pos, layer, frame)

    def wheelEvent(self, event) -> None:
        if event.modifiers() & Qt.ControlModifier:
            factor = 1.18 if event.angleDelta().y() > 0 else 1 / 1.18
            anchor = self.frame_at(QPointF(event.position()).x())
            self.pixels_per_frame = max(MIN_PPF, min(MAX_PPF, self.pixels_per_frame * factor))
            self.scroll_x = max(0.0, (anchor - self.session.scene.frame_start) *
                                self.pixels_per_frame - (QPointF(event.position()).x() - HEADER_W))
            self.update()
        else:
            self.scroll_y = max(0, self.scroll_y - int(event.angleDelta().y() / 2))
            self._clamp_scroll()
            self.update()

    def resizeEvent(self, event) -> None:
        self._clamp_scroll()
        self.vbar.setGeometry(self.width() - 10, RULER_H, 10, self.height() - RULER_H)
        self.update()

    def _clamp_scroll(self) -> None:
        content = self.total_height()
        view = self.height() - RULER_H
        self.scroll_y = max(0, min(max(0, content - view), self.scroll_y))
        self.vbar.setVisible(content > view)
        self.vbar.setRange(0, max(0, content - view))
        self.vbar.setPageStep(view)
        self.vbar.setValue(self.scroll_y)

    def _on_vscroll(self, value: int) -> None:
        self.scroll_y = value
        self.update()

    def _set_frame_from_x(self, x: float) -> None:
        frame = self.frame_at(x)
        frame = max(self.session.scene.frame_start - 8, frame)
        self.session.set_frame(frame)

    # =====================================================================
    # context menus
    # =====================================================================
    def _context_menu(self, event) -> None:
        pos = QPointF(event.position())
        session = self.session
        hit = self.row_at(pos.y())
        menu = QMenu(self)
        frame = self.frame_at(pos.x())
        if hit is not None:
            index, row = hit
            if row.kind == "layer":
                layer = row.layer
                session.active_layer_uid = layer.uid
                session.layer_selected.emit(layer.uid)
                menu.addAction("Insert frame", lambda: session.insert_frame(1))
                menu.addAction("Add blank keyframe", lambda: session.add_frame())
                menu.addAction("Duplicate keyframe", lambda: session.duplicate_frame())
                menu.addAction("Delete frame", lambda: session.delete_frame())
                menu.addSeparator()
                sub = menu.addMenu("Exposure")
                for hold in (1, 2, 3, 4, 6, 8, 12):
                    sub.addAction(f"{hold} frame{'s' if hold > 1 else ''}",
                                  lambda h=hold: session.set_exposure(h))
                menu.addSeparator()
                menu.addAction("Key transform here", lambda: session.key_transform())
                menu.addAction("Delete keys here", lambda: session.delete_keys_at(frame))
                menu.addSeparator()
                ease = menu.addMenu("Easing")
                from ..model.easing import EASING_LABELS
                for key, label in EASING_LABELS:
                    ease.addAction(label, lambda k=key: session.set_key_easing(k))
                menu.addSeparator()
                menu.addAction("Layer properties…", lambda: self._layer_menu(pos, layer))
                if row.kind == "layer" and layer.kind == "rig":
                    menu.addAction("Auto key pose",
                                   lambda: session.key_bone_pose())
            elif row.kind == "audio":
                track = row.audio
                menu.addAction("Mute" if not track.muted else "Unmute",
                               lambda: self._toggle_audio(track, "muted"))
                menu.addAction("Solo" if not track.solo else "Unsolo",
                               lambda: self._toggle_audio(track, "solo"))
                menu.addAction("Delete audio", lambda: self._delete_audio(track))
                menu.addSeparator()
                menu.addAction("Volume key here",
                               lambda: track.volume_track.set_key(frame, track.volume))
            elif row.kind == "camera":
                cam = session.scene.camera()
                menu.addAction("Key camera here", lambda: self._key_camera(cam, frame))
                menu.addAction("Camera shake here",
                               lambda: (cam.add_shake(frame), session.timeline_changed.emit()))
                menu.addAction("New camera", lambda: session.scene.add_camera())
                menu.addAction("Add shot here", lambda: self._add_shot(frame))
            elif row.kind == "marker":
                menu.addAction("Add marker here", lambda: self._add_marker(frame))
                if session.scene.markers:
                    menu.addAction("Clear markers", self._clear_markers)
            elif row.kind == "shot":
                menu.addAction("Add shot here", lambda: self._add_shot(frame))
            elif row.kind == "bone":
                rig = session.scene.rigs.get(row.layer.rig_id or "") if row.layer else None
                bone = rig.bones.get(row.bone_uid) if rig else None
                if bone is not None:
                    menu.addAction("Key bone here", lambda: session.key_bone_pose(bone.uid))
                    menu.addAction("Delete bone keys here",
                                   lambda: self._delete_bone_keys(bone, frame))
                    menu.addAction("Select bone", lambda: self._select_bone(row))
        menu.addSeparator()
        menu.addAction("Zoom in timeline", lambda: self._zoom(1.3))
        menu.addAction("Zoom out timeline", lambda: self._zoom(1 / 1.3))
        menu.addAction("Fit timeline", self.fit_timeline)
        menu.exec(self.mapToGlobal(pos.toPoint()))

    def _layer_menu(self, pos: QPointF, layer: Layer) -> None:
        session = self.session
        menu = QMenu(self)
        menu.addAction("Rename…", lambda: self._rename_layer(layer))
        menu.addAction("Duplicate", lambda: session.duplicate_layer(layer.uid))
        menu.addAction("Delete", lambda: session.remove_layer(layer.uid))
        menu.addSeparator()
        menu.addAction("Add drawing layer", lambda: session.add_layer("raster"))
        menu.addAction("Add vector layer", lambda: session.add_layer("vector"))
        menu.addAction("Add group", lambda: session.add_layer("group"))
        menu.addSeparator()
        for key, label in (("normal", "Normal"), ("multiply", "Multiply"), ("screen", "Screen"),
                           ("overlay", "Overlay"), ("add", "Add")):
            act = menu.addAction(f"Blend: {label}",
                                 lambda k=key: session.set_layer_prop(layer.uid, "blend_mode", k,
                                                                     "Blend mode"))
            act.setCheckable(True)
            act.setChecked(layer.blend_mode == key)
        clip = menu.addAction("Clipping mask", lambda: session.set_layer_prop(
            layer.uid, "clipping", not layer.clipping, "Clipping"))
        clip.setCheckable(True)
        clip.setChecked(layer.clipping)
        alpha = menu.addAction("Alpha lock", lambda: session.set_layer_prop(
            layer.uid, "alpha_lock", not layer.alpha_lock, "Alpha lock"))
        alpha.setCheckable(True)
        alpha.setChecked(layer.alpha_lock)
        menu.addSeparator()
        if layer.parent_uid:
            menu.addAction("Un-parent", lambda: session.set_layer_parent(layer.uid, None))
        menu.addAction("Group all layers", session.group_selected)
        menu.exec(self.mapToGlobal(pos.toPoint()))

    def _cel_menu(self, pos: QPointF, layer: Layer, frame: int) -> None:
        session = self.session
        menu = QMenu(self)
        menu.addAction("Duplicate keyframe", lambda: session.duplicate_frame())
        menu.addAction("Add blank keyframe", lambda: session.add_frame())
        menu.addAction("Delete frame", lambda: session.delete_frame())
        menu.addAction("Insert frame", lambda: session.insert_frame(1))
        menu.addSeparator()
        if layer.kind in ("raster", "vector"):
            menu.addAction("Auto inbetween (4 frames)",
                           lambda: session.ai_inbetween(4))
            menu.addAction("Auto inbetween (8 frames)",
                           lambda: session.ai_inbetween(8))
            menu.addAction("Auto inbetween (12 frames)",
                           lambda: session.ai_inbetween(12))
        menu.exec(self.mapToGlobal(pos.toPoint()))

    def _rename_layer(self, layer: Layer) -> None:
        from PySide6.QtWidgets import QInputDialog, QLineEdit
        name, ok = QInputDialog.getText(self, "Rename layer", "Name:", QLineEdit.Normal, layer.name)
        if ok and name.strip():
            self.session.rename_layer(layer.uid, name.strip())

    def _toggle_audio(self, track, prop: str) -> None:
        old = getattr(track, prop)
        setattr(track, prop, not old)
        session = self.session
        session.command("Audio " + prop,
                        lambda: setattr(track, prop, old),
                        lambda: setattr(track, prop, not old))
        session.timeline_changed.emit()

    def _delete_audio(self, track) -> None:
        session = self.session
        scene = session.scene
        index = scene.audio_tracks.index(track)
        scene.audio_tracks.remove(track)
        session.command("Delete audio", lambda: scene.audio_tracks.insert(index, track),
                        lambda: scene.audio_tracks.remove(track))
        session.timeline_changed.emit()

    def _key_camera(self, cam, frame: int) -> None:
        for prop in ("pos_x", "pos_y", "zoom", "rotation"):
            track = getattr(cam, prop)
            track.set_key(frame, track.value_at(frame))
        self.session.timeline_changed.emit()
        self.session.status(f"Camera keyed at {frame}")

    def _add_marker(self, frame: int) -> None:
        from PySide6.QtWidgets import QInputDialog, QLineEdit
        from ..model.scene import Marker
        name, ok = QInputDialog.getText(self, "Add marker", "Name:", QLineEdit.Normal, "Marker")
        if not ok:
            return
        marker = Marker(int(frame), name or "Marker")
        scene = self.session.scene
        scene.markers.append(marker)
        self.session.command("Add marker", lambda: scene.markers.remove(marker),
                             lambda: scene.markers.append(marker))
        self.refresh()

    def _clear_markers(self) -> None:
        scene = self.session.scene
        old = list(scene.markers)
        scene.markers.clear()
        self.session.command("Clear markers", lambda: scene.markers.extend(old),
                             lambda: scene.markers.clear())
        self.refresh()

    def _add_shot(self, frame: int) -> None:
        from ..model.camera import Shot
        scene = self.session.scene
        shot = Shot(f"Shot {len(scene.shots) + 1}", int(frame), int(frame) + 48,
                    scene.camera().uid)
        scene.shots.append(shot)
        self.session.command("Add shot", lambda: scene.shots.remove(shot),
                             lambda: scene.shots.append(shot))
        self.refresh()

    def _delete_bone_keys(self, bone, frame: int) -> None:
        snapshots = {p: getattr(bone, p).to_dict()
                     for p in ("rotation", "offset_x", "offset_y", "scale")}
        for prop in snapshots:
            getattr(bone, prop).remove_key(frame)
        after = {p: getattr(bone, p).to_dict()
                 for p in ("rotation", "offset_x", "offset_y", "scale")}

        def do(state):
            for prop, snap in state.items():
                track = getattr(bone, prop)
                setattr(bone, prop, track.__class__.from_dict(snap))
            self.session.timeline_changed.emit()
            self.session.canvas_changed.emit()

        self.session.command("Delete bone keys", lambda: do(snapshots), lambda: do(after))

    def _select_bone(self, row: Row) -> None:
        self.session.selected_bones = [row.bone_uid]
        self.session.active_layer_uid = row.layer.uid
        self.session.selection_changed.emit()
        self.session.rig_changed.emit()

    def _zoom(self, factor: float) -> None:
        self.pixels_per_frame = max(MIN_PPF, min(MAX_PPF, self.pixels_per_frame * factor))
        self.update()

    def fit_timeline(self) -> None:
        scene = self.session.scene
        span = max(1, scene.frame_end - scene.frame_start + 1)
        self.pixels_per_frame = max(MIN_PPF, min(MAX_PPF,
                                                 (self.width() - HEADER_W - 20) / span))
        self.scroll_x = 0.0
        self.update()

    def keyPressEvent(self, event) -> None:
        session = self.session
        key = event.key()
        mods = event.modifiers()
        if key in (Qt.Key_Left, Qt.Key_Right):
            delta = -1 if key == Qt.Key_Left else 1
            if mods & Qt.ShiftModifier:
                session.next_key(delta)
            else:
                session.step_frame(delta)
            self._ensure_visible(session.frame)
        elif key in (Qt.Key_Home,):
            session.set_frame(session.scene.frame_start)
        elif key in (Qt.Key_End,):
            session.set_frame(session.scene.frame_end)
        elif key in (Qt.Key_Delete, Qt.Key_Backspace):
            session.delete_frame()
        elif key == Qt.Key_F:
            session.add_frame()
        elif key == Qt.Key_D:
            session.duplicate_frame()
        else:
            super().keyPressEvent(event)
            return
        self.update()

    def _ensure_visible(self, frame: int) -> None:
        x = self.x_for_frame(frame)
        if x < HEADER_W + 20:
            self.scroll_x = max(0.0, (frame - self.session.scene.frame_start) *
                                self.pixels_per_frame - 40)
        elif x > self.width() - 20:
            self.scroll_x = max(0.0, (frame - self.session.scene.frame_start) *
                                self.pixels_per_frame - (self.width() - HEADER_W) + 60)
        self.update()
