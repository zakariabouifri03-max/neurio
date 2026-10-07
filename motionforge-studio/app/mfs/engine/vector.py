"""Vector stroke rendering & geometry helpers (bezier fit, smoothing)."""
from __future__ import annotations

import math

from PySide6.QtCore import QPointF, QRectF, Qt
from PySide6.QtGui import (QBrush, QColor, QFont, QFontMetricsF, QImage, QLinearGradient,
                           QPainter, QPainterPath, QPen, QPolygonF, QRadialGradient)

from ..model.cel import BrushSettings, TextCel, VectorCel


# --------------------------------------------------------------------------
# geometry
# --------------------------------------------------------------------------
def catmull_rom_path(points: list[tuple[float, float]], closed: bool = False,
                     tension: float = 0.5) -> QPainterPath:
    """Smooth path through the given points (Catmull-Rom -> cubic bezier)."""
    path = QPainterPath()
    n = len(points)
    if n == 0:
        return path
    path.moveTo(*points[0])
    if n == 1:
        path.lineTo(points[0][0] + 0.01, points[0][1] + 0.01)
        return path
    if n == 2:
        path.lineTo(*points[1])
        return path

    def _pt(i: int) -> tuple[float, float]:
        if closed:
            return points[i % n]
        return points[max(0, min(n - 1, i))]

    last = n if closed else n - 1
    for i in range(last):
        p0, p1, p2, p3 = _pt(i - 1), _pt(i), _pt(i + 1), _pt(i + 2)
        c1 = (p1[0] + (p2[0] - p0[0]) * tension / 3.0,
              p1[1] + (p2[1] - p0[1]) * tension / 3.0)
        c2 = (p2[0] - (p3[0] - p1[0]) * tension / 3.0,
              p2[1] - (p3[1] - p1[1]) * tension / 3.0)
        path.cubicTo(QPointF(*c1), QPointF(*c2), QPointF(*p2))
    if closed:
        path.closeSubpath()
    return path


def simplify(points: list[tuple[float, float]], tolerance: float = 0.8) -> list[tuple[float, float]]:
    """Ramer-Douglas-Peucker - keeps vector strokes light."""
    if len(points) < 3:
        return list(points)
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        i0, i1 = stack.pop()
        ax, ay = points[i0]
        bx, by = points[i1]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)
        best, best_i = -1.0, -1
        for i in range(i0 + 1, i1):
            px, py = points[i]
            if norm < 1e-9:
                d = math.hypot(px - ax, py - ay)
            else:
                d = abs(dy * px - dx * py + bx * ay - by * ax) / norm
            if d > best:
                best, best_i = d, i
        if best > tolerance and best_i > 0:
            keep[best_i] = True
            stack.append((i0, best_i))
            stack.append((best_i, i1))
    return [p for p, k in zip(points, keep) if k]


def raster_widths(points: list[tuple[float, float, float]], brush: BrushSettings) -> list[float]:
    """Width per sample (for variable width freehand rendering)."""
    from .brushes import width_for
    out = []
    n = max(1, len(points) - 1)
    for i, pt in enumerate(points):
        pressure = pt[2] if len(pt) > 2 else 1.0
        taper = 1.0
        if brush.taper_in:
            taper = min(taper, 0.25 + 0.75 * min(1.0, (i / n) / max(1e-5, brush.taper_in)))
        if brush.taper_out:
            taper = min(taper, 0.25 + 0.75 * min(1.0, ((n - i) / n) / max(1e-5, brush.taper_out)))
        out.append(width_for(brush, pressure) * taper)
    return out


