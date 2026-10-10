"""UI smoke tests (offscreen): every panel must construct and key flows work.

These tests run against a real QApplication with the offscreen platform; they
instantiate the full main window, walk through every studio panel, and drive
actual operations (project creation, timeline edits, image ops, design render)
so a broken import or signal wiring fails CI.
"""

import os

import pytest

pyside6 = pytest.importorskip("PySide6")

from PySide6.QtCore import Qt
from PySide6.QtWidgets import QApplication

from adzak.core.projects import ProjectManager, ProjectStore
from adzak.core.settings import Settings


@pytest.fixture(scope="module")
def qapp():
    app = QApplication.instance() or QApplication([])
    yield app


@pytest.fixture()
def window(qapp, tmp_home):
    from adzak.ui.main_window import MainWindow
    w = MainWindow()
    w.show()
    yield w
    # In offscreen mode a modal save prompt would block forever; the real app
    # shows it to interactive users.  Tests clear the dirty flag instead.
    if w.project:
        w.project.dirty = False
    w.close()


def test_main_window_builds(window):
    assert window.windowTitle()
    assert window.stack.count() == 10
    # sidebar lists every studio
    assert window.tool_list.count() == 10


def test_switch_all_panels(window):
    for i in range(window.tool_list.count()):
        window.tool_list.setCurrentRow(i)
        qapp = QApplication.instance()
        qapp.processEvents()
        assert window.stack.currentIndex() >= 0


def test_new_project_flow(window):
    window.project_manager.base_dir = window.project_manager.base_dir
    proj = window.project_manager.create("Smoke", "video", 1280, 720, 30)
    window._activate_project(proj)
    assert window.project is proj
    assert window.video_editor.project is proj
    window.save_project()
    assert proj.project_file.is_file()


def test_video_editor_model_ops(window):
    proj = window.project_manager.create("Ops", "video")
    window._activate_project(proj)
    ve = window.video_editor
    from adzak.services.timeline import Clip
    track = ve._ensure_track("video")
    clip = Clip(source=__file__, start=0.0, out_point=2.0, name="fake",
                source_duration=2.0)
    ve.timeline.add_clip(track, clip)
    ve._after_edit()
    assert ve.timeline.duration() == pytest.approx(2.0)
    ve.timeline_widget.playhead = 1.0
    ve.split_at_playhead()
    assert len(track.clips) == 2
    ve.timeline_widget.selected_clip = track.clips[0].id
    ve.delete_selected()
    assert len(track.clips) == 1
    assert ve.undo.can_undo()
    window.undo(); window.redo()


def test_photo_editor_ops(window, sample_image):
    pe = window.photo_editor
    from adzak.services import image_ops
    img = image_ops.load_rgba(sample_image)
    pe.layers = [img]
    pe.opacity = [1.0]
    pe.active = 0
    pe.original = img.copy()
    pe.apply_adjustments()
    assert len(pe.layers) == 1
    pe.apply_filter()
    comp = pe.composite()
    assert comp.width == img.width
    pe.undo.undo()


def test_design_render_and_templates(window):
    d = window.design
    assert len(d.templates) >= 5
    d.apply_template(d.templates["youtube_thumbnail"])
    img = d.render(0.5)
    assert img.width() == 640 and img.height() == 360
    d.add_item("text")
    d.refresh()


def test_animation_render_frame(window):
    a = window.animation
    a.add_object()
    a.apply_preset()
    frame = a.render_frame(0.4, (160, 90))
    assert frame.size == (160, 90)


def test_assistant_panel(window):
    p = window.assistant
    p.question.setPlainText("How do I export for TikTok?")
    p.ask()
    assert "TikTok" in p.answer.toPlainText() or "1080" in p.answer.toPlainText()
    p.topic.setText("Space")
    p.gen_titles(); p.gen_tags()
    assert p.output.toPlainText()


def test_language_switch_and_rtl(window):
    window.settings.set("ui/language", "ar")
    window.apply_language()
    assert window.layoutDirection() == Qt.RightToLeft
    first_tool = window.tool_list.item(1).text()
    assert "محرر الفيديو" in first_tool
    window.settings.set("ui/language", "en")
    window.apply_language()
    assert window.layoutDirection() == Qt.LeftToRight


def test_theme_switch(window):
    window.settings.set("ui/theme", "light")
    window.apply_theme()
    window.settings.set("ui/theme", "dark")
    window.apply_theme()


def test_ai_panels_honest_status(window):
    ok, why = window.ai_image._provider().available()
    assert ok is False            # no key configured in a fresh env
    assert "key" in why.lower() or "provider" in why.lower()
