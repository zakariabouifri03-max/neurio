from pathlib import Path
from PySide6.QtCore import Qt, QTimer, QUrl
from PySide6.QtGui import QDesktopServices, QIcon
from PySide6.QtWidgets import (QApplication, QMainWindow, QWidget, QHBoxLayout, QVBoxLayout,
    QFrame, QLabel, QPushButton, QTableView, QHeaderView, QAbstractItemView, QProgressBar,
    QMessageBox, QSplitter, QInputDialog)
from .dialogs import AddDownloadDialog, SettingsDialog
from .theme import apply_theme
from .ui_models import DownloadTableModel, ChunkTableModel, ProgressDelegate, human_bytes, eta_text


class MainWindow(QMainWindow):
    def __init__(self, manager, settings_path):
        super().__init__()
        self.manager, self.settings_path = manager, settings_path
        self.selected_id, self.closing = None, False
        self.dirty = True
        self.setWindowTitle('UltraDownload — Download with confidence')
        self.resize(1240, 860)
        self.setMinimumSize(960, 680)
        icon = Path(__file__).resolve().parent.parent / 'assets' / 'app_icon.ico'
        self.setWindowIcon(QIcon(str(icon)))
        shell = QWidget()
        self.setCentralWidget(shell)
        root = QHBoxLayout(shell)
        root.setContentsMargins(0, 0, 0, 0)
        root.setSpacing(0)
        sidebar = QFrame()
        sidebar.setObjectName('sidebar')
        sidebar.setFixedWidth(215)
        nav = QVBoxLayout(sidebar)
        nav.setContentsMargins(18, 30, 18, 20)
        brand = QLabel('↓  UltraDownload')
        brand.setObjectName('brand')
        nav.addWidget(brand)
        subtitle = QLabel('BUILT FOR THE BIG FILES')
        subtitle.setStyleSheet('font-size: 9px; color: #8993aa; letter-spacing: 1px;')
        nav.addWidget(subtitle)
        nav.addSpacing(38)
        self.nav_buttons = []
        for text in ['All downloads', 'Active', 'Queue', 'Completed', 'Failed']:
            button = QPushButton(text)
            button.setObjectName('nav')
            button.setCheckable(True)
            button.setChecked(text == 'All downloads')
            button.clicked.connect(lambda checked=False, name=text: self.set_filter(name))
            self.nav_buttons.append(button)
            nav.addWidget(button)
        nav.addStretch()
        policy = QLabel('1 MiB chunks\nUp to 10 connections / file\nVerified before delivery')
        policy.setObjectName('muted')
        policy.setStyleSheet('color: #8791a6; line-height: 1.5;')
        nav.addWidget(policy)
        nav.addSpacing(22)
        settings_button = QPushButton('⚙  Settings')
        settings_button.clicked.connect(self.settings)
        nav.addWidget(settings_button)
        root.addWidget(sidebar)
        content = QWidget()
        layout = QVBoxLayout(content)
        layout.setContentsMargins(28, 27, 28, 22)
        layout.setSpacing(18)
        heading = QHBoxLayout()
        titles = QVBoxLayout()
        self.title = QLabel('All downloads')
        self.title.setObjectName('title')
        titles.addWidget(self.title)
        self.subtitle = QLabel('Your files. Every byte accounted for.')
        self.subtitle.setObjectName('muted')
        titles.addWidget(self.subtitle)
        heading.addLayout(titles)
        heading.addStretch()
        add = QPushButton('+  Add download')
        add.setObjectName('primary')
        add.clicked.connect(self.add_download)
        heading.addWidget(add)
        layout.addLayout(heading)
        metrics = QHBoxLayout()
        self.metrics = []
        for label in ('TRANSFER SPEED', 'DOWNLOADED', 'ACTIVE', 'COMPLETED', 'FAILED'):
            frame = QFrame()
            frame.setObjectName('panel')
            card = QVBoxLayout(frame)
            card.setContentsMargins(15, 13, 15, 13)
            caption = QLabel(label)
            caption.setStyleSheet('font-size: 10px; color: #8d97ac;')
            value = QLabel('0')
            value.setObjectName('metric')
            card.addWidget(caption)
            card.addWidget(value)
            metrics.addWidget(frame)
            self.metrics.append(value)
        layout.addLayout(metrics)
        toolbar = QHBoxLayout()
        label = QLabel('DOWNLOAD LIBRARY')
        label.setStyleSheet('font-size: 11px; color: #939db1; letter-spacing: 1px;')
        toolbar.addWidget(label)
        toolbar.addStretch()
        for text, callback in [('Pause all', manager.pause_all), ('Resume all', manager.resume_all)]:
            button = QPushButton(text)
            button.clicked.connect(callback)
            toolbar.addWidget(button)
        layout.addLayout(toolbar)
        splitter = QSplitter(Qt.Vertical)
        self.table = QTableView()
        self.model = DownloadTableModel(manager)
        self.table.setModel(self.model)
        self.table.setItemDelegate(ProgressDelegate(self.table))
        self.table.setSelectionBehavior(QAbstractItemView.SelectRows)
        self.table.setSelectionMode(QAbstractItemView.SingleSelection)
        self.table.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.table.setShowGrid(False)
        self.table.verticalHeader().hide()
        self.table.verticalHeader().setDefaultSectionSize(65)
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        for i, width in enumerate([0, 110, 160, 125, 115]):
            if i:
                self.table.setColumnWidth(i, width)
        self.table.selectionModel().selectionChanged.connect(self.selection_changed)
        splitter.addWidget(self.table)
        self.details = QFrame()
        self.details.setObjectName('panel')
        detail = QVBoxLayout(self.details)
        detail.setContentsMargins(19, 15, 19, 15)
        detail.setSpacing(10)
        detail_head = QHBoxLayout()
        self.filename = QLabel('Ready for your next big download')
        self.filename.setObjectName('brand')
        detail_head.addWidget(self.filename)
        detail_head.addStretch()
        self.status = QLabel('NO FILE SELECTED')
        self.status.setStyleSheet('color: #a899ff; font-size: 11px;')
        detail_head.addWidget(self.status)
        detail.addLayout(detail_head)
        self.path = QLabel('Add a direct URL to get started. Downloads and history are saved automatically.')
        self.path.setObjectName('muted')
        self.path.setWordWrap(True)
        self.path.setTextInteractionFlags(Qt.TextSelectableByMouse)
        detail.addWidget(self.path)
        self.progress = QProgressBar()
        self.progress.setRange(0, 1000)
        self.progress.setValue(0)
        self.progress.setTextVisible(False)
        detail.addWidget(self.progress)
        self.stats = QLabel('No simulated transfers. Progress comes directly from received bytes.')
        self.stats.setObjectName('muted')
        self.stats.setWordWrap(True)
        detail.addWidget(self.stats)
        self.error = QLabel('')
        self.error.setWordWrap(True)
        self.error.setTextInteractionFlags(Qt.TextSelectableByMouse)
        self.error.setStyleSheet('color: #ff929f;')
        detail.addWidget(self.error)
        actions = QHBoxLayout()
        self.actions = {}
        for text, callback in [('Pause', self.pause), ('Resume', self.resume), ('Retry', self.resume),
                               ('Cancel', self.cancel), ('Open folder', self.open_folder)]:
            button = QPushButton(text)
            button.clicked.connect(callback)
            button.setEnabled(False)
            actions.addWidget(button)
            self.actions[text] = button
        actions.addStretch()
        self.chunks_toggle = QPushButton('Show chunks ▾')
        self.chunks_toggle.setCheckable(True)
        self.chunks_toggle.toggled.connect(self.toggle_chunks)
        actions.addWidget(self.chunks_toggle)
        detail.addLayout(actions)
        extras = QHBoxLayout()
        for text, callback in [('Move to queue top', self.prioritize), ('File speed limit', self.file_limit), ('Restart from source', self.restart)]:
            button = QPushButton(text)
            button.clicked.connect(callback)
            button.setEnabled(False)
            extras.addWidget(button)
            self.actions[text] = button
        extras.addStretch()
        detail.addLayout(extras)
        self.chunks = QTableView()
        self.chunk_model = ChunkTableModel(manager)
        self.chunks.setModel(self.chunk_model)
        self.chunks.setEditTriggers(QAbstractItemView.NoEditTriggers)
        self.chunks.setShowGrid(False)
        self.chunks.verticalHeader().hide()
        self.chunks.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        for i in (0, 2, 3, 4, 5, 6):
            self.chunks.setColumnWidth(i, 87)
        self.chunks.setMinimumHeight(160)
        self.chunks.hide()
        detail.addWidget(self.chunks)
        splitter.addWidget(self.details)
        splitter.setStretchFactor(0, 3)
        splitter.setStretchFactor(1, 2)
        layout.addWidget(splitter, 1)
        self.footer = QLabel('LOCAL STATE SAVED  •  TLS verification enabled  •  Files are never launched automatically')
        self.footer.setStyleSheet('font-size: 10px; color: #748098;')
        layout.addWidget(self.footer)
        root.addWidget(content, 1)
        manager.signals.changed.connect(self.mark_dirty)
        manager.signals.error.connect(lambda text: QMessageBox.warning(self, 'Download error', text))
        self.refresh_timer = QTimer(self)
        self.refresh_timer.timeout.connect(self.refresh)
        self.refresh_timer.start(250)
        self.seed_saved_progress()
        self.refresh()
        if any(d.status == 'interrupted' for d in manager.db.downloads()):
            self.subtitle.setText('Interrupted downloads found. Select Resume to validate and recover your saved data.')

    def seed_saved_progress(self):
        for d in self.manager.db.downloads():
            rows = self.manager.db.chunks(d.id)
            size = d.size if d.status == 'completed' else sum(r['bytes'] for r in rows)
            self.manager.snapshots[d.id] = dict(downloaded=size, speed=0, active=0,
                completed=sum(r['status'] == 'complete' for r in rows), failed=sum(r['status'] == 'failed' for r in rows),
                percent=100 if d.status == 'completed' else (100*min(size, d.size)/d.size if d.size else 0))

    def mark_dirty(self):
        self.dirty = True

    def refresh(self):
        if self.closing and self.manager.idle():
            self.manager.dispose()
            self.close()
            return
        if not self.dirty:
            return
        self.dirty = False
        self.model.refresh()
        all_downloads = self.manager.db.downloads()
        speed = sum(s.get('speed', 0) for id, s in self.manager.snapshots.items() if id in self.manager.running)
        downloaded = sum(s.get('downloaded', 0) or 0 for s in self.manager.snapshots.values())
        values = [human_bytes(speed)+'/s', human_bytes(downloaded), str(len(self.manager.running)),
                  str(sum(d.status == 'completed' for d in all_downloads)), str(sum(d.status == 'failed' for d in all_downloads))]
        for label, value in zip(self.metrics, values):
            label.setText(value)
        if self.selected_id:
            self.refresh_details()
        if self.chunks.isVisible():
            self.chunk_model.refresh()

    def set_filter(self, name):
        self.model.filter = name
        self.title.setText(name)
        for button in self.nav_buttons:
            button.setChecked(button.text() == name)
        self.dirty = True
        self.refresh()

    def selection_changed(self):
        rows = self.table.selectionModel().selectedRows()
        if rows:
            self.selected_id = self.model.rows[rows[0].row()].id
            self.chunk_model.select(self.manager.db.get(self.selected_id))
            self.refresh_details()

    def refresh_details(self):
        d = self.manager.db.get(self.selected_id)
        s = self.manager.snapshots.get(d.id, {})
        self.filename.setText(d.filename)
        self.status.setText(d.status.upper())
        self.path.setText(d.destination)
        self.progress.setValue(int(min(100, s.get('percent', 0))*10))
        complete, failed = s.get('completed', 0), s.get('failed', 0)
        pending = s.get('pending', max(0, d.count-complete-failed))
        self.stats.setText(f"{human_bytes(s.get('downloaded', 0))} / {human_bytes(d.size)}   ·   {s.get('percent', 0):.1f}%   ·   "
                           f"{human_bytes(s.get('speed', 0))}/s   ·   ETA {eta_text(s.get('eta'))}\n"
                           f"Connections {s.get('active', 0)}/{self.manager.settings.connections if d.ranges else 1}   ·   "
                           f"Chunks {complete:,}/{d.count:,} complete   ·   {pending:,} pending   ·   {failed:,} failed")
        self.error.setText(d.error or (f'SHA-256: {d.sha256}\n'+('Matches supplied reference (trust depends on its source).' if d.expected_sha256 else 'Computed identifier only; no trusted checksum supplied.') if d.sha256 else ''))
        self.error.setStyleSheet('color: #ff929f;' if d.error else 'color: #6cd5b0;')
        active = d.id in self.manager.running
        for name, button in self.actions.items():
            enabled = True
            if name == 'Pause':
                enabled = active or d.status == 'queued'
            elif name in ('Resume', 'Retry', 'Restart from source', 'File speed limit'):
                enabled = not active and d.status not in ('completed', 'queued')
            elif name == 'Cancel':
                enabled = d.status not in ('completed', 'cancelled')
            elif name == 'Move to queue top':
                enabled = d.status == 'queued'
            button.setEnabled(enabled)
        if self.chunk_model.download and self.chunk_model.download.size != d.size:
            self.chunk_model.select(d)

    def toggle_chunks(self, checked):
        self.chunks.setVisible(checked)
        self.chunks_toggle.setText('Hide chunks ▴' if checked else 'Show chunks ▾')

    def add_download(self):
        AddDownloadDialog(self.manager, self).exec()

    def pause(self):
        if self.selected_id:
            self.manager.pause(self.selected_id)
            self.status.setText('STOPPING SAFELY…')

    def resume(self):
        if self.selected_id:
            self.manager.resume(self.selected_id)

    def cancel(self):
        if not self.selected_id:
            return
        box = QMessageBox(self)
        box.setWindowTitle('Cancel download')
        box.setText('Keep temporary data for a later resume?')
        keep = box.addButton('Keep data', QMessageBox.AcceptRole)
        delete = box.addButton('Delete temporary data', QMessageBox.DestructiveRole)
        box.addButton(QMessageBox.Abort)
        box.exec()
        if box.clickedButton() in (keep, delete):
            try:
                self.manager.cancel(self.selected_id, box.clickedButton() == delete)
            except Exception as error:
                QMessageBox.warning(self, 'Cancel failed', str(error))

    def open_folder(self):
        if self.selected_id:
            folder = str(Path(self.manager.db.get(self.selected_id).destination).parent)
            QDesktopServices.openUrl(QUrl.fromLocalFile(folder))

    def prioritize(self):
        if self.selected_id:
            self.manager.prioritize(self.selected_id)

    def file_limit(self):
        if not self.selected_id:
            return
        d = self.manager.db.get(self.selected_id)
        value, ok = QInputDialog.getInt(self, 'File speed limit', 'KiB/s (0 = default limit); applies on resume', d.bandwidth//1024, 0, 1000000)
        if ok:
            d.bandwidth = value*1024
            self.manager.db.save(d)

    def restart(self):
        if self.selected_id:
            d = self.manager.db.get(self.selected_id)
            try:
                AddDownloadDialog(self.manager, self, restart=d).exec()
            except Exception:
                QMessageBox.warning(self, 'Restart unavailable', 'Could not read the source URL from the OS credential store.')

    def settings(self):
        if self.manager.running:
            QMessageBox.information(self, 'Pause first', 'Pause all active downloads and wait for them to stop before changing settings.')
            return
        dialog = SettingsDialog(self.manager.settings, self)
        if dialog.exec():
            try:
                dialog.result_settings.save(self.settings_path)
                self.manager.configure(dialog.result_settings)
                apply_theme(QApplication.instance(), dialog.result_settings.theme)
            except Exception as error:
                QMessageBox.warning(self, 'Settings not saved', str(error))

    def closeEvent(self, event):
        if self.manager.idle():
            self.manager.dispose()
            event.accept()
            return
        if not self.closing:
            result = QMessageBox.question(self, 'Exit UltraDownload?', 'Pause active transfers and exit? Valid chunks will be preserved.')
            if result != QMessageBox.Yes:
                event.ignore()
                return
            self.closing = True
            self.manager.shutdown()
            self.centralWidget().setEnabled(False)
            self.footer.setText('Stopping requests safely… Waiting requests are bounded by the configured network timeouts.')
        event.ignore()
