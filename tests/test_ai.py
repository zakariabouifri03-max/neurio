from types import SimpleNamespace

import pytest

import novacut.ai as ai
from novacut.models import Project
from novacut.timeline import TimelineOperations


def test_srt_parser_and_srt_vtt_export(tmp_path):
    srt = tmp_path / "captions.srt"
    srt.write_text(
        "1\n00:00:01,250 --> 00:00:02,750\nHello local world\n\n"
        "2\n00:00:03,000 --> 00:00:04,500\nSecond line\n",
        encoding="utf-8",
    )
    segments = ai.parse_srt(srt)
    assert [(item.start, item.end, item.text) for item in segments] == [
        (1.25, 2.75, "Hello local world"), (3.0, 4.5, "Second line")
    ]
    project = Project.create("Captions")
    title = TimelineOperations.add_title(project, segments[0].text, project.tracks[0].id, segments[0].start,
                                         segments[0].end - segments[0].start)
    title.title_size = 40
    srt_out = ai.export_subtitles(project, tmp_path / "out.srt", "srt")
    vtt_out = ai.export_subtitles(project, tmp_path / "out.vtt", "vtt")
    assert "00:00:01,250 --> 00:00:02,750" in srt_out.read_text(encoding="utf-8")
    assert vtt_out.read_text(encoding="utf-8").startswith("WEBVTT")
    assert "00:00:01.250 --> 00:00:02.750" in vtt_out.read_text(encoding="utf-8")


def test_model_download_checks_disk_before_network(tmp_path, monkeypatch):
    monkeypatch.setattr(ai, "app_data_dir", lambda: tmp_path / "appdata")
    monkeypatch.setattr(ai.shutil, "disk_usage", lambda _path: SimpleNamespace(free=1))
    with pytest.raises(OSError, match="Not enough free disk space"):
        ai.download_model("whisper-tiny")
    assert not list((tmp_path / "appdata").rglob("*.download"))


def test_local_assistant_rejects_non_loopback_urls():
    with pytest.raises(ValueError, match="loopback"):
        ai.ollama_models("https://example.com")
    with pytest.raises(ValueError, match="loopback"):
        ai.ask_local_ollama("help", "model", "project", "http://10.0.0.8:11434")


def test_model_catalog_is_optional_and_separately_stored():
    keys = {spec.key for spec in ai.MODEL_CATALOG}
    assert {"whisper-tiny", "whisper-base", "whisper-small", "whisper-medium", "u2net"}.issubset(keys)
    assert not ai.model_path("whisper-tiny").exists() or ai.model_path("whisper-tiny").stat().st_size > 10_000_000
