"""Layered image document for the photo editor and design studio.

Adjustment layers are non-destructive: they recolour everything below them when composited.
Pixel edits (brush, eraser, fills, inpainting, background removal) change the active raster layer.
"""
from __future__ import annotations

import io
import json
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import numpy as np
from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps

from ..core.errors import AppError
from ..core.fileio import atomic_write_bytes
from ..core.history import History
from .text import hex_to_rgba, place_on_canvas, render_text

MAX_PIXELS = 60_000_000  # ~8K frame; refuse larger canvases to protect 8 GB machines
LAYER_KINDS = ("raster", "adjust", "text", "shape")


@dataclass
class Layer:
    name: str
    kind: str = "raster"
    image: Optional[Image.Image] = None        # RGBA, canvas-sized for raster/text/shape
    visible: bool = True
    opacity: float = 1.0
    params: dict[str, Any] = field(default_factory=dict)  # adjust params / text & shape settings
    mask: Optional[Image.Image] = None         # L mode, canvas-sized

    def copy(self) -> "Layer":
        return Layer(self.name, self.kind, self.image.copy() if self.image else None, self.visible,
                     self.opacity, json.loads(json.dumps(self.params)),
                     self.mask.copy() if self.mask else None)


def apply_adjustments(img: Image.Image, p: dict[str, Any]) -> Image.Image:
    """Brightness/contrast/saturation/hue/curves/levels on an RGBA image (alpha preserved)."""
    rgba = img.convert("RGBA")
    alpha = rgba.getchannel("A")
    rgb = rgba.convert("RGB")
    b = float(p.get("brightness", 0.0))   # -1..1
    c = float(p.get("contrast", 0.0))     # -1..1
    s = float(p.get("saturation", 0.0))   # -1..1
    h = float(p.get("hue", 0.0))          # degrees -180..180
    if b:
        rgb = ImageEnhance.Brightness(rgb).enhance(max(0.0, 1.0 + b))
    if c:
        rgb = ImageEnhance.Contrast(rgb).enhance(max(0.0, 1.0 + c))
    if s:
        rgb = ImageEnhance.Color(rgb).enhance(max(0.0, 1.0 + s))
    if h:
        hsv = np.array(rgb.convert("HSV"), dtype=np.int16)
        hsv[..., 0] = (hsv[..., 0] + int(round(h / 360.0 * 255))) % 256
        rgb = Image.fromarray(hsv.astype(np.uint8), "HSV").convert("RGB")
    curve = p.get("curve")  # list of [x, y] points in 0..255
    if curve:
        xs, ys = zip(*sorted((float(a), float(b_)) for a, b_ in curve))
        lut = np.clip(np.interp(np.arange(256), xs, ys), 0, 255).astype(np.uint8)
        rgb = Image.fromarray(lut[np.asarray(rgb)], "RGB")
    out = rgb.convert("RGBA")
    out.putalpha(alpha)
    return out


FILTERS = {
    "blur": lambda im, r: im.filter(ImageFilter.GaussianBlur(float(r or 2))),
    "sharpen": lambda im, r: im.filter(ImageFilter.UnsharpMask(radius=2, percent=150, threshold=3)),
    "grayscale": lambda im, r: _keep_alpha(im, ImageOps.grayscale(im).convert("RGB")),
    "sepia": lambda im, r: _keep_alpha(im, _sepia(im)),
    "invert": lambda im, r: _keep_alpha(im, ImageOps.invert(im.convert("RGB"))),
    "edges": lambda im, r: im.filter(ImageFilter.EDGE_ENHANCE_MORE),
    "posterize": lambda im, r: _keep_alpha(im, ImageOps.posterize(im.convert("RGB"), 3)),
}


def _keep_alpha(im: Image.Image, rgb: Image.Image) -> Image.Image:
    out = rgb.convert("RGBA")
    out.putalpha(im.getchannel("A"))
    return out


