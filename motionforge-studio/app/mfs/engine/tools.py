"""Interactive drawing tools.

Every tool follows the same tiny protocol so the canvas stays simple:

    tool.begin(pos, pressure, modifiers)
    tool.move(pos, pressure)
    tool.end(pos)  ->  returns a list of "edits" the history manager stores

The tools never touch Qt widgets; they only produce pixels / strokes inside
cels - which is what makes them testable head-less.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from PySide6.QtCore import QPointF, QRect, QRectF, Qt
from PySide6.QtGui import (QBrush, QColor, QImage, QPainter, QPainterPath, QPen, QPolygonF,
                           QTransform)

from ..model.cel import BitmapCel, BrushSettings, Cel, TextCel, VectorCel
from . import vector as vec
from .brushes import Stabilizer, width_for, opacity_for
from .fill import flood_fill

RASTER_TOOLS = {"brush", "pencil", "ink", "marker", "soft", "airbrush", "charcoal",
                "eraser", "fill", "shape", "text", "select_rect", "select_lasso",
                "transform", "eyedropper", "bone", "hand", "zoom"}


@dataclass
class ToolContext:
    """Everything a tool needs to know about the document."""

    project: object
    scene: object
    layer: object
    cel: Cel
    frame: int
    brush: BrushSettings = field(default_factory=BrushSettings)
    primary_color: QColor = field(default_factory=lambda: QColor(24, 24, 28))
    secondary_color: QColor = field(default_factory=lambda: QColor(255, 255, 255))
    fill_tolerance: int = 32
    fill_gap_close: int = 2
    shape_kind: str = "line"
    shape_filled: bool = False
    shape_sides: int = 5
    stabilizer: Stabilizer = field(default_factory=lambda: Stabilizer())
    sample_all_layers: bool = False
    pressure_enabled: bool = True

    def canvas_size(self) -> tuple[int, int]:
        return (self.cel.width, self.cel.height) if self.cel else (
            self.scene.width, self.scene.height)


# --------------------------------------------------------------------------
# edits (undo units)
# --------------------------------------------------------------------------
@dataclass
class RasterEdit:
    cel: BitmapCel
    before: bytes          # png encoded snapshot
    after: bytes
    label: str = "Draw"

    def undo(self) -> None:
        self.cel.image = _decode(self.before, self.cel.size)

    def redo(self) -> None:
        self.cel.image = _decode(self.after, self.cel.size)


@dataclass
class VectorEdit:
    cel: VectorCel
    added: list[dict]
    removed: list[dict]
    label: str = "Draw"

    def undo(self) -> None:
        for s in self.added:
            self.cel.remove_stroke(s.get("uid", ""))
        self.cel.strokes.extend(self.removed)

    def redo(self) -> None:
        for s in self.removed:
            self.cel.remove_stroke(s.get("uid", ""))
        for s in self.added:
            self.cel.strokes.append(s)


@dataclass
class TextEdit:
    cel: TextCel
    before: dict
    after: dict
    label: str = "Text"

    def undo(self) -> None:
        _apply_dict(self.cel, self.before)

    def redo(self) -> None:
        _apply_dict(self.cel, self.after)


def _apply_dict(cel: TextCel, d: dict) -> None:
    for k, v in d.items():
        if hasattr(cel, k):
            setattr(cel, k, tuple(v) if isinstance(v, list) else v)


def _encode(img: QImage) -> bytes:
    from PySide6.QtCore import QBuffer
    buf = QBuffer()
    buf.open(QBuffer.WriteOnly)
    img.save(buf, "PNG")
    return bytes(buf.data())


def _decode(data: bytes, size: tuple[int, int]) -> QImage:
    from PySide6.QtCore import QByteArray
    img = QImage.fromData(QByteArray(data), "PNG")
    if img.isNull():
        img = QImage(size[0], size[1], QImage.Format_ARGB32_Premultiplied)
        img.fill(Qt.transparent)
    return img


# --------------------------------------------------------------------------
# base tool
# --------------------------------------------------------------------------
class Tool:
    name = "tool"

    def __init__(self, ctx: ToolContext):
        self.ctx = ctx
        self.active = False
        self.points: list[tuple[float, float, float]] = []
        self.preview: QImage | None = None
        self.started_at: tuple[float, float] | None = None
        self.snapshot: QImage | None = None
        self.edits: list = []
        self.info: str = ""

    # -- lifecycle --------------------------------------------------------
    def begin(self, pos: tuple[float, float], pressure: float = 1.0, modifiers=None) -> None:
        self.active = True
        self.started_at = pos
        self.points = [(pos[0], pos[1], pressure)]
        self.ctx.stabilizer.reset()
        self.edits = []
        self._on_begin(pos, pressure, modifiers)

    def move(self, pos: tuple[float, float], pressure: float = 1.0) -> None:
        if not self.active:
            return
        sx, sy = self.ctx.stabilizer.update(pos[0], pos[1])
        self.points.append((sx, sy, pressure))
        self._on_move(pos, (sx, sy), pressure)

    def end(self, pos: tuple[float, float], pressure: float = 1.0) -> list:
        if not self.active:
            return []
        for p in self.ctx.stabilizer.flush(pos[0], pos[1]):
            self.points.append((p[0], p[1], pressure))
        self.active = False
        self._on_end(pos, pressure)
        return self.edits

    def cancel(self) -> None:
        self.active = False
        self.preview = None
        if self.snapshot is not None and isinstance(self.ctx.cel, BitmapCel):
            self.ctx.cel.image = self.snapshot
        self.snapshot = None

    # -- hooks ------------------------------------------------------------
    def _on_begin(self, pos, pressure, modifiers) -> None: ...
    def _on_move(self, raw_pos, pos, pressure) -> None: ...
    def _on_end(self, pos, pressure) -> None: ...

    # -- helpers ----------------------------------------------------------
    def _ensure_preview(self) -> QImage:
        if self.preview is None:
            size = self.ctx.canvas_size()
            self.preview = QImage(size[0], size[1], QImage.Format_ARGB32_Premultiplied)
            self.preview.fill(Qt.transparent)
        return self.preview

    def _take_snapshot(self) -> None:
        cel = self.ctx.cel
        if isinstance(cel, BitmapCel):
            cel.invalidate_bounds()
            self.snapshot = cel.image.copy()


class RasterStrokeTool(Tool):
    """Freehand painting with pressure, hardness and stabilisation."""

    def __init__(self, ctx: ToolContext, eraser: bool = False, kind: str | None = None):
        super().__init__(ctx)
        self.eraser = eraser
        if kind:
            self.ctx.brush.kind = kind

    def _on_begin(self, pos, pressure, modifiers) -> None:
        self._take_snapshot()

    def _on_move(self, raw_pos, pos, pressure) -> None:
        target = self.ctx.cel
        if isinstance(target, BitmapCel):
            self._paint_live(pos, pressure)
        elif isinstance(target, VectorCel):
            pass  # drawn at the end for a clean vector result

    def _paint_live(self, pos, pressure) -> None:
        """Draw the newest segment straight onto the cel (fast, tablet ready)."""
        cel = self.ctx.cel
        if not isinstance(cel, BitmapCel) or len(self.points) < 2:
            return
        p_prev = self.points[-2]
        brush = self.ctx.brush
        painter = QPainter(cel.image)
        painter.setRenderHint(QPainter.Antialiasing, True)
        col = QColor(self.ctx.primary_color)
        col.setAlphaF(max(0.0, min(1.0, opacity_for(brush, pressure))))
        col = QColor(col.red(), col.green(), col.blue(), int(col.alpha()))
        vec.paint_freehand(painter, [p_prev, (pos[0], pos[1], pressure)], brush, col,
                           eraser=self.eraser)
        painter.end()
        cel.invalidate_bounds()

    def _on_end(self, pos, pressure) -> None:
        cel = self.ctx.cel
        if isinstance(cel, VectorCel):
            points = [(p[0], p[1], p[2]) for p in vec.simplify([(p[0], p[1]) for p in self.points])] or []
            pts = []
            src = self.points
            if len(src) >= 2:
                step = max(1, len(src) // max(1, len(points)))
                for i in range(len(points)):
                    p = src[min(len(src) - 1, i * step)]
                    pts.append([points[i][0], points[i][1], p[2] if len(p) > 2 else 1.0])
            else:
                pts = [[p[0], p[1], p[2]] for p in src]
            stroke = {
                "kind": "stroke", "points": pts,
                "brush": self.ctx.brush.to_dict(),
                "color": [self.ctx.primary_color.red(), self.ctx.primary_color.green(),
                          self.ctx.primary_color.blue(), self.ctx.primary_color.alpha()],
                "eraser": self.eraser,
            }
            cel.add_stroke(stroke)
            self.edits.append(VectorEdit(cel, [stroke], [], "Brush"))
        elif isinstance(cel, BitmapCel) and self.snapshot is not None:
            before = _encode(self.snapshot)
            after = _encode(cel.image)
            self.edits.append(RasterEdit(cel, before, after,
                                         "Erase" if self.eraser else "Draw"))
        self.preview = None


class ShapeTool(Tool):
    """Line, rectangle, ellipse, polygon and bezier."""

    name = "shape"

    def __init__(self, ctx: ToolContext, kind: str = "line"):
        super().__init__(ctx)
        self.kind = kind

    def _on_begin(self, pos, pressure, modifiers) -> None:
        self._take_snapshot()
        self._ensure_preview()

    def _on_move(self, raw_pos, pos, pressure) -> None:
        if self.kind in ("polygon", "bezier") and getattr(self, "_click_mode", False):
            return
        self._draw_shape(self.ctx.cel, is_preview=True)

    def _on_end(self, pos, pressure) -> None:
        cel = self.ctx.cel
        if isinstance(cel, VectorCel):
            stroke = self._stroke_dict()
            if stroke:
                cel.add_stroke(stroke)
                self.edits.append(VectorEdit(cel, [stroke], [], self.kind))
        elif isinstance(cel, BitmapCel):
            painter = QPainter(cel.image)
            painter.setRenderHint(QPainter.Antialiasing, True)
            self._paint(painter)
            painter.end()
            cel.invalidate_bounds()
            if self.snapshot is not None:
                self.edits.append(RasterEdit(cel, _encode(self.snapshot), _encode(cel.image),
                                             self.kind.title()))
        self.preview = None

    # -- geometry ---------------------------------------------------------
    def _polygon_points(self) -> list[tuple[float, float]]:
        pts = [p for p in self.points]
        if self.kind == "polygon" and len(self.points) >= 2:
            return [(p[0], p[1]) for p in self.points]
        return [(p[0], p[1]) for p in pts]

    def _stroke_dict(self) -> dict | None:
        pts = [(p[0], p[1], p[2]) for p in self.points]
        if len(pts) < 2:
            return None
        if self.kind == "line":
            pts = [pts[0], pts[-1]]
        elif self.kind in ("rect", "ellipse"):
            pts = [pts[0], pts[-1]]
        return {
            "kind": self.kind, "points": [[p[0], p[1], p[2]] for p in pts],
            "brush": self.ctx.brush.to_dict(),
            "filled": self.ctx.shape_filled,
            "fill": [self.ctx.primary_color.red(), self.ctx.primary_color.green(),
                     self.ctx.primary_color.blue(), 90] if self.ctx.shape_filled else None,
            "color": [self.ctx.primary_color.red(), self.ctx.primary_color.green(),
                      self.ctx.primary_color.blue(), self.ctx.primary_color.alpha()],
            "sides": self.ctx.shape_sides,
        }

    def _paint(self, painter: QPainter) -> None:
        brush = self.ctx.brush
        col = QColor(self.ctx.primary_color)
        pen = QPen(col, max(0.6, brush.size), Qt.SolidLine, Qt.RoundCap, Qt.RoundJoin)
        painter.setPen(pen)
        if self.ctx.shape_filled:
            fill = QColor(self.ctx.primary_color)
            fill.setAlpha(90)
            painter.setBrush(QBrush(fill))
        else:
            painter.setBrush(Qt.NoBrush)
        pts = self.points
        if len(pts) < 2:
            return
        x0, y0 = pts[0][0], pts[0][1]
        x1, y1 = pts[-1][0], pts[-1][1]
        if self.kind == "line":
            painter.drawLine(QPointF(x0, y0), QPointF(x1, y1))
        elif self.kind == "rect":
            painter.drawRect(QRectF(QPointF(x0, y0), QPointF(x1, y1)).normalized())
        elif self.kind == "ellipse":
            painter.drawEllipse(QRectF(QPointF(x0, y0), QPointF(x1, y1)).normalized())
        elif self.kind == "polygon":
            n = max(3, int(self.ctx.shape_sides))
            cx, cy = (x0 + x1) / 2.0, (y0 + y1) / 2.0
            rx, ry = abs(x1 - x0) / 2.0, abs(y1 - y0) / 2.0
            poly = QPolygonF([
                QPointF(cx + rx * math.cos(math.radians(-90 + i * 360.0 / n)),
                        cy + ry * math.sin(math.radians(-90 + i * 360.0 / n)))
                for i in range(n)])
            painter.drawPolygon(poly)
        elif self.kind == "bezier":
            path = QPainterPath()
            if len(pts) >= 4:
                path.moveTo(pts[0][0], pts[0][1])
                path.cubicTo(QPointF(pts[1][0], pts[1][1]), QPointF(pts[2][0], pts[2][1]),
                             QPointF(pts[3][0], pts[3][1]))
            elif len(pts) == 3:
                path.moveTo(pts[0][0], pts[0][1])
                path.quadTo(QPointF(pts[1][0], pts[1][1]), QPointF(pts[2][0], pts[2][1]))
            else:
                path = vec.catmull_rom_path([(p[0], p[1]) for p in pts])
            painter.setBrush(Qt.NoBrush)
            painter.drawPath(path)
        elif self.kind == "gradient":
            pass

    def _draw_shape(self, cel, is_preview: bool = True) -> None:
        pass


class BucketTool(Tool):
    name = "fill"

    def __init__(self, ctx: ToolContext):
        super().__init__(ctx)

    def _on_begin(self, pos, pressure, modifiers) -> None:
        cel = self.ctx.cel
        if isinstance(cel, BitmapCel):
            self.snapshot = cel.image.copy()
            sample = None
            if self.ctx.sample_all_layers:
                from .render import RenderOptions, render_scene
                opts = RenderOptions(frame=self.ctx.frame, background=False, camera=False,
                                     quality="normal")
                sample = render_scene(self.ctx.scene, self.ctx.project, opts)
            before = _encode(self.snapshot)
            result = flood_fill(cel.image, int(pos[0]), int(pos[1]), self.ctx.primary_color,
                                self.ctx.fill_tolerance, self.ctx.fill_gap_close,
                                sample_all_layers=sample)
            if result is not None:
                cel.image = result
                cel.invalidate_bounds()
                self.edits.append(RasterEdit(cel, before, _encode(result), "Fill"))
        elif isinstance(cel, VectorCel):
            stroke = {
                "kind": "fill", "points": [[pos[0], pos[1], 1.0]],
                "color": [self.ctx.primary_color.red(), self.ctx.primary_color.green(),
                          self.ctx.primary_color.blue(), self.ctx.primary_color.alpha()],
                "brush": self.ctx.brush.to_dict(),
            }
            cel.add_stroke(stroke)
            self.edits.append(VectorEdit(cel, [stroke], [], "Fill"))


class TextTool(Tool):
    name = "text"

    def __init__(self, ctx: ToolContext, text: str = "Text", font: str = "Segoe UI",
                 size: int = 72, align: str = "left"):
        super().__init__(ctx)
        self.text = text
        self.font = font
        self.size = size
        self.align = align

    def _on_begin(self, pos, pressure, modifiers) -> None:
        cel = self.ctx.cel
        if isinstance(cel, TextCel):
            self.before = cel.to_dict()
            cel.text = self.text
            cel.pos = pos
            cel.pixel_size = self.size
            cel.font = self.font
            cel.align = self.align
            cel.color = (self.ctx.primary_color.red(), self.ctx.primary_color.green(),
                         self.ctx.primary_color.blue(), self.ctx.primary_color.alpha())
            self.after = cel.to_dict()
            self.edits.append(TextEdit(cel, self.before, self.after, "Text"))
        elif isinstance(cel, VectorCel):
            stroke = {
                "kind": "text", "points": [[pos[0], pos[1], 1.0]],
                "text": self.text, "font": self.font, "size": self.size, "align": self.align,
                "color": [self.ctx.primary_color.red(), self.ctx.primary_color.green(),
                          self.ctx.primary_color.blue(), self.ctx.primary_color.alpha()],
            }
            cel.add_stroke(stroke)
            self.edits.append(VectorEdit(cel, [stroke], [], "Text"))
        elif isinstance(cel, BitmapCel):
            self._take_snapshot()
            self._stamp_raster(pos)

    def _stamp_raster(self, pos) -> None:
        """Burn the text into a raster cel so the Text tool works on any layer."""
        cel = self.ctx.cel
        if not isinstance(cel, BitmapCel) or self.snapshot is None:
            return
        from PySide6.QtGui import QFont
        col = QColor(self.ctx.primary_color)
        painter = QPainter(cel.image)
        painter.setRenderHint(QPainter.Antialiasing, True)
        painter.setRenderHint(QPainter.TextAntialiasing, True)
        font = QFont(self.font)
        font.setPixelSize(int(max(4, self.size)))
        painter.setFont(font)
        painter.setPen(col)
        metrics = painter.fontMetrics()
        x, y = float(pos[0]), float(pos[1]) + metrics.ascent()
        align = {"center": Qt.AlignHCenter, "right": Qt.AlignRight}.get(self.align, Qt.AlignLeft)
        lines = str(self.text).split("\n")
        for i, line in enumerate(lines):
            rect = QRectF(x - 4000.0, y + i * metrics.lineSpacing() - metrics.ascent(),
                          8000.0, metrics.lineSpacing() * 1.6)
            painter.drawText(rect, int(align | Qt.AlignTop), line)
        painter.end()
        cel.invalidate_bounds()
        self.edits.append(RasterEdit(cel, _encode(self.snapshot), _encode(cel.image), "Text"))


class EyedropperTool(Tool):
    name = "eyedropper"

    def __init__(self, ctx: ToolContext):
        super().__init__(ctx)
        self.picked: QColor | None = None

    def _on_begin(self, pos, pressure, modifiers) -> None:
        img = None
        from .render import RenderOptions, render_scene
        opts = RenderOptions(frame=self.ctx.frame, background=False, camera=False, quality="normal")
        img = render_scene(self.ctx.scene, self.ctx.project, opts)
        if img is not None and 0 <= int(pos[0]) < img.width() and 0 <= int(pos[1]) < img.height():
            c = img.pixelColor(int(pos[0]), int(pos[1]))
            if c.alpha() > 0:
                self.picked = c


# --------------------------------------------------------------------------
# factory
# --------------------------------------------------------------------------
TOOL_LABELS = {
    "select": "Select", "brush": "Brush", "pencil": "Pencil", "ink": "Ink Pen",
    "eraser": "Eraser", "fill": "Fill", "shape": "Shape", "text": "Text",
    "transform": "Transform", "bone": "Bone / Rig", "hand": "Hand", "zoom": "Zoom",
    "eyedropper": "Eyedropper",
}


def make_tool(tool_name: str, ctx: ToolContext, **kw) -> Tool | None:
    if tool_name in ("brush", "ink", "marker", "soft", "airbrush", "charcoal", "pencil"):
        t = RasterStrokeTool(ctx, eraser=False, kind=tool_name if tool_name != "brush" else None)
        t.name = tool_name
        return t
    if tool_name == "eraser":
        t = RasterStrokeTool(ctx, eraser=True)
        t.name = "eraser"
        ctx.brush.kind = "eraser"
        return t
    if tool_name == "fill":
        return BucketTool(ctx)
    if tool_name == "shape":
        return ShapeTool(ctx, kw.get("kind", "line"))
    if tool_name == "text":
        return TextTool(ctx, kw.get("text", "Text"), kw.get("font", "Segoe UI"),
                        kw.get("size", 72), kw.get("align", "left"))
    if tool_name == "eyedropper":
        return EyedropperTool(ctx)
    return None
