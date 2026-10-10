import pytest

from adzak.video.model import Clip, Timeline, canvas_size


def test_canvas_sizes_match_aspects():
    assert canvas_size("16:9", 1080) == (1920, 1080)
    assert canvas_size("9:16", 1080) == (1080, 1920)
    assert canvas_size("1:1", 1080) == (1080, 1080)
    assert canvas_size("4:5", 1080) == (1080, 1350)
    with pytest.raises(ValueError):
        canvas_size("3:2", 1080)


def test_split_keeps_source_alignment():
    tl = Timeline()
    c = tl.add(Clip(kind="video", src="x.mp4", start=2.0, duration=6.0, in_point=1.0, speed=2.0))
    left, right = tl.split(c.id, 4.0)  # 2 s into the clip = 4 s of source at 2x
    assert left.duration == pytest.approx(2.0)
    assert right.start == pytest.approx(4.0)
    assert right.duration == pytest.approx(4.0)
    assert right.in_point == pytest.approx(1.0 + 2.0 * 2.0)
    assert tl.duration() == pytest.approx(8.0)


@pytest.mark.parametrize("t", [2.0, 8.0, 1.0, 9.0])
def test_split_rejects_edges_and_outside(t):
    tl = Timeline()
    c = tl.add(Clip(kind="audio", src="x.wav", start=2.0, duration=6.0))
    with pytest.raises(ValueError):
        tl.split(c.id, t)


def test_trim_moves_in_point_and_refuses_empty():
    tl = Timeline()
    c = tl.add(Clip(kind="video", src="x.mp4", start=0, duration=10, in_point=0, speed=1))
    tl.trim(c.id, head=2, tail=3)
    assert (c.start, c.duration, c.in_point) == (2, 5, 2)
    with pytest.raises(ValueError):
        tl.trim(c.id, head=4, tail=4)


def test_validation_rejects_bad_values():
    with pytest.raises(ValueError):
        Clip(kind="video", src="x.mp4", speed=10).validate()
    with pytest.raises(ValueError):
        Clip(kind="video", src="").validate()
    with pytest.raises(ValueError):
        Clip(kind="text", text="   ").validate()
    with pytest.raises(ValueError):
        Clip(kind="video", src="x", rotate=45).validate()
    with pytest.raises(ValueError):
        Clip(kind="video", src="x", crop=[0.5, 0.5, 0.8, 0.8]).validate()


def test_serialization_roundtrip_and_unknown_fields_ignored():
    tl = Timeline(aspect="9:16", short_px=720, fps=24)
    tl.add(Clip(kind="text", text="Hi", start=1, duration=2))
    data = tl.to_dict()
    data["clips"][0]["future_field"] = 1
    back = Timeline.from_dict(data)
    assert back.aspect == "9:16" and back.fps == 24 and back.clips[0].text == "Hi"
    assert back.size == (720, 1280)
