"""Layers panel: unlimited layers, groups, blend modes, clipping, alpha lock."""
from __future__ import annotations

from PySide6.QtCore import QSize, Qt, Signal
from PySide6.QtGui import QColor, QPixmap
from PySide6.QtWidgets import (QAbstractItemView, QCheckBox, QComboBox, QDoubleSpinBox,
                               QFrame, QHBoxLayout, QInputDialog, QLabel, QLineEdit, QListWidget,
                               QListWidgetItem, QMenu, QPushButton, QSlider, QToolButton,
                               QVBoxLayout, QWidget)

from ..model.layer import BLEND_MODES, Layer
from .theme import C, get_icon


class LayerItemWidget(QWidget):
    def __init__(self, session, layer: Layer, parent=None):
        super().__init__(parent)
        self.session = session
        self.layer = layer
        self.setFixedHeight(28)
        lay = QHBoxLayout(self)
        lay.setContentsMargins(4, 1, 4, 1)
        lay.setSpacing(4)

        self.color_btn = QToolButton()
        self.color_btn.setFixedSize(8, 20)
        self.color_btn.setStyleSheet(f"background:{layer.color_tag};border-radius:3px;")
        self.color_btn.setToolTip("Layer colour tag")
        self.color_btn.clicked.connect(self._pick_color)
        lay.addWidget(self.color_btn)

        self.vis = QToolButton()
        self.vis.setIcon(get_icon("eye" if layer.visible else "eye_off",
                                  C.text if layer.visible else C.text_faint))
        self.vis.setIconSize(QSize(15, 15))
        self.vis.setCheckable(True)
        self.vis.setChecked(layer.visible)
        self.vis.setToolTip("Show / hide layer (Shift+click to solo)")
        self.vis.clicked.connect(self._toggle_visible)
        lay.addWidget(self.vis)

        self.lock = QToolButton()
        self.lock.setIcon(get_icon("lock" if layer.locked else "unlock",
                                   C.warn if layer.locked else C.text_faint))
        self.lock.setIconSize(QSize(15, 15))
        self.lock.setToolTip("Lock layer")
        self.lock.clicked.connect(self._toggle_lock)
        lay.addWidget(self.lock)

        self.name = QLabel(layer.name)
        self.name.setToolTip(f"{layer.kind} layer · {len(layer.cels)} frame(s)")
        lay.addWidget(self.name, 1)

        self.kind = QLabel(layer.kind[:3].upper())
        self.kind.setObjectName("hint")
        self.kind.setStyleSheet(f"color:{C.text_faint};font-size:9px;")
        lay.addWidget(self.kind)

    def _pick_color(self) -> None:
        from PySide6.QtWidgets import QColorDialog
        color = QColorDialog.getColor(QColor(self.layer.color_tag), self, "Layer colour")
        if color.isValid():
            self.session.set_layer_prop(self.layer.uid, "color_tag", color.name(), "Layer colour")

    def _toggle_visible(self) -> None:
        if self.session.tool == "select":
            pass
        self.session.set_layer_prop(self.layer.uid, "visible", not self.layer.visible,
                                    "Toggle visibility")

    def _toggle_lock(self) -> None:
        self.session.set_layer_prop(self.layer.uid, "locked", not self.layer.locked, "Toggle lock")


