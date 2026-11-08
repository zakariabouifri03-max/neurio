"""Shared image helpers (Pillow-based, CPU only)."""

from __future__ import annotations

from io import BytesIO
from typing import Optional

from PIL import Image, ImageDraw, ImageFilter

MAX_DIMENSION = 2048


def load_image(data: bytes) -> Image.Image:
    img = Image.open(BytesIO(data))
    img.load()
    return img


def to_rgba(img: Image.Image) -> Image.Image:
    return img.convert("RGBA")


def constrain(img: Image.Image, max_edge: int = MAX_DIMENSION) -> Image.Image:
    w, h = img.size
    scale = min(1.0, max_edge / max(w, h))
    if scale < 1.0:
        img = img.resize((max(1, int(w * scale)), max(1, int(h * scale))), Image.LANCZOS)
    return img


def remove_uniform_background(img: Image.Image, tolerance: int = 28) -> Image.Image:
    """Make near-uniform edge background transparent (works for most product photos
    with solid white/black backdrops). Returns RGBA image."""
    rgba = to_rgba(img)
    w, h = rgba.size
    pixels = rgba.load()

    # Edge color sampled from the four corners.
    samples = [pixels[0, 0], pixels[w - 1, 0], pixels[0, h - 1], pixels[w - 1, h - 1]]
    r = sum(s[0] for s in samples) // len(samples)
    g = sum(s[1] for s in samples) // len(samples)
    b = sum(s[2] for s in samples) // len(samples)

    def close(px) -> bool:
        return (
            abs(px[0] - r) <= tolerance
            and abs(px[1] - g) <= tolerance
            and abs(px[2] - b) <= tolerance
        )

    # Flood fill from all border pixels (iterative scanline queue).
    alpha = rgba.getchannel("A")
    mask = Image.new("L", (w, h), 0)
    mp = mask.load()
    stack = []
    for x in range(w):
        for y in (0, h - 1):
            if close(pixels[x, y]):
                stack.append((x, y))
    for y in range(h):
        for x in (0, w - 1):
            if close(pixels[x, y]):
                stack.append((x, y))

    while stack:
        x, y = stack.pop()
        if x < 0 or y < 0 or x >= w or y >= h or mp[x, y]:
            continue
        if not close(pixels[x, y]):
            continue
        mp[x, y] = 255
        stack.append((x + 1, y))
        stack.append((x - 1, y))
        stack.append((x, y + 1))
        stack.append((x, y - 1))

    # mask is 255 where background → set alpha to 0 there
    alpha.paste(0, (0, 0), mask)
    rgba.putalpha(alpha)
    return rgba


def autocrop_opaque(img: Image.Image, pad: int = 6) -> Image.Image:
    """Trim transparent margins of an RGBA image."""
    bbox = img.getbbox()
    if not bbox:
        return img
    l, t, r, b = bbox
    l = max(0, l - pad)
    t = max(0, t - pad)
    r = min(img.width, r + pad)
    b = min(img.height, b + pad)
    return img.crop((l, t, r, b))


def feather_alpha(img: Image.Image, radius: int = 3) -> Image.Image:
    """Soften alpha edges to avoid hard cutouts."""
    alpha = img.getchannel("A").filter(ImageFilter.GaussianBlur(radius))
    out = img.copy()
    out.putalpha(alpha)
    return out


def fit_cover(img: Image.Image, box_w: int, box_h: int) -> Image.Image:
    scale = max(box_w / img.width, box_h / img.height)
    nw, nh = max(1, int(img.width * scale)), max(1, int(img.height * scale))
    img = img.resize((nw, nh), Image.LANCZOS)
    x = (nw - box_w) // 2
    y = (nh - box_h) // 2
    return img.crop((x, y, x + box_w, y + box_h))


def encode(img: Image.Image, mimetype: str) -> bytes:
    out = BytesIO()
    fmt = "JPEG" if mimetype in ("image/jpeg", "image/jpg") else "PNG"
    if fmt == "JPEG":
        rgb = Image.new("RGB", img.size, (255, 255, 255))
        rgb.paste(img, (0, 0), img if img.mode == "RGBA" else None)
        rgb.save(out, fmt, quality=92)
    else:
        img.save(out, fmt)
    return out.getvalue()


def estimate_dominant_background(img: Image.Image) -> Optional[tuple]:
    small = img.convert("RGB").resize((8, 8))
    colors = small.getcolors(64)
    if not colors:
        return None
    colors.sort(reverse=True)
    return colors[0][1]


def draw_label(img: Image.Image, text: str) -> Image.Image:
    """Small dev-mode label bottom-right."""
    draw = ImageDraw.Draw(img)
    x0, y0 = img.width - 150, img.height - 30
    draw.rounded_rectangle((x0, y0, x0 + 140, y0 + 22), radius=8, fill=(0, 0, 0, 160))
    draw.text((x0 + 10, y0 + 4), text, fill=(255, 255, 255, 230))
    return img
