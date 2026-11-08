"""Tests for the AI engine pipeline and providers."""

from io import BytesIO

import pytest
from PIL import Image

from anywear_ai import (
    TryOnOptions,
    get_provider,
)
from anywear_ai.categories import normalize_category, placement_for
from anywear_ai.providers.dev_composite import DevCompositeProvider
from anywear_ai.image_utils import remove_uniform_background


def make_person(w=512, h=768) -> bytes:
    img = Image.new("RGB", (w, h), (120, 110, 130))
    Image.new("RGB", (w // 4, h // 5), (200, 170, 150)).resize((w // 4, h // 5))
    img.paste(Image.new("RGB", (w // 4, h // 5), (210, 180, 160)), (w // 4, h // 8))
    out = BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


def make_garment(w=400, h=500) -> bytes:
    img = Image.new("RGB", (w, h), (250, 250, 250))
    img.paste(Image.new("RGB", (w - 80, h - 80), (30, 90, 200)), (40, 40))
    out = BytesIO()
    img.save(out, "PNG")
    return out.getvalue()


class TestCategories:
    @pytest.mark.parametrize(
        "raw,expected",
        [("Shirt", "shirt"), ("Dress", "dress"), ("DENIM JACKET", "jacket"),
         ("trousers", "trousers"), ("PANT", "trousers"), ("skirt", "skirt"),
         (None, "other"), ("hat", "other")],
    )
    def test_normalize(self, raw, expected):
        assert normalize_category(raw) == expected

    def test_placement(self):
        p = placement_for("dress")
        assert p.bottom > 0.8
        assert p.top < 0.3


class TestDevComposite:
    def test_generates_valid_output(self):
        provider = DevCompositeProvider()
        result = provider.generate(make_person(), make_garment(), TryOnOptions(category="dress"))
        img = Image.open(BytesIO(result.output_bytes))
        assert img.size[0] > 0
        assert result.mode == "dev-composite"
        assert result.meta["dev_mode"] is True
        assert result.elapsed_ms >= 0

    def test_output_differs_from_input(self):
        """A real transformation: output must not equal the plain person photo."""
        provider = DevCompositeProvider()
        person = make_person()
        result = provider.generate(person, make_garment(), TryOnOptions(category="shirt"))
        orig = Image.open(BytesIO(person)).convert("RGB")
        out = Image.open(BytesIO(result.output_bytes)).convert("RGB")
        # resize out to orig for comparison
        out = out.resize(orig.size)
        import random

        sample = [out.getpixel((random.randint(0, 500), random.randint(0, 700))) for _ in range(50)]
        orig_sample = [orig.getpixel((random.randint(0, 500), random.randint(0, 700))) for _ in range(50)]
        assert sample != orig_sample

    def test_bad_input_raises(self):
        provider = DevCompositeProvider()
        with pytest.raises(Exception):
            provider.generate(b"not an image", make_garment(), TryOnOptions())

    def test_background_removal(self):
        data = make_garment()
        rgba = remove_uniform_background(Image.open(BytesIO(data)))
        assert rgba.mode == "RGBA"
        assert rgba.getpixel((2, 2))[3] == 0  # corner transparent
        assert rgba.getpixel((200, 250))[3] > 200  # center opaque


class TestFactory:
    def test_default_is_dev(self):
        p = get_provider(name=None, engine_url=None)
        assert p.name == "dev-composite"

    def test_idmvton_selected(self):
        p = get_provider(name="idmvton", engine_url="http://localhost:9999")
        assert p.name == "idmvton"
        assert p.health()["available"] is False

    def test_unknown_raises(self):
        with pytest.raises(ValueError):
            get_provider(name="does-not-exist")