# --------------------------------------------------------------------------
# painting
# --------------------------------------------------------------------------
def paint_freehand(painter: QPainter, points: list[tuple[float, float, float]],
                   brush: BrushSettings, color: QColor | None = None,
                   eraser: bool = False, image_size: tuple[int, int] | None = None) -> None:
    """Variable width freehand stroke (pressure aware, soft or hard edges)."""
    if not points:
        return
    col = color or QColor(*brush.color)
    widths = raster_widths(points, brush)
    painter.save()
    painter.setRenderHint(QPainter.Antialiasing, True)
    if eraser:
        painter.setCompositionMode(QPainter.CompositionMode_DestinationOut)
    if brush.hardness >= 0.85:
        pens = []
        for i in range(len(points) - 1):
            w = max(0.4, (widths[i] + widths[i + 1]) * 0.5)
            pen = QPen(col, w, Qt.SolidLine, Qt.RoundCap, Qt.RoundJoin)
            pens.append(pen)
        for i in range(len(points) - 1):
            painter.setPen(pens[i])
            painter.drawLine(QPointF(points[i][0], points[i][1]),
                             QPointF(points[i + 1][0], points[i + 1][1]))
    else:
        # soft brush: stamp radial gradients with spacing
        stamp_alpha = 255.0
        path_len = 0.0
        min_step = max(0.7, brush.size * max(0.03, brush.spacing))
        last = points[0]
        for i in range(1, len(points)):
            px, py = points[i][0], points[i][1]
            w = max(1.0, (widths[i - 1] + widths[i]) * 0.5)
            step = math.hypot(px - last[0], py - last[1])
            path_len += step
            reps = max(1, int(step / min_step))
            for r in range(reps):
                t = (r + 1) / reps
                sx = last[0] + (px - last[0]) * t
                sy = last[1] + (py - last[1]) * t
                alpha = int(stamp_alpha * brush.opacity)
                grad = QRadialGradient(QPointF(sx, sy), max(1.0, w * 0.5))
                c0 = QColor(col)
                c0.setAlpha(alpha)
                grad.setColorAt(0.0, c0)
                mid = QColor(col)
                mid.setAlpha(int(alpha * (0.35 + 0.6 * brush.hardness)))
                grad.setColorAt(max(0.05, min(0.95, brush.hardness)), mid)
                c1 = QColor(col)
                c1.setAlpha(0)
                grad.setColorAt(1.0, c1)
                painter.setBrush(QBrush(grad))
                painter.setPen(Qt.NoPen)
                painter.drawEllipse(QPointF(sx, sy), w * 0.5, w * 0.5)
            last = (px, py)
    painter.restore()


def paint_stroke_dict(painter: QPainter, stroke: dict) -> None:
    """Render one stored vector stroke (also used by the rasteriser/baker)."""
    kind = stroke.get("kind", "stroke")
    brush = BrushSettings.from_dict(stroke.get("brush", {}))
    color = QColor(*stroke.get("color", brush.color))
    points = [tuple(p) for p in stroke.get("points", [])]
    painter.save()
    painter.setRenderHint(QPainter.Antialiasing, True)
    pen = QPen(color)
    pen.setWidthF(max(0.5, brush.size))
    pen.setCapStyle(Qt.RoundCap)
    pen.setJoinStyle(Qt.RoundJoin)
    pen.setStyle(Qt.SolidLine)
    painter.setPen(pen)
    painter.setBrush(Qt.NoBrush)
    if stroke.get("fill"):
        painter.setBrush(QBrush(QColor(*stroke["fill"])))
    if stroke.get("opacity") is not None:
        painter.setOpacity(float(stroke["opacity"]))

    if kind == "stroke":
        paint_freehand(painter, points, brush, color,
                       eraser=stroke.get("eraser", False))
    elif kind == "line":
        if len(points) >= 2:
            painter.drawLine(QPointF(*points[0][:2]), QPointF(*points[1][:2]))
    elif kind == "rect":
        if len(points) >= 2:
            r = QRectF(QPointF(*points[0][:2]), QPointF(*points[1][:2])).normalized()
            painter.drawRect(r)
    elif kind == "ellipse":
        if len(points) >= 2:
            r = QRectF(QPointF(*points[0][:2]), QPointF(*points[1][:2])).normalized()
            painter.drawEllipse(r)
    elif kind == "polygon":
        if len(points) >= 2:
            poly = QPolygonF([QPointF(*p[:2]) for p in points])
            painter.drawPolygon(poly)
    elif kind == "bezier":
        pts = [tuple(p[:2]) for p in points]
        path = QPainterPath()
        if len(pts) >= 2:
            path.moveTo(*pts[0])
            if len(pts) == 2:
                path.lineTo(*pts[1])
            elif len(pts) == 3:
                path.quadTo(QPointF(*pts[1]), QPointF(*pts[2]))
            else:
                path.cubicTo(QPointF(*pts[1]), QPointF(*pts[2]), QPointF(*pts[3]))
        painter.setBrush(Qt.NoBrush)
        painter.drawPath(path)
        path = None
    elif kind == "gradient_rect":
        if len(points) >= 2:
            r = QRectF(QPointF(*points[0][:2]), QPointF(*points[1][:2])).normalized()
            grad = QLinearGradient(r.topLeft(), r.bottomRight())
            grad.setColorAt(0.0, QColor(*stroke.get("color", (255, 255, 255, 255))))
            grad.setColorAt(1.0, QColor(*stroke.get("color2", (40, 40, 60, 255))))
            painter.setPen(Qt.NoPen)
            painter.setBrush(QBrush(grad))
            painter.drawRect(r)
    painter.restore()


