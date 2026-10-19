"""Simple tests for Neurio processor — run without internet/GUI."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))

from PIL import Image, ImageDraw
from processor import enhance_quality, _fallback_remove_background, process_image, save_image_pil, HAS_REMBG, HAS_CV2
import tempfile, os

def test_enhance_upscale():
    img = Image.new("RGB", (100, 80), "white")
    d = ImageDraw.Draw(img)
    d.rectangle([20,20,80,60], fill="red")
    out = enhance_quality(img, scale=2, sharpen_factor=1.4)
    assert out.size == (200,160), f"Expected 200x160 got {out.size}"
    print("✓ enhance 2x")

    out4 = enhance_quality(img, scale=4, sharpen_factor=1.3)
    assert out4.size == (400,320)
    print("✓ enhance 4x")

def test_fallback_bg():
    img = Image.new("RGB", (200,200), "white")
    d = ImageDraw.Draw(img)
    d.ellipse([40,40,160,160], fill="#e63946")
    out = _fallback_remove_background(img)
    assert out.mode == "RGBA"
    # corners should be transparent (white bg)
    assert out.getpixel((5,5))[3] == 0, "Corner should be transparent"
    assert out.getpixel((100,100))[3] == 255, "Center should be opaque"
    print("✓ fallback bg removal")

def test_process_no_bg():
    img = Image.new("RGB", (120,120), "#87ceeb")
    ImageDraw.Draw(img).ellipse([30,30,90,90], fill="red")
    with tempfile.NamedTemporaryFile(suffix=".jpg", delete=False) as tmp:
        img.save(tmp.name, "JPEG")
        tmp_path = tmp.name
    try:
        out = process_image(tmp_path, remove_bg=False, enhance=True, scale=2)
        assert out.size == (240,240)
        print("✓ process no_bg")
    finally:
        os.unlink(tmp_path)

def test_save_formats():
    img = Image.new("RGBA", (50,50), (255,0,0,128))
    with tempfile.TemporaryDirectory() as td:
        for ext in [".png",".jpg",".webp"]:
            p = Path(td) / f"out{ext}"
            save_image_pil(img, str(p))
            assert p.exists() and p.stat().st_size > 0
            print(f"✓ save {ext}")
    
def test_full_fallback_pipeline():
    # White bg product image through full pipeline using fallback
    img = Image.new("RGB", (400,300), "white")
    ImageDraw.Draw(img).rectangle([100,50,300,250], fill="#1d3557")
    with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
        img.save(tmp.name)
        tmp_path = tmp.name
    try:
        out = process_image(tmp_path, remove_bg=True, enhance=True, scale=2, sharpen=1.3, denoise=False)
        assert out.mode == "RGBA"
        assert out.size == (800,600)
        print("✓ full fallback pipeline")
    finally:
        os.unlink(tmp_path)

if __name__ == "__main__":
    print(f"HAS_REMBG={HAS_REMBG} HAS_CV2={HAS_CV2}")
    test_enhance_upscale()
    test_fallback_bg()
    test_process_no_bg()
    test_save_formats()
    test_full_fallback_pipeline()
    print("\n✓ All tests passed — Neurio ready!")
