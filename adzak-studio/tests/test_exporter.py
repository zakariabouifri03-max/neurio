"""End-to-end render pipeline tests (real FFmpeg encodes)."""

import pytest

from adzak.core.ffmpeg import probe
from adzak.services.exporter import RenderError, RenderSettings, build_render_args, render
from adzak.services.timeline import Clip, Effect, Timeline

pytestmark = pytest.mark.usefixtures("ffmpeg_path")


@pytest.fixture()
def timeline(sample_video):
    tl = Timeline(fps=25)
    v = tl.add_track("video")
    a = tl.add_track("audio")
    c1 = Clip(source=str(sample_video), start=0.0, in_point=0.0, out_point=1.0,
              name="one", source_duration=2.0)
    c2 = Clip(source=str(sample_video), start=1.0, in_point=0.5, out_point=1.5,
              name="two", speed=2.0, source_duration=2.0)
    c2.effects.append(Effect("brightness", {"value": 0.1}))
    tl.add_clip(v, c1)
    tl.add_clip(v, c2)
    return tl


def test_build_args_shape(timeline):
    rs = RenderSettings(out_path="/tmp/x.mp4", width=320, height=240, fps=25)
    args = build_render_args(timeline, rs)
    assert "-i" in args and str_render_path(args) == "/tmp/x.mp4"
    assert "concat=n=2:v=1:a=1" in next(a for a in args if "concat" in a)
    assert "atempo" in " ".join(args)          # speed clip present


def str_render_path(args):
    return args[-1]


def test_render_produces_real_file(timeline, tmp_path):
    out = tmp_path / "render.mp4"
    rs = RenderSettings(out_path=str(out), width=320, height=240, fps=25,
                        crf=28, x264_preset="veryfast", threads=2)
    progress_seen = []
    result = render(timeline, rs, on_progress=progress_seen.append)
    assert result == out and out.stat().st_size > 1000
    info = probe(out)
    # 1.0 s clip + 1.0 s of source at 2× speed (0.5 s) = 1.5 s total
    assert info.duration == pytest.approx(1.5, abs=0.2)
    assert info.resolution() == (320, 240)


def test_render_with_gap_and_reverse(sample_video, tmp_path):
    tl = Timeline(fps=25)
    v = tl.add_track("video")
    tl.add_clip(v, Clip(source=str(sample_video), start=0.0, out_point=0.5,
                        source_duration=2.0))
    tl.add_clip(v, Clip(source=str(sample_video), start=1.5, in_point=0.0,
                        out_point=0.5, speed=-1.0, source_duration=2.0))
    out = tmp_path / "gap.mp4"
    rs = RenderSettings(out_path=str(out), width=160, height=120, fps=25,
                        crf=30, x264_preset="veryfast")
    render(tl, rs)
    info = probe(out)
    assert info.duration == pytest.approx(2.0, abs=0.2)


def test_render_burn_subtitles(timeline, sample_video, tmp_path):
    srt = tmp_path / "subs.srt"
    srt.write_text("1\n00:00:00,000 --> 00:00:01,000\nHello\n", encoding="utf-8")
    out = tmp_path / "subbed.mp4"
    rs = RenderSettings(out_path=str(out), width=320, height=240, fps=25,
                        crf=30, x264_preset="veryfast",
                        burn_subtitles=str(srt))
    render(timeline, rs)
    assert out.stat().st_size > 1000


def test_render_gif_video_only(timeline, tmp_path):
    out = tmp_path / "anim.gif"
    rs = RenderSettings(out_path=str(out), width=160, height=120, fps=10,
                        vcodec="gif")
    render(timeline, rs)
    assert out.stat().st_size > 500
    from PIL import Image
    with Image.open(out) as im:
        assert im.format == "GIF"


def test_empty_timeline_rejected(tmp_path):
    tl = Timeline(fps=25)
    rs = RenderSettings(out_path=str(tmp_path / "x.mp4"))
    with pytest.raises(RenderError):
        build_render_args(tl, rs)


def test_invalid_codec_rejected(timeline, tmp_path):
    rs = RenderSettings(out_path=str(tmp_path / "x.mp4"), vcodec="not-a-codec")
    with pytest.raises(ValueError):
        build_render_args(timeline, rs)
