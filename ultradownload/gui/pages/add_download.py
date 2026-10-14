"""Add Download page: URL form, inspection, validation, start."""

from __future__ import annotations

from pathlib import Path

from PySide6.QtCore import QObject, QRunnable, QThreadPool, Qt, Signal
from PySide6.QtWidgets import (QComboBox, QFileDialog, QFormLayout, QFrame,
                               QHBoxLayout, QLabel, QLineEdit, QPlainTextEdit,
                               QPushButton, QSpinBox, QVBoxLayout, QWidget)

from ...config import PART_CHOICES
from ...engine.errors import DownloadError, InvalidURLError
from ...engine.inspector import inspect_url, validate_url
from ...utils import format_bytes, sanitize_filename


class _InspectSignals(QObject):
    finished = Signal(object)   # URLInfo
    failed = Signal(str)


class _InspectJob(QRunnable):
    def __init__(self, url: str, timeout: tuple[float, float],
                 extra_headers: dict | None) -> None:
        super().__init__()
        self.signals = _InspectSignals()
        self.url = url
        self.timeout = timeout
        self.extra_headers = extra_headers
        self.setAutoDelete(True)

    def run(self) -> None:
        try:
            info = inspect_url(self.url, timeout=self.timeout,
                               extra_headers=self.extra_headers)
            self.signals.finished.emit(info)
        except Exception as exc:
            self.signals.failed.emit(str(exc))


