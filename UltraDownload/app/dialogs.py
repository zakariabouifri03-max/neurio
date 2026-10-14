import threading
from dataclasses import replace

from PySide6.QtCore import QThreadPool, Qt
from PySide6.QtWidgets import (
    QCheckBox,
    QComboBox,
    QDialog,
    QDialogButtonBox,
    QDoubleSpinBox,
    QFileDialog,
    QFormLayout,
    QHBoxLayout,
    QLabel,
    QLineEdit,
    QPushButton,
    QScrollArea,
    QSpinBox,
    QVBoxLayout,
    QWidget,
)

from .file_utils import persistable_url, safe_filename, validate_url
from .http_client import inspect_url
from .integrity import validate_checksum
from .signals import Task
from .ui_models import human_bytes


def label(text, name=None):
    widget = QLabel(text)
    widget.setTextFormat(Qt.PlainText)
    if name:
        widget.setObjectName(name)
    return widget


def browse_row(edit, parent):
    row = QWidget()
    layout = QHBoxLayout(row)
    layout.setContentsMargins(0, 0, 0, 0)
    layout.addWidget(edit)
    button = QPushButton("Browse…")

    def choose():
        path = QFileDialog.getExistingDirectory(
            parent, "Download directory", edit.text()
        )
        if path:
            edit.setText(path)

    button.clicked.connect(choose)
    layout.addWidget(button)
    return row


class AddDialog(QDialog):
    def __init__(self, manager, parent=None):
        super().__init__(parent)
        self.manager = manager
        self.info = None
        self.tasks = []
        self.setWindowTitle("Add download • UltraDownload")
        self.setMinimumWidth(630)
        layout = QVBoxLayout(self)
        layout.setContentsMargins(28, 28, 28, 28)
        layout.setSpacing(16)
        layout.addWidget(label("A NEW TRANSFER", "eyebrow"))
        layout.addWidget(label("Give your next download a home.", "brand"))
        subtitle = label(
            "Paste a direct file URL. We’ll check its size and byte-range support first.",
            "muted",
        )
        subtitle.setWordWrap(True)
        layout.addWidget(subtitle)
        form = QFormLayout()
        form.setSpacing(14)
        self.url = QLineEdit()
        self.url.setPlaceholderText("https://example.com/large-file.zip")
        self.url.textChanged.connect(self.invalidate)
        form.addRow("Direct URL", self.url)
        self.inspect = QPushButton("Inspect link")
        self.inspect.clicked.connect(self.inspect_link)
        form.addRow("", self.inspect)
        self.preview = label("File information will appear here.", "muted")
        self.preview.setWordWrap(True)
        form.addRow("File information", self.preview)
        self.filename = QLineEdit()
        self.filename.setPlaceholderText("Discovered filename")
        form.addRow("Save as", self.filename)
        self.directory = QLineEdit(manager.settings.directory)
        form.addRow("Destination", browse_row(self.directory, self))
        self.checksum = QLineEdit()
        self.checksum.setPlaceholderText(
            "Optional • 64-character SHA-256 from a trusted source"
        )
        form.addRow("Expected SHA-256", self.checksum)
        layout.addLayout(form)
        self.fallback = QCheckBox(
            "Use single-stream mode (pause/retry restarts this file)"
        )
        self.fallback.setVisible(False)
        self.fallback.toggled.connect(self.enable_start)
        layout.addWidget(self.fallback)
        self.warning = label("", "muted")
        self.warning.setWordWrap(True)
        layout.addWidget(self.warning)
        self.error = label("")
        self.error.setStyleSheet("color: #ef989d;")
        self.error.setWordWrap(True)
        layout.addWidget(self.error)
        buttons = QHBoxLayout()
        buttons.addStretch()
        self.cancel_button = QPushButton("Cancel")
        self.cancel_button.clicked.connect(self.reject)
        buttons.addWidget(self.cancel_button)
        self.start = QPushButton("Start download")
        self.start.setObjectName("primary")
        self.start.setEnabled(False)
        self.start.clicked.connect(self.start_download)
        buttons.addWidget(self.start)
        layout.addLayout(buttons)
        self.url.setFocus()

    def invalidate(self):
        self.info = None
        self.start.setEnabled(False)
        self.preview.setText("Inspect this URL before starting.")
        self.fallback.hide()

    def enable_start(self):
        self.start.setEnabled(
            self.info is not None and (self.info.ranges or self.fallback.isChecked())
        )

    def task(self, function, success):
        job = Task(function)
        self.tasks.append(job)
        job.signals.success.connect(success)
        job.signals.failure.connect(self.failed)
        QThreadPool.globalInstance().start(job)

    def inspect_link(self):
        try:
            url = validate_url(self.url.text())
        except ValueError as exc:
            self.failed(str(exc))
            return
        self.error.clear()
        self.inspect.setEnabled(False)
        self.url.setEnabled(False)
        self.preview.setText("Inspecting headers and checking a one-byte range…")

        def work():
            with self.manager.budget.acquire(threading.Event()):
                return inspect_url(url, self.manager.settings)

        self.task(work, self.inspected)

    def inspected(self, info):
        self.url.setEnabled(True)
        self.inspect.setEnabled(True)
        self.info = info
        self.filename.setText(info.filename)
        mode = (
            "Parallel ready · 1 MiB chunks · up to 10 connections"
            if info.ranges
            else info.reason
        )
        self.preview.setText(f"{info.filename}\n{human_bytes(info.size)}  •  {mode}")
        self.fallback.setChecked(False)
        self.fallback.setVisible(not info.ranges)
        warnings = [
            "Chunk storage and final assembly may require up to twice the file size in free disk space."
        ]
        if not persistable_url(info.url):
            warnings.append(
                "This query URL is kept only in memory. You must re-enter it after restarting the app."
            )
        if not ((info.etag and not info.etag.startswith("W/")) or info.modified):
            warnings.append(
                "No stable server validator: resuming will restart saved chunks to avoid mixing versions."
            )
        if info.url.startswith("http:"):
            warnings.append(
                "This source uses unencrypted HTTP. Prefer an HTTPS URL if the source supports it."
            )
        self.warning.setText("\n".join(warnings))
        self.enable_start()

    def failed(self, message):
        self.error.setText(message)
        self.inspect.setEnabled(True)
        self.url.setEnabled(True)
        self.cancel_button.setEnabled(True)
        self.enable_start()

    def start_download(self):
        if not self.info:
            return
        try:
            checksum = validate_checksum(self.checksum.text())
            filename = safe_filename(self.filename.text())
            if filename != self.filename.text():
                self.filename.setText(filename)
                raise ValueError(
                    "Filename was made Windows-safe. Check it and press Start again."
                )
            if not self.directory.text().strip():
                raise ValueError("Choose a destination directory")
        except ValueError as exc:
            self.failed(str(exc))
            return
        self.start.setEnabled(False)
        self.cancel_button.setEnabled(False)
        info, directory, allow = (
            self.info,
            self.directory.text(),
            self.fallback.isChecked(),
        )
        self.task(
            lambda: self.manager.add(info, directory, filename, checksum, allow),
            lambda _: self.accept(),
        )


