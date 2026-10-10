"""Audio pipeline tests against real FFmpeg-decoded audio."""

import numpy as np
import pytest

from adzak.core.ffmpeg import probe
from adzak.services import audio_ops

pytestmark = pytest.mark.usefixtures("ffmpeg_path")


def test_decode_and_waveform(sample_video):
    pcm = audio_ops.decode_pcm(sample_video)
    assert pcm.dtype == np.float32 and pcm.size > 40000
    peaks, dur = audio_ops.waveform_peaks(sample_video, buckets=50)
    assert peaks.shape == (50,)
    assert dur == pytest.approx(2.0, abs=0.3)
    assert peaks.max() > 0.01          # a 440 Hz sine is audible


def test_normalize(sample_video, tmp_path):
    from adzak.services.converter import extract_audio
    wav = extract_audio(sample_video, tmp_path / "in.wav",
                        codec="pcm_s16le", container="wav")
    out = audio_ops.normalize(wav, tmp_path / "norm.wav", target_peak_db=-1.0)
    pcm = audio_ops.decode_pcm(out)
    assert np.abs(pcm).max() == pytest.approx(10 ** (-1.0 / 20), abs=0.08)


def test_fade(sample_video, tmp_path):
    from adzak.services.converter import extract_audio
    wav = extract_audio(sample_video, tmp_path / "in.wav",
                        codec="pcm_s16le", container="wav")
    out = audio_ops.fade(wav, tmp_path / "faded.wav", fade_in=0.5, fade_out=0.5)
    pcm = audio_ops.decode_pcm(out)
    assert out.is_file()
    # first samples of a fade-in start near silence
    assert np.abs(pcm[:200]).max() < np.abs(pcm[40000:41000]).max()


def test_equalize(sample_video, tmp_path):
    from adzak.services.converter import extract_audio
    wav = extract_audio(sample_video, tmp_path / "in.wav",
                        codec="pcm_s16le", container="wav")
    out = audio_ops.equalize(wav, tmp_path / "eq.wav", {"440": -20})
    assert out.is_file() and out.stat().st_size > 0


def test_silence_detection_and_removal(silent_video, tmp_path):
    spans = audio_ops.detect_silence(silent_video, threshold_db=-35, min_duration=0.5)
    assert len(spans) >= 1
    assert any(0.9 < s.start < 2.2 for s in spans)

    out = audio_ops.remove_silence(silent_video, tmp_path / "nosil.wav",
                                    threshold_db=-35, min_duration=0.5)
    info = probe(out)
    original = probe(silent_video)
    assert info.duration < original.duration - 0.3


def test_speed_change(sample_video, tmp_path):
    from adzak.services.converter import extract_audio
    wav = extract_audio(sample_video, tmp_path / "in.wav",
                        codec="pcm_s16le", container="wav")
    fast = audio_ops.speed_change(wav, tmp_path / "fast.wav", 2.0)
    assert probe(fast).duration == pytest.approx(1.0, abs=0.15)
    slow = audio_ops.speed_change(wav, tmp_path / "slow.wav", 0.5)
    assert probe(slow).duration == pytest.approx(4.0, abs=0.3)
    with pytest.raises(audio_ops.AudioError):
        audio_ops.speed_change(wav, tmp_path / "bad.wav", 99)


def test_record_command_shape():
    cmd = audio_ops.record_command("/tmp/rec.wav", duration=10)
    assert cmd[0].endswith("ffmpeg") or "ffmpeg" in cmd[0]
    assert "/tmp/rec.wav" in cmd
    assert "-t" in cmd