def _sepia(im: Image.Image) -> Image.Image:
    gray = np.asarray(ImageOps.grayscale(im.convert("RGB")), dtype=np.float32) / 255.0
    r = np.clip(gray * 255, 0, 255)
    g = np.clip(gray * 220, 0, 255)
    b = np.clip(gray * 160, 0, 255)
    return Image.fromarray(np.dstack([r, g, b]).astype(np.uint8), "RGB")


class Document:
    def __init__(self, width: int, height: int, background: str = "transparent"):
        if width < 1 or height < 1:
            raise AppError("Canvas size must be at least 1×1 pixels.")
        if width * height > MAX_PIXELS:
            raise AppError("This canvas is too large for the memory of a low-end computer. Use a smaller size.")
        self.width, self.height = int(width), int(height)
        self.layers: list[Layer] = []
        self.active = -1
        self.history = History(limit=20)
        self.selection: Optional[tuple[int, int, int, int]] = None  # x1, y1, x2, y2
        base = Image.new("RGBA", (self.width, self.height), (0, 0, 0, 0))
        if background != "transparent":
            base = Image.new("RGBA", (self.width, self.height), hex_to_rgba(background))
        self.add_layer(Layer("Background", "raster", base))

    # ---- layer management -------------------------------------------------
    def _snapshot(self) -> dict:
        return {"layers": [l.copy() for l in self.layers], "active": self.active,
                "w": self.width, "h": self.height}

    def _restore(self, snap: dict) -> None:
        self.layers = snap["layers"]
        self.active = snap["active"]
        self.width, self.height = snap["w"], snap["h"]

    def _checkpoint(self) -> None:
        self.history.push(self._snapshot())

    def undo(self) -> bool:
        snap = self.history.undo(self._snapshot())
        if snap is None:
            return False
        self._restore(snap)
        return True

    def redo(self) -> bool:
        snap = self.history.redo(self._snapshot())
        if snap is None:
            return False
        self._restore(snap)
        return True

    def add_layer(self, layer: Layer, *, checkpoint: bool = False) -> int:
        if checkpoint:
            self._checkpoint()
        if layer.kind != "adjust" and layer.image is None:
            layer.image = Image.new("RGBA", (self.width, self.height), (0, 0, 0, 0))
        if layer.kind != "adjust" and layer.image.size != (self.width, self.height):
            layer.image = _fit_canvas(layer.image, self.width, self.height)
        self.layers.append(layer)
        self.active = len(self.layers) - 1
        return self.active

    def add_image_layer(self, path: str | Path, name: str = "") -> int:
        src = _open_image(path)
        return self.add_layer(Layer(name or Path(path).stem, "raster", src.convert("RGBA")), checkpoint=True)

    def add_text_layer(self, text: str, *, size: int = 96, color: str = "#FFFFFF",
                       stroke: int = 0, stroke_color: str = "#000000", shadow: int = 0,
                       position: str = "center") -> int:
        img = render_text(text, size=size, color=color, stroke_width=stroke, stroke_color=stroke_color,
                          shadow_offset=(shadow, shadow), shadow_color="#000000")
        layer_img = place_on_canvas(img, self.width, self.height, position)
        params = {"text": text, "size": size, "color": color, "stroke": stroke,
                  "stroke_color": stroke_color, "shadow": shadow, "position": position}
        return self.add_layer(Layer(f"Text: {text[:20]}", "text", layer_img, params=params), checkpoint=True)

    def add_shape_layer(self, shape: str, box: tuple[int, int, int, int], color: str = "#FF3B30") -> int:
        if shape not in ("rectangle", "ellipse"):
            raise AppError("Shape must be a rectangle or an ellipse.")
        img = Image.new("RGBA", (self.width, self.height), (0, 0, 0, 0))
        d = ImageDraw.Draw(img)
        x1, y1, x2, y2 = _norm_box(box, self.width, self.height)
        fill = hex_to_rgba(color)
        (d.rectangle if shape == "rectangle" else d.ellipse)([x1, y1, x2, y2], fill=fill)
        return self.add_layer(Layer(shape.capitalize(), "shape", img, params={"shape": shape, "color": color}),
                              checkpoint=True)

    def add_adjust_layer(self, **params: Any) -> int:
        return self.add_layer(Layer("Adjustment", "adjust", None, params=dict(params)), checkpoint=True)

    def delete_layer(self, index: int) -> None:
        self._index_ok(index)
        if len(self.layers) == 1:
            raise AppError("A document needs at least one layer.")
        self._checkpoint()
        del self.layers[index]
        self.active = min(self.active, len(self.layers) - 1)

    def move_layer(self, index: int, delta: int) -> None:
        self._index_ok(index)
        new = index + delta
        if not 0 <= new < len(self.layers):
            return
        self._checkpoint()
        self.layers[index], self.layers[new] = self.layers[new], self.layers[index]
        self.active = new

    def duplicate_layer(self, index: int) -> int:
        self._index_ok(index)
        self._checkpoint()
        self.layers.insert(index + 1, self.layers[index].copy())
        self.active = index + 1
        return self.active

    def merge_down(self, index: int) -> None:
        self._index_ok(index)
        if index == 0 or self.layers[index].kind != "raster" or self.layers[index - 1].kind != "raster":
            raise AppError("Only two raster layers can be merged.")
        self._checkpoint()
        below, top = self.layers[index - 1], self.layers[index]
        below.image = _composite_layer(below.image, top.image, top.opacity, top.mask)
        del self.layers[index]
        self.active = index - 1

    def set_layer_opacity(self, index: int, opacity: float) -> None:
        self._index_ok(index)
        if not 0.0 <= opacity <= 1.0:
            raise AppError("Opacity must be between 0% and 100%.")
        self.layers[index].opacity = opacity

    def _index_ok(self, index: int) -> None:
        if not 0 <= index < len(self.layers):
            raise AppError("No layer is selected.")

    def active_raster(self) -> Layer:
        self._index_ok(self.active)
        layer = self.layers[self.active]
        if layer.kind == "adjust":
            raise AppError("Select a pixel layer (not an adjustment layer) to paint or edit.")
        return layer

    # ---- compositing --------------------------------------------------------
    def composite(self) -> Image.Image:
        out = Image.new("RGBA", (self.width, self.height), (0, 0, 0, 0))
        for layer in self.layers:
            if not layer.visible:
                continue
            if layer.kind == "adjust":
                adjusted = apply_adjustments(out, layer.params)
                out = Image.blend(out, adjusted, layer.opacity) if layer.opacity < 1.0 else adjusted
            else:
                out = _composite_layer(out, layer.image, layer.opacity, layer.mask)
        return out

    def flatten(self) -> Image.Image:
        return self.composite()

    # ---- canvas-level transforms (apply to all layers, undoable) -----------
    def crop(self, box: tuple[int, int, int, int]) -> None:
        x1, y1, x2, y2 = _norm_box(box, self.width, self.height, allow_full=False)
        self._checkpoint()
        for layer in self.layers:
            if layer.image is not None:
                layer.image = layer.image.crop((x1, y1, x2, y2))
            if layer.mask is not None:
                layer.mask = layer.mask.crop((x1, y1, x2, y2))
        self.width, self.height = x2 - x1, y2 - y1
        self.selection = None

    def rotate(self, degrees: int) -> None:
        if degrees not in (90, 180, 270, -90):
            raise AppError("Rotation must be 90, 180, 270 or -90 degrees.")
        self._checkpoint()
        for layer in self.layers:
            if layer.image is not None:
                layer.image = layer.image.rotate(degrees, expand=True)
            if layer.mask is not None:
                layer.mask = layer.mask.rotate(degrees, expand=True)
        if degrees in (90, 270, -90):
            self.width, self.height = self.height, self.width
        self.selection = None

    def resize(self, width: int, height: int, resample: int = Image.LANCZOS) -> None:
        if width < 1 or height < 1:
            raise AppError("Size must be at least 1×1 pixels.")
        if width * height > MAX_PIXELS:
            raise AppError("That size is too large for this computer's memory.")
        self._checkpoint()
        for layer in self.layers:
            if layer.image is not None:
                layer.image = layer.image.resize((width, height), resample)
            if layer.mask is not None:
                layer.mask = layer.mask.resize((width, height), resample)
        self.width, self.height = width, height
        self.selection = None

    def apply_filter(self, name: str, radius: float = 0) -> None:
        if name not in FILTERS:
            raise AppError(f"Unknown filter: {name}")
        layer = self.active_raster()
        self._checkpoint()
        layer.image = FILTERS[name](layer.image, radius)

    def brush(self, points: list[tuple[int, int]], *, color: str = "#FFFFFF", size: int = 12,
              opacity: float = 1.0, erase: bool = False) -> None:
        """Paint (or erase) a stroke through points on the active raster layer."""
        if size < 1 or size > 2000:
            raise AppError("Brush size must be between 1 and 2000 pixels.")
        layer = self.active_raster()
        self._checkpoint()
        r = size / 2
        if erase:
            m = Image.new("L", layer.image.size, 0)
            d = ImageDraw.Draw(m)
            _stroke(d, points, r, 255)
            alpha = layer.image.getchannel("A")
            alpha = Image.fromarray(np.clip(np.asarray(alpha, np.int16) - np.asarray(m, np.int16)
                                            * opacity, 0, 255).astype(np.uint8), "L")
            layer.image.putalpha(alpha)
        else:
            stroke = Image.new("RGBA", layer.image.size, (0, 0, 0, 0))
            m = Image.new("L", layer.image.size, 0)
            _stroke(ImageDraw.Draw(m), points, r, int(255 * opacity))
            color_img = Image.new("RGBA", layer.image.size, hex_to_rgba(color))
            stroke = Image.composite(color_img, stroke, m)
            layer.image = Image.alpha_composite(layer.image, stroke)

    def select_rect(self, box: tuple[int, int, int, int]) -> None:
        self.selection = _norm_box(box, self.width, self.height)

    def clear_selection(self) -> None:
        self.selection = None

    def fill_selection(self, color: str) -> None:
        if not self.selection:
            raise AppError("Select an area first.")
        layer = self.active_raster()
        self._checkpoint()
        x1, y1, x2, y2 = self.selection
        ImageDraw.Draw(layer.image).rectangle([x1, y1, x2 - 1, y2 - 1], fill=hex_to_rgba(color))

    def delete_selection(self) -> None:
        if not self.selection:
            raise AppError("Select an area first.")
        layer = self.active_raster()
        self._checkpoint()
        x1, y1, x2, y2 = self.selection
        ImageDraw.Draw(layer.image).rectangle([x1, y1, x2 - 1, y2 - 1], fill=(0, 0, 0, 0))

    def set_mask_from_selection(self) -> None:
        if not self.selection:
            raise AppError("Select an area first.")
        layer = self.active_raster()
        self._checkpoint()
        m = Image.new("L", (self.width, self.height), 0)
        x1, y1, x2, y2 = self.selection
        ImageDraw.Draw(m).rectangle([x1, y1, x2 - 1, y2 - 1], fill=255)
        layer.mask = m

    def inpaint_selection(self, radius: int = 5) -> None:
        """Object removal: fill the selected area from surrounding pixels (OpenCV Telea)."""
        import cv2

        if not self.selection:
            raise AppError("Select the object to remove first.")
        layer = self.active_raster()
        self._checkpoint()
        x1, y1, x2, y2 = self.selection
        arr = np.asarray(layer.image.convert("RGBA"))
        bgr = cv2.cvtColor(arr[..., :3].copy(), cv2.COLOR_RGB2BGR)
        mask = np.zeros(bgr.shape[:2], np.uint8)
        mask[y1:y2, x1:x2] = 255
        out = cv2.inpaint(bgr, mask, radius, cv2.INPAINT_TELEA)
        rgb = cv2.cvtColor(out, cv2.COLOR_BGR2RGB)
        layer.image = Image.fromarray(np.dstack([rgb, arr[..., 3]]), "RGBA")

    def remove_background(self, rect: Optional[tuple[int, int, int, int]] = None, iterations: int = 5) -> None:
        """Foreground extraction with GrabCut inside `rect` (or the current selection)."""
        import cv2

        box = rect or self.selection
        if not box:
            raise AppError("Draw a box around the subject first (select an area).")
        layer = self.active_raster()
        self._checkpoint()
        x1, y1, x2, y2 = _norm_box(box, self.width, self.height, allow_full=False)
        if (x2 - x1) < 4 or (y2 - y1) < 4:
            raise AppError("The selected area is too small to detect a subject.")
        rgb = np.asarray(layer.image.convert("RGB"))
        bgr = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        mask = np.zeros(bgr.shape[:2], np.uint8)
        bg_model = np.zeros((1, 65), np.float64)
        fg_model = np.zeros((1, 65), np.float64)
        cv2.grabCut(bgr, mask, (x1, y1, x2 - x1, y2 - y1), bg_model, fg_model, iterations,
                    cv2.GC_INIT_WITH_RECT)
        alpha = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)
        layer.image.putalpha(Image.fromarray(alpha, "L"))

    # ---- persistence ----------------------------------------------------------
    def save(self, path: str | Path) -> Path:
        """Save as a .adzimg (zip with manifest.json and one PNG per layer). Non-destructive."""
        manifest = {"format": "adzimg", "version": 1, "width": self.width, "height": self.height,
                    "active": self.active, "layers": []}
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
            for i, layer in enumerate(self.layers):
                entry = {"name": layer.name, "kind": layer.kind, "visible": layer.visible,
                         "opacity": layer.opacity, "params": layer.params, "has_image": layer.image is not None,
                         "has_mask": layer.mask is not None}
                if layer.image is not None:
                    b = io.BytesIO()
                    layer.image.save(b, "PNG")
                    z.writestr(f"layers/{i:03d}.png", b.getvalue())
                if layer.mask is not None:
                    b = io.BytesIO()
                    layer.mask.save(b, "PNG")
                    z.writestr(f"masks/{i:03d}.png", b.getvalue())
                manifest["layers"].append(entry)
            z.writestr("manifest.json", json.dumps(manifest, indent=2))
        return atomic_write_bytes(path, buf.getvalue())

    @classmethod
    def load(cls, path: str | Path) -> "Document":
        try:
            with zipfile.ZipFile(path) as z:
                manifest = json.loads(z.read("manifest.json"))
                if manifest.get("format") != "adzimg":
                    raise AppError("This file is not an ADZAK image project.")
                doc = cls.__new__(cls)
                doc.width, doc.height = int(manifest["width"]), int(manifest["height"])
                doc.layers, doc.selection = [], None
                doc.history = History(limit=20)
                for i, e in enumerate(manifest["layers"]):
                    img = mask = None
                    if e.get("has_image"):
                        img = Image.open(io.BytesIO(z.read(f"layers/{i:03d}.png"))).convert("RGBA")
                    if e.get("has_mask"):
                        mask = Image.open(io.BytesIO(z.read(f"masks/{i:03d}.png"))).convert("L")
                    doc.layers.append(Layer(e["name"], e["kind"], img, e.get("visible", True),
                                            float(e.get("opacity", 1.0)), e.get("params", {}), mask))
                doc.active = min(int(manifest.get("active", 0)), len(doc.layers) - 1)
                return doc
        except (zipfile.BadZipFile, KeyError, json.JSONDecodeError) as exc:
            raise AppError("The project file is damaged or incomplete.", details=str(exc)) from exc


