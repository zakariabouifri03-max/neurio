"""Asset library: folders, tags, drag & drop, premade animations and templates."""
from __future__ import annotations

import os

from PySide6.QtCore import QMimeData, QSize, Qt, Signal
from PySide6.QtGui import QDrag, QIcon, QImage, QPixmap
from PySide6.QtWidgets import (QAbstractItemView, QComboBox, QFileDialog, QHBoxLayout, QInputDialog,
                               QLabel, QLineEdit, QListWidget, QListWidgetItem, QMenu,
                               QPushButton, QSplitter, QTabWidget, QTreeWidget, QTreeWidgetItem,
                               QVBoxLayout, QWidget)

from ..ai.library import ANIMATION_LIBRARY, TEMPLATES, template_names
from .theme import C, get_icon

ASSET_MIME = "application/x-mfs-asset"


class AssetList(QListWidget):
    """Icon grid that exports assets as drag payloads onto the canvas."""

    def __init__(self, session, parent=None):
        super().__init__(parent)
        self.session = session
        self.setViewMode(QListWidget.IconMode)
        self.setIconSize(QSize(72, 72))
        self.setGridSize(QSize(88, 104))
        self.setResizeMode(QListWidget.Adjust)
        self.setMovement(QListWidget.Static)
        self.setSpacing(4)
        self.setDragEnabled(True)
        self.setSelectionMode(QAbstractItemView.ExtendedSelection)
        self.setWordWrap(True)
        self.setAcceptDrops(True)

    def startDrag(self, actions) -> None:
        item = self.currentItem()
        if item is None:
            return
        mime = QMimeData()
        mime.setData(ASSET_MIME, str(item.data(Qt.UserRole)).encode("utf8"))
        drag = QDrag(self)
        drag.setMimeData(mime)
        pixmap = item.icon().pixmap(64, 64)
        if not pixmap.isNull():
            drag.setPixmap(pixmap)
        drag.exec(Qt.CopyAction)


