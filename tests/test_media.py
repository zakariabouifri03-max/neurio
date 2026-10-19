from pathlib import Path
import subprocess

import pytest

import novacut.media as media


def test_local_probe_scene_silence_proxy_thumbnail_and_waveform(tmp_path, monkeypatch):
    ffmpeg = media.find_ffmpeg()
    if not ffmpeg:
        pytest.skip("FFmpeg was not configured; set NOVACUT_FFMPEG to run media integration tests")
    monkeypatch.setattr(media, "cache_dir", lambda: tmp_path / "cache")
    source = tmp_path / "synthetic-analysis.mp4"
    command = [
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=red:s=160x90:r=10:d=1",
        "-f", "lavfi", "-i", "color=c=blue:s=160x90:r=10:d=1",
        "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono:d=2",
        "-filter_complex", "[0:v][1:v]concat=n=2:v=1:a=0[v]",
        "-map", "[v]", "-map", "2:a", "-t", "2", "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", str(source),
    ]
    result = subprocess.run(command, capture_output=True, text=True, timeout=45)
    assert result.returncode == 0, result.stderr

    asset = media.probe_media(source, ffmpeg)
    assert asset.duration == pytest.approx(2.0, abs=0.1)
    assert asset.has_video and asset.has_audio
    assert asset.width == 160 and asset.height == 90

    cuts = media.detect_scenes(source, ffmpeg, threshold=0.05)
    assert cuts and cuts[0] == pytest.approx(1.0, abs=0.2)
    silence = media.detect_silence(source, ffmpeg, noise_db=-35, min_duration=0.5, duration=asset.duration)
    assert silence and silence[0][0] == pytest.approx(0.0, abs=0.05)

    thumb = media.create_thumbnail(source, "video", ffmpeg)
    waveform = media.generate_waveform(source, asset.duration, ffmpeg, buckets=80)
    proxy = media.create_proxy(source, ffmpeg, asset.duration, width=320)
    assert Path(thumb).is_file()
    assert waveform and len(waveform) <= 80
    assert Path(proxy).is_file() and Path(proxy).stat().st_size > 1_000


def test_missing_media_and_invalid_analysis_arguments_are_reported(tmp_path):
    with pytest.raises(media.MediaError, match="not found"):
        media.probe_media(tmp_path / "missing.mp4")
    with pytest.raises(media.MediaError, match="threshold"):
        media.detect_silence(tmp_path / "no-audio.wav", ffmpeg_path="/missing/ffmpeg", noise_db=1)
