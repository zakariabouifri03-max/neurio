
import pytest

from adzak.core import ffmpeg
from adzak.core.errors import AppError
from adzak.video.analysis import detect_scenes, detect_silence, non_silent_spans
from adzak.video.model import Clip, Timeline
from adzak.video.proxy import make_proxy
from adzak.video.render import export_timeline, preview_frame


def test_probe_reads_real_media(media):
    info = ffmpeg.probe(media["video"])
    assert info.has_video and info.has_audio
    assert info.width == 640 and info.height == 360
    assert info.duration == pytest.approx(6.0, abs=0.1)


def test_probe_rejects_non_media(tmp_path):
    f = tmp_path / "bad.mp4"
    f.write_bytes(b"not a video at all" * 10)
    with pytest.raises(AppError):
        ffmpeg.probe(f)


def test_export_multitrack_with_effects(media, tmp_path):
    tl = Timeline(aspect="9:16", short_px=540, fps=30)
    tl.add(Clip(kind="video", src=str(media["video"]), track=0, start=0, duration=4, in_point=1, speed=2,
                rotate=90, brightness=0.1, fade_in=0.5, crop=[0.0, 0.0, 1.0, 0.8]))
    tl.add(Clip(kind="video", src=str(media["green"]), track=1, start=2, duration=3, chroma_color="#00FF00",
                opacity=0.8, speed=0.5, reverse=True))
    tl.add(Clip(kind="audio", src=str(media["video"]), track=2, start=1, duration=3, volume=0.5, fade_out=1,
                speed=1.5))
    tl.add(Clip(kind="text", track=3, start=0, duration=5, text="Hello ADZAK", text_stroke=2))
    out = export_timeline(tl, tmp_path / "out.mp4", work_dir=tmp_path / "w", codec="h264", crf=30,
                          preset="ultrafast")
    info = ffmpeg.probe(out)
    assert info.width == 540 and info.height == 960
    assert info.duration == pytest.approx(5.0, abs=0.15)
    assert info.has_audio and info.video_codec == "h264"


def test_export_video_only_and_webm_vp9(media, tmp_path):
    tl = Timeline(aspect="1:1", short_px=240, fps=25)
    tl.add(Clip(kind="image", src=str(media["png"]), start=0, duration=2))
    out = export_timeline(tl, tmp_path / "still.webm", work_dir=tmp_path / "w", codec="vp9", crf=40)
    info = ffmpeg.probe(out)
    assert info.has_video and not info.has_audio
    assert (info.width, info.height) == (240, 240)
    assert info.duration == pytest.approx(2.0, abs=0.15)


def test_export_rejects_bad_combinations(media, tmp_path):
    tl = Timeline()
    tl.add(Clip(kind="video", src=str(media["video"]), start=0, duration=1))
    with pytest.raises(AppError):
        export_timeline(tl, tmp_path / "x.webm", work_dir=tmp_path, codec="h265")
    with pytest.raises(AppError):
        export_timeline(tl, tmp_path / "x.avi", work_dir=tmp_path)
    with pytest.raises(AppError):
        export_timeline(Timeline(), tmp_path / "x.mp4", work_dir=tmp_path)


def test_export_reports_progress(media, tmp_path):
    tl = Timeline(short_px=240)
    tl.add(Clip(kind="video", src=str(media["video"]), start=0, duration=2))
    seen = []
    export_timeline(tl, tmp_path / "p.mp4", work_dir=tmp_path, preset="ultrafast", on_progress=seen.append)
    assert seen and seen[-1] == 1.0


def test_preview_frame_is_real_image(media, tmp_path):
    from PIL import Image

    tl = Timeline(aspect="16:9", short_px=360)
    tl.add(Clip(kind="video", src=str(media["video"]), start=0, duration=4))
    p = preview_frame(tl, 1.0, tmp_path / "f.png", height=180, work_dir=tmp_path)
    im = Image.open(p)
    assert im.height == 180 and im.width == 320


def test_silence_detection_and_removal(media):
    spans = detect_silence(str(media["wav"]), noise_db=-40, min_silence=0.5)
    assert len(spans) == 1
    assert spans[0].start == pytest.approx(1.0, abs=0.1)
    assert spans[0].duration == pytest.approx(1.5, abs=0.15)
    keep = non_silent_spans(spans, 3.5, padding=0.0)
    assert len(keep) == 2
    assert keep[0].end == pytest.approx(1.0, abs=0.1)
    assert keep[1].start == pytest.approx(2.5, abs=0.15)


def test_scene_detection_runs_on_real_video(media):
    scenes = detect_scenes(str(media["video"]), threshold=0.3)
    assert isinstance(scenes, list)


def test_proxy_is_created_and_reused(media):
    p1 = make_proxy(media["video"], height=144)
    p2 = make_proxy(media["video"], height=144)
    assert p1 == p2 and p1.is_file()
    assert ffmpeg.probe(p1).height == 144


def test_missing_source_is_clear_error(tmp_path):
    tl = Timeline()
    tl.add(Clip(kind="video", src=str(tmp_path / "gone.mp4"), start=0, duration=1))
    with pytest.raises(AppError) as e:
        export_timeline(tl, tmp_path / "o.mp4", work_dir=tmp_path)
    assert "missing" in e.value.user_message.lower()
