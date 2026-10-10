
import pytest
from PIL import Image

from adzak.audio import tools as audio
from adzak.core import ffmpeg
from adzak.core.errors import AppError
from adzak.utils import converters as conv
from adzak.utils import subtitles


def test_image_convert_and_compress(tmp_path, media):
    out = conv.convert_image(str(media["png"]), str(tmp_path / "a.webp"))
    assert Image.open(out).format == "WEBP"
    d, before, after = conv.compress_image(str(media["png"]), str(tmp_path / "c.jpg"), quality=40)
    assert after < before
    with pytest.raises(AppError):
        conv.convert_image(str(media["png"]), str(tmp_path / "x.pdf"))


def test_batch_resize(tmp_path, media):
    out = conv.batch_resize([str(media["png"])], str(tmp_path / "out"), 100, 100)
    assert Image.open(out[0]).size[0] <= 100


def test_batch_rename_plan_and_apply(tmp_path):
    files = []
    for n in ("IMG a", "IMG b"):
        f = tmp_path / f"{n}.jpg"
        f.write_bytes(b"x")
        files.append(str(f))
    pairs = conv.plan_rename(files, "photo_{n:03d}")
    assert [p[1].name for p in pairs] == ["photo_001.jpg", "photo_002.jpg"]
    assert conv.apply_rename(pairs) == 2
    assert (tmp_path / "photo_001.jpg").exists()


def test_batch_rename_rejects_duplicates_and_bad_patterns(tmp_path):
    f = tmp_path / "a.jpg"
    f.write_bytes(b"x")
    with pytest.raises(AppError):
        conv.plan_rename([str(f)], "static")
    with pytest.raises(AppError):
        conv.plan_rename([str(f), str(f)], "same")
    with pytest.raises(AppError):
        conv.plan_rename([str(f)], "{bogus}")


def test_video_gif_frames_thumbnail_metadata(media, tmp_path):
    gif = conv.make_gif(str(media["video"]), str(tmp_path / "a.gif"), fps=5, width=160, duration=1.5)
    assert Image.open(gif).format == "GIF"
    frames = conv.extract_frames(str(media["video"]), str(tmp_path / "frames"), fps=1, max_frames=20)
    assert len(frames) >= 5
    th = conv.extract_thumbnail(str(media["video"]), str(tmp_path / "t.png"), at_seconds=2, width=320)
    assert Image.open(th).width == 320
    md = conv.metadata(str(media["video"]))
    assert any(k == "Resolution" and v == "640 × 360" for k, v in md.lines)
    im_md = conv.metadata(str(media["png"]))
    assert any(k == "Dimensions" and v == "400 × 300" for k, v in im_md.lines)


def test_gif_from_images(tmp_path, media):
    other = tmp_path / "red.png"
    Image.new("RGB", (64, 64), (255, 0, 0)).save(other)  # identical frames would be merged by GIF optimiser
    g = conv.gif_from_images([str(media["png"]), str(other)], str(tmp_path / "s.gif"), frame_ms=100)
    assert Image.open(g).n_frames == 2


def test_video_compress_and_convert(media, tmp_path):
    out, before, after = conv.compress_video(str(media["video"]), str(tmp_path / "c.mp4"), crf=35, max_height=240)
    assert ffmpeg.probe(out).height == 240
    v = conv.convert_video(str(media["video"]), str(tmp_path / "v.mkv"))
    assert ffmpeg.probe(v).has_video


def test_audio_tools(media, tmp_path):
    peaks = audio.waveform_peaks(media["wav"], bins=50)
    assert len(peaks) == 50 and peaks.max() > 0.1
    t = audio.trim(str(media["wav"]), str(tmp_path / "t.wav"), 0.5, 1.5)
    assert ffmpeg.probe(t).duration == pytest.approx(1.0, abs=0.1)
    m = audio.merge([str(media["wav"]), str(media["wav"])], str(tmp_path / "m.mp3"))
    assert ffmpeg.probe(m).duration == pytest.approx(7.0, abs=0.2)
    p = audio.process(str(media["wav"]), str(tmp_path / "n.flac"), normalize_lufs=-16, bass_db=3,
                      fade_in=0.1, fade_out=0.2, duration=3.5)
    assert p.is_file()
    e = audio.extract_audio(str(media["video"]), str(tmp_path / "e.m4a"))
    assert ffmpeg.probe(e).has_audio and not ffmpeg.probe(e).has_video


def test_audio_rejects_bad_inputs(media, tmp_path):
    with pytest.raises(AppError):
        audio.trim(str(media["wav"]), str(tmp_path / "x.txt"), 0, 1)
    with pytest.raises(AppError):
        audio.process(str(media["wav"]), str(tmp_path / "y.wav"), normalize_lufs=0)


SRT = """1
00:00:01,000 --> 00:00:03,500
Hello <i>there</i>

2
00:00:04,000 --> 00:00:05,000
Second line
"""


def test_srt_to_vtt_and_shift(tmp_path):
    src = tmp_path / "a.srt"
    src.write_text(SRT, encoding="utf-8")
    out = subtitles.convert_file(src, tmp_path / "a.vtt", shift_seconds=0.5)
    text = out.read_text(encoding="utf-8")
    assert text.startswith("WEBVTT")
    assert "00:00:01.500 --> 00:00:04.000" in text
    assert "<i>" not in text


def test_subtitle_errors(tmp_path):
    bad = tmp_path / "bad.srt"
    bad.write_text("1\nnot a time\nhi\n", encoding="utf-8")
    with pytest.raises(AppError):
        subtitles.convert_file(bad, tmp_path / "x.vtt")
    with pytest.raises(AppError):
        subtitles.convert_file(bad, tmp_path / "x.mp4")
