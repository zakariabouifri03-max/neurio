import pytest

from adzak.services import subtitles

SRT = """1
00:00:01,000 --> 00:00:03,500
Hello world

2
00:00:04,000 --> 00:00:06,000
Second line
with wrap
"""


def test_parse_srt():
    cues = subtitles.parse_srt(SRT)
    assert len(cues) == 2
    assert cues[0].start == 1.0 and cues[0].end == 3.5
    assert cues[1].text == "Second line\nwith wrap"


def test_parse_errors():
    with pytest.raises(subtitles.SubtitleError):
        subtitles.parse_srt("1\nbad --> worse\ntext\n")
    with pytest.raises(subtitles.SubtitleError):
        subtitles.parse_srt("1\n00:00:05,000 --> 00:00:01,000\nreversed\n")


def test_roundtrip_srt_vtt():
    cues = subtitles.parse_srt(SRT)
    vtt = subtitles.write_vtt(cues)
    assert vtt.startswith("WEBVTT")
    assert "00:00:01.000" in vtt
    back = subtitles.parse_vtt(vtt)
    assert [c.text for c in back] == [c.text for c in cues]


def test_convert_file(tmp_path):
    src = tmp_path / "in.srt"
    src.write_text(SRT, encoding="utf-8")
    dest = subtitles.convert(src, tmp_path / "out.vtt", offset=1.5)
    text = dest.read_text(encoding="utf-8")
    assert "00:00:02.500" in text
    txt = subtitles.convert(src, tmp_path / "out.txt")
    assert "Hello world" in txt.read_text(encoding="utf-8")
    with pytest.raises(subtitles.SubtitleError):
        subtitles.convert(src, tmp_path / "out.xyz")


def test_shift_and_scale():
    cues = subtitles.parse_srt(SRT)
    scaled = [subtitles.Cue(c.start * 2, c.end * 2, c.text) for c in cues]
    assert scaled[0].end == 7.0
