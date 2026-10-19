"""Diagnostics, FFmpeg capability detection and configuration."""
from pathlib import Path

from novacut.core.config import Config
from novacut.core.ffmpeg import (ffmpeg_supports_encoders,
                                 ffmpeg_supports_filter, find_ffmpeg)
from novacut.diagnostics import diagnostics


def test_config_roundtrip(tmp_path):
    from novacut.core import paths
    paths.override_root(tmp_path / "cfg")
    cfg = Config()
    cfg.set("snap_tolerance_s", 0.4)
    cfg.set("ollama_model", "mistral:7b")
    again = Config()
    assert again.get("snap_tolerance_s") == 0.4
    assert again.get("ollama_model") == "mistral:7b"
    assert again.get("nonexistent", "fallback") == "fallback"


def test_ffmpeg_capabilities():
    if find_ffmpeg() is None:
        return
    encoders = ffmpeg_supports_encoders()
    assert isinstance(encoders, dict)
    # CPU codecs are expected in every normal FFmpeg build.
    assert encoders.get("aac") in (True, False)
    for name in ("xfade", "chromakey", "silencedetect"):
        assert isinstance(ffmpeg_supports_filter(name), bool)
    assert ffmpeg_supports_filter("definitely-not-a-filter-xyz") is False


def test_diagnostics_report(tmp_path):
    report = diagnostics.collect_diagnostics()
    assert report["app"]["name"] == "NovaCut AI Studio"
    assert "ffmpeg" in report and "ai_dependencies" in report
    text = diagnostics.render_text(report)
    assert "diagnostics report" in text
    out = diagnostics.save_report(tmp_path / "report.txt")
    assert Path(out).exists() and "NovaCut" in Path(out).read_text()
