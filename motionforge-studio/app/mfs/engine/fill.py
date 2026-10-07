"""Bucket fill / flood fill with gap closing, powered by numpy when available."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QImage

try:  # numpy is bundled with the app, but stay importable without it
    import numpy as np
except Exception:  # pragma: no cover
    np = None  # type: ignore


def _to_array(img: QImage):
    if np is None:
        return None
    if img.format() != QImage.Format_ARGB32_Premultiplied:
        img = img.convertToFormat(QImage.Format_ARGB32_Premultiplied)
    h = img.height()
    bpl = img.bytesPerLine()
    buf = memoryview(img.bits()).tobytes()
    arr = np.frombuffer(buf, dtype=np.uint8).reshape(h, bpl // 4, 4)
    return arr[:, : img.width(), :].copy(), img


def flood_fill(image: QImage, x: int, y: int, color: QColor, tolerance: int = 32,
               gap_close: int = 0, antialias: bool = True, fill_alpha: int = 255,
               sample_all_layers: QImage | None = None) -> QImage | None:
    """Paint-bucket style fill.

    ``sample_all_layers`` lets the user fill based on the visible artwork while
    writing into the current cel (the usual "reference layer" behaviour).
    Returns a new image or ``None`` when numpy is unavailable.
    """
    if np is None:
        return _flood_fill_pure(image, x, y, color, tolerance, gap_close)
    source = sample_all_layers if sample_all_layers is not None else image
    arr, normalized = _to_array(source)
    if arr is None:
        return None
    h, w = arr.shape[:2]
    if not (0 <= x < w and 0 <= y < h):
        return None
    alpha = arr[:, :, 3].astype(np.int16)
    # "closed gaps": treat semi transparent pixels as walls when the user asked
    # for gap closing - a cheap but effective stand-in for real gap detection
    if gap_close > 0:
        solid = alpha > (40 if gap_close >= 2 else 90)
        if gap_close >= 3:
            solid = _dilate(solid, 1)
    else:
        solid = alpha > 8

    target = arr[y, x]
    region = np.zeros((h, w), dtype=bool)
    # BFS on a masked colour distance
    tol = max(1, int(tolerance))
    ref = target.astype(np.int16)
    dist = np.abs(arr.astype(np.int16) - ref[None, None, :]).max(axis=2)
    if solid[y, x]:
        # clicking onto paint: recolour the matching patch (Photoshop style)
        similar = dist <= tol
    elif gap_close > 0:
        # clicking into empty space: flood the empty area, the dilated artwork
        # acts as the wall (that is what closes small gaps in the line art)
        similar = ~solid | (dist <= tol)
    else:
        similar = dist <= tol
    _flood(similar, x, y, region)
    if not region.any():
        return None
    out = image.convertToFormat(QImage.Format_ARGB32_Premultiplied).copy()
    if gap_close > 0:
        region = _dilate(region, gap_close)
    res_arr, _ = _to_array(out)
    if res_arr is None:
        return None
    c = np.array([color.blue(), color.green(), color.red(),
                  int(color.alpha() * fill_alpha / 255)], dtype=np.uint8)
    res_arr[region] = c
    return _array_to_image(res_arr, out)


def _flood(mask, x: int, y: int, out) -> None:
    """Vectorised scanline flood fill (no per-pixel python loop)."""
    h, w = mask.shape
    stack = [(x, y)]
    while stack:
        sx, sy = stack.pop()
        if not mask[sy, sx] or out[sy, sx]:
            continue
        row = mask[sy]
        left = sx
        while left > 0 and row[left - 1] and not out[sy, left - 1]:
            left -= 1
        right = sx
        while right < w - 1 and row[right + 1] and not out[sy, right + 1]:
            right += 1
        out[sy, left:right + 1] = True
        for ny in (sy - 1, sy + 1):
            if 0 <= ny < h:
                nrow = mask[ny]
                seg = nrow[left:right + 1] & (~out[ny, left:right + 1])
                if not seg.any():
                    continue
                idx = np.flatnonzero(seg)
                # seed each contiguous run
                breaks = np.flatnonzero(np.diff(idx) > 1)
                starts = np.concatenate(([idx[0]], idx[breaks + 1]))
                for s in starts:
                    stack.append((int(left + s), ny))


def _dilate(mask, radius: int):
    if np is None or radius <= 0:
        return mask
    out = mask.copy()
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            if dx == 0 and dy == 0:
                continue
            shifted = np.roll(np.roll(mask, dy, axis=0), dx, axis=1)
            out |= shifted
    return out


def _array_to_image(arr, base: QImage) -> QImage:
    if np is None:
        return base
    h, w = arr.shape[:2]
    img = QImage(w, h, QImage.Format_ARGB32_Premultiplied)
    out = np.frombuffer(memoryview(img.bits()), dtype=np.uint8).reshape(h, img.bytesPerLine() // 4, 4)
    out[:, :w, :] = arr
    return img


def _flood_fill_pure(image: QImage, x: int, y: int, color: QColor, tolerance: int,
                     gap_close: int) -> QImage | None:
    """Fallback (slow) implementation used only if numpy is missing."""
    img = image.convertToFormat(QImage.Format_ARGB32_Premultiplied).copy()
    w, h = img.width(), img.height()
    if not (0 <= x < w and 0 <= y < h):
        return None
    target = img.pixelColor(x, y)
    fill = color
    stack = [(x, y)]
    visited = bytearray(w * h)
    while stack:
        cx, cy = stack.pop()
        if not (0 <= cx < w and 0 <= cy < h):
            continue
        idx = cy * w + cx
        if visited[idx]:
            continue
        cur = img.pixelColor(cx, cy)
        if abs(cur.red() - target.red()) > tolerance or abs(cur.green() - target.green()) > tolerance \
                or abs(cur.blue() - target.blue()) > tolerance \
                or abs(cur.alpha() - target.alpha()) > tolerance:
            continue
        visited[idx] = 1
        img.setPixelColor(cx, cy, fill)
        stack.extend(((cx + 1, cy), (cx - 1, cy), (cx, cy + 1), (cx, cy - 1)))
    return img
