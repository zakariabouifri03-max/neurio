"""Model installation manager: explicit downloads with disk checks."""
from __future__ import annotations

from PySide6.QtCore import Qt
from PySide6.QtWidgets import (QDialog, QVBoxLayout, QTableWidget, QTableWidgetItem,
                               QPushButton, QProgressBar, QLabel, QHeaderView,
                               QHBoxLayout, QMessageBox)

from ..ai import model_manager
from ..core.workers import TaskWorker


class ModelManagerDialog(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("AI Model Manager")
        self.resize(820, 480)
        layout = QVBoxLayout(self)
        notice = QLabel(
            "Models are downloaded only when you click Install — never silently. "
            "Everything runs locally and offline afterwards.")
        notice.setWordWrap(True)
        notice.setObjectName("Dim")
        layout.addWidget(notice)

        deps = model_manager.dependency_report()
        dep_text = "Python engines: " + ", ".join(
            f"{k}={'✓' if v else '—'}" for k, v in deps.items())
        layout.addWidget(QLabel(dep_text))

        self.table = QTableWidget(0, 6)
        self.table.setHorizontalHeaderLabels(
            ["Model", "Kind", "Size", "Status", "License / notes", "Actions"])
        self.table.horizontalHeader().setSectionResizeMode(
            4, QHeaderView.ResizeMode.Stretch)
        layout.addWidget(self.table, 1)

        self.progress = QProgressBar()
        layout.addWidget(self.progress)
        self.status = QLabel("Idle")
        layout.addWidget(self.status)
        buttons = QHBoxLayout()
        buttons.addStretch(1)
        close = QPushButton("Close")
        close.clicked.connect(self.accept)
        buttons.addWidget(close)
        layout.addLayout(buttons)
        self.refresh()

    def refresh(self) -> None:
        self.table.setRowCount(0)
        for spec in model_manager.specs():
            r = self.table.rowCount()
            self.table.insertRow(r)
            ok, free, needed = model_manager.free_space_for(spec)
            is_installed = model_manager.installed(spec)
            values = [
                spec.label, spec.kind,
                f"~{spec.size_bytes // 1_000_000} MB",
                "Installed" if is_installed else
                ("Ready to download" if ok else "Not enough disk space"),
                f"{spec.license}. {spec.note}",
            ]
            for c, v in enumerate(values):
                item = QTableWidgetItem(v)
                item.setFlags(item.flags() & ~Qt.ItemFlag.ItemIsEditable)
                self.table.setItem(r, c, item)
            if spec.kind == "demucs":
                action = QPushButton("Auto on first run")
                action.setEnabled(False)
            else:
                action = QPushButton("Remove" if is_installed else "Install")
                action.setEnabled(is_installed or ok)
                action.clicked.connect(lambda _=False, s=spec:
                                       self._remove(s) if model_manager.installed(s)
                                       else self._install(s))
            self.table.setCellWidget(r, 5, action)

    def _install(self, spec: model_manager.ModelSpec) -> None:
        if QMessageBox.question(
                self, "Download model",
                f"Download {spec.label} (~{spec.size_bytes // 1_000_000} MB) "
                "now? It stays on this computer and runs fully offline.") \
                != QMessageBox.StandardButton.Yes:
            return

        if spec.kind == "whisper":
            # Whisper needs the full HF snapshot (weights + tokenizer), which
            # the engine's own downloader places in our models directory.
            from ..ai.subtitles import SubtitleEngine
            size = spec.id.split("whisper-", 1)[1]
            engine = SubtitleEngine()

            def task(progress_cb, should_cancel):
                return engine.install_engine_model(
                    size, progress=progress_cb, should_cancel=should_cancel)
        else:
            def task(progress_cb, should_cancel):
                return model_manager.install_model(
                    spec.id, progress=lambda f, m: progress_cb(f, m),
                    should_cancel=should_cancel)

        worker = TaskWorker(task)
        worker.progress.connect(
            lambda f, m: (self.progress.setValue(int(f * 100)), self.status.setText(m)))
        worker.failed.connect(lambda e: (self.status.setText("Failed"),
                                         QMessageBox.critical(self, "Download failed", e)))
        worker.cancelled.connect(lambda: self.status.setText("Cancelled"))
        worker.finished.connect(lambda _: (self.status.setText("Installed"),
                                           self.progress.setValue(100), self.refresh()))
        worker.start()
        self._worker = worker

    def _remove(self, spec: model_manager.ModelSpec) -> None:
        model_manager.remove_model(spec.id)
        self.refresh()
        self.status.setText(f"Removed {spec.label}")
