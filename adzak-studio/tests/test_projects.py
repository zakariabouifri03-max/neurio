import json

import pytest

from adzak.core.projects import (Project, ProjectManager, ProjectStore,
                                  default_project_state, safe_name)


@pytest.fixture()
def manager(tmp_home):
    store = ProjectStore(tmp_home / "projects.sqlite3")
    return ProjectManager(store, base_dir=tmp_home / "projects")


def test_safe_name():
    assert safe_name("my/cool:proj??") == "mycoolproj"
    assert safe_name("   ") == "Untitled"


def test_create_open_save_roundtrip(manager):
    proj = manager.create("Demo Video", "video", 1280, 720, 24.0)
    assert proj.project_file.is_file()
    assert proj.meta.kind == "video"
    assert proj.state["settings"]["width"] == 1280

    reopened = manager.open(proj.root)
    assert reopened.meta.name == "Demo Video"
    assert reopened.state["settings"]["fps"] == 24.0

    reopened.state["timeline"]["tracks"].append({"kind": "video", "clips": []})
    reopened.dirty = True
    reopened.save()
    again = manager.open(proj.root)
    assert len(again.state["timeline"]["tracks"]) == 1


def test_recent_listing_and_delete(manager):
    p1 = manager.create("A", "photo")
    p2 = manager.create("B", "video")
    recents = manager.store.list_recent()
    assert [m.name for m in recents[:2]] == ["B", "A"]
    manager.delete(p2.meta, delete_files=True)
    assert "B" not in [m.name for m in manager.store.list_recent()]
    assert not (p2.root).exists()


def test_autosave_and_recovery(manager):
    proj = manager.create("Crashy", "video")
    proj.state["marker"] = "before-crash"
    snap = proj.autosave()
    assert snap.is_file()

    recovered = manager.recover(snap)
    assert recovered.state["marker"] == "before-crash"

    # keep only a handful of snapshots
    for _ in range(8):
        proj.autosave()
    snaps = list((snap.parent).glob(f"{proj.meta.id}-*.adzak"))
    assert len(snaps) <= 5


def test_open_invalid_folder(manager, tmp_path):
    with pytest.raises(FileNotFoundError):
        manager.open(tmp_path)


def test_default_state_kinds():
    for kind in ("video", "photo", "design", "audio", "animation", "mixed"):
        st = default_project_state(kind)
        assert st["kind"] == kind
        json.dumps(st)  # must be serialisable
