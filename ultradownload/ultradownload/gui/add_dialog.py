"""Add-Download dialog: URL input, async inspection, destination,
part-count selection, optional checksum / headers / speed limit."""

from __future__ import annotations

import os
import threading
from typing import Dict, Optional

from PySide6.QtCore import Qt, Signal, QObject
from PySide6.QtWidgets import (QCheckBox, QComboBox, QDialog, QFileDialog,
                               QFormLayout, QFrame, QHBoxLayout, QLabel,
                               QLineEdit, QMessageBox, QPlainTextEdit,
                               QPushButton, QSpinBox, QVBoxLayout, QWidget)

from ..inspector import UrlValidationError, probe_url, validate_url
from ..manager import DownloadManager, ManagerError
from ..models import ProbeResult, RangeSupport
from ..utils import format_bytes

PART_CHOICES = [1, 4, 8, 16, 24, 32, 40]


class _ProbeSignals(QObject):
    finished = Signal(object)   # ProbeResult


class AddDownloadDialog(QDialog):
    def __init__(self, manager: DownloadManager, preset_url: str = "",
                 parent: Optional[QWidget] = None) -> None:
        super().__init__(parent)
        self.manager = manager
        self.setWindowTitle("Add Download")
        self.setMinimumWidth(640)
        self.probe_result: Optional[ProbeResult] = None
        self._probe_thread: Optional[threading.Thread] = None
        self._probe_signals = _ProbeSignals()
        self._probe_signals.finished.connect(self._on_probe_done)

        root = QVBoxLayout(self)
        root.setContentsMargins(22, 20, 22, 20)
        root.setSpacing(14)

        # ---------------- URL row ----------------
        url_row = QHBoxLayout()
        url_row.setSpacing(8)
        self.url_edit = QLineEdit()
        self.url_edit.setPlaceholderText(
            "Paste a direct download link (https://…)")
        self.url_edit.setText(preset_url)
        self.url_edit.textChanged.connect(self._on_url_changed)
        self.url_edit.returnPressed.connect(self.inspect_url)
        self.btn_inspect = QPushButton("Inspect")
        self.btn_inspect.setObjectName("GhostButton")
        self.btn_inspect.clicked.connect(self.inspect_url)
        url_row.addWidget(self.url_edit, 1)
        url_row.addWidget(self.btn_inspect)
        root.addLayout(url_row)

        self.url_hint = QLabel("")
        self.url_hint.setObjectName("InfoBanner")
        self.url_hint.setVisible(False)
        self.url_hint.setWordWrap(True)
        root.addWidget(self.url_hint)

        self.probe_panel = QFrame()
        self.probe_panel.setObjectName("Panel")
        pp = QFormLayout(self.probe_panel)
        pp.setContentsMargins(14, 10, 14, 10)
        pp.setHorizontalSpacing(14)
        self.probe_name = QLabel("—")
        self.probe_size = QLabel("—")
        self.probe_type = QLabel("—")
        self.probe_range = QLabel("—")
        for lbl in (self.probe_name, self.probe_size, self.probe_type,
                    self.probe_range):
            lbl.setObjectName("DetailValue")
        pp.addRow(self._mini_title("FILE NAME"), self.probe_name)
        pp.addRow(self._mini_title("SIZE"), self.probe_size)
        pp.addRow(self._mini_title("TYPE"), self.probe_type)
        pp.addRow(self._mini_title("SERVER"), self.probe_range)
        self.probe_panel.setVisible(False)
        root.addWidget(self.probe_panel)

        # ---------------- destination ----------------
        form = QFormLayout()
        form.setHorizontalSpacing(14)
        form.setVerticalSpacing(10)

        dest_row = QHBoxLayout()
        self.dest_edit = QLineEdit(manager.settings.get("default_dir", ""))
        btn_browse = QPushButton("Browse…")
        btn_browse.setObjectName("GhostButton")
        btn_browse.clicked.connect(self._browse_dest)
        dest_row.addWidget(self.dest_edit, 1)
        dest_row.addWidget(btn_browse)
        form.addRow("Save to folder", self._wrap(dest_row))

        self.name_edit = QLineEdit()
        self.name_edit.setPlaceholderText(
            "Optional — leave empty to use the server-provided name")
        form.addRow("File name", self.name_edit)

        parts_row = QHBoxLayout()
        self.parts_combo = QComboBox()
        for n in PART_CHOICES:
            self.parts_combo.addItem(f"{n} parallel parts", n)
        default_parts = manager.setting_int("default_parts", 40)
        idx = self.parts_combo.findData(default_parts)
        self.parts_combo.setCurrentIndex(max(0, idx))
        self.parts_label = QLabel("")
        self.parts_label.setObjectName("CardMeta")
        parts_row.addWidget(self.parts_combo)
        parts_row.addWidget(self.parts_label, 1)
        form.addRow("Connections", self._wrap(parts_row))

        # ---------------- advanced ----------------
        self.advanced_toggle = QCheckBox("Advanced options "
                                         "(checksum, headers, limits)")
        self.advanced_toggle.stateChanged.connect(self._toggle_advanced)
        form.addRow(self.advanced_toggle)

        self.advanced = QWidget()
        adv = QFormLayout(self.advanced)
        adv.setContentsMargins(0, 0, 0, 0)
        adv.setHorizontalSpacing(14)

        hash_row = QHBoxLayout()
        self.hash_algo = QComboBox()
        self.hash_algo.addItems(["none", "md5", "sha1", "sha256", "sha512"])
        self.hash_algo.setCurrentText("none")
        self.hash_value = QLineEdit()
        self.hash_value.setPlaceholderText(
            "Expected checksum (verified after download)")
        hash_row.addWidget(self.hash_algo)
        hash_row.addWidget(self.hash_value, 1)
        adv.addRow("Checksum", self._wrap(hash_row))

        self.headers_edit = QPlainTextEdit()
        self.headers_edit.setPlaceholderText(
            "Optional request headers, one per line (kept in memory only, "
            "never stored):\nAuthorization: Bearer …\nCookie: …")
        self.headers_edit.setFixedHeight(64)
        adv.addRow("Headers", self.headers_edit)

        limit_row = QHBoxLayout()
        self.speed_limit = QSpinBox()
        self.speed_limit.setRange(0, 10_000_000)
        self.speed_limit.setSuffix(" KB/s")
        self.speed_limit.setValue(0)
        self.speed_limit.setSpecialValueText("No per-download limit")
        self.priority = QSpinBox()
        self.priority.setRange(-10, 10)
        self.priority.setValue(0)
        self.priority.setToolTip("Higher priority downloads start first")
        limit_row.addWidget(QLabel("Speed limit"))
        limit_row.addWidget(self.speed_limit)
        limit_row.addSpacing(16)
        limit_row.addWidget(QLabel("Priority"))
        limit_row.addWidget(self.priority)
        limit_row.addStretch(1)
        adv.addRow("Limits", self._wrap(limit_row))
        self.advanced.setVisible(False)
        form.addRow(self.advanced)

        root.addLayout(form)
        root.addStretch(1)

        # ---------------- buttons ----------------
        btns = QHBoxLayout()
        btns.addStretch(1)
        self.btn_cancel = QPushButton("Cancel")
        self.btn_cancel.setObjectName("GhostButton")
        self.btn_cancel.clicked.connect(self.reject)
        self.btn_start = QPushButton("⬇  Start Download")
        self.btn_start.setObjectName("PrimaryButton")
        self.btn_start.setDefault(True)
        self.btn_start.clicked.connect(self._on_accept)
        btns.addWidget(self.btn_cancel)
        btns.addWidget(self.btn_start)
        root.addLayout(btns)

        if preset_url:
            self.inspect_url()

    # ------------------------------------------------------------------ util

    @staticmethod
    def _mini_title(text: str) -> QLabel:
        lbl = QLabel(text)
        lbl.setObjectName("DetailLabel")
        return lbl

    @staticmethod
    def _wrap(layout) -> QWidget:
        w = QWidget()
        w.setLayout(layout)
        return w

    def _browse_dest(self) -> None:
        d = QFileDialog.getExistingDirectory(
            self, "Choose destination folder", self.dest_edit.text())
        if d:
            self.dest_edit.setText(d)

    def _toggle_advanced(self) -> None:
        self.advanced.setVisible(self.advanced_toggle.isChecked())

    def _on_url_changed(self) -> None:
        # stale probe results are invalidated when the URL changes
        self.probe_result = None
        self.probe_panel.setVisible(False)
        self.url_hint.setVisible(False)
        self.parts_combo.setEnabled(True)
        self.parts_label.setText("")

    def _parse_headers(self) -> Dict[str, str]:
        headers: Dict[str, str] = {}
        for line in self.headers_edit.toPlainText().splitlines():
            line = line.strip()
            if not line or ":" not in line:
                continue
            k, _, v = line.partition(":")
            k, v = k.strip(), v.strip()
            if k:
                headers[k] = v
        return headers

    # ------------------------------------------------------------------ probe

    def inspect_url(self) -> None:
        url = self.url_edit.text().strip()
        try:
            validate_url(url)
        except UrlValidationError as exc:
            self._show_hint(str(exc), error=True)
            return
        if self._probe_thread and self._probe_thread.is_alive():
            return
        self.btn_inspect.setEnabled(False)
        self.btn_inspect.setText("Inspecting…")
        self._show_hint("Contacting server — inspecting headers only "
                        "(no file data is downloaded)…", error=False)
        headers = self._parse_headers()
        cfg = self.manager
        self._probe_thread = threading.Thread(
            target=self._probe_worker,
            args=(url, headers, cfg.setting_int("connect_timeout", 15),
                  cfg.setting_int("read_timeout", 30)),
            daemon=True, name="url-probe")
        self._probe_thread.start()

    def _probe_worker(self, url: str, headers: dict, ct: int, rt: int) -> None:
        result = probe_url(url, headers=headers or None,
                           connect_timeout=ct, read_timeout=rt)
        self._probe_signals.finished.emit(result)

    def _on_probe_done(self, result: ProbeResult) -> None:
        self.btn_inspect.setEnabled(True)
        self.btn_inspect.setText("Inspect")
        self.probe_result = result if result.ok else None
        if not result.ok:
            self._show_hint(result.error or "Could not inspect the URL.",
                            error=True)
            self.probe_panel.setVisible(False)
            return
        self.url_hint.setVisible(False)
        self.probe_panel.setVisible(True)
        self.probe_name.setText(result.filename or "download")
        self.probe_size.setText(
            format_bytes(result.total_size) if result.total_size >= 0
            else "unknown (server hides the size)")
        self.probe_type.setText(result.content_type or "unknown")
        if result.range_support == RangeSupport.YES:
            self.probe_range.setText(
                "✔ Supports HTTP Range requests — parallel parts available")
            self.parts_combo.setEnabled(True)
            self.parts_label.setText("")
        elif result.range_support == RangeSupport.NO:
            self.probe_range.setText(
                "✖ No Range support — single connection only")
            self.parts_combo.setCurrentIndex(0)
            self.parts_combo.setEnabled(False)
            self.parts_label.setText(
                "This server ignores byte-range requests; the download will "
                "use one connection.")
        else:
            self.probe_range.setText(
                "? Range support unclear — will be verified when starting")
            self.parts_combo.setEnabled(True)
        if result.redirect_count:
            self.probe_type.setText(
                self.probe_type.text() +
                f"  (after {result.redirect_count} redirect(s))")

    def _show_hint(self, text: str, error: bool) -> None:
        self.url_hint.setText(("⚠ " if error else "ℹ ") + text)
        self.url_hint.setObjectName("ErrorBanner" if error else "InfoBanner")
        self.url_hint.style().unpolish(self.url_hint)
        self.url_hint.style().polish(self.url_hint)
        self.url_hint.setVisible(True)

    # ------------------------------------------------------------------ accept

    def _on_accept(self) -> None:
        url = self.url_edit.text().strip()
        try:
            validate_url(url)
        except UrlValidationError as exc:
            self._show_hint(str(exc), error=True)
            return
        dest = self.dest_edit.text().strip()
        if not dest:
            self._show_hint("Choose a destination folder.", error=True)
            return
        algo = self.hash_algo.currentText()
        checksum = (algo if algo != "none" else "",
                    self.hash_value.text().strip())
        if algo != "none" and not checksum[1]:
            self._show_hint(
                f"You selected {algo.upper()} verification but did not enter "
                "the expected checksum value.", error=True)
            return

        kwargs = dict(
            dest_dir=dest,
            probe=self.probe_result,
            filename=self.name_edit.text().strip() or None,
            part_count=self.parts_combo.currentData(),
            checksum_algo=checksum[0],
            checksum_value=checksum[1],
            headers=self._parse_headers(),
            priority=self.priority.value(),
            speed_limit=self.speed_limit.value() * 1024,
        )
        while True:
            try:
                self.manager.add_download(url, **kwargs)
                self.accept()
                return
            except ManagerError as exc:
                msg = str(exc)
                if "already exists" in msg:
                    box = QMessageBox(self)
                    box.setWindowTitle("File already exists")
                    box.setText(msg + "\n\nWhat would you like to do?")
                    overwrite = box.addButton(
                        "Overwrite", QMessageBox.ButtonRole.DestructiveRole)
                    rename = box.addButton(
                        "Keep both (rename new file)",
                        QMessageBox.ButtonRole.AcceptRole)
                    cancel = box.addButton("Go back",
                                           QMessageBox.ButtonRole.RejectRole)
                    box.exec()
                    clicked = box.clickedButton()
                    if clicked is overwrite:
                        kwargs["allow_overwrite"] = True
                        continue
                    if clicked is rename:
                        kwargs["auto_rename_on_conflict"] = True
                        continue
                    if clicked is cancel:
                        return
                    return
                QMessageBox.critical(self, "Cannot add download", msg)
                return
