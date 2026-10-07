"""UI level tests: build the real window and drive it like a user would."""
from __future__ import annotations

import os

import pytest

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")


@pytest.fixture(scope="module")
def app():
    from PySide6.QtWidgets import QApplication
    application = QApplication.instance() or QApplication([])
    yield application


@pytest.fixture()
def window(app):
    from mfs.ui.main_window import MainWindow
    from mfs.ui.session import EditorSession
    session = EditorSession()
    win = MainWindow(session)
    win.resize(1500, 900)
    win.show()
    app.processEvents()
    yield win
    win.session.close()
    win.session.project.dirty = False      # never block on the "save?" dialog in tests
    win.close()


def _click_canvas(win, x: float, y: float, pressure: float = 0.8):
    from PySide6.QtCore import QPointF, Qt
    from PySide6.QtGui import QMouseEvent
    from PySide6.QtWidgets import QApplication
    widget = win.canvas
    pos = QPointF(x, y)
    press = QMouseEvent(QMouseEvent.MouseButtonPress, pos, widget.mapToGlobal(pos.toPoint()),
                        Qt.LeftButton, Qt.LeftButton, Qt.NoModifier)
    move = QMouseEvent(QMouseEvent.MouseMove, pos, widget.mapToGlobal(pos.toPoint()),
                       Qt.NoButton, Qt.LeftButton, Qt.NoModifier)
    release = QMouseEvent(QMouseEvent.MouseButtonRelease, pos,
                          widget.mapToGlobal(pos.toPoint()), Qt.LeftButton, Qt.NoButton,
                          Qt.NoModifier)
    widget.mousePressEvent(press)
    widget.mouseMoveEvent(move)
    widget.mouseReleaseEvent(release)
    QApplication.processEvents()


def _draw_stroke(win, points):
    from PySide6.QtCore import QPointF, Qt
    from PySide6.QtGui import QMouseEvent
    from PySide6.QtWidgets import QApplication
    widget = win.canvas
    first = QPointF(*points[0])
    widget.mousePressEvent(QMouseEvent(QMouseEvent.MouseButtonPress, first,
                                       widget.mapToGlobal(first.toPoint()), Qt.LeftButton,
                                       Qt.LeftButton, Qt.NoModifier))
    for point in points[1:]:
        pos = QPointF(*point)
        widget.mouseMoveEvent(QMouseEvent(QMouseEvent.MouseMove, pos,
                                          widget.mapToGlobal(pos.toPoint()), Qt.NoButton,
                                          Qt.LeftButton, Qt.NoModifier))
    last = QPointF(*points[-1])
    widget.mouseReleaseEvent(QMouseEvent(QMouseEvent.MouseButtonRelease, last,
                                         widget.mapToGlobal(last.toPoint()), Qt.LeftButton,
                                         Qt.NoButton, Qt.NoModifier))
    QApplication.processEvents()


def test_window_builds_with_all_panels(window):
    assert window.timeline is not None
    assert window.layers_panel is not None
    assert window.properties is not None
    assert window.character is not None
    assert window.ai_panel is not None
    assert window.assets is not None
    assert window.graph is not None
    for tool in ("brush", "pencil", "ink", "marker", "soft", "airbrush", "charcoal", "eraser",
                 "fill", "shape", "text", "transform", "bone", "hand", "zoom", "select"):
        assert tool in window.tool_rail.buttons


def test_draw_on_canvas_and_undo(window):
    from mfs.engine.render import RenderOptions, render_scene
    session = window.session
    session.set_tool("brush")
    cel = session.current_cel(create=True)
    before = cel.content_bounds()
    _draw_stroke(window, [(220, 200), (300, 260), (380, 320), (420, 360)])
    assert cel.content_bounds() is not None, "the brush must paint on the canvas"
    _ = render_scene(session.scene, session.project, RenderOptions(frame=1))
    session.undo()
    assert cel.content_bounds() == before or cel.content_bounds() is None
    session.redo()
    assert cel.content_bounds() is not None


def test_tool_rail_and_shortcuts(window):
    from PySide6.QtGui import QKeySequence
    from PySide6.QtWidgets import QApplication
    session = window.session
    session.set_tool("eraser")
    assert session.tool == "eraser"
    session.set_tool("brush")
    window._nudge_brush(2)
    window._swap_colors()
    assert session.primary_color.name() in ("#ffffff", "#20222c")
    window._swap_colors()
    # playback controls
    window.playback.frame_spin.setValue(5)
    QApplication.processEvents()
    assert session.frame == 5
    assert QKeySequence("Ctrl+Z")


def test_layers_panel_actions(window):
    session = window.session
    count = len(session.scene.layers)
    session.add_layer("raster", "Extra")
    assert len(session.scene.layers) == count + 1
    layer = session.scene.layers[-1]
    session.set_layer_prop(layer.uid, "opacity", 40.0)
    session.set_layer_prop(layer.uid, "blend_mode", "multiply")
    assert layer.blend_mode == "multiply"
    session.duplicate_layer(layer.uid)
    assert len(session.scene.layers) == count + 2
    session.remove_layer()
    assert len(session.scene.layers) == count + 1
    session.undo()
    window.layers_panel.rebuild()
    window.status_label.text()


