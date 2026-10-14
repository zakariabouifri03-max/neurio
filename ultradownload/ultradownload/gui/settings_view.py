"""Settings page — every value persists to SQLite immediately."""

from __future__ import annotations

import glob
import os
from typing import Optional

from PySide6.QtCore import Signal
from PySide6.QtWidgets import (QCheckBox, QComboBox, QFileDialog, QFormLayout,
                               QHBoxLayout, QLabel, QMessageBox, QPushButton,
                               QScrollArea, QSpinBox, QVBoxLayout, QWidget)

from ..manager import DEFAULT_SETTINGS, DownloadManager
from ..utils import format_bytes, free_disk_space
from .widgets import StatCard

PART_CHOICES = [1, 4, 8, 16, 24, 32, 40]


class SettingsPage(QScrollArea):
    accent_changed = Signal(str)

    def __init__(self, manager: DownloadManager,
                 parent: Optional[QWidget] = None) -> None:
        super().__init__(parent)
        self.manager = manager
        self.setWidgetResizable(True)
        self.setFrameShape(QScrollArea.Shape.NoFrame)

        page = QWidget()
        self.setWidget(page)
        root = QVBoxLayout(page)
        root.setContentsMargins(22, 18, 22, 18)
        root.setSpacing(18)

        # ---------------- storage summary ----------------
        cards = QHBoxLayout()
        self.card_db = StatCard("Database", "—", "download records & settings")
        self.card_temp = StatCard("Temp files", "—", "unfinished .udpart data")
        self.card_disk = StatCard("Disk free", "—", "default destination")
        for c in (self.card_db, self.card_temp, self.card_disk):
            cards.addWidget(c, 1)
        root.addLayout(cards)

        # ---------------- downloads ----------------
        root.addWidget(self._section_title("DOWNLOADS"))
        form = QFormLayout()
        form.setHorizontalSpacing(18)
        form.setVerticalSpacing(12)

        dest_row = QHBoxLayout()
        self.default_dir = QLabel(manager.settings.get("default_dir", ""))
        self.default_dir.setObjectName("DetailValue")
        btn_dir = QPushButton("Change…")
        btn_dir.setObjectName("GhostButton")
        btn_dir.clicked.connect(self._pick_dir)
        dest_row.addWidget(self.default_dir, 1)
        dest_row.addWidget(btn_dir)
        form.addRow("Default download folder", self._wrap(dest_row))

        self.max_sim = QSpinBox()
        self.max_sim.setRange(1, 16)
        self.max_sim.setValue(manager.setting_int("max_simultaneous", 3))
        self.max_sim.setToolTip("How many files download at the same time")
        self.max_sim.valueChanged.connect(
            lambda v: manager.update_settings({"max_simultaneous": v}))
        form.addRow("Max simultaneous downloads", self.max_sim)

        self.default_parts = QComboBox()
        for n in PART_CHOICES:
            self.default_parts.addItem(f"{n} parallel parts", n)
        self.default_parts.setCurrentIndex(
            max(0, self.default_parts.findData(
                manager.setting_int("default_parts", 40))))
        self.default_parts.currentIndexChanged.connect(self._parts_changed)
        form.addRow("Default part count", self.default_parts)
        hint = QLabel("Large files on range-capable servers download fastest "
                      "with many parts. If a server throttles connections, "
                      "try fewer. 40 parts does not guarantee 40× speed — "
                      "your bandwidth is the real limit.")
        hint.setObjectName("CardMeta")
        hint.setWordWrap(True)
        form.addRow("", hint)

        self.connect_timeout = QSpinBox()
        self.connect_timeout.setRange(3, 120)
        self.connect_timeout.setSuffix(" s")
        self.connect_timeout.setValue(
            manager.setting_int("connect_timeout", 15))
        self.connect_timeout.valueChanged.connect(
            lambda v: manager.update_settings({"connect_timeout": v}))
        form.addRow("Connection timeout", self.connect_timeout)

        self.read_timeout = QSpinBox()
        self.read_timeout.setRange(5, 600)
        self.read_timeout.setSuffix(" s")
        self.read_timeout.setValue(manager.setting_int("read_timeout", 60))
        self.read_timeout.valueChanged.connect(
            lambda v: manager.update_settings({"read_timeout": v}))
        form.addRow("Read timeout", self.read_timeout)

        self.retries = QSpinBox()
        self.retries.setRange(0, 25)
        self.retries.setValue(manager.setting_int("max_retries", 5))
        self.retries.valueChanged.connect(
            lambda v: manager.update_settings({"max_retries": v}))
        form.addRow("Retries per part (exponential backoff)", self.retries)

        self.speed_limit = QSpinBox()
        self.speed_limit.setRange(0, 10_000_000)
        self.speed_limit.setSuffix(" KB/s")
        self.speed_limit.setSpecialValueText("Unlimited")
        self.speed_limit.setValue(
            manager.setting_int("global_speed_limit", 0) // 1024)
        self.speed_limit.valueChanged.connect(self._limit_changed)
        form.addRow("Global speed limit (all downloads)", self.speed_limit)

        root.addLayout(form)

        # ---------------- application ----------------
        root.addWidget(self._section_title("APPLICATION"))
        form2 = QFormLayout()
        form2.setHorizontalSpacing(18)
        form2.setVerticalSpacing(12)

        self.start_min = QCheckBox("Start minimized to the system tray")
        self.start_min.setChecked(manager.setting_bool("start_minimized"))
        self.start_min.stateChanged.connect(
            lambda s: manager.update_settings({"start_minimized": int(bool(s))}))
        form2.addRow("Startup", self.start_min)

        self.accent = QComboBox()
        self.accent.addItem("Purple", "purple")
        self.accent.addItem("Blue", "blue")
        self.accent.setCurrentIndex(
            max(0, self.accent.findData(manager.settings.get("accent",
                                                             "purple"))))
        self.accent.currentIndexChanged.connect(self._accent_changed)
        form2.addRow("Accent theme", self.accent)

        self.auto_clean = QCheckBox(
            "Automatically delete temporary files when a download is "
            "cancelled (skip the confirmation dialog)")
        self.auto_clean.setChecked(manager.setting_bool("auto_cleanup_temp"))
        self.auto_clean.stateChanged.connect(
            lambda s: manager.update_settings({"auto_cleanup_temp": int(bool(s))}))
        form2.addRow("Cleanup", self.auto_clean)

        btn_clean = QPushButton("🧹  Clean up orphaned temporary files now…")
        btn_clean.setObjectName("GhostButton")
        btn_clean.clicked.connect(self._cleanup_now)
        form2.addRow("Temporary files", btn_clean)

        root.addLayout(form2)

        btn_reset = QPushButton("Reset all settings to defaults")
        btn_reset.setObjectName("DangerButton")
        btn_reset.clicked.connect(self._reset_defaults)
        row = QHBoxLayout()
        row.addStretch(1)
        row.addWidget(btn_reset)
        root.addLayout(row)
        root.addStretch(1)

        self.refresh_storage()
        manager.sig_stats.connect(lambda _s: self.refresh_storage())

    # ------------------------------------------------------------------ util

    @staticmethod
    def _section_title(text: str) -> QLabel:
        lbl = QLabel(text)
        lbl.setObjectName("SectionTitle")
        return lbl

    @staticmethod
    def _wrap(layout) -> QWidget:
        w = QWidget()
        w.setLayout(layout)
        return w

    def refresh_storage(self) -> None:
        db_path = self.manager.db.path
        db_size = os.path.getsize(db_path) if os.path.exists(db_path) else 0
        self.card_db.set_value(format_bytes(db_size), os.path.basename(db_path))
        temp_bytes, temp_count = self._scan_temp_files()
        self.card_temp.set_value(format_bytes(temp_bytes),
                                 f"{temp_count} unfinished file(s)")
        disk = free_disk_space(self.manager.settings.get("default_dir", "."))
        self.card_disk.set_value(
            format_bytes(disk) if disk is not None else "unknown",
            "default destination volume")

    def _scan_temp_files(self):
        """Find .udpart files that do not belong to a live download."""
        live = {t.temp_path for t in self.manager.tasks.values()
                if not t.status.is_finished}
        total, count = 0, 0
        seen_dirs = {t.dest_dir for t in self.manager.tasks.values()}
        default_dir = self.manager.settings.get("default_dir", "")
        if default_dir:
            seen_dirs.add(default_dir)
        for d in seen_dirs:
            try:
                for p in glob.glob(os.path.join(d, "*.udpart")):
                    if p in live:
                        continue
                    total += os.path.getsize(p)
                    count += 1
            except OSError:
                continue
        return total, count

    # ---------------------------------------------------------------- actions

    def _pick_dir(self) -> None:
        d = QFileDialog.getExistingDirectory(
            self, "Default download folder",
            self.manager.settings.get("default_dir", ""))
        if d:
            self.manager.update_settings({"default_dir": d})
            self.default_dir.setText(d)

    def _parts_changed(self) -> None:
        self.manager.update_settings(
            {"default_parts": self.default_parts.currentData()})

    def _limit_changed(self, kb: int) -> None:
        self.manager.update_settings({"global_speed_limit": kb * 1024})

    def _accent_changed(self) -> None:
        accent = self.accent.currentData()
        self.manager.update_settings({"accent": accent})
        self.accent_changed.emit(accent)

    def _cleanup_now(self) -> None:
        temp_bytes, temp_count = self._scan_temp_files()
        if temp_count == 0:
            QMessageBox.information(
                self, "Cleanup",
                "No orphaned temporary files were found.")
            return
        answer = QMessageBox.question(
            self, "Clean up temporary files",
            f"Found {temp_count} orphaned temporary file(s) using "
            f"{format_bytes(temp_bytes)}.\n\n"
            "These belong to downloads that are no longer active. Deleting "
            "them means those downloads cannot be resumed.\n\nDelete them?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No)
        if answer != QMessageBox.StandardButton.Yes:
            return
        live = {t.temp_path for t in self.manager.tasks.values()
                if not t.status.is_finished}
        removed = 0
        seen_dirs = {t.dest_dir for t in self.manager.tasks.values()}
        default_dir = self.manager.settings.get("default_dir", "")
        if default_dir:
            seen_dirs.add(default_dir)
        for d in seen_dirs:
            for p in glob.glob(os.path.join(d, "*.udpart")):
                if p in live:
                    continue
                try:
                    os.remove(p)
                    removed += 1
                except OSError:
                    pass
        QMessageBox.information(
            self, "Cleanup",
            f"Deleted {removed} temporary file(s), freeing "
            f"{format_bytes(temp_bytes)}.")
        self.refresh_storage()

    def _reset_defaults(self) -> None:
        answer = QMessageBox.question(
            self, "Reset settings",
            "Restore all settings to their defaults?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No)
        if answer != QMessageBox.StandardButton.Yes:
            return
        defaults = dict(DEFAULT_SETTINGS)
        defaults.pop("default_dir", None)   # keep the user's folder choice
        self.manager.update_settings(defaults)
        self.max_sim.setValue(self.manager.setting_int("max_simultaneous", 3))
        self.default_parts.setCurrentIndex(
            max(0, self.default_parts.findData(
                self.manager.setting_int("default_parts", 40))))
        self.connect_timeout.setValue(
            self.manager.setting_int("connect_timeout", 15))
        self.read_timeout.setValue(self.manager.setting_int("read_timeout", 60))
        self.retries.setValue(self.manager.setting_int("max_retries", 5))
        self.speed_limit.setValue(
            self.manager.setting_int("global_speed_limit", 0) // 1024)
        self.start_min.setChecked(self.manager.setting_bool("start_minimized"))
        self.accent.setCurrentIndex(
            max(0, self.accent.findData(
                self.manager.settings.get("accent", "purple"))))
        self._accent_changed()
