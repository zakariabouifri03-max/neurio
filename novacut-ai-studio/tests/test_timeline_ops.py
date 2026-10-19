"""Timeline model + undoable editing operations."""
import pytest

from novacut.core.commands import UndoStack
from novacut.editing.operations import (
    AddClipCommand, RemoveClipCommand, MoveClipCommand, TrimClipCommand,
    SplitClipCommand, RippleDeleteCommand, DuplicateClipCommand,
    SetClipPropertyCommand, SetSpeedCommand, AddTrackCommand,
    AddMarkerCommand, RemoveMarkerCommand,
)
from novacut.editing.snapping import SnappingEngine
from novacut.models.enums import ClipKind, TrackKind
from novacut.models.timeline import Clip, Timeline


@pytest.fixture
def tl():
    t = Timeline.new_default()
    return t


@pytest.fixture
def stack():
    return UndoStack()


def _clip(start=0.0, duration=5.0, source_duration=None, kind=ClipKind.VIDEO.value):
    return Clip(kind=kind, start=start, duration=duration,
                source_duration=source_duration or duration)


def test_add_and_remove_clip_undo_redo(tl, stack):
    v = tl.video_tracks()[0]
    clip = _clip()
    stack.push(AddClipCommand(tl, clip, v.id))
    assert len(v.clips) == 1 and stack.can_undo()
    stack.undo()
    assert len(v.clips) == 0
    stack.redo()
    assert len(v.clips) == 1


def test_move_clip_and_undo(tl, stack):
    v = tl.video_tracks()[0]
    clip = _clip(0, 4)
    stack.push(AddClipCommand(tl, clip, v.id))
    stack.push(MoveClipCommand(tl, clip.id, 7.5))
    assert clip.start == pytest.approx(7.5)
    stack.undo()
    assert clip.start == pytest.approx(0.0)


def test_move_between_tracks(tl, stack):
    v1, v2 = tl.video_tracks()
    clip = _clip()
    stack.push(AddClipCommand(tl, clip, v1.id))
    stack.push(MoveClipCommand(tl, clip.id, 2.0, v2.id))
    assert clip.track_id == v2.id and len(v1.clips) == 0 and len(v2.clips) == 1
    stack.undo()
    assert clip.track_id == v1.id


def test_trim_left_keeps_source_sync(tl, stack):
    v = tl.video_tracks()[0]
    clip = _clip(0, 10, source_duration=10)
    stack.push(AddClipCommand(tl, clip, v.id))
    stack.push(TrimClipCommand(tl, clip.id, new_start=2.0, new_end=10.0,
                               source_limit=10.0))
    assert clip.start == pytest.approx(2.0)
    assert clip.duration == pytest.approx(8.0)
    assert clip.source_in == pytest.approx(2.0)
    assert clip.source_duration == pytest.approx(8.0)
    stack.undo()
    assert (clip.start, clip.duration, clip.source_in) == (0, 10, 0)


def test_trim_respects_source_limit(tl, stack):
    v = tl.video_tracks()[0]
    clip = _clip(0, 5, source_duration=5)
    stack.push(AddClipCommand(tl, clip, v.id))
    stack.push(TrimClipCommand(tl, clip.id, new_start=0, new_end=99,
                               source_limit=5.0))
    assert clip.source_duration <= 5.0 + 1e-6
    assert clip.end <= 5.0 + 1e-6


def test_split_creates_two_halves_and_restores(tl, stack):
    v = tl.video_tracks()[0]
    clip = _clip(0, 10, source_duration=10)
    stack.push(AddClipCommand(tl, clip, v.id))
    stack.push(SplitClipCommand(tl, clip.id, 4.0))
    halves = v.sorted_clips()
    assert len(halves) == 2
    assert halves[0].duration == pytest.approx(4.0)
    assert halves[1].start == pytest.approx(4.0)
    assert halves[1].source_in == pytest.approx(4.0)
    assert halves[0].end == pytest.approx(halves[1].start)
    stack.undo()
    restored = v.clips[0]
    assert restored.id == clip.id
    assert restored.duration == pytest.approx(10.0)
    assert restored.source_duration == pytest.approx(10.0)


def test_ripple_delete_pulls_later_clips(tl, stack):
    v = tl.video_tracks()[0]
    a, b = _clip(0, 3), _clip(5, 2)
    stack.push(AddClipCommand(tl, a, v.id))
    stack.push(AddClipCommand(tl, b, v.id))
    stack.push(RippleDeleteCommand(tl, a.id))
    assert b.start == pytest.approx(2.0)
    stack.undo()
    assert b.start == pytest.approx(5.0)
    assert tl.clip_by_id(a.id) is not None


