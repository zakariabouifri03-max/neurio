"""Media bin: import, thumbnails, proxy generation and drag-to-timeline."""
from __future__ import annotations

import json
from pathlib import Path

from PySide6.QtCore import Qt, QMimeData, QSize, Signal
from PySide6.QtGui import QDrag, QIcon, QPixmap
from PySide6.QtWidgets import (QWidget, QVBoxLayout, QHBoxLayout, QPushButton,
                               QListWidget, QListWidgetItem, QMenu, QFileDialog,
                               QLabel)

from ..core.constants import MEDIA_EXTENSIONS
from ..core.logging_setup import get_logger
from ..core.workers import TaskWorker, TaskCancelled
from ..media import thumbnails
from ..media.proxies import generate_proxy
from ..timeline_ui.timeline_widget import MIME_MEDIA

log = get_logger("media-bin")


class DraggableMediaList(QListWidget):
    def startDrag(self, supported_actions):  # noqa: N802 - Qt override
        ids = []
        for item in self.selectedItems():
            mid = item.data(Qt.ItemDataRole.UserRole)
            if mid:
                ids.append(mid)
        if not ids:
            return
        drag = QDrag(self)
        mime = QMimeData()
        mime.setData(MIME_MEDIA, json.dumps(ids).encode("utf-8"))
        drag.setMimeData(mime)
        drag.exec(Qt.DropAction.CopyAction)


