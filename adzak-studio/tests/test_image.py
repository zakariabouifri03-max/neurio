import zipfile

import pytest
from PIL import Image

from adzak.core.errors import AppError
from adzak.image.document import Document, apply_adjustments, export_image


def _doc(w=200, h=100):
    d = Document(w, h, background="#FF0000")
    return d


def test_layers_order_and_undo_redo():
    d = _doc()
    d.add_shape_layer("rectangle", (10, 10, 50, 50), "#00FF00")
    assert len(d.layers) == 2
    d.move_layer(1, -1)
    assert d.layers[0].name == "Rectangle"
    assert d.undo() is True
    assert d.layers[1].name == "Rectangle"
    assert d.redo() is True
    assert d.layers[0].name == "Rectangle"


def test_composite_shows_shape_over_background():
    d = _doc()
    d.add_shape_layer("rectangle", (10, 10, 50, 50), "#00FF00")
    px = d.composite().getpixel((20, 20))
    assert px[1] > 200 and px[0] < 50
    assert d.composite().getpixel((150, 80))[0] > 200  # background red elsewhere


def test_adjustment_layer_is_non_destructive():
    d = _doc()
    before = d.layers[0].image.copy()
    d.add_adjust_layer(brightness=0.5)
    out = d.composite()
    assert out.getpixel((5, 5))[0] >= 255 or out.getpixel((5, 5))[1] > 100
    assert d.layers[0].image.tobytes() == before.tobytes()


def test_crop_rotate_resize_keep_layers_in_sync():
    d = _doc(200, 100)
    d.add_shape_layer("ellipse", (20, 20, 60, 60))
    d.crop((10, 10, 110, 90))
    assert (d.width, d.height) == (100, 80)
    assert all(l.image.size == (100, 80) for l in d.layers if l.image)
    d.rotate(90)
    assert (d.width, d.height) == (80, 100)
    d.resize(40, 50)
    assert (d.width, d.height) == (40, 50)
    assert all(l.image.size == (40, 50) for l in d.layers if l.image)


def test_brush_and_eraser():
    d = Document(60, 60, background="transparent")
    d.brush([(10, 10), (50, 10)], color="#0000FF", size=6)
    assert d.layers[0].image.getpixel((30, 10))[3] == 255
    d.brush([(30, 10)], size=10, erase=True)
    assert d.layers[0].image.getpixel((30, 10))[3] == 0


def test_selection_fill_delete_mask():
    d = Document(50, 50, background="#000000")
    with pytest.raises(AppError):
        d.fill_selection("#FFFFFF")
    d.select_rect((0, 0, 10, 10))
    d.fill_selection("#FFFFFF")
    assert d.layers[0].image.getpixel((5, 5))[:3] == (255, 255, 255)
    d.delete_selection()
    assert d.layers[0].image.getpixel((5, 5))[3] == 0


def test_inpaint_removes_marked_object():
    d = Document(80, 80, background="#20A060")
    d.select_rect((30, 30, 50, 50))
    d.fill_selection("#FF0000")
    d.select_rect((30, 30, 50, 50))
    d.inpaint_selection(radius=3)
    r, g, b, a = d.layers[0].image.getpixel((40, 40))
    assert r < 120 and g > 90  # red patch replaced by surrounding green


def test_grabcut_background_removal_separates_subject():
    d = Document(120, 120, background="#FFFFFF")
    im = d.layers[0].image
    from PIL import ImageDraw
    ImageDraw.Draw(im).rectangle([40, 40, 80, 80], fill=(0, 0, 255, 255))
    d.remove_background(rect=(20, 20, 100, 100), iterations=3)
    alpha = d.layers[0].image.getchannel("A")
    assert alpha.getpixel((60, 60)) == 255
    assert alpha.getpixel((5, 5)) == 0


def test_save_load_roundtrip(tmp_path):
    d = _doc()
    d.add_text_layer("Hello", size=24)
    d.add_adjust_layer(saturation=0.2)
    p = d.save(tmp_path / "x.adzimg")
    with zipfile.ZipFile(p) as z:
        assert "manifest.json" in z.namelist()
    back = Document.load(p)
    assert len(back.layers) == 3
    assert back.layers[2].kind == "adjust" and back.layers[2].params["saturation"] == 0.2
    assert back.layers[0].image.tobytes() == d.layers[0].image.tobytes()


def test_load_damaged_file(tmp_path):
    bad = tmp_path / "bad.adzimg"
    bad.write_bytes(b"nope")
    with pytest.raises(AppError):
        Document.load(bad)


@pytest.mark.parametrize("ext", ["png", "jpg", "webp", "bmp", "tiff", "pdf"])
def test_export_formats(tmp_path, ext):
    d = _doc()
    out = export_image(d, tmp_path / f"o.{ext}", quality=80)
    assert out.stat().st_size > 100
    if ext != "pdf":
        assert Image.open(out).size == (200, 100)


def test_export_rejects_svg_and_bad_quality(tmp_path):
    d = _doc()
    with pytest.raises(AppError):
        export_image(d, tmp_path / "o.svg")
    with pytest.raises(AppError):
        export_image(d, tmp_path / "o.png", quality=0)


def test_export_scale(tmp_path):
    out = export_image(_doc(), tmp_path / "s.png", scale=2)
    assert Image.open(out).size == (400, 200)


def test_curves_and_hue_adjustment():
    img = Image.new("RGBA", (4, 4), (100, 100, 100, 255))
    out = apply_adjustments(img, {"curve": [[0, 0], [100, 200], [255, 255]]})
    assert out.getpixel((0, 0))[0] == 200
    shifted = apply_adjustments(Image.new("RGBA", (2, 2), (255, 0, 0, 255)), {"hue": 120})
    r, g, b, _ = shifted.getpixel((0, 0))
    assert g > r


def test_canvas_limit():
    with pytest.raises(AppError):
        Document(20000, 20000)