def test_duplicate_clip(tl, stack):
    v = tl.video_tracks()[0]
    clip = _clip(0, 4)
    stack.push(AddClipCommand(tl, clip, v.id))
    stack.push(DuplicateClipCommand(tl, clip.id, offset_s=1.0))
    assert len(v.clips) == 2 and v.clips[1].start == pytest.approx(5.0)
    stack.undo()
    assert len(v.clips) == 1


def test_property_edit_and_coalescing(tl, stack):
    v = tl.video_tracks()[0]
    clip = _clip()
    stack.push(AddClipCommand(tl, clip, v.id))
    for val in (0.8, 0.6, 0.4):
        stack.push(SetClipPropertyCommand(tl, clip.id, "opacity", val,
                                          "Opacity drag"), merge=True)
    assert clip.opacity == pytest.approx(0.4)
    assert stack.depth() == 2  # add + one coalesced drag
    stack.undo()
    assert clip.opacity == pytest.approx(1.0)


def test_speed_change_preserves_timeline_duration(tl, stack):
    v = tl.video_tracks()[0]
    clip = _clip(0, 4, source_duration=4)
    stack.push(AddClipCommand(tl, clip, v.id))
    stack.push(SetSpeedCommand(tl, clip.id, 2.0))
    assert clip.speed == pytest.approx(2.0)
    assert clip.duration == pytest.approx(4.0)
    assert clip.source_duration == pytest.approx(8.0)
    stack.undo()
    assert clip.speed == pytest.approx(1.0)


def test_track_add_remove_undo(tl, stack):
    n = len(tl.tracks)
    stack.push(AddTrackCommand(tl, TrackKind.AUDIO.value))
    assert len(tl.tracks) == n + 1
    stack.undo()
    assert len(tl.tracks) == n


def test_markers_and_snapping(tl, stack):
    v = tl.video_tracks()[0]
    clip = _clip(0, 5)
    stack.push(AddClipCommand(tl, clip, v.id))
    stack.push(AddMarkerCommand(tl, 5.0, "end"))
    engine = SnappingEngine(tl, enabled=True, tolerance_s=0.3)
    res = engine.snap_time(4.9)
    assert res.snapped and res.time == pytest.approx(5.0)
    assert engine.snap_time(2.0).snapped is False
    engine.enabled = False
    assert engine.snap_time(4.9).snapped is False
    stack.undo()
    assert len(tl.markers) == 0


def test_remove_marker_undo(tl, stack):
    stack.push(AddMarkerCommand(tl, 1.0, "x"))
    mid = tl.markers[0].id
    stack.push(RemoveMarkerCommand(tl, mid))
    assert not tl.markers
    stack.undo()
    assert len(tl.markers) == 1


def test_keyframe_interpolation(tl):
    clip = _clip(0, 10)
    clip.add_keyframe("opacity", 0.0, 0.0)
    clip.add_keyframe("opacity", 10.0, 1.0)
    assert clip.value_at("opacity", 5.0) == pytest.approx(0.5)
    assert clip.value_at("opacity", -1) == pytest.approx(0.0)
    assert clip.value_at("opacity", 99) == pytest.approx(1.0)
    clip.add_keyframe("opacity", 5.0, 0.8)  # replace by time check
    assert clip.value_at("opacity", 5.0) == pytest.approx(0.8)


def test_drag_undo_uses_press_snapshot(tl, stack):
    """The timeline scene mutates clips live; undo must restore press state."""
    from novacut.editing.operations import TrimState
    v = tl.video_tracks()[0]
    clip = _clip(0, 10, source_duration=10)
    stack.push(AddClipCommand(tl, clip, v.id))

    # Simulate a live move drag: scene mutates clip.start before the command.
    clip.start = 7.5
    stack.push(MoveClipCommand(tl, clip.id, 7.5, old_start=0.0,
                               old_track_id=v.id))
    stack.undo()
    assert clip.start == pytest.approx(0.0)

    # Simulate a live left-trim drag (scene mutates start/duration only).
    clip.start, clip.duration = 2.0, 8.0
    before = TrimState(0.0, 10.0, 0.0, 10.0)
    stack.push(TrimClipCommand(tl, clip.id, new_start=2.0, new_end=10.0,
                               source_limit=10.0, before=before))
    assert clip.source_in == pytest.approx(2.0)
    stack.undo()
    assert (clip.start, clip.duration, clip.source_in,
            clip.source_duration) == (0.0, 10.0, 0.0, 10.0)


def test_overlap_detection(tl):
    v = tl.video_tracks()[0]
    tl.add_clip(_clip(0, 5), v.id)
    with pytest.raises(ValueError):
        tl.add_clip(_clip(4, 2), v.id)
    # allowed explicitly (drags resolve conflicts before commit)
    tl.add_clip(_clip(4, 2), v.id, allow_overlap=True)
    assert len(v.clips) == 2
