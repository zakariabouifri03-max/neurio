#!/usr/bin/env python3
"""
make_pack_art.py — draws every picture the addon needs, procedurally (no stock art).

  python3 tools/make_pack_art.py

Writes:
  addon/behavior_pack/pack_icon.png
  addon/resource_pack/pack_icon.png
  addon/resource_pack/textures/items/neurio_amulet.png        (16x16 item icon)
  addon/resource_pack/textures/ui/neurio_<name>.png           (32x32 form-button icons)

Needs: pillow  (pip install pillow)
"""
from __future__ import annotations

import os
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "addon", "behavior_pack")
RP = os.path.join(ROOT, "addon", "resource_pack")

SKIN = (214, 178, 140, 255)
SKIN_D = (178, 143, 110, 255)
NOSE = (196, 158, 122, 255)
HAIR = (72, 52, 38, 255)
ROBE = (108, 82, 56, 255)
ROBE_D = (74, 55, 38, 255)
EYE = (250, 250, 250, 255)
PUPIL = (58, 42, 32, 255)
MOUTH = (122, 76, 62, 255)
CYAN = (78, 226, 255, 255)
CYAN_D = (24, 120, 168, 255)
BG1 = (18, 34, 44, 255)
BG2 = (30, 58, 70, 255)
GOLD = (240, 200, 90, 255)
EMERALD = (52, 220, 120, 255)
EMERALD_D = (24, 150, 78, 255)
WHITE = (250, 250, 250, 255)


def px(size: int, grid: int) -> Image.Image:
    return Image.new("RGBA", (size, size), (0, 0, 0, 0)), size // grid


def draw_villager(size=64, bg=True) -> Image.Image:
    """Chunky pixel-art villager head + shoulders, drawn on a 64x64 grid (1 unit = 4px)."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    u = size // 16  # 16x16 logical pixels

    def rect(x0, y0, x1, y1, c):
        d.rectangle([x0 * u, y0 * u, (x1 + 1) * u - 1, (y1 + 1) * u - 1], fill=c)

    if bg:
        rect(0, 0, 15, 15, BG1)
        rect(1, 1, 14, 14, BG2)
    # shoulders / robe
    rect(2, 12, 13, 15, ROBE)
    rect(3, 11, 12, 12, ROBE_D)
    rect(6, 12, 9, 15, ROBE_D)
    # head
    rect(4, 4, 11, 11, SKIN)
    rect(4, 4, 11, 4, SKIN_D)
    # hair / cap
    rect(3, 3, 12, 4, HAIR)
    rect(3, 4, 3, 7, HAIR)
    rect(12, 4, 12, 7, HAIR)
    # unibrow + eyes
    rect(5, 6, 10, 6, (92, 66, 48, 255))
    rect(5, 7, 6, 7, EYE)
    rect(9, 7, 10, 7, EYE)
    rect(6, 7, 6, 7, PUPIL)
    rect(10, 7, 10, 7, PUPIL)
    # the famous villager nose
    rect(7, 8, 8, 10, NOSE)
    rect(7, 10, 8, 10, SKIN_D)
    # mouth
    rect(6, 11, 9, 11, MOUTH)
    # AI glow: a circuit line + a node on the cheek
    rect(12, 8, 13, 8, CYAN)
    rect(13, 8, 13, 10, CYAN)
    rect(13, 10, 14, 10, CYAN)
    rect(2, 8, 3, 8, CYAN_D)
    rect(1, 8, 1, 10, CYAN_D)
    return img


def draw_bubble(size=64) -> Image.Image:
    """Speech bubble with 3 dots, drawn over the villager icon."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    u = size // 16

    def rect(x0, y0, x1, y1, c):
        d.rectangle([x0 * u, y0 * u, (x1 + 1) * u - 1, (y1 + 1) * u - 1], fill=c)

    rect(0, 0, 9, 5, WHITE)
    rect(1, 6, 3, 6, WHITE)
    rect(2, 7, 2, 7, WHITE)
    for i, x in enumerate((2, 4, 6)):
        rect(x, 2, x + 1, 3, CYAN_D)
    return img


def make_pack_icon(path, size=256, bubble=True):
    base = draw_villager(64, bg=True)
    if bubble:
        base.alpha_composite(draw_bubble(64))
    out = base.resize((size, size), Image.NEAREST)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    out.save(path)
    return path


AMULET_ART = [
    "................",
    "......GGGG......",
    ".....G....G.....",
    "....G......G....",
    "...G..EEEE..G...",
    "...G.EEEEEEE.G..",
    "....GEEMMMEEG...",
    "....GEEMMMEEG...",
    "....GEEMMMEEG...",
    "....G.EEEEE.G...",
    "...G..EEEE..G...",
    "....G......G....",
    ".....G....G.....",
    "......GGGG......",
    "................",
    "................",
]
AMULET_COLORS = {"G": GOLD, "E": EMERALD, "M": EMERALD_D, ".": None}


def make_item_icon(path, art, colors, scale=1):
    h = len(art)
    w = len(art[0])
    img = Image.new("RGBA", (w * scale, h * scale), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    for y, row in enumerate(art):
        for x, ch in enumerate(row):
            c = colors.get(ch)
            if not c:
                continue
            d.rectangle([x * scale, y * scale, (x + 1) * scale - 1, (y + 1) * scale - 1], fill=c)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)
    return path


