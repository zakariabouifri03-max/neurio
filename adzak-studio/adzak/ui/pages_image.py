"""Photo editor and design studio. Both use the layered Document; design adds templates and text effects."""
from __future__ import annotations

from pathlib import Path

from PIL import Image
from PySide6.QtCore import Qt
from PySide6.QtGui import QColor, QImage
from PySide6.QtWidgets import (
    QCheckBox, QColorDialog, QComboBox, QDialog, QDialogButtonBox, QDoubleSpinBox, QFormLayout, QHBoxLayout,
    QInputDialog, QLabel, QLineEdit, QListWidget, QListWidgetItem, QPushButton, QSlider, QSpinBox, QSplitter,
    QVBoxLayout, QWidget,
)

from ..core import projects
from ..core.errors import AppError
from ..core.i18n import tr
from ..core.paths import temp_dir
from ..image.document import FILTERS, Document, apply_adjustments, export_image
from . import common
from .widgets import CanvasView

DESIGN_TEMPLATES = {
    "YouTube thumbnail (1280×720)": (1280, 720),
    "Channel banner (2560×1440)": (2560, 1440),
    "Instagram post (1080×1080)": (1080, 1080),
    "Instagram story (1080×1920)": (1080, 1920),
    "Poster A4 @150 dpi (1240×1754)": (1240, 1754),
    "Flyer A5 @150 dpi (874×1240)": (874, 1240),
    "T-shirt print, transparent (4500×5400)": (4500, 5400),
    "Logo (1024×1024, transparent)": (1024, 1024),
    "Product image (2000×2000)": (2000, 2000),
}


def _open_rgba(path: str) -> Image.Image:
    from ..image.document import _open_image

    return _open_image(path).convert("RGBA")


def _to_qimage(img: Image.Image) -> QImage:
    rgba = img.convert("RGBA")
    data = rgba.tobytes("raw", "RGBA")
    q = QImage(data, rgba.width, rgba.height, rgba.width * 4, QImage.Format_RGBA8888)
    return q.copy()  # detach from the Python buffer


