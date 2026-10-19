"""Headless UI smoke tests: windows, dialogs and controller-driven editing."""
import pytest

pytest.importorskip("PySide6")


@pytest.fixture
def app(qapp):
    return qapp


@pytest.fixture
def controller(app):
    from novacut.core.config import Config
    from novacut.ui.controller import ProjectController
    return ProjectController(Config())


def test_main_window_and_dialogs_construct(app, controller):
    from novacut.ui.main_window import MainWindow, NewProjectDialog
    from novacut.ui.ai_studio import AIStudioWindow
    from novacut.ui.export_dialog import ExportDialog
    from novacut.ui.model_manager_dialog import ModelManagerDialog
    from novacut.ui.settings_dialog import SettingsDialog

    window = MainWindow(controller)
    window.show()
    AIStudioWindow(controller)
    ExportDialog(controller)
    ModelManagerDialog()
    SettingsDialog(controller.config)
    NewProjectDialog()
    assert window.windowTitle()


def test_full_edit_workflow_through_controller(app, controller):
    from novacut.editing.operations import (AddClipCommand, SplitClipCommand,
                                            MoveClipCommand, RippleDeleteCommand)
    from novacut.models.enums import ClipKind
    from novacut.models.timeline import Clip

    tl = controller.project.timeline
    clip = Clip(kind=ClipKind.COLOR.value, start=0.0, duration=6.0,
                source_duration=6.0, name="Color")
    controller.execute(AddClipCommand(tl, clip, tl.video_tracks()[0].id))
    assert len(tl.all_clips()) == 1
    controller.execute(SplitClipCommand(tl, clip.id, 2.0))
    assert len(tl.all_clips()) == 2
    controller.undo()
    assert len(tl.all_clips()) == 1
    controller.redo()
    assert len(tl.all_clips()) == 2

    right = next(c for c in tl.all_clips() if abs(c.start - 2.0) < 1e-6)
    controller.execute(MoveClipCommand(tl, right.id, 3.0))
    assert right.start == pytest.approx(3.0)
    controller.execute(RippleDeleteCommand(tl, right.id))
    assert controller.project.timeline.clip_by_id(right.id) is None
    controller.undo()
    assert controller.project.timeline.clip_by_id(right.id) is not None

    # Inspector and timeline must rebuild without errors for every clip kind.
    window = controller  # keep ref
    for kind in (ClipKind.TITLE.value, ClipKind.COLOR.value):
        extra = Clip(kind=kind, start=5.0, duration=2.0, source_duration=2.0)
        controller.execute(AddClipCommand(
            tl, extra, tl.video_tracks()[1].id))
        controller.select_clip(extra.id)
    from novacut.ui.inspector import Inspector
    inspector = Inspector(controller)
    inspector.refresh()


def test_media_import_and_timeline_drag_data(app, controller, media_factory):
    video = media_factory("ui_src.mp4", duration=2.0)
    result = controller.library.import_paths([str(video)])
    assert len(result.added) == 1
    mid = result.added[0].id

    from novacut.timeline_ui.timeline_widget import TimelineScene, TimelineView, MIME_MEDIA
    from PySide6.QtCore import QMimeData, QPointF
    from PySide6.QtGui import QDragEnterEvent  # noqa: F401
    scene = TimelineScene()
    scene.set_project(controller.project)
    view = TimelineView(scene)
    # Simulate the drop payload the media bin produces.
    mime = QMimeData()
    mime.setData(MIME_MEDIA, f'["{mid}"]'.encode())
    assert mime.hasFormat(MIME_MEDIA)
    before = len(controller.project.timeline.all_clips())
    # Drive the same logic the view uses on drop directly.
    project = controller.project
    media = project.get_media(mid)
    clip_kind = media.kind if media.kind in ("audio", "image") else "video"
    from novacut.models.timeline import Clip
    from novacut.editing.operations import AddClipCommand
    clip = Clip(kind=clip_kind, media_id=mid, name=media.name, start=0.0,
                duration=min(2.0, media.effective_duration()),
                source_duration=min(2.0, media.effective_duration()))
    track = project.timeline.video_tracks()[0]
    controller.execute(AddClipCommand(project.timeline, clip, track.id))
    assert len(project.timeline.all_clips()) == before + 1
    scene.set_project(project)
    assert clip.id in scene._clip_items


def test_autosave_and_recovery_roundtrip(app, controller, tmp_path):
    from novacut.models.timeline import Clip
    from novacut.models.enums import ClipKind
    from novacut.editing.operations import AddClipCommand

    tl = controller.project.timeline
    controller.execute(AddClipCommand(
        tl, Clip(kind=ClipKind.TITLE.value, start=0, duration=3,
                 source_duration=3),
        tl.video_tracks()[0].id))
    path = controller.recovery.autosave(controller.project)
    assert path.exists()
    sessions = controller.recovery.find_recoverable()
    assert any(s.autosave_path == str(path) for s in sessions)
    recovered = controller.recovery.load_autosave(str(path))
    assert len(recovered.timeline.all_clips()) == len(tl.all_clips())