def icon_talk(s=32):
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([2, 5, 29, 23], radius=5, fill=(78, 226, 255, 255), outline=(20, 60, 80, 255))
    d.polygon([(9, 23), (13, 23), (8, 30)], fill=(78, 226, 255, 255))
    for i, x in enumerate((9, 15, 21)):
        d.ellipse([x, 12, x + 3, 15], fill=(20, 60, 80, 255))
    return img


def icon_gift(s=32):
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([4, 12, 27, 28], fill=(200, 90, 70, 255), outline=(90, 30, 20, 255))
    d.rectangle([3, 8, 28, 13], fill=(230, 120, 95, 255), outline=(90, 30, 20, 255))
    d.rectangle([14, 8, 18, 28], fill=(250, 220, 120, 255))
    d.ellipse([9, 2, 16, 9], outline=(250, 220, 120, 255), width=2)
    d.ellipse([16, 2, 23, 9], outline=(250, 220, 120, 255), width=2)
    return img


def icon_shop(s=32):
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.polygon([(16, 2), (28, 9), (28, 22), (16, 30), (4, 22), (4, 9)], fill=(52, 220, 120, 255), outline=(16, 110, 60, 255))
    d.polygon([(16, 7), (23, 11), (23, 20), (16, 25), (9, 20), (9, 11)], fill=(120, 245, 175, 255))
    return img


def icon_sell(s=32):
    img = icon_shop(s)
    d = ImageDraw.Draw(img)
    d.line([(6, 26), (26, 6)], fill=(250, 220, 120, 255), width=3)
    return img


def icon_quest(s=32):
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rectangle([7, 3, 25, 29], fill=(238, 226, 190, 255), outline=(120, 96, 60, 255))
    d.ellipse([5, 1, 27, 8], fill=(200, 180, 140, 255), outline=(120, 96, 60, 255))
    d.ellipse([5, 24, 27, 31], fill=(200, 180, 140, 255), outline=(120, 96, 60, 255))
    for y in (11, 15, 19):
        d.rectangle([11, y, 22, y + 1], fill=(120, 96, 60, 255))
    return img


def icon_follow(s=32):
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([6, 4, 14, 12], fill=(240, 200, 90, 255))
    d.rectangle([7, 13, 13, 22], fill=(240, 200, 90, 255))
    d.polygon([(17, 10), (30, 17), (17, 24), (20, 17)], fill=(78, 226, 255, 255))
    d.rectangle([8, 23, 10, 29], fill=(200, 160, 60, 255))
    d.rectangle([11, 23, 13, 29], fill=(200, 160, 60, 255))
    return img


def icon_info(s=32):
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([4, 4, 28, 28], fill=(40, 90, 120, 255), outline=(78, 226, 255, 255), width=2)
    d.ellipse([11, 6, 21, 14], fill=(214, 178, 140, 255))
    d.polygon([(8, 27), (24, 27), (20, 16), (12, 16)], fill=(214, 178, 140, 255))
    return img


def icon_gear(s=32):
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    import math
    cx = cy = 16
    for i in range(8):
        a = i * math.pi / 4
        x = cx + math.cos(a) * 12
        y = cy + math.sin(a) * 12
        d.rectangle([x - 3, y - 3, x + 3, y + 3], fill=(190, 200, 210, 255))
    d.ellipse([5, 5, 27, 27], fill=(190, 200, 210, 255))
    d.ellipse([12, 12, 20, 20], fill=(40, 60, 70, 255))
    return img


def icon_close(s=32):
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.line([(7, 7), (25, 25)], fill=(235, 90, 80, 255), width=5)
    d.line([(25, 7), (7, 25)], fill=(235, 90, 80, 255), width=5)
    return img


def icon_voice(s=32):
    img = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([12, 3, 20, 18], radius=4, fill=(78, 226, 255, 255))
    d.arc([7, 10, 25, 26], start=0, end=180, fill=(78, 226, 255, 255), width=3)
    d.line([(16, 26), (16, 30)], fill=(78, 226, 255, 255), width=3)
    d.line([(10, 30), (22, 30)], fill=(78, 226, 255, 255), width=3)
    return img


def main():
    made = []
    made.append(make_pack_icon(os.path.join(BP, "pack_icon.png"), 256, True))
    made.append(make_pack_icon(os.path.join(RP, "pack_icon.png"), 256, True))
    made.append(make_item_icon(os.path.join(RP, "textures", "items", "neurio_amulet.png"), AMULET_ART, AMULET_COLORS, 1))
    ui = {
        "talk": icon_talk, "gift": icon_gift, "shop": icon_shop, "sell": icon_sell,
        "quest": icon_quest, "follow": icon_follow, "info": icon_info, "gear": icon_gear,
        "close": icon_close, "voice": icon_voice,
    }
    for name, fn in ui.items():
        p = os.path.join(RP, "textures", "ui", f"neurio_{name}.png")
        os.makedirs(os.path.dirname(p), exist_ok=True)
        fn(32).save(p)
        made.append(p)
    print(f"made {len(made)} images:")
    for m in made:
        print("  ", os.path.relpath(m, ROOT))


if __name__ == "__main__":
    main()