class AssetsPanel(QWidget):
    """Everything the user can reuse: images, characters, poses, animations."""

    def __init__(self, session, parent=None):
        super().__init__(parent)
        self.session = session
        self._current_folder = ""
        root = QVBoxLayout(self)
        root.setContentsMargins(6, 6, 6, 6)
        root.setSpacing(5)

        top = QHBoxLayout()
        self.search = QLineEdit()
        self.search.setPlaceholderText("Search assets…")
        self.search.textChanged.connect(self.rebuild)
        top.addWidget(self.search, 1)
        import_btn = QPushButton("Import…")
        import_btn.setToolTip("Import images, SVG, audio or video (drag & drop works too)")
        import_btn.clicked.connect(self.import_files)
        top.addWidget(import_btn)
        root.addLayout(top)

        self.tabs = QTabWidget()
        self.tabs.setDocumentMode(True)
        root.addWidget(self.tabs, 1)

        # --- library tab
        lib = QWidget()
        lib_lay = QHBoxLayout(lib)
        lib_lay.setContentsMargins(0, 4, 0, 0)
        self.folders = QTreeWidget()
        self.folders.setHeaderHidden(True)
        self.folders.setFixedWidth(112)
        self.folders.itemClicked.connect(self._folder_clicked)
        lib_lay.addWidget(self.folders)
        self.grid = AssetList(session)
        self.grid.itemDoubleClicked.connect(self._asset_double_clicked)
        self.grid.setContextMenuPolicy(Qt.CustomContextMenu)
        self.grid.customContextMenuRequested.connect(self._asset_menu)
        lib_lay.addWidget(self.grid, 1)
        self.tabs.addTab(lib, "Library")

        # --- animations tab
        anim = QWidget()
        anim_lay = QVBoxLayout(anim)
        anim_lay.setContentsMargins(4, 6, 4, 4)
        self.anim_list = QListWidget()
        for clip in ANIMATION_LIBRARY:
            item = QListWidgetItem(f"{clip.name}")
            item.setData(Qt.UserRole, clip.name)
            item.setToolTip(f"{clip.description}\n{clip.frames} frames"
                            f"{' · loops' if clip.loop else ''}")
            self.anim_list.addItem(item)
        anim_lay.addWidget(self.anim_list, 1)
        row = QHBoxLayout()
        self.loops = QComboBox()
        for count in (1, 2, 3, 4, 8, 16):
            self.loops.addItem(f"{count}×", count)
        self.loops.setToolTip("How many times to repeat the clip")
        row.addWidget(self.loops)
        apply_btn = QPushButton("Apply to rig")
        apply_btn.setObjectName("primary")
        apply_btn.setToolTip("Insert this animation on the selected character's timeline")
        apply_btn.clicked.connect(self.apply_animation)
        row.addWidget(apply_btn, 1)
        anim_lay.addLayout(row)
        self.tabs.addTab(anim, "Animations")

        # --- templates tab
        templates = QWidget()
        t_lay = QVBoxLayout(templates)
        t_lay.setContentsMargins(4, 6, 4, 4)
        self.template_list = QListWidget()
        for info in TEMPLATES:
            item = QListWidgetItem(info.name)
            item.setData(Qt.UserRole, info.name)
            item.setToolTip(info.description)
            self.template_list.addItem(item)
        self.template_list.itemDoubleClicked.connect(lambda _i: self.use_template())
        t_lay.addWidget(self.template_list, 1)
        new_btn = QPushButton("New project from template")
        new_btn.setToolTip("Start a fresh project using the selected template")
        new_btn.clicked.connect(self.use_template)
        t_lay.addWidget(new_btn)
        self.tabs.addTab(templates, "Templates")

        self.hint = QLabel("Drag an asset onto the canvas to place it.")
        self.hint.setObjectName("hint")
        root.addWidget(self.hint)

        session.assets_changed.connect(self.rebuild)
        session.project_changed.connect(self.rebuild)
        self.rebuild()

    # ------------------------------------------------------------------ list
    def rebuild(self) -> None:
        query = self.search.text().strip().lower()
        self.grid.clear()
        for asset in self.session.project.assets.values():
            if self._current_folder and asset.folder != self._current_folder:
                continue
            if query and query not in asset.name.lower() and \
                    not any(query in t.lower() for t in asset.tags):
                continue
            item = QListWidgetItem(self._icon_for(asset), asset.name)
            item.setData(Qt.UserRole, asset.uid)
            tags = ", ".join(asset.tags)
            item.setToolTip(f"{asset.name}\n{asset.kind} · {asset.folder}"
                            f"{chr(10) + tags if tags else ''}")
            self.grid.addItem(item)
        self._rebuild_folders()

    def _rebuild_folders(self) -> None:
        self.folders.clear()
        all_item = QTreeWidgetItem(["All assets"])
        all_item.setData(0, Qt.UserRole, "")
        self.folders.addTopLevelItem(all_item)
        folders: dict[str, int] = {}
        for asset in self.session.project.assets.values():
            folders[asset.folder] = folders.get(asset.folder, 0) + 1
        for name, count in sorted(folders.items()):
            item = QTreeWidgetItem([f"{name} ({count})"])
            item.setData(0, Qt.UserRole, name)
            self.folders.addTopLevelItem(item)
        self.folders.setCurrentItem(all_item)

    def _icon_for(self, asset) -> QIcon:
        if asset.kind in ("image", "svg") and asset.data:
            image = QImage.fromData(asset.data)
            if not image.isNull():
                return QIcon(QPixmap.fromImage(image).scaled(72, 72, Qt.KeepAspectRatio,
                                                             Qt.SmoothTransformation))
            return get_icon("image", C.text_dim)
        return get_icon({"audio": "audio", "video": "video", "pose": "pose",
                         "animation": "motion", "brush": "brush"}.get(asset.kind, "folder"),
                        C.text_dim)

    def _folder_clicked(self, item, _column) -> None:
        self._current_folder = item.data(0, Qt.UserRole) or ""
        self.rebuild()

    def _asset_double_clicked(self, item) -> None:
        uid = item.data(Qt.UserRole)
        asset = self.session.project.asset(uid)
        if asset is None:
            return
        if asset.kind in ("image", "svg"):
            self.session.place_asset(uid)
        elif asset.kind == "audio":
            self.session.add_audio_asset(uid)
        elif asset.kind == "pose":
            self.session.apply_stored_pose(uid)
        elif asset.kind == "animation":
            self.session.apply_library_animation(asset.name)

    # ---------------------------------------------------------------- actions
    def import_files(self) -> None:
        paths, _filter = QFileDialog.getOpenFileNames(
            self, "Import assets", "",
            "Media (*.png *.jpg *.jpeg *.bmp *.gif *.svg *.webp *.wav *.mp3 *.ogg *.mp4 "
            "*.mov *.webm);;All files (*)")
        if paths:
            self.session.import_paths(paths)

    def _asset_menu(self, pos) -> None:
        item = self.grid.itemAt(pos)
        menu = QMenu(self)
        if item is not None:
            uid = item.data(Qt.UserRole)
            asset = self.session.project.asset(uid)
            menu.addAction("Place on canvas", lambda: self.session.place_asset(uid))
            if asset is not None and asset.kind == "audio":
                menu.addAction("Add as audio track", lambda: self.session.add_audio_asset(uid))
            if asset is not None and asset.kind in ("image", "svg"):
                menu.addAction("Auto rig this character",
                               lambda: self.session.auto_rig_character(uid))
                menu.addAction("Add as new layer",
                               lambda: self.session.place_asset(uid, layer=None))
            if asset is not None and asset.kind == "pose":
                menu.addAction("Apply pose", lambda: self.session.apply_stored_pose(uid))
            menu.addSeparator()
            menu.addAction("Rename…", lambda: self._rename(uid))
            menu.addAction("Tags…", lambda: self._edit_tags(uid))
            menu.addAction("Duplicate", lambda: self._duplicate(uid))
            menu.addAction("Delete from library", lambda: self._delete(uid))
            menu.addSeparator()
        menu.addAction("Import files…", self.import_files)
        menu.addAction("New folder…", self._new_folder)
        menu.exec(self.grid.mapToGlobal(pos))

    def _rename(self, uid: str) -> None:
        asset = self.session.project.asset(uid)
        if asset is None:
            return
        name, ok = QInputDialog.getText(self, "Rename asset", "Name:", QLineEdit.Normal,
                                        asset.name)
        if ok and name.strip():
            asset.name = name.strip()
            self.rebuild()
            self.session.assets_changed.emit()

    def _edit_tags(self, uid: str) -> None:
        asset = self.session.project.asset(uid)
        if asset is None:
            return
        text, ok = QInputDialog.getText(self, "Asset tags", "Comma separated tags:",
                                        QLineEdit.Normal, ", ".join(asset.tags))
        if ok:
            asset.tags = [t.strip() for t in text.split(",") if t.strip()]
            self.rebuild()
            self.session.assets_changed.emit()

    def _duplicate(self, uid: str) -> None:
        asset = self.session.project.asset(uid)
        if asset is None:
            return
        clone = self.session.project.add_asset(f"{asset.name} copy", asset.kind, asset.data,
                                               source_path=asset.source_path,
                                               tags=list(asset.tags), folder=asset.folder,
                                               meta=dict(asset.meta))
        self.session.assets_changed.emit()
        self.session.status(f"Duplicated '{asset.name}' → '{clone.name}'")

    def _delete(self, uid: str) -> None:
        asset = self.session.project.asset(uid)
        if asset is None:
            return
        data = asset
        self.session.project.remove_asset(uid)
        self.session.command(f"Delete asset '{data.name}'",
                             lambda: self.session.project.assets.__setitem__(uid, data),
                             lambda: self.session.project.assets.pop(uid, None))
        self.session.assets_changed.emit()

    def _new_folder(self) -> None:
        name, ok = QInputDialog.getText(self, "New folder", "Folder name:", QLineEdit.Normal,
                                        "My Folder")
        if not ok or not name.strip():
            return
        folder = name.strip()
        self.session.project.add_asset("folder", "folder", data=None, folder=folder)
        assets = [a for a in self.session.project.assets.values() if a.name == "folder"]
        for asset in assets:
            self.session.project.remove_asset(asset.uid)
        self.rebuild()

    def apply_animation(self) -> None:
        item = self.anim_list.currentItem()
        if item is None:
            return
        self.session.apply_library_animation(item.data(Qt.UserRole),
                                             loops=int(self.loops.currentData() or 1))

    def use_template(self) -> None:
        item = self.template_list.currentItem()
        if item is None:
            return
        name = item.data(Qt.UserRole)
        self.session.new_project(name)
        self.session.status(f"New project from template '{name}'")