class LayersPanel(QWidget):
    """The layer stack with full management."""

    def __init__(self, session, parent=None):
        super().__init__(parent)
        self.session = session
        self.setAcceptDrops(True)
        self._updating = False
        root = QVBoxLayout(self)
        root.setContentsMargins(6, 6, 6, 6)
        root.setSpacing(5)

        header = QHBoxLayout()
        title = QLabel("Layers")
        title.setObjectName("section")
        header.addWidget(title)
        header.addStretch(1)
        for icon_name, tip, slot in (
            ("add", "New raster layer (Ctrl+Shift+N)", lambda: session.add_layer("raster")),
            ("duplicate", "Duplicate layer", lambda: session.duplicate_layer()),
            ("layers", "New group", lambda: session.add_layer("group")),
            ("trash", "Delete layer", lambda: session.remove_layer()),
        ):
            btn = QToolButton()
            btn.setIcon(get_icon(icon_name, C.text_dim))
            btn.setIconSize(QSize(15, 15))
            btn.setToolTip(tip)
            btn.clicked.connect(slot)
            header.addWidget(btn)
        root.addLayout(header)

        self.list = QListWidget()
        self.list.setSelectionMode(QAbstractItemView.SingleSelection)
        self.list.setDragDropMode(QAbstractItemView.InternalMove)
        self.list.setDefaultDropAction(Qt.MoveAction)
        self.list.setUniformItemSizes(True)
        self.list.setContextMenuPolicy(Qt.CustomContextMenu)
        self.list.customContextMenuRequested.connect(self._context_menu)
        self.list.currentItemChanged.connect(self._on_current)
        self.list.model().rowsMoved.connect(self._on_rows_moved)
        root.addWidget(self.list, 1)

        self._build_bottom(root)

        session.layers_changed.connect(self.rebuild)
        session.scene_changed.connect(self.rebuild)
        session.project_changed.connect(self.rebuild)
        self.rebuild()

    def _build_bottom(self, root: QVBoxLayout) -> None:
        frame = QFrame()
        frame.setObjectName("card")
        lay = QVBoxLayout(frame)
        lay.setContentsMargins(8, 6, 8, 6)
        lay.setSpacing(4)

        row = QHBoxLayout()
        row.addWidget(QLabel("Blend"))
        self.blend = QComboBox()
        for key, label in BLEND_MODES:
            self.blend.addItem(label, key)
        self.blend.setToolTip("Layer blend mode")
        self.blend.currentIndexChanged.connect(
            lambda: self._set_prop("blend_mode", self.blend.currentData()))
        row.addWidget(self.blend, 1)
        lay.addLayout(row)

        row2 = QHBoxLayout()
        row2.addWidget(QLabel("Opacity"))
        self.opacity = QSlider(Qt.Horizontal)
        self.opacity.setRange(0, 100)
        self.opacity.setToolTip("Layer opacity")
        self.opacity.valueChanged.connect(self._opacity_changed)
        row2.addWidget(self.opacity, 1)
        self.opacity_label = QLabel("100%")
        self.opacity_label.setFixedWidth(38)
        row2.addWidget(self.opacity_label)
        lay.addLayout(row2)

        toggles = QHBoxLayout()
        self.clip = QCheckBox("Clipping")
        self.clip.setToolTip("Clip this layer to the one below")
        self.clip.clicked.connect(lambda: self._set_prop("clipping", self.clip.isChecked()))
        toggles.addWidget(self.clip)
        self.alpha_lock = QCheckBox("Alpha lock")
        self.alpha_lock.setToolTip("Only paint where pixels already exist")
        self.alpha_lock.clicked.connect(
            lambda: self._set_prop("alpha_lock", self.alpha_lock.isChecked()))
        toggles.addWidget(self.alpha_lock)
        toggles.addStretch(1)
        lay.addLayout(toggles)
        root.addWidget(frame)

    # ------------------------------------------------------------------ list
    def rebuild(self) -> None:
        if self._updating:
            return
        self._updating = True
        try:
            self.list.clear()
            layers = list(reversed(self.session.scene.layers))
            for layer in layers:
                item = QListWidgetItem()
                item.setData(Qt.UserRole, layer.uid)
                item.setSizeHint(QSize(0, 30))
                self.list.addItem(item)
                widget = LayerItemWidget(self.session, layer)
                self.list.setItemWidget(item, widget)
                depth = self._depth(layer)
                if depth:
                    item.setSizeHint(QSize(0, 30))
                    widget.setStyleSheet(f"padding-left:{depth * 12}px;")
                if layer.uid == self.session.active_layer_uid:
                    self.list.setCurrentItem(item)
            self._sync_bottom()
        finally:
            self._updating = False

    def _depth(self, layer: Layer) -> int:
        depth = 0
        parent = layer.parent_uid
        guard = 0
        while parent and guard < 32:
            p = self.session.scene.layer(parent)
            if p is None:
                break
            depth += 1
            parent = p.parent_uid
            guard += 1
        return depth

    def current_layer(self) -> Layer | None:
        item = self.list.currentItem()
        if item is None:
            return None
        return self.session.scene.layer(item.data(Qt.UserRole))

    def _on_current(self, current, previous) -> None:
        if self._updating or current is None:
            return
        uid = current.data(Qt.UserRole)
        self.session.active_layer_uid = uid
        self.session.layer_selected.emit(uid)
        self._sync_bottom()
        self.session.canvas_changed.emit()

    def _on_rows_moved(self, *args) -> None:
        if self._updating:
            return
        # translate the visual order (top first) back to scene order (bottom first)
        uids = [self.list.item(i).data(Qt.UserRole) for i in range(self.list.count())]
        scene = self.session.scene
        order = [u for u in reversed(uids)]
        index_map = {uid: i for i, uid in enumerate(order)}
        scene.layers.sort(key=lambda l: index_map.get(l.uid, 999))
        self.session.command("Reorder layers", lambda: None, lambda: None)
        self.session.layers_changed.emit()
        self.session.canvas_changed.emit()

    def _sync_bottom(self) -> None:
        layer = self.current_layer()
        if layer is None:
            return
        self._updating = True
        try:
            idx = self.blend.findData(layer.blend_mode)
            self.blend.setCurrentIndex(max(0, idx))
            self.opacity.setValue(int(layer.opacity))
            self.opacity_label.setText(f"{int(layer.opacity)}%")
            self.clip.setChecked(layer.clipping)
            self.alpha_lock.setChecked(layer.alpha_lock)
        finally:
            self._updating = False

    def _opacity_changed(self, value: int) -> None:
        if self._updating:
            return
        layer = self.current_layer()
        if layer is None:
            return
        self.opacity_label.setText(f"{value}%")
        self.session.set_layer_prop(layer.uid, "opacity", float(value), "Layer opacity", merge=True)

    def _set_prop(self, prop: str, value) -> None:
        if self._updating:
            return
        layer = self.current_layer()
        if layer is None:
            return
        self.session.set_layer_prop(layer.uid, prop, value)

    # -------------------------------------------------------------- context
    def _context_menu(self, pos) -> None:
        item = self.list.itemAt(pos)
        layer = self.session.scene.layer(item.data(Qt.UserRole)) if item else None
        menu = QMenu(self)
        menu.addAction("New raster layer", lambda: self.session.add_layer("raster"))
        menu.addAction("New vector layer", lambda: self.session.add_layer("vector"))
        menu.addAction("New group", lambda: self.session.add_layer("group"))
        menu.addAction("New text layer", lambda: self.session.add_layer("text"))
        if layer is not None:
            menu.addSeparator()
            menu.addAction("Rename…", lambda: self._rename(layer))
            menu.addAction("Duplicate", lambda: self.session.duplicate_layer(layer.uid))
            menu.addAction("Delete", lambda: self.session.remove_layer(layer.uid))
            menu.addSeparator()
            merge = menu.addAction("Merge down", lambda: self.merge_down(layer))
            merge.setEnabled(self.session.scene.layer_index(layer.uid) > 0)
            menu.addAction("Convert to vector", lambda: self.convert_to_vector(layer))
            menu.addSeparator()
            sub = menu.addMenu("Move to group")
            sub.addAction("Top level", lambda: self.session.set_layer_parent(layer.uid, None))
            for other in self.session.scene.layers:
                if other.kind == "group" and other.uid != layer.uid:
                    sub.addAction(other.name,
                                  lambda u=other.uid: self.session.set_layer_parent(layer.uid, u))
            menu.addSeparator()
            menu.addAction("Flatten group", lambda: self.flatten_group(layer))
        menu.exec(self.list.mapToGlobal(pos))

    def _rename(self, layer: Layer) -> None:
        name, ok = QInputDialog.getText(self, "Rename layer", "Name:", QLineEdit.Normal, layer.name)
        if ok and name.strip():
            self.session.rename_layer(layer.uid, name.strip())

    def merge_down(self, layer: Layer) -> None:
        """Merge this drawing layer into the one below (raster)."""
        from ..model.cel import BitmapCel
        from PySide6.QtGui import QPainter, QImage
        from PySide6.QtCore import Qt as QtNS
        scene = self.session.scene
        index = scene.layer_index(layer.uid)
        if index <= 0:
            return
        below = scene.layers[index - 1]
        if layer.kind not in ("raster", "vector") or below.kind not in ("raster", "vector"):
            self.session.status("Merge down works on drawing layers")
            return
        before = {below.uid: dict(below.cels), layer.uid: dict(layer.cels)}
        for frame in set(list(layer.cels.keys()) + list(below.cels.keys())):
            target_hit = below.cel_at(frame)
            src_hit = layer.cel_at(frame)
            if src_hit is None:
                continue
            if target_hit is None:
                below.set_cel(frame, src_hit[1].cel.copy_as_new())
                continue
            target_cel = target_hit[1].cel
            if not isinstance(target_cel, BitmapCel):
                continue
            p = QPainter(target_cel.image)
            from ..engine.render import paint_cel
            paint_cel(p, src_hit[1].cel, scene, self.session.project)
            p.end()
            target_cel.invalidate_bounds()
        layer.cels.clear()
        after = {below.uid: dict(below.cels), layer.uid: dict(layer.cels)}

        def do(state):
            for uid, cels in state.items():
                lay = scene.layer(uid)
                if lay is not None:
                    lay.cels = dict(cels)
            self.session.timeline_changed.emit()
            self.session.canvas_changed.emit()

        self.session.command("Merge down", lambda: do(before), lambda: do(after))
        self.session.layers_changed.emit()
        self.session.canvas_changed.emit()
        self.session.status(f"Merged '{layer.name}' into '{below.name}'")

    def convert_to_vector(self, layer: Layer) -> None:
        """Trace the raster cels into vector strokes (simple but useful)."""
        from ..model.cel import BitmapCel, VectorCel
        if layer.kind != "raster":
            self.session.status("Only raster layers can be converted")
            return
        before = dict(layer.cels)
        count = 0
        for frame, ref in layer.cels.items():
            cel = ref.cel
            if not isinstance(cel, BitmapCel):
                continue
            strokes = self._trace(cel)
            if not strokes:
                continue
            vec_cel = VectorCel(cel.size, strokes)
            layer.cels[frame] = type(ref)(vec_cel, ref.hold)
            count += 1
        after = dict(layer.cels)

        def do(state):
            layer.cels = dict(state)
            self.session.timeline_changed.emit()
            self.session.canvas_changed.emit()

        self.session.command("Convert to vector", lambda: do(before), lambda: do(after))
        layer.kind = "vector"
        self.session.layers_changed.emit()
        self.session.status(f"Converted {count} frame(s) to vector strokes")

    def _trace(self, cel) -> list[dict]:
        img = cel.image
        w, h = img.width(), img.height()
        b = cel.content_bounds()
        if b is None:
            return []
        step = max(2, int(max(b.width(), b.height()) / 220))
        strokes = []
        for y in range(b.top(), b.bottom() + 1, step):
            run = None
            for x in range(b.left(), b.right() + 2, step):
                solid = False
                if x <= b.right() and y <= b.bottom():
                    c = img.pixelColor(x, y)
                    solid = c.alpha() > 90 and c.lightnessF() < 0.75
                if solid and run is None:
                    run = x
                elif not solid and run is not None:
                    if x - run >= step:
                        strokes.append({
                            "kind": "line", "points": [[run, y, 1.0], [x - 1, y, 1.0]],
                            "brush": {"size": float(step), "hardness": 1.0},
                            "color": [30, 30, 36, 255],
                        })
                    run = None
        _ = (w, h)
        return strokes

    def flatten_group(self, layer: Layer) -> None:
        if layer.kind != "group":
            self.session.status("Select a group to flatten")
            return
        children = self.session.scene.children_of(layer.uid)
        if not children:
            return
        merged = children[0]
        before = dict(merged.cels)
        from ..model.cel import BitmapCel
        from PySide6.QtGui import QPainter
        from ..engine.render import paint_cel
        scene = self.session.scene
        for child in children[1:]:
            for frame in child.cel_keys():
                hit = child.cel_at(frame)
                if hit is None:
                    continue
                target = merged.cel_at(frame)
                if target is None or not isinstance(target[1].cel, BitmapCel):
                    merged.set_cel(frame, hit[1].cel.copy_as_new())
                    continue
                p = QPainter(target[1].cel.image)
                paint_cel(p, hit[1].cel, scene, self.session.project)
                p.end()
                target[1].cel.invalidate_bounds()
        after = dict(merged.cels)

        def do(state):
            merged.cels = dict(state)
            self.session.timeline_changed.emit()
            self.session.canvas_changed.emit()

        self.session.command("Flatten group", lambda: do(before), lambda: do(after))
        for child in children[1:]:
            self.session.scene.remove_layer(child.uid)
        self.session.scene.remove_layer(layer.uid)
        self.session.layers_changed.emit()
        self.session.canvas_changed.emit()


_ = (QPixmap, QDoubleSpinBox, QPushButton, Signal)