def paint_vector_cel(painter: QPainter, cel: VectorCel) -> None:
    for stroke in cel.strokes:
        paint_stroke_dict(painter, stroke)


def rasterize_vector_cel(cel: VectorCel, size: tuple[int, int] | None = None) -> QImage:
    """Bake a vector cel into a bitmap (used for export/inbetween)."""
    w, h = size or cel.size
    img = QImage(w, h, QImage.Format_ARGB32_Premultiplied)
    img.fill(Qt.transparent)
    p = QPainter(img)
    p.setRenderHint(QPainter.Antialiasing, True)
    paint_vector_cel(p, cel)
    p.end()
    return img


def paint_text_cel(painter: QPainter, cel: TextCel) -> None:
    font = QFont(cel.font)
    font.setPixelSize(int(cel.pixel_size))
    font.setBold(cel.bold)
    font.setItalic(cel.italic)
    if cel.tracking:
        font.setLetterSpacing(QFont.AbsoluteSpacing, float(cel.tracking))
    painter.save()
    painter.setRenderHint(QPainter.Antialiasing, True)
    painter.setRenderHint(QPainter.TextAntialiasing, True)
    if cel.rotation:
        painter.translate(cel.pos[0], cel.pos[1])
        painter.rotate(cel.rotation)
        painter.translate(-cel.pos[0], -cel.pos[1])
    painter.setFont(font)
    fm = QFontMetricsF(font)
    lines = cel.text.split("\n")
    x, y = cel.pos[0], cel.pos[1]
    for i, line in enumerate(lines):
        dy = y + i * fm.lineSpacing()
        if cel.align == "center":
            painter.drawText(QPointF(x - fm.horizontalAdvance(line) / 2.0, dy + fm.ascent()), line)
        elif cel.align == "right":
            painter.drawText(QPointF(x - fm.horizontalAdvance(line), dy + fm.ascent()), line)
        else:
            painter.drawText(QPointF(x, dy + fm.ascent()), line)
    painter.restore()


def text_bounds(cel: TextCel) -> QRectF:
    font = QFont(cel.font)
    font.setPixelSize(int(cel.pixel_size))
    font.setBold(cel.bold)
    font.setItalic(cel.italic)
    fm = QFontMetricsF(font)
    lines = cel.text.split("\n") or [""]
    width = max(fm.horizontalAdvance(line) for line in lines)
    height = fm.lineSpacing() * len(lines)
    x = cel.pos[0]
    if cel.align == "center":
        x -= width / 2.0
    elif cel.align == "right":
        x -= width
    return QRectF(x, cel.pos[1], max(1.0, width), max(1.0, height))
