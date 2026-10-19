import math

import pytest

from novacut.core.timecode import (fmt_timecode, fmt_clock, parse_timecode,
                                   frame_to_seconds, seconds_to_frame, snap)


def test_timecode_roundtrip():
    assert fmt_timecode(0, 30) == "00:00:00:00"
    assert fmt_timecode(1.0, 30) == "00:00:01:00"
    # 3661.5 s * 25 fps = 91537.5 frames -> round-half-even -> 91538 -> ff 13
    assert fmt_timecode(3661.5, 25) == "01:01:01:13"


def test_parse_timecode_formats():
    assert parse_timecode("00:00:01:00", 30) == pytest.approx(1.0)
    assert parse_timecode("01:02:03:15", 30) == pytest.approx(3723.5)
    assert parse_timecode("12.5") == pytest.approx(12.5)
    with pytest.raises(ValueError):
        parse_timecode("not-a-time")


def test_frame_helpers():
    assert frame_to_seconds(30, 30) == 1.0
    assert seconds_to_frame(1.0, 30) == 30


def test_clock_format():
    assert fmt_clock(3661.25).startswith("01:01:01.250")


def test_snap():
    assert snap(0.101, [0.0, 0.5, 1.0], 0.02) == pytest.approx(0.101)
    assert snap(0.505, [0.0, 0.5, 1.0], 0.02) == pytest.approx(0.5)
