from pathlib import Path
import json

import pytest

from novacut.models import MediaAsset, Project
from novacut.project import ProjectFormatError, load_project, save_project
from novacut.timeline import TimelineOperations


def make_project(tmp_path: Path) -> Project:
    media_file = tmp_path / "scene.mp4"
    media_file.write_bytes(b"local-media-placeholder")
    project = Project.create("Unit test")
    project.media["media-1"] = MediaAsset(
        id="media-1", path=str(media_file), name=media_file.name, kind="video",
        duration=12.0, width=1920, height=1080, fps=30.0, has_video=True,
    )
    clip = TimelineOperations.add_media_clip(project, "media-1", project.tracks[2].id, start=1.25)
    clip.source_in = 1.0
    clip.source_out = 7.0
    project.dirty = True
    return project


def test_project_round_trip_and_portable_relative_media_reference(tmp_path):
    project = make_project(tmp_path)
    project_file = tmp_path / "edit.novacut"
    save_project(project, project_file)

    loaded, warnings = load_project(project_file)
    assert not warnings
    assert loaded.path == str(project_file.resolve())
    assert loaded.width == 1920
    assert loaded.clips[0].source_in == 1.0
    assert loaded.clips[0].end == pytest.approx(7.25)
    assert Path(loaded.media["media-1"].path).name == "scene.mp4"
    document = json.loads(project_file.read_text(encoding="utf-8"))
    assert document["format"] == "novacut-project"
    assert document["schema_version"] == 1
    assert document["project"]["media"]["media-1"]["relative_path"] == "scene.mp4"


def test_missing_media_is_reported_without_discarding_project(tmp_path):
    project = make_project(tmp_path)
    project_file = tmp_path / "edit.novacut"
    save_project(project, project_file)
    (tmp_path / "scene.mp4").unlink()

    loaded, warnings = load_project(project_file)
    assert len(loaded.clips) == 1
    assert warnings and "scene.mp4" in warnings[0]


def test_invalid_project_and_newer_schema_are_errors(tmp_path):
    invalid = tmp_path / "bad.novacut"
    invalid.write_text("not json", encoding="utf-8")
    with pytest.raises(ProjectFormatError):
        load_project(invalid)

    invalid.write_text(json.dumps({
        "format": "novacut-project", "schema_version": 88, "project": {},
    }), encoding="utf-8")
    with pytest.raises(ProjectFormatError, match="newer"):
        load_project(invalid)


def test_atomic_project_save_keeps_old_file_if_serialization_fails(tmp_path):
    project = Project.create()
    project_file = tmp_path / "safe.novacut"
    project_file.write_text("previous", encoding="utf-8")
    project.fps = float("nan")
    with pytest.raises(ValueError):
        save_project(project, project_file)
    assert project_file.read_text(encoding="utf-8") == "previous"
    assert not list(tmp_path.glob("*.tmp"))
