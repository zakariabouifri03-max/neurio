"""Render title clips to transparent PNGs (fallback when FFmpeg lacks drawtext,
and used by the preview player regardless of backend).
"""
from __future__ import annotations

import hashlib
from pathlib import Path

from PySide6.QtCore import QRectF, Qt
from PySide6.QtGui import (QColor, QFont, QFontDatabase, QImage, QPainter,
                           QTextOption)

from ..core import paths
from ..core.ffmpeg import ffmpeg_supports_filter
from ..core.logging_setup import get_logger

log = get_logger("titles")


def drawtext_available() -> bool:
    return ffmpeg_supports_filter("drawtext")


def _qcolor(value: str, default: str = "#ffffff") -> QColor:
    c = QColor(value or default)
    return c if c.isValid() else QColor(default)


def render_title_png(clip, width: int, height: int) -> str:
    """Paint a title clip onto an RGBA image and return the cached path."""
    tp = clip.text_params
    key_src = repr((tp, width, height, clip.id))
    key = hashlib.sha1(key_src.encode("utf-8", "replace")).hexdigest()[:16]
    out = paths.CACHE_DIR / "titles" / f"title_{key}.png"
    if out.exists():
        return str(out)
    out.parent.mkdir(parents=True, exist_ok=True)

    image = QImage(width, height, QImage.Format.Format_RGBA8888)
    image.fill(Qt.GlobalColor.transparent)
    painter = QPainter(image)
    painter.setRenderHint(QPainter.RenderHint.TextAntialiasing, True)
    font = QFont(str(tp.get("font_family", "Arial")))
    try:
        families = QFontDatabase.families()
        if font.family() not in families and families:
            font.setFamily(families[0])
    except Exception:  # headless / broken fontconfig must not abort rendering
        log.warning("QFontDatabase unavailable; using default font")
    font.setPixelSize(int(tp.get("font_size", 72)))
    font.setBold(bool(tp.get("bold")))
    font.setItalic(bool(tp.get("italic")))
    painter.setFont(font)

    box_w = float(tp.get("box_width", 0.9)) * width
    px, py = float(tp.get("position_x", 0.5)), float(tp.get("position_y", 0.5))
    rect = QRectF(px * width - box_w / 2, py * height - height / 2,
                  box_w, height)
    option = QTextOption()
    align_map = {
        "left": Qt.AlignmentFlag.AlignLeft,
        "right": Qt.AlignmentFlag.AlignRight,
        "center": Qt.AlignmentFlag.AlignHCenter,
    }
    option.setAlignment(align_map.get(tp.get("align", "center"),
                                      Qt.AlignmentFlag.AlignHCenter)
                        | Qt.AlignmentFlag.AlignVCenter)
    option.setWrapMode(QTextOption.WrapMode.WordWrap)

    stroke = int(tp.get("stroke_width", 0))
    if stroke > 0:
        pen = painter.pen()
        pen.setColor(_qcolor(tp.get("stroke_color"), "#000000"))
        painter.setPen(pen)
        for dx in range(-stroke, stroke + 1):
            for dy in range(-stroke, stroke + 1):
                if dx * dx + dy * dy <= stroke * stroke:
                    painter.drawText(rect.translated(dx, dy),
                                     str(tp.get("text", "")), option)
    painter.setPen(_qcolor(tp.get("color"), "#ffffff"))
    painter.drawText(rect, str(tp.get("text", "")), option)
    painter.end()
    image.save(str(out), "PNG")
    return str(out)