EXPORT_FORMATS = {"png": "PNG", "jpg": "JPEG", "jpeg": "JPEG", "webp": "WEBP", "bmp": "BMP",
                  "tif": "TIFF", "tiff": "TIFF", "pdf": "PDF"}


def export_image(doc: Document, path: str | Path, *, scale: float = 1.0, quality: int = 90,
                 background: str = "#FFFFFF", dpi: int = 150) -> Path:
    out = Path(path)
    ext = out.suffix.lower().lstrip(".")
    if ext == "svg":
        raise AppError("SVG export is not available for raster designs. Use PNG, JPG, WebP, BMP, TIFF or PDF.")
    if ext not in EXPORT_FORMATS:
        raise AppError("Unsupported export format. Choose PNG, JPG, WebP, BMP, TIFF or PDF.")
    if not 1 <= quality <= 100:
        raise AppError("Quality must be between 1 and 100.")
    if not 0.05 <= scale <= 8:
        raise AppError("Scale must be between 5% and 800%.")
    img = doc.composite()
    if scale != 1.0:
        img = img.resize((max(1, round(img.width * scale)), max(1, round(img.height * scale))), Image.LANCZOS)
    fmt = EXPORT_FORMATS[ext]
    if fmt in ("JPEG", "BMP", "PDF"):
        bg = Image.new("RGBA", img.size, hex_to_rgba(background))
        img = Image.alpha_composite(bg, img).convert("RGB")
    b = io.BytesIO()
    kwargs: dict[str, Any] = {}
    if fmt == "JPEG":
        kwargs = {"quality": quality, "optimize": True, "dpi": (dpi, dpi)}
    elif fmt == "WEBP":
        kwargs = {"quality": quality, "method": 4}
    elif fmt == "PNG":
        kwargs = {"optimize": True, "dpi": (dpi, dpi)}
    elif fmt == "PDF":
        kwargs = {"resolution": float(dpi)}
    img.save(b, fmt, **kwargs)
    return atomic_write_bytes(out, b.getvalue())


