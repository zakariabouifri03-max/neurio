import logging
from pathlib import Path

import pytest

from adzak.ai.assistant import OfflineAssistant, OpenAICompatibleProvider
from adzak.ai.capabilities import CAPABILITIES, PAID_API, UNAVAILABLE
from adzak.core import i18n, secrets
from adzak.core.db import ProjectDB
from adzak.core.errors import AppError
from adzak.core.history import History
from adzak.core.log import RedactFilter, redact
from adzak.core.projects import (
    clear_all_autosaves, find_autosaves, load_video_project, save_video_project, write_autosave,
)
from adzak.video.model import Clip, Timeline


def test_db_projects_and_settings(tmp_path):
    db = ProjectDB(tmp_path / "s.sqlite3")
    pid = db.upsert_project("My film", "video", str(tmp_path / "a.adzproj"))
    db.upsert_project("My film v2", "video", str(tmp_path / "a.adzproj"))
    recent = db.recent_projects()
    assert len(recent) == 1 and recent[0]["name"] == "My film v2" and recent[0]["id"] == pid
    assert db.get_setting("language") == "en"
    db.set_setting("language", "ar")
    assert db.get_setting("language") == "ar"
    with pytest.raises(KeyError):
        db.set_setting("not_a_setting", 1)
    db.close()


def test_db_never_stores_api_key_field():
    from adzak.core.db import DEFAULT_SETTINGS
    assert "api_key" not in DEFAULT_SETTINGS
    assert "key" not in str(DEFAULT_SETTINGS["ai_provider"]).lower()


def test_video_project_roundtrip(tmp_path):
    tl = Timeline(aspect="4:5", short_px=720)
    tl.add(Clip(kind="text", text="Title", start=0, duration=2))
    p = save_video_project(tmp_path / "p.adzproj", "Demo", tl)
    name, back = load_video_project(p)
    assert name == "Demo" and back.aspect == "4:5" and back.clips[0].text == "Title"


def test_video_project_damaged_or_newer(tmp_path):
    bad = tmp_path / "bad.adzproj"
    bad.write_text("{ nope", encoding="utf-8")
    with pytest.raises(AppError):
        load_video_project(bad)
    newer = tmp_path / "new.adzproj"
    newer.write_text('{"format":"adzproj","version":99,"timeline":{}}', encoding="utf-8")
    with pytest.raises(AppError):
        load_video_project(newer)


def test_autosave_write_find_clear(tmp_data_dir):
    clear_all_autosaves()
    write_autosave("session one!", {"hello": 1})
    entries = find_autosaves()
    assert len(entries) == 1 and entries[0].payload == {"hello": 1}
    clear_all_autosaves()
    assert find_autosaves() == []


def test_history_limits_and_branches():
    h = History(limit=2)
    state = {"v": 0}
    for i in range(1, 4):
        h.push(dict(state))
        state["v"] = i
    assert h.can_undo
    s = h.undo(dict(state))
    assert s["v"] == 2
    assert h.can_redo
    h.push({"v": 9})
    assert not h.can_redo


def test_redaction_masks_keys():
    assert "sk-" not in redact("error with sk-abcdef1234567890XYZ here")
    assert "[REDACTED]" in redact("Authorization: Bearer abc.def.ghi")
    assert "password=hunter2" not in redact("password=hunter2")


def test_log_filter_redacts_records():
    rec = logging.LogRecord("adzak", logging.INFO, __file__, 1, "key api_key=SECRET123", (), None)
    RedactFilter().filter(rec)
    assert "SECRET123" not in rec.getMessage()


def test_secret_lookup_uses_env_not_files(monkeypatch):
    monkeypatch.setenv("ADZAK_AI_API_KEY", "  test-key  ")
    assert secrets.get_api_key() == "test-key"
    monkeypatch.delenv("ADZAK_AI_API_KEY")


def test_i18n_has_all_keys_for_all_languages():
    en_keys = set(i18n._STRINGS["en"])
    for lang, table in i18n._STRINGS.items():
        assert set(table) == en_keys, lang
    i18n.set_language("ar")
    assert i18n.is_rtl() and i18n.tr("export") == "تصدير"
    i18n.set_language("en")
    assert not i18n.is_rtl()


def test_offline_assistant_help_and_generators():
    a = OfflineAssistant()
    assert "Ctrl+B" in a.answer("How do I split a clip?")
    assert "not available" in a.answer("generate AI video please").lower()
    assert len(a.titles("cooking pasta", 3)) == 3
    assert "#cooking" in a.hashtags("cooking pasta", "tiktok")
    assert "Hook" in a.script_outline("pasta", 30)
    with pytest.raises(AppError):
        a.titles("   ")
    with pytest.raises(AppError):
        a.script_outline("x", 2)


def test_assistant_provider_requires_https():
    with pytest.raises(AppError):
        OpenAICompatibleProvider("http://insecure.example", "m", "k")


def test_assistant_provider_maps_auth_failure(monkeypatch):
    import io
    import urllib.error
    import urllib.request

    def fake_urlopen(req, timeout=0):
        raise urllib.error.HTTPError(req.full_url, 401, "bad", {}, io.BytesIO(b""))

    monkeypatch.setattr(urllib.request, "urlopen", fake_urlopen)
    p = OpenAICompatibleProvider("https://api.example.com/v1", "m", "sk-secret-value-123")
    with pytest.raises(AppError) as e:
        p.chat([{"role": "user", "content": "hi"}])
    assert "rejected" in e.value.user_message
    assert "sk-secret" not in e.value.user_message


def test_capability_labels_are_honest():
    by_key = {c.key: c for c in CAPABILITIES}
    assert by_key["ai_video"].status == UNAVAILABLE
    assert by_key["assistant_online"].status == PAID_API


def test_presets_are_valid_timelines():
    from adzak.video.presets import EXPORT_PRESETS, preset_size, export_presets_json, load_presets_json
    from adzak.video.model import canvas_size
    for name, p in EXPORT_PRESETS.items():
        assert canvas_size(p["aspect"], p["short_px"]) == preset_size(name)
        assert p["ext"] in (".mp4", ".mkv", ".webm")
    assert preset_size("TikTok / Reels / Shorts (9:16)") == (1080, 1920)
    out = export_presets_json(Path(__import__("tempfile").mkdtemp()) / "p.json")
    assert load_presets_json(out) == EXPORT_PRESETS
