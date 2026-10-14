from dataclasses import replace
from pathlib import Path
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QDialog, QVBoxLayout, QHBoxLayout, QFormLayout, QLabel, QLineEdit,
                              QPushButton, QFileDialog, QDialogButtonBox, QCheckBox, QSpinBox,
                              QDoubleSpinBox, QComboBox, QMessageBox)
from .http_client import validate_url
from .integrity import validate_checksum
from .file_utils import safe_filename
from .ui_models import human_bytes


class AddDownloadDialog(QDialog):
    def __init__(self, manager, parent=None, restart=None):
        super().__init__(parent)
        self.manager, self.remote, self.restart = manager, None, restart
        self.inspected_url = ''
        self.setWindowTitle('Restart download' if restart else 'Add a download')
        self.setMinimumWidth(600)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(28, 25, 28, 25)
        layout.setSpacing(17)
        title = QLabel('A direct link. A reliable download.')
        title.setObjectName('brand')
        layout.addWidget(title)
        hint = QLabel('Inspect the source before adding it to your queue. HTTP and HTTPS supported.')
        hint.setObjectName('muted')
        hint.setWordWrap(True)
        layout.addWidget(hint)
        form = QFormLayout()
        form.setSpacing(12)
        self.url = QLineEdit()
        self.url.setPlaceholderText('https://example.com/large-file.zip')
        form.addRow('Direct URL', self.url)
        self.inspect_button = QPushButton('Inspect source')
        self.inspect_button.clicked.connect(self.inspect)
        form.addRow('', self.inspect_button)
        self.info = QLabel('File size and connection mode will appear here.')
        self.info.setWordWrap(True)
        self.info.setObjectName('muted')
        form.addRow('Source information', self.info)
        self.folder = QLineEdit(manager.settings.directory)
        browse = QPushButton('Browse…')
        browse.clicked.connect(self.browse)
        folder_row = QHBoxLayout()
        folder_row.addWidget(self.folder)
        folder_row.addWidget(browse)
        form.addRow('Save to', folder_row)
        self.filename = QLineEdit()
        form.addRow('Filename', self.filename)
        self.checksum = QLineEdit()
        self.checksum.setPlaceholderText('Optional: SHA-256 from a source you trust')
        form.addRow('Expected SHA-256', self.checksum)
        self.bandwidth = QSpinBox()
        self.bandwidth.setRange(0, 1000000)
        self.bandwidth.setSuffix(' KiB/s')
        self.bandwidth.setSpecialValueText('Use default limit')
        form.addRow('File bandwidth', self.bandwidth)
        self.fallback = QCheckBox('Use single-stream fallback (incomplete transfers restart)')
        self.fallback.hide()
        form.addRow('', self.fallback)
        layout.addLayout(form)
        self.warning = QLabel('Parallel mode requires up to 2× the file size while assembling.\nA computed hash identifies a file; only a trusted reference verifies it.')
        self.warning.setWordWrap(True)
        self.warning.setObjectName('muted')
        layout.addWidget(self.warning)
        self.error = QLabel('')
        self.error.setStyleSheet('color: #ff929f')
        self.error.setWordWrap(True)
        layout.addWidget(self.error)
        buttons = QDialogButtonBox(QDialogButtonBox.Cancel)
        self.start = buttons.addButton('Restart download' if restart else 'Start download', QDialogButtonBox.AcceptRole)
        self.start.setObjectName('primary')
        self.start.setEnabled(False)
        buttons.rejected.connect(self.reject)
        self.start.clicked.connect(self.submit)
        layout.addWidget(buttons)
        self.url.textChanged.connect(self.invalidate)
        manager.signals.inspected.connect(self.inspected)
        self.finished.connect(self.disconnect_signals)
        if restart:
            self.url.setText(manager.db.urls(restart.id)[0])
            self.folder.setText(str(Path(restart.destination).parent))
            self.filename.setText(restart.filename)
            self.folder.setEnabled(False)
            self.filename.setEnabled(False)
            browse.setEnabled(False)
            self.url.setReadOnly(True)
            self.warning.setText('Restart deletes only this download’s temporary chunks.\nRe-enter a trusted checksum for the current version, if available.')

    def disconnect_signals(self):
        self.manager.signals.inspected.disconnect(self.inspected)

    def invalidate(self):
        self.remote = None
        self.start.setEnabled(False)

    def browse(self):
        value = QFileDialog.getExistingDirectory(self, 'Download folder', self.folder.text())
        if value:
            self.folder.setText(value)

    def inspect(self):
        try:
            url = validate_url(self.url.text().strip())
            self.manager.inspect(url)
            self.inspected_url = url
            self.inspect_button.setEnabled(False)
            self.url.setReadOnly(True)
            self.info.setText('Contacting source…')
            self.error.clear()
        except Exception as error:
            self.error.setText(str(error))

    def inspected(self, remote, error):
        self.inspect_button.setEnabled(True)
        self.url.setReadOnly(bool(self.restart))
        if error:
            self.error.setText(error)
            self.info.setText('Source inspection failed.')
            return
        self.remote = remote
        if not self.restart:
            self.filename.setText(remote.filename)
        mode = 'Parallel ranges • 1 MiB chunks • up to 10 connections' if remote.ranges else 'Single stream only'
        validator = '' if remote.validator else '\nNo remote validator: saved bytes will be restarted on resume for safety.'
        self.info.setText(f'{remote.filename}\n{human_bytes(remote.size)}  •  {mode}{validator}')
        self.fallback.setVisible(not remote.ranges)
        self.fallback.setChecked(False)
        self.start.setEnabled(True)

    def submit(self):
        try:
            if not self.remote or self.url.text().strip() != self.inspected_url:
                raise ValueError('Inspect this URL first')
            if not self.remote.ranges and not self.fallback.isChecked():
                raise ValueError('Please confirm single-stream mode; this server does not support parallel ranges')
            filename = self.filename.text().strip()
            if not filename or safe_filename(filename) != filename:
                raise ValueError('Choose a valid filename without path separators or reserved Windows characters')
            checksum = validate_checksum(self.checksum.text())
            if self.restart:
                self.manager.restart(self.restart.id, self.remote, checksum)
            else:
                self.manager.add(self.inspected_url, self.remote, self.folder.text(), filename,
                                 checksum, self.bandwidth.value()*1024)
            self.accept()
        except Exception as error:
            self.error.setText(str(error))