# ---- helpers -----------------------------------------------------------------
def _open_image(path: str | Path) -> Image.Image:
    p = Path(path)
    if not p.is_file():
        raise AppError(f"File not found: {p.name}")
    if p.stat().st_size > 400 * 1024 * 1024:
        raise AppError("This image file is too large to open safely.")
    try:
        im = Image.open(p)
        im.load()
    except Exception as exc:  # noqa: BLE001
        raise AppError(f"Could not open image: {p.name}", details=str(exc)) from exc
    im = ImageOps.exif_transpose(im) or im
    if im.width * im.height > MAX_PIXELS:
        raise AppError("This image has too many pixels for this computer's memory. Resize it first.")
    return im


def _fit_canvas(img: Image.Image, w: int, h: int) -> Image.Image:
    canvas = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    canvas.alpha_composite(img.convert("RGBA"), (0, 0))
    return canvas


def _composite_layer(base: Image.Image, top: Image.Image, opacity: float, mask: Optional[Image.Image]) -> Image.Image:
    t = top.copy()
    alpha = t.getchannel("A")
    if mask is not None:
        alpha = Image.fromarray((np.asarray(alpha, np.uint16) * np.asarray(mask, np.uint16) // 255).astype(np.uint8))
    if opacity < 1.0:
        alpha = Image.fromarray((np.asarray(alpha, np.float32) * opacity).astype(np.uint8))
    t.putalpha(alpha)
    return Image.alpha_composite(base, t)


def _norm_box(box, w: int, h: int, allow_full: bool = True) -> tuple[int, int, int, int]:
    x1, y1, x2, y2 = (int(round(v)) for v in box)
    x1, x2 = sorted((max(0, x1), min(w, x2)))
    y1, y2 = sorted((max(0, y1), min(h, y2)))
    if x2 - x1 < 1 or y2 - y1 < 1:
        raise AppError("The selected area is empty.")
    if not allow_full and (x2 - x1, y2 - y1) == (w, h):
        raise AppError("Choose a smaller area than the whole image.")
    return x1, y1, x2, y2


def _stroke(draw: ImageDraw.ImageDraw, points: list[tuple[int, int]], r: float, fill: int) -> None:
    if not points:
        return
    for (x, y) in points:
        draw.ellipse([x - r, y - r, x + r, y + r], fill=fill)
    for (x1, y1), (x2, y2) in zip(points, points[1:]):
        draw.line([x1, y1, x2, y2], fill=fill, width=max(1, int(2 * r)))
