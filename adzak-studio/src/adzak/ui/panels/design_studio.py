"""Graphic design & thumbnail studio.

Canvas with text / shape / image items, bundled original templates, brand
kits, and real export to PNG / JPG / PDF (via QPainter + QPdfWriter).
"""

from __future__ import annotations

import json
from pathlib import Path

from PySide6.QtCore import QRectF, QSize, Qt
from PySide6.QtGui import (QBrush, QColor, QFont, QImage, QPainter, QPen,
                           QPixmap)
from PySide6.QtWidgets import (
    QComboBox, QFileDialog, QFormLayout, QGroupBox, QHBoxLayout, QLabel,
    QLineEdit, QListWidget, QListWidgetItem, QMessageBox, QPushButton,
    QSpinBox, QVBoxLayout, QWidget, QDoubleSpinBox, QSizePolicy,
)

TEMPLATES_DIR = Path(__file__).resolve().parents[2] / "resources" / "templates"


def load_templates() -> dict[str, dict]:
    out = {}
    for f in sorted(TEMPLATES_DIR.glob("*.json")):
        try:
            out[f.stem] = json.loads(f.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            continue
    return out


class DesignPanel(QWidget):
    def __init__(self, tr=str, parent=None):
        super().__init__(parent)
        self.tr = tr
        self.templates = load_templates()
        self.canvas_w, self.canvas_h = 1280, 720
        self.background = "#ffffff"
        self.items: list[dict] = []
        self.active = -1
        self.display_scale = 0.3
        self._build()
        if self.templates:
            self.apply_template(self.templates[next(iter(self.templates))])

    # ------------------------------------------------------------------
    def _build(self):
        root = QHBoxLayout(self)
        left = QVBoxLayout()

        tpl = QGroupBox("Templates")
        tv = QVBoxLayout(tpl)
        self.tpl_list = QListWidget()
        self.tpl_list.addItems(self.templates)
        self.tpl_list.itemClicked.connect(
            lambda it: self.apply_template(self.templates[it.text()]))
        tv.addWidget(self.tpl_list)
        left.addWidget(tpl)

        addb = QGroupBox("Add")
        av = QHBoxLayout(addb)
        b_text = QPushButton("Text")
        b_rect = QPushButton("Rectangle")
        b_ellipse = QPushButton("Ellipse")
        b_img = QPushButton("Image…")
        b_text.clicked.connect(lambda: self.add_item("text"))
        b_rect.clicked.connect(lambda: self.add_item("rect"))
        b_ellipse.clicked.connect(lambda: self.add_item("ellipse"))
        b_img.clicked.connect(self.add_image_item)
        av.addWidget(b_text); av.addWidget(b_rect)
        av.addWidget(b_ellipse); av.addWidget(b_img)
        left.addWidget(addb)

        props = QGroupBox("Selected item")
        pf = QFormLayout(props)
        self.p_text = QLineEdit()
        self.p_text.editingFinished.connect(self.apply_props)
        self.p_x = QSpinBox(); self.p_x.setRange(0, 8192)
        self.p_y = QSpinBox(); self.p_y.setRange(0, 8192)
        self.p_w = QSpinBox(); self.p_w.setRange(4, 8192)
        self.p_h = QSpinBox(); self.p_h.setRange(4, 8192)
        self.p_size = QSpinBox(); self.p_size.setRange(8, 400)
        self.p_size.setToolTip("Font size for text items")
        for s in (self.p_x, self.p_y, self.p_w, self.p_h, self.p_size):
            s.valueChanged.connect(self.apply_props)
        self.p_color = QPushButton("#222222")
        self.p_color.clicked.connect(self._pick_color)
        self.p_outline = QSpinBox(); self.p_outline.setRange(0, 20)
        self.p_outline.setToolTip("Text outline width / shape border")
        self.p_outline.valueChanged.connect(self.apply_props)
        self.p_shadow = QSpinBox(); self.p_shadow.setRange(0, 40)
        self.p_shadow.valueChanged.connect(self.apply_props)
        pf.addRow("Text", self.p_text)
        pf.addRow("X", self.p_x); pf.addRow("Y", self.p_y)
        pf.addRow("Width", self.p_w); pf.addRow("Height", self.p_h)
        pf.addRow("Font size", self.p_size)
        pf.addRow("Colour", self.p_color)
        pf.addRow("Outline", self.p_outline)
        pf.addRow("Shadow", self.p_shadow)
        left.addWidget(props)

        size_row = QHBoxLayout()
        self.preset_size = QComboBox()
        self.preset_size.addItems([
            "YouTube thumbnail 1280×720", "YouTube banner 2560×1440",
            "Instagram post 1080×1080", "Instagram story 1080×1920",
            "Poster A4 portrait 1240×1754", "Logo square 512×512", "Custom…"])
        self.preset_size.currentIndexChanged.connect(self._canvas_size_changed)
        size_row.addWidget(self.preset_size, 1)
        left.addLayout(size_row)

        brand = QGroupBox("Brand kit")
        bv = QHBoxLayout(brand)
        self.brand_color = QPushButton("#3b6ef5")
        self.brand_color.clicked.connect(self._pick_brand_color)
        b_apply_brand = QPushButton("Use colour")
        b_apply_brand.clicked.connect(self._apply_brand_color)
        bv.addWidget(self.brand_color); bv.addWidget(b_apply_brand)
        left.addWidget(brand)

        b_delete = QPushButton("Delete item")
        b_delete.clicked.connect(self.delete_item)
        left.addWidget(b_delete)
        left.addStretch(1)

        center = QVBoxLayout()
        self.canvas = QLabel(alignment=Qt.AlignCenter)
        self.canvas.setStyleSheet("background:#0c0d10; border-radius:8px;")
        self.canvas.setSizePolicy(QSizePolicy.Expanding, QSizePolicy.Expanding)
        center.addWidget(self.canvas, 1)
        bar = QHBoxLayout()
        b_export = QPushButton(self.tr("export.title"))
        b_export.setObjectName("primary")
        b_export.clicked.connect(self.export_design)
        self.hint = QLabel("Click Export to save PNG / JPG / PDF")
        self.hint.setObjectName("hint")
        bar.addWidget(b_export); bar.addStretch(1); bar.addWidget(self.hint)
        center.addLayout(bar)

        lw = QWidget(); lw.setLayout(left); lw.setMaximumWidth(340)
        cw = QWidget(); cw.setLayout(center)
        root.addWidget(lw); root.addWidget(cw, 1)

    # ------------------------------------------------------------------
    def _canvas_size_changed(self, idx):
        sizes = {0: (1280, 720), 1: (2560, 1440), 2: (1080, 1080),
                 3: (1080, 1920), 4: (1240, 1754), 5: (512, 512)}
        if idx in sizes:
            self.canvas_w, self.canvas_h = sizes[idx]
            self.refresh()
        elif idx == 6:
            from PySide6.QtWidgets import QInputDialog
            w, ok = QInputDialog.getInt(self, "Custom canvas", "Width:", self.canvas_w, 16, 8192)
            if ok:
                h, ok = QInputDialog.getInt(self, "Custom canvas", "Height:", self.canvas_h, 16, 8192)
                if ok:
                    self.canvas_w, self.canvas_h = w, h
                    self.refresh()

    def add_item(self, kind):
        item = {"type": kind, "x": self.canvas_w // 8, "y": self.canvas_h // 3,
                "w": self.canvas_w // 3, "h": self.canvas_h // 6,
                "color": "#222222", "size": 72, "outline": 0, "shadow": 0,
                "text": "Your text" if kind == "text" else ""}
        self.items.append(item)
        self.active = len(self.items) - 1
        self.refresh()

    def add_image_item(self):
        path, _ = QFileDialog.getOpenFileName(self, "Insert image", "",
                                              "Images (*.png *.jpg *.jpeg *.webp *.bmp)")
        if not path:
            return
        self.items.append({"type": "image", "path": path,
                           "x": 40, "y": 40, "w": self.canvas_w // 3,
                           "h": self.canvas_h // 3, "color": "", "size": 0,
                           "outline": 0, "shadow": 0, "text": ""})
        self.active = len(self.items) - 1
        self.refresh()

    def delete_item(self):
        if 0 <= self.active < len(self.items):
            self.items.pop(self.active)
            self.active = len(self.items) - 1
            self.refresh()

    def _pick_color(self):
        from PySide6.QtWidgets import QColorDialog
        c = QColorDialog.getColor()
        if c.isValid() and 0 <= self.active < len(self.items):
            self.items[self.active]["color"] = c.name()
            self.p_color.setText(c.name())
            self.refresh()

    def _pick_brand_color(self):
        from PySide6.QtWidgets import QColorDialog
        c = QColorDialog.getColor()
        if c.isValid():
            self.brand_color.setText(c.name())

    def _apply_brand_color(self):
        if 0 <= self.active < len(self.items):
            self.items[self.active]["color"] = self.brand_color.text()
            self.refresh()

    def apply_props(self):
        if not (0 <= self.active < len(self.items)):
            return
        it = self.items[self.active]
        it.update(text=self.p_text.text(), x=self.p_x.value(), y=self.p_y.value(),
                  w=self.p_w.value(), h=self.p_h.value(), size=self.p_size.value(),
                  outline=self.p_outline.value(), shadow=self.p_shadow.value())
        self.refresh()

    def apply_template(self, tpl: dict):
        self.canvas_w, self.canvas_h = tpl.get("width", 1280), tpl.get("height", 720)
        self.background = tpl.get("background", "#ffffff")
        self.items = json.loads(json.dumps(tpl.get("items", [])))
        self.active = len(self.items) - 1
        self.refresh()

    # ------------------------------------------------------------------
    def render(self, scale: float = 1.0) -> QImage:
        img = QImage(int(self.canvas_w * scale), int(self.canvas_h * scale),
                     QImage.Format_ARGB32)
        img.fill(QColor(self.background))
        p = QPainter(img)
        p.setRenderHint(QPainter.Antialiasing)
        p.setRenderHint(QPainter.SmoothPixmapTransform)
        p.scale(scale, scale)
        for i, it in enumerate(self.items):
            rect = QRectF(it["x"], it["y"], it["w"], it["h"])
            color = QColor(it.get("color") or "#222222")
            if it["type"] == "rect":
                p.setPen(QPen(color.darker(120), max(1, it.get("outline", 0))))
                p.setBrush(QBrush(color))
                p.drawRoundedRect(rect, 8, 8)
            elif it["type"] == "ellipse":
                p.setPen(QPen(color.darker(120), max(1, it.get("outline", 0))))
                p.setBrush(QBrush(color))
                p.drawEllipse(rect)
            elif it["type"] == "image" and Path(it.get("path", "")).is_file():
                pm = QPixmap(it["path"])
                if not pm.isNull():
                    p.drawPixmap(rect.toRect(), pm.scaled(
                        int(it["w"]), int(it["h"]), Qt.KeepAspectRatio,
                        Qt.SmoothTransformation))
            elif it["type"] == "text":
                font = QFont("Segoe UI", int(it.get("size", 48)))
                font.setBold(True)
                p.setFont(font)
                if it.get("shadow"):
                    p.setPen(QPen(QColor(0, 0, 0, 120)))
                    p.drawText(rect.translated(it["shadow"], it["shadow"]),
                               Qt.AlignCenter | Qt.TextWordWrap, it.get("text", ""))
                p.setPen(QPen(color))
                if it.get("outline"):
                    path_font = QFont(font)
                    for dx in (-it["outline"], 0, it["outline"]):
                        for dy in (-it["outline"], 0, it["outline"]):
                            if dx or dy:
                                p.setPen(QPen(QColor("#000000")))
                                p.drawText(rect.translated(dx, dy),
                                           Qt.AlignCenter | Qt.TextWordWrap,
                                           it.get("text", ""))
                    p.setPen(QPen(color))
                p.drawText(rect, Qt.AlignCenter | Qt.TextWordWrap, it.get("text", ""))
        p.end()
        return img

    def refresh(self):
        if 0 <= self.active < len(self.items):
            it = self.items[self.active]
            for spin, key in [(self.p_x, "x"), (self.p_y, "y"), (self.p_w, "w"),
                              (self.p_h, "h"), (self.p_size, "size"),
                              (self.p_outline, "outline"), (self.p_shadow, "shadow")]:
                spin.blockSignals(True); spin.setValue(int(it.get(key, 0)))
                spin.blockSignals(False)
            self.p_text.blockSignals(True); self.p_text.setText(it.get("text", ""))
            self.p_text.blockSignals(False)
            self.p_color.setText(it.get("color") or "#222222")
        img = self.render(1.0)
        fitted = QPixmap.fromImage(img).scaled(self.canvas.size() or QSize(640, 360),
                                               Qt.KeepAspectRatio, Qt.SmoothTransformation)
        self.display_scale = fitted.width() / max(self.canvas_w, 1)
        self.canvas.setPixmap(fitted)

    def resizeEvent(self, ev):
        super().resizeEvent(ev)
        self.refresh()

    # ------------------------------------------------------------------
    def export_design(self):
        path, _ = QFileDialog.getSaveFileName(
            self, self.tr("export.title"), "design.png",
            "PNG (*.png);;JPEG (*.jpg);;PDF (*.pdf)")
        if not path:
            return
        p = Path(path)
        try:
            if p.suffix.lower() == ".pdf":
                from PySide6.QtCore import QMarginsF, QSizeF
                from PySide6.QtGui import QPageLayout, QPageSize, QPdfWriter
                writer = QPdfWriter(str(p))
                size_pt = QSizeF(self.canvas_w * 72 / 96, self.canvas_h * 72 / 96)
                writer.setPageSize(QPageSize(size_pt, QPageSize.Point))
                writer.setPageMargins(QMarginsF(0, 0, 0, 0))
                writer.setResolution(96)
                painter = QPainter(writer)
                img = self.render(1.0)
                painter.drawImage(0, 0, img)
                painter.end()
            else:
                img = self.render(1.0)
                if p.suffix.lower() in {".jpg", ".jpeg"}:
                    img = img.convertToFormat(QImage.Format_RGB32)
                if not img.save(str(p), quality=95):
                    raise RuntimeError("image save failed")
            QMessageBox.information(self, self.tr("common.info"),
                                    self.tr("export.success") + f"\n{p}")
        except Exception as e:
            QMessageBox.critical(self, self.tr("common.error"), str(e))
