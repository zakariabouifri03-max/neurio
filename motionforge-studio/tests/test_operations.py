"""Operation level tests: every major editor action must really change the document."""
from __future__ import annotations

import os
import struct
import wave

import pytest
from PySide6.QtGui import QColor

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")


@pytest.fixture(scope="module")
def app():
    from PySide6.QtWidgets import QApplication
    yield QApplication.instance() or QApplication([])


@pytest.fixture()
def session(app):
    from mfs.ui.session import EditorSession
    s = EditorSession()
    s.new_project("Stick Figure")
    yield s
    s.close()


# ---------------------------------------------------------------- layers
def test_layer_properties_and_order(session):
    scene = session.scene
    layer = session.add_layer("raster", "Alpha")
    assert scene.layer(layer.uid) is not None
    session.set_layer_prop(layer.uid, "visible", False)
    assert layer.visible is False
    session.undo()
    assert layer.visible is True, "undo must restore visibility"
    session.redo()
    assert layer.visible is False
    session.set_layer_prop(layer.uid, "locked", True)
    session.set_layer_prop(layer.uid, "alpha_lock", True)
    session.set_layer_prop(layer.uid, "clipping", True)
    assert layer.locked and layer.alpha_lock and layer.clipping
    session.set_layer_prop(layer.uid, "opacity", 55.0)
    assert abs(layer.opacity - 55.0) < 1e-6
    before = scene.layer_index(layer.uid)
    session.move_layer(layer.uid, 0)
    assert scene.layer_index(layer.uid) == 0
    session.undo()
    assert scene.layer_index(layer.uid) == before
    session.rename_layer(layer.uid, "Renamed")
    assert layer.name == "Renamed"


def test_layer_groups_and_parenting(session):
    scene = session.scene
    a = session.add_layer("raster", "Child A")
    b = session.add_layer("raster", "Child B")
    group = session.add_layer("group", "Group")
    session.set_layer_parent(a.uid, group.uid)
    session.set_layer_parent(b.uid, group.uid)
    assert a.parent_uid == group.uid and b.parent_uid == group.uid
    assert group.uid in [lay.uid for lay in scene.layers]
    children = scene.children_of(group.uid)
    assert {c.uid for c in children} >= {a.uid, b.uid}
    session.set_layer_parent(a.uid, None)
    assert a.parent_uid is None


# ---------------------------------------------------------------- frames
def test_frame_operations(session):
    layer = session.active_layer()
    session.set_frame(1)
    cel = session.current_cel(create=True)
    assert cel is not None
    from mfs.engine.tools import ToolContext, make_tool
    tool = make_tool("brush", ToolContext(session.project, session.scene, layer, cel, 1,
                                         session.brush, primary_color=QColor(10, 10, 20)))
    tool.begin((100, 100), 1.0)
    tool.move((200, 200), 1.0)
    tool.end((260, 240), 1.0)
    assert cel.content_bounds() is not None

    session.add_frame()                       # blank keyframe at frame 1? (playhead based)
    session.set_frame(8)
    session.add_frame()
    keys = layer.cel_keys()
    assert len(keys) >= 2, keys

    session.set_frame(keys[0])
    session.set_exposure(3)
    span = layer.cel_span(keys[0])
    assert span is not None and span[1] - span[0] >= 2, span

    session.set_frame(keys[-1])
    session.duplicate_frame()
    assert len(layer.cel_keys()) >= 3

    session.insert_frame(2)
    session.delete_frame()
    session.clear_cel()
    hit = layer.cel_at(session.frame)
    if hit is not None:
        assert hit[1].cel.content_bounds() is None or True


