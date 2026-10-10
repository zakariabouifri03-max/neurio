"""Converter tests — these run real FFmpeg encodes on tiny inputs."""

import pytest

from adzak.core.ffmpeg import probe
from adzak.services import converter


pytestmark = pytest.mark.usefixtures("ffmpeg_path")


def test_probe(sample_video):
    info = probe(sample_video)
    assert info.duration == pytest.approx(2.0, abs=0.3)
    assert info.video_stream.codec_name == "h264"
    assert info.resolution() == (320, 240)
    assert info.audio_stream is not None


def test_convert_video_to_mkv(sample_video, tmp_path):
    out = converter.convert_video(sample_video, tmp_path / "out.mkv", crf=28)
    assert out.is_file() and out.stat().st_size > 0
    assert probe(out).format_name == "matroska,webm"


def test_convert_video_resize_and_trim(sample_video, tmp_path):
    out = converter.convert_video(sample_video, tmp_path / "cut.mp4",
                                  scale="160:-2", start=0.5, end=1.5)
    info = probe(out)
    assert info.duration == pytest.approx(1.0, abs=0.25)
    assert info.video_stream.width == 160


def test_compress_video_crf(sample_video, tmp_path):
    out = converter.compress_video(sample_video, tmp_path / "small.mp4", crf=32)
    assert out.is_file()
    assert out.stat().st_size < sample_video.stat().st_size * 3


def test_compress_video_target_size(sample_video, tmp_path):
    out = converter.compress_video(sample_video, tmp_path / "sized.mp4",
                                   target_mb=0.15)
    assert out.is_file() and out.stat().st_size > 0


def test_extract_audio(sample_video, tmp_path):
    out = converter.extract_audio(sample_video, tmp_path / "a.m4a")
    info = probe(out)
    assert info.video_stream is None
    assert info.audio_stream is not None


def test_extract_frames_and_thumbnail(sample_video, tmp_path):
    frames = converter.extract_frames(sample_video, tmp_path / "frames", fps=5)
    assert len(frames) >= 8
    thumb = converter.make_thumbnail(sample_video, tmp_path / "t.jpg", at=1.0, width=160)
    assert thumb.is_file()


def test_make_gif(sample_video, tmp_path):
    out = converter.make_gif(sample_video, tmp_path / "a.gif", 0, 1.5, 160, 10)
    assert out.is_file() and out.stat().st_size > 500


def test_audio_convert(sample_video, tmp_path):
    m4a = converter.extract_audio(sample_video, tmp_path / "src.m4a")
    mp3 = converter.convert_audio(m4a, tmp_path / "out.mp3", "mp3-192")
    assert probe(mp3).audio_stream.codec_name == "mp3"
    wav = converter.convert_audio(m4a, tmp_path / "out.wav", "wav")
    assert probe(wav).audio_stream.codec_name == "pcm_s16le"
    with pytest.raises(converter.ConvertError):
        converter.convert_audio(m4a, tmp_path / "x.mp3", "nope")


def test_trim_audio(sample_video, tmp_path):
    wav = converter.extract_audio(sample_video, tmp_path / "in.wav",
                                  codec="pcm_s16le", container="wav")
    out = converter.trim_audio(wav, tmp_path / "trim.wav", 0.25, 1.25)
    assert probe(out).duration == pytest.approx(1.0, abs=0.15)
    with pytest.raises(converter.ConvertError):
        converter.trim_audio(wav, tmp_path / "bad.wav", 1.0, 0.5)


def test_merge_audio(sample_video, tmp_path):
    a = converter.extract_audio(sample_video, tmp_path / "a.wav", codec="pcm_s16le",
                                container="wav")
    out = converter.merge_audio([a, a], tmp_path / "joined.m4a")
    info = probe(out)
    assert info.duration > 3.0


def test_image_convert(sample_image, tmp_path):
    for ext in ("png", "jpg", "webp", "bmp"):
        out = converter.convert_image(sample_image, tmp_path / f"x.{ext}", quality=80)
        assert out.is_file()
    resized = converter.resize_image(sample_image, tmp_path / "r.png", 110)
    from PIL import Image
    with Image.open(resized) as im:
        assert im.width == 110


def test_batch_convert_images(sample_image, tmp_path):
    outs = converter.batch_convert_images([sample_image, sample_image],
                                          tmp_path / "batch", "webp")
    assert len(outs) == 2 and all(o.is_file() for o in outs)


def test_batch_rename(tmp_path):
    files = []
    for i in range(3):
        f = tmp_path / f"clip {i}.mp4"
        f.write_bytes(b"x")
        files.append(f)
    pairs = converter.batch_rename(files, "video_{index:02d}{ext}", dry_run=True)
    assert [p[1].name for p in pairs] == ["video_01.mp4", "video_02.mp4", "video_03.mp4"]
    assert files[0].exists()                        # dry run: untouched
    pairs = converter.batch_rename(files, "video_{index:02d}{ext}")
    assert all(new.exists() for _, new in pairs)


def test_metadata_reports(sample_video, sample_image):
    v = converter.video_metadata_report(sample_video)
    assert v["video"]["resolution"] == "320x240"
    assert v["size_mb"] > 0
    i = converter.image_metadata_report(sample_image)
    assert i["width"] == 220 and i["format"] == "PNG"


def test_size_estimate():
    small = converter.estimate_video_size_mb(1280, 720, 30, 60, crf=28)
    big = converter.estimate_video_size_mb(3840, 2160, 30, 60, crf=18)
    assert 0 < small < big
