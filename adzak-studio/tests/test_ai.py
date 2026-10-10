"""AI layer tests: capability honesty, key storage, assistant generators."""

import pytest

from adzak.ai import assistant
from adzak.ai.capabilities import FEATURES, FeatureStatus, by_studio, status_counts
from adzak.ai.keystorage import KeyStore
from adzak.ai.providers import ChatProvider, ImageProvider, ProviderConfig, ProviderError


def test_capability_registry_complete():
    for f in FEATURES.values():
        assert f.status in FeatureStatus
        assert f.detail
    counts = status_counts()
    assert counts["local"] > 0
    assert counts["free"] > 0
    assert counts["unavailable"] > 0     # honest: some things are not built yet
    assert by_studio("image") and by_studio("video") and by_studio("assistant")


def test_no_fake_available_flags():
    """API features must not claim to work without credentials."""
    ks = KeyStore.__new__(KeyStore)
    ks.path = __import__("pathlib").Path("/nonexistent/secrets.json")
    chat = ChatProvider(ProviderConfig(provider="openai", base_url="https://x.invalid/v1"), ks)
    ok, why = chat.available()
    assert ok is False and "key" in why.lower()
    img = ImageProvider(ProviderConfig(provider="openai", base_url="https://x.invalid/v1",
                                       image_model="m"), ks)
    ok, why = img.available()
    assert ok is False
    with pytest.raises(ProviderError):
        img.generate("a cat")


def test_keystore_roundtrip(tmp_path):
    ks = KeyStore(tmp_path / "secrets.json")
    assert ks.get_key("openai") is None
    ks.set_key("openai", "sk-test-1234567890abcdef")
    assert ks.get_key("openai") == "sk-test-1234567890abcdef"
    raw = (tmp_path / "secrets.json").read_text()
    assert "sk-test-1234567890abcdef" not in raw   # never stored in plain text
    assert "openai" in ks.providers_with_keys()
    ks.delete_key("openai")
    assert ks.get_key("openai") is None


def test_assistant_offline_answers():
    r = assistant.answer("How do I export for YouTube?")
    assert r.source == "local-kb" and "YouTube" in r.text
    r2 = assistant.answer("what is the meaning of life")
    assert "offline guidance" in r2.text   # unknown questions say so honestly


def test_generators():
    titles = assistant.suggest_titles("Coffee", n=3)
    assert len(titles) == 3 and all("Coffee" in t for t in titles)
    tags = assistant.suggest_hashtags("coffee brewing", n=6)
    assert len(tags) <= 6 and all(t.startswith("#") for t in tags)
    script = assistant.video_script("My Title", ["point a", "point b"])
    assert "HOOK" in script and "point a" in script
    prompt = assistant.image_prompt("a cat", "anime")
    assert "a cat" in prompt and "anime" in prompt
    rec = assistant.recommend_export("tiktok", 30, low_end=False)
    assert rec["preset_id"] == "tiktok-1080" and rec["estimated_size_mb"] > 0
    rec_low = assistant.recommend_export("youtube", 600, low_end=True)
    assert rec_low["preset_id"] == "web-720"
