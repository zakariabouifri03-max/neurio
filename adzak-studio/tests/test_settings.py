from adzak.core.settings import Settings


def test_roundtrip(tmp_home):
    s = Settings(tmp_home / "s.sqlite3")
    assert s.get("ui/theme") == "dark"            # default
    s.set("ui/theme", "light")
    assert s.get("ui/theme") == "light"
    s.set("nested", {"a": [1, 2, 3]})
    assert s.get("nested")["a"] == [1, 2, 3]
    s.delete("ui/theme")
    assert s.get("ui/theme") == "dark"
    s.close()


def test_defaults_exposed(tmp_home):
    s = Settings(tmp_home / "s2.sqlite3")
    d = s.defaults()
    assert d["preview/resolution"] == "half"
    assert d["ui/low_memory_mode"] is False
    s.close()
