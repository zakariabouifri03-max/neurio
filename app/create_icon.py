#!/usr/bin/env python3
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent
OUT_DIR = ROOT / "icons"
OUT_DIR.mkdir(parents=True, exist_ok=True)

# Create 512x512 high-res icon
size = 512
img = Image.new("RGBA", (size, size), (0,0,0,0))
draw = ImageDraw.Draw(img)

# Background gradient-ish: dark outer + blue-purple inner rounded rect
# Outer glow
draw.rounded_rectangle([0,0,size,size], radius=88, fill=(15, 17, 26,255))
# Main card
draw.rounded_rectangle([24,24,size-24,size-24], radius=64, fill=(30, 41, 88,255))
# Inner gradient simulation: two layered rects
draw.rounded_rectangle([28,28,size-28,size-28], radius=60, fill=(37, 99, 235,255))
draw.rounded_rectangle([28,28,size-28, size//2+40], radius=60, fill=(59,130,246,255))
# Mask bottom to keep rounded only at top — easier: just overwrite with second layer but keep rounded
# Highlight circle
draw.ellipse([size//2-120, size//2-160, size//2+120, size//2+80], fill=(255,255,255,22))
# Scissors icon + sparkle representation: draw simple shapes
# Diamond
cx, cy = size//2, size//2 - 34
# Outer diamond glow
draw.regular_polygon((cx, cy, 86), 4, rotation=45, fill=(255,255,255,34))
# Inner diamond
draw.regular_polygon((cx, cy, 68), 4, rotation=45, fill=(255,255,255,245))
# Inner cut (transparent) to make diamond ring? Not needed
# Sparkles: three small stars
for (x,y,s,rot) in [(cx-92, cy-78, 22, 15), (cx+88, cy-62, 18, 30), (cx+94, cy+42, 14, 12)]:
    draw.regular_polygon((x,y,s), 4, rotation=rot, fill=(253, 224, 71,255))
    draw.regular_polygon((x,y,s-6), 4, rotation=rot, fill=(254, 243, 199,255))

# Text NEURIO bottom
try:
    # Try to use a decent font if available
    font_path = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    if Path(font_path).exists():
        font = ImageFont.truetype(font_path, 58)
        font_small = ImageFont.truetype(font_path, 20)
    else:
        font = ImageFont.load_default()
        font_small = ImageFont.load_default()
except:
    font = ImageFont.load_default()
    font_small = ImageFont.load_default()

text = "NEURIO"
# Center text
bbox = draw.textbbox((0,0), text, font=font)
tw = bbox[2]-bbox[0]
th = bbox[3]-bbox[1]
draw.text((cx - tw//2, size-116), text, font=font, fill=(255,255,255,255))
# Subtitle
sub = "BG • HD"
bbox2 = draw.textbbox((0,0), sub, font=font_small)
tw2 = bbox2[2]-bbox2[0]
draw.text((cx - tw2//2, size-64), sub, font=font_small, fill=(255,255,255,180))

# Save
img.save(OUT_DIR / "neurio.png", "PNG")
print(f"Saved {OUT_DIR / 'neurio.png'}")

# Create multi-size ICO
ico_sizes = [(256,256),(128,128),(64,64),(48,48),(32,32),(16,16)]
# Need to create versions that are square and high quality
imgs = []
for s in ico_sizes:
    im = img.resize((s[0], s[1]), Image.LANCZOS)
    imgs.append(im)
# Save as ICO using largest + appended
img.save(OUT_DIR / "neurio.ico", sizes=[(256,256),(128,128),(64,64),(32,32),(16,16)])
print(f"Saved {OUT_DIR / 'neurio.ico'}")

# Also save small png icons for docs
for s in [192,512]:
    small = img.resize((s,s), Image.LANCZOS)
    small.save(OUT_DIR / f"icon-{s}.png")
    print(f"Saved icon-{s}.png")

# Preview 512 already is icon
print("Done")