class MediaBin(QWidget):
    importRequested = Signal(list)

    def __init__(self, controller, parent=None):
        super().__init__(parent)
        self.controller = controller
        layout = QVBoxLayout(self)
        layout.setContentsMargins(8, 8, 8, 8)
        header = QHBoxLayout()
        header.addWidget(QLabel("Media library"))
        header.addStretch(1)
        self.btn_import = QPushButton("Import")
        self.btn_import.setObjectName("Primary")
        self.btn_proxy = QPushButton("Make proxy")
        self.btn_relink = QPushButton("Relink")
        self.btn_import.clicked.connect(self.browse_import)
        self.btn_proxy.clicked.connect(self.make_proxy)
        self.btn_relink.clicked.connect(self.relink)
        header.addWidget(self.btn_proxy)
        header.addWidget(self.btn_relink)
        header.addWidget(self.btn_import)
        layout.addLayout(header)

        self.list = DraggableMediaList()
        self.list.setViewMode(QListWidget.ViewMode.IconMode)
        self.list.setIconSize(QSize(96, 64))
        self.list.setResizeMode(QListWidget.ResizeMode.Adjust)
        self.list.setDragDropMode(QListWidget.DragDropMode.DragOnly)
        self.list.setContextMenuPolicy(Qt.ContextMenuPolicy.CustomContextMenu)
        self.list.customContextMenuRequested.connect(self._context_menu)
        self.list.setSpacing(6)
        layout.addWidget(self.list, 1)
        self.controller.projectChanged.connect(self.refresh)
        self.controller.timelineChanged.connect(self.refresh)
        self._painted: set[str] = set()

    # ------------------------------------------------------------- import
    def browse_import(self) -> None:
        exts = " ".join(f"*{e}" for e in sorted(MEDIA_EXTENSIONS))
        paths, _ = QFileDialog.getOpenFileNames(
            self, "Import media", self.controller.config.get("last_project_dir", ""),
            f"Media files ({exts});;All files (*)")
        if not paths:
            return
        self.controller.config.set("last_project_dir", str(Path(paths[0]).parent))
        worker = self.controller.import_files(paths, on_finished=lambda _r: self.after_import())
        worker.progress.connect(lambda f, m: self.window().statusBar().showMessage(m)
                                if self.window() else None)

    def after_import(self) -> None:
        self.refresh()
        self._generate_assets()

    def refresh(self) -> None:
        project = self.controller.project
        current = {self.list.item(i).data(Qt.ItemDataRole.UserRole)
                   for i in range(self.list.count())}
        wanted = set(project.media)
        if current == wanted and not wanted:
            return
        self.list.clear()
        self._painted.clear()
        for mid, item in project.media.items():
            row = QListWidgetItem()
            badge = "🎵" if item.kind == "audio" else ("🖼" if item.kind == "image" else "🎞")
            row.setText(f"{badge} {item.name}\n{item.duration:.1f}s"
                        if item.duration else f"{badge} {item.name}")
            row.setData(Qt.ItemDataRole.UserRole, mid)
            if item.thumbnail_path and Path(item.thumbnail_path).exists():
                row.setIcon(QIcon(item.thumbnail_path))
            if item.missing:
                row.setForeground(Qt.GlobalColor.red)
                row.setText(row.text() + "  (missing)")
            self.list.addItem(row)

    # ------------------------------------------------------------- assets
    def _generate_assets(self) -> None:
        project = self.controller.project

        def task(progress, should_cancel):
            for i, item in enumerate(project.media.values()):
                if should_cancel():
                    raise TaskCancelled()
                try:
                    if item.kind in ("video", "image"):
                        strip = thumbnails.thumbnail_strip(
                            item.path, max(1.0, item.duration), 6,
                            file_hash=item.file_hash, should_cancel=should_cancel)
                        if strip:
                            from ..media import cache
                            cache.store_asset(item.file_hash, "thumbstrip",
                                              json.dumps(strip), "6")
                            item.thumbnail_path = strip[0]
                    if item.has_audio or item.kind == "audio":
                        thumbnails.waveform(item.path, file_hash=item.file_hash,
                                            should_cancel=should_cancel)
                except Exception:  # noqa: BLE001
                    log.exception("Asset generation failed for %s", item.name)
                progress((i + 1) / max(1, len(project.media)), "Caching media")
            return True

        worker = TaskWorker(task)
        worker.progress.connect(lambda f, m: self._status(m))
        worker.finished.connect(lambda _: self.refresh())
        worker.start()

    def _status(self, message: str) -> None:
        win = self.window()
        if win:
            win.statusBar().showMessage(message)

    def _selected_media_id(self) -> str | None:
        item = self.list.currentItem()
        return item.data(Qt.ItemDataRole.UserRole) if item else None

    def make_proxy(self) -> None:
        mid = self._selected_media_id()
        if not mid:
            return
        media = self.controller.project.media[mid]

        def task(progress, should_cancel):
            return generate_proxy(media,
                                  self.controller.config.get("proxy_height", 720),
                                  progress, should_cancel)

        worker = TaskWorker(task)
        worker.progress.connect(lambda f, m: self._status(m))
        worker.failed.connect(lambda e: self._status("Proxy failed"))
        worker.finished.connect(lambda _: self.refresh())
        worker.start()

    def relink(self) -> None:
        mid = self._selected_media_id()
        if not mid:
            folder = QFileDialog.getExistingDirectory(self, "Locate media folder")
            if folder:
                fixed = self.controller.library.relink_folder(folder)
                self._status(f"Relinked {fixed} item(s)")
                self.refresh()
            return
        path, _ = QFileDialog.getOpenFileName(self, "Relink media")
        if path and self.controller.library.relink(mid, path):
            self.refresh()

    def _context_menu(self, pos) -> None:
        item = self.list.itemAt(pos)
        menu = QMenu(self)
        if item:
            mid = item.data(Qt.ItemDataRole.UserRole)
            media = self.controller.project.media[mid]
            menu.addAction("Reveal in folder",
                           lambda: self._reveal(media.path))
            menu.addAction("Make proxy", self.make_proxy)
            menu.addSeparator()
            menu.addAction("Remove from library",
                           lambda: self._remove(mid))
        menu.addSeparator()
        menu.addAction("Relink missing folder...", self.relink)
        menu.exec(self.list.mapToGlobal(pos))

    def _remove(self, mid: str) -> None:
        if mid not in self.controller.project.media_used_by_timeline():
            self.controller.project.remove_media(mid)
            self.refresh()

    @staticmethod
    def _reveal(path: str) -> None:
        import sys, subprocess, os
        p = Path(path)
        if not p.exists():
            return
        if sys.platform == "win32":
            os.startfile(str(p.parent))  # type: ignore[attr-defined]
        elif sys.platform == "darwin":
            subprocess.Popen(["open", str(p.parent)])
        else:
            subprocess.Popen(["xdg-open", str(p.parent)])


