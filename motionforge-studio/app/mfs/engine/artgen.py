"""Procedural artwork generation.

MotionForge can create usable art on the fly - this powers the project
templates, the "New Character" wizard, the lip-sync mouth charts, props and
backgrounds.  Everything is drawn with QPainter so it stays crisp at any size
and needs no network access.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from PySide6.QtCore import QPointF, QRectF, Qt
from PySide6.QtGui import (QBrush, QColor, QFont, QImage, QLinearGradient, QPainter, QPainterPath,
                           QPen, QRadialGradient)

# --------------------------------------------------------------------------
# palettes
# --------------------------------------------------------------------------
PALETTES = {
    "Cartoon Bright": ["#ff6b6b", "#ffd166", "#4ecdc4", "#5567ff", "#f78fb3", "#2b2d42"],
    "Anime Pastel": ["#ffc2d1", "#bde0fe", "#ffd6a5", "#caffbf", "#a0c4ff", "#2f2b3a"],
    "Noir": ["#2b2d42", "#8d99ae", "#edf2f4", "#ef233c", "#6c757d", "#0b0c10"],
    "Sunset": ["#ff9f1c", "#ff4d6d", "#c77dff", "#4cc9f0", "#ffd60a", "#1b1b2f"],
    "Forest": ["#2d6a4f", "#74c69d", "#d8f3dc", "#b08968", "#e9c46a", "#1b1b1b"],
    "Neon": ["#ff2e63", "#08d9d6", "#f9ed69", "#b83b5e", "#6a2c70", "#111111"],
}


def palette(name: str) -> list[str]:
    return PALETTES.get(name, PALETTES["Cartoon Bright"])


# --------------------------------------------------------------------------
# helpers
# --------------------------------------------------------------------------
def new_image(size: tuple[int, int]) -> QImage:
    img = QImage(int(size[0]), int(size[1]), QImage.Format_ARGB32_Premultiplied)
    img.fill(Qt.transparent)
    return img


def _qpainter(img: QImage) -> QPainter:
    p = QPainter(img)
    p.setRenderHint(QPainter.Antialiasing, True)
    p.setRenderHint(QPainter.SmoothPixmapTransform, True)
    p.setRenderHint(QPainter.TextAntialiasing, True)
    return p


def image_to_png(img: QImage) -> bytes:
    from PySide6.QtCore import QBuffer
    buf = QBuffer()
    buf.open(QBuffer.WriteOnly)
    img.save(buf, "PNG")
    return bytes(buf.data())


def _shade(color: QColor, factor: float) -> QColor:
    h, s, v, a = color.getHsv()
    v = max(0, min(255, int(v * factor)))
    s = max(0, min(255, int(s * (0.9 if factor < 1 else 1.0))))
    return QColor.fromHsv(h, s, v, a)


def rounded_rect(p: QPainter, rect: QRectF, radius: float, fill: QColor,
                 outline: QColor | None = None, width: float = 2.0) -> None:
    grad = QLinearGradient(rect.topLeft(), rect.bottomRight())
    grad.setColorAt(0.0, _shade(fill, 1.12))
    grad.setColorAt(1.0, _shade(fill, 0.86))
    p.setBrush(QBrush(grad))
    p.setPen(QPen(outline or _shade(fill, 0.6), width))
    p.drawRoundedRect(rect, radius, radius)


# --------------------------------------------------------------------------
# characters
# --------------------------------------------------------------------------
@dataclass
class PartImage:
    name: str
    image: QImage
    pivot: tuple[float, float] = (0.5, 0.5)      # normalised attach point
    parent: str | None = None
    bone_length: float = 100.0
    angle: float = 90.0
    z: int = 0

    def png(self) -> bytes:
        return image_to_png(self.image)


def _head(size: int, skin: QColor, hair: QColor, style: str = "round",
          face: bool = True) -> QImage:
    img = new_image((int(size * 1.15), int(size * 1.25)))
    p = _qpainter(img)
    w, h = img.width(), img.height()
    rect = QRectF(w * 0.06, h * 0.10, w * 0.88, h * 0.82)
    if style == "anime":
        p.setBrush(QBrush(skin))
        p.setPen(QPen(_shade(skin, 0.75), max(1.5, size * 0.02)))
        path = QPainterPath()
        path.moveTo(rect.left() + rect.width() * 0.5, rect.top())
        path.cubicTo(rect.right() + rect.width() * 0.05, rect.top() + rect.height() * 0.05,
                     rect.right(), rect.top() + rect.height() * 0.55,
                     rect.center().x(), rect.bottom())
        path.cubicTo(rect.left(), rect.top() + rect.height() * 0.55,
                     rect.left() - rect.width() * 0.05, rect.top() + rect.height() * 0.05,
                     rect.left() + rect.width() * 0.5, rect.top())
        p.drawPath(path)
    else:
        p.setBrush(QBrush(skin))
        p.setPen(QPen(_shade(skin, 0.75), max(1.5, size * 0.02)))
        p.drawEllipse(rect)
    # hair
    hair_rect = QRectF(rect.left() - w * 0.02, rect.top() - h * 0.04,
                       rect.width() * 1.04, rect.height() * 0.60)
    p.setBrush(QBrush(hair))
    p.setPen(QPen(_shade(hair, 0.7), max(1.2, size * 0.015)))
    if style == "anime":
        path = QPainterPath()
        path.moveTo(hair_rect.left(), hair_rect.bottom())
        path.lineTo(hair_rect.left() + hair_rect.width() * 0.1, hair_rect.top())
        path.lineTo(hair_rect.center().x(), hair_rect.top() + hair_rect.height() * 0.16)
        path.lineTo(hair_rect.right() - hair_rect.width() * 0.1, hair_rect.top())
        path.lineTo(hair_rect.right(), hair_rect.bottom())
        path.linkTo(hair_rect.left(), hair_rect.bottom())
        p.drawPath(path)
    else:
        p.drawChord(hair_rect, 0, 180 * 16)
    if face:
        eye_y = rect.top() + rect.height() * 0.55
        eye_r = max(2.0, size * 0.075)
        for sign in (-1, 1):
            ex = rect.center().x() + sign * rect.width() * 0.19
            p.setBrush(QBrush(QColor("#20222c")))
            p.setPen(Qt.NoPen)
            p.drawEllipse(QPointF(ex, eye_y), eye_r, eye_r * (1.25 if style == "anime" else 1.0))
            p.setBrush(QBrush(QColor("#ffffff")))
            p.drawEllipse(QPointF(ex + eye_r * 0.28, eye_y - eye_r * 0.3), eye_r * 0.3, eye_r * 0.3)
        # mouth
        p.setBrush(Qt.NoBrush)
        p.setPen(QPen(QColor("#8a3b4a"), max(1.4, size * 0.022)))
        mouth = QRectF(rect.center().x() - rect.width() * 0.16, eye_y + rect.height() * 0.14,
                       rect.width() * 0.32, rect.height() * 0.16)
        p.drawArc(mouth, 200 * 16, 140 * 16)
        # cheeks
        p.setPen(Qt.NoPen)
        cheek = QColor(skin)
        cheek.setAlpha(70)
        p.setBrush(QBrush(_shade(QColor("#ff8fa3"), 1.0)))
        for sign in (-1, 1):
            p.drawEllipse(QPointF(rect.center().x() + sign * rect.width() * 0.34,
                                  eye_y + rect.height() * 0.1),
                          rect.width() * 0.09, rect.height() * 0.06)
    p.end()
    return img


def _limb(width: float, height: float, color: QColor, outline: bool = True,
          round_caps: bool = True) -> QImage:
    img = new_image((int(width), int(height)))
    p = _qpainter(img)
    rect = QRectF(1, 1, width - 2, height - 2)
    grad = QLinearGradient(0, 0, width, 0)
    grad.setColorAt(0.0, _shade(color, 1.15))
    grad.setColorAt(1.0, _shade(color, 0.85))
    p.setBrush(QBrush(grad))
    p.setPen(QPen(_shade(color, 0.65), 1.6) if outline else Qt.NoPen)
    radius = min(width, height) * (0.45 if round_caps else 0.25)
    p.drawRoundedRect(rect, radius, radius)
    p.end()
    return img


def _hand(size: float, color: QColor) -> QImage:
    img = new_image((int(size * 1.3), int(size * 1.4)))
    p = _qpainter(img)
    p.setBrush(QBrush(color))
    p.setPen(QPen(_shade(color, 0.7), 1.5))
    p.drawEllipse(QRectF(img.width() * 0.1, img.height() * 0.12,
                         img.width() * 0.8, img.height() * 0.78))
    p.end()
    return img


def _foot(size: float, color: QColor) -> QImage:
    img = new_image((int(size * 1.5), int(size)))
    p = _qpainter(img)
    p.setBrush(QBrush(color))
    p.setPen(QPen(_shade(color, 0.7), 1.5))
    p.drawRoundedRect(QRectF(img.width() * 0.05, img.height() * 0.2,
                             img.width() * 0.9, img.height() * 0.62),
                      img.height() * 0.28, img.height() * 0.28)
    p.end()
    return img


def cartoon_character(height: float = 460.0, palette_name: str = "Cartoon Bright",
                      style: str = "round", name: str = "Character",
                      face: bool = True) -> dict[str, PartImage]:
    """Build a complete separable character (every part is its own image)."""
    cols = [QColor(c) for c in palette(palette_name)]
    skin = cols[1] if not cols[1].lightnessF() < 0.2 else QColor("#f5c7a1")
    skin = QColor("#f7c8a3") if style == "round" else QColor("#ffdfc4")
    hair = cols[5]
    shirt = cols[3]
    pants = cols[0]
    shoe = cols[5]
    sleeve = _shade(shirt, 0.92)

    head_h = height * 0.22
    torso_h = height * 0.30
    arm_len = height * 0.26
    leg_len = height * 0.30
    limb_w = max(10.0, height * 0.055)

    parts: dict[str, PartImage] = {}
    parts["Head"] = PartImage("Head", _head(head_h, skin, hair, style, face),
                              pivot=(0.5, 0.9), bone_length=head_h * 0.7, angle=-90, z=6)
    torso = new_image((int(head_h * 0.95), int(torso_h)))
    p = _qpainter(torso)
    rounded_rect(p, QRectF(torso.width() * 0.08, 2, torso.width() * 0.84, torso.height() - 4),
                 torso.width() * 0.24, shirt)
    p.end()
    parts["Torso"] = PartImage("Torso", torso, pivot=(0.5, 0.05),
                               bone_length=torso_h * 0.62, angle=-90, z=3)
    parts["Pelvis"] = PartImage("Pelvis", _limb(limb_w * 1.7, limb_w * 1.15, pants),
                                pivot=(0.5, 0.2), bone_length=limb_w * 1.2, angle=90, z=2)

    for side in ("L", "R"):
        upper = _limb(limb_w, arm_len * 0.55, sleeve)
        parts[f"{side} Shoulder"] = PartImage(f"{side} Shoulder", upper, pivot=(0.5, 0.08),
                                             bone_length=arm_len * 0.55, angle=90 if side == "L" else 90,
                                             z=4)
        fore = _limb(limb_w * 0.92, arm_len * 0.5, skin)
        parts[f"{side} Elbow"] = PartImage(f"{side} Elbow", fore, pivot=(0.5, 0.08),
                                          bone_length=arm_len * 0.5, angle=90, z=4)
        parts[f"{side} Hand"] = PartImage(f"{side} Hand", _hand(limb_w * 1.25, skin),
                                         pivot=(0.5, 0.15), bone_length=limb_w * 1.1,
                                         angle=90, z=5)
        thigh = _limb(limb_w * 1.08, leg_len * 0.55, pants)
        parts[f"{side} Hip"] = PartImage(f"{side} Hip", thigh, pivot=(0.5, 0.08),
                                        bone_length=leg_len * 0.55, angle=90, z=2)
        shin = _limb(limb_w * 0.95, leg_len * 0.5, _shade(pants, 1.06))
        parts[f"{side} Knee"] = PartImage(f"{side} Knee", shin, pivot=(0.5, 0.08),
                                         bone_length=leg_len * 0.5, angle=90, z=2)
        parts[f"{side} Foot"] = PartImage(f"{side} Foot", _foot(limb_w * 2.0, shoe),
                                         pivot=(0.1, 0.2), bone_length=limb_w * 1.8,
                                         angle=0, z=2)
    _ = name
    return parts


def stick_figure(height: float = 420.0, color: str = "#20222c", line: float = 9.0) -> QImage:
    """A drawable stick figure in the rest pose (single image)."""
    img = new_image((int(height * 0.62), int(height)))
    p = _qpainter(img)
    col = QColor(color)
    pen = QPen(col, line, Qt.SolidLine, Qt.RoundCap, Qt.RoundJoin)
    p.setPen(pen)
    w, h = img.width(), img.height()
    cx = w / 2
    head_r = height * 0.075
    head_cy = height * 0.11
    neck_y = head_cy + head_r
    hip_y = height * 0.52
    shoulder_w = height * 0.10
    p.drawEllipse(QPointF(cx, head_cy), head_r, head_r)
    p.drawLine(QPointF(cx, neck_y), QPointF(cx, hip_y))
    p.drawLine(QPointF(cx - shoulder_w, height * 0.28), QPointF(cx + shoulder_w, height * 0.28))
    for sign in (-1, 1):
        sx = cx + sign * shoulder_w
        p.drawLine(QPointF(sx, height * 0.28), QPointF(sx + sign * height * 0.06, height * 0.44))
        p.drawLine(QPointF(sx + sign * height * 0.06, height * 0.44),
                   QPointF(sx + sign * height * 0.02, height * 0.58))
        p.drawLine(QPointF(cx + sign * height * 0.03, hip_y),
                   QPointF(cx + sign * height * 0.07, height * 0.75))
        p.drawLine(QPointF(cx + sign * height * 0.07, height * 0.75),
                   QPointF(cx + sign * height * 0.05, height * 0.95))
    p.end()
    return img


# --------------------------------------------------------------------------
# mouth chart (lip sync)
# --------------------------------------------------------------------------
VISEMES = ["Rest", "A", "E", "I", "O", "U", "M", "F", "L"]


def mouth_shapes(width: int = 220, height: int = 150, skin: str = "#f7c8a3",
                 line: str = "#7a3b46") -> dict[str, QImage]:
    """A classic 9 shape mouth chart used by the lip-sync engine."""
    out: dict[str, QImage] = {}
    base = QColor(skin)
    ink = QColor(line)
    for viseme in VISEMES:
        img = new_image((width, height))
        p = _qpainter(img)
        cx, cy = width / 2, height / 2
        rim = QRectF(0, 0, width, height)
        grad = QRadialGradient(QPointF(cx, cy), width * 0.6)
        grad.setColorAt(0.0, _shade(base, 1.08))
        grad.setColorAt(1.0, _shade(base, 0.92))
        p.setBrush(QBrush(grad))
        p.setPen(Qt.NoPen)
        p.drawEllipse(rim)
        p.setPen(QPen(ink, max(2.0, width * 0.018)))
        p.setBrush(QBrush(QColor("#5c2530")))
        w = width * 0.42
        hh = height * 0.30
        if viseme == "Rest":
            p.setBrush(Qt.NoBrush)
            p.drawLine(QPointF(cx - w * 0.5, cy), QPointF(cx + w * 0.5, cy))
        elif viseme == "M":
            p.setBrush(Qt.NoBrush)
            p.setPen(QPen(ink, max(3.0, width * 0.03)))
            p.drawLine(QPointF(cx - w * 0.45, cy + 2), QPointF(cx + w * 0.45, cy + 2))
        elif viseme == "F":
            p.setBrush(QBrush(QColor("#e8e2d8")))
            p.drawEllipse(QRectF(cx - w * 0.4, cy - hh * 0.25, w * 0.8, hh * 0.5))
            p.setBrush(Qt.NoBrush)
            p.drawLine(QPointF(cx - w * 0.2, cy - hh * 0.1), QPointF(cx + w * 0.2, cy - hh * 0.1))
        elif viseme == "L":
            p.setBrush(QBrush(QColor("#d9748c")))
            p.drawEllipse(QRectF(cx - w * 0.32, cy - hh * 0.35, w * 0.64, hh * 0.7))
        elif viseme == "A":
            p.drawEllipse(QRectF(cx - w * 0.55, cy - hh, w * 1.1, hh * 2.0))
            p.setBrush(QBrush(QColor("#ff8fa3")))
            p.setPen(Qt.NoPen)
            p.drawEllipse(QRectF(cx - w * 0.3, cy + hh * 0.25, w * 0.6, hh * 0.5))
        elif viseme == "E":
            p.drawEllipse(QRectF(cx - w * 0.62, cy - hh * 0.7, w * 1.25, hh * 1.35))
        elif viseme == "I":
            p.drawEllipse(QRectF(cx - w * 0.72, cy - hh * 0.55, w * 1.45, hh * 1.05))
        elif viseme == "O":
            p.drawEllipse(QRectF(cx - w * 0.44, cy - hh * 0.85, w * 0.9, hh * 1.7))
        elif viseme == "U":
            p.drawEllipse(QRectF(cx - w * 0.3, cy - hh * 0.7, w * 0.6, hh * 1.35))
        p.end()
        out[viseme] = img
    return out


def eye_shapes(size: int = 120, color: str = "#20222c") -> dict[str, QImage]:
    out: dict[str, QImage] = {}
    for name, openness in (("Open", 1.0), ("Half", 0.5), ("Closed", 0.06)):
        img = new_image((size, size))
        p = _qpainter(img)
        p.setBrush(QBrush(_shade(QColor("#fffdf7"), 1.0)))
        p.setPen(QPen(QColor("#cfc6b5"), max(1.5, size * 0.02)))
        p.drawEllipse(QRectF(size * 0.05, size * 0.15, size * 0.9, size * 0.7))
        p.setBrush(QBrush(QColor(color)))
        p.setPen(Qt.NoPen)
        r = size * 0.18 * openness
        p.drawEllipse(QPointF(size * 0.5, size * 0.5), size * 0.19, max(size * 0.02, r))
        p.setBrush(QBrush(QColor("#ffffff")))
        p.drawEllipse(QPointF(size * 0.56, size * 0.44), size * 0.05, size * 0.05 * openness)
        p.end()
        out[name] = img
    return out


# --------------------------------------------------------------------------
# backgrounds & props
# --------------------------------------------------------------------------
BACKGROUND_KINDS = ["Gradient", "Street", "House", "Room", "School", "Beach", "Forest",
                    "Space", "Stage", "Sky", "Office", "City Night"]


def background(kind: str, size: tuple[int, int] = (1920, 1080),
               palette_name: str = "Cartoon Bright") -> QImage:
    cols = [QColor(c) for c in palette(palette_name)]
    img = new_image(size)
    p = _qpainter(img)
    w, h = img.width(), img.height()
    horizon = h * 0.62
    sky_map = {
        "Gradient": ("#4a6cf7", "#b8c6ff"),
        "Street": ("#8ab6d6", "#dfe9f3"),
        "House": ("#ffd8a8", "#fff3e0"),
        "Room": ("#e8d9c0", "#f6efe4"),
        "School": ("#bfe3ff", "#eaf6ff"),
        "Beach": ("#59c1f0", "#ffe9b0"),
        "Forest": ("#6cc24a", "#d9f2c4"),
        "Space": ("#0b0b1f", "#2a1b52"),
        "Stage": ("#1a0d24", "#4a1f5c"),
        "Sky": ("#8fd3ff", "#e8f6ff"),
        "Office": ("#c9d6e2", "#eef3f8"),
        "City Night": ("#0b1030", "#3b1f5c"),
    }
    top, bottom = sky_map.get(kind, sky_map["Gradient"])
    grad = QLinearGradient(0, 0, 0, h)
    grad.setColorAt(0.0, QColor(top))
    grad.setColorAt(1.0, QColor(bottom))
    p.fillRect(img.rect(), QBrush(grad))

    def sun(cx: float, cy: float, r: float, col: str, alpha: int = 90) -> None:
        g = QRadialGradient(QPointF(cx, cy), r * 2.6)
        c = QColor(col)
        c.setAlpha(alpha)
        g.setColorAt(0.0, c)
        c2 = QColor(col)
        c2.setAlpha(0)
        g.setColorAt(1.0, c2)
        p.setPen(Qt.NoPen)
        p.setBrush(QBrush(g))
        p.drawEllipse(QPointF(cx, cy), r * 2.6, r * 2.6)
        p.setBrush(QBrush(QColor(col)))
        p.drawEllipse(QPointF(cx, cy), r, r)

    def cloud(cx: float, cy: float, s: float, alpha: int = 220) -> None:
        c = QColor("#ffffff")
        c.setAlpha(alpha)
        p.setBrush(QBrush(c))
        p.setPen(Qt.NoPen)
        for dx, dy, rr in ((0, 0, 1.0), (0.7, 0.12, 0.78), (-0.75, 0.16, 0.72), (0.3, -0.32, 0.6)):
            p.drawEllipse(QPointF(cx + dx * s, cy + dy * s), s * rr, s * rr * 0.78)

    def ground(col: str) -> None:
        p.setPen(Qt.NoPen)
        p.setBrush(QBrush(QColor(col)))
        p.drawRect(QRectF(0, horizon, w, h - horizon))

    if kind in ("Beach",):
        ground("#f2d9a0")
        p.setBrush(QBrush(QColor("#2fb7d4")))
        p.drawRect(QRectF(0, horizon - h * 0.10, w, h * 0.10))
        sun(w * 0.78, h * 0.20, h * 0.08, "#fff0a8")
        cloud(w * 0.24, h * 0.16, h * 0.05)
    elif kind in ("Forest",):
        ground("#7bb661")
        sun(w * 0.2, h * 0.16, h * 0.07, "#fff6c2", 70)
        for i, x in enumerate((0.08, 0.24, 0.46, 0.68, 0.86)):
            trunk_w = w * 0.03
            p.setBrush(QBrush(QColor("#8d6748")))
            p.setPen(Qt.NoPen)
            p.drawRect(QRectF(w * x, horizon - h * 0.26, trunk_w, h * 0.3))
            crown = QColor(cols[0] if i % 2 else "#3f8f43")
            p.setBrush(QBrush(_shade(crown, 1.0)))
            p.drawEllipse(QPointF(w * x + trunk_w / 2, horizon - h * 0.3), h * 0.11, h * 0.10)
    elif kind in ("Street", "City Night"):
        night = kind == "City Night"
        ground("#2b2f3a" if night else "#6b7280")
        for i, x in enumerate((0.06, 0.19, 0.33, 0.52, 0.68, 0.84)):
            bw = w * 0.11
            bh = h * (0.22 + 0.06 * ((i * 7) % 4))
            col = "#141a33" if night else ("#8f9aa8" if i % 2 else "#7b8695")
            p.setBrush(QBrush(QColor(col)))
            p.setPen(Qt.NoPen)
            p.drawRect(QRectF(w * x, horizon - bh, bw, bh))
            for r in range(3):
                for c in range(3):
                    lit = ((i + r + c) % 3 == 0) if night else False
                    colour = QColor("#ffe680") if lit else QColor("#3c4455" if night else "#5f6a78")
                    p.setBrush(QBrush(colour))
                    p.drawRect(QRectF(w * x + bw * (0.14 + c * 0.28), horizon - bh + bh * (0.14 + r * 0.26),
                                      bw * 0.16, bh * 0.12))
        if night:
            sun(w * 0.82, h * 0.14, h * 0.05, "#fff3c4", 120)
        ground("#3a3f4c" if night else "#7f8797")
    elif kind in ("Room", "Office", "House"):
        ground("#c9a27b" if kind == "House" else "#b98b5e")
        p.setPen(Qt.NoPen)
        p.setBrush(QBrush(QColor("#8f6a4a")))
        p.drawRect(QRectF(0, horizon + h * 0.12, w, h * 0.05))
        p.setBrush(QBrush(QColor("#6c8ebf")))
        p.drawRect(QRectF(w * 0.66, horizon - h * 0.44, w * 0.26, h * 0.42))
        p.setBrush(QBrush(QColor("#eaf3ff")))
        p.drawRect(QRectF(w * 0.68, horizon - h * 0.42, w * 0.22, h * 0.38))
        p.setPen(QPen(QColor("#4a6d99"), 3))
        p.drawLine(QPointF(w * 0.79, horizon - h * 0.42), QPointF(w * 0.79, horizon - h * 0.04))
        p.setPen(Qt.NoPen)
    elif kind in ("School",):
        ground("#8bc34a")
        p.setBrush(QBrush(QColor("#e8dcc0")))
        p.drawRect(QRectF(w * 0.08, horizon - h * 0.4, w * 0.6, h * 0.4))
        p.setBrush(QBrush(QColor("#b03a3a")))
        p.drawRect(QRectF(w * 0.08, horizon - h * 0.46, w * 0.6, h * 0.07))
        p.setBrush(QBrush(QColor("#5b8bd0")))
        for i in range(4):
            p.drawRect(QRectF(w * (0.14 + i * 0.13), horizon - h * 0.3, w * 0.08, h * 0.12))
        cloud(w * 0.82, h * 0.16, h * 0.05)
    elif kind in ("Space",):
        p.setPen(Qt.NoPen)
        import random as _r
        rng = _r.Random(7)
        for _ in range(220):
            x = rng.random() * w
            y = rng.random() * h * 0.9
            r = rng.random() * 2.4 + 0.6
            c = QColor(255, 255, 255, rng.randint(90, 255))
            p.setBrush(QBrush(c))
            p.drawEllipse(QPointF(x, y), r, r)
        sun(w * 0.24, h * 0.3, h * 0.09, "#9ad8ff", 130)
        p.setBrush(QBrush(QColor("#3b2a6b")))
        p.drawEllipse(QPointF(w * 0.7, horizon + h * 0.05), w * 0.24, h * 0.1)
    elif kind in ("Stage",):
        p.setPen(Qt.NoPen)
        g = QRadialGradient(QPointF(w * 0.5, h * 0.1), w * 0.6)
        g.setColorAt(0.0, QColor(255, 240, 200, 90))
        g.setColorAt(1.0, QColor(0, 0, 0, 0))
        p.setBrush(QBrush(g))
        p.drawRect(img.rect())
        ground("#6b3f8f")
        p.setBrush(QBrush(QColor(30, 10, 40, 170)))
        p.drawRect(QRectF(0, 0, w, h * 0.16))
    else:
        ground(_shade(cols[2], 1.05).name())
        cloud(w * 0.22, h * 0.2, h * 0.05)
        cloud(w * 0.72, h * 0.14, h * 0.045)
        sun(w * 0.85, h * 0.18, h * 0.06, "#fff0a8", 80)
    p.end()
    return img


PROP_KINDS = ["Chair", "Table", "Ball", "Tree", "Cloud", "Star", "Heart", "Box", "Arrow",
              "Sign", "Book", "Flower", "Rock", "Balloon"]


def prop(kind: str, size: float = 240.0, palette_name: str = "Cartoon Bright") -> QImage:
    cols = [QColor(c) for c in palette(palette_name)]
    s = int(size)
    img = new_image((s, s))
    p = _qpainter(img)
    col = cols[3]
    outline = QPen(_shade(col, 0.6), max(1.5, s * 0.012))
    p.setPen(outline)
    if kind == "Chair":
        p.setBrush(QBrush(cols[4]))
        p.drawRoundedRect(QRectF(s * 0.2, s * 0.12, s * 0.6, s * 0.16), s * 0.04, s * 0.04)
        wooden = QColor("#c98b52")
        p.setBrush(QBrush(wooden))
        p.drawRoundedRect(QRectF(s * 0.18, s * 0.3, s * 0.64, s * 0.14), s * 0.03, s * 0.03)
        for x in (0.2, 0.76):
            p.drawRoundedRect(QRectF(s * x, s * 0.42, s * 0.08, s * 0.46), s * 0.02, s * 0.02)
        for x in (0.28, 0.68):
            p.drawRoundedRect(QRectF(s * x, s * 0.28, s * 0.06, s * 0.2), s * 0.02, s * 0.02)
    elif kind == "Table":
        p.setBrush(QBrush(QColor("#c98b52")))
        p.drawRoundedRect(QRectF(s * 0.08, s * 0.3, s * 0.84, s * 0.1), s * 0.03, s * 0.03)
        for x in (0.16, 0.78):
            p.drawRoundedRect(QRectF(s * x, s * 0.4, s * 0.07, s * 0.48), s * 0.02, s * 0.02)
    elif kind == "Ball":
        g = QRadialGradient(QPointF(s * 0.38, s * 0.34), s * 0.7)
        g.setColorAt(0.0, _shade(cols[0], 1.25))
        g.setColorAt(1.0, _shade(cols[0], 0.75))
        p.setBrush(QBrush(g))
        p.drawEllipse(QRectF(s * 0.1, s * 0.1, s * 0.8, s * 0.8))
        p.setBrush(Qt.NoBrush)
        p.setPen(QPen(_shade(cols[0], 0.6), s * 0.03))
        p.drawArc(QRectF(s * 0.1, s * 0.2, s * 0.8, s * 0.5), 20 * 16, 140 * 16)
    elif kind == "Tree":
        p.setBrush(QBrush(QColor("#8d6748")))
        p.setPen(Qt.NoPen)
        p.drawRect(QRectF(s * 0.44, s * 0.5, s * 0.12, s * 0.44))
        p.setBrush(QBrush(_shade(cols[2], 1.0)))
        for dx, dy, r in ((0.0, -0.06, 0.3), (-0.18, 0.06, 0.22), (0.2, 0.05, 0.24)):
            p.drawEllipse(QPointF(s * (0.5 + dx), s * (0.42 + dy)), s * r, s * r * 0.9)
    elif kind == "Cloud":
        p.setPen(Qt.NoPen)
        p.setBrush(QBrush(QColor(255, 255, 255, 230)))
        for dx, dy, r in ((0, 0, 0.28), (0.22, 0.05, 0.22), (-0.24, 0.06, 0.2)):
            p.drawEllipse(QPointF(s * (0.5 + dx), s * (0.5 + dy)), s * r, s * r * 0.8)
    elif kind in ("Star", "Heart", "Flower"):
        p.setBrush(QBrush(cols[1]))
        p.setPen(QPen(_shade(cols[1], 0.6), s * 0.02))
        if kind == "Star":
            path = QPainterPath()
            for i in range(10):
                ang = -math.pi / 2 + i * math.pi / 5
                r = s * (0.44 if i % 2 == 0 else 0.19)
                pt = QPointF(s / 2 + math.cos(ang) * r, s / 2 + math.sin(ang) * r)
                path.moveTo(pt) if i == 0 else path.lineTo(pt)
            path.closeSubpath()
            p.drawPath(path)
        elif kind == "Heart":
            path = QPainterPath()
            path.moveTo(s * 0.5, s * 0.86)
            path.cubicTo(s * 0.02, s * 0.5, s * 0.2, s * 0.1, s * 0.5, s * 0.34)
            path.cubicTo(s * 0.8, s * 0.1, s * 0.98, s * 0.5, s * 0.5, s * 0.86)
            p.drawPath(path)
        else:
            for i in range(6):
                ang = i * math.pi / 3
                p.drawEllipse(QPointF(s / 2 + math.cos(ang) * s * 0.2,
                                      s / 2 + math.sin(ang) * s * 0.2), s * 0.19, s * 0.19)
            p.setBrush(QBrush(cols[1]))
            p.drawEllipse(QPointF(s / 2, s / 2), s * 0.12, s * 0.12)
    elif kind == "Arrow":
        p.setBrush(QBrush(cols[1]))
        p.setPen(Qt.NoPen)
        path = QPainterPath()
        path.moveTo(s * 0.1, s * 0.4)
        path.lineTo(s * 0.55, s * 0.4)
        path.lineTo(s * 0.55, s * 0.2)
        path.lineTo(s * 0.9, s * 0.5)
        path.lineTo(s * 0.55, s * 0.8)
        path.lineTo(s * 0.55, s * 0.6)
        path.lineTo(s * 0.1, s * 0.6)
        path.closeSubpath()
        p.drawPath(path)
    elif kind == "Balloon":
        p.setBrush(QBrush(cols[0]))
        p.setPen(QPen(_shade(cols[0], 0.6), s * 0.015))
        p.drawEllipse(QRectF(s * 0.25, s * 0.08, s * 0.5, s * 0.6))
        p.setPen(QPen(QColor("#8d6748"), s * 0.02))
        p.drawLine(QPointF(s * 0.5, s * 0.68), QPointF(s * 0.5, s * 0.94))
    else:  # Box / Book / Rock / Sign
        p.setBrush(QBrush(cols[4] if kind == "Box" else cols[2]))
        p.drawRoundedRect(QRectF(s * 0.18, s * 0.24, s * 0.64, s * 0.56), s * 0.05, s * 0.05)
        p.setPen(QPen(_shade(cols[5], 0.9), s * 0.02))
        p.drawLine(QPointF(s * 0.18, s * 0.44), QPointF(s * 0.82, s * 0.44))
    p.end()
    return img


def title_card(text: str, size: tuple[int, int], background_image: QImage | None = None,
               color: str = "#ffffff", subtitle: str = "", font_size: int = 96) -> QImage:
    img = QImage(size[0], size[1], QImage.Format_ARGB32_Premultiplied)
    if background_image is not None:
        img = background_image.scaled(size[0], size[1], Qt.IgnoreAspectRatio,
                                      Qt.SmoothTransformation)
    else:
        img.fill(QColor("#12141c"))
    p = _qpainter(img)
    f = QFont("Segoe UI", font_size, QFont.Bold)
    p.setFont(f)
    p.setPen(QPen(QColor(color)))
    rect = QRectF(0, size[1] * 0.36, size[0], size[1] * 0.24)
    p.drawText(rect, Qt.AlignCenter, text)
    if subtitle:
        f2 = QFont("Segoe UI", max(14, font_size // 3))
        p.setFont(f2)
        c = QColor(color)
        c.setAlpha(200)
        p.setPen(QPen(c))
        p.drawText(QRectF(0, size[1] * 0.62, size[0], size[1] * 0.16), Qt.AlignCenter, subtitle)
    p.end()
    return img


_ = field