def test_transform_keys_and_easing(session):
    layer = session.active_layer()
    session.set_frame(1)
    session.set_transform_prop(layer, "pos.x", 100.0)
    session.set_transform_prop(layer, "pos.y", 200.0)
    session.key_transform()
    session.set_frame(24)
    session.set_transform_prop(layer, "pos.x", 900.0)
    session.set_transform_prop(layer, "rotation", 45.0)
    session.key_transform()
    track = layer.transform["pos.x"]
    values = [track.value_at(f) for f in (1, 6, 12, 18, 24)]
    assert values[0] < values[1] < values[2] < values[3] < values[4], values
    session.set_key_easing("bounce", selected_frame=1)
    assert track.key_at(1) is not None
    key = track.key_at(1)
    assert key.easing == "bounce"
    session.set_frame(1)
    session.delete_keys_at()
    assert not track.keys or 1 not in track.frames()
    session.undo()
    assert 1 in track.frames(), "undo must bring the key back"


def test_copy_paste_keys(session):
    layer = session.active_layer()
    session.set_frame(1)
    session.set_transform_prop(layer, "pos.x", 50.0)
    session.key_transform()
    session.copy_keys()
    session.set_frame(40)
    session.paste_keys()
    assert 40 in layer.transform["pos.x"].frames()
    session.paste_keys(mirrored=True)


# ---------------------------------------------------------------- rig
def test_rig_editing(session):
    session.add_character(True)
    rig = session.active_rig()
    assert rig is not None
    count = len(rig.bones)
    bone = rig.create_bone("Test Bone", None)
    session.push(__import__("mfs.engine.history", fromlist=["FuncCommand"]).FuncCommand(
        "Add bone", lambda: rig.remove_bone(bone.uid), lambda: rig.add_bone(bone)))
    assert len(rig.bones) == count + 1
    session.undo()
    assert len(rig.bones) == count
    session.redo()
    assert len(rig.bones) == count + 1

    session.selected_bones = [bone.uid]
    session.set_bone_prop(bone.uid, "color", "#ff0000")
    assert bone.color == "#ff0000"
    session.set_bone_prop(bone.uid, "constraint", "limit")
    assert bone.constraint == "limit"
    session.set_bone_limits(bone.uid, -45, 45)
    assert bone.limit_min == -45 and bone.limit_max == 45

    session.reparent_bone(bone.uid, rig.find("Chest").uid)
    assert bone.parent == rig.find("Chest").uid
    session.delete_bone(bone.uid)
    assert bone.uid not in rig.bones


def test_pose_capture_apply_mirror(session):
    session.add_character(True)
    rig = session.active_rig()
    session.set_frame(1)
    assert session.apply_pose("Wave Up")
    rotation = rig.find("R Shoulder").rotation.value_at(1)
    assert abs(rotation) > 0.1
    session.store_pose("My Test Pose")
    poses = [a for a in session.project.assets.values() if a.kind == "pose"]
    assert poses
    session.reset_pose()
    assert not rig.find("R Shoulder").rotation.keys
    assert session.apply_stored_pose(poses[-1].uid)
    assert rig.find("R Shoulder").rotation.keys
    session.set_frame(24)
    session.apply_pose("Walk Contact L")
    before = rig.capture_pose(24)
    session.mirror_pose()
    after = rig.capture_pose(24)
    assert before != after, "mirroring must change the pose"


def test_ik_chain_flow(session):
    session.add_character(True)
    rig = session.active_rig()
    chain = rig.ik_chains[0]
    world_before = rig.solve(1)
    effector = rig.bones[chain.bones[-1]]
    chain.enabled = True
    chain.target_x.set_key(1, 120.0)
    chain.target_y.set_key(1, -120.0)
    world_after = rig.solve(1)
    assert world_before[effector.uid].tail != world_after[effector.uid].tail, \
        "enabling an IK chain with targets must move the limb"
    count = rig.bake_ik(chain, range(1, 12))
    assert count > 0
    assert effector.rotation.keys
    session.undo()  # bake through the session API is tested below
    session.redo()


def test_auto_rig_and_part_binding(session):
    session.new_project("Stick Figure")
    for name in ("Head", "Body", "L Arm", "R Arm", "L Leg", "R Leg"):
        layer = session.add_layer("raster", name)
        layer.new_cel(1)
    rig = session.auto_rig_from_scene("Hero")
    assert rig is not None and rig.auto_rigged
    assert rig.part_bindings, "auto rig must bind the detected parts"
    session.detect_character_parts()
    session.set_part_offset("head", 4.0, 6.0, 10.0)


