from adzak.core.i18n import (LANGUAGES, Translator, known_keys,
                              languages_missing_translations)


def test_all_languages_have_every_string():
    missing = languages_missing_translations()
    for lang, keys in missing.items():
        assert keys == [], f"{lang} is missing: {keys[:5]}"


def test_rtl_arabic():
    t = Translator("ar")
    assert t.is_rtl()
    assert Translator("en").is_rtl() is False
    assert Translator("fr").is_rtl() is False
    assert Translator("es").is_rtl() is False


def test_translation_formatting_and_fallback():
    t = Translator("fr")
    assert "Fichier introuvable" in t.tr("error.file_not_found", path="/x/y.mp4")
    t2 = Translator("zz")            # unknown language falls back to English
    assert t2.language == "en"
    assert t2.tr("menu.file") == "&File"
    assert t2.tr("no.such.key") == "no.such.key"


def test_languages_list():
    assert set(LANGUAGES) == {"en", "ar", "fr", "es"}
    assert len(known_keys()) > 30
