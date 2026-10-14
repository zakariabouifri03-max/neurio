import json
from pathlib import Path

from PySide6.QtCore import QTimer, QUrl, Qt
from PySide6.QtGui import QDesktopServices
from PySide6.QtWidgets import (
    QAbstractItemView,
    QApplication,
    QCheckBox,
    QDialog,
    QFrame,
    QHBoxLayout,
    QHeaderView,
    QInputDialog,
    QMainWindow,
    QMessageBox,
    QProgressBar,
    QPushButton,
    QSplitter,
    QStyle,
    QTableView,
    QVBoxLayout,
    QWidget,
)

from .dialogs import AddDialog, SettingsDialog, label
from .download_manager import DownloadManager
from .icons import line_icon
from .signals import EngineSignals
from .theme import stylesheet
from .ui_models import ChunkTable, DownloadTable, eta_text, human_bytes


class MainWindow(QMainWindow):
    def __init__(self, root, settings):
        super().__init__()
        self.bridge = EngineSignals(self)
        self.bridge.progress.connect(self.on_progress)
        self.manager = DownloadManager(root, settings, self.bridge.progress.emit)
        self.snapshots = {}
        self.filter = "All downloads"
        self.closing = self.closed = False
        self.saved_counts = {}
        self.setWindowTitle("UltraDownload")
        self.resize(1380, 920)
        self.setMinimumSize(1060, 740)
        QApplication.instance().setStyleSheet(stylesheet(settings.theme))
        self.build()
        self.timer = QTimer(self)
        self.timer.timeout.connect(self.refresh)
        self.timer.start(250)
        self.refresh()
        if any(r["status"] == "paused" for r in self.manager.db.downloads()):
            QTimer.singleShot(200, self.offer_recovery)

    def button(self, text, slot, primary=False, icon=None):
        button = QPushButton(text)
        if primary:
            button.setObjectName("primary")
        if icon is not None:
            button.setIcon(line_icon(icon, "#ffffff" if primary else "#c6c2dc"))
        button.clicked.connect(slot)
        return button

    def build(self):
        root = QWidget()
        horizontal = QHBoxLayout(root)
        horizontal.setSpacing(0)
        horizontal.setContentsMargins(0, 0, 0, 0)
        self.setCentralWidget(root)
        sidebar = QFrame()
        sidebar.setObjectName("sidebar")
        sidebar.setFixedWidth(224)
        side = QVBoxLayout(sidebar)
        side.setContentsMargins(17, 30, 17, 20)
        side.setSpacing(8)
        brand = label("↓  UltraDownload", "brand")
        side.addWidget(brand)
        side.addWidget(label("BIG FILES. SMALL CHUNKS.", "eyebrow"))
        side.addSpacing(34)
        side.addWidget(label("  WORKSPACE", "muted"))
        self.navigation = []
        for name, icon in [
            ("All downloads", QStyle.SP_DirHomeIcon),
            ("Active", QStyle.SP_ArrowDown),
            ("Queue", QStyle.SP_FileDialogListView),
            ("Completed", QStyle.SP_DialogApplyButton),
            ("Failed", QStyle.SP_MessageBoxWarning),
        ]:
            b = self.button(
                name, lambda _, value=name: self.set_filter(value), icon=icon
            )
            b.setObjectName("nav")
            b.setCheckable(True)
            b.setChecked(name == self.filter)
            side.addWidget(b)
            self.navigation.append(b)
        side.addStretch()
        info = label(
            "1 MiB per chunk\nUp to 10 connections\nVerified before completion", "muted"
        )
        info.setStyleSheet("line-height: 1.6; padding: 12px 5px;")
        info.setWordWrap(True)
        side.addWidget(info)
        side.addWidget(
            self.button(
                "Settings", self.settings, icon=QStyle.SP_FileDialogDetailedView
            )
        )
        side.addWidget(label("  VERSION 1.0.0", "muted"))
        horizontal.addWidget(sidebar)
        body = QWidget()
        layout = QVBoxLayout(body)
        layout.setContentsMargins(30, 28, 30, 20)
        layout.setSpacing(20)
        header = QHBoxLayout()
        heading = QVBoxLayout()
        heading.addWidget(label("YOUR TRANSFER WORKSPACE", "eyebrow"))
        self.title = label("Downloads", "title")
        heading.addWidget(self.title)
        heading.addWidget(
            label("Large files, under control. Every byte accounted for.", "muted")
        )
        header.addLayout(heading)
        header.addStretch()
        header.addWidget(
            self.button("Add download", self.add, True, QStyle.SP_DialogOpenButton)
        )
        layout.addLayout(header)
        statistics = QHBoxLayout()
        statistics.setSpacing(12)
        self.stats = {}
        for key, title in [
            ("speed", "TRANSFER SPEED"),
            ("bytes", "DOWNLOADED"),
            ("active", "ACTIVE"),
            ("completed", "COMPLETED"),
            ("failed", "FAILED"),
        ]:
            panel = QFrame()
            panel.setObjectName("panel")
            box = QVBoxLayout(panel)
            box.setContentsMargins(16, 16, 16, 16)
            box.addWidget(label(title, "muted"))
            value = label("—", "stat")
            self.stats[key] = value
            box.addWidget(value)
            statistics.addWidget(panel)
        layout.addLayout(statistics)
        tools = QHBoxLayout()
        self.list_title = label("All downloads", "brand")
        tools.addWidget(self.list_title)
        tools.addStretch()
        tools.addWidget(
            self.button("Pause all", self.pause_all, icon=QStyle.SP_MediaPause)
        )
        tools.addWidget(
            self.button("Resume all", self.resume_all, icon=QStyle.SP_MediaPlay)
        )
        layout.addLayout(tools)
        splitter = QSplitter(Qt.Vertical)
        top = QWidget()
        top_layout = QVBoxLayout(top)
        top_layout.setContentsMargins(0, 0, 0, 0)
        self.model = DownloadTable()
        self.table = QTableView()
        self.table.setModel(self.model)
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.setShowGrid(False)
        self.table.setAlternatingRowColors(True)
        self.table.verticalHeader().hide()
        self.table.verticalHeader().setDefaultSectionSize(58)
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        for i, width in enumerate([0, 110, 100, 115, 110, 90]):
            if i:
                self.table.setColumnWidth(i, width)
        self.table.selectionModel().selectionChanged.connect(self.update_details)
        top_layout.addWidget(self.table)
        self.empty = label(
            "Your next big download starts here.\nAdd a direct URL to begin — no transfers are running.",
            "muted",
        )
        self.empty.setAlignment(Qt.AlignCenter)
        self.empty.setMinimumHeight(200)
        self.empty.setObjectName("emptyState")
        self.empty.setStyleSheet(
            "background: #161922; border: 1px solid #292e3b; border-radius: 12px; color: #9aa5bb; padding: 28px; font-size: 15px;"
        )
        top_layout.addWidget(self.empty, 1)
        splitter.addWidget(top)
        self.detail = QFrame()
        self.detail.setObjectName("panel")
        detail = QVBoxLayout(self.detail)
        detail.setContentsMargins(20, 18, 20, 18)
        detail.setSpacing(12)
        detail_header = QHBoxLayout()
        self.detail_name = label("Select a download", "brand")
        detail_header.addWidget(self.detail_name, 1)
        self.detail_status = label("—", "eyebrow")
        detail_header.addWidget(self.detail_status)
        detail.addLayout(detail_header)
        self.progress = QProgressBar()
        self.progress.setRange(0, 1000)
        self.progress.setTextVisible(False)
        detail.addWidget(self.progress)
        self.metrics = label("", "muted")
        self.metrics.setWordWrap(True)
        detail.addWidget(self.metrics)
        self.path = label("", "muted")
        self.path.setWordWrap(True)
        self.path.setTextInteractionFlags(Qt.TextSelectableByMouse)
        detail.addWidget(self.path)
        self.detail_error = label("")
        self.detail_error.setStyleSheet("color: #ef989d;")
        self.detail_error.setWordWrap(True)
        detail.addWidget(self.detail_error)
        actions = QHBoxLayout()
        self.pause_button = self.button(
            "Pause", self.pause_selected, icon=QStyle.SP_MediaPause
        )
        self.resume_button = self.button(
            "Resume", self.resume_selected, icon=QStyle.SP_MediaPlay
        )
        self.retry_button = self.button(
            "Retry failed",
            lambda: self.resume_selected(retry=True),
            icon=QStyle.SP_BrowserReload,
        )
        self.cancel_button = self.button(
            "Cancel", self.cancel_selected, icon=QStyle.SP_DialogCancelButton
        )
        self.priority_button = self.button("Move to top", self.prioritize)
        self.rate_button = self.button("Rate limit", self.bandwidth)
        self.folder_button = self.button(
            "Folder", self.open_folder, icon=QStyle.SP_DirOpenIcon
        )
        for b in (
            self.pause_button,
            self.resume_button,
            self.retry_button,
            self.cancel_button,
            self.priority_button,
            self.rate_button,
            self.folder_button,
        ):
            actions.addWidget(b)
        actions.addStretch()
        detail.addLayout(actions)
        self.show_chunks = QCheckBox("Show chunk monitor")
        detail.addWidget(self.show_chunks)
        self.chunk_model = ChunkTable(self.manager)
        self.chunk_view = QTableView()
        self.chunk_view.setModel(self.chunk_model)
        self.chunk_view.setAlternatingRowColors(True)
        self.chunk_view.setShowGrid(False)
        self.chunk_view.verticalHeader().hide()
        self.chunk_view.horizontalHeader().setSectionResizeMode(QHeaderView.Stretch)
        self.chunk_view.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.ResizeToContents
        )
        self.chunk_view.setMinimumHeight(140)
        self.chunk_view.setMaximumHeight(220)
        self.chunk_view.hide()
        self.show_chunks.toggled.connect(self.chunk_view.setVisible)
        detail.addWidget(self.chunk_view)
        splitter.addWidget(self.detail)
        splitter.setStretchFactor(0, 3)
        splitter.setStretchFactor(1, 2)
        layout.addWidget(splitter, 1)
        horizontal.addWidget(body, 1)
        self.statusBar().showMessage(
            "Ready  •  1 MiB chunks  •  No downloads are executed automatically"
        )

    def on_progress(self, identifier, snapshot):
        self.snapshots[identifier] = snapshot

    def selected(self):
        index = self.table.currentIndex()
        return (
            self.model.rows[index.row()]
            if index.isValid() and index.row() < len(self.model.rows)
            else None
        )

    def refresh(self):
        if self.closed:
            return
        previous = self.selected()
        rows = self.manager.db.downloads()
        states = {
            "Active": {
                "downloading",
                "recovering",
                "assembling",
                "publishing",
                "pausing",
            },
            "Queue": {"queued", "paused", "cancelled"},
            "Completed": {"completed"},
            "Failed": {"failed"},
        }
        visible = [
            r
            for r in rows
            if self.filter == "All downloads" or r["status"] in states[self.filter]
        ]
        self.model.update_rows(visible, self.snapshots)
        if previous:
            selected_index = next(
                (i for i, r in enumerate(visible) if r["id"] == previous["id"]), None
            )
            if (
                selected_index is not None
                and self.table.currentIndex().row() != selected_index
            ):
                self.table.selectRow(selected_index)
        if visible and not self.table.currentIndex().isValid():
            self.table.selectRow(0)
        self.empty.setVisible(not visible)
        self.table.setVisible(bool(visible))
        self.empty.setText(
            "No downloads in this view."
            if rows
            else "Your next big download starts here.\nAdd a direct URL to begin — no transfers are running."
        )
        self.detail.setVisible(bool(visible))
        self.stats["speed"].setText(
            human_bytes(
                sum(
                    self.snapshots.get(r["id"], {}).get("speed", 0)
                    for r in rows
                    if r["status"] == "downloading"
                )
            )
            + "/s"
        )
        self.stats["bytes"].setText(human_bytes(sum(r["downloaded"] for r in rows)))
        for key in ("active", "completed", "failed"):
            count = sum(
                r["status"] in states["Active"]
                if key == "active"
                else r["status"] == key
                for r in rows
            )
            self.stats[key].setText(str(count))
        self.list_title.setText(f"{self.filter}  ·  {len(visible)}")
        self.update_details()
        if self.show_chunks.isChecked():
            self.chunk_model.refresh()
        if self.closing and not self.manager.coordinator.is_alive():
            self.close()

    def update_details(self, *args):
        row = self.selected()
        if not row:
            return
        info = json.loads(row["info"])
        snap = self.snapshots.get(row["id"], {})
        if not snap:
            key = (row["id"], row["updated"])
            if key not in self.saved_counts:
                self.saved_counts = {key: self.manager.db.counts(row["id"])}
            counts = self.saved_counts[key]
            snap = dict(
                completed=counts.get("complete", (0, 0))[0],
                failed=counts.get("failed", (0, 0))[0],
                pending=counts.get("pending", (0, 0))[0]
                + counts.get("active", (0, 0))[0],
            )
        status = row["status"]
        size, amount = info["size"], row["downloaded"]
        speed = snap.get("speed", 0) if status == "downloading" else 0
        self.detail_name.setWordWrap(True)
        self.detail_name.setText(Path(row["destination"]).name)
        self.detail_status.setText(status.upper())
        self.progress.setRange(
            0, 0 if size is None and status == "downloading" else 1000
        )
        self.progress.setValue(
            1000
            if status == "completed"
            else int(min(1000, amount / size * 1000))
            if size
            else 0
        )
        complete = snap.get("completed", row["chunks"] if status == "completed" else 0)
        active = snap.get("active", 0) if status in ("downloading", "pausing") else 0
        chunks = (
            f"{active}/{self.manager.settings.connections} connections  ·  {complete:,}/{row['chunks']:,} chunks complete  ·  {snap.get('pending', max(0, row['chunks'] - complete)):,} pending  ·  {snap.get('failed', 0)} failed"
            if info["ranges"]
            else "Single-stream mode · partial transfers restart on resume"
        )
        percent = (
            "100%"
            if status == "completed"
            else f"{min(100, amount / size * 100):.1f}%"
            if size
            else "—"
        )
        remaining = max(0, size - amount) if size is not None else None
        self.metrics.setText(
            f"{human_bytes(amount)} / {human_bytes(size)}  ·  {percent}  ·  {human_bytes(speed)}/s  ·  {human_bytes(remaining)} left  ·  ETA {eta_text(remaining, speed)}\n{chunks}"
        )
        digest = (
            f"\nSHA-256: {row['actual_hash']}\n"
            + (
                "Matches supplied checksum (trust depends on its source)."
                if row["checksum"]
                else "Local identity hash only; authenticity is not independently verified."
            )
            if row["actual_hash"]
            else ""
        )
        self.path.setText(row["destination"] + digest)
        self.detail_error.setText(row["error"])
        self.detail_error.setVisible(bool(row["error"]))
        with self.manager.lock:
            busy = row["id"] in self.manager.active
        self.pause_button.setEnabled(
            status in ("queued", "downloading", "recovering", "assembling")
        )
        self.resume_button.setEnabled(not busy and status in ("paused", "cancelled"))
        self.retry_button.setEnabled(not busy and status == "failed")
        self.cancel_button.setEnabled(status not in ("completed", "cancelled"))
        self.priority_button.setEnabled(status == "queued")
        self.rate_button.setEnabled(status != "completed")
        self.show_chunks.setEnabled(info["ranges"])
        self.chunk_model.select(row["id"], row["chunks"])

    def set_filter(self, value):
        self.filter = value
        for b in self.navigation:
            b.setChecked(b.text() == value)
        self.refresh()

    def add(self):
        dialog = AddDialog(self.manager, self)
        dialog.exec()
        self.refresh()

    def pause_all(self):
        self.manager.pause_all()
        self.refresh()

    def resume_all(self):
        skipped = self.manager.resume_all()
        if skipped:
            QMessageBox.information(
                self,
                "URLs needed",
                f"{skipped} transfer(s) need their session-only URLs again. Select each and press Resume.",
            )
        self.refresh()

    def pause_selected(self):
        if row := self.selected():
            self.manager.pause(row["id"])
            self.refresh()

    def resume_selected(self, checked=False, retry=False):
        if not (row := self.selected()):
            return
        info = json.loads(row["info"])
        url = None
        if not info["url"] and row["id"] not in self.manager.session_info:
            url, accepted = QInputDialog.getText(
                self,
                "Restore session-only URL",
                "Paste the original direct URL. Remote validators must still match.",
            )
            if not accepted:
                return
        try:
            self.manager.resume(row["id"], url, retry)
        except ValueError as exc:
            QMessageBox.warning(self, "Cannot resume", str(exc))
        self.refresh()

    def cancel_selected(self):
        if not (row := self.selected()):
            return
        box = QMessageBox(self)
        box.setWindowTitle("Cancel download")
        box.setText(
            "Keep verified chunks for a later resume, or delete temporary data?"
        )
        box.setInformativeText(
            "Completed destination files and unrelated files are never deleted."
        )
        keep = box.addButton("Keep data", QMessageBox.AcceptRole)
        delete = box.addButton("Delete temporary data", QMessageBox.DestructiveRole)
        box.addButton(QMessageBox.Cancel)
        box.exec()
        if box.clickedButton() in (keep, delete):
            self.manager.cancel(row["id"], box.clickedButton() == delete)
            self.refresh()

    def prioritize(self):
        if row := self.selected():
            self.manager.prioritize(row["id"])
            self.refresh()

    def bandwidth(self):
        if row := self.selected():
            rate, accepted = QInputDialog.getInt(
                self,
                "Per-download bandwidth",
                "KiB/s (0 = unlimited)",
                row["bandwidth"] // 1024,
                0,
                100000000,
            )
            if accepted:
                self.manager.set_bandwidth(row["id"], rate * 1024)

    def open_folder(self):
        if row := self.selected():
            QDesktopServices.openUrl(
                QUrl.fromLocalFile(str(Path(row["destination"]).parent))
            )

    def settings(self):
        dialog = SettingsDialog(self.manager.settings, self)
        while dialog.exec() == QDialog.Accepted:
            try:
                settings = dialog.values()
                self.manager.apply_settings(settings)
                QApplication.instance().setStyleSheet(stylesheet(settings.theme))
                break
            except (ValueError, OSError) as exc:
                dialog.error.setText(str(exc))

    def offer_recovery(self):
        if (
            QMessageBox.question(
                self,
                "Recover previous transfers",
                "Interrupted or paused downloads were found. Resume them now? Saved chunks will be verified before reuse.",
                QMessageBox.Yes | QMessageBox.No,
                QMessageBox.No,
            )
            == QMessageBox.Yes
        ):
            self.resume_all()

    def closeEvent(self, event):
        if self.closed:
            event.accept()
            return
        self.closing = True
        self.manager.request_shutdown()
        if self.manager.coordinator.is_alive():
            self.statusBar().showMessage(
                "Stopping transfers safely… waiting for active reads (bounded by configured network timeouts)."
            )
            self.centralWidget().setEnabled(False)
            event.ignore()
        else:
            self.timer.stop()
            self.manager.close()
            self.closed = True
            event.accept()
