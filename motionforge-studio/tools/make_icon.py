"""Turn the generated artwork into the application .ico used by the Windows build.

The source is a square illustration; this script crops it to the rounded tile,
re-applies a rounded alpha mask (so the icon has clean transparent corners on
the taskbar and in Explorer) and packs the usual Windows icon sizes into a
single multi-resolution ``.ico`` file plus a PNG preview.

Run with the bundled Qt:  tools/devrun.sh tools/make_icon.py
"""
from __future__ import annotations

import os
import struct
import sys

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")

from PySide6.QtCore import QBuffer, QByteArray, QRectF, Qt  # noqa: E402
from PySide6.QtGui import QGuiApplication, QImage, QPainter, QPainterPath  # noqa: E402

SIZES = (256, 128, 64, 48, 40, 32, 24, 20, 16)
# crop window of the tile inside the 1024x1024 illustration
CROP = (194, 192, 656, 662)
CORNER_RATIO = 0.235


def png_bytes(image: QImage) -> bytes:
    buf = QBuffer()
    buf.open(QBuffer.WriteOnly)
    image.save(buf, "PNG")
    return bytes(buf.data())


def rounded(image: QImage, radius_ratio: float = CORNER_RATIO) -> QImage:
    """Return a copy with the corners cut out (transparent)."""
    size = image.width()
    out = QImage(size, size, QImage.Format_ARGB32_Premultiplied)
    out.fill(Qt.transparent)
    painter = QPainter(out)
    painter.setRenderHint(QPainter.Antialiasing, True)
    painter.setRenderHint(QPainter.SmoothPixmapTransform, True)
    path = QPainterPath()
    r = size * radius_ratio
    path.addRoundedRect(QRectF(0, 0, size, size), r, r)
    painter.setClipPath(path)
    # zoom 1.5% so the tile edge bleeds past the mask (no light halo corners)
    zoom = 1.015
    painter.translate(size * (1 - zoom) / 2.0, size * (1 - zoom) / 2.0)
    painter.scale(zoom, zoom)
    painter.drawImage(0, 0, image)
    painter.end()
    return out


def write_ico(path: str, images: list[QImage]) -> None:
    blobs = [png_bytes(img) for img in images]
    header = struct.pack("<HHH", 0, 1, len(images))
    offset = 6 + 16 * len(images)
    entries = []
    for img, blob in zip(images, blobs):
        w = 0 if img.width() >= 256 else img.width()
        h = 0 if img.height() >= 256 else img.height()
        entries.append(struct.pack("<BBBBHHII", w, h, 0, 0, 1, 32, len(blob), offset))
        offset += len(blob)
    with open(path, "wb") as fh:
        fh.write(header)
        for e in entries:
            fh.write(e)
        for blob in blobs:
            fh.write(blob)


def main() -> int:
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        root, "packaging", "win", "icon-source.png")
    out_ico = sys.argv[2] if len(sys.argv) > 2 else os.path.join(
        root, "packaging", "win", "motionforge.ico")
    preview = os.path.join(root, "packaging", "win", "icon-preview.png")

    app = QGuiApplication.instance() or QGuiApplication([])
    image = QImage(src)
    if image.isNull():
        print("cannot read", src)
        return 1
    x, y, w, h = CROP
    if w != h:
        side = min(w, h)
        crop = image.copy(x, y, side, side)
    else:
        crop = image.copy(x, y, w, h)
    master = rounded(crop)
    base = master.scaled(1024, 1024, Qt.IgnoreAspectRatio, Qt.SmoothTransformation)
    images = [base.scaled(s, s, Qt.IgnoreAspectRatio, Qt.SmoothTransformation) for s in SIZES]
    write_ico(out_ico, images)
    base.save(preview, "PNG")
    print("wrote", out_ico, os.path.getsize(out_ico), "bytes;", len(images), "sizes")
    _ = app
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
