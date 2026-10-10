"""Text rendering with outline, shadow and alignment (used by video titles and design)."""
from __future__ import annotations

import os
import sys
from functools import lru_cache
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

_FONT_CANDIDATES = [
    r"C:\Windows\Fonts\arialbd.ttf", r"C:\Windows\Fonts\arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/Library/Fonts/Arial.ttf",
]


@lru_cache(maxsize=32)
def load_font(size: int, font_path: str = "") -> ImageFont.ImageFont:
    size = max(4, int(size))
    candidates = ([font_path] if font_path else []) + _FONT_CANDIDATES
    for c in candidates:
        if c and Path(c).is_file():
            try:
                return ImageFont.truetype(c, size)
            except OSError:
                continue
    try:
        return ImageFont.load_default(size=size)  # Pillow >= 10.1 scalable default
    except TypeError:
        return ImageFont.load_default()


def hex_to_rgba(color: str, alpha: int = 255) -> tuple[int, int, int, int]:
    c = color.strip().lstrip("#")
    if len(c) == 3:
        c = "".join(ch * 2 for ch in c)
    if len(c) != 6:
        raise ValueError(f"Invalid colour: {color!r}")
    return (int(c[0:2], 16), int(c[2:4], 16), int(c[4:6], 16), alpha)


def render_text(
    text: str,
    *,
    size: int = 64,
    color: str = "#FFFFFF",
    stroke_width: int = 0,
    stroke_color: str = "#000000",
    shadow_offset: tuple[int, int] = (0, 0),
    shadow_color: str = "#000000",
    align: str = "center",
    font_path: str = "",
    max_width: int | None = None,
) -> Image.Image:
    """Return a transparent RGBA image containing the text (multi-line supported)."""
    if not text:
        raise ValueError("Text must not be empty.")
    font = load_font(size, font_path)
    probe = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    bbox = tuple(int(round(v)) for v in probe.multiline_textbbox(
        (0, 0), text, font=font, stroke_width=stroke_width, align=align))
    pad = stroke_width + max(abs(shadow_offset[0]), abs(shadow_offset[1])) + 4
    w = bbox[2] - bbox[0] + 2 * pad
    h = bbox[3] - bbox[1] + 2 * pad
    if max_width and w > max_width:
        w = max_width
    img = Image.new("RGBA", (max(1, w), max(1, h)), (0, 0, 0, 0))
    ox, oy = pad - bbox[0], pad - bbox[1]
    d = ImageDraw.Draw(img)
    if shadow_offset != (0, 0):
        d.multiline_text((ox + shadow_offset[0], oy + shadow_offset[1]), text, font=font,
                         fill=hex_to_rgba(shadow_color), align=align,
                         stroke_width=stroke_width, stroke_fill=hex_to_rgba(shadow_color))
    d.multiline_text((ox, oy), text, font=font, fill=hex_to_rgba(color), align=align,
                     stroke_width=stroke_width, stroke_fill=hex_to_rgba(stroke_color))
    return img


def place_on_canvas(layer: Image.Image, canvas_w: int, canvas_h: int, position: str = "bottom",
                    margin_ratio: float = 0.06) -> Image.Image:
    """Position a text image on a transparent canvas: top, center, bottom or a 'x,y' pair."""
    canvas = Image.new("RGBA", (canvas_w, canvas_h), (0, 0, 0, 0))
    if "," in position:
        x, y = (int(float(v)) for v in position.split(","))
    else:
        x = max(0, (canvas_w - layer.width) // 2)
        margin = int(canvas_h * margin_ratio)
        y = {"top": margin, "center": (canvas_h - layer.height) // 2}.get(
            position, canvas_h - layer.height - margin)
    canvas.alpha_composite(layer, (max(0, x), max(0, y)))
    return canvas


def default_font_path() -> str:
    for c in _FONT_CANDIDATES:
        if Path(c).is_file():
            return c
    return "" if sys.platform != "win32" else os.path.join(os.environ.get("WINDIR", r"C:\Windows"), "Fonts", "arial.ttf")
