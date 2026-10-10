"""Photo editing panel: layers, adjustments, filters, retouch, drawing.

The document is a stack of RGBA PIL layers; the canvas shows the composite.
All operations go through adzak.services.image_ops (real pixel operations),
and undo/redo stores layer snapshots for the last N states.
"""

from __future__ import annotations

import io
from pathlib import Path

from PIL import Image, ImageDraw
from PySide6.QtCore import QPoint, QRect, QSize, Qt
from PySide6.QtGui import QImage, QPixmap
from PySide6.QtWidgets import (
    QCheckBox, QColorDialog, QComboBox, QFileDialog, QFormLayout, QGroupBox,
    QHBoxLayout, QLabel, QLineEdit, QListWidget, QListWidgetItem, QMessageBox,
    QPushButton, QRubberBand, QSizePolicy, QSlider, QSpinBox, QVBoxLayout,
    QWidget,
)

from ...core.logging_setup import get_logger
from ...services import image_ops
from ...core.undo import Command, UndoStack

log = get_logger("photo_editor")


def pil_to_qimage(img: Image.Image) -> QImage:
    img = img.convert("RGBA")
    data = img.tobytes("raw", "RGBA")
    q = QImage(data, img.width, img.height, QImage.Format_RGBA8888)
    return q.copy()


class CanvasWidget(QLabel):
    """Shows the composite; forwards mouse events for brush/eraser/crop."""

    def __init__(self, panel: "PhotoEditorPanel"):
        super().__init__(alignment=Qt.AlignCenter)
        self.panel = panel
        self.setStyleSheet("background:#0c0d10; border-radius:8px;")
        self.setMinimumSize(320, 240)
        self.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        self.setMouseTracking(True)
        self._last: QPoint | None = None
        self._band = QRubberBand(QRubberBand.Rectangle, self)
        self._band_origin = QPoint()

    # map widget px -> image px (letterboxed fit)
    def image_point(self, pos: QPoint) -> tuple[int, int] | None:
        pm = self.pixmap()
        if pm is None or pm.isNull():
            return None
        ox = (self.width() - pm.width()) / 2
        oy = (self.height() - pm.height()) / 2
        scale = self.panel.display_scale
        x = (pos.x() - ox) / scale
        y = (pos.y() - oy) / scale
        return int(x), int(y)

    def mousePressEvent(self, ev):
        tool = self.panel.tool
        if tool == "crop" and ev.button() == Qt.LeftButton:
            self._band_origin = ev.pos()
            self._band.setGeometry(QRect(self._band_origin, QSize()))
            self._band.show()
        elif tool in {"brush", "eraser"} and ev.button() == Qt.LeftButton:
            self._last = ev.pos()
            self._paint_to(ev.pos())
        else:
            super().mousePressEvent(ev)

    def mouseMoveEvent(self, ev):
        if self._band.isVisible():
            self._band.setGeometry(QRect(self._band_origin, ev.pos()).normalized())
        elif self._last is not None:
            self._paint_to(ev.pos())
        super().mouseMoveEvent(ev)

    def mouseReleaseEvent(self, ev):
        if self._band.isVisible():
            self._band.hide()
            self.panel.apply_crop_from_band(QRect(self._band_origin, ev.pos()).normalized())
        self._last = None
        super().mouseReleaseEvent(ev)

    def _paint_to(self, pos: QPoint):
        a, b = self._last, pos
        self._last = pos
        if a:
            self.panel.paint_stroke(self.image_point(a), self.image_point(pos))


