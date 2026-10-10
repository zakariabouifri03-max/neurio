import json

import pytest

from adzak.services.timeline import (Clip, Keyframe, Timeline, keyframe_value)


@pytest.fixture()
def tl():
    t = Timeline(fps=30)
    v = t.add_track("video")
    a = t.add_track("audio")
    return t, v, a


def make_clip(source="x.mp4", start=0.0, dur=4.0, speed=1.0):
    return Clip(source=source, start=start, in_point=0.0, out_point=dur,
                source_duration=dur, speed=speed)


def test_add_clip_and_duration(tl):
    t, v, a = tl
    c1 = make_clip("a.mp4", 0.0, 4.0)
    c2 = make_clip("b.mp4", 10.0, 2.0)
    t.add_clip(v, c1)
    t.add_clip(v, c2)
    assert t.duration() == 12.0
    assert v.clip_at(3.9).source == "a.mp4"
    assert v.clip_at(10.5).source == "b.mp4"
    assert v.clip_at(6.0) is None


def test_overlap_pushes_forward(tl):
    t, v, _ = tl
    c1 = make_clip("a.mp4", 0.0, 4.0)
    c2 = make_clip("b.mp4", 2.0, 2.0)
    t.add_clip(v, c1)
    t.add_clip(v, c2)
    assert c2.start >= 4.0          # pushed past c1 instead of stacking


def test_split(tl):
    t, v, _ = tl
    c = make_clip("a.mp4", 1.0, 6.0)
    t.add_clip(v, c)
    halves = t.split_clip(c.id, 4.0)
    assert halves is not None
    left, right = halves
    assert abs(left.duration - 3.0) < 1e-6
    assert abs(right.duration - 3.0) < 1e-6
    assert right.start == 4.0
    assert len(v.clips) == 2
    # splitting near edges is rejected
    assert t.split_clip(left.id, left.start + 0.001) is None


def test_trim_and_move(tl):
    t, v, _ = tl
    c = make_clip("a.mp4", 2.0, 10.0)
    t.add_clip(v, c)
    tail_before = c.end
    assert t.trim_in(c.id, 3.0)
    assert c.start == pytest.approx(5.0)      # left edge moved right 3 s
    assert c.duration == pytest.approx(7.0)
    assert c.end == pytest.approx(tail_before)  # tail stays anchored
    assert t.trim_out(c.id, 8.0)
    assert c.duration == pytest.approx(5.0)
    assert t.move_clip(c.id, 0.5)
    assert c.start == 0.5


def test_move_rejected_on_overlap(tl):
    t, v, _ = tl
    c1 = make_clip("a.mp4", 0.0, 4.0)
    c2 = make_clip("b.mp4", 8.0, 4.0)
    t.add_clip(v, c1); t.add_clip(v, c2)
    assert t.move_clip(c2.id, 2.0) is False
    assert c2.start == 8.0


def test_speed_affects_duration(tl):
    t, v, _ = tl
    c = make_clip("a.mp4", 0.0, 4.0, speed=2.0)
    t.add_clip(v, c)
    assert c.duration == pytest.approx(2.0)
    t.set_speed(c.id, -1.0)
    assert c.speed == -1.0
    assert t.set_speed(c.id, 0) is False       # invalid
    assert t.set_speed(c.id, 100) is False


def test_ripple_delete(tl):
    t, v, _ = tl
    c1 = make_clip("a.mp4", 0.0, 2.0)
    c2 = make_clip("b.mp4", 2.0, 2.0)
    t.add_clip(v, c1); t.add_clip(v, c2)
    t.remove_clip(c1.id, ripple=True)
    assert c2.start == pytest.approx(0.0)


def test_serialisation_roundtrip(tl):
    t, v, a = tl
    c = make_clip("a.mp4", 0.0, 4.0)
    c.effects.append(__import__("adzak.services.timeline",
                                fromlist=["Effect"]).Effect("brightness", {"value": 0.2}))
    c.keyframes["opacity"] = [Keyframe(0, 0.0), Keyframe(1, 1.0)]
    t.add_clip(v, c)
    data = json.loads(json.dumps(t.to_dict()))
    t2 = Timeline.from_dict(data)
    assert t2.fps == 30
    c2 = t2.tracks[0].clips[0]
    assert c2.effects[0].kind == "brightness"
    assert keyframe_value(c2.keyframes["opacity"], 0.5) == pytest.approx(0.5)


def test_keyframe_hold_and_bounds():
    keys = [Keyframe(0, 10), Keyframe(2, 20), Keyframe(4, 30, interp="hold")]
    assert keyframe_value(keys, -1) == 10
    assert keyframe_value(keys, 1) == 15
    assert keyframe_value([], 1, default=3.3) == 3.3
    assert keyframe_value(keys, 99) == 30


def test_locked_track(tl):
    t, v, _ = tl
    v.locked = True
    with pytest.raises(ValueError):
        t.add_clip(v, make_clip())
