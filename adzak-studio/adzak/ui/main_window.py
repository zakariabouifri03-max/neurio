"""Main window: sidebar with search, workspace pages, menus, autosave/recovery and onboarding."""
from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import Qt, QTimer
from PySide6.QtGui import QAction, QKeySequence
from PySide6.QtWidgets import (
    QApplication, QComboBox, QFileDialog, QHBoxLayout, QInputDialog, QLabel, QLineEdit, QListWidget,
    QListWidgetItem, QMainWindow, QMessageBox, QPushButton, QSplitter, QStackedWidget, QVBoxLayout, QWidget,
)

from .. import APP_NAME, __version__
from ..core import ffmpeg, projects
from ..core.errors import AppError
from ..core.i18n import LANGUAGES, tr
from ..core.log import get_logger
from ..core.paths import app_data_dir, enforce_cache_limit
from . import common
from .dialogs import SettingsDialog
from .pages_image import ImagePage
from .pages_tools import AssistantPage, AudioPage, ConverterPage
from .pages_video import VideoPage
from .theme import apply_theme

log = get_logger("main")

VIDEO_ASPECTS = ["16:9", "9:16", "1:1", "4:5"]
RESOLUTIONS = {"720p": 720, "1080p": 1080, "1440p": 1440, "4K (2160p)": 2160}


class Dashboard(QWidget):
    def __init__(self, win: "MainWindow"):
        super().__init__()
        self.win = win
        root = QVBoxLayout(self)
        title = QLabel(APP_NAME); title.setObjectName("title")
        root.addWidget(title)
        intro = QLabel(
            "<b>Getting started</b><br>"
            "1. Create a project below, or drop media onto the Video Studio.<br>"
            "2. Edit on the timeline and preview frames as you go.<br>"
            "3. Export to a platform preset. Work is autosaved every few minutes.<br><br>"
            "Everything in the Video, Photo, Converter and Audio studios runs on this computer. "
            "Online AI features need your own API key (see Settings).")
        intro.setWordWrap(True)
        root.addWidget(intro)
        row = QHBoxLayout()
        for label, fn in (("New video project", win.new_video), ("New photo project", win.new_photo),
                          ("New design", win.new_design), (tr("open_project"), win.open_any)):
            b = QPushButton(label)
            if label.startswith("New video"):
                b.setObjectName("primary")
            b.clicked.connect(fn)
            row.addWidget(b)
        root.addLayout(row)
        root.addWidget(QLabel(f"<b>{tr('recent')}</b>"))
        self.recent = QListWidget()
        self.recent.setToolTip("Double-click to open")
        self.recent.itemDoubleClicked.connect(self._open_item)
        root.addWidget(self.recent, 1)
        self.ff = QLabel(); self.ff.setObjectName("muted"); self.ff.setWordWrap(True)
        root.addWidget(self.ff)
        self.refresh()

    def refresh(self) -> None:
        self.recent.clear()
        for r in self.win.db.recent_projects():
            if not Path(r["file_path"]).exists():
                continue
            item = QListWidgetItem(f"{r['name']}   ({r['kind']})  —  {r['file_path']}")
            item.setData(Qt.UserRole, r["file_path"])
            self.recent.addItem(item)
        try:
            self.ff.setText(f"FFmpeg ready: {ffmpeg.find_ffmpeg()}")
            self.ff.setStyleSheet("color: #3ecf8e;")
        except AppError as exc:
            self.ff.setText(f"{tr('ffmpeg_missing')} {exc.user_message}")
            self.ff.setStyleSheet("color: #f0b429;")

    def _open_item(self, item: QListWidgetItem) -> None:
        self.win.open_path(item.data(Qt.UserRole))


