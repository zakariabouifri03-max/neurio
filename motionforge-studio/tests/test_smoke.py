"""End to end smoke test: project -> draw -> frames -> animate -> play -> save -> export."""
from __future__ import annotations

import os
import struct
import tempfile
import wave

import pytest
from PySide6.QtGui import QColor

os.environ.setdefault("QT_QPA_PLATFORM", "offscreen")


@pytest.fixture(scope="session")
def qt_app():
    from PySide6.QtWidgets import QApplication
    app = QApplication.instance() or QApplication([])
    yield app


def test_model_and_tools(qt_app):
    from mfs.ai.library import build_template
    from mfs.engine.tools import ToolContext, make_tool
    from mfs.model.cel import BrushSettings

    project = build_template("Stick Figure")
    scene = project.active_scene
    layer = scene.new_layer("Test", "raster")
    cel = layer.new_cel(1)
    brush = BrushSettings(size=24, hardness=0.8)
    tool = make_tool("brush", ToolContext(project, scene, layer, cel, 1, brush,
                                                primary_color=QColor(20, 20, 30)))
    tool.begin((200, 200), 0.7)
    tool.move((320, 260), 1.0)
    edits = tool.end((420, 300), 0.6)
    assert edits, "a brush stroke must produce at least one undoable edit"
    bounds = cel.content_bounds()
    assert bounds is not None and bounds.width() > 50
    edits[0].undo()
    assert cel.content_bounds() is None, "undo must clear the stroke"
    edits[0].redo()
    assert cel.content_bounds() is not None, "redo must restore the stroke"


def test_frames_and_keyframes(qt_app):
    from mfs.ui.session import EditorSession

    session = EditorSession()
    session.new_project("2D Cartoon")
    layer = session.active_layer()
    layer.new_cel(1)
    session.set_frame(1)
    session.set_transform_prop(layer, "pos.x", 100.0)
    session.key_transform()
    session.set_frame(24)
    layer.transform["pos.x"].set_key(24, 800.0, easing="ease_in_out")
    assert layer.transform["pos.x"].value_at(12) > 100
    session.add_frame()
    assert layer.keys_count() if hasattr(layer, "keys_count") else len(layer.cel_keys()) >= 1
    session.undo()
    session.redo()


def test_player_and_range(qt_app):
    from mfs.engine.player import Player

    player = Player()
    player.set_range(1, 48)
    player.set_fps(24)
    player.seek(10)
    assert player.frame == 10
    player.step(1)
    assert player.frame == 11
    player.play()
    assert player.playing
    player.pause()
    assert not player.playing


def test_rig_ik_and_pose(qt_app):
    from mfs.model.document import new_stick_rig

    rig = new_stick_rig("Rig", 400, (0, 0))
    assert len(rig.bones) >= 15
    chain = rig.add_ik_chain("R Shoulder", "R Elbow", "R Hand")
    assert chain is not None
    chain.target_x.set_key(1, 0.0)
    chain.target_y.set_key(1, 0.0)
    chain.target_x.set_key(24, 200.0)
    chain.target_y.set_key(24, -160.0)
    worlds_a = rig.solve(1)
    worlds_b = rig.solve(24)
    effector = rig.find("R Hand")
    assert worlds_a[effector.uid].tail != worlds_b[effector.uid].tail
    rig.bake_ik(chain, range(1, 13))
    assert effector.rotation.keys, "baking IK must create rotation keys"


def test_ai_director_walk_wave(qt_app):
    from mfs.ai.assistant import OfflineDirector

    director = OfflineDirector(fps=24, scene_size=(1920, 1080), has_rig=True)
    plan = director.plan("walk left to right, stop, wave, then keep walking")
    assert plan.actions, "the director must produce actions"
    kinds = {a.kind for a in plan.actions}
    assert "walk" in kinds and "wave" in kinds

    plan = director.plan("jump")
    kinds = {a.kind for a in plan.actions}
    assert {"jump_anticipation", "jump_air", "jump_land"} & kinds

    plan = director.plan("run for 3 seconds")
    assert plan.actions

    plan = director.plan("wave with the right hand")
    assert any(a.kind == "wave" for a in plan.actions)

    plan = director.plan("text to animation about a robot walking to school")
    assert any(a.kind in ("walk", "add_character", "background", "scene") for a in plan.actions)


def test_ai_apply_and_inbetween(qt_app):
    from mfs.ui.session import EditorSession

    session = EditorSession()
    session.new_project("Stick Figure")
    layer = session.active_layer()
    cel_a = layer.new_cel(1)
    from mfs.engine.tools import ToolContext, make_tool
    tool = make_tool("brush", ToolContext(session.project, session.scene, layer, cel_a, 1,
                                          session.brush, primary_color=QColor(20, 20, 30)))
    tool.begin((400, 300), 1.0)
    tool.move((600, 300), 1.0)
    tool.end((700, 320), 1.0)
    layer.new_cel(12)
    session.ai_inbetween(4, layer=layer, frame_a=1, frame_b=12)
    assert len(layer.cel_keys()) >= 3, "auto inbetween must insert cels"

    session.add_character(rigged=True)
    rig = session.active_rig()
    assert rig is not None
    session.set_frame(1)
    session.apply_pose("Walk Contact L")
    session.set_frame(24)
    session.apply_pose("Walk Contact R")
    session.ai_generate_motion(rig, "Idle", "Wave Up", 24, 48, steps=8)
    assert rig.frame_range() is not None


