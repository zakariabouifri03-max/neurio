"""Reproducibly generate a multi-resolution Windows ICO from the original SVG."""

import struct
from pathlib import Path
from PySide6.QtCore import QByteArray, QBuffer, QIODevice, QRectF
from PySide6.QtGui import QImage, QPainter
from PySide6.QtSvg import QSvgRenderer

root = Path(__file__).resolve().parents[1]
renderer = QSvgRenderer(str(root / "assets/app_icon.svg"))
images = []
for size in (16, 24, 32, 48, 64, 128, 256):
    image = QImage(size, size, QImage.Format_ARGB32)
    image.fill(0)
    painter = QPainter(image)
    renderer.render(painter, QRectF(0, 0, size, size))
    painter.end()
    data = QByteArray()
    buffer = QBuffer(data)
    buffer.open(QIODevice.WriteOnly)
    image.save(buffer, "PNG")
    images.append((size, bytes(data)))
header = struct.pack("<HHH", 0, 1, len(images))
offset = 6 + 16 * len(images)
entries = []
for size, data in images:
    entries.append(
        struct.pack("<BBBBHHII", size % 256, size % 256, 0, 0, 1, 32, len(data), offset)
    )
    offset += len(data)
(root / "assets/app_icon.ico").write_bytes(
    header + b"".join(entries) + b"".join(data for _, data in images)
)
