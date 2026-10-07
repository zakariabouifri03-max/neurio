"""Drawing cels - the atomic piece of art on a layer at a given frame."""
from __future__ import annotations

import base64
from dataclasses import dataclass, field

from PySide6.QtCore import QBuffer, QByteArray, QPointF, QRect, QRectF, Qt
from PySide6.QtGui import QColor, QImage, QPainter

from .keyframe import new_id

# --------------------------------------------------------------------------
# paint settings shared by the raster and vector renderers
# --------------------------------------------------------------------------
@dataclass
class BrushSettings:
    name: str = "Pencil"
    kind: str = "pencil"          # pencil | ink | marker | soft | airbrush | eraser | charcoal
    size: float = 8.0
    opacity: float = 1.0
    hardness: float = 1.0
    smoothing: float = 0.35
    stabilize: float = 0.25
    pressure_size: bool = True
    pressure_opacity: bool = False
    spacing: float = 0.25
    color: tuple[int, int, int, int] = (24, 24, 28, 255)
    taper_in: float = 0.0
    taper_out: float = 0.0
    texture: float = 0.0
    blur: float = 0.0

    def to_dict(self) -> dict:
        return {
            "name": self.name, "kind": self.kind, "size": self.size, "opacity": self.opacity,
            "hardness": self.hardness, "smoothing": self.smoothing, "stabilize": self.stabilize,
            "pressure_size": self.pressure_size, "pressure_opacity": self.pressure_opacity,
            "spacing": self.spacing, "color": list(self.color),
            "taper_in": self.taper_in, "taper_out": self.taper_out,
            "texture": self.texture, "blur": self.blur,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "BrushSettings":
        d = dict(d or {})
        if "color" in d:
            d["color"] = tuple(d["color"])
        allowed = {f for f in cls.__dataclass_fields__}  # type: ignore[attr-defined]
        return cls(**{k: v for k, v in d.items() if k in allowed})

    def copy(self) -> "BrushSettings":
        return BrushSettings.from_dict(self.to_dict())


# --------------------------------------------------------------------------
# cels
# --------------------------------------------------------------------------
class Cel:
    """Base class for everything that can be exposed on a frame."""

    kind = "base"

    def __init__(self, size: tuple[int, int] = (1920, 1080)):
        self.uid: str = new_id("cel")
        self.size: tuple[int, int] = (int(size[0]), int(size[1]))
        self.name: str = ""

    # -- geometry ---------------------------------------------------------
    @property
    def width(self) -> int:
        return self.size[0]

    @property
    def height(self) -> int:
        return self.size[1]

    def rect(self) -> QRect:
        return QRect(0, 0, self.width, self.height)

    def rectf(self) -> QRectF:
        return QRectF(0, 0, self.width, self.height)

    # -- api --------------------------------------------------------------
    def clone(self) -> "Cel":
        raise NotImplementedError

    def is_empty(self) -> bool:
        return False

    def content_bounds(self) -> QRect | None:
        """Bounding box of the actual drawing (in cel pixels)."""
        return None

    def to_dict(self) -> dict:
        return {"kind": self.kind, "uid": self.uid, "name": self.name,
                "size": list(self.size)}

    def payload(self) -> dict[str, bytes] | None:
        """Binary side-car data written into the .mfs archive."""
        return None

    @staticmethod
    def from_dict(d: dict, payload_reader=None) -> "Cel":
        kind = d.get("kind", "bitmap")
        cls = {
            "bitmap": BitmapCel,
            "vector": VectorCel,
            "image": ImageCel,
            "text": TextCel,
        }.get(kind, BitmapCel)
        return cls._from_dict(d, payload_reader)


class BitmapCel(Cel):
    """Raster drawing - used by the brush/pencil/eraser/fill tools."""

    kind = "bitmap"

    def __init__(self, size: tuple[int, int] = (1920, 1080), image: QImage | None = None):
        super().__init__(size)
        if image is not None:
            self._image = image
            self.size = (image.width(), image.height())
        else:
            self._image: QImage | None = None
        self._bounds: QRect | None = None
        self._bounds_dirty = True

    # -- image access -----------------------------------------------------
    @property
    def image(self) -> QImage:
        if self._image is None:
            img = QImage(self.width, self.height, QImage.Format_ARGB32_Premultiplied)
            img.fill(Qt.transparent)
            self._image = img
        return self._image

    @image.setter
    def image(self, img: QImage) -> None:
        self._image = img
        self.size = (img.width(), img.height())
        self._bounds_dirty = True

    def resize(self, size: tuple[int, int]) -> None:
        if size == self.size:
            return
        if self._image is not None:
            img = QImage(size[0], size[1], QImage.Format_ARGB32_Premultiplied)
            img.fill(Qt.transparent)
            p = QPainter(img)
            p.drawImage(0, 0, self._image)
            p.end()
            self._image = img
        self.size = (int(size[0]), int(size[1]))
        self._bounds_dirty = True

    def invalidate_bounds(self) -> None:
        self._bounds_dirty = True

    def content_bounds(self) -> QRect | None:
        if self._bounds_dirty:
            self._bounds = _alpha_bounds(self.image) if self._image is not None else None
            self._bounds_dirty = False
        return self._bounds

    def is_empty(self) -> bool:
        if self._image is None:
            return True
        b = self.content_bounds()
        return b is None or b.isEmpty()

    def clear(self) -> None:
        if self._image is not None:
            self._image.fill(Qt.transparent)
        self.invalidate_bounds()

    def clone(self) -> "BitmapCel":
        c = BitmapCel(self.size)
        c.uid = self.uid
        c.name = self.name
        if self._image is not None:
            c._image = self._image.copy()
        else:
            c._image = None
        return c

    def copy_as_new(self) -> "BitmapCel":
        c = self.clone()
        c.uid = new_id("cel")
        return c

    # -- io ---------------------------------------------------------------
    def to_png(self) -> bytes:
        buf = QBuffer()
        buf.open(QBuffer.WriteOnly)
        self.image.save(buf, "PNG")
        return bytes(buf.data())

    @classmethod
    def from_png(cls, data: bytes, size: tuple[int, int] | None = None) -> "BitmapCel":
        img = QImage.fromData(QByteArray(data), "PNG")
        cel = cls((img.width(), img.height()) if size is None else size)
        if img.isNull():
            return cel
        target = QImage(cel.width, cel.height, QImage.Format_ARGB32_Premultiplied)
        target.fill(Qt.transparent)
        p = QPainter(target)
        p.drawImage(0, 0, img.convertToFormat(QImage.Format_ARGB32_Premultiplied))
        p.end()
        cel.image = target
        return cel

    def payload(self) -> dict[str, bytes]:
        return {f"cels/{self.uid}.png": self.to_png()}

    @classmethod
    def _from_dict(cls, d: dict, payload_reader=None) -> "BitmapCel":
        size = tuple(d.get("size", (1920, 1080)))  # type: ignore[arg-type]
        cel = cls(size)  # type: ignore[arg-type]
        cel.uid = d.get("uid") or cel.uid
        cel.name = d.get("name", "")
        data = None
        if payload_reader is not None:
            data = payload_reader(f"cels/{cel.uid}.png")
        if data:
            img = QImage.fromData(QByteArray(data), "PNG")
            if not img.isNull():
                if (img.width(), img.height()) != tuple(size):
                    canvas = QImage(int(size[0]), int(size[1]), QImage.Format_ARGB32_Premultiplied)
                    canvas.fill(Qt.transparent)
                    p = QPainter(canvas)
                    p.drawImage(0, 0, img.convertToFormat(QImage.Format_ARGB32_Premultiplied))
                    p.end()
                    img = canvas
                cel._image = img
        return cel


class VectorCel(Cel):
    """Resolution independent strokes (shapes, bezier, text, vector ink)."""

    kind = "vector"

    def __init__(self, size: tuple[int, int] = (1920, 1080), strokes: list[dict] | None = None):
        super().__init__(size)
        self.strokes: list[dict] = strokes or []

    def clone(self) -> "VectorCel":
        import copy as _copy
        c = VectorCel(self.size, _copy.deepcopy(self.strokes))
        c.uid = self.uid
        c.name = self.name
        return c

    def copy_as_new(self) -> "VectorCel":
        c = self.clone()
        c.uid = new_id("cel")
        return c

    def add_stroke(self, stroke: dict) -> dict:
        stroke.setdefault("uid", new_id("s"))
        self.strokes.append(stroke)
        return stroke

    def remove_stroke(self, uid: str) -> bool:
        before = len(self.strokes)
        self.strokes = [s for s in self.strokes if s.get("uid") != uid]
        return len(self.strokes) != before

    def is_empty(self) -> bool:
        return not self.strokes

    def content_bounds(self) -> QRect | None:
        xs: list[float] = []
        ys: list[float] = []
        for s in self.strokes:
            for pt in s.get("points", []):
                xs.append(float(pt[0]))
                ys.append(float(pt[1]))
            for key in ("rect", "center"):
                if key in s:
                    v = s[key]
                    xs.append(float(v[0]))
                    ys.append(float(v[1]))
        if not xs:
            return None
        from PySide6.QtCore import QPoint
        return QRect(QPoint(int(min(xs)) - 2, int(min(ys)) - 2),
                     QPoint(int(max(xs)) + 2, int(max(ys)) + 2))

    def to_dict(self) -> dict:
        d = super().to_dict()
        d["strokes"] = self.strokes
        return d

    @classmethod
    def _from_dict(cls, d: dict, payload_reader=None) -> "VectorCel":
        cel = cls(tuple(d.get("size", (1920, 1080))), d.get("strokes", []))  # type: ignore[arg-type]
        cel.uid = d.get("uid") or cel.uid
        cel.name = d.get("name", "")
        return cel


class ImageCel(Cel):
    """An imported bitmap (PNG/JPG/SVG rendered/GIF frame) placed on a layer."""

    kind = "image"

    def __init__(self, size: tuple[int, int] = (1920, 1080), asset_id: str = "",
                 fit: str = "native", scale: float = 1.0, offset: tuple[float, float] = (0.0, 0.0)):
        super().__init__(size)
        self.asset_id = asset_id
        self.fit = fit                      # native | fit | fill | stretch
        self.scale = scale
        self.offset = offset

    def clone(self) -> "ImageCel":
        c = ImageCel(self.size, self.asset_id, self.fit, self.scale, self.offset)
        c.uid = self.uid
        c.name = self.name
        return c

    def copy_as_new(self) -> "ImageCel":
        c = self.clone()
        c.uid = new_id("cel")
        return c

    def to_dict(self) -> dict:
        d = super().to_dict()
        d.update({"asset_id": self.asset_id, "fit": self.fit,
                  "scale": self.scale, "offset": list(self.offset)})
        return d

    @classmethod
    def _from_dict(cls, d: dict, payload_reader=None) -> "ImageCel":
        cel = cls(tuple(d.get("size", (1920, 1080))), d.get("asset_id", ""),  # type: ignore[arg-type]
                  d.get("fit", "native"), float(d.get("scale", 1.0)),
                  tuple(d.get("offset", (0.0, 0.0))))  # type: ignore[arg-type]
        cel.uid = d.get("uid") or cel.uid
        cel.name = d.get("name", "")
        return cel


class TextCel(Cel):
    """Live (re-editable) text object."""

    kind = "text"

    def __init__(self, size: tuple[int, int] = (1920, 1080), text: str = "Text",
                 pos: tuple[float, float] = (100.0, 100.0), font: str = "Segoe UI",
                 pixel_size: int = 72, color: tuple[int, int, int, int] = (24, 24, 28, 255),
                 align: str = "left", bold: bool = False, italic: bool = False,
                 outline: int = 0, outline_color: tuple[int, int, int, int] = (255, 255, 255, 255)):
        super().__init__(size)
        self.text = text
        self.pos = pos
        self.font = font
        self.pixel_size = pixel_size
        self.color = color
        self.align = align
        self.bold = bold
        self.italic = italic
        self.outline = outline
        self.outline_color = outline_color
        self.rotation = 0.0
        self.tracking = 0.0

    def clone(self) -> "TextCel":
        c = TextCel(self.size, self.text, self.pos, self.font, self.pixel_size, self.color,
                    self.align, self.bold, self.italic, self.outline, self.outline_color)
        c.uid = self.uid
        c.name = self.name
        c.rotation = self.rotation
        c.tracking = self.tracking
        return c

    def copy_as_new(self) -> "TextCel":
        c = self.clone()
        c.uid = new_id("cel")
        return c

    def to_dict(self) -> dict:
        d = super().to_dict()
        d.update({
            "text": self.text, "pos": list(self.pos), "font": self.font,
            "pixel_size": self.pixel_size, "color": list(self.color), "align": self.align,
            "bold": self.bold, "italic": self.italic, "outline": self.outline,
            "outline_color": list(self.outline_color), "rotation": self.rotation,
            "tracking": self.tracking,
        })
        return d

    @classmethod
    def _from_dict(cls, d: dict, payload_reader=None) -> "TextCel":
        cel = cls(
            tuple(d.get("size", (1920, 1080))), d.get("text", "Text"),  # type: ignore[arg-type]
            tuple(d.get("pos", (100.0, 100.0))),  # type: ignore[arg-type]
            d.get("font", "Segoe UI"), int(d.get("pixel_size", 72)),
            tuple(d.get("color", (24, 24, 28, 255))),  # type: ignore[arg-type]
            d.get("align", "left"), bool(d.get("bold", False)), bool(d.get("italic", False)),
            int(d.get("outline", 0)), tuple(d.get("outline_color", (255, 255, 255, 255))),  # type: ignore[arg-type]
        )
        cel.uid = d.get("uid") or cel.uid
        cel.name = d.get("name", "")
        cel.rotation = float(d.get("rotation", 0.0))
        cel.tracking = float(d.get("tracking", 0.0))
        return cel


# --------------------------------------------------------------------------
def _alpha_bounds(img: QImage) -> QRect | None:
    """Fast-ish bounding box of non transparent pixels."""
    if img.isNull():
        return None
    w, h = img.width(), img.height()
    try:
        import numpy as np
        ptr = img.constBits()
        arr = np.frombuffer(memoryview(ptr), dtype=np.uint8).reshape(h, img.bytesPerLine() // 4, 4)
        alpha = arr[:, :w, 3]
        rows = np.where(alpha.any(axis=1))[0]
        if rows.size == 0:
            return None
        cols = np.where(alpha.any(axis=0))[0]
        return QRect(int(cols[0]), int(rows[0]),
                     int(cols[-1] - cols[0] + 1), int(rows[-1] - rows[0] + 1))
    except Exception:
        pass
    # pure python fallback (slow but correct) - scans every 2nd row
    minx, miny, maxx, maxy = w, h, -1, -1
    step = 2 if w * h > 400_000 else 1
    for y in range(0, h, step):
        line = img.constScanLine(y)
        data = bytes(line)
        if not any(data[3::4]):
            continue
        miny = min(miny, y)
        maxy = max(maxy, y)
        for x in range(0, w, step):
            if data[x * 4 + 3]:
                minx = min(minx, x)
                maxx = max(maxx, x)
    if maxx < 0:
        return None
    return QRect(minx, miny, maxx - minx + 1, maxy - miny + 1)


def encode_png_data_url(data: bytes) -> str:
    return "data:image/png;base64," + base64.b64encode(data).decode("ascii")
