"""The animation canvas: drawing, onion skin, rig manipulation, transform
handles, zoom/pan and tablet support.

The canvas is a QWidget that paints the scene through the same renderer used
for export, so what you see is exactly what you get.
"""
from __future__ import annotations

import math

from PySide6.QtCore import QEvent, QPoint, QPointF, QRect, QRectF, QSize, Qt, Signal
from PySide6.QtGui import (QBrush, QColor, QCursor, QFont, QImage, QPainter, QPainterPath, QPen,
                           QPixmap, QPolygonF, QTransform)
from PySide6.QtWidgets import QInputDialog, QLineEdit, QWidget

from ..engine import render as R
from ..engine import tools as T
from ..engine.brushes import Stabilizer
from ..engine.render import (RenderOptions, camera_transform, layer_transform, onion_image,
                             paint_rig, paint_rig_overlay, render_scene, scene_to_output)
from ..model.cel import BitmapCel, TextCel, VectorCel
from ..model.easing import clamp
from ..model.layer import Layer
from ..model.rig import Bone
from .theme import C

MIN_ZOOM = 0.05
MAX_ZOOM = 16.0

HANDLE_SIZE = 7
ROTATE_OFFSET = 26


class CanvasView(QWidget):
    """Interactive canvas bound to an :class:`EditorSession`."""

    zoom_changed = Signal(float)
    cursor_moved = Signal(float, float)
    stroke_finished = Signal()

    def __init__(self, session, parent=None):
        super().__init__(parent)
        self.session = session
        self.setMouseTracking(True)
        self.setFocusPolicy(Qt.StrongFocus)
        self.setAttribute(Qt.WA_AcceptTouchEvents, True)
        self.setCursor(Qt.CrossCursor)

        self.zoom = 0.42
        self.pan = QPointF(0, 0)
        self._fit_done = False
        self._scene_image: QImage | None = None
        self._scene_dirty = True
        self._onion_cache: dict = {}
        self._tool: T.Tool | None = None
        self._space_pan = False
        self._panning = False
        self._pan_start = QPointF()
        self._last_mouse = QPointF()
        self._drag_mode: str | None = None
        self._drag_data: dict = {}
        self._hover_bone: str | None = None
        self._creating_bone: tuple[float, float] | None = None
        self._bone_preview: tuple[float, float] | None = None
        self._select_start: QPointF | None = None
        self._selecting = False
        self._pressure = 1.0
        self._pressure_device = False
        self.last_color_picked = None

        s = session
        s.canvas_changed.connect(self.invalidate)
        s.scene_changed.connect(self.invalidate_all)
        s.layer_selected.connect(lambda *_: self.invalidate())
        s.rig_changed.connect(lambda: self.invalidate())
        s.brush_changed.connect(lambda: self.invalidate())
        s.tool_changed.connect(self._on_tool_changed)
        s.project_changed.connect(self.invalidate_all)
        self.setContextMenuPolicy(Qt.DefaultContextMenu)

    # =====================================================================
    # state helpers
    # =====================================================================
    def invalidate(self) -> None:
        self._scene_dirty = True
        self.update()

    def invalidate_all(self) -> None:
        self._scene_dirty = True
        self._onion_cache.clear()
        self._fit_done = False
        self.fit_to_window()
        self.update()

    @property
    def scene(self):
        return self.session.scene

    def out_size(self) -> tuple[int, int]:
        """Render buffer size (scene pixels x quality scale)."""
        scene = self.scene
        return (max(16, scene.width), max(16, scene.height))

    # =====================================================================
    # view transform
    # =====================================================================
    def fit_to_window(self) -> None:
        scene = self.scene
        if self.width() < 10 or self.height() < 10:
            return
        margin = 32
        sx = (self.width() - margin) / max(1, scene.width)
        sy = (self.height() - margin) / max(1, scene.height)
        self.zoom = max(MIN_ZOOM, min(MAX_ZOOM, min(sx, sy)))
        self.pan = QPointF((self.width() - scene.width * self.zoom) / 2.0,
                           (self.height() - scene.height * self.zoom) / 2.0)
        self._fit_done = True
        self.zoom_changed.emit(self.zoom)
        self.update()

    def reset_zoom(self) -> None:
        self.zoom = 1.0
        self.pan = QPointF((self.width() - self.scene.width) / 2.0,
                           (self.height() - self.scene.height) / 2.0)
        self.zoom_changed.emit(self.zoom)
        self.update()

    def set_zoom(self, zoom: float, center: QPointF | None = None) -> None:
        zoom = clamp(zoom, MIN_ZOOM, MAX_ZOOM)
        center = center or QPointF(self.width() / 2.0, self.height() / 2.0)
        before = self.to_scene(center)
        self.zoom = zoom
        after = self.to_scene(center)
        self.pan += (after - before) * zoom
        self.zoom_changed.emit(self.zoom)
        self.update()

    def zoom_in(self) -> None:
        self.set_zoom(self.zoom * 1.25)

    def zoom_out(self) -> None:
        self.set_zoom(self.zoom / 1.25)

    def view_transform(self) -> QTransform:
        return QTransform().translate(self.pan.x(), self.pan.y()).scale(self.zoom, self.zoom)

    def to_scene(self, pos: QPointF) -> QPointF:
        inv, ok = self.view_transform().inverted()
        return inv.map(pos) if ok else pos

    def to_widget(self, pos) -> QPointF:
        return self.view_transform().map(QPointF(pos[0], pos[1]))

    def _render_transform(self) -> QTransform:
        """Scene -> render buffer transform (camera or plain)."""
        scene = self.scene
        out = self.out_size()
        if self.session.camera_view:
            return camera_transform(scene, self.session.current_frame, out)
        return scene_to_output(scene, self.session.current_frame, out)

    def scene_to_widget(self) -> QTransform:
        """Full transform for scene coordinates -> widget coordinates."""
        scene = self.scene
        out = self.out_size()
        sx = self.width() and 1.0 or 1.0
        # the render buffer maps scene units 1:1 (out size == scene size)
        base = QTransform().translate(self.pan.x(), self.pan.y()).scale(self.zoom, self.zoom)
        _ = (sx, out)
        return base

    # =====================================================================
    # painting
    # =====================================================================
    def paintEvent(self, event) -> None:
        p = QPainter(self)
        p.setRenderHint(QPainter.Antialiasing, True)
        p.setRenderHint(QPainter.SmoothPixmapTransform, True)
        p.fillRect(self.rect(), QColor(C.canvas_bg))
        scene = self.scene
        out = self.out_size()

        # paper + shadow
        tv = self.scene_to_widget()
        paper = tv.mapRect(QRectF(0, 0, scene.width, scene.height))
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(0, 0, 0, 110))
        p.drawRoundedRect(paper.adjusted(4, 6, 4, 6), 3, 3)
        if self.session.project.settings.get("canvas", {}).get("checker", True) and self.session.camera_view:
            p.setBrush(QBrush(self._checker_brush()))
        else:
            p.setBrush(QColor(scene.background_color))
        p.drawRect(paper)

        # scene render
        img = self._scene_image_cached()
        if img is not None and not img.isNull():
            p.setTransform(tv, True)
            p.drawImage(0, 0, img)
            p.setTransform(QTransform())

        # onion skin (behind the current drawing)
        self._paint_onion(p, tv)

        # grid / guides
        if self.session.project.settings.get("grid", {}).get("visible"):
            self._paint_grid(p, tv)

        # rig, gizmos, handles
        p.setTransform(tv, True)
        self._paint_overlays(p)
        p.setTransform(QTransform())

        # selection marquee (screen space)
        if self._selecting and self._select_start is not None:
            rect = QRectF(self._select_start, self._last_mouse).normalized()
            pen = QPen(QColor(C.accent), 1, Qt.DashLine)
            p.setPen(pen)
            p.setBrush(QColor(79, 140, 255, 40))
            p.drawRect(rect)

        # HUD info
        self._paint_hud(p)
        p.end()

    def _checker_brush(self) -> QPixmap:
        if getattr(self, "_checker_pm", None) is None:
            size = 16
            pm = QPixmap(size * 2, size * 2)
            pm.fill(QColor("#2a2d38"))
            cp = QPainter(pm)
            cp.fillRect(0, 0, size, size, QColor("#232630"))
            cp.fillRect(size, size, size, size, QColor("#232630"))
            cp.end()
            self._checker_pm = pm
        return self._checker_pm

    def _scene_image_cached(self) -> QImage | None:
        if not self._scene_dirty and self._scene_image is not None:
            return self._scene_image
        session = self.session
        quality = session.preview_quality
        out = self.out_size()
        opts = RenderOptions(frame=session.current_frame, size=out,
                             background=not session.camera_view,
                             camera=session.camera_view, quality=quality)
        if session.camera_view:
            opts.background = True
        img = render_scene(session.scene, session.project, opts,
                           with_camera=session.camera_view)
        if not session.camera_view:
            # editing view: layers drawn on the paper, background from the scene colour
            pass
        self._scene_image = img
        self._scene_dirty = False
        return img

    def _paint_onion(self, p: QPainter, tv: QTransform) -> None:
        session = self.session
        onion = session.project.settings.get("onion", {})
        if not onion.get("enabled", True) or session.playing:
            return
        if session.camera_view:
            return
        layer = session.active_layer()
        if layer is None or layer.kind == "rig" or layer.kind == "group":
            return
        frame = session.frame
        opacity = max(0.05, min(1.0, onion.get("opacity", 45) / 100.0))
        prev_color = QColor(onion.get("prev_color", C.onion_prev))
        next_color = QColor(onion.get("next_color", C.onion_next))
        prev_n = int(onion.get("prev_frames", 2)) if onion.get("show_prev", True) else 0
        next_n = int(onion.get("next_frames", 1)) if onion.get("show_next", True) else 0
        out = self.out_size()
        p.setTransform(tv, True)
        for delta in range(-prev_n, next_n + 1):
            if delta == 0:
                continue
            key = (layer.uid, frame, delta, onion.get("opacity"), onion.get("tint", True))
            img = self._onion_cache.get(key)
            if img is None:
                step = max(1, abs(delta))
                strength = opacity / (1.0 + 0.75 * (step - 1)) if onion.get("alpha_falloff", True) \
                    else opacity
                img = onion_image(session.scene, session.project, layer, frame, delta,
                                  prev_color if delta < 0 else next_color, strength,
                                  size=out, camera=session.camera_view)
                if len(self._onion_cache) > 24:
                    self._onion_cache.clear()
                self._onion_cache[key] = img
            if img is not None:
                p.drawImage(0, 0, img)
        p.setTransform(QTransform())

    def clear_onion_cache(self) -> None:
        self._onion_cache.clear()

    def _paint_grid(self, p: QPainter, tv: QTransform) -> None:
        grid = self.session.project.settings.get("grid", {})
        spacing = max(8, int(grid.get("spacing", 80)))
        sub = max(1, int(grid.get("subdivisions", 4)))
        color = QColor(grid.get("color", C.border))
        scene = self.scene
        p.setTransform(tv, True)
        pen = QPen(color, 1.0 / max(0.15, self.zoom), Qt.SolidLine)
        pen.setCosmetic(False)
        p.setPen(pen)
        step = spacing / sub
        x = 0.0
        while x <= scene.width:
            strong = abs((x / spacing) - round(x / spacing)) < 1e-6
            pen.setColor(QColor(color.red(), color.green(), color.blue(), 90 if strong else 40))
            pen.setWidthF((1.4 if strong else 0.8) / max(0.15, self.zoom))
            p.setPen(pen)
            p.drawLine(QPointF(x, 0), QPointF(x, scene.height))
            x += step
        y = 0.0
        while y <= scene.height:
            strong = abs((y / spacing) - round(y / spacing)) < 1e-6
            pen.setColor(QColor(color.red(), color.green(), color.blue(), 90 if strong else 40))
            pen.setWidthF((1.4 if strong else 0.8) / max(0.15, self.zoom))
            p.setPen(pen)
            p.drawLine(QPointF(0, y), QPointF(scene.width, y))
            y += step
        p.setTransform(QTransform())

    def _paint_overlays(self, p: QPainter) -> None:
        session = self.session
        scene = session.scene
        scale = max(0.05, self.zoom)

        # camera frame in edit view
        if not session.camera_view:
            cam = scene.camera()
            v = cam.value_at(session.current_frame)
            z = max(0.05, v["zoom"] / 100.0)
            w = scene.width / z
            h = scene.height / z
            rect = QRectF(v["x"] - w / 2, v["y"] - h / 2, w, h)
            pen = QPen(QColor(C.warn), 1.4 / scale, Qt.DashLine)
            p.setPen(pen)
            p.setBrush(Qt.NoBrush)
            p.save()
            p.translate(v["x"], v["y"])
            p.rotate(v["rotation"])
            p.drawRect(QRectF(-w / 2, -h / 2, w, h))
            p.restore()

        # rigs
        if session.show_rig:
            for layer in scene.layers:
                if layer.kind != "rig" or not layer.visible:
                    continue
                rig = scene.rigs.get(layer.rig_id or "")
                if rig is None:
                    continue
                tr = layer_transform(layer, session.current_frame)
                selected = layer.uid == session.active_layer_uid
                if rig.visible:
                    p.save()
                    p.setTransform(tr, True)
                    paint_rig(p, rig, session.project, session.current_frame)
                    p.restore()
                if session.show_gizmos and (selected or layer.uid == session.active_layer_uid):
                    p.save()
                    p.setTransform(tr, True)
                    worlds = rig.solve(session.current_frame)
                    paint_rig_overlay(p, rig, worlds, session.current_frame,
                                      session.selected_bones[0] if session.selected_bones else None,
                                      scale=scale, show_labels=scale > 0.5,
                                      hovered=self._hover_bone)
                    p.restore()

        # transform gizmo for the active layer
        if session.tool == "transform" and session.active_layer() is not None:
            self._paint_transform_gizmo(p, scale)

        # bone creation preview
        if self._creating_bone is not None and self._bone_preview is not None:
            p.setPen(QPen(QColor(C.bone), 2.0 / scale, Qt.DashLine))
            p.drawLine(QPointF(*self._creating_bone), QPointF(*self._bone_preview))

    def _bounds_of(self, layer: Layer) -> QRectF | None:
        session = self.session
        if layer is None:
            return None
        if layer.kind == "rig":
            rig = session.scene.rigs.get(layer.rig_id or "")
            if rig is None:
                return None
            worlds = rig.solve(session.current_frame)
            xs, ys = [], []
            for w in worlds.values():
                xs += [w.head[0], w.tail[0]]
                ys += [w.head[1], w.tail[1]]
            if not xs:
                return None
            pad = 6
            return QRectF(min(xs) - pad, min(ys) - pad, max(xs) - min(xs) + 2 * pad,
                          max(ys) - min(ys) + 2 * pad)
        hit = layer.cel_at(session.frame)
        if hit is None:
            return None
        cel = hit[1].cel
        if isinstance(cel, BitmapCel):
            b = cel.content_bounds()
            return QRectF(b) if b is not None else None
        if isinstance(cel, TextCel):
            from ..engine.vector import text_bounds
            return text_bounds(cel)
        if isinstance(cel, VectorCel):
            b = cel.content_bounds()
            return QRectF(b) if b is not None else None
        from ..model.cel import ImageCel
        if isinstance(cel, ImageCel):
            img = R.load_asset_image(session.project, cel.asset_id)
            if img is None:
                return QRectF(0, 0, 200, 200)
            return QRectF(0, 0, img.width(), img.height())
        return None

    def _layer_transform(self, layer: Layer) -> QTransform:
        return layer_transform(layer, self.session.current_frame)

    def _paint_transform_gizmo(self, p: QPainter, scale: float) -> None:
        layer = self.session.active_layer()
        bounds = self._bounds_of(layer)
        if bounds is None:
            return
        tr = self._layer_transform(layer)
        p.setTransform(tr, True)
        pen = QPen(QColor(C.accent), 1.4 / scale)
        p.setPen(pen)
        p.setBrush(Qt.NoBrush)
        p.drawRect(bounds)
        p.setBrush(QBrush(QColor(C.accent)))
        hs = HANDLE_SIZE / (scale * max(0.2, self._view_scale_of(layer)))
        for pt in self._handle_points(bounds):
            p.drawRect(QRectF(pt[0] - hs / 2, pt[1] - hs / 2, hs, hs))
        # rotation handle
        top = QPointF(bounds.center().x(), bounds.top() - ROTATE_OFFSET / (scale * 1.4))
        p.setPen(QPen(QColor(C.warn), 1.4 / scale))
        p.drawLine(QPointF(bounds.center().x(), bounds.top()), top)
        p.setBrush(QBrush(QColor(C.warn)))
        r = hs * 0.9
        p.drawEllipse(top, r, r)

    def _view_scale_of(self, layer: Layer) -> float:
        """Approximate on-screen scale of a layer (for handle sizing)."""
        t = layer.transform.value_at(self.session.current_frame)
        return max(0.15, self.zoom * max(0.05, abs(t.scale_x) / 100.0))

    @staticmethod
    def _handle_points(bounds: QRectF) -> list[tuple[float, float]]:
        x0, y0, x1, y1 = bounds.left(), bounds.top(), bounds.right(), bounds.bottom()
        cx, cy = bounds.center().x(), bounds.center().y()
        return [(x0, y0), (cx, y0), (x1, y0), (x1, cy), (x1, y1), (cx, y1), (x0, y1), (x0, cy),
                (cx, cy)]

    def _paint_hud(self, p: QPainter) -> None:
        session = self.session
        p.setPen(QPen(QColor(C.text_dim)))
        f = p.font()
        f.setPointSizeF(9.0)
        p.setFont(f)
        parts = [f"{int(round(self.zoom * 100))}%"]
        if session.tool == "bone" and session.selected_bones:
            rig = session.active_rig()
            bone = rig.bones.get(session.selected_bones[0]) if rig else None
            if bone:
                parts.append(f"Bone: {bone.name}")
        if self._pressure < 0.999 and session.tool in ("brush", "pencil", "ink", "eraser"):
            parts.append(f"Pressure {int(self._pressure * 100)}%")
        text = "   ".join(parts)
        rect = p.fontMetrics().boundingRect(text).adjusted(-6, -3, 6, 3)
        rect.moveBottomLeft(QPoint(10, self.height() - 8))
        p.setPen(Qt.NoPen)
        p.setBrush(QColor(0, 0, 0, 130))
        p.drawRoundedRect(rect, 4, 4)
        p.setPen(QPen(QColor(C.text_dim)))
        p.drawText(rect, Qt.AlignCenter, text)

    # =====================================================================
    # tools
    # =====================================================================
    def _on_tool_changed(self, tool: str) -> None:
        cursors = {
            "hand": Qt.OpenHandCursor, "zoom": Qt.CrossCursor, "bone": Qt.CrossCursor,
            "select": Qt.ArrowCursor, "transform": Qt.SizeAllCursor, "text": Qt.IBeamCursor,
            "eyedropper": Qt.CrossCursor,
        }
        self.setCursor(cursors.get(tool, Qt.CrossCursor))
        self.update()

    def _make_tool_context(self) -> T.ToolContext | None:
        session = self.session
        layer = session.active_layer()
        if layer is None or layer.locked:
            return None
        cel = session.current_cel(create=True)
        if cel is None:
            # drawing on a hold frame is allowed, but only on its own cel
            hit = layer.cel_at(session.frame)
            cel = hit[1].cel if hit else None
        if cel is None:
            return None
        ctx = T.ToolContext(
            project=session.project, scene=session.scene, layer=layer, cel=cel,
            frame=session.frame, brush=session.brush,
            primary_color=QColor(session.primary_color),
            secondary_color=QColor(session.secondary_color),
            fill_tolerance=int(session.project.settings.get("drawing", {}).get("fill_tolerance", 32)),
            fill_gap_close=int(session.project.settings.get("drawing", {}).get("gap_close", 2)),
            shape_kind=session.project.settings.get("drawing", {}).get("shape_kind", "line"),
            shape_filled=bool(session.project.settings.get("drawing", {}).get("shape_filled", False)),
            stabilizer=Stabilizer(session.project.settings.get("drawing", {}).get("smoothing", 0.35),
                                  session.project.settings.get("drawing", {}).get("stabilize", 0.25)),
            sample_all_layers=bool(session.project.settings.get("drawing", {})
                                   .get("sample_all_layers", False)),
        )
        return ctx

    def _tool_for(self, name: str) -> T.Tool | None:
        ctx = self._make_tool_context()
        if ctx is None:
            self.session.status("No drawable layer selected (is it locked?)")
            return None
        shape = self.session.project.settings.get("drawing", {}).get("shape_kind", "line")
        return T.make_tool(name, ctx, kind=shape,
                           text=self.session.project.settings.get("drawing", {}).get("text", "Text"),
                           size=int(self.session.project.settings.get("drawing", {})
                                    .get("text_size", 96)))

    # =====================================================================
    # mouse / tablet events
    # =====================================================================
    def mousePressEvent(self, event) -> None:
        self.setFocus()
        pos = QPointF(event.position())
        self._last_mouse = pos
        scene_pos = self.to_scene(pos)
        self._pressure = 1.0
        session = self.session
        if event.button() == Qt.MiddleButton or (self._space_pan and event.button() == Qt.LeftButton):
            self._panning = True
            self._pan_start = pos - self.pan
            self.setCursor(Qt.ClosedHandCursor)
            return
        if event.button() == Qt.RightButton:
            self._show_context_menu(event)
            return
        if event.button() != Qt.LeftButton:
            return

        tool = session.tool
        mods = event.modifiers()

        if tool == "hand":
            self._panning = True
            self._pan_start = pos - self.pan
            self.setCursor(Qt.ClosedHandCursor)
            return
        if tool == "zoom":
            self.set_zoom(self.zoom * (0.8 if mods & Qt.AltModifier else 1.25), pos)
            return
        if tool == "select":
            self._selecting = True
            self._select_start = pos
            return
        if tool == "transform":
            self._begin_transform(scene_pos, mods)
            return
        if tool == "bone":
            self._begin_bone(scene_pos, mods)
            return
        if tool == "eyedropper":
            self._pick_color(scene_pos)
            return
        if tool == "text":
            self._place_text(scene_pos)
            return
        if tool in ("fill", "brush", "pencil", "ink", "marker", "soft", "airbrush", "charcoal",
                    "eraser", "shape"):
            self._tool = self._tool_for(tool)
            if self._tool is None:
                return
            self._tool.begin((scene_pos.x(), scene_pos.y()), self._pressure, mods)
            self.clear_onion_cache()
            self.invalidate()
            return

    def mouseMoveEvent(self, event) -> None:
        pos = QPointF(event.position())
        scene_pos = self.to_scene(pos)
        self.cursor_moved.emit(scene_pos.x(), scene_pos.y())

        if self._panning:
            self.pan = pos - self._pan_start
            self.update()
            self._last_mouse = pos
            return

        buttons = event.buttons()
        if self._drag_mode == "ik" and (buttons & Qt.LeftButton):
            self._update_ik(scene_pos)
            return
        if self._drag_mode == "bone" and (buttons & Qt.LeftButton):
            self._update_bone_drag(scene_pos)
            return
        if self._drag_mode == "transform" and (buttons & Qt.LeftButton):
            self._update_transform(scene_pos, event.modifiers())
            return
        if self._selecting:
            self.update()
            return
        if self._creating_bone is not None and (buttons & Qt.LeftButton):
            self._bone_preview = (scene_pos.x(), scene_pos.y())
            self.update()
            return
        if self._tool is not None and self._tool.active and (buttons & Qt.LeftButton):
            # mouse pressure substitute: fast strokes taper like a real pen
            delta = (pos - self._last_mouse).manhattanLength()
            if not self._pressure_device:
                self._pressure = max(0.35, min(1.0, 1.0 - delta / 48.0))
            self._tool.move((scene_pos.x(), scene_pos.y()), self._pressure)
            self.invalidate()
            self._last_mouse = pos
            return
        if not (buttons & Qt.MouseButton.LeftButton) and self.session.tool == "bone":
            self._update_hover(scene_pos)
        self._last_mouse = pos

    def mouseReleaseEvent(self, event) -> None:
        pos = QPointF(event.position())
        scene_pos = self.to_scene(pos)
        if self._panning:
            self._panning = False
            self._on_tool_changed(self.session.tool)
            return
        if self._selecting:
            self._selecting = False
            if self._select_start is not None:
                self._finish_select(QRectF(self._select_start, pos).normalized())
            self._select_start = None
            self.update()
            return
        if self._drag_mode in ("ik", "bone"):
            self._drag_mode = None
            self._drag_data = {}
            self.session.history.end_macro()
            self.session.rig_changed.emit()
            self.session.timeline_changed.emit()
            self.session.canvas_changed.emit()
            return
        if self._drag_mode == "transform":
            self._end_transform()
            return
        if self._creating_bone is not None:
            self._finish_bone(scene_pos)
            return
        if self._tool is not None and self._tool.active:
            edits = self._tool.end((scene_pos.x(), scene_pos.y()), self._pressure)
            self._tool = None
            self._pressure_device = False
            if edits:
                self._push_edits(edits)
            self.invalidate()
            self.stroke_finished.emit()


    def _push_edits(self, edits) -> None:
        self.session.apply_edits(edits)

    def tabletEvent(self, event) -> None:
        """Drawing tablet support (pressure, eraser tip, tilt)."""
        session = self.session
        if not session.project.settings.get("drawing", {}).get("pressure", True):
            event.setAccepted(False)
            return
        pos = QPointF(event.position())
        scene_pos = self.to_scene(pos)
        pressure = max(0.02, float(event.pressure()))
        self._pressure = pressure
        etype = event.type()
        if etype == QEvent.TabletPress:
            if self._tool is None:
                tool_name = "eraser" if _is_eraser(event) else session.tool
                self._tool = self._tool_for(tool_name)
            if self._tool is not None:
                self._tool.begin((scene_pos.x(), scene_pos.y()), pressure, event.modifiers())
            event.accept()
        elif etype == QEvent.TabletMove:
            if self._tool is not None and self._tool.active:
                self._tool.move((scene_pos.x(), scene_pos.y()), pressure)
                self.invalidate()
            event.accept()
        elif etype == QEvent.TabletRelease:
            if self._tool is not None and self._tool.active:
                edits = self._tool.end((scene_pos.x(), scene_pos.y()), pressure)
                self._tool = None
                self._pressure_device = False
                if edits:
                    self._push_edits(edits)
                self.stroke_finished.emit()
            event.accept()
        else:
            event.setAccepted(False)

    def wheelEvent(self, event) -> None:
        delta = event.angleDelta().y()
        if event.modifiers() & Qt.ControlModifier or True:
            factor = 1.15 if delta > 0 else 1 / 1.15
            self.set_zoom(self.zoom * factor, QPointF(event.position()))
        self._pressure = 1.0
        event.accept()

    def keyPressEvent(self, event) -> None:
        if event.key() == Qt.Key_Space:
            self._space_pan = True
            self.setCursor(Qt.OpenHandCursor)
        super().keyPressEvent(event)

    def keyReleaseEvent(self, event) -> None:
        if event.key() == Qt.Key_Space:
            self._space_pan = False
            self._on_tool_changed(self.session.tool)
        super().keyReleaseEvent(event)

    def enterEvent(self, event) -> None:
        self.setFocus()

    def resizeEvent(self, event) -> None:
        if not self._fit_done:
            self.fit_to_window()

    def mouseDoubleClickEvent(self, event) -> None:
        pos = self.to_scene(QPointF(event.position()))
        layer = self.session.active_layer()
        if layer is None:
            return
        hit = layer.cel_at(self.session.frame)
        if hit is not None and isinstance(hit[1].cel, TextCel):
            self._edit_text_cel(hit[1].cel)
            return
        if self.session.tool == "bone":
            bone = self._bone_at(pos)
            if bone is not None:
                self.session.status(f"Bone '{bone.name}'")
                self._rename_bone(bone)

    # =====================================================================
    # transform tool
    # =====================================================================
    def _begin_transform(self, scene_pos: QPointF, mods) -> None:
        layer = self.session.active_layer()
        if layer is None:
            return
        bounds = self._bounds_of(layer)
        if bounds is None:
            self.session.status("Nothing to transform on this layer/frame")
            return
        tr = self._layer_transform(layer)
        inv, ok = tr.inverted()
        local = inv.map(scene_pos) if ok else scene_pos
        handle = self._handle_at(local, bounds)
        self._drag_mode = "transform"
        self._drag_data = {
            "handle": handle, "start": local, "bounds": bounds,
            "transform": layer.transform.value_at(self.session.current_frame),
            "layer": layer, "index": None,
        }
        self.session.history.begin_macro("Transform")
        _ = mods

    def _handle_at(self, pos: QPointF, bounds: QRectF) -> int:
        tol = HANDLE_SIZE / max(0.2, self.zoom)
        for i, (x, y) in enumerate(self._handle_points(bounds)):
            if abs(pos.x() - x) <= tol and abs(pos.y() - y) <= tol:
                return i
        top = QPointF(bounds.center().x(), bounds.top() - ROTATE_OFFSET / max(0.3, self.zoom))
        if (pos - top).manhattanLength() < tol * 2.5:
            return 9
        return -1 if bounds.contains(pos) else -2

    def _update_transform(self, scene_pos: QPointF, mods) -> None:
        data = self._drag_data
        layer = data.get("layer")
        if layer is None:
            return
        bounds = data["bounds"]
        tr = self._layer_transform(layer)
        inv, ok = tr.inverted()
        local = inv.map(scene_pos) if ok else scene_pos
        start = data["start"]
        handle = data["handle"]
        base = data["transform"]
        session = self.session
        dx = local.x() - start.x()
        dy = local.y() - start.y()
        if mods & Qt.ShiftModifier and handle != 9:
            if abs(dx) > abs(dy):
                dy = 0.0
            else:
                dx = 0.0

        if handle == 9:      # rotate
            cx, cy = bounds.center().x(), bounds.center().y()
            a0 = math.degrees(math.atan2(start.y() - cy, start.x() - cx))
            a1 = math.degrees(math.atan2(local.y() - cy, local.x() - cx))
            delta = a1 - a0
            if mods & Qt.ShiftModifier:
                delta = round(delta / 15.0) * 15.0
            session.set_transform_prop(layer, "rotation", base.rotation + delta, merge=True,
                                       force_key=True)
        elif handle in (0, 2, 4, 6, 8) or handle == -1:
            cx = cy = 0.0
            if handle == 8 or handle == -1:      # move
                session.set_transform_prop(layer, "pos.x", base.x + dx, merge=True, force_key=True)
                session.set_transform_prop(layer, "pos.y", base.y + dy, merge=True, force_key=True)
            else:
                sx = base.scale_x
                sy = base.scale_y
                if handle in (0, 6):
                    sx = base.scale_x - dx * 100.0 / max(1.0, bounds.width())
                if handle in (2, 4):
                    sx = base.scale_x + dx * 100.0 / max(1.0, bounds.width())
                if handle in (0, 2):
                    sy = base.scale_y - dy * 100.0 / max(1.0, bounds.height())
                if handle in (4, 6):
                    sy = base.scale_y + dy * 100.0 / max(1.0, bounds.height())
                if mods & Qt.ShiftModifier:
                    s = (sx + sy) / 2.0
                    sx = sy = s
                session.set_transform_prop(layer, "scale.x", clamp(sx, 1.0, 2000.0), merge=True,
                                           force_key=True)
                session.set_transform_prop(layer, "scale.y", clamp(sy, 1.0, 2000.0), merge=True,
                                           force_key=True)
            _ = (cx, cy)
        elif handle in (1, 3, 5, 7):
            sx = base.scale_x
            sy = base.scale_y
            if handle == 1:
                sy = base.scale_y - dy * 100.0 / max(1.0, bounds.height())
            elif handle == 5:
                sy = base.scale_y + dy * 100.0 / max(1.0, bounds.height())
            elif handle == 3:
                sx = base.scale_x + dx * 100.0 / max(1.0, bounds.width())
            elif handle == 7:
                sx = base.scale_x - dx * 100.0 / max(1.0, bounds.width())
            session.set_transform_prop(layer, "scale.x", clamp(sx, 1.0, 2000.0), merge=True,
                                       force_key=True)
            session.set_transform_prop(layer, "scale.y", clamp(sy, 1.0, 2000.0), merge=True,
                                       force_key=True)
        elif handle == -2:
            pass

    def _end_transform(self) -> None:
        self._drag_mode = None
        self._drag_data = {}
        self.session.history.end_macro()
        self.session.canvas_changed.emit()
        self.session.timeline_changed.emit()

    # =====================================================================
    # bone tool
    # =====================================================================
    def _bone_at(self, scene_pos: QPointF) -> Bone | None:
        rig = self.session.active_rig()
        if rig is None:
            return None
        layer = self.session.rig_layer_for(self._rig_of_layer())
        tr = QTransform()
        lay = self.session.active_layer()
        if lay is not None and lay.kind == "rig":
            tr = self._layer_transform(lay)
        inv, ok = tr.inverted()
        local = inv.map(scene_pos) if ok else scene_pos
        worlds = rig.solve(self.session.current_frame)
        return rig.bone_at_point((local.x(), local.y()), worlds, tolerance=10.0 / max(0.2, self.zoom))

    def _rig_of_layer(self):
        lay = self.session.active_layer()
        if lay is None or lay.kind != "rig":
            return None
        return lay

    def _update_hover(self, scene_pos: QPointF) -> None:
        bone = self._bone_at(scene_pos)
        uid = bone.uid if bone else None
        if uid != self._hover_bone:
            self._hover_bone = uid
            self.update()

    def _begin_bone(self, scene_pos: QPointF, mods) -> None:
        session = self.session
        rig = session.active_rig()
        if rig is None:
            session.status("Select a character (rig) layer first, or add a character from the "
                           "Character menu")
            return
        lay = session.active_layer()
        tr = self._layer_transform(lay) if lay is not None else QTransform()
        inv, ok = tr.inverted()
        local = inv.map(scene_pos) if ok else scene_pos
        worlds = rig.solve(session.current_frame)

        # 1. grab an IK target (the drawn handle, or the effector tip in IK mode)
        tolerance = 14.0 / max(0.2, self.zoom)
        for chain in rig.ik_chains:
            if not chain.enabled and not session.ik_mode:
                continue
            has_target = bool(chain.target_x.keys and chain.target_y.keys)
            if has_target:
                tx = chain.target_x.value_at(session.current_frame)
                ty = chain.target_y.value_at(session.current_frame)
            elif chain.rest_target:
                tx, ty = chain.rest_target
            else:
                continue
            grip = (QPointF(local) - QPointF(tx, ty)).manhattanLength() < tolerance
            if not grip and session.ik_mode:
                effector = rig.bones.get(chain.bones[-1]) if chain.bones else None
                world = worlds.get(effector.uid) if effector is not None else None
                if world is not None:
                    tip = QPointF(world.tail[0], world.tail[1])
                    grip = (QPointF(local) - tip).manhattanLength() < tolerance
                    if grip:
                        # start the chain exactly where the limb currently is
                        chain.target_x.set_key(session.current_frame, world.tail[0])
                        chain.target_y.set_key(session.current_frame, world.tail[1])
            if grip:
                chain.enabled = True
                session.active_ik_chain = chain.uid
                self._drag_mode = "ik"
                self._drag_data = {"chain": chain, "start": local, "layer": lay}
                session.history.begin_macro("IK target")
                session.rig_changed.emit()
                return

        # 2. click on a bone: select / rotate / translate
        bone = rig.bone_at_point((local.x(), local.y()), worlds, tolerance=10.0 / max(0.2, self.zoom))
        if bone is not None:
            session.selected_bones = [bone.uid]
            session.selection_changed.emit()
            session.rig_changed.emit()
            w = worlds.get(bone.uid)
            self._drag_mode = "bone"
            self._drag_data = {
                "bone": bone, "start": local,
                "angle0": math.degrees(math.atan2(local.y() - w.head[1], local.x() - w.head[0])),
                "rotation0": bone.rotation.value_at(session.current_frame),
                "offset0": (bone.offset_x.value_at(session.current_frame),
                            bone.offset_y.value_at(session.current_frame)),
                "mode": "move" if (mods & Qt.ControlModifier) else "rotate",
                "head": w.head,
            }
            session.history.begin_macro("Bone edit")
            return

        # 3. empty space: create a new bone (drag to define direction/length)
        self._creating_bone = (local.x(), local.y())
        self._bone_preview = (local.x(), local.y())
        self.update()

    def _finish_bone(self, scene_pos: QPointF) -> None:
        session = self.session
        rig = session.active_rig()
        start = self._creating_bone
        self._creating_bone = None
        self._bone_preview = None
        if rig is None or start is None:
            return
        lay = session.active_layer()
        tr = self._layer_transform(lay) if lay is not None else QTransform()
        inv, ok = tr.inverted()
        local = inv.map(scene_pos) if ok else scene_pos
        dx = local.x() - start[0]
        dy = local.y() - start[1]
        length = math.hypot(dx, dy)
        if length < 12:
            # a simple click: if a bone is selected, start from its tail
            self.update()
            return
        world_angle = math.degrees(math.atan2(dy, dx))
        parent_uid = session.selected_bones[0] if session.selected_bones else None
        parent = rig.bones.get(parent_uid) if parent_uid else None
        # place the head at the clicked point, expressed in parent space
        x = y = 0.0
        if parent is not None:
            worlds = rig.solve(session.current_frame)
            w = worlds.get(parent.uid)
            if w is not None:
                # local offset from the parent tail, in the parent's frame
                px, py = w.tail
                ang = math.radians(w.world_angle)
                lx, ly = start[0] - px, start[1] - py
                x = lx * math.cos(-ang) - ly * math.sin(-ang)
                y = lx * math.sin(-ang) + ly * math.cos(-ang)
        else:
            x, y = start[0], start[1]
        base_angle = rig.rest_world_angle(parent) if parent is not None else 0.0
        local_angle = world_angle - base_angle
        name = self._next_bone_name(rig, parent)
        bone = session.add_bone(name, parent.uid if parent else None, x, y, length, local_angle)
        if bone is not None:
            session.selected_bones = [bone.uid]
            session.selection_changed.emit()
            session.status(f"Bone '{bone.name}' created - drag from its joint to pose it")
        self.update()

    def _next_bone_name(self, rig, parent) -> str:
        if parent is not None:
            base = parent.name
            for suffix in ("Shoulder", "Elbow", "Hip", "Knee"):
                if base.endswith(suffix):
                    mapping = {"Shoulder": "Elbow", "Elbow": "Hand", "Hip": "Knee", "Knee": "Foot"}
                    nxt = mapping[suffix]
                    side = base[:2] if base[:2] in ("L ", "R ") else ""
                    name = f"{side}{nxt}".strip()
                    if rig.find(name) is None:
                        return name
        index = len(rig.bones) + 1
        name = f"Bone {index}"
        while rig.find(name) is not None:
            index += 1
            name = f"Bone {index}"
        return name

    def _rename_bone(self, bone: Bone) -> None:
        name, ok = QInputDialog.getText(self, "Rename bone", "Name:", QLineEdit.Normal,
                                       bone.name)
        if ok and name.strip():
            rig = self.session.active_rig()
            self.session.set_bone_prop(bone.uid, "name", name.strip())
            _ = rig

    # =====================================================================
    # selection / colour picking / text
    # =====================================================================
    def _finish_select(self, rect: QRectF) -> None:
        session = self.session
        start = self.to_scene(rect.topLeft())
        end = self.to_scene(rect.bottomRight())
        sel = QRectF(start, end).normalized()
        hits: list[tuple[str, int]] = []
        for layer in session.scene.layers:
            keys = layer.cel_keys()
            for k in keys:
                if sel.width() < 3 and sel.height() < 3:
                    continue
                hit = layer.cels.get(k)
                if hit is None:
                    continue
                cel = hit.cel
                bounds = None
                if isinstance(cel, BitmapCel):
                    b = cel.content_bounds()
                    bounds = QRectF(b) if b else None
                elif isinstance(cel, VectorCel):
                    b = cel.content_bounds()
                    bounds = QRectF(b) if b else None
                if bounds is None:
                    continue
                tr = layer_transform(layer, session.current_frame)
                mapped = tr.mapRect(bounds)
                if sel.intersects(mapped):
                    hits.append((layer.uid, k))
        session.selected_cels = hits
        session.selection_changed.emit()
        if hits:
            session.status(f"Selected {len(hits)} cel(s)")
        else:
            session.status("Nothing selected")

    def _pick_color(self, scene_pos: QPointF) -> None:
        session = self.session
        out = self.out_size()
        img = render_scene(session.scene, session.project,
                           RenderOptions(frame=session.current_frame, size=out, background=False,
                                         camera=session.camera_view, quality="normal"))
        tr = self._render_transform()
        inv, ok = tr.inverted()
        local = inv.map(scene_pos) if ok else scene_pos
        x, y = int(local.x()), int(local.y())
        if 0 <= x < img.width() and 0 <= y < img.height():
            c = img.pixelColor(x, y)
            if c.alpha() > 0:
                session.primary_color = c
                session.status(f"Picked colour {c.name()}")
                session.brush_changed.emit()
        self.setCursor(Qt.CrossCursor)

    def _place_text(self, scene_pos: QPointF) -> None:
        session = self.session
        text = session.project.settings.get("drawing", {}).get("text", "Text")
        value, ok = QInputDialog.getText(self, "Text", "Text:", QLineEdit.Normal, text)
        if not ok:
            return
        session.project.settings.setdefault("drawing", {})["text"] = value
        layer = session.active_layer()
        if layer is None:
            return
        hit = layer.cel_at(session.frame)
        cel = hit[1].cel if hit else None
        before = cel.to_dict() if isinstance(cel, TextCel) else None
        if not isinstance(cel, TextCel):
            from ..model.cel import TextCel as TC
            cel = TC((session.scene.width, session.scene.height), value,
                     (scene_pos.x(), scene_pos.y()))
            cel.pixel_size = int(session.project.settings.get("drawing", {}).get("text_size", 96))
            layer.set_cel(session.frame, cel)
        else:
            cel.text = value
            cel.pos = (scene_pos.x(), scene_pos.y())
        after = cel.to_dict() if isinstance(cel, TextCel) else None

        def undo():
            if before is None:
                layer.remove_cel(session.frame)
            elif isinstance(cel, TextCel):
                for k, v in before.items():
                    setattr(cel, k, tuple(v) if isinstance(v, list) else v)
            session.canvas_changed.emit()
            session.timeline_changed.emit()

        def redo():
            if isinstance(cel, TextCel):
                layer.set_cel(session.frame, cel)
                for k, v in (after or {}).items():
                    setattr(cel, k, tuple(v) if isinstance(v, list) else v)
            session.canvas_changed.emit()
            session.timeline_changed.emit()

        session.command("Add text", undo, redo)
        session.canvas_changed.emit()
        session.timeline_changed.emit()

    def _edit_text_cel(self, cel: TextCel) -> None:
        value, ok = QInputDialog.getText(self, "Edit text", "Text:", QLineEdit.Normal, cel.text)
        if not ok:
            return
        before = cel.text
        cel.text = value
        session = self.session
        session.command("Edit text", lambda: setattr(cel, "text", before),
                        lambda: setattr(cel, "text", value))
        session.canvas_changed.emit()

    # =====================================================================
    # context menu
    # =====================================================================
    def _show_context_menu(self, event) -> None:
        from PySide6.QtWidgets import QMenu
        session = self.session
        menu = QMenu(self)
        pos = QPointF(event.position())
        scene_pos = self.to_scene(pos)
        tool = session.tool
        if tool == "bone":
            bone = self._bone_at(scene_pos)
            if bone is not None:
                menu.addAction(f"Select '{bone.name}'",
                               lambda: self._select_bone(bone))
                menu.addAction("Key this bone at frame", lambda: session.key_bone_pose(bone.uid))
                menu.addAction("Rename…", lambda: self._rename_bone(bone))
                menu.addSeparator()
                if session.selected_bones and len(session.selected_bones) == 1 and \
                        session.selected_bones[0] != bone.uid:
                    menu.addAction("Make '{}' the parent".format(bone.name),
                                   lambda: session.reparent_bone(session.selected_bones[0], bone.uid))
                menu.addAction("Add IK chain (this bone → child)",
                               lambda: self._add_ik_from(bone))
                menu.addSeparator()
                menu.addAction("Delete bone", lambda: session.delete_bone(bone.uid))
        menu.addAction("Zoom to fit", self.fit_to_window)
        menu.addAction("100% zoom", self.reset_zoom)
        menu.addSeparator()
        menu.addAction("Onion skin " + ("off" if session.project.settings.get("onion", {})
                                        .get("enabled", True) else "on"),
                       lambda: session.toggle_onion())
        menu.addAction("Grid " + ("off" if session.project.settings.get("grid", {})
                                  .get("visible") else "on"), self._toggle_grid)
        menu.addSeparator()
        menu.addAction("Add frame here", lambda: session.add_frame())
        menu.addAction("Duplicate frame", lambda: session.duplicate_frame())
        menu.addAction("Clear cel", session.clear_cel)
        if menu.actions():
            menu.exec(self.mapToGlobal(pos.toPoint()))

    def _select_bone(self, bone: Bone) -> None:
        self.session.selected_bones = [bone.uid]
        self.session.selection_changed.emit()
        self.session.rig_changed.emit()
        self.update()

    def _add_ik_from(self, bone: Bone) -> None:
        rig = self.session.active_rig()
        if rig is None:
            return
        children = rig.children_of(bone.uid)
        if not children:
            self.session.status("This bone has no child - IK needs two bones")
            return
        self.session.add_ik_chain(bone.uid, children[0].uid)

    def _toggle_grid(self) -> None:
        grid = self.session.project.settings.setdefault("grid", {"visible": False})
        grid["visible"] = not grid.get("visible", False)
        self.update()

    # =====================================================================
    # dragging IK / bones (called from mouseMoveEvent)
    # =====================================================================
    def _update_ik(self, scene_pos: QPointF) -> None:
        data = self._drag_data
        chain = data.get("chain")
        lay = data.get("layer")
        if chain is None:
            return
        tr = self._layer_transform(lay) if lay is not None else QTransform()
        inv, ok = tr.inverted()
        local = inv.map(scene_pos) if ok else scene_pos
        frame = self.session.frame
        chain.target_x.set_key(frame, local.x())
        chain.target_y.set_key(frame, local.y())
        self.session.rig_changed.emit()
        self.invalidate()

    def _update_bone_drag(self, scene_pos: QPointF) -> None:
        data = self._drag_data
        bone = data.get("bone")
        if bone is None:
            return
        lay = data.get("layer")
        tr = self._layer_transform(lay) if lay is not None else QTransform()
        inv, ok = tr.inverted()
        local = inv.map(scene_pos) if ok else scene_pos
        session = self.session
        if data.get("mode") == "move":
            dx = local.x() - data["start"].x()
            dy = local.y() - data["start"].y()
            ox, oy = data["offset0"]
            session.set_bone_prop(bone.uid, "offset_x", ox + dx, merge=True)
            session.set_bone_prop(bone.uid, "offset_y", oy + dy, merge=True)
        else:
            hx, hy = data["head"]
            angle = math.degrees(math.atan2(local.y() - hy, local.x() - hx))
            delta = angle - data["angle0"]
            if (local.x() - hx) ** 2 + (local.y() - hy) ** 2 < 25:
                delta = 0.0
            new_rotation = data["rotation0"] + delta
            if self.session.project.settings.get("drawing", {}).get("snap_angles"):
                new_rotation = round(new_rotation / 15.0) * 15.0
            session.set_bone_rotation(bone, new_rotation, merge=True)
        self.invalidate()

def _is_eraser(event) -> bool:
    try:
        from PySide6.QtGui import QTabletEvent
        return event.pointerType() == QTabletEvent.Eraser
    except Exception:
        return False


class PreviewCanvas(CanvasView):
    """Read-only canvas used for the start screen previews."""

    def __init__(self, session, parent=None):
        super().__init__(session, parent)
        self.setAttribute(Qt.WA_TransparentForMouseEvents, True)


_ = (QSize, QPoint, QCursor, QImage, QPainterPath, QPolygonF, QFont, QRect, Layer, layer_transform,
     paint_rig_overlay)
