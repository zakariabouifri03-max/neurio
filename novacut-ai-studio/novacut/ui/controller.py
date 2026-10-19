"""Application controller: project lifecycle, undo, selection and autosave."""
from __future__ import annotations

from pathlib import Path
from typing import Optional

from PySide6.QtCore import QObject, QTimer, Signal

from ..core.commands import UndoStack, Command
from ..core.config import Config
from ..core.logging_setup import get_logger
from ..core.workers import TaskWorker
from ..diagnostics.recovery import SessionRecovery
from ..media.library import MediaLibrary
from ..models.project import Project
from ..models.serialize import save_project, load_project, ProjectLoadError
from ..models.timeline import Clip

log = get_logger("controller")


class ProjectController(QObject):
    projectChanged = Signal(object)
    timelineChanged = Signal()
    selectionChanged = Signal(object)
    dirtyChanged = Signal(bool)
    statusMessage = Signal(str)
    projectSaved = Signal(str)

    def __init__(self, config: Config, parent=None):
        super().__init__(parent)
        self.config = config
        self.undo_stack = UndoStack(capacity=300)
        self.recovery = SessionRecovery()
        self.project: Project = Project.from_preset()
        self.library = MediaLibrary(self.project)
        self.selected_clip_id: Optional[str] = None
        self._workers: list[TaskWorker] = []
        self.undo_stack.changed.connect(self._on_stack_changed)

        self._autosave = QTimer(self)
        self._autosave.setInterval(
            max(15, int(config.get("autosave_interval_s", 60))) * 1000)
        self._autosave.timeout.connect(self.autosave)
        if config.get("autosave", True):
            self._autosave.start()
        self.recovery.begin(self.project)

    # ------------------------------------------------------------- project
    def new_project(self, preset_id: str = "landscape_1080",
                    name: str = "Untitled project") -> None:
        self.undo_stack.clear()
        self.project = Project.from_preset(preset_id, name)
        self.library = MediaLibrary(self.project)
        self.selected_clip_id = None
        self.projectChanged.emit(self.project)
        self.timelineChanged.emit()
        self.recovery.begin(self.project)
        self.statusMessage.emit("New project created")

    def open_project(self, path: str) -> None:
        project = load_project(path)
        self.undo_stack.clear()
        self.project = project
        self.library = MediaLibrary(self.project)
        self.selected_clip_id = None
        self.projectChanged.emit(self.project)
        self.timelineChanged.emit()
        self.recovery.begin(self.project)
        self.statusMessage.emit(f"Opened {Path(path).name}")

    def save_project(self, path: Optional[str] = None,
                     bundle_media: bool = False) -> str:
        target = path or self.project.path
        if not target:
            raise ValueError("Save path required")
        out = save_project(self.project, target, bundle_media=bundle_media)
        self.dirtyChanged.emit(False)
        self.projectSaved.emit(str(out))
        self.recovery.begin(self.project)
        self.statusMessage.emit(f"Saved {Path(target).name}")
        return str(out)

    def autosave(self) -> None:
        if not self.config.get("autosave", True) or not self.project.dirty:
            return
        try:
            path = self.recovery.autosave(self.project)
            self.statusMessage.emit(f"Autosaved {path.name}")
        except Exception:  # noqa: BLE001
            log.exception("Autosave failed")

    def shutdown(self) -> None:
        self._autosave.stop()
        if not self.project.dirty:
            self.recovery.end()

    # ------------------------------------------------------------- commands
    def execute(self, command: Command, merge: bool = False) -> None:
        self.undo_stack.push(command, merge=merge)
        self.project.touch()
        self.timelineChanged.emit()
        self.dirtyChanged.emit(True)

    def undo(self) -> None:
        if self.undo_stack.can_undo():
            self.undo_stack.undo()
            self.project.touch()
            self.timelineChanged.emit()

    def redo(self) -> None:
        if self.undo_stack.can_redo():
            self.undo_stack.redo()
            self.project.touch()
            self.timelineChanged.emit()

    def _on_stack_changed(self) -> None:
        self.dirtyChanged.emit(self.project.dirty)

    # ------------------------------------------------------------ selection
    def select_clip(self, clip_id: Optional[str]) -> None:
        self.selected_clip_id = clip_id
        self.selectionChanged.emit(self.selected_clip)

    @property
    def selected_clip(self) -> Optional[Clip]:
        if not self.selected_clip_id:
            return None
        return self.project.timeline.clip_by_id(self.selected_clip_id)

    # ------------------------------------------------------------- workers
    def run_worker(self, worker: TaskWorker, on_finished=None,
                   on_failed=None) -> TaskWorker:
        worker.finished.connect(lambda r: self._worker_done(worker))
        if on_finished:
            worker.finished.connect(on_finished)
        if on_failed:
            worker.failed.connect(on_failed)
        self._workers.append(worker)
        worker.start()
        return worker

    def _worker_done(self, worker: TaskWorker) -> None:
        if worker in self._workers:
            self._workers.remove(worker)
        self.timelineChanged.emit()

    def import_files(self, paths: list[str], on_finished=None) -> TaskWorker:
        def task(progress, should_cancel):
            return self.library.import_paths(paths, progress=progress)

        worker = TaskWorker(task)
        self.statusMessage.emit(f"Importing {len(paths)} file(s)...")
        return self.run_worker(
            worker,
            on_finished=lambda result: (
                self.projectChanged.emit(self.project),
                self.statusMessage.emit(
                    f"Imported {len(result.added)} file(s)"),
                on_finished(result) if on_finished else None))
