"""Photo editing operations built on Pillow.

Everything here is a real pixel operation and is non-destructive at the layer
level: the photo editor keeps layers as RGBA images and composites them, and
adjustments can be applied to a copy so the original layer is preserved.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageFont, ImageOps

from ..core.logging_setup import get_logger

log = get_logger("image_ops")

SUPPORTED_LOAD = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".tiff", ".tif", ".gif"}


class ImageOpError(RuntimeError):
    pass


def load_rgba(path: str | Path) -> Image.Image:
    p = Path(path)
    if not p.is_file():
        raise FileNotFoundError(p)
    if p.suffix.lower() not in SUPPORTED_LOAD:
        raise ImageOpError(f"Unsupported image type: {p.suffix}")
    img = Image.open(p)
    img.load()
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    return img


def save_image(img: Image.Image, path: str | Path, quality: int = 92) -> Path:
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    fmt = p.suffix.lower().lstrip(".")
    out = img
    if fmt in {"jpg", "jpeg"}:
        out = img.convert("RGB")
        out.save(p, quality=quality, optimize=True)
    elif fmt == "webp":
        out.save(p, quality=quality, method=4)
    elif fmt in {"png", "bmp", "tiff", "tif"}:
        out.save(p)
    else:
        raise ImageOpError(f"Unsupported export format: .{fmt}")
    return p


# ---------------------------------------------------------------------------
# Geometry
# ---------------------------------------------------------------------------

def resize(img: Image.Image, width: int, height: int, keep_aspect: bool = True) -> Image.Image:
    if width <= 0 or height <= 0:
        raise ImageOpError("width/height must be positive")
    if keep_aspect:
        out = img.copy()
        out.thumbnail((width, height), Image.LANCZOS)
        return out
    return img.resize((width, height), Image.LANCZOS)


def crop(img: Image.Image, box: tuple[int, int, int, int]) -> Image.Image:
    x0, y0, x1, y1 = box
    if x1 <= x0 or y1 <= y0:
        raise ImageOpError("invalid crop box")
    return img.crop(box)


def rotate(img: Image.Image, angle: float) -> Image.Image:
    return img.rotate(-angle, expand=True, resample=Image.BICUBIC)


def flip(img: Image.Image, horizontal: bool) -> Image.Image:
    return img.transpose(Image.FLIP_LEFT_RIGHT if horizontal else Image.FLIP_TOP_BOTTOM)


def canvas_resize(img: Image.Image, width: int, height: int,
                  background: str = "#ffffff") -> Image.Image:
    out = Image.new("RGBA", (width, height), background)
    out.paste(img, ((width - img.width) // 2, (height - img.height) // 2), img)
    return out


# ---------------------------------------------------------------------------
# Colour / tone adjustments (values centred on 1.0 or 0.0)
# ---------------------------------------------------------------------------

def adjust(img: Image.Image, *, brightness: float = 1.0, contrast: float = 1.0,
           saturation: float = 1.0, hue: float = 0.0, gamma: float = 1.0,
           sharpness: float = 1.0) -> Image.Image:
    out = img
    if brightness != 1.0:
        out = ImageEnhance.Brightness(out).enhance(brightness)
    if contrast != 1.0:
        out = ImageEnhance.Contrast(out).enhance(contrast)
    if saturation != 1.0:
        out = ImageEnhance.Color(out).enhance(saturation)
    if hue != 0.0:
        rgb = out.convert("RGB")
        rgb = rgb.convert("HSV")
        h, s, v = rgb.split()
        h = h.point(lambda i: int((i + hue * 255 / 360) % 256))
        rgb = Image.merge("HSV", (h, s, v)).convert("RGB")
        out = Image.merge("RGBA", (*rgb.split(), out.split()[3]))
    if gamma != 1.0 and gamma > 0:
        inv = 1.0 / gamma
        lut = [int(((i / 255.0) ** inv) * 255) for i in range(256)]
        rgb = out.convert("RGB").point(lut * 3)
        out = Image.merge("RGBA", (*rgb.split(), out.split()[3]))
    if sharpness != 1.0:
        out = ImageEnhance.Sharpness(out).enhance(sharpness)
    return out


def curves_adjust(img: Image.Image, curve: list[tuple[int, int]]) -> Image.Image:
    """Apply a tonal curve given as control points [(in, out), …]."""
    if len(curve) < 2:
        raise ImageOpError("curve needs at least two points")
    pts = sorted(curve)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    lut = []
    for x in range(256):
        if x <= xs[0]:
            lut.append(ys[0])
        elif x >= xs[-1]:
            lut.append(ys[-1])
        else:
            for i in range(len(xs) - 1):
                if xs[i] <= x <= xs[i + 1]:
                    f = (x - xs[i]) / max(1, xs[i + 1] - xs[i])
                    lut.append(int(ys[i] + f * (ys[i + 1] - ys[i])))
                    break
    rgb = img.convert("RGB").point(lut * 3)
    return Image.merge("RGBA", (*rgb.split(), img.split()[3]))


# ---------------------------------------------------------------------------
# Filters
# ---------------------------------------------------------------------------

FILTERS = {
    "blur": lambda im: im.filter(ImageFilter.GaussianBlur(2)),
    "sharpen": lambda im: im.filter(ImageFilter.UnsharpMask(radius=2, percent=120)),
    "contour": lambda im: _keep_alpha(im.filter(ImageFilter.CONTOUR), im),
    "edge": lambda im: _keep_alpha(im.filter(ImageFilter.FIND_EDGES), im),
    "emboss": lambda im: _keep_alpha(im.filter(ImageFilter.EMBOSS), im),
    "smooth": lambda im: im.filter(ImageFilter.SMOOTH_MORE),
    "grayscale": lambda im: _keep_alpha(ImageOps.grayscale(im.convert("RGB")).convert("RGB"), im),
    "sepia": lambda im: _sepia(im),
    "invert": lambda im: _invert(im),
    "vignette": lambda im: _vignette(im),
    "posterize": lambda im: _keep_alpha(ImageOps.posterize(im.convert("RGB"), 4), im),
    "cool": lambda im: _tint(im, (0, 20, 40)),
    "warm": lambda im: _tint(im, (35, 15, -10)),
}


def _keep_alpha(processed_rgb, original_rgba):
    return Image.merge("RGBA", (*processed_rgb.convert("RGB").split(),
                                 original_rgba.split()[3]))


def _sepia(img):
    rgb = img.convert("RGB")
    r, g, b = rgb.split()
    gray = ImageOps.grayscale(rgb)
    rr = gray.point(lambda i: min(255, int(i * 1.07 + 40)))
    gg = gray.point(lambda i: min(255, int(i * 1.0)))
    bb = gray.point(lambda i: max(0, int(i * 0.85)))
    return Image.merge("RGBA", (rr, gg, bb, img.split()[3]))


def _invert(img):
    rgb = ImageOps.invert(img.convert("RGB"))
    return Image.merge("RGBA", (*rgb.split(), img.split()[3]))


def _tint(img, delta):
    rgb = img.convert("RGB")
    lut = []
    for ch in range(3):
        d = delta[ch]
        lut.append([max(0, min(255, i + d)) for i in range(256)])
    r, g, b = rgb.split()
    r = r.point(lut[0]); g = g.point(lut[1]); b = b.point(lut[2])
    return Image.merge("RGBA", (r, g, b, img.split()[3]))


def _vignette(img, strength: float = 0.6):
    w, h = img.size
    mask = Image.new("L", (w, h), 255)
    draw = ImageDraw.Draw(mask)
    for i in range(int(min(w, h) * 0.2)):
        shade = int(255 * (1 - strength * (1 - i / (min(w, h) * 0.2))))
        draw.ellipse([i, i, w - i, h - i], outline=shade)
    mask = mask.filter(ImageFilter.GaussianBlur(min(w, h) * 0.05))
    black = Image.new("RGBA", (w, h), (0, 0, 0, 255))
    return Image.composite(img, black, mask)


def apply_filter(img: Image.Image, name: str) -> Image.Image:
    fn = FILTERS.get(name)
    if not fn:
        raise ImageOpError(f"Unknown filter: {name}")
    return fn(img)


# ---------------------------------------------------------------------------
# Selection / retouch helpers
# ---------------------------------------------------------------------------

def remove_uniform_background(img: Image.Image, color: tuple[int, int, int],
                             tolerance: int = 32) -> Image.Image:
    """Chroma-style background removal for near-uniform backgrounds.

    This is an honest, local algorithm (no ML model).  It works well on
    studio-style flat backgrounds; complex photos need a real segmentation
    model, which ADZAK exposes via the AI studio when configured.
    """
    if tolerance < 0:
        raise ImageOpError("tolerance must be >= 0")
    rgb = img.convert("RGB")
    data = rgb.load()
    alpha = img.split()[3]
    a = alpha.load()
    w, h = rgb.size
    r0, g0, b0 = color
    for y in range(h):
        for x in range(w):
            r, g, b = data[x, y]
            if abs(r - r0) <= tolerance and abs(g - g0) <= tolerance and abs(b - b0) <= tolerance:
                a[x, y] = 0
    return Image.merge("RGBA", (*rgb.split(), alpha))


def remove_edges_background(img: Image.Image, tolerance: int = 40) -> Image.Image:
    """Flood-fill removal starting from the four image corners."""
    rgb = img.convert("RGB")
    w, h = rgb.size
    data = rgb.load()
    seeds = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
    ref_colors = [data[x, y] for x, y in seeds]
    mask = [[False] * w for _ in range(h)]
    stack = list(seeds)
    while stack:
        x, y = stack.pop()
        if not (0 <= x < w and 0 <= y < h) or mask[y][x]:
            continue
        r, g, b = data[x, y]
        near = any(abs(r - rr) <= tolerance and abs(g - gg) <= tolerance
                   and abs(b - bb) <= tolerance for rr, gg, bb in ref_colors)
        if not near:
            continue
        mask[y][x] = True
        stack += [(x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)]
    alpha = Image.new("L", (w, h), 255)
    ap = alpha.load()
    for y in range(h):
        for x in range(w):
            if mask[y][x]:
                ap[x, y] = 0
    return Image.merge("RGBA", (*rgb.split(), alpha))


# ---------------------------------------------------------------------------
# Text & shapes (used by design studio and photo editor)
# ---------------------------------------------------------------------------

def draw_text(img: Image.Image, text: str, x: int, y: int, size: int = 48,
              color: str = "#ffffff", outline: int = 0, outline_color: str = "#000000",
              font_path: str | None = None) -> Image.Image:
    try:
        font = ImageFont.truetype(font_path, size) if font_path else ImageFont.truetype("arial.ttf", size)
    except OSError:
        font = ImageFont.load_default()
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    if outline > 0:
        draw.text((x, y), text, font=font, fill=color,
                  stroke_width=outline, stroke_fill=outline_color)
    else:
        draw.text((x, y), text, font=font, fill=color)
    return Image.alpha_composite(img, layer)


def text_size(text: str, size: int, font_path: str | None = None) -> tuple[int, int]:
    try:
        font = ImageFont.truetype(font_path, size) if font_path else ImageFont.truetype("arial.ttf", size)
    except OSError:
        font = ImageFont.load_default()
    bbox = font.getbbox(text)
    return bbox[2] - bbox[0], bbox[3] - bbox[1]


def draw_shape(img: Image.Image, shape: str, box: tuple[int, int, int, int],
               fill: str = "#ffffff", outline: str | None = None,
               width: int = 2) -> Image.Image:
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(layer)
    kw = {"fill": fill}
    if outline:
        kw["outline"] = outline
        kw["width"] = width
    if shape == "rect":
        draw.rectangle(box, **kw)
    elif shape == "ellipse":
        draw.ellipse(box, **kw)
    elif shape == "line":
        draw.line(box, fill=outline or fill, width=width)
    elif shape == "triangle":
        x0, y0, x1, y1 = box
        draw.polygon([(x0, y1), ((x0 + x1) // 2, y0), (x1, y1)], **kw)
    else:
        raise ImageOpError(f"Unknown shape: {shape}")
    return Image.alpha_composite(img, layer)


# ---------------------------------------------------------------------------
# Composition helpers
# ---------------------------------------------------------------------------

def composite_layers(layers: list[tuple[Image.Image, int, int, float]],
                     width: int, height: int, background: str = "#ffffff") -> Image.Image:
    """Composite [(image, x, y, opacity)] bottom-up onto a background."""
    canvas = Image.new("RGBA", (width, height), background)
    for img, x, y, opacity in layers:
        tile = img
        if opacity < 1.0:
            r, g, b, a = tile.split()
            a = a.point(lambda v: int(v * max(0.0, min(1.0, opacity))))
            tile = Image.merge("RGBA", (r, g, b, a))
        canvas.alpha_composite(tile, dest=(int(x), int(y)))
    return canvas


def make_checker_preview(img: Image.Image, square: int = 12) -> Image.Image:
    """Flatten onto a grey checkerboard to preview transparency."""
    w, h = img.size
    base = Image.new("RGBA", (w, h), (220, 220, 220, 255))
    draw = ImageDraw.Draw(base)
    for y in range(0, h, square):
        for x in range(0, w, square):
            if ((x // square) + (y // square)) % 2:
                draw.rectangle([x, y, x + square, y + square], fill=(190, 190, 190, 255))
    base.alpha_composite(img)
    return base
