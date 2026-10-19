"""Export engine: filter-graph structure + real FFmpeg renders."""
import json
import subprocess
from pathlib import Path

import pytest

from novacut.core.ffmpeg import find_ffmpeg, probe
from novacut.editing.operations import AddClipCommand
from novacut.models.effects import Effect, Transition
from novacut.models.enums import ClipKind, EffectType, TransitionType, TrackKind
from novacut.models.media import MediaItem
from novacut.models.project import Project
from novacut.models.timeline import Clip
from novacut.render.filtergraph import FilterGraphBuilder, atempo_chain, kf_expression
from novacut.render.presets import ExportSettings
from novacut.render.exporter import build_command, run_export, check_disk_space


@pytest.fixture
def project(qapp, media_factory):
    video = media_factory("src.mp4", duration=4.0)
    audio = media_factory("voice.wav", kind="audio", duration=4.0)
    image = media_factory("still.png", kind="image")
    proj = Project.from_preset("landscape_720", name="Export test")
    lib = {}
    for p in (video, audio, image):
        item = MediaItem.from_path(p, probe(p))
        proj.add_media(item)
        lib[p.name.split(".")[0]] = item
    tl = proj.timeline
    v1, v2 = tl.video_tracks()
    a1 = tl.audio_tracks()[0]

    c1 = Clip(kind=ClipKind.VIDEO.value, media_id=lib["src"].id, name="A",
              start=0, duration=2.0, source_in=0.0, source_duration=2.0)
    c1.effects.append(Effect(EffectType.COLOR.value, {"contrast": 0.3}))
    tl.add_clip(c1, v1.id)
    c2 = Clip(kind=ClipKind.VIDEO.value, media_id=lib["src"].id, name="B",
              start=2.0, duration=2.0, source_in=1.0, source_duration=2.0)
    c2.transition_in = Transition(TransitionType.DISSOLVE.value, 0.4, "in")
    tl.add_clip(c2, v1.id)
    title = Clip(kind=ClipKind.TITLE.value, name="T", start=0.5, duration=2.0,
                 source_duration=2.0)
    title.text_params.update({"text": "NovaCut", "font_size": 60,
                              "animation": "fade"})
    title.add_keyframe("opacity", 0.5, 1.0)
    title.add_keyframe("opacity", 2.5, 0.4)
    tl.add_clip(title, v2.id)
    img = Clip(kind=ClipKind.IMAGE.value, media_id=lib["still"].id, name="I",
               start=3.0, duration=1.0, source_in=0.0, source_duration=1.0)
    tl.add_clip(img, v2.id)
    ac = Clip(kind=ClipKind.AUDIO.value, media_id=lib["voice"].id, name="VO",
              start=0.0, duration=3.0, source_in=0.0, source_duration=3.0,
              gain=0.9, fade_in=0.3)
    ac.effects.append(Effect(EffectType.AUDIO_EQ.value, {"bass": 3}))
    tl.add_clip(ac, a1.id)
    return proj


def test_graph_structure(project):
    builder = FilterGraphBuilder(project)
    inputs, script, maps, duration = builder.build()
    assert duration == pytest.approx(4.0)
    assert "-i" in inputs
    assert "filter_complex" not in script  # script only, wrapper adds the flag
    assert "xfade=transition=dissolve" in script
    from novacut.core.ffmpeg import ffmpeg_supports_filter
    if ffmpeg_supports_filter("drawtext"):
        assert "drawtext=" in script and "NovaCut" in script
    else:
        # Fallback: titles are painted to PNG by Qt and fed as image inputs.
        assert any(str(a).endswith(".png") for a in inputs)
    assert "chromakey" not in script
    assert "amix=" in script or "aout_" in script
    assert any(m.startswith("[vfmt") for m in maps)
    # Keyframed opacity compiles to a geq alpha expression.
    assert "alpha(X,Y)*(" in script


def test_speed_chain():
    assert atempo_chain(1.0) == "atempo=1"
    parts = atempo_chain(3.0).split(",")
    assert parts[0] == "atempo=2" and parts[1].startswith("atempo=1.5")
    assert atempo_chain(0.25).count("atempo=0.5") == 2