class AddDownloadPage(QWidget):
    download_added = Signal(str)   # task_id

    def __init__(self, manager, parent=None) -> None:
        super().__init__(parent)
        self.manager = manager
        self._info = None
        self._pool = QThreadPool.globalInstance()

        root = QVBoxLayout(self)
        root.setContentsMargins(28, 24, 28, 24)
        root.setSpacing(16)

        title = QLabel("Add Download")
        title.setObjectName("pageTitle")
        root.addWidget(title)

        form_card = QFrame()
        form_card.setObjectName("panel")
        form = QFormLayout(form_card)
        form.setContentsMargins(22, 20, 22, 20)
        form.setSpacing(14)
        form.setHorizontalSpacing(18)

        self.url_edit = QLineEdit()
        self.url_edit.setPlaceholderText("https://example.com/games/huge-game.iso")
        self.url_edit.returnPressed.connect(self._on_inspect)
        form.addRow("Download URL", self.url_edit)

        dest_row = QHBoxLayout()
        self.dest_edit = QLineEdit(self.manager.settings.default_dir)
        browse = QPushButton("Browse…")
        browse.setObjectName("secondary")
        browse.clicked.connect(self._browse)
        dest_row.addWidget(self.dest_edit, 1)
        dest_row.addWidget(browse)
        form.addRow("Save to", dest_row)

        self.name_edit = QLineEdit()
        self.name_edit.setPlaceholderText("Optional — taken from the server if empty")
        form.addRow("Filename", self.name_edit)

        parts_row = QHBoxLayout()
        self.parts_combo = QComboBox()
        for n in PART_CHOICES:
            self.parts_combo.addItem(f"{n} parts", n)
        default_idx = PART_CHOICES.index(self.manager.settings.default_parts) \
            if self.manager.settings.default_parts in PART_CHOICES else \
            PART_CHOICES.index(40)
        self.parts_combo.setCurrentIndex(default_idx)
        self.parts_hint = QLabel("40 parallel connections for large files")
        self.parts_hint.setObjectName("faint")
        parts_row.addWidget(self.parts_combo)
        parts_row.addWidget(self.parts_hint)
        parts_row.addStretch()
        form.addRow("Parallel parts", parts_row)

        self.checksum_algo = QComboBox()
        self.checksum_algo.addItem("No checksum verification", None)
        for algo in ("sha256", "sha512", "sha1", "md5"):
            self.checksum_algo.addItem(algo, algo)
        self.checksum_edit = QLineEdit()
        self.checksum_edit.setPlaceholderText("Optional hex digest")
        cs_row = QHBoxLayout()
        cs_row.addWidget(self.checksum_algo)
        cs_row.addWidget(self.checksum_edit, 1)
        form.addRow("Checksum", cs_row)

        self.limit_spin = QSpinBox()
        self.limit_spin.setRange(0, 100_000)
        self.limit_spin.setSuffix(" MB/s")
        self.limit_spin.setSpecialValueText("Unlimited")
        self.limit_spin.setValue(0)
        form.addRow("Speed limit", self.limit_spin)

        self.headers_edit = QPlainTextEdit()
        self.headers_edit.setPlaceholderText(
            "Optional extra headers or cookies, one per line:\n"
            "Authorization: Bearer …\nCookie: session=…\n"
            "(kept in memory only — never saved to disk)")
        self.headers_edit.setFixedHeight(74)
        form.addRow("Headers", self.headers_edit)

        root.addWidget(form_card)

        # ---- inspect result / errors -------------------------------------
        self.result_card = QFrame()
        self.result_card.setObjectName("card")
        self.result_l = QLabel("Paste a URL and click “Check URL” to inspect it.")
        self.result_l.setObjectName("dim")
        self.result_l.setWordWrap(True)
        rl = QVBoxLayout(self.result_card)
        rl.setContentsMargins(18, 14, 18, 14)
        rl.addWidget(self.result_l)
        root.addWidget(self.result_card)

        self.error_l = QLabel("")
        self.error_l.setObjectName("error")
        self.error_l.setWordWrap(True)
        root.addWidget(self.error_l)

        actions = QHBoxLayout()
        self.inspect_btn = QPushButton("Check URL")
        self.inspect_btn.setObjectName("secondary")
        self.inspect_btn.clicked.connect(self._on_inspect)
        self.start_btn = QPushButton("Start Download")
        self.start_btn.setObjectName("primary")
        self.start_btn.clicked.connect(self._on_start)
        actions.addStretch()
        actions.addWidget(self.inspect_btn)
        actions.addWidget(self.start_btn)
        root.addLayout(actions)
        root.addStretch()

    # ----------------------------------------------------------------- slots
    def _browse(self) -> None:
        d = QFileDialog.getExistingDirectory(self, "Choose destination folder",
                                             self.dest_edit.text())
        if d:
            self.dest_edit.setText(d)

    def _parse_headers(self) -> dict | None:
        raw = self.headers_edit.toPlainText().strip()
        if not raw:
            return None
        headers = {}
        for line in raw.splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if ":" not in line:
                raise ValueError(f"Invalid header line (expected 'Name: value'): {line}")
            k, v = line.split(":", 1)
            headers[k.strip()] = v.strip()
        return headers or None

    def _on_inspect(self) -> None:
        self.error_l.setText("")
        try:
            url = validate_url(self.url_edit.text())
            headers = self._parse_headers()
        except (InvalidURLError, ValueError) as exc:
            self.error_l.setText(str(exc))
            return
        self.inspect_btn.setEnabled(False)
        self.inspect_btn.setText("Checking…")
        job = _InspectJob(url,
                          (self.manager.settings.connect_timeout,
                           self.manager.settings.read_timeout),
                          headers)
        job.signals.finished.connect(self._on_inspect_ok)
        job.signals.failed.connect(self._on_inspect_fail)
        self._pool.start(job)

    def _on_inspect_ok(self, info) -> None:
        self._info = info
        self.inspect_btn.setEnabled(True)
        self.inspect_btn.setText("Check URL")
        lines = [
            f"<b>{info.filename}</b>",
            f"Size: {format_bytes(info.size) if info.size else 'unknown'}",
            f"Type: {info.mime_type or 'unknown'}",
            f"Byte-range (parallel) support: "
            f"{'yes' if info.supports_ranges else 'no — single stream'}",
        ]
        if info.server:
            lines.append(f"Server: {info.server}")
        for note in info.notes:
            lines.append(f"⚠ {note}")
        if not self.name_edit.text().strip():
            self.name_edit.setPlaceholderText(info.filename)
        self.result_l.setText("<br>".join(lines))
        self.result_l.setTextFormat(Qt.RichText)

    def _on_inspect_fail(self, message: str) -> None:
        self.inspect_btn.setEnabled(True)
        self.inspect_btn.setText("Check URL")
        self.error_l.setText(message)

    def _on_start(self) -> None:
        self.error_l.setText("")
        try:
            url = validate_url(self.url_edit.text())
            headers = self._parse_headers()
        except (InvalidURLError, ValueError) as exc:
            self.error_l.setText(str(exc))
            return

        dest = self.dest_edit.text().strip() or self.manager.settings.default_dir
        dest_path = Path(dest)
        try:
            dest_path.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            self.error_l.setText(f"Cannot use destination folder: {exc}")
            return

        filename = self.name_edit.text().strip() or None
        if filename:
            filename = sanitize_filename(filename)

        checksum = None
        algo = self.checksum_algo.currentData()
        if algo:
            value = self.checksum_edit.text().strip()
            if not value:
                self.error_l.setText("Enter the checksum hex digest, "
                                     "or choose “No checksum verification”.")
                return
            checksum = (algo, value)

        limit = self.limit_spin.value()
        speed_limit = float(limit) * 1024 * 1024 if limit else None

        overwrite = False
        final = dest_path / (filename or (self._info.filename if self._info else "download.bin"))
        if final.exists():
            from PySide6.QtWidgets import QMessageBox
            ret = QMessageBox.question(
                self, "File exists",
                f"'{final.name}' already exists.\n\nOverwrite it?",
                QMessageBox.Yes | QMessageBox.No, QMessageBox.No)
            if ret != QMessageBox.Yes:
                self.error_l.setText(
                    "A file with this name already exists — rename the "
                    "download or allow overwriting.")
                return
            overwrite = True

        try:
            task = self.manager.add_download(
                url, dest_path, filename=filename,
                part_count=self.parts_combo.currentData(),
                checksum=checksum,
                speed_limit=speed_limit,
                extra_headers=headers,
                overwrite=overwrite,
                auto_start=True,
            )
        except DownloadError as exc:
            self.error_l.setText(str(exc))
            return
        self.result_l.setText(
            f"Download started: <b>{task.filename or url}</b> "
            f"with {task.cfg.part_count} parts.")
        self.result_l.setTextFormat(Qt.RichText)
        self.download_added.emit(task.id)