class SceneBar(QWidget):
    """Scene switcher with add / duplicate / delete / rename."""

    def __init__(self, session, parent=None):
        super().__init__(parent)
        self.session = session
        lay = QHBoxLayout(self)
        lay.setContentsMargins(6, 4, 6, 4)
        lay.setSpacing(4)
        label = QLabel("Scenes")
        label.setObjectName("section")
        lay.addWidget(label)

        self.combo = QComboBox()
        self.combo.setMinimumWidth(180)
        self.combo.setToolTip("Switch between scenes (Street, House, School …)")
        self.combo.currentIndexChanged.connect(self._selected)
        lay.addWidget(self.combo)

        for icon_name, tip, slot in (
            ("add", "Add scene", lambda: session.add_scene()),
            ("duplicate", "Duplicate scene", lambda: session.duplicate_scene()),
            ("edit", "Rename scene", self._rename),
            ("trash", "Delete scene", lambda: session.remove_scene()),
        ):
            btn = QPushButton()
            btn.setIcon(get_icon(icon_name, C.text_dim))
            btn.setIconSize(QSize(14, 14))
            btn.setFixedSize(26, 24)
            btn.setToolTip(tip)
            btn.clicked.connect(slot)
            lay.addWidget(btn)
        lay.addStretch(1)
        self.info = QLabel("")
        self.info.setObjectName("hint")
        lay.addWidget(self.info)
        session.project_changed.connect(self.rebuild)
        session.scene_changed.connect(self.rebuild)
        self.rebuild()

    def rebuild(self) -> None:
        self.combo.blockSignals(True)
        self.combo.clear()
        for scene in self.session.project.scenes:
            self.combo.addItem(scene.name, scene.uid)
        active = self.session.scene.uid
        for i in range(self.combo.count()):
            if self.combo.itemData(i) == active:
                self.combo.setCurrentIndex(i)
        self.combo.blockSignals(False)
        scene = self.session.scene
        self.info.setText(f"{len(scene.layers)} layers · {scene.fps} fps · "
                          f"{scene.width}×{scene.height}")

    def _selected(self, index: int) -> None:
        uid = self.combo.itemData(index)
        if uid and uid != self.session.scene.uid:
            self.session.select_scene(uid)

    def _rename(self) -> None:
        scene = self.session.scene
        name, ok = QInputDialog.getText(self, "Rename scene", "Scene name:", QLineEdit.Normal,
                                        scene.name)
        if ok and name.strip():
            self.session.rename_scene(scene.uid, name.strip())


_ = (os, QSplitter, template_names)