class MainWindow(QMainWindow):
    SECTIONS = [("🏠", "dashboard"), ("🎬", "video"), ("🖼", "photo"), ("🔄", "converter"), ("🎵", "audio"),
                ("🤖", "assistant")]

    def __init__(self, db):
        super().__init__()
        self.db = db
        self.setWindowTitle(APP_NAME)
        self.resize(1360, 860)
        self.setAcceptDrops(True)
        self.stack = QStackedWidget()
        self.dashboard = Dashboard(self)
        self.video = VideoPage(self, db, self.settings)
        self.image = ImagePage(self, db, self.settings)
        self.converter = ConverterPage()
        self.audio = AudioPage()
        self.assistant = AssistantPage(self.settings)
        for w in (self.dashboard, self.video, self.image, self.converter, self.audio, self.assistant):
            self.stack.addWidget(w)
        self._build_sidebar()
        self._build_menus()
        split = QSplitter(Qt.Horizontal)
        split.addWidget(self.sidebar)
        split.addWidget(self.stack)
        split.setStretchFactor(1, 1)
        split.setSizes([230, 1100])
        self.setCentralWidget(split)
        self.status_lbl = QLabel(tr("ready"))
        self.statusBar().addPermanentWidget(self.status_lbl)
        self.statusBar().showMessage("Ctrl+N new video · Ctrl+O open · Ctrl+S save · Ctrl+E export")
        self._autosave = QTimer(self)
        self._autosave.timeout.connect(self.autosave_now)
        self._autosave.start(int(db.get_setting("autosave_minutes")) * 60 * 1000)
        self.select_section(0)
        QTimer.singleShot(400, self._check_recovery)
        QTimer.singleShot(0, self._apply_cache_limit)

    # ------------------------------------------------------------ build
    def _build_sidebar(self) -> None:
        self.sidebar = QWidget()
        self.sidebar.setMinimumWidth(200)
        v = QVBoxLayout(self.sidebar)
        self.search = QLineEdit(); self.search.setObjectName("search")
        self.search.setPlaceholderText(tr("search_tools"))
        self.search.setToolTip("Type to filter tools")
        self.search.textChanged.connect(self._filter_sidebar)
        v.addWidget(self.search)
        self.nav = QListWidget()
        self.nav.setToolTip("Workspaces")
        for icon, key in self.SECTIONS:
            item = QListWidgetItem(f"{icon}  {tr(key)}")
            item.setData(Qt.UserRole, key)
            self.nav.addItem(item)
        self.nav.currentRowChanged.connect(self.stack.setCurrentIndex)
        v.addWidget(self.nav, 1)
        self.lang_box = QComboBox()
        for code, name in LANGUAGES.items():
            self.lang_box.addItem(name, code)
        self.lang_box.setCurrentIndex(max(0, self.lang_box.findData(self.db.get_setting("language"))))
        self.lang_box.setToolTip("Interface language (applies after restart)")
        self.lang_box.currentIndexChanged.connect(self._language_changed)
        v.addWidget(self.lang_box)
        btn_settings = QPushButton(tr("settings")); btn_settings.clicked.connect(self.open_settings)
        v.addWidget(btn_settings)

    def _build_menus(self) -> None:
        mb = self.menuBar()
        f = mb.addMenu(tr("file"))
        self._act(f, tr("new_project") + " (video)", self.new_video, "Ctrl+N")
        self._act(f, "New photo project", self.new_photo)
        self._act(f, tr("open_project") + "…", self.open_any, "Ctrl+O")
        self._act(f, tr("save"), self.save_current, "Ctrl+S")
        f.addSeparator()
        self._act(f, tr("export") + "…", self.export_current, "Ctrl+E")
        self._act(f, "Save export presets (JSON)…", self.save_presets)
        f.addSeparator()
        self._act(f, "Create preview proxies for timeline footage", self.make_proxies)
        f.addSeparator()
        self._act(f, "Quit", self.close, "Ctrl+Q")
        e = mb.addMenu(tr("edit"))
        self._act(e, tr("undo"), self.undo, "Ctrl+Z")
        self._act(e, tr("redo"), self.redo, "Ctrl+Y")
        self._act(e, tr("split"), self.video.split_clip, "Ctrl+B")
        self._act(e, tr("settings"), self.open_settings)
        v = mb.addMenu(tr("view"))
        self._act(v, "Dark theme", lambda: self._set_theme("dark"))
        self._act(v, "Light theme", lambda: self._set_theme("light"))
        h = mb.addMenu(tr("help"))
        self._act(h, "What can run offline? (capabilities)", lambda: self.select_section(5))
        self._act(h, "Keyboard shortcuts", self._shortcuts)
        self._act(h, "About", self._about)

    def _act(self, menu, text: str, fn, shortcut: str = "") -> QAction:
        a = QAction(text, self)
        if shortcut:
            a.setShortcut(QKeySequence(shortcut))
        a.triggered.connect(fn)
        menu.addAction(a)
        return a

    # --------------------------------------------------------- navigation
    def select_section(self, index: int) -> None:
        self.nav.setCurrentRow(index)
        self.stack.setCurrentIndex(index)
        if index == 0:
            self.dashboard.refresh()

    def _filter_sidebar(self, text: str) -> None:
        q = text.strip().lower()
        for i in range(self.nav.count()):
            self.nav.item(i).setHidden(bool(q) and q not in self.nav.item(i).text().lower())

    def _set_theme(self, theme: str) -> None:
        self.db.set_setting("theme", theme)
        apply_theme(QApplication.instance(), theme)

    def _language_changed(self, _i: int) -> None:
        code = self.lang_box.currentData()
        self.db.set_setting("language", code)
        QMessageBox.information(self, APP_NAME, "Restart ADZAK Creative Studio to apply the language.")

    def settings(self):
        return self.db.all_settings()

    def open_settings(self) -> None:
        dlg = SettingsDialog(self, self.db)
        if dlg.exec():
            self.assistant.refresh_provider()
            self._autosave.setInterval(int(self.db.get_setting("autosave_minutes")) * 60 * 1000)
            self._apply_cache_limit()
            apply_theme(QApplication.instance(), self.db.get_setting("theme"))

    # ----------------------------------------------------------- actions
    def new_video(self) -> None:
        aspect, ok = QInputDialog.getItem(self, "New video project", "Aspect ratio", VIDEO_ASPECTS, 0, False)
        if not ok:
            return
        res, ok = QInputDialog.getItem(self, "New video project", "Resolution (short side)",
                                       list(RESOLUTIONS), 1, False)
        if not ok:
            return
        if self.video.dirty and not self._confirm_discard(self.video):
            return
        self.video.new_project(aspect, RESOLUTIONS[res])
        self.select_section(1)

    def new_photo(self) -> None:
        if self.image.doc is not None and self.image.dirty and not self._confirm_discard(self.image):
            return
        self.select_section(2)
        self.image.new_photo()

    def new_design(self) -> None:
        self.select_section(2)
        self.image.new_design()

    def open_any(self) -> None:
        f, _ = QFileDialog.getOpenFileName(self, tr("open_project"), "",
                                           "ADZAK projects (*.adzproj *.adzimg);;All files (*)")
        if f:
            self.open_path(f)

    def open_path(self, path: str) -> None:
        if not Path(path).exists():
            common.error(self, "That project file no longer exists.")
            return
        if path.endswith(projects.VIDEO_EXT):
            if self.video.dirty and not self._confirm_discard(self.video):
                return
            self.select_section(1)
            self.video.open_project(path)
        elif path.endswith(projects.IMAGE_EXT):
            self.select_section(2)
            self.image.open_project(path)
        else:
            self.select_section(2)
            self.image.open_image_file(path)

    def save_current(self) -> None:
        page = self.stack.currentWidget()
        if page is self.video:
            self.video.save_project()
        elif page is self.image:
            self.image.save_project()
        else:
            self.statusBar().showMessage("Nothing to save on this page.", 4000)

    def export_current(self) -> None:
        page = self.stack.currentWidget()
        if page is self.video:
            self.video.export()
        elif page is self.image:
            self.image.export()
        else:
            self.statusBar().showMessage("Export is available in Video and Photo & Design.", 4000)

    def undo(self) -> None:
        page = self.stack.currentWidget()
        if hasattr(page, "undo"):
            page.undo()

    def redo(self) -> None:
        page = self.stack.currentWidget()
        if hasattr(page, "redo"):
            page.redo()

    def save_presets(self) -> None:
        self.converter.export_presets()

    def make_proxies(self) -> None:
        self.select_section(1)
        self.video.proxy_box.setChecked(True)

    def _shortcuts(self) -> None:
        QMessageBox.information(self, "Keyboard shortcuts",
                                "Ctrl+N  new video project\nCtrl+O  open project\nCtrl+S  save\n"
                                "Ctrl+E  export\nCtrl+Z / Ctrl+Y  undo / redo\nCtrl+B  split clip at playhead\n"
                                "Delete  delete the selected clip (timeline focused)\n"
                                "Ctrl+Q  quit")

    def _about(self) -> None:
        ff = "not found"
        try:
            ff = ffmpeg.find_ffmpeg()
        except AppError:
            pass
        QMessageBox.about(self, "About", f"<b>{APP_NAME}</b> {__version__}<br>"
                          f"Data folder: {app_data_dir()}<br>FFmpeg: {ff}<br><br>"
                          "Open-source components are listed in THIRD_PARTY_LICENSES.md.")

    # ------------------------------------------------------ autosave
    def autosave_now(self) -> None:
        for key, page in (("video", self.video), ("image", self.image)):
            try:
                payload = page.autosave_payload()
            except Exception as exc:  # noqa: BLE001
                log.warning("Autosave skipped for %s: %s", key, exc)
                continue
            if payload is not None:
                projects.write_autosave(key, payload)

    def _check_recovery(self) -> None:
        entries = projects.find_autosaves()
        if not entries:
            return
        ans = QMessageBox.question(self, APP_NAME, tr("recovered"),
                                   QMessageBox.Yes | QMessageBox.No)
        if ans == QMessageBox.Yes:
            for e in entries:
                try:
                    if e.payload.get("kind") == "video":
                        self.select_section(1)
                        self.video.restore_payload(e.payload)
                    elif e.payload.get("kind") == "image":
                        self.select_section(2)
                        self.image.restore_payload(e.payload)
                except (AppError, ValueError, KeyError, OSError) as exc:
                    log.warning("Could not recover one autosave: %s", exc)
                    common.error(self, "One unsaved item could not be recovered and was skipped.")
        projects.clear_all_autosaves()

    def _confirm_discard(self, page) -> bool:
        ans = QMessageBox.question(self, APP_NAME, "You have unsaved changes. Save before continuing?",
                                   QMessageBox.Save | QMessageBox.Discard | QMessageBox.Cancel)
        if ans == QMessageBox.Save:
            return bool(page.save_project())
        return ans == QMessageBox.Discard

    def _apply_cache_limit(self) -> None:
        try:
            enforce_cache_limit(int(self.db.get_setting("cache_limit_mb")))
        except OSError as exc:
            log.warning("Cache cleanup failed: %s", exc)

    # ------------------------------------------------------- lifecycle
    def closeEvent(self, event) -> None:
        for page in (self.video, self.image):
            if getattr(page, "dirty", False) and not self._confirm_discard(page):
                event.ignore()
                return
        self.autosave_now_clear()
        super().closeEvent(event)

    def autosave_now_clear(self) -> None:
        projects.clear_all_autosaves()

    def dragEnterEvent(self, e) -> None:
        if e.mimeData().hasUrls():
            e.acceptProposedAction()

    def dropEvent(self, e) -> None:
        files = [u.toLocalFile() for u in e.mimeData().urls() if u.isLocalFile()]
        media = [f for f in files if common.is_media(f)]
        if not media:
            return
        self.select_section(1)
        self.video._add_media_files(media)