class ExportImageDialog(QDialog):
    def __init__(self, parent, default_name: str):
        super().__init__(parent)
        self.setWindowTitle(tr("export"))
        lay = QFormLayout(self)
        self.fmt = QComboBox()
        self.fmt.addItems(["png", "jpg", "webp", "bmp", "tiff", "pdf"])
        self.quality = QSpinBox(); self.quality.setRange(1, 100); self.quality.setValue(90)
        self.scale = QDoubleSpinBox(); self.scale.setRange(5, 800); self.scale.setValue(100); self.scale.setSuffix(" %")
        self.bg = QLineEdit("#FFFFFF")
        self.out = default_name
        self.out_label = QLabel(default_name)
        self.out_label.setWordWrap(True)
        b = QPushButton("Choose file…")
        b.clicked.connect(self._choose)
        lay.addRow("Format", self.fmt)
        lay.addRow("Quality (JPG/WebP)", self.quality)
        lay.addRow("Size", self.scale)
        lay.addRow("Background for JPG/BMP/PDF", self.bg)
        lay.addRow(b, self.out_label)
        bb = QDialogButtonBox(QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        bb.accepted.connect(self.accept)
        bb.rejected.connect(self.reject)
        lay.addRow(bb)
        self.fmt.currentTextChanged.connect(self._fmt_changed)

    def _fmt_changed(self, fmt: str) -> None:
        self.out = str(Path(self.out).with_suffix("." + fmt))
        self.out_label.setText(self.out)

    def _choose(self) -> None:
        f = common.save_file(self, tr("export"), self.out, f"{self.fmt.currentText().upper()} (*.{self.fmt.currentText()})")
        if f:
            self.out = f
            self.out_label.setText(f)
            ext = Path(f).suffix.lower().lstrip(".")
            if ext in ("png", "jpg", "jpeg", "webp", "bmp", "tif", "tiff", "pdf"):
                idx = self.fmt.findText("jpg" if ext == "jpeg" else ("tiff" if ext == "tif" else ext))
                if idx >= 0:
                    self.fmt.setCurrentIndex(idx)


class ImagePage(QWidget):
    def __init__(self, parent, db, settings_getter):
        super().__init__(parent)
        self.db = db
        self._settings = settings_getter
        self.doc: Document | None = None
        self.original: Image.Image | None = None
        self.path = ""
        self.name = "Untitled"
        self.dirty = False
        self.design_name = ""
        self._stroke: list[tuple[int, int]] = []
        self._drag_start: tuple[int, int] | None = None
        self._build()
        self._set_enabled(False)

    # ------------------------------------------------------------ UI
    def _build(self) -> None:
        root = QVBoxLayout(self)
        top = QHBoxLayout()
        self.btn_open = QPushButton("Open image")
        self.btn_new_photo = QPushButton("New photo canvas")
        self.template = QComboBox(); self.template.addItems(list(DESIGN_TEMPLATES) + ["Custom size…"])
        self.btn_new_design = QPushButton("New design from template")
        self.btn_undo = QPushButton("Undo"); self.btn_redo = QPushButton("Redo")
        self.compare = QCheckBox("Before / after")
        self.compare.setToolTip("Show the original image instead of the edited result")
        self.btn_export = QPushButton(tr("export")); self.btn_export.setObjectName("primary")
        self.btn_save = QPushButton("Save project (.adzimg)")
        for w in (self.btn_open, self.btn_new_photo, self.template, self.btn_new_design, self.btn_undo,
                  self.btn_redo, self.compare):
            top.addWidget(w)
        top.addStretch(1)
        top.addWidget(self.btn_save)
        top.addWidget(self.btn_export)
        root.addLayout(top)

        split = QSplitter(Qt.Horizontal)
        left = QWidget(); lv = QVBoxLayout(left)
        lv.addWidget(QLabel("Layers (top = front)"))
        self.layers = QListWidget()
        self.layers.setToolTip("Select a layer. Untick the box to hide it.")
        lv.addWidget(self.layers, 1)
        grid = QHBoxLayout()
        self.btn_layer_up = QPushButton("▲"); self.btn_layer_up.setToolTip("Move layer up")
        self.btn_layer_dn = QPushButton("▼"); self.btn_layer_dn.setToolTip("Move layer down")
        self.btn_dup = QPushButton("Duplicate"); self.btn_del = QPushButton("Delete")
        self.btn_merge = QPushButton("Merge down")
        for w in (self.btn_layer_up, self.btn_layer_dn, self.btn_dup, self.btn_del, self.btn_merge):
            grid.addWidget(w)
        lv.addLayout(grid)
        add = QHBoxLayout()
        self.btn_add_img = QPushButton("Add image"); self.btn_add_text = QPushButton("Add text")
        self.btn_add_rect = QPushButton("Rectangle"); self.btn_add_ellipse = QPushButton("Ellipse")
        self.btn_add_adj = QPushButton("Adjustment")
        for w in (self.btn_add_img, self.btn_add_text, self.btn_add_rect, self.btn_add_ellipse, self.btn_add_adj):
            add.addWidget(w)
        lv.addLayout(add)
        split.addWidget(left)

        mid = QWidget(); mv = QVBoxLayout(mid)
        tools = QHBoxLayout()
        self.tool = QComboBox(); self.tool.addItems(["Select area", "Brush", "Eraser"])
        self.tool.setToolTip("Select area: drag on the image to choose a region. Brush/Eraser paint on the active layer.")
        self.color_btn = QPushButton("Colour"); self.color = QColor("#FF3B30")
        self.size = QSpinBox(); self.size.setRange(1, 500); self.size.setValue(18); self.size.setSuffix(" px")
        self.lbl_status = QLabel(tr("ready")); self.lbl_status.setObjectName("muted")
        for w in (QLabel("Tool"), self.tool, self.color_btn, QLabel("Size"), self.size):
            tools.addWidget(w)
        tools.addStretch(1)
        tools.addWidget(self.lbl_status)
        mv.addLayout(tools)
        self.canvas = CanvasView()
        self.canvas.setToolTip("Drag to select or paint. Ctrl+Z undoes.")
        mv.addWidget(self.canvas, 1)
        split.addWidget(mid)

        right = QWidget(); rv = QVBoxLayout(right)
        rv.addWidget(QLabel("Adjustments (on active pixel layer or as adjustment layer)"))
        self.sl = {}
        for key, lo, hi in (("brightness", -100, 100), ("contrast", -100, 100), ("saturation", -100, 100),
                            ("hue", -180, 180)):
            row = QHBoxLayout(); s = QSlider(Qt.Horizontal); s.setRange(lo, hi); s.setValue(0)
            s.setToolTip(f"{key.title()} (live when applied as an adjustment layer)")
            lbl = QLabel(key.title()); lbl.setMinimumWidth(80)
            row.addWidget(lbl); row.addWidget(s)
            rv.addLayout(row)
            self.sl[key] = s
        self.btn_apply_adj = QPushButton("Apply as adjustment layer")
        rv.addWidget(self.btn_apply_adj)
        rv.addWidget(QLabel("Filter"))
        fr = QHBoxLayout()
        self.filter = QComboBox(); self.filter.addItems(list(FILTERS))
        self.btn_filter = QPushButton("Apply filter")
        fr.addWidget(self.filter); fr.addWidget(self.btn_filter)
        rv.addLayout(fr)
        rv.addWidget(QLabel("Transform"))
        self.btn_crop = QPushButton("Crop to selection")
        self.btn_rot = QPushButton("Rotate 90° clockwise")
        self.btn_rot_ccw = QPushButton("Rotate 90° counter-clockwise")
        self.btn_resize = QPushButton("Resize canvas…")
        for w in (self.btn_crop, self.btn_rot, self.btn_rot_ccw, self.btn_resize):
            rv.addWidget(w)
        rv.addWidget(QLabel("Selection edits"))
        self.btn_fill = QPushButton("Fill selection with colour")
        self.btn_clear = QPushButton("Erase selection")
        self.btn_bg = QPushButton("Remove background (grab subject)")
        self.btn_bg.setToolTip("Select a box around the subject, then press. Works best with clear contrast.")
        self.btn_inpaint = QPushButton("Remove object (inpaint)")
        self.btn_inpaint.setToolTip("Select the object to remove; its area is filled from surroundings.")
        self.btn_mask = QPushButton("Use selection as layer mask")
        self.btn_text_fx = QPushButton("Text effects…")
        self.btn_text_fx.setToolTip("Edit the selected text layer's outline and shadow")
        for w in (self.btn_fill, self.btn_clear, self.btn_bg, self.btn_inpaint, self.btn_mask, self.btn_text_fx):
            rv.addWidget(w)
        rv.addStretch(1)
        split.addWidget(right)
        split.setSizes([260, 760, 280])
        root.addWidget(split, 1)

        self.btn_open.clicked.connect(self.open_image)
        self.btn_new_photo.clicked.connect(self.new_photo)
        self.btn_new_design.clicked.connect(self.new_design)
        self.btn_undo.clicked.connect(self.undo)
        self.btn_redo.clicked.connect(self.redo)
        self.compare.toggled.connect(lambda *_: self.refresh())
        self.btn_export.clicked.connect(self.export)
        self.btn_save.clicked.connect(self.save_project)
        self.layers.currentRowChanged.connect(self._layer_selected)
        self.layers.itemChanged.connect(self._layer_visibility)
        self.btn_layer_up.clicked.connect(lambda: self._doc_op(lambda d: d.move_layer(d.active, -1)))
        self.btn_layer_dn.clicked.connect(lambda: self._doc_op(lambda d: d.move_layer(d.active, 1)))
        self.btn_dup.clicked.connect(lambda: self._doc_op(lambda d: d.duplicate_layer(d.active)))
        self.btn_del.clicked.connect(lambda: self._doc_op(lambda d: d.delete_layer(d.active)))
        self.btn_merge.clicked.connect(lambda: self._doc_op(lambda d: d.merge_down(d.active)))
        self.btn_add_img.clicked.connect(self._add_image)
        self.btn_add_text.clicked.connect(self._add_text)
        self.btn_add_rect.clicked.connect(lambda: self._doc_op(lambda d: d.add_shape_layer("rectangle", self._default_box(), self.color.name())))
        self.btn_add_ellipse.clicked.connect(lambda: self._doc_op(lambda d: d.add_shape_layer("ellipse", self._default_box(), self.color.name())))
        self.btn_add_adj.clicked.connect(lambda: self._doc_op(lambda d: d.add_adjust_layer(**self._adj_values())))
        self.btn_apply_adj.clicked.connect(lambda: self._doc_op(lambda d: self._apply_adj_now(d)))
        self.btn_filter.clicked.connect(self._apply_filter)
        self.btn_crop.clicked.connect(lambda: self._doc_op(self._crop))
        self.btn_rot.clicked.connect(lambda: self._doc_op(lambda d: d.rotate(90)))
        self.btn_rot_ccw.clicked.connect(lambda: self._doc_op(lambda d: d.rotate(-90)))
        self.btn_resize.clicked.connect(self._resize_canvas)
        self.btn_fill.clicked.connect(lambda: self._doc_op(lambda d: d.fill_selection(self.color.name())))
        self.btn_clear.clicked.connect(lambda: self._doc_op(lambda d: d.delete_selection()))
        self.btn_bg.clicked.connect(self._remove_bg)
        self.btn_inpaint.clicked.connect(self._inpaint)
        self.btn_mask.clicked.connect(lambda: self._doc_op(lambda d: d.set_mask_from_selection()))
        self.btn_text_fx.clicked.connect(self._text_fx)
        self.btn_filter.setEnabled(True)
        self.color_btn.clicked.connect(self._pick_color)
        self.canvas.pressed.connect(self._press)
        self.canvas.moved.connect(self._move)
        self.canvas.released.connect(self._release)

    def _set_enabled(self, on: bool) -> None:
        for w in (self.btn_undo, self.btn_redo, self.btn_export, self.btn_save, self.layers, self.btn_layer_up,
                  self.btn_layer_dn, self.btn_dup, self.btn_del, self.btn_merge, self.btn_add_img,
                  self.btn_add_text, self.btn_add_rect, self.btn_add_ellipse, self.btn_add_adj,
                  self.btn_apply_adj, self.btn_filter, self.btn_crop, self.btn_rot, self.btn_rot_ccw,
                  self.btn_resize, self.btn_fill, self.btn_clear, self.btn_bg, self.btn_inpaint, self.btn_mask,
                  self.btn_text_fx, self.canvas, self.compare, self.tool, self.size, self.color_btn):
            w.setEnabled(on)

    # ---------------------------------------------------------- docs
    def _default_box(self) -> tuple[int, int, int, int]:
        d = self.doc
        return (d.width // 4, d.height // 4, 3 * d.width // 4, 3 * d.height // 4)

    def _adj_values(self) -> dict:
        return {k: s.value() / 100.0 if k != "hue" else float(s.value()) for k, s in self.sl.items()}

    def _apply_adj_now(self, d: Document) -> None:
        layer = d.active_raster()
        d._checkpoint()
        layer.image = apply_adjustments(layer.image, self._adj_values())

    def _set_doc(self, doc: Document, name: str, path: str = "") -> None:
        self.doc = doc
        self.original = doc.composite()
        self.name = name
        self.path = path
        self.dirty = False
        self.lbl_status.setText(f"{name} · {doc.width}×{doc.height}")
        self._set_enabled(True)
        self._refresh_layers()
        self.refresh()

    def new_photo(self) -> None:
        w, h = 1920, 1080
        text, ok = QInputDialog.getText(self, "New photo canvas", "Size as WIDTHxHEIGHT:", text="1920x1080")
        if ok:
            try:
                w, h = (int(v) for v in text.lower().replace("×", "x").split("x"))
                self._set_doc(Document(w, h, background="#FFFFFF"), "Untitled photo")
            except (ValueError, AppError) as exc:
                common.error(self, getattr(exc, "user_message", "Use the form WIDTHxHEIGHT, e.g. 1920x1080."))

    def new_design(self) -> None:
        choice = self.template.currentText()
        if choice == "Custom size…":
            text, ok = QInputDialog.getText(self, "Custom size", "WIDTHxHEIGHT in pixels:", text="1280x720")
            if not ok:
                return
            try:
                w, h = (int(v) for v in text.lower().replace("×", "x").split("x"))
            except ValueError:
                common.error(self, "Use the form WIDTHxHEIGHT, e.g. 1280x720.")
                return
        else:
            w, h = DESIGN_TEMPLATES[choice]
        bg = "transparent" if "transparent" in choice else "#1C1C1E"
        try:
            doc = Document(w, h, background=bg)
        except AppError as exc:
            common.error(self, exc.user_message)
            return
        doc.add_text_layer("YOUR TITLE", size=max(24, h // 8), color="#FFFFFF", stroke=max(2, h // 150),
                           stroke_color="#000000", shadow=max(2, h // 200), position="center")
        self._set_doc(doc, choice.split(" (")[0])
        self.design_name = choice
        self.dirty = True

    def open_image(self) -> None:
        f = common.open_file(self, tr("open_project"), "Images or ADZAK image projects (*.adzimg *.png *.jpg *.jpeg *.webp *.bmp *.tif *.tiff);;All files (*)")
        if f:
            self.open_image_file(f)

    def open_image_file(self, f: str) -> None:
        try:
            if f.endswith(projects.IMAGE_EXT):
                self.open_project(f)
                return
            w, h = self._img_size(f)
            doc = Document(w, h, background="transparent")
            doc.layers[0].image = _open_rgba(f)
            doc.layers[0].name = Path(f).stem
            self._set_doc(doc, Path(f).stem)
            self.dirty = False
        except AppError as exc:
            common.error(self, exc.user_message)

    def open_project(self, path: str) -> None:
        try:
            doc = Document.load(path)
        except AppError as exc:
            common.error(self, exc.user_message)
            return
        self._set_doc(doc, Path(path).stem, path)
        self.db.upsert_project(self.name, "image", path)

    def _img_size(self, f: str) -> tuple[int, int]:
        try:
            with Image.open(f) as im:
                return im.size
        except Exception as exc:  # noqa: BLE001
            raise AppError(f"Could not open image: {Path(f).name}") from exc

    def _add_image(self) -> None:
        f = common.open_file(self, tr("import"), common.IMAGE_FILTER)
        if f:
            self._doc_op(lambda d: d.add_image_layer(f))

    def _add_text(self) -> None:
        text, ok = QInputDialog.getMultiLineText(self, "Add text", "Text:")
        if ok and text.strip():
            self._doc_op(lambda d: d.add_text_layer(text.strip(), size=max(16, d.height // 12),
                                                     color=self.color.name()))

    def _text_fx(self) -> None:
        d = self.doc
        if not d or d.active < 0 or d.layers[d.active].kind != "text":
            common.info(self, "Select a text layer first.")
            return
        layer = d.layers[d.active]
        stroke, ok = QInputDialog.getInt(self, "Text outline", "Outline width (px):",
                                         int(layer.params.get("stroke", 0)), 0, 60)
        if not ok:
            return
        shadow, ok = QInputDialog.getInt(self, "Text shadow", "Shadow offset (px):",
                                         int(layer.params.get("shadow", 0)), 0, 60)
        if not ok:
            return
        text = layer.params.get("text", "")
        size = int(layer.params.get("size", 96))
        color = layer.params.get("color", "#FFFFFF")
        position = layer.params.get("position", "center")

        def apply(doc: Document) -> None:
            idx = doc.active
            doc.delete_layer(idx)
            doc.add_text_layer(text, size=size, color=color, stroke=stroke, shadow=shadow, position=position)
            for _ in range(len(doc.layers)):  # move the new layer back to its original index
                if doc.active <= idx:
                    break
                doc.move_layer(doc.active, -1)
        self._doc_op(apply)

    def _pick_color(self) -> None:
        c = QColorDialog.getColor(self.color, self, "Colour")
        if c.isValid():
            self.color = c
            self.color_btn.setStyleSheet(f"background:{c.name()};")

    def _crop(self, d: Document) -> None:
        if not d.selection:
            raise AppError("Select the area to keep first (drag on the image).")
        d.crop(d.selection)

    def _resize_canvas(self) -> None:
        if not self.doc:
            return
        text, ok = QInputDialog.getText(self, "Resize canvas", "New WIDTHxHEIGHT:",
                                        text=f"{self.doc.width}x{self.doc.height}")
        if not ok:
            return
        try:
            w, h = (int(v) for v in text.lower().replace("×", "x").split("x"))
        except ValueError:
            common.error(self, "Use the form WIDTHxHEIGHT.")
            return
        self._doc_op(lambda d: d.resize(w, h))

    def _apply_filter(self) -> None:
        name = self.filter.currentText()
        self._doc_op(lambda d: d.apply_filter(name, radius=4))

    def _remove_bg(self) -> None:
        self._doc_op(lambda d: d.remove_background(), busy="Removing background…")

    def _inpaint(self) -> None:
        self._doc_op(lambda d: d.inpaint_selection(radius=5), busy="Filling area…")

    def _doc_op(self, fn, busy: str = "") -> None:
        """Apply fn(doc) with error handling; refresh afterwards."""
        if not self.doc:
            return
        try:
            fn(self.doc)
        except AppError as exc:
            common.error(self, exc.user_message)
            return
        except (ValueError, IndexError) as exc:
            common.error(self, str(exc))
            return
        self.dirty = True
        self._refresh_layers()
        self.refresh()

    def undo(self) -> None:
        if self.doc and self.doc.undo():
            self.dirty = True
            self._refresh_layers()
            self.refresh()

    def redo(self) -> None:
        if self.doc and self.doc.redo():
            self.dirty = True
            self._refresh_layers()
            self.refresh()

    # ---------------------------------------------------- canvas input
    def _press(self, x: int, y: int) -> None:
        if not self.doc:
            return
        mode = self.tool.currentText()
        self._drag_start = (x, y)
        if mode == "Select area":
            self.doc.selection = (x, y, x + 1, y + 1)
        else:
            self._stroke = [(x, y)]
        self.refresh()

    def _move(self, x: int, y: int) -> None:
        if not self.doc or self._drag_start is None:
            return
        mode = self.tool.currentText()
        if mode == "Select area":
            x0, y0 = self._drag_start
            self.doc.selection = (min(x0, x), min(y0, y), max(x0, x) + 1, max(y0, y) + 1)
            self.refresh()
        else:
            self._stroke.append((x, y))
            self.refresh()

    def _release(self, x: int, y: int) -> None:
        if not self.doc or self._drag_start is None:
            return
        mode = self.tool.currentText()
        if mode != "Select area" and self._stroke:
            try:
                self.doc.brush(self._stroke, color=self.color.name(), size=self.size.value(),
                               erase=(mode == "Eraser"))
                self.dirty = True
            except AppError as exc:
                common.error(self, exc.user_message)
        self._stroke = []
        self._drag_start = None
        self._refresh_layers()
        self.refresh()

    # ----------------------------------------------------------- render
    def refresh(self) -> None:
        if not self.doc:
            self.canvas.set_image(None, 1, 1)
            return
        base = self.original if (self.compare.isChecked() and self.original) else self.doc.composite()
        img = base.copy()
        if self.doc.selection and not self.compare.isChecked():
            from PIL import ImageDraw
            d = ImageDraw.Draw(img)
            x1, y1, x2, y2 = self.doc.selection
            d.rectangle([x1, y1, x2 - 1, y2 - 1], outline=(255, 210, 0, 255), width=max(2, img.width // 400))
        if self._stroke and not self.compare.isChecked():
            from PIL import ImageDraw
            d = ImageDraw.Draw(img)
            d.line(self._stroke, fill=self.color.getRgb(), width=max(1, self.size.value()))
        self.canvas.set_image(_to_qimage(img), img.width, img.height)

    def _refresh_layers(self) -> None:
        self.layers.blockSignals(True)
        self.layers.clear()
        if self.doc:
            for i, layer in reversed(list(enumerate(self.doc.layers))):
                item = QListWidgetItem(f"{layer.name}  [{layer.kind}]")
                item.setData(Qt.UserRole, i)
                item.setFlags(item.flags() | Qt.ItemIsUserCheckable)
                item.setCheckState(Qt.Checked if layer.visible else Qt.Unchecked)
                self.layers.addItem(item)
            if self.doc.active >= 0:
                row = self.layers.count() - 1 - self.doc.active
                self.layers.setCurrentRow(row)
        self.layers.blockSignals(False)

    def _layer_selected(self, row: int) -> None:
        if not self.doc or row < 0:
            return
        item = self.layers.item(row)
        if item is not None:
            self.doc.active = item.data(Qt.UserRole)

    def _layer_visibility(self, item: QListWidgetItem) -> None:
        if not self.doc:
            return
        idx = item.data(Qt.UserRole)
        self.doc.layers[idx].visible = item.checkState() == Qt.Checked
        self.dirty = True
        self.refresh()

    # ---------------------------------------------------------- I/O
    def export(self) -> None:
        if not self.doc:
            return
        dlg = ExportImageDialog(self, self.name + ".png")
        if dlg.exec() != QDialog.Accepted:
            return
        try:
            export_image(self.doc, dlg.out, scale=dlg.scale.value() / 100.0, quality=dlg.quality.value(),
                         background=dlg.bg.text().strip() or "#FFFFFF")
            common.info(self, f"Exported:\n{dlg.out}")
        except AppError as exc:
            common.error(self, exc.user_message)

    def save_project(self) -> bool:
        if not self.doc:
            return False
        path = self.path or common.save_file(self, tr("save"), f"{self.name}{projects.IMAGE_EXT}",
                                             f"ADZAK image project (*{projects.IMAGE_EXT})")
        if not path:
            return False
        if not path.endswith(projects.IMAGE_EXT):
            path += projects.IMAGE_EXT
        try:
            self.doc.save(path)
        except (AppError, OSError) as exc:
            common.error(self, getattr(exc, "user_message", str(exc)))
            return False
        self.path = path
        self.name = Path(path).stem
        self.dirty = False
        self.db.upsert_project(self.name, "image", path)
        return True

    def autosave_payload(self) -> dict | None:
        if not self.doc or not self.dirty:
            return None
        tmp = temp_dir() / "autosave-image.adzimg"
        self.doc.save(tmp)
        return {"kind": "image", "name": self.name, "path": self.path, "file": str(tmp)}

    def restore_payload(self, payload: dict) -> None:
        doc = Document.load(payload["file"])
        self._set_doc(doc, payload.get("name", "Recovered"), payload.get("path", ""))
        self.dirty = True