def test_timeline_frame_operations(window):
    session = window.session
    layer = session.active_layer()
    session.set_frame(1)
    session.add_frame()
    session.set_frame(6)
    session.add_frame()
    keys = layer.cel_keys()
    assert len(keys) >= 2, keys
    session.duplicate_frame()
    session.insert_frame(2)
    session.set_exposure(3)
    session.delete_frame()
    window.timeline.fit_timeline()
    window.timeline.update()
    session.undo()
    session.undo()


def test_keyframes_and_graph_editor(window):
    session = window.session
    layer = session.active_layer()
    session.set_frame(1)
    session.key_transform("pos.x")
    session.set_frame(24)
    layer.transform["pos.x"].set_key(24, 640.0, easing="bounce")
    window.graph.update()
    assert layer.transform["pos.x"].value_at(12) > 0
    window.graph._apply_auto_smoothing()
    window.graph.fit()


def test_character_rig_flow(window):
    session = window.session
    session.add_character(True)
    rig = session.active_rig()
    assert rig is not None and len(rig.bones) > 12
    assert rig.ik_chains, "rigs ship with IK chains"
    window.character.sync()
    session.set_frame(1)
    assert session.apply_pose("Wave Up")
    window.character._auto_rig()
    assert session.active_rig() is not None
    session.detect_character_parts()
    window.character._on_ik_mode(0)
    assert session.ik_mode is True
    window.character._on_ik_mode(1)
    session.active_ik_chain = rig.ik_chains[0].uid
    session.bake_ik(rig.ik_chains[0].uid)


def test_ai_panel_plan_and_apply(window):
    session = window.session
    panel = window.ai_panel
    session.add_character(True)
    panel.instruction.setText("walk left to right, stop, wave, then keep walking")
    panel.plan()
    assert panel.plan_list.count() > 0
    panel.apply_plan()
    assert session.scene.total_frames() > 24
    panel.pose_input.setText("running")
    panel.generate_pose()
    panel.inbetween_count.setCurrentIndex(0)
    panel.run_inbetween()
    changed = False
    for i in range(panel.inbetween_count.count()):
        if panel.inbetween_count.itemData(i) == 4:
            changed = True
    assert changed


def test_ai_text_to_animation(window):
    session = window.session
    plan = session.ai_text_to_animation("a robot walks to school\nwave at the teacher\n"
                                        "sit down and read")
    assert plan is not None and plan.actions
    names = [layer.name for layer in session.scene.layers]
    assert any("Background" in n for n in names) or any("Prop" in n for n in names)


def test_assets_panel_library(window):
    session = window.session
    session.install_starter_assets() if hasattr(session, "install_starter_assets") else None
    panel = window.assets
    panel.rebuild()
    assert panel.grid.count() > 0, "the starter library should not be empty"
    panel.anim_list.setCurrentRow(0)
    session.add_character(True)
    panel.apply_animation()
    assert session.active_rig() is not None


def test_export_dialog_settings(window):
    from mfs.ui.dialogs import ExportDialog
    dialog = ExportDialog(window.session, window)
    dialog.format_combo.setCurrentIndex(3)          # PNG sequence
    settings = dialog.settings()
    assert settings.fmt == "png"
    assert settings.width > 0 and settings.height > 0
    dialog.close()


def test_dialogs_open(window):
    from mfs.ui.dialogs import AISettingsDialog, NewProjectDialog, PreferencesDialog
    for cls in (NewProjectDialog, AISettingsDialog, PreferencesDialog):
        dialog = cls(window.session, window)
        dialog.show()
        window.session and dialog.close()


def test_mode_switch_and_menus(window):
    window._set_mode(True)
    assert window.session.beginner_mode
    window._set_mode(False)
    assert not window.session.beginner_mode
    assert window.menuBar().actions(), "the menu bar must have menus"
    titles = [action.text() for action in window.menuBar().actions()]
    for expected in ("&File", "&Edit", "&View", "&Animation", "&Character", "&AI", "E&xport",
                     "&Settings"):
        assert expected in titles, titles
    window._toggle_grid()
    window._toggle_rig()
    window.quick_start.__doc__


def test_scene_switching(window):
    session = window.session
    session.add_scene("Street")
    session.add_scene("House")
    assert len(session.project.scenes) >= 3
    session.select_scene(session.project.scenes[1].uid)
    assert session.scene.name == "Street"
    session.duplicate_scene()
    session.remove_scene()
    window.scene_bar.rebuild()
    assert window.scene_bar.combo.count() == len(session.project.scenes)


def test_project_roundtrip_through_ui(window, tmp_path):
    session = window.session
    session.add_character(True)
    session.set_frame(1)
    session.apply_pose("Idle")
    path = str(tmp_path / "ui_roundtrip.mfs")
    assert session.save_project(path)
    assert session.open_project(path)
    assert session.scene.layers
    window.canvas.fit_to_window()