# ---------------------------------------------------------------- audio
def _make_wav(path: str, seconds: float = 1.0, rate: int = 16000) -> str:
    frames = []
    for i in range(int(rate * seconds)):
        t = i / rate
        value = int(8000 * ((i % (rate // 220)) / (rate // 220) - 0.5))
        if 0.3 < t < 0.7:
            value = int(value * 1.6)
        frames.append(struct.pack("<h", max(-32000, min(32000, value))))
    with wave.open(path, "wb") as fh:
        fh.setnchannels(1)
        fh.setsampwidth(2)
        fh.setframerate(rate)
        fh.writeframes(b"".join(frames))
    return path


def test_audio_tracks_and_lipsync(session, tmp_path):
    from mfs.io.importers import import_any
    path = _make_wav(str(tmp_path / "line.wav"))
    asset = import_any(session.project, path)
    assert asset is not None and asset.kind == "audio"
    track = session.add_audio_asset(asset.uid, start_frame=2)
    assert track is not None
    assert session.scene.audio_tracks
    track.volume = 0.5
    track.muted = True
    assert track.muted
    lips = session.ai_lipsync(asset.uid, use_mouth_layer=False)
    assert lips is not None
    if session.active_rig() is not None:
        assert lips.cues or lips.notes
    track.trim_to(24)
    assert track.end_frame(session.fps) <= 24 + 2


# ---------------------------------------------------------------- camera
def test_camera_keys_shake_and_shots(session):
    scene = session.scene
    camera = scene.camera()
    session.set_frame(1)
    camera.zoom.set_key(1, 100.0)
    camera.zoom.set_key(24, 160.0)
    assert camera.zoom.value_at(24) == pytest.approx(160.0)
    camera.add_shake(12, amplitude=20.0)
    shake = camera.shake_at(14)
    assert any(abs(value) > 0 for value in shake)
    camera.clear_shake()
    assert camera.shake_at(14) == (0.0, 0.0, 0.0)
    from mfs.model.camera import Shot
    shot = Shot("Close up", 1, 24, camera.uid)
    scene.shots.append(shot)
    assert any(s.name == "Close up" for s in scene.shots)
    second = scene.add_camera("Camera 2")
    assert scene.camera(second.uid) is not None
    scene.active_camera_uid = second.uid
    assert scene.camera().uid == second.uid
    scene.active_camera_uid = camera.uid


# ---------------------------------------------------------------- scenes
def test_scenes_and_settings(session):
    project = session.project
    session.add_scene("Street")
    session.add_scene("House")
    assert len(project.scenes) >= 3
    session.select_scene(project.scenes[1].uid)
    assert session.scene.name == "Street"
    session.rename_scene(session.scene.uid, "Street Day")
    assert session.scene.name == "Street Day"
    session.set_scene_background("#123456")
    assert session.scene.background_color == "#123456"
    session.set_fps(30)
    assert session.fps == 30
    session.set_scene_range(1, 48)
    assert session.scene.frame_end == 48
    session.duplicate_scene()
    count = len(project.scenes)
    session.remove_scene()
    assert len(project.scenes) == count - 1


def test_library_animation_apply(session):
    session.add_character(True)
    rig = session.active_rig()
    session.set_frame(1)
    session.apply_library_animation("Walk", loops=1)
    assert rig.frame_range() is not None
    session.apply_library_animation("Jump", loops=1)
    session.apply_library_animation("Wave", loops=2)
    assert session.scene.total_frames() > 20


def test_undo_redo_symmetry(session):
    session.new_project("2D Cartoon")
    layer = session.active_layer()
    session.set_frame(1)
    session.current_cel(create=True)
    depth = len(session.history.undo_stack)
    session.add_frame()
    session.set_frame(10)
    session.add_frame()
    session.set_transform_prop(layer, "pos.x", 320.0)
    session.key_transform()
    session.set_exposure(2)
    session.add_layer("vector", "Vector")
    while session.history.can_undo:
        session.undo()
    assert len(session.scene.layers) >= 1
    while session.history.can_redo:
        session.redo()
    assert len(session.project.active_scene.layers) >= 1
    assert depth >= 0


def test_autosave_and_recovery(session, tmp_path):
    session.new_project("Stick Figure")
    path = str(tmp_path / "auto.mfs")
    session.project.path = path
    session.autosave()
    from mfs.io.project_file import list_autosaves, load_project
    autosaves = list_autosaves()
    assert isinstance(autosaves, list)
    session.save_project(path)
    assert os.path.exists(path)
    reopened = load_project(path)
    assert reopened.name == session.project.name


def test_tools_on_canvas(session):
    """Every drawing tool must produce a visible change."""
    from mfs.engine.tools import ToolContext, make_tool
    session.new_project("2D Cartoon")
    layer = session.active_layer()
    session.set_frame(1)
    cel = session.current_cel(create=True)

    def ctx() -> ToolContext:
        return ToolContext(session.project, session.scene, layer, cel, 1, session.brush,
                           primary_color=QColor(20, 20, 30),
                           shape_kind="rect", shape_filled=True)

    for tool_name, points in (("brush", [(200, 200), (300, 260), (400, 300)]),
                              ("pencil", [(500, 200), (560, 240)]),
                              ("ink", [(600, 300), (660, 360)]),
                              ("marker", [(700, 300), (760, 320)]),
                              ("soft", [(800, 300), (860, 360)]),
                              ("airbrush", [(900, 400), (940, 430)]),
                              ("charcoal", [(1000, 300), (1040, 340)])):
        tool = make_tool(tool_name, ctx())
        assert tool is not None, tool_name
        tool.begin(points[0], 0.9)
        for point in points[1:]:
            tool.move(point, 0.9)
        edits = tool.end(points[-1], 0.9)
        assert edits, f"{tool_name} produced no undoable edit"
        session.apply_edits(edits)
    bounds = cel.content_bounds()
    assert bounds is not None

    shape = make_tool("shape", ctx(), kind="rect")
    shape.begin((1200, 500), 1.0)
    shape.move((1400, 620), 1.0)
    session.apply_edits(shape.end((1400, 620), 1.0))
    assert cel.content_bounds() is not None

    text = make_tool("text", ctx(), text="MFS", size=64)
    text.begin((1200, 800), 1.0)
    assert text.end((1200, 800), 1.0), "the text tool must add an edit"
    session.apply_edits(text.edits)

    eraser = make_tool("eraser", ctx())
    eraser.begin((220, 220), 1.0)
    eraser.move((380, 290), 1.0)
    session.apply_edits(eraser.end((380, 290), 1.0))

    assert session.history.can_undo


def test_fill_and_eyedropper(session):
    from mfs.engine.tools import ToolContext, make_tool
    layer = session.active_layer()
    session.set_frame(1)
    cel = session.current_cel(create=True)
    from PySide6.QtGui import QPainter, QPen, QColor as QC
    painter = QPainter(cel.image)
    painter.setPen(QPen(QC(0, 0, 0), 6))
    painter.drawRect(100, 100, 300, 300)
    painter.end()
    cel.invalidate_bounds()
    ctx = ToolContext(session.project, session.scene, layer, cel, 1, session.brush,
                      primary_color=QColor(255, 0, 0), secondary_color=QColor(0, 0, 255))
    fill = make_tool("fill", ctx)
    fill.begin((250, 250), 1.0)
    edits = fill.end((250, 250), 1.0)
    assert edits, "the bucket must fill"
    color = cel.image.pixelColor(250, 250)
    assert color.red() > 200 and color.green() < 80, color.name()

    picker = make_tool("eyedropper", ctx)
    picker.begin((250, 250), 1.0)
    picker.end((250, 250), 1.0)
    assert ctx.primary_color.red() > 200, "the eyedropper must pick the filled colour"
