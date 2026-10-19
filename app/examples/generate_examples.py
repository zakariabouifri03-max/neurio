#!/usr/bin/env python3
"""Generate before/after examples for docs — no external images needed."""
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).parent.parent))
from processor import enhance_quality, _fallback_remove_background

out_dir = Path(__file__).parent
out_dir.mkdir(exist_ok=True)

def make_product_image(path, bg="white", obj_color="#e63946", size=(800,600)):
    w,h = size
    img = Image.new("RGB", (w,h), bg)
    d = ImageDraw.Draw(img)
    # Product: rounded rect + circle
    d.rounded_rectangle([w*0.25, h*0.15, w*0.75, h*0.75], radius=32, fill=obj_color, outline="white", width=6)
    d.ellipse([w*0.3, h*0.22, w*0.7, h*0.62], fill="white")
    d.ellipse([w*0.38, h*0.32, w*0.62, h*0.52], fill=obj_color)
    # Shadow
    # Text
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 28)
    except:
        font = ImageFont.load_default()
    d.text((w*0.5, h*0.82), "PRODUCT", anchor="mm", font=font, fill="#1d3557")
    img.save(path, quality=95)
    return img

def make_portrait_image(path, size=(600,800)):
    w,h = size
    img = Image.new("RGB", (w,h), "#87ceeb")
    d = ImageDraw.Draw(img)
    # Ground
    d.rectangle([0,h*0.75,w,h], fill="#90be6d")
    # Person silhouette
    # Head
    d.ellipse([w*0.32, h*0.18, w*0.68, h*0.42], fill="#f4a261", outline="#264653", width=4)
    # Body
    d.rounded_rectangle([w*0.25, h*0.4, w*0.75, h*0.78], radius=24, fill="#264653")
    # Arms
    d.ellipse([w*0.15, h*0.42, w*0.30, h*0.66], fill="#f4a261")
    d.ellipse([w*0.70, h*0.42, w*0.85, h*0.66], fill="#f4a261")
    # Text
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 22)
    except:
        font = ImageFont.load_default()
    d.text((w*0.5, h*0.92), "PORTRAIT DEMO", anchor="mm", font=font, fill="white")
    img.save(path, quality=95)
    return img

# Generate inputs
p1 = out_dir / "input_product.jpg"
p2 = out_dir / "input_portrait.jpg"
make_product_image(p1, bg="white", obj_color="#e63946", size=(900,700))
make_portrait_image(p2, size=(700,900))
print(f"Created {p1} {p1.stat().st_size/1024:.1f}KB")
print(f"Created {p2} {p2.stat().st_size/1024:.1f}KB")

# Generate outputs: bg removed + enhance
for inp in [p1, p2]:
    img = Image.open(inp)
    # Fallback bg removal (works for white bg)
    out_bg = _fallback_remove_background(img)
    out_bg.save(out_dir / f"output_{inp.stem}_bg.png", "PNG")
    print(f"BG -> {out_dir / f'output_{inp.stem}_bg.png'}")

    # Enhance 2x
    enh = enhance_quality(img, scale=2, sharpen_factor=1.4, denoise=False, auto_color=True)
    enh.save(out_dir / f"output_{inp.stem}_hd.jpg", "JPEG", quality=95)
    print(f"HD -> {enh.size}")

    # Both
    both = enhance_quality(out_bg, scale=2, sharpen_factor=1.35, denoise=False)
    both.save(out_dir / f"output_{inp.stem}_both.png", "PNG")
    print(f"Both -> {both.size}")

print("Done — examples ready for README")