class SettingsDialog(QDialog):
    def __init__(self, settings, parent=None):
        super().__init__(parent)
        self.original = settings
        self.setWindowTitle("Settings • UltraDownload")
        self.resize(650, 720)
        outer = QVBoxLayout(self)
        outer.setContentsMargins(24, 24, 24, 24)
        outer.addWidget(label("Make it work your way.", "brand"))
        outer.addWidget(
            label("Pause active downloads before applying changes.", "muted")
        )
        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        content = QWidget()
        form = QFormLayout(content)
        form.setSpacing(13)
        self.directory = QLineEdit(settings.directory)
        form.addRow("Default directory", browse_row(self.directory, self))
        form.addRow("Chunk size", label("1 MiB (1,048,576 bytes) · fixed", "muted"))
        self.fields = {}
        for key, text, minimum, maximum, real in [
            ("connections", "Connections per file", 1, 10, False),
            ("simultaneous_files", "Simultaneous files", 1, 16, False),
            ("global_connections", "Global connection limit", 1, 160, False),
            ("connect_timeout", "Connect timeout (seconds)", 1, 300, True),
            ("read_timeout", "Read timeout (seconds)", 1, 600, True),
            ("retries", "Maximum retries per chunk", 0, 20, False),
            ("retry_delay", "Initial retry delay (seconds)", 0, 60, True),
            (
                "global_bandwidth",
                "Global limit (KiB/s; 0 = unlimited)",
                0,
                100000000,
                False,
            ),
            (
                "file_bandwidth",
                "New file limit (KiB/s; 0 = unlimited)",
                0,
                100000000,
                False,
            ),
        ]:
            field = QDoubleSpinBox() if real else QSpinBox()
            field.setRange(minimum, maximum)
            value = getattr(settings, key)
            field.setValue(int(value / 1024) if "bandwidth" in key else value)
            form.addRow(text, field)
            self.fields[key] = field
        self.cleanup = QCheckBox("Remove chunk files after successful completion")
        self.cleanup.setChecked(settings.cleanup_completed)
        form.addRow("Temporary storage", self.cleanup)
        self.theme = QComboBox()
        self.theme.addItems(["Midnight", "Ocean"])
        self.theme.setCurrentText(settings.theme)
        form.addRow("Accent theme", self.theme)
        note = label(
            "Limits apply to real streamed bytes. Ten connections are not guaranteed to be faster than one. Cancellation always asks before deleting temporary data.",
            "muted",
        )
        note.setWordWrap(True)
        form.addRow(note)
        scroll.setWidget(content)
        outer.addWidget(scroll)
        self.error = label("")
        self.error.setWordWrap(True)
        self.error.setStyleSheet("color: #ef989d;")
        outer.addWidget(self.error)
        buttons = QDialogButtonBox(QDialogButtonBox.Save | QDialogButtonBox.Cancel)
        buttons.accepted.connect(self.accept)
        buttons.rejected.connect(self.reject)
        outer.addWidget(buttons)

    def values(self):
        fields = {
            key: widget.value() * (1024 if "bandwidth" in key else 1)
            for key, widget in self.fields.items()
        }
        return replace(
            self.original,
            **fields,
            directory=self.directory.text(),
            cleanup_completed=self.cleanup.isChecked(),
            theme=self.theme.currentText(),
        ).validate()
