"""Shared helpers for adzakART's transparent-PNG pipeline.

Used by clean-background.py (remove the backdrop) and check-transparency.py
(prove the backdrop is gone before anything is uploaded for sale).

No numpy, no AI model: pure Pillow, so it runs on any machine with
`pip install Pillow`. Tuned for flat / near-flat backdrops — which is what
the studio's artwork is drawn on.
"""

from __future__ import annotations

import os
from collections import Counter

from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageEnhance

SUPPORTED = (".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ".bmp")
CHECKER_A = (232, 226, 214)
CHECKER_B = (248, 244, 236)


# --------------------------------------------------------------------------
# small utilities
# --------------------------------------------------------------------------
def human_bytes(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024.0
    return f"{n:.1f} GB"


def list_images(folder: str) -> list[str]:
    if os.path.isfile(folder):
        return [folder]
    out = []
    for name in sorted(os.listdir(folder)):
        if name.lower().endswith(SUPPORTED):
            out.append(os.path.join(folder, name))
    return out


def flatten(img: Image.Image, bg=(255, 255, 255)) -> Image.Image:
    """Composite RGBA onto a solid colour so palette/mode maths is simple."""
    if img.mode in ("RGBA", "LA"):
        base = Image.new("RGBA", img.size, bg + (255,))
        base.alpha_composite(img.convert("RGBA"))
        return base.convert("RGB")
    return img.convert("RGB")


# --------------------------------------------------------------------------
# backdrop estimation + removal
# --------------------------------------------------------------------------
def estimate_backdrop(img: Image.Image, sample: int = 6) -> tuple[int, int, int]:
    """Most common colour along the outer border — robust to JPEG noise."""
    rgb = flatten(img)
    w, h = rgb.size
    px = rgb.load()
    votes: Counter = Counter()
    step = max(1, min(w, h) // 240)
    for x in range(0, w, step):
        for y in (0, 1, 2, h - 3, h - 2, h - 1):
            if 0 <= y < h:
                votes[px[x, y]] += 1
    for y in range(0, h, step):
        for x in (0, 1, 2, w - 3, w - 2, w - 1):
            if 0 <= x < w:
                votes[px[x, y]] += 1
    # quantise to 8 levels per channel so near-identical border pixels agree
    grouped: Counter = Counter()
    for colour, count in votes.items():
        key = tuple(c // 8 * 8 for c in colour)
        grouped[key] += count
    best = grouped.most_common(1)[0][0]
    # return the average of the exact colours that fall inside that bucket
    near = [c for c in votes if all(abs(c[i] - best[i]) <= 12 for i in range(3))]
    if not near:
        return best
    n = len(near)
    return tuple(int(round(sum(c[i] for c in near) / n)) for i in range(3))


def cut_backdrop(
    img: Image.Image,
    tolerance: int = 14,
    feather: float = 0.8,
    despill: bool = True,
    choke: int = 0,
    dust: int = 8,
) -> tuple[Image.Image, tuple[int, int, int], dict]:
    """Remove the border-connected backdrop and return an RGBA cut-out.

    tolerance : percent (0-40) of colour distance accepted as backdrop.
    feather   : alpha blur radius in px — smooths the cut edge.
    despill   : un-multiply the backdrop colour out of anti-aliased edge pixels.
    choke     : shrink the alpha edge by N px (kills a stubborn 1px halo).
    dust      : alpha below this value is dropped to zero (removes edge specks).

    Only *border-connected* pixels are removed, so white details inside the
    artwork (eyes, highlights, letter counters) are preserved.
    """
    src = img.convert("RGBA")
    flat = flatten(src)
    bg = estimate_backdrop(flat)

    work = flat.copy()
    sentinel = (255, 0, 255)
    if bg == sentinel:
        sentinel = (0, 255, 0)
    thresh = max(1, int(round(tolerance * 7.65)))  # 0-100% -> channel-sum delta

    w, h = work.size
    mid_x, mid_y = w // 2, h // 2
    seeds = [
        (0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1),
        (mid_x, 0), (mid_x, h - 1), (0, mid_y), (w - 1, mid_y),
    ]
    for seed in seeds:
        if work.getpixel(seed) == sentinel:
            continue
        try:
            ImageDraw.floodfill(work, seed, sentinel, thresh=thresh)
        except Exception:
            continue

    mask = Image.new("L", (w, h), 0)
    mpx = mask.load()
    spx = work.load()
    for y in range(h):
        for x in range(w):
            mpx[x, y] = 0 if spx[x, y] == sentinel else 255

    # Any pixel still matching the backdrop but isolated from the border (an
    # enclosed hole) is deliberately left opaque — safer than eating artwork.
    if choke > 0:
        mask = mask.filter(ImageFilter.MinFilter(choke * 2 + 1))
    if feather > 0:
        mask = mask.filter(ImageFilter.GaussianBlur(feather))

    alpha = mask
    if dust > 0:
        # Drop barely-visible edge dust: at alpha 2/255 the colour is invisible
        # but it still pollutes the file and can fringe after resizing.
        alpha = alpha.point(lambda v: 0 if v < dust else v)
    if despill:
        # Remove backdrop colour bleeding into semi-transparent edge pixels:
        #   rgb = (rgb - bg * (1 - a)) / a
        rgb = flat.load()
        apx = alpha.load()
        out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        opx = out.load()
        for y in range(h):
            for x in range(w):
                a = apx[x, y]
                if a == 0:
                    continue
                r, g, b = rgb[x, y]
                if a < 255:
                    # un-multiply the backdrop: fg = (rgb - bg*(1-f)) / f
                    # the divisor is floored so near-transparent pixels cannot
                    # explode into garish colours (127,255,0 and friends)
                    f = a / 255.0
                    denom = max(f, 0.35)
                    r = int(max(0, min(255, (r - bg[0] * (1 - f)) / denom)))
                    g = int(max(0, min(255, (g - bg[1] * (1 - f)) / denom)))
                    b = int(max(0, min(255, (b - bg[2] * (1 - f)) / denom)))
                opx[x, y] = (r, g, b, a)
        result = out
    else:
        result = flat.convert("RGBA")
        result.putalpha(alpha)

    stats = summarise(result)
    return result, bg, stats


def bg_lum(bg) -> float:
    return 0.299 * bg[0] + 0.587 * bg[1] + 0.114 * bg[2]


def upscale(result: Image.Image, min_long_edge: int = 3000, sharpen: bool = True) -> Image.Image:
    """Bring a cut-out up to print resolution.

    Uses high-quality Lanczos resampling, then a light unsharp mask so edges
    stay crisp instead of going soft. Never shrinks an image that is already
    big enough.
    """
    w, h = result.size
    longest = max(w, h)
    if longest >= min_long_edge:
        return result
    factor = min_long_edge / float(longest)
    size = (max(1, round(w * factor)), max(1, round(h * factor)))
    big = result.resize(size, Image.LANCZOS)
    if sharpen:
        # mask keys off alpha so the transparent area cannot pick up ringing
        big = big.filter(ImageFilter.UnsharpMask(radius=1.6, percent=90, threshold=2))
    return big


def save_png(result: Image.Image, path: str, dpi: int = 300) -> None:
    """Write a real RGBA PNG with print metadata."""
    out = result.convert("RGBA")
    out.save(path, "PNG", optimize=True, dpi=(dpi, dpi))


def trim(result: Image.Image, pad: int = 6) -> Image.Image:
    """Crop to the visible artwork, keeping a little breathing room."""
    bbox = result.getchannel("A").getbbox()
    if not bbox:
        return result
    l, t, r, b = bbox
    l, t = max(0, l - pad), max(0, t - pad)
    r, b = min(result.width, r + pad), min(result.height, b + pad)
    return result.crop((l, t, r, b))


# --------------------------------------------------------------------------
# quality checks
# --------------------------------------------------------------------------
def summarise(img: Image.Image) -> dict:
    """Numbers that decide whether a file is safe to sell as a cut-out."""
    rgba = img.convert("RGBA")
    w, h = rgba.size
    a = rgba.getchannel("A")
    hist = a.histogram()
    total = w * h
    opaque = hist[255]
    clear = hist[0]
    partial = total - opaque - clear

    corners = [rgba.getpixel(p)[3] for p in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1))]
    edge = []
    for x in range(w):
        edge.append(a.getpixel((x, 0)))
        edge.append(a.getpixel((x, h - 1)))
    for y in range(h):
        edge.append(a.getpixel((0, y)))
        edge.append(a.getpixel((w - 1, y)))
    edge_clear = sum(1 for v in edge if v < 16) / max(1, len(edge))

    bbox = a.getbbox()
    coverage = ((bbox[2] - bbox[0]) * (bbox[3] - bbox[1])) / total if bbox else 0.0

    return {
        "size": (w, h),
        "transparent": clear / total,
        "partial": partial / total,
        "opaque": opaque / total,
        "corners_opaque": sum(1 for v in corners if v > 240),
        "edge_clear": edge_clear,
        "coverage": coverage,
    }


def verdict(stats: dict) -> tuple[bool, list[str]]:
    """Pass/fail plus human reasons. Rules chosen to catch 'white box' files."""
    problems = []
    if stats["transparent"] < 0.03:
        problems.append("almost no transparent pixels — the backdrop is still there")
    if stats["corners_opaque"] > 0:
        problems.append("one or more corners are opaque — likely a boxed/JPEG backdrop")
    if stats["edge_clear"] < 0.35:
        problems.append(f"only {stats['edge_clear']*100:.0f}% of the border is clear")
    if stats["coverage"] < 0.05:
        problems.append("artwork covers under 5% of the canvas — check the cut-out")
    if stats["opaque"] > 0.97:
        problems.append("file is effectively fully opaque")
    return (len(problems) == 0, problems)


def checkerboard(size: tuple[int, int], tile: int = 14) -> Image.Image:
    w, h = size
    board = Image.new("RGB", (w, h), CHECKER_A)
    d = ImageDraw.Draw(board)
    for y in range(0, h, tile):
        for x in range(0, w, tile):
            if ((x // tile) + (y // tile)) % 2:
                d.rectangle([x, y, x + tile - 1, y + tile - 1], fill=CHECKER_B)
    return board


def preview_on_checker(img: Image.Image, max_side: int = 700) -> Image.Image:
    rgba = img.convert("RGBA")
    scale = min(1.0, max_side / max(rgba.size))
    if scale < 1.0:
        rgba = rgba.resize(
            (max(1, int(rgba.width * scale)), max(1, int(rgba.height * scale))),
            Image.LANCZOS,
        )
    board = checkerboard(rgba.size)
    board.paste(rgba, (0, 0), rgba)
    return board


def white_halo_score(img: Image.Image, bg=(255, 255, 255)) -> float:
    """Fraction of edge pixels that are near-white while semi-transparent.

    A high score means the 'white cast' buyers complain about is still there.
    """
    rgba = img.convert("RGBA")
    a = rgba.getchannel("A")
    px = rgba.load()
    w, h = rgba.size
    band = []
    edge_mask = a.filter(ImageFilter.FIND_EDGES).point(lambda v: 255 if v > 24 else 0)
    epx = edge_mask.load()
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            if epx[x, y] and 0 < px[x, y][3] < 235:
                band.append(px[x, y])
    if not band:
        return 0.0
    whiteish = sum(1 for r, g, b, _ in band if min(r, g, b) > 228 and max(r, g, b) - min(r, g, b) < 14)
    return whiteish / len(band)


__all__ = [
    "SUPPORTED", "list_images", "flatten", "estimate_backdrop", "cut_backdrop",
    "trim", "summarise", "verdict", "checkerboard", "preview_on_checker",
    "white_halo_score", "bg_lum", "human_bytes", "upscale", "save_png", "ImageChops",
]