def test_kf_expression_bounds(project):
    clip = project.timeline.all_clips()[0]
    clip.add_keyframe("scale", 0.0, 1.0)
    clip.add_keyframe("scale", 2.0, 2.0)
    expr = kf_expression(clip, "scale", 1.0)
    assert "between(t,0,2)" in expr and "lerp(1,2" in expr


def test_build_command_uses_script_file(project, tmp_path):
    settings = ExportSettings(output_path=str(tmp_path / "out.mp4"),
                              resolution_key="480p", fps=24.0)
    cmd, duration, script_path = build_command(project, settings)
    assert "-filter_complex_script" in cmd
    assert Path(script_path).exists()
    assert duration == pytest.approx(4.0)
    assert cmd[-1].endswith("out.mp4")
    assert "libx264" in cmd and "aac" in cmd


def test_full_render_mp4(project, tmp_path):
    out = tmp_path / "render.mp4"
    settings = ExportSettings(output_path=str(out), resolution_key="480p",
                              fps=24.0, crf=26, video_bitrate_k=0)
    progress = []
    report = run_export(project, settings,
                        on_progress=lambda f, s, eta: progress.append(f))
    assert report.ok, report.error
    assert out.exists() and out.stat().st_size > 1000
    meta = probe(str(out))
    assert meta.has_video and meta.has_audio
    assert meta.width == 854 and meta.height == 480
    assert abs(meta.duration - 4.0) < 1.0
    assert progress and max(progress) >= 0.9


def test_render_with_effects_and_chroma(project, tmp_path, media_factory):
    greenscreen = media_factory("gs.mp4", duration=2.0)
    item = MediaItem.from_path(greenscreen, probe(greenscreen))
    project.add_media(item)
    clip = Clip(kind=ClipKind.VIDEO.value, media_id=item.id, start=0,
                duration=2.0, source_in=0.0, source_duration=2.0)
    clip.effects.append(Effect(EffectType.CHROMA_KEY.value,
                               {"color": "#00ff00", "similarity": 0.3, "blend": 0.1}))
    clip.effects.append(Effect(EffectType.BLUR.value, {"radius": 4.0}))
    clip.crop_left = clip.crop_top = 0.1
    project.timeline.add_clip(clip, project.timeline.video_tracks()[1].id,
                              allow_overlap=True)
    settings = ExportSettings(output_path=str(tmp_path / "fx.mp4"),
                              resolution_key="480p", fps=24.0, crf=28)
    report = run_export(project, settings)
    assert report.ok, report.error


def test_cancel_export(project, tmp_path):
    out = tmp_path / "cancel.mp4"
    settings = ExportSettings(output_path=str(out), resolution_key="480p",
                              fps=24.0)
    report = run_export(project, settings, should_cancel=lambda: True)
    assert report.cancelled and not report.ok
    assert not out.exists()


def test_missing_media_raises(project, tmp_path):
    for item in project.media.values():
        Path(item.path).unlink(missing_ok=True)
        item.missing = True
    settings = ExportSettings(output_path=str(tmp_path / "x.mp4"))
    with pytest.raises(Exception):
        run_export(project, settings)


def test_empty_timeline_raises(tmp_path):
    proj = Project.from_preset("landscape_720")
    for t in list(proj.timeline.tracks):
        proj.timeline.remove_track(t.id)
    settings = ExportSettings(output_path=str(tmp_path / "x.mp4"))
    with pytest.raises(ValueError):
        build_command(proj, settings)


def test_disk_space_check(tmp_path):
    ok, free, needed = check_disk_space(str(tmp_path), 1)
    assert ok and free > 0
    ok, _, _ = check_disk_space(str(tmp_path), 10 ** 15)
    assert not ok


def test_export_settings_validation(tmp_path):
    s = ExportSettings(output_path="")
    assert s.validate()
    s.output_path = str(tmp_path / "a.mkv")
    s.container = ".mp4"
    assert any("extension" in p for p in s.validate())

