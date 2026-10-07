"""Character and rigging controls: bones, IK, constraints, auto rigging."""
from __future__ import annotations

from PySide6.QtCore import QSize, Qt, Signal
from PySide6.QtGui import QColor, QPixmap
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDoubleSpinBox, QFormLayout, QFrame,
                               QHBoxLayout, QInputDialog, QLabel, QLineEdit, QListWidget,
                               QListWidgetItem, QMenu, QPushButton, QScrollArea, QSlider,
                               QSpinBox, QTabWidget, QToolButton, QVBoxLayout, QWidget)

from ..model.rig import Bone, IKChain, CONSTRAINT_TYPES, PART_BONE_MAP
from .theme import C, get_icon


class CharacterPanel(QWidget):
    """Everything about the character rig on the current layer."""

    def __init__(self, session, parent=None):
        super().__init__(parent)
        self.session = session
        self._updating = False
        root = QVBoxLayout(self)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)
        self.tabs = QTabWidget()
        self.tabs.setDocumentMode(True)
        root.addWidget(self.tabs)
        self.tabs.addTab(self._build_rig_tab(), "Bones")
        self.tabs.addTab(self._build_parts_tab(), "Parts")
        self.tabs.addTab(self._build_pose_tab(), "Pose")

        s = session
        s.rig_changed.connect(self.sync)
        s.selection_changed.connect(self.sync)
        s.layer_selected.connect(lambda *_: self.sync())
        s.canvas_changed.connect(self._sync_light)
        s.project_changed.connect(self.sync)
        self.sync()

    # ------------------------------------------------------------------- rig
    def _build_rig_tab(self) -> QWidget:
        holder = QWidget()
        lay = QVBoxLayout(holder)
        lay.setContentsMargins(8, 8, 8, 8)
        lay.setSpacing(6)

        self.rig_label = QLabel("No rig on this layer")
        self.rig_label.setObjectName("title")
        self.rig_label.setWordWrap(True)
        lay.addWidget(self.rig_label)

        row = QHBoxLayout()
        self.auto_rig_btn = QPushButton("Auto Rig Character")
        self.auto_rig_btn.setObjectName("primary")
        self.auto_rig_btn.setToolTip(
            "Detect the character's body parts from the layers (or an imported image) and "
            "build a full stick rig with IK chains")
        self.auto_rig_btn.clicked.connect(self._auto_rig)
        row.addWidget(self.auto_rig_btn)
        self.auto_rig_img_btn = QPushButton("From image…")
        self.auto_rig_img_btn.setToolTip("Pick an imported character image and rig it")
        self.auto_rig_img_btn.clicked.connect(self._auto_rig_from_image)
        row.addWidget(self.auto_rig_img_btn)
        lay.addLayout(row)

        row = QHBoxLayout()
        self.new_rig_btn = QPushButton("New rig")
        self.new_rig_btn.setToolTip("Create an empty rig you can draw bones into")
        self.new_rig_btn.clicked.connect(self._new_rig)
        row.addWidget(self.new_rig_btn)
        self.character_btn = QPushButton("New character")
        self.character_btn.setToolTip("Add a ready-made stick figure character to the scene")
        self.character_btn.clicked.connect(self._new_character)
        row.addWidget(self.character_btn)
        lay.addLayout(row)

        self.bone_list = QListWidget()
        self.bone_list.setSelectionMode(QListWidget.ExtendedSelection)
        self.bone_list.setContextMenuPolicy(Qt.CustomContextMenu)
        self.bone_list.customContextMenuRequested.connect(self._bone_menu)
        self.bone_list.itemSelectionChanged.connect(self._on_bone_selected)
        lay.addWidget(self.bone_list, 1)

        tools = QHBoxLayout()
        self.bone_tool_btn = QToolButton()
        self.bone_tool_btn.setText("Bone tool")
        self.bone_tool_btn.setCheckable(True)
        self.bone_tool_btn.setToolTip("Click and drag on the canvas to draw bones")
        self.bone_tool_btn.clicked.connect(lambda: self.session.set_tool("bone"))
        tools.addWidget(self.bone_tool_btn)
        parent_btn = QPushButton("Parent…")
        parent_btn.setToolTip("Parent the selected bones to another bone")
        parent_btn.clicked.connect(self._parent_dialog)
        tools.addWidget(parent_btn)
        delete_btn = QPushButton("Delete")
        delete_btn.clicked.connect(self._delete_bones)
        tools.addWidget(delete_btn)
        lay.addLayout(tools)

        ik_row = QHBoxLayout()
        self.ik_btn = QPushButton("Create IK chain")
        self.ik_btn.setToolTip("Select three bones (shoulder → elbow → wrist) then create an IK "
                               "chain")
        self.ik_btn.clicked.connect(self._create_ik)
        ik_row.addWidget(self.ik_btn)
        self.ik_list = QComboBox()
        self.ik_list.setToolTip("IK chains in this rig")
        self.ik_list.currentIndexChanged.connect(self._on_ik_selected)
        ik_row.addWidget(self.ik_list, 1)
        lay.addLayout(ik_row)

        ik_row2 = QHBoxLayout()
        self.ik_mode = QComboBox()
        self.ik_mode.addItem("IK (drag targets)", True)
        self.ik_mode.addItem("FK (rotate bones)", False)
        self.ik_mode.setToolTip("Drag interaction mode on the canvas")
        self.ik_mode.currentIndexChanged.connect(self._on_ik_mode)
        ik_row2.addWidget(self.ik_mode, 1)
        bake_btn = QPushButton("Bake IK → keys")
        bake_btn.setToolTip("Turn the IK animation into plain rotation keys on every frame")
        bake_btn.clicked.connect(self._bake_ik)
        ik_row2.addWidget(bake_btn)
        lay.addLayout(ik_row2)

        pin_row = QHBoxLayout()
        self.pin_check = QCheckBox("Pin root (no sliding)")
        self.pin_check.setToolTip("Keep the pelvis locked while the feet move")
        self.pin_check.clicked.connect(self._toggle_pin)
        pin_row.addWidget(self.pin_check)
        lay.addLayout(pin_row)

        self.constraint_frame = QFrame()
        self.constraint_frame.setObjectName("card")
        cform = QFormLayout(self.constraint_frame)
        cform.setContentsMargins(8, 6, 8, 6)
        cform.setSpacing(4)
        self.constraint_combo = QComboBox()
        for key, label in CONSTRAINT_TYPES:
            self.constraint_combo.addItem(label, key)
        self.constraint_combo.currentIndexChanged.connect(self._constraint_changed)
        cform.addRow("Constraint", self.constraint_combo)
        self.c_min = QDoubleSpinBox()
        self.c_min.setRange(-360, 360)
        self.c_min.setSuffix("°")
        self.c_min.valueChanged.connect(self._limit_changed)
        cform.addRow("Min angle", self.c_min)
        self.c_max = QDoubleSpinBox()
        self.c_max.setRange(-360, 360)
        self.c_max.setSuffix("°")
        self.c_max.valueChanged.connect(self._limit_changed)
        cform.addRow("Max angle", self.c_max)
        self.rot_slider = QSlider(Qt.Horizontal)
        self.rot_slider.setRange(-180, 180)
        self.rot_slider.setToolTip("Rotate the selected bone")
        self.rot_slider.valueChanged.connect(self._slider_rotated)
        cform.addRow("Rotation", self.rot_slider)
        self.rot_spin = QDoubleSpinBox()
        self.rot_spin.setRange(-360, 360)
        self.rot_spin.setSuffix("°")
        self.rot_spin.valueChanged.connect(self._spin_rotated)
        cform.addRow("Exact", self.rot_spin)
        lay.addWidget(self.constraint_frame)
        lay.addStretch(1)
        return holder

    def _build_parts_tab(self) -> QWidget:
        holder = QWidget()
        lay = QVBoxLayout(holder)
        lay.setContentsMargins(8, 8, 8, 8)
        lay.setSpacing(6)
        lay.addWidget(QLabel("Body parts bound to this rig"))
        self.part_list = QListWidget()
        self.part_list.itemChanged.connect(self._part_toggled)
        lay.addWidget(self.part_list, 1)

        row = QHBoxLayout()
        detect = QPushButton("Detect from layer name")
        detect.setToolTip("Guess the part from the layer name and bind it to the matching bone")
        detect.clicked.connect(self._detect_parts)
        row.addWidget(detect)
        lay.addLayout(row)

        row2 = QHBoxLayout()
        self.part_combo = QComboBox()
        for key, label in PART_BONE_MAP.items():
            self.part_combo.addItem(label, key)
        row2.addWidget(self.part_combo, 1)
        bind = QPushButton("Bind layer")
        bind.setToolTip("Bind the selected layer to the chosen bone")
        bind.clicked.connect(self._bind_layer)
        row2.addWidget(bind)
        lay.addLayout(row2)

        row3 = QHBoxLayout()
        offsets = QPushButton("Offset part")
        offsets.setToolTip("Fine tune the attachment offset of the bound part")
        offsets.clicked.connect(self._offset_part)
        row3.addWidget(offsets)
        detach = QPushButton("Detach")
        detach.clicked.connect(self._detach_part)
        row3.addWidget(detach)
        lay.addLayout(row3)

        align_row = QHBoxLayout()
        self.align_check = QCheckBox("Auto align parts to bones")
        self.align_check.setChecked(True)
        align_row.addWidget(self.align_check)
        lay.addLayout(align_row)
        lay.addStretch(1)
        return holder

    def _build_pose_tab(self) -> QWidget:
        holder = QWidget()
        lay = QVBoxLayout(holder)
        lay.setContentsMargins(8, 8, 8, 8)
        lay.setSpacing(6)

        self.auto_key = QCheckBox("Auto key pose changes")
        self.auto_key.setToolTip("Every bone edit creates a key at the playhead")
        self.auto_key.clicked.connect(
            lambda: setattr(self.session, "auto_key", self.auto_key.isChecked()))
        lay.addWidget(self.auto_key)

        key_btn = QPushButton("Key whole pose")
        key_btn.setObjectName("primary")
        key_btn.setToolTip("Key every bone at the playhead (K)")
        key_btn.clicked.connect(lambda: self.session.key_bone_pose())
        lay.addWidget(key_btn)

        row = QHBoxLayout()
        reset_btn = QPushButton("Reset pose")
        reset_btn.setToolTip("Back to the rest pose")
        reset_btn.clicked.connect(lambda: self.session.reset_pose())
        row.addWidget(reset_btn)
        mirror_btn = QPushButton("Mirror pose")
        mirror_btn.setToolTip("Flip the pose left to right")
        mirror_btn.clicked.connect(lambda: self.session.mirror_pose())
        row.addWidget(mirror_btn)
        lay.addLayout(row)

        lay.addWidget(QLabel("Pose presets"))
        self.pose_list = QListWidget()
        self.pose_list.setAlternatingRowColors(True)
        from ..ai.poses import POSES
        for name in sorted(POSES.keys()):
            item = QListWidgetItem(name)
            item.setData(Qt.UserRole, name)
            self.pose_list.addItem(item)
        self.pose_list.itemDoubleClicked.connect(
            lambda item: self.session.apply_pose(item.data(Qt.UserRole)))
        lay.addWidget(self.pose_list, 1)

        apply_btn = QPushButton("Apply pose")
        apply_btn.setToolTip("Apply the selected preset to the current rig (double click works too)")
        apply_btn.clicked.connect(self._apply_pose)
        lay.addWidget(apply_btn)

        store_row = QHBoxLayout()
        store = QPushButton("Store current pose…")
        store.setToolTip("Save the current pose into the asset library")
        store.clicked.connect(self._store_pose)
        store_row.addWidget(store)
        apply_asset = QPushButton("Apply stored pose")
        apply_asset.clicked.connect(self._apply_stored_pose)
        store_row.addWidget(apply_asset)
        lay.addLayout(store_row)
        self.pose_combo = QComboBox()
        lay.addWidget(self.pose_combo)
        return holder

    # ------------------------------------------------------------------ sync
    def active_rig(self):
        return self.session.active_rig()

    def sync(self) -> None:
        if self._updating:
            return
        self._updating = True
        try:
            session = self.session
            rig = self.active_rig()
            if rig is None:
                self.rig_label.setText("No rig on this layer — create one to start animating.")
                self.bone_list.clear()
                self.ik_list.clear()
                self.part_list.clear()
                return
            layer = session.active_layer()
            self.rig_label.setText(f"{rig.name} · {len(rig.bones)} bones · layer "
                                   f"'{layer.name if layer else '?'}'")
            self.bone_list.blockSignals(True)
            self.bone_list.clear()
            for bone in rig.ordered_bones():
                item = QListWidgetItem(("  " * rig.depth_of(bone.uid)) + bone.name)
                item.setData(Qt.UserRole, bone.uid)
                item.setToolTip(f"{bone.name} · {len(bone.rotation.keys)} rotation keys · "
                                f"constraint: {bone.constraint}")
                self.bone_list.addItem(item)
                if bone.uid in session.selected_bones:
                    item.setSelected(True)
            self.bone_list.blockSignals(False)
            # ik chains
            self.ik_list.blockSignals(True)
            self.ik_list.clear()
            for chain in rig.ik_chains:
                self.ik_list.addItem(chain.name, chain.uid)
            idx = next((i for i, c in enumerate(rig.ik_chains)
                        if c.uid == session.active_ik_chain), -1)
            self.ik_list.setCurrentIndex(idx)
            self.ik_list.blockSignals(False)
            # parts
            self.part_list.blockSignals(True)
            self.part_list.clear()
            for part_key, label in PART_BONE_MAP.items():
                bound = rig.part_bindings.get(part_key)
                item = QListWidgetItem(f"{label} → {bound or '—'}")
                item.setData(Qt.UserRole, part_key)
                item.setFlags(item.flags() | Qt.ItemIsUserCheckable)
                item.setCheckState(Qt.Checked if bound else Qt.Unchecked)
                self.part_list.addItem(item)
            self.part_list.blockSignals(False)
            # pose library combo
            self.pose_combo.blockSignals(True)
            self.pose_combo.clear()
            for asset in session.project.assets.values():
                if asset.kind == "pose":
                    self.pose_combo.addItem(asset.name, asset.uid)
            self.pose_combo.blockSignals(False)
        finally:
            self._updating = False
        self._sync_light()

    def _sync_light(self) -> None:
        rig = self.active_rig()
        if rig is None:
            return
        bone = rig.bones.get(self.session.selected_bones[0]) if self.session.selected_bones else None
        if bone is None:
            return
        self._updating = True
        try:
            value = bone.rotation.value_at(self.session.frame)
            self.rot_spin.blockSignals(True)
            self.rot_spin.setValue(float(value))
            self.rot_spin.blockSignals(False)
            self.rot_slider.blockSignals(True)
            self.rot_slider.setValue(int(max(-180, min(180, value))))
            self.rot_slider.blockSignals(False)
            idx = self.constraint_combo.findData(bone.constraint)
            self.constraint_combo.blockSignals(True)
            self.constraint_combo.setCurrentIndex(max(0, idx))
            self.constraint_combo.blockSignals(False)
            self.c_min.blockSignals(True)
            self.c_min.setValue(float(bone.limit_min))
            self.c_min.blockSignals(False)
            self.c_max.blockSignals(True)
            self.c_max.setValue(float(bone.limit_max))
            self.c_max.blockSignals(False)
            self.pin_check.blockSignals(True)
            self.pin_check.setChecked(bool(rig.pinned))
            self.pin_check.blockSignals(False)
        finally:
            self._updating = False

    # ------------------------------------------------------------------ bones
    def _on_bone_selected(self) -> None:
        if self._updating:
            return
        self.session.selected_bones = [item.data(Qt.UserRole)
                                       for item in self.bone_list.selectedItems()]
        self.session.selection_changed.emit()
        self._sync_light()

    def _bone_menu(self, pos) -> None:
        rig = self.active_rig()
        if rig is None:
            return
        item = self.bone_list.itemAt(pos)
        menu = QMenu(self)
        if item is not None:
            uid = item.data(Qt.UserRole)
            menu.addAction("Rename…", lambda: self._rename_bone(uid))
            menu.addAction("Key this bone", lambda: self.session.key_bone_pose(uid))
            menu.addAction("Delete bone", lambda: self._delete_bone(uid))
            sub = menu.addMenu("Parent")
            sub.addAction("None (root)", lambda: self.session.set_bone_parent(uid, None))
            for bone in rig.ordered_bones():
                if bone.uid != uid:
                    sub.addAction(bone.name, lambda u=bone.uid: self.session.set_bone_parent(uid, u))
            menu.addAction("Create IK chain", self._create_ik)
        menu.addAction("Add bone…", self._add_bone_dialog)
        menu.exec(self.bone_list.mapToGlobal(pos))

    def _rename_bone(self, uid: str) -> None:
        rig = self.active_rig()
        bone = rig.bones.get(uid) if rig else None
        if bone is None:
            return
        name, ok = QInputDialog.getText(self, "Rename bone", "Name:", QLineEdit.Normal, bone.name)
        if ok and name.strip():
            bone.name = name.strip()
            self.session.rig_changed.emit()

    def _add_bone_dialog(self) -> None:
        rig = self.active_rig()
        if rig is None:
            self.session.status("Create a rig first")
            return
        name, ok = QInputDialog.getText(self, "Add bone", "Bone name:", QLineEdit.Normal, "New Bone")
        if not ok or not name.strip():
            return
        parent = self.session.selected_bones[0] if self.session.selected_bones else None
        bone = rig.create_bone(name.strip(), parent)
        self.session.command("Add bone", lambda: rig.remove_bone(bone.uid),
                             lambda: rig.add_bone(bone))
        self.session.rig_changed.emit()
        self.session.status(f"Added bone '{name.strip()}'")

    def _delete_bones(self) -> None:
        for uid in list(self.session.selected_bones):
            self._delete_bone(uid)

    def _delete_bone(self, uid: str) -> None:
        rig = self.active_rig()
        if rig is None or uid not in rig.bones:
            return
        snapshot = rig.to_dict()
        rig.remove_bone(uid)
        after = rig.to_dict()

        def do(state):
            restored = type(rig).from_dict(state)
            rig.bones = restored.bones
            rig.ik_chains = restored.ik_chains
            rig.selection_order = restored.selection_order
            self.session.rig_changed.emit()
            self.session.canvas_changed.emit()

        self.session.command("Delete bone", lambda: do(snapshot), lambda: do(after))
        self.session.selected_bones = [u for u in self.session.selected_bones if u != uid]
        self.session.rig_changed.emit()

    def _parent_dialog(self) -> None:
        rig = self.active_rig()
        if rig is None or not self.session.selected_bones:
            return
        names = [b.name for b in rig.ordered_bones()]
        choice, ok = QInputDialog.getItem(self, "Parent bones", "Parent:", names, 0, False)
        if not ok:
            return
        target = next((b for b in rig.ordered_bones() if b.name == choice), None)
        for uid in list(self.session.selected_bones):
            if target is None:
                self.session.set_bone_parent(uid, None)
            elif target.uid != uid:
                self.session.set_bone_parent(uid, target.uid)

    def _parent_dialog_placeholder(self) -> None:
        return None

    def _create_ik_from_selection(self) -> None:
        return None

    def _create_ik(self) -> None:
        rig = self.active_rig()
        if rig is None:
            return
        chain_bones = list(self.session.selected_bones)
        if len(chain_bones) < 3:
            self.session.status("Select three bones in order (shoulder → elbow → wrist)")
            return
        bones = [rig.bones.get(u) for u in chain_bones[:3]]
        bones = [b for b in bones if b is not None]
        if len(bones) < 3:
            return
        chain = rig.add_ik_chain(bones[0].name, bones[1].name, bones[2].name)
        if chain is None:
            self.session.status("Those bones cannot form an IK chain")
            return
        self.session.active_ik_chain = chain.uid
        self.session.ik_mode = True
        self.session.command("Create IK chain", lambda: rig.ik_chains.remove(chain),
                             lambda: rig.ik_chains.append(chain))
        self.session.rig_changed.emit()
        self.session.status(f"IK chain '{chain.name}' created — drag the target on canvas")

    def _on_ik_selected(self, index: int) -> None:
        if self._updating:
            return
        uid = self.ik_list.itemData(index)
        if uid:
            self.session.active_ik_chain = uid
            self.session.rig_changed.emit()

    def _on_ik_mode(self, index: int) -> None:
        if self._updating:
            return
        self.session.ik_mode = bool(self.ik_mode.itemData(index))
        rig = self.active_rig()
        if rig is not None:
            for chain in rig.ik_chains:
                chain.enabled = self.session.ik_mode
                if self.session.ik_mode and not (chain.target_x.keys and chain.target_y.keys) \
                        and chain.rest_target:
                    chain.target_x.set_key(self.session.frame, chain.rest_target[0])
                    chain.target_y.set_key(self.session.frame, chain.rest_target[1])
            self.session.active_ik_chain = self.session.active_ik_chain or (
                rig.ik_chains[0].uid if rig.ik_chains else "")
            self.session.timeline_changed.emit()
            self.session.rig_changed.emit()
        self.session.status("IK mode — drag the targets" if self.session.ik_mode
                            else "FK mode — rotate the bones")

    def _bake_ik(self) -> None:
        rig = self.active_rig()
        if rig is None:
            return
        chain = next((c for c in rig.ik_chains if c.uid == self.session.active_ik_chain), None)
        if chain is None and rig.ik_chains:
            chain = rig.ik_chains[0]
        if chain is None:
            self.session.status("No IK chain to bake")
            return
        scene = self.session.scene
        start, end = scene.frame_start, max(scene.total_frames(), scene.frame_end)
        snapshot = rig.to_dict()
        rig.bake_ik(chain, range(start, end + 1))
        after = rig.to_dict()

        def do(state):
            restored = type(rig).from_dict(state)
            rig.bones = restored.bones
            rig.ik_chains = restored.ik_chains
            self.session.rig_changed.emit()
            self.session.timeline_changed.emit()
            self.session.canvas_changed.emit()

        self.session.command("Bake IK", lambda: do(snapshot), lambda: do(after))
        self.session.status(f"Baked '{chain.name}' into rotation keys")

    def _toggle_pin(self) -> None:
        rig = self.active_rig()
        if rig is None:
            return
        rig.pinned = self.pin_check.isChecked()
        self.session.status("Root pinned" if rig.pinned else "Root free")

    def _constraint_changed(self) -> None:
        if self._updating:
            return
        rig = self.active_rig()
        bone = rig.bones.get(self.session.selected_bones[0]) if rig and \
            self.session.selected_bones else None
        if bone is None:
            return
        self.session.set_bone_prop(bone.uid, "constraint", self.constraint_combo.currentData())
        self.session.rig_changed.emit()

    def _limit_changed(self) -> None:
        if self._updating:
            return
        rig = self.active_rig()
        bone = rig.bones.get(self.session.selected_bones[0]) if rig and \
            self.session.selected_bones else None
        if bone is None:
            return
        self.session.set_bone_limits(bone.uid, float(self.c_min.value()),
                                     float(self.c_max.value()))

    def _slider_rotated(self, value: int) -> None:
        if self._updating:
            return
        self.rot_spin.blockSignals(True)
        self.rot_spin.setValue(float(value))
        self.rot_spin.blockSignals(False)
        self._apply_rotation(float(value))

    def _spin_rotated(self, value: float) -> None:
        if self._updating:
            return
        self.rot_slider.blockSignals(True)
        self.rot_slider.setValue(int(max(-180, min(180, value))))
        self.rot_slider.blockSignals(False)
        self._apply_rotation(float(value))

    def _apply_rotation(self, value: float) -> None:
        rig = self.active_rig()
        if rig is None or not self.session.selected_bones:
            return
        bone = rig.bones.get(self.session.selected_bones[0])
        if bone is None:
            return
        self.session.set_bone_rotation(bone, value, merge=True)
        self.session.canvas_changed.emit()

    def _auto_rig(self) -> None:
        rig = self.session.auto_rig_character()
        if rig is None:
            self.session.status("Could not auto rig — import a character or name your part layers")
        self.sync()

    def _auto_rig_from_image(self) -> None:
        candidates = [a for a in self.session.project.assets.values()
                      if a.kind in ("image", "svg") and a.folder != "Poses"]
        if not candidates:
            self.session.status("Import a character image first (File ▸ Import)")
            return
        names = [a.name for a in candidates]
        name, ok = QInputDialog.getItem(self, "Auto Rig from image", "Character image:", names,
                                        0, False)
        if not ok:
            return
        asset = next((a for a in candidates if a.name == name), None)
        if asset is not None:
            self.session.auto_rig_character(asset.uid)
        self.sync()

    def _new_rig(self) -> None:
        self.session.create_rig_for_active_layer()
        self.sync()

    def _new_character(self) -> None:
        self.session.add_character(True)
        self.sync()

    # ----------------------------------------------------------------- parts
    def _part_toggled(self, item: QListWidgetItem) -> None:
        if self._updating:
            return
        part_key = item.data(Qt.UserRole)
        rig = self.active_rig()
        if rig is None:
            return
        if item.checkState() == Qt.Unchecked:
            rig.part_bindings.pop(part_key, None)
        self.session.rig_changed.emit()
        self.session.canvas_changed.emit()

    def _detect_parts(self) -> None:
        self.session.detect_character_parts()
        self.sync()

    def _bind_layer(self) -> None:
        layer = self.session.active_layer()
        if layer is None:
            return
        rig = self.active_rig()
        if rig is None:
            self.session.status("No rig on this layer")
            return
        rig.part_bindings[self.part_combo.currentData()] = layer.uid
        self.session.rig_changed.emit()
        self.session.status(f"Bound '{layer.name}' to {self.part_combo.currentText()}")
        self.sync()

    def _offset_part(self) -> None:
        from PySide6.QtWidgets import QDialog, QDialogButtonBox, QDialogButtonBox as BB
        dialog = QDialog(self)
        dialog.setWindowTitle("Part offset")
        form = QFormLayout(dialog)
        x = QDoubleSpinBox()
        x.setRange(-2000, 2000)
        y = QDoubleSpinBox()
        y.setRange(-2000, 2000)
        rot = QDoubleSpinBox()
        rot.setRange(-360, 360)
        rot.setSuffix("°")
        form.addRow("Offset X", x)
        form.addRow("Offset Y", y)
        form.addRow("Rotation", rot)
        buttons = BB(BB.Ok | BB.Cancel, dialog)
        buttons.accepted.connect(dialog.accept)
        buttons.rejected.connect(dialog.reject)
        form.addRow(buttons)
        if dialog.exec():
            self.session.set_part_offset(self.part_combo.currentData(), x.value(), y.value(),
                                         rot.value())
            self.sync()

    def _detach_part(self) -> None:
        rig = self.active_rig()
        if rig is None:
            return
        rig.part_bindings.pop(self.part_combo.currentData(), None)
        self.session.rig_changed.emit()
        self.sync()

    # ------------------------------------------------------------------ pose
    def _apply_pose(self) -> None:
        item = self.pose_list.currentItem()
        if item is not None:
            self.session.apply_pose(item.data(Qt.UserRole))

    def _store_pose(self) -> None:
        name, ok = QInputDialog.getText(self, "Store pose", "Pose name:", QLineEdit.Normal,
                                        "My Pose")
        if ok and name.strip():
            self.session.store_pose(name.strip())
            self.sync()

    def _apply_stored_pose(self) -> None:
        uid = self.pose_combo.currentData()
        if uid:
            self.session.apply_stored_pose(uid)


_ = (QSize, QColor, QPixmap, QScrollArea, QSpinBox, Signal, QCheckBox, HybridWidget := QWidget)
