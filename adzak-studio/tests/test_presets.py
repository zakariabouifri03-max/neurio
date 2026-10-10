from adzak.services.presets import (ASPECT_RATIOS, AUDIO_PRESETS, PRESETS,
                                     presets_for)


def test_aspect_ratios():
    assert ASPECT_RATIOS["16:9"].w == 1920
    assert ASPECT_RATIOS["9:16"].h == 1920
    assert ASPECT_RATIOS["1:1"].ratio == 1.0
    assert ASPECT_RATIOS["4:5"].w == 1080


def test_presets_have_valid_codecs():
    valid_v = {"libx264", "libx265", "gif"}
    for p in PRESETS.values():
        assert p.vcodec in valid_v, p.id
        assert p.width > 0 and p.height > 0
        assert p.fps > 0
        est = p.estimated_size_mb(60)
        assert est > 0


def test_presets_for_categories():
    yt = presets_for("youtube")
    assert any("1080" in p.label for p in yt)
    tiktok = presets_for("tiktok")
    assert all(p.height > p.width for p in tiktok)


def test_audio_presets():
    assert "mp3-320" in AUDIO_PRESETS
    assert AUDIO_PRESETS["wav"].bitrate_k == 0  # lossless
    assert AUDIO_PRESETS["flac"].container == "flac"
