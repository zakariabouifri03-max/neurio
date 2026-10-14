"""Settings page: defaults, limits, appearance, cleanup."""

from __future__ import annotations

from PySide6.QtWidgets import (QCheckBox, QComboBox, QDoubleSpinBox,
                               QFileDialog, QFormLayout, QFrame, QHBoxLayout,
                               QLabel, QLineEdit, QMessageBox, QPushButton,
                               QSpinBox, QVBoxLayout, QWidget)

from ...config import PART_CHOICES, save_settings


class SettingsPage(QWidget):
    def __init__(self, manager, on_settings_changed=None, parent=None) -> None:
        super().__init__(parent)
        self.manager = manager
        self.on_settings_changed = on_settings_changed

        root = QVBoxLayout(self)
        root.setContentsMargins(28, 24, 28, 24)
        root.setSpacing(16)

        title = QLabel("Settings")
        title.setObjectName("pageTitle")
        root.addWidget(title)

        card = QFrame()
        card.setObjectName("panel")
        form = QFormLayout(card)
        form.setContentsMargins(22, 20, 22, 20)
        form.setSpacing(14)
        form.setHorizontalSpacing(24)

        s = self.manager.settings

        dir_row = QHBoxLayout()
        self.dir_edit = QLineEdit(s.default_dir)
        browse = QPushButton("Browse…")
        browse.setObjectName("secondary")
        browse.clicked.connect(self._browse)
        dir_row.addWidget(self.dir_edit, 1)
        dir_row.addWidget(browse)
        form.addRow("Default download folder", dir_row)

        self.simultaneous = QSpinBox()
        self.simultaneous.setRange(1, 20)
        self.simultaneous.setValue(s.max_simultaneous_downloads)
        form.addRow("Max simultaneous downloads", self.simultaneous)

        self.parts = QComboBox()
        for n in PART_CHOICES:
            self.parts.addItem(f"{n} parts", n)
        if s.default_parts in PART_CHOICES:
            self.parts.setCurrentIndex(PART_CHOICES.index(s.default_parts))
        form.addRow("Default number of parts", self.parts)

        self.conn_timeout = QDoubleSpinBox()
        self.conn_timeout.setRange(1.0, 300.0)
        self.conn_timeout.setSuffix(" s")
        self.conn_timeout.setValue(s.connect_timeout)
        form.addRow("Connection timeout", self.conn_timeout)

        self.read_timeout = QDoubleSpinBox()
        self.read_timeout.setRange(1.0, 3600.0)
        self.read_timeout.setSuffix(" s")
        self.read_timeout.setValue(s.read_timeout)
        form.addRow("Read timeout", self.read_timeout)

        self.retries = QSpinBox()
        self.retries.setRange(0, 20)
        self.retries.setValue(s.retry_count)
        form.addRow("Retry count per part", self.retries)

        self.speed_limit = QDoubleSpinBox()
        self.speed_limit.setRange(0.0, 100_000.0)
        self.speed_limit.setSuffix(" MB/s")
        self.speed_limit.setSpecialValueText("Unlimited")
        self.speed_limit.setValue(s.global_speed_limit / (1024 * 1024))
        form.addRow("Total speed limit", self.speed_limit)

        self.theme = QComboBox()
        self.theme.addItem("Dark Charcoal", "dark")
        self.theme.addItem("Midnight", "midnight")
        self.theme.setCurrentIndex(0 if s.theme == "dark" else 1)
        form.addRow("Theme", self.theme)

        self.accent = QComboBox()
        self.accent.addItem("Blue accent", "blue")
        self.accent.addItem("Purple accent", "purple")
        self.accent.setCurrentIndex(0 if s.accent == "blue" else 1)
        form.addRow("Accent color", self.accent)

        self.start_min = QCheckBox("Start minimized to system tray")
        self.start_min.setChecked(s.start_minimized)
        form.addRow("", self.start_min)

        self.auto_cleanup = QCheckBox("Remove temporary part files after "
                                      "successful downloads")
        self.auto_cleanup.setChecked(s.auto_cleanup_temp)
        form.addRow("", self.auto_cleanup)

        self.confirm_cleanup = QCheckBox("Ask before deleting temporary files")
        self.confirm_cleanup.setChecked(s.confirm_cleanup)
        form.addRow("", self.confirm_cleanup)

        # Numeric/choice fields shouldn't stretch across the whole card.
        for w in (self.simultaneous, self.parts, self.conn_timeout,
                  self.read_timeout, self.retries, self.speed_limit,
                  self.theme, self.accent):
            w.setMaximumWidth(280)

        root.addWidget(card)

        actions = QHBoxLayout()
        self.cleanup_btn = QPushButton("Clean leftover temp files now")
        self.cleanup_btn.setObjectName("secondary")
        self.cleanup_btn.clicked.connect(self._cleanup_now)
        save_btn = QPushButton("Save Settings")
        save_btn.setObjectName("primary")
        save_btn.clicked.connect(self._save)
        self.status_l = QLabel("")
        self.status_l.setObjectName("ok")
        actions.addWidget(self.cleanup_btn)
        actions.addStretch()
        actions.addWidget(self.status_l)
        actions.addWidget(save_btn)
        root.addLayout(actions)
        root.addStretch()

    def _browse(self) -> None:
        d = QFileDialog.getExistingDirectory(self, "Choose default folder",
                                             self.dir_edit.text())
        if d:
            self.dir_edit.setText(d)

    def _save(self) -> None:
        s = self.manager.settings
        s.default_dir = self.dir_edit.text().strip() or s.default_dir
        s.max_simultaneous_downloads = self.simultaneous.value()
        s.default_parts = self.parts.currentData()
        s.connect_timeout = self.conn_timeout.value()
        s.read_timeout = self.read_timeout.value()
        s.retry_count = self.retries.value()
        s.global_speed_limit = self.speed_limit.value() * 1024 * 1024
        s.theme = self.theme.currentData()
        s.accent = self.accent.currentData()
        s.start_minimized = self.start_min.isChecked()
        s.auto_cleanup_temp = self.auto_cleanup.isChecked()
        s.confirm_cleanup = self.confirm_cleanup.isChecked()
        save_settings(self.manager.db, s)
        self.manager.apply_settings(s)
        if self.on_settings_changed:
            self.on_settings_changed()
        self.status_l.setText("Settings saved ✓")

    def _cleanup_now(self) -> None:
        if self.manager.settings.confirm_cleanup:
            ret = QMessageBox.question(
                self, "Cleanup",
                "Delete leftover temporary part files for finished downloads?\n"
                "Completed downloads are not affected.",
                QMessageBox.Yes | QMessageBox.No, QMessageBox.No)
            if ret != QMessageBox.Yes:
                return
        cleaned = self.manager.cleanup_temp_files()
        self.status_l.setText(f"Cleaned {cleaned} folder(s).")