class PhotoEditorPanel(QWidget):
    def __init__(self, tr=str, parent=None):
        super().__init__(parent)
        self.tr = tr
        self.layers: list[Image.Image] = []
        self.opacity: list[float] = []
        self.active = -1
        self.original: Image.Image | None = None
        self.tool = "none"
        self.brush_color = "#ffffff"
        self.brush_size = 8
        self.display_scale = 1.0
        self.undo = UndoStack(limit=40)
        self.undo.on_change = self.refresh
        self._build()

    # ------------------------------------------------------------------
    def _build(self):
        root = QHBoxLayout(self)
        left = QVBoxLayout()

        io_row = QHBoxLayout()
        b_open = QPushButton("Open image…")
        b_new = QPushButton("New canvas…")
        b_save = QPushButton("Export…")
        b_open.clicked.connect(self.open_image)
        b_new.clicked.connect(self.new_canvas)
        b_save.clicked.connect(self.export_image)
        io_row.addWidget(b_open); io_row.addWidget(b_new); io_row.addWidget(b_save)
        left.addLayout(io_row)

        tools = QGroupBox("Tools")
        tv = QVBoxLayout(tools)
        for name, label in [("brush", "🖌 Brush"), ("eraser", "🧽 Eraser"),
                            ("crop", "✂ Crop (drag on image)")]:
            btn = QPushButton(label)
            btn.setCheckable(True)
            btn.clicked.connect(lambda _=False, n=name: self._set_tool(n))
            btn.setToolTip(f"Activate {label}")
            tv.addWidget(btn)
            setattr(self, f"toolbtn_{name}", btn)
        size_row = QHBoxLayout()
        size_row.addWidget(QLabel("Size"))
        self.size_spin = QSpinBox(); self.size_spin.setRange(1, 200); self.size_spin.setValue(8)
        self.size_spin.valueChanged.connect(lambda v: setattr(self, "brush_size", v))
        color_btn = QPushButton("Colour…")
        color_btn.clicked.connect(self._pick_color)
        size_row.addWidget(self.size_spin); size_row.addWidget(color_btn)
        tv.addLayout(size_row)
        left.addWidget(tools)

        adj = QGroupBox("Adjust (active layer)")
        af = QVBoxLayout(adj)
        self.sliders: dict[str, QSlider] = {}
        for key, label, lo, hi in [("brightness", "Brightness", 20, 300),
                                   ("contrast", "Contrast", 20, 300),
                                   ("saturation", "Saturation", 0, 300),
                                   ("gamma", "Exposure/Gamma", 30, 300),
                                   ("hue", "Hue", -180, 180)]:
            row = QHBoxLayout()
            row.addWidget(QLabel(label))
            s = QSlider(Qt.Horizontal); s.setRange(lo, hi)
            s.setValue(100 if key != "hue" else 0)
            row.addWidget(s, 1)
            af.addLayout(row)
            self.sliders[key] = s
        apply_btn = QPushButton("Apply adjustments")
        apply_btn.clicked.connect(self.apply_adjustments)
        af.addWidget(apply_btn)
        frow = QHBoxLayout()
        self.filter_combo = QComboBox()
        self.filter_combo.addItems(sorted(image_ops.FILTERS))
        f_btn = QPushButton("Apply filter")
        f_btn.clicked.connect(self.apply_filter)
        frow.addWidget(self.filter_combo); frow.addWidget(f_btn)
        af.addLayout(frow)
        left.addWidget(adj)

        retouch = QGroupBox("Retouch / transform")
        rf = QVBoxLayout(retouch)
        for label, slot in [
            ("Remove background (uniform colour)", lambda: self.remove_bg("uniform")),
            ("Remove background (from edges)", lambda: self.remove_bg("edges")),
            ("Rotate 90°", lambda: self.transform("rotate")),
            ("Flip horizontal", lambda: self.transform("flip_h")),
            ("Flip vertical", lambda: self.transform("flip_v")),
            ("Resize…", self.resize_dialog),
            ("Add text…", self.add_text_dialog),
        ]:
            b = QPushButton(label); b.clicked.connect(slot); rf.addWidget(b)
        left.addWidget(retouch)
        left.addStretch(1)

        center = QVBoxLayout()
        self.canvas = CanvasWidget(self)
        center.addWidget(self.canvas, 1)
        bar = QHBoxLayout()
        b_undo = QPushButton("↩ Undo"); b_redo = QPushButton("↪ Redo")
        b_undo.clicked.connect(self.undo.undo); b_redo.clicked.connect(self.undo.redo)
        self.compare = QPushButton("Hold: Before")
        self.compare.setCheckable(True)
        self.compare.pressed.connect(lambda: self._show_compare(True))
        self.compare.released.connect(lambda: self._show_compare(False))
        self.status = QLabel("No image loaded")
        self.status.setObjectName("hint")
        bar.addWidget(b_undo); bar.addWidget(b_redo); bar.addWidget(self.compare)
        bar.addStretch(1); bar.addWidget(self.status)
        center.addLayout(bar)

        right = QVBoxLayout()
        right.addWidget(QLabel("<b>Layers</b> (top = front)"))
        self.layer_list = QListWidget()
        self.layer_list.currentRowChanged.connect(self._layer_selected)
        right.addWidget(self.layer_list, 1)
        lrow = QHBoxLayout()
        b_up = QPushButton("↑"); b_down = QPushButton("↓"); b_del = QPushButton("✕")
        b_up.clicked.connect(lambda: self.move_layer(1))
        b_down.clicked.connect(lambda: self.move_layer(-1))
        b_del.clicked.connect(self.delete_layer)
        lrow.addWidget(b_up); lrow.addWidget(b_down); lrow.addWidget(b_del)
        right.addLayout(lrow)
        orow = QHBoxLayout()
        orow.addWidget(QLabel("Opacity"))
        self.op_slider = QSlider(Qt.Horizontal); self.op_slider.setRange(0, 100)
        self.op_slider.setValue(100)
        self.op_slider.valueChanged.connect(self._opacity_changed)
        orow.addWidget(self.op_slider, 1)
        right.addLayout(orow)
        b_flatten = QPushButton("Flatten to one layer")
        b_flatten.clicked.connect(self.flatten)
        right.addWidget(b_flatten)

        lw = QWidget(); lw.setLayout(left); lw.setMaximumWidth(330)
        rw = QWidget(); rw.setLayout(right); rw.setMaximumWidth(230)
        cw = QWidget(); cw.setLayout(center)
        root.addWidget(lw); root.addWidget(cw, 1); root.addWidget(rw)

    # ------------------------------------------------------------------
    def _set_tool(self, name):
        self.tool = name if self.tool != name else "none"
        for n in ("brush", "eraser", "crop"):
            getattr(self, f"toolbtn_{n}").setChecked(n == self.tool)
        if self.tool in {"brush", "eraser"}:
            self.canvas.setCursor(Qt.CrossCursor)
        else:
            self.canvas.unsetCursor()

    def _pick_color(self):
        c = QColorDialog.getColor()
        if c.isValid():
            self.brush_color = c.name()

    # ---- io -----------------------------------------------------------
    def open_image(self):
        path, _ = QFileDialog.getOpenFileName(
            self, "Open image", "",
            "Images (*.png *.jpg *.jpeg *.webp *.bmp *.tiff *.tif *.gif)")
        if not path:
            return
        try:
            img = image_ops.load_rgba(path)
        except Exception as e:
            QMessageBox.critical(self, self.tr("common.error"), str(e))
            return
        self.layers = [img]
        self.opacity = [1.0]
        self.active = 0
        self.original = img.copy()
        self.undo.clear()
        self.status.setText(f"{Path(path).name} — {img.width}×{img.height}")
        self.refresh()

    def new_canvas(self):
        from PySide6.QtWidgets import QInputDialog
        w, ok = QInputDialog.getInt(self, "New canvas", "Width (px):", 1920, 8, 8192)
        if not ok:
            return
        h, ok = QInputDialog.getInt(self, "New canvas", "Height (px):", 1080, 8, 8192)
        if not ok:
            return
        self.layers = [Image.new("RGBA", (w, h), (255, 255, 255, 255))]
        self.opacity = [1.0]
        self.active = 0
        self.original = self.layers[0].copy()
        self.undo.clear()
        self.refresh()

    def export_image(self):
        if not self.layers:
            return
        path, _ = QFileDialog.getSaveFileName(
            self, "Export image", "image.png",
            "PNG (*.png);;JPEG (*.jpg);;WebP (*.webp);;BMP (*.bmp);;TIFF (*.tiff)")
        if not path:
            return
        try:
            image_ops.save_image(self.composite(), path)
            self.status.setText(f"Saved {Path(path).name}")
        except Exception as e:
            QMessageBox.critical(self, self.tr("common.error"), str(e))

    # ---- document ------------------------------------------------------
    def composite(self) -> Image.Image:
        if not self.layers:
            return Image.new("RGBA", (64, 64), (0, 0, 0, 0))
        w = max(l.width for l in self.layers)
        h = max(l.height for l in self.layers)
        parts = [(l, 0, 0, o) for l, o in zip(self.layers, self.opacity)]
        return image_ops.composite_layers(parts, w, h, background=(0, 0, 0, 0))

    def refresh(self):
        self._refresh_layer_list()
        comp = self.composite()
        qimg = pil_to_qimage(image_ops.make_checker_preview(comp))
        fitted = QPixmap.fromImage(qimg).scaled(
            self.canvas.size(), Qt.KeepAspectRatio, Qt.SmoothTransformation)
        self.display_scale = fitted.width() / max(comp.width, 1)
        self.canvas.setPixmap(fitted)

    def _refresh_layer_list(self):
        self.layer_list.blockSignals(True)
        self.layer_list.clear()
        for i, layer in reversed(list(enumerate(self.layers))):
            item = QListWidgetItem(f"Layer {i + 1}  ({layer.width}×{layer.height})")
            item.setData(Qt.UserRole, i)
            self.layer_list.addItem(item)
        if self.layers:
            self.layer_list.setCurrentRow(len(self.layers) - 1 - self.active)
        self.layer_list.blockSignals(False)

    def _layer_selected(self, row):
        if row < 0 or not self.layers:
            return
        self.active = len(self.layers) - 1 - row
        if 0 <= self.active < len(self.opacity):
            self.op_slider.blockSignals(True)
            self.op_slider.setValue(int(self.opacity[self.active] * 100))
            self.op_slider.blockSignals(False)

    def _opacity_changed(self, v):
        if 0 <= self.active < len(self.opacity):
            self.opacity[self.active] = v / 100
            self.refresh()

    def move_layer(self, delta):
        i = self.active
        j = i + delta
        if not (0 <= i < len(self.layers) and 0 <= j < len(self.layers)):
            return
        snapshot = [l.copy() for l in self.layers], list(self.opacity), i
        self.layers[i], self.layers[j] = self.layers[j], self.layers[i]
        self.opacity[i], self.opacity[j] = self.opacity[j], self.opacity[i]
        self.active = j
        self._push_undo(snapshot, "move layer")

    def delete_layer(self):
        if len(self.layers) <= 1:
            return
        snapshot = [l.copy() for l in self.layers], list(self.opacity), self.active
        self.layers.pop(self.active)
        self.opacity.pop(self.active)
        self.active = min(self.active, len(self.layers) - 1)
        self._push_undo(snapshot, "delete layer")

    def flatten(self):
        if not self.layers:
            return
        snapshot = [l.copy() for l in self.layers], list(self.opacity), self.active
        self.layers = [self.composite()]
        self.opacity = [1.0]
        self.active = 0
        self._push_undo(snapshot, "flatten")

    def _push_undo(self, snapshot, label):
        layers_bak, op_bak, act_bak = snapshot

        def do():
            pass

        def undo():
            cur = [l.copy() for l in self.layers], list(self.opacity), self.active
            self.layers, self.opacity, self.active = [l.copy() for l in layers_bak], list(op_bak), act_bak
            self.refresh()

        self.undo.push(Command(label, do, undo), execute=False)
        self.refresh()

    def _snapshot(self):
        return [l.copy() for l in self.layers], list(self.opacity), self.active

    # ---- operations ------------------------------------------------------
    def _with_active(self, fn, label):
        if not self.layers:
            return
        snap = self._snapshot()
        self.layers[self.active] = fn(self.layers[self.active])
        self._push_undo(snap, label)

    def apply_adjustments(self):
        s = {k: sl.value() for k, sl in self.sliders.items()}
        self._with_active(
            lambda im: image_ops.adjust(
                im, brightness=s["brightness"] / 100, contrast=s["contrast"] / 100,
                saturation=s["saturation"] / 100, gamma=s["gamma"] / 100,
                hue=s["hue"]),
            "adjustments")

    def apply_filter(self):
        name = self.filter_combo.currentText()
        self._with_active(lambda im: image_ops.apply_filter(im, name), f"filter {name}")

    def remove_bg(self, mode):
        if not self.layers:
            return
        snap = self._snapshot()
        layer = self.layers[self.active]
        if mode == "uniform":
            px = layer.convert("RGB").getpixel((0, 0))
            self.layers[self.active] = image_ops.remove_uniform_background(layer, px, 36)
        else:
            self.layers[self.active] = image_ops.remove_edges_background(layer, 40)
        self._push_undo(snap, "remove background")

    def transform(self, kind):
        def fn(im):
            if kind == "rotate":
                return im.rotate(-90, expand=True)
            if kind == "flip_h":
                return im.transpose(Image.FLIP_LEFT_RIGHT)
            return im.transpose(Image.FLIP_TOP_BOTTOM)
        self._with_active(fn, kind)

    def resize_dialog(self):
        if not self.layers:
            return
        from PySide6.QtWidgets import QInputDialog
        w, ok = QInputDialog.getInt(self, "Resize", "New width:", self.layers[self.active].width, 8, 8192)
        if not ok:
            return
        snap = self._snapshot()
        ratio = w / self.layers[self.active].width
        self.layers[self.active] = self.layers[self.active].resize(
            (w, max(1, round(self.layers[self.active].height * ratio))), Image.LANCZOS)
        self._push_undo(snap, "resize")

    def add_text_dialog(self):
        if not self.layers:
            return
        from PySide6.QtWidgets import QInputDialog
        text, ok = QInputDialog.getText(self, "Add text", "Text:")
        if not ok or not text:
            return
        size, ok = QInputDialog.getInt(self, "Add text", "Font size:", 72, 8, 400)
        if not ok:
            return
        snap = self._snapshot()
        layer = self.layers[self.active]
        self.layers[self.active] = image_ops.draw_text(
            layer, text, layer.width // 8, layer.height // 3, size=size,
            color=self.brush_color, outline=max(1, size // 24))
        self._push_undo(snap, "add text")

    def apply_crop_from_band(self, rect: QRect):
        if not self.layers or rect.width() < 4 or rect.height() < 4:
            return
        scale = self.display_scale
        x0 = int(rect.x() / scale - (self.canvas.width() - self.canvas.pixmap().width()) / 2 / scale)
        y0 = int(rect.y() / scale - (self.canvas.height() - self.canvas.pixmap().height()) / 2 / scale)
        x1 = x0 + int(rect.width() / scale)
        y1 = y0 + int(rect.height() / scale)
        snap = self._snapshot()
        for i, layer in enumerate(self.layers):
            box = (max(0, x0), max(0, y0), min(layer.width, x1), min(layer.height, y1))
            if box[2] > box[0] and box[3] > box[1]:
                self.layers[i] = layer.crop(box)
        self._push_undo(snap, "crop")

    def paint_stroke(self, a, b):
        if not self.layers or a is None or b is None:
            return
        layer = self.layers[self.active]
        if not (0 <= a[0] < layer.width and 0 <= a[1] < layer.height):
            return
        draw = ImageDraw.Draw(layer)
        color = self.brush_color if self.tool == "brush" else (0, 0, 0, 0)
        draw.line([a, b], fill=color, width=self.brush_size)
        r = self.brush_size // 2
        draw.ellipse([a[0] - r, a[1] - r, a[0] + r, a[1] + r], fill=color)
        self.refresh()

    def _show_compare(self, show: bool):
        if show and self.original is not None:
            qimg = pil_to_qimage(image_ops.make_checker_preview(self.original))
            self.canvas.setPixmap(QPixmap.fromImage(qimg).scaled(
                self.canvas.size(), Qt.KeepAspectRatio, Qt.SmoothTransformation))
        else:
            self.refresh()