def test_lipsync_from_wav(qt_app, tmp_path):
    from mfs.ai.lipsync import MOUTH_BONE_NAMES, VISEME_LABELS, LipSyncAnalyzer
    from mfs.model.document import Project

    sample_rate = 16000
    path = tmp_path / "speech.wav"
    frames = []
    for i in range(int(sample_rate * 1.5)):
        t = i / sample_rate
        segment = int(t * 4) % 3
        freq = (140, 900, 320)[segment]
        value = int(6000 * ((i % (sample_rate // freq)) / (sample_rate // freq) - 0.5))
        frames.append(struct.pack("<h", max(-32000, min(32000, value))))
    with wave.open(str(path), "wb") as fh:
        fh.setnchannels(1)
        fh.setsampwidth(2)
        fh.setframerate(sample_rate)
        fh.writeframes(b"".join(frames))

    project = Project("Lip")
    from mfs.io.importers import import_any
    asset = import_any(project, str(path))
    assert asset is not None
    analyzer = LipSyncAnalyzer(fps=24)
    track = analyzer.analyze(project, asset, start_frame=1)
    assert track.cues, "lip sync must detect cues from speech-like audio"
    assert all(cue.label in VISEME_LABELS for cue in track.cues)
    assert MOUTH_BONE_NAMES


def test_project_save_reopen(qt_app, tmp_path):
    from mfs.ui.session import EditorSession

    session = EditorSession()
    session.new_project("Anime-style 2D")
    layer = session.active_layer()
    layer.new_cel(1)
    session.set_transform_prop(layer, "pos.x", 120.0)
    session.key_transform()
    session.add_character(rigged=True)
    rig = session.active_rig()
    session.set_frame(1)
    session.apply_pose("Idle")
    scene_name = session.scene.name
    before_layers = len(session.scene.layers)
    before_bones = len(rig.bones)

    path = str(tmp_path / "demo.mfs")
    assert session.save_project(path)
    assert os.path.exists(path)

    other = EditorSession()
    assert other.open_project(path)
    assert other.scene.name == scene_name
    assert len(other.scene.layers) == before_layers
    reopened_rigs = list(other.scene.rigs.values())
    assert reopened_rigs and len(reopened_rigs[0].bones) == before_bones
    assert other.scene.layer(layer.uid) is not None


def test_export_mp4_or_png_sequence(qt_app, tmp_path):
    from mfs.engine.exporter import ExportSettings, export_frames_sync, have_encoder
    from mfs.ui.session import EditorSession

    session = EditorSession()
    session.new_project("Motion Graphics")
    layer = session.active_layer()
    cel = layer.new_cel(1)
    from mfs.engine.tools import ToolContext, make_tool
    tool = make_tool("brush", ToolContext(session.project, session.scene, layer, cel, 1,
                                          session.brush, primary_color=QColor(200, 40, 60)))
    tool.begin((300, 200), 1.0)
    tool.move((800, 600), 1.0)
    tool.end((1200, 700), 1.0)
    session.key_transform()
    session.set_frame(12)
    session.set_transform_prop(layer, "pos.x", 300.0)
    session.key_transform()
    session.scene.frame_end = 12

    out_dir = tmp_path / "frames"
    settings = ExportSettings(path=str(out_dir), fmt="png", width=480, height=270,
                              fps=12, frame_start=1, frame_end=12)
    frames = export_frames_sync(session.project, settings)
    assert frames >= 12
    assert len([n for n in os.listdir(out_dir) if n.endswith(".png")]) >= 12

    if have_encoder():
        video = tmp_path / "clip.mp4"
        settings = ExportSettings(path=str(video), fmt="mp4", width=480, height=270,
                                  fps=12, frame_start=1, frame_end=12)
        export_frames_sync(session.project, settings)
        assert video.exists() and video.stat().st_size > 1000


def test_library_animations_and_templates(qt_app):
    from mfs.ai.library import ANIMATION_LIBRARY, TEMPLATES, apply_animation, build_template
    from mfs.model.document import new_stick_rig
    from mfs.model.scene import Scene

    names = {a.name for a in ANIMATION_LIBRARY}
    for required in ("Walk", "Run", "Jump", "Idle", "Wave", "Sit", "Dance", "Talk", "Point"):
        assert required in names, required
    assert len(TEMPLATES) >= 6

    for key in ("2D Cartoon", "Anime-style 2D", "Stick Figure", "Motion Graphics",
                "Explainer Video", "Character Animation", "Social Media Animation"):
        project = build_template(key)
        assert project.active_scene.layers, key

    scene = Scene("S")
    rig = new_stick_rig("R", 400, (0, 0))
    layer = scene.attach_rig_layer(rig, "R")
    animation = next(a for a in ANIMATION_LIBRARY if a.name == "Walk")
    apply_animation(animation, layer, scene, None, start_frame=1, fps=24)
    assert rig.frame_range() is not None


def test_artgen_and_assets(qt_app):
    from mfs.engine import artgen
    from mfs.model.document import Project

    project = Project("Art")
    assert artgen.PALETTES
    character = artgen.cartoon_character(700)
    assert character and all(part.image is not None and not part.image.isNull()
                             for part in character.values())
    assert artgen.stick_figure(420) is not None
    assert artgen.mouth_shapes()
    assert artgen.eye_shapes()
    for kind in ("classroom", "street", "bedroom"):
        assert artgen.background(kind, (640, 360)) is not None
    assert artgen.prop("Chair") is not None
    assert artgen.title_card("Hello", (640, 360)) is not None
