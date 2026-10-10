import pytest
from PIL import Image

from adzak.services import image_ops


@pytest.fixture()
def img():
    return Image.new("RGBA", (200, 100), (200, 60, 60, 255))


def test_resize_crop_rotate_flip(img):
    r = image_ops.resize(img, 100, 100, keep_aspect=True)
    assert r.width <= 100 and r.height <= 100
    c = image_ops.crop(img, (10, 10, 110, 60))
    assert c.size == (100, 50)
    rot = image_ops.rotate(img, 90)
    assert rot.size[0] == pytest.approx(100, abs=2)  # w/h swapped
    f = image_ops.flip(img, horizontal=True)
    assert f.size == img.size
    with pytest.raises(image_ops.ImageOpError):
        image_ops.crop(img, (10, 10, 5, 50))


def test_adjust_changes_pixels(img):
    dark = image_ops.adjust(img, brightness=0.3)
    assert dark.getpixel((100, 50))[0] < img.getpixel((100, 50))[0]
    gray = image_ops.adjust(img, saturation=0.0)
    r, g, b, _ = gray.getpixel((100, 50))
    assert max(r, g, b) - min(r, g, b) < 8        # nearly grey
    shifted = image_ops.adjust(img, hue=120)
    assert shifted.getpixel((100, 50)) != img.getpixel((100, 50))


def test_curves():
    ramp = Image.new("RGB", (256, 1))
    ramp.putdata([(i, i, i) for i in range(256)])
    ramp = ramp.convert("RGBA")
    inverted = image_ops.curves_adjust(ramp, [(0, 255), (255, 0)])
    assert inverted.getpixel((0, 0))[0] == 255
    assert inverted.getpixel((255, 0))[0] == 0


def test_filters_all_run(img):
    for name in image_ops.FILTERS:
        out = image_ops.apply_filter(img, name)
        assert out.size[0] > 0
    with pytest.raises(image_ops.ImageOpError):
        image_ops.apply_filter(img, "nope")


def test_background_removal():
    img = Image.new("RGBA", (120, 120), (0, 255, 0, 255))
    from PIL import ImageDraw
    d = ImageDraw.Draw(img)
    d.rectangle([40, 40, 80, 80], fill=(255, 0, 0, 255))
    out = image_ops.remove_uniform_background(img, (0, 255, 0), tolerance=30)
    assert out.getpixel((5, 5))[3] == 0          # green gone
    assert out.getpixel((60, 60))[3] == 255      # red kept
    out2 = image_ops.remove_edges_background(img, tolerance=30)
    assert out2.getpixel((5, 5))[3] == 0
    assert out2.getpixel((60, 60))[3] == 255


def test_text_shapes_composite(tmp_path):
    base = Image.new("RGBA", (300, 150), (255, 255, 255, 255))
    with_text = image_ops.draw_text(base, "ADZAK", 10, 10, size=32,
                                    color="#111111", outline=2)
    assert with_text.size == base.size
    assert with_text.tobytes() != base.tobytes()
    shaped = image_ops.draw_shape(base, "ellipse", (10, 10, 110, 110), fill="#3b6ef5")
    assert shaped.getpixel((60, 60))[:3] != (255, 255, 255)
    layers = [(base, 0, 0, 1.0), (Image.new("RGBA", (50, 50), (255, 0, 0, 255)), 20, 20, 0.5)]
    comp = image_ops.composite_layers(layers, 300, 150)
    assert comp.size == (300, 150)


def test_save_formats(tmp_path, img):
    for ext in ("png", "jpg", "webp", "bmp", "tiff"):
        out = tmp_path / f"out.{ext}"
        image_ops.save_image(img, out)
        assert out.is_file() and out.stat().st_size > 0
    with pytest.raises(image_ops.ImageOpError):
        image_ops.save_image(img, tmp_path / "bad.xyz")


def test_checker_preview(img):
    prev = image_ops.make_checker_preview(img, square=8)
    assert prev.size == img.size