class SettingsDialog(QDialog):
    def __init__(self, settings, parent=None):
        super().__init__(parent)
        self.original, self.result_settings = settings, None
        self.setWindowTitle('UltraDownload settings')
        self.setMinimumWidth(540)
        layout = QVBoxLayout(self)
        title = QLabel('Make it yours')
        title.setObjectName('title')
        layout.addWidget(title)
        form = QFormLayout()
        self.directory = QLineEdit(settings.directory)
        row = QHBoxLayout()
        row.addWidget(self.directory)
        browse = QPushButton('Browse…')
        browse.clicked.connect(self.browse)
        row.addWidget(browse)
        form.addRow('Default download folder', row)
        form.addRow('Chunk size', QLabel('1 MiB (1,048,576 bytes) · fixed'))
        self.controls = {}
        for name, label, low, high, decimal in [
            ('connections', 'Connections per file', 1, 10, False),
            ('simultaneous_files', 'Simultaneous files', 1, 10, False),
            ('global_connections', 'Global connection limit', 1, 100, False),
            ('connect_timeout', 'Connection timeout (seconds)', 1, 300, True),
            ('read_timeout', 'Read timeout (seconds)', 1, 600, True),
            ('retries', 'Maximum automatic retries', 0, 20, False),
            ('retry_delay', 'Base retry delay (seconds)', 0, 300, True),
            ('global_bandwidth', 'Overall bandwidth (KiB/s)', 0, 1000000, False),
            ('per_download_bandwidth', 'Default file bandwidth (KiB/s)', 0, 1000000, False)]:
            control = QDoubleSpinBox() if decimal else QSpinBox()
            control.setRange(low, high)
            value = getattr(settings, name)
            if 'bandwidth' in name:
                value //= 1024
                control.setSpecialValueText('Unlimited')
            control.setValue(value)
            self.controls[name] = control
            form.addRow(label, control)
        self.cleanup = QCheckBox('Delete temporary chunks after successful verification')
        self.cleanup.setChecked(settings.cleanup_completed)
        form.addRow('', self.cleanup)
        self.theme = QComboBox()
        self.theme.addItems(['Midnight', 'Ocean'])
        self.theme.setCurrentText(settings.theme)
        form.addRow('Accent theme', self.theme)
        layout.addLayout(form)
        note = QLabel('Changes apply to the next transfer. Pause active files first.\nCancel always asks whether to retain temporary data.')
        note.setObjectName('muted')
        layout.addWidget(note)
        buttons = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.save)
        buttons.rejected.connect(self.reject)
        layout.addWidget(buttons)

    def browse(self):
        path = QFileDialog.getExistingDirectory(self, 'Default download folder', self.directory.text())
        if path:
            self.directory.setText(path)

    def save(self):
        values = {key: control.value()*(1024 if 'bandwidth' in key else 1) for key, control in self.controls.items()}
        self.result_settings = replace(self.original, **values, directory=self.directory.text(),
                                       cleanup_completed=self.cleanup.isChecked(), theme=self.theme.currentText())
        try:
            self.result_settings.validate()
            self.accept()
        except ValueError as error:
            QMessageBox.warning(self, 'Invalid settings', str(error))
