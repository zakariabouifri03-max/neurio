"""Project serialization: schema roundtrip, portable refs, autosave, errors."""
import json
import zipfile
from pathlib import Path

import pytest

from novacut.models.effects import Effect, Transition
from novacut.models.enums import ClipKind, EffectType, TrackKind
from novacut.models.media import MediaItem
from novacut.models.project import Project
from novacut.models.serialize import (save_project, load_project,
                                      ProjectLoadError, export_json)
from novacut.models.timeline import Clip


def _make_project(media_path: Path | None = None) -> Project:
    project = Project.from_preset("vertical_1080", name="Demo")
    if media_path:
        item = MediaItem.from_path(media_path)
        item.duration, item.width, item.height, item.fps = 8.0, 640, 360, 30.0
        item.has_video = item.has_audio = True
        project.add_media(item)
        tl = project.timeline
        v = tl.video_tracks()[0]
        clip = Clip(kind=ClipKind.VIDEO.value, media_id=item.id, name="A",
                    start=0.0, duration=3.0, source_in=0.0, source_duration=3.0)
        clip.effects.append(Effect(EffectType.COLOR.value,
                                   {"contrast": 0.2, "exposure": 0.1}))
        clip.transition_in = Transition("dissolve", 0.4, "in")
        clip.add_keyframe("opacity", 0.0, 1.0)
        clip.add_keyframe("opacity", 3.0, 0.0)
        tl.add_clip(clip, v.id)
        a = tl.audio_tracks()[0]
        aclip = Clip(kind=ClipKind.AUDIO.value, media_id=item.id, name="A-audio",
                     start=0.0, duration=3.0, source_in=0.0, source_duration=3.0,
                     gain=0.8)
        tl.add_clip(aclip, a.id)
    tl = project.timeline
    tl.add_marker(1.0, "cut point")
    title = Clip(kind=ClipKind.TITLE.value, name="Hello", start=3.0,
                 duration=2.0, source_duration=2.0)
    title.text_params["text"] = "NovaCut"
    tl.add_clip(title, tl.video_tracks()[0].id)
    return project


def test_full_roundtrip(tmp_path, media_factory):
    video = media_factory("clip_a.mp4")
    project = _make_project(video)
    out = save_project(project, tmp_path / "demo.novacut", bundle_media=True)
    assert out.exists() and zipfile.is_zipfile(out)

    with zipfile.ZipFile(out) as zf:
        names = zf.namelist()
        assert "project.json" in names and "manifest.json" in names
        assert any(n.startswith("media/") for n in names)
        manifest = json.loads(zf.read("manifest.json"))
        assert manifest["format_version"] >= 1

    loaded = load_project(out)
    assert loaded.settings.width == 1080 and loaded.settings.height == 1920
    assert len(loaded.timeline.all_clips()) == 3
    vclip = next(c for c in loaded.timeline.all_clips() if c.kind == "video")
    assert vclip.effects[0].get("contrast") == pytest.approx(0.2)
    assert vclip.transition_in.duration == pytest.approx(0.4)
    assert len(vclip.keyframes) == 2
    assert loaded.timeline.markers[0].label == "cut point"
    assert not loaded.dirty
    # Bundled media was extracted next to the project.
    used = loaded.media_used_by_timeline()
    for mid in used:
        assert Path(loaded.media[mid].path).exists()
        assert not loaded.media[mid].missing


def test_portable_reference_after_move(tmp_path, media_factory):
    video = media_factory("clip_b.mp4")
    folder_a, folder_b = tmp_path / "a", tmp_path / "b"
    folder_a.mkdir()
    # Place media next to the project so the reference is relative.
    local_media = folder_a / video.name
    local_media.write_bytes(video.read_bytes())
    project = _make_project(local_media)
    saved = save_project(project, folder_a / "p.novacut")

    folder_b.mkdir()
    moved_proj = folder_b / "p.novacut"
    moved_media = folder_b / video.name
    moved_media.write_bytes(local_media.read_bytes())
    moved_proj.write_bytes(saved.read_bytes())

    loaded = load_project(moved_proj)
    item = next(iter(loaded.media.values()))
    assert not item.missing
    assert Path(item.path).name == video.name


def test_missing_media_is_flagged(tmp_path, media_factory):
    video = media_factory("clip_c.mp4")
    project = _make_project(video)
    saved = save_project(project, tmp_path / "p.novacut")
    video.unlink()  # simulate an offline drive
    loaded = load_project(saved)
    assert all(item.missing for item in loaded.media.values())


def test_corrupt_archive_raises(tmp_path):
    bad = tmp_path / "broken.novacut"
    bad.write_text("this is not a zip")
    with pytest.raises(ProjectLoadError):
        load_project(bad)


def test_json_export_and_reimport(tmp_path, media_factory):
    project = _make_project(media_factory("clip_d.mp4"))
    js = export_json(project, tmp_path / "doc.json")
    data = json.loads(js.read_text())
    assert data["settings"]["fps"] == 30.0
    rebuilt = Project.from_dict(data)
    assert len(rebuilt.timeline.all_clips()) == len(project.timeline.all_clips())


def test_unknown_future_version_rejected():
    project = Project.from_preset()
    d = project.to_dict()
    d["format_version"] = 999
    with pytest.raises(ValueError):
        Project.from_dict(d)
