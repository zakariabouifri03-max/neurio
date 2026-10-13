#!/usr/bin/env python3
"""Original UI icon set for BlockStrike Royale (HUD, shop, menus).

Every icon is drawn from code with simple shapes in one flat style so the HUD
and the menus share the same visual language.

Usage: python3 tools/assets/gen_ui_icons.py [--out DIR] [--preview DIR]
"""
from __future__ import annotations

import argparse
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gen_textures import read_png, write_png, make_sheet  # noqa: E402

SIZE = 64

WHITE = (245, 248, 255, 255)
CREAM = (255, 238, 190, 255)
GOLD = (255, 196, 74, 255)
GOLD_DARK = (196, 140, 30, 255)
CYAN = (120, 220, 255, 255)
BLUE = (86, 150, 245, 255)
GREEN = (110, 210, 120, 255)
RED = (240, 92, 88, 255)
PURPLE = (190, 130, 250, 255)
STEEL = (176, 186, 200, 255)
STEEL_DARK = (108, 118, 132, 255)
DARK = (44, 50, 62, 255)
ORANGE = (250, 160, 70, 255)


class Canvas:
    def __init__(self, size: int = SIZE):
        self.size = size
        self.px = [[(0, 0, 0, 0) for _ in range(size)] for _ in range(size)]

    def set(self, x: int, y: int, color) -> None:
        if 0 <= x < self.size and 0 <= y < self.size:
            self.px[y][x] = color

    def rect(self, x0, y0, x1, y1, color) -> None:
        for y in range(int(y0), int(y1) + 1):
            for x in range(int(x0), int(x1) + 1):
                self.set(x, y, color)

    def rrect(self, x0, y0, x1, y1, color, r=6) -> None:
        for y in range(int(y0), int(y1) + 1):
            for x in range(int(x0), int(x1) + 1):
                cx = min(max(x, int(x0) + r), int(x1) - r)
                cy = min(max(y, int(y0) + r), int(y1) - r)
                if (x - cx) ** 2 + (y - cy) ** 2 <= r * r:
                    self.set(x, y, color)

    def disc(self, cx, cy, radius, color) -> None:
        for y in range(int(cy - radius), int(cy + radius) + 1):
            for x in range(int(cx - radius), int(cx + radius) + 1):
                if (x - cx) ** 2 + (y - cy) ** 2 <= radius * radius:
                    self.set(x, y, color)

    def ring(self, cx, cy, radius, thickness, color) -> None:
        outer = radius + thickness
        for y in range(int(cy - outer), int(cy + outer) + 1):
            for x in range(int(cx - outer), int(cx + outer) + 1):
                d2 = (x - cx) ** 2 + (y - cy) ** 2
                if radius * radius <= d2 <= outer * outer:
                    self.set(x, y, color)

    def line(self, x0, y0, x1, y1, color, width=3) -> None:
        steps = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
        for i in range(steps + 1):
            t = i / max(1, steps)
            x = x0 + (x1 - x0) * t
            y = y0 + (y1 - y0) * t
            self.disc(x, y, width / 2.0, color)

    def poly(self, points, color) -> None:
        ys = [p[1] for p in points]
        for y in range(int(min(ys)), int(max(ys)) + 1):
            xs = []
            for i in range(len(points)):
                xa, ya = points[i]
                xb, yb = points[(i + 1) % len(points)]
                if (ya <= y < yb) or (yb <= y < ya):
                    xs.append(xa + (xb - xa) * (y - ya) / (yb - ya))
            xs.sort()
            for i in range(0, len(xs) - 1, 2):
                self.rect(xs[i], y, xs[i + 1], y, color)

    def arc(self, cx, cy, radius, start_deg, end_deg, color, width=4) -> None:
        steps = 160
        for i in range(steps + 1):
            a = math.radians(start_deg + (end_deg - start_deg) * i / steps)
            self.disc(cx + math.cos(a) * radius, cy + math.sin(a) * radius, width / 2.0, color)


def bullet(c: Canvas) -> None:
    c.rrect(26, 8, 38, 34, GOLD, 4)
    c.rrect(26, 34, 38, 52, GOLD_DARK, 3)
    c.rect(28, 12, 30, 30, CREAM)


def coin(c: Canvas) -> None:
    c.disc(32, 32, 24, GOLD_DARK)
    c.disc(32, 32, 20, GOLD)
    c.ring(32, 32, 12, 3, GOLD_DARK)
    c.disc(32, 32, 5, GOLD_DARK)


def gem(c: Canvas) -> None:
    c.poly([(32, 6), (52, 26), (32, 58), (12, 26)], CYAN)
    c.poly([(32, 6), (42, 26), (32, 58), (22, 26)], (86, 190, 250, 255))
    c.line(12, 26, 52, 26, (200, 245, 255, 255), 2)


def medkit(c: Canvas) -> None:
    c.rrect(8, 18, 56, 54, WHITE, 6)
    c.rect(26, 26, 38, 46, RED)
    c.rect(20, 32, 44, 40, RED)


def bandage(c: Canvas) -> None:
    c.rrect(10, 24, 54, 40, CREAM, 6)
    c.rect(28, 24, 36, 40, (226, 214, 190, 255))
    for x in range(16, 26, 3):
        c.line(x, 26, x, 38, (216, 200, 170, 255), 2)


def cell(c: Canvas) -> None:
    c.rrect(20, 8, 44, 56, STEEL, 5)
    c.rect(26, 20, 38, 44, CYAN)
    c.rect(20, 4, 30, 10, STEEL_DARK)
    c.rect(34, 4, 44, 10, STEEL_DARK)


def armor(c: Canvas) -> None:
    c.poly([(32, 8), (52, 16), (50, 40), (32, 56), (14, 40), (12, 16)], BLUE)
    c.poly([(32, 14), (46, 20), (44, 38), (32, 49), (20, 38), (18, 20)], (150, 195, 255, 255))


def block(c: Canvas) -> None:
    c.poly([(32, 10), (54, 22), (32, 34), (10, 22)], GREEN)
    c.poly([(10, 22), (32, 34), (32, 56), (10, 44)], (70, 160, 80, 255))
    c.poly([(54, 22), (32, 34), (32, 56), (54, 44)], (52, 126, 62, 255))


def crosshair(c: Canvas) -> None:
    c.ring(32, 32, 20, 4, WHITE)
    c.rect(30, 2, 34, 16, WHITE)
    c.rect(30, 48, 34, 62, WHITE)
    c.rect(2, 30, 16, 34, WHITE)
    c.rect(48, 30, 62, 34, WHITE)
    c.disc(32, 32, 3, WHITE)


def fire(c: Canvas) -> None:
    c.poly([(32, 4), (40, 22), (34, 24), (44, 40), (32, 60), (20, 40), (28, 30), (24, 20)], ORANGE)
    c.poly([(32, 22), (36, 34), (32, 52), (28, 34)], (255, 226, 140, 255))


def jump(c: Canvas) -> None:
    c.disc(32, 16, 8, WHITE)
    c.rect(28, 24, 36, 40, WHITE)
    c.line(32, 40, 22, 56, WHITE, 6)
    c.line(32, 40, 42, 56, WHITE, 6)
    c.line(20, 30, 8, 22, WHITE, 5)
    c.line(44, 30, 56, 22, WHITE, 5)


def crouch(c: Canvas) -> None:
    c.disc(32, 14, 8, WHITE)
    c.rect(28, 22, 36, 36, WHITE)
    c.line(28, 36, 18, 56, WHITE, 6)
    c.line(36, 36, 46, 56, WHITE, 6)
    c.line(14, 56, 50, 56, WHITE, 4)


def reload_icon(c: Canvas) -> None:
    c.arc(32, 32, 20, 40, 320, WHITE, 5)
    c.poly([(44, 6), (58, 18), (42, 22)], WHITE)
    c.disc(32, 32, 4, STEEL)


def interact(c: Canvas) -> None:
    c.disc(32, 20, 9, WHITE)
    c.rect(26, 30, 38, 46, WHITE)
    c.line(26, 34, 10, 26, WHITE, 5)
    c.line(38, 34, 54, 26, WHITE, 5)


def backpack(c: Canvas) -> None:
    c.rrect(14, 20, 50, 56, (196, 150, 96, 255), 8)
    c.rrect(22, 30, 42, 46, (150, 110, 66, 255), 4)
    c.rect(16, 26, 48, 32, (222, 180, 120, 255))
    c.rect(24, 12, 40, 22, (150, 110, 66, 255))


def map_icon(c: Canvas) -> None:
    c.poly([(8, 16), (26, 10), (44, 18), (56, 12), (56, 48), (44, 54), (26, 46), (8, 52)], (240, 226, 190, 255))
    c.line(26, 10, 26, 46, (190, 174, 140, 255), 3)
    c.line(44, 18, 44, 54, (190, 174, 140, 255), 3)
    c.disc(36, 34, 5, RED)


def emote(c: Canvas) -> None:
    c.disc(32, 32, 22, (255, 226, 120, 255))
    c.disc(24, 26, 4, DARK)
    c.disc(40, 26, 4, DARK)
    c.arc(32, 36, 12, 20, 160, DARK, 4)


def rifle(c: Canvas) -> None:
    c.rect(8, 28, 52, 38, STEEL_DARK)
    c.rect(20, 20, 34, 28, STEEL)
    c.rect(44, 31, 60, 35, STEEL)
    c.poly([(8, 38), (18, 38), (14, 54), (6, 52)], (150, 110, 66, 255))


def smg(c: Canvas) -> None:
    c.rect(12, 28, 46, 38, STEEL_DARK)
    c.rect(24, 18, 36, 28, STEEL)
    c.rect(42, 30, 54, 34, STEEL)
    c.rect(22, 38, 30, 54, DARK)


def shotgun(c: Canvas) -> None:
    c.rect(8, 28, 46, 36, (150, 110, 66, 255))
    c.rect(30, 31, 60, 35, STEEL)
    c.rect(12, 36, 24, 50, (150, 110, 66, 255))


def sniper(c: Canvas) -> None:
    c.rect(4, 30, 60, 36, STEEL_DARK)
    c.rect(24, 20, 44, 28, DARK)
    c.disc(34, 24, 5, CYAN)
    c.rect(14, 36, 22, 52, (80, 90, 104, 255))


def pistol(c: Canvas) -> None:
    c.rect(22, 26, 46, 34, STEEL_DARK)
    c.rect(18, 34, 26, 52, DARK)
    c.rect(44, 29, 56, 33, STEEL)


def melee(c: Canvas) -> None:
    c.line(14, 52, 44, 16, STEEL, 9)
    c.line(40, 14, 54, 8, WHITE, 7)
    c.rect(12, 48, 24, 60, (150, 110, 66, 255))


def grenade(c: Canvas) -> None:
    c.disc(32, 38, 16, GREEN)
    c.rect(28, 14, 36, 24, STEEL)
    c.line(36, 14, 48, 8, STEEL_DARK, 3)
    c.arc(32, 38, 8, 200, 340, (60, 130, 70, 255), 3)


def gear(c: Canvas) -> None:
    c.ring(32, 32, 16, 6, STEEL)
    for i in range(8):
        a = i * math.pi / 4
        c.rect(32 + math.cos(a) * 22 - 4, 32 + math.sin(a) * 22 - 4,
               32 + math.cos(a) * 22 + 4, 32 + math.sin(a) * 22 + 4, STEEL)
    c.disc(32, 32, 7, DARK)


def shop(c: Canvas) -> None:
    c.poly([(8, 26), (56, 26), (50, 12), (14, 12)], RED)
    c.rect(10, 26, 54, 54, CREAM)
    c.rect(24, 36, 40, 54, (150, 110, 66, 255))
    c.rect(18, 30, 26, 42, CYAN)


def missions(c: Canvas) -> None:
    c.rrect(14, 8, 50, 56, CREAM, 6)
    for y in (20, 32, 44):
        c.disc(22, y, 5, GREEN if y != 32 else GOLD)
        c.rect(30, y - 2, 44, y + 2, (140, 132, 120, 255))


def rank(c: Canvas) -> None:
    c.poly([(32, 6), (54, 20), (46, 54), (32, 44), (18, 54), (10, 20)], GOLD)
    c.poly([(32, 14), (46, 23), (40, 46), (32, 39), (24, 46), (18, 23)],
           (255, 226, 140, 255))


def trophy(c: Canvas) -> None:
    c.poly([(18, 10), (46, 10), (44, 34), (20, 34)], GOLD)
    c.arc(16, 18, 8, 90, 270, GOLD_DARK, 4)
    c.arc(48, 18, 8, -90, 90, GOLD_DARK, 4)
    c.rect(28, 34, 36, 46, GOLD_DARK)
    c.rect(20, 46, 44, 54, GOLD)


def friends(c: Canvas) -> None:
    c.disc(24, 22, 9, WHITE)
    c.disc(44, 26, 7, (200, 210, 225, 255))
    c.poly([(8, 52), (40, 52), (40, 40), (8, 40)], WHITE)
    c.poly([(36, 52), (58, 52), (58, 42), (36, 42)], (200, 210, 225, 255))


def team_icon(c: Canvas) -> None:
    c.disc(22, 22, 8, BLUE)
    c.disc(42, 22, 8, RED)
    c.rect(14, 32, 30, 52, BLUE)
    c.rect(34, 32, 50, 52, RED)


def ping(c: Canvas) -> None:
    c.ring(32, 40, 6, 5, CYAN)
    c.arc(32, 40, 16, 200, 340, (120, 220, 255, 180), 4)
    c.arc(32, 40, 26, 210, 330, (120, 220, 255, 110), 4)


def lock(c: Canvas) -> None:
    c.rect(14, 30, 50, 58, STEEL)
    c.arc(32, 30, 12, 180, 360, STEEL_DARK, 7)
    c.disc(32, 42, 5, DARK)
    c.rect(30, 42, 34, 52, DARK)


def check(c: Canvas) -> None:
    c.line(14, 34, 28, 48, GREEN, 8)
    c.line(28, 48, 52, 16, GREEN, 8)


def close(c: Canvas) -> None:
    c.line(16, 16, 48, 48, RED, 7)
    c.line(48, 16, 16, 48, RED, 7)


def play(c: Canvas) -> None:
    c.poly([(20, 10), (54, 32), (20, 54)], GREEN)


def pause(c: Canvas) -> None:
    c.rrect(16, 12, 28, 52, WHITE, 4)
    c.rrect(36, 12, 48, 52, WHITE, 4)


def clock(c: Canvas) -> None:
    c.disc(32, 32, 24, WHITE)
    c.disc(32, 32, 20, (60, 68, 84, 255))
    c.line(32, 32, 32, 18, WHITE, 4)
    c.line(32, 32, 44, 36, WHITE, 4)


def zone(c: Canvas) -> None:
    c.ring(32, 32, 26, 4, CYAN)
    c.ring(32, 32, 16, 4, (120, 220, 255, 160))
    c.disc(32, 32, 5, WHITE)


def helmet(c: Canvas) -> None:
    c.arc(32, 34, 20, 180, 360, STEEL, 10)
    c.rect(12, 34, 52, 42, STEEL_DARK)
    c.rect(20, 36, 44, 42, (30, 36, 46, 255))


def flag(c: Canvas) -> None:
    c.rect(18, 8, 24, 58, STEEL)
    c.poly([(24, 12), (54, 20), (24, 34)], GREEN)


def bolt(c: Canvas) -> None:
    c.poly([(36, 6), (18, 34), (30, 34), (24, 58), (46, 28), (32, 28)], GOLD)


ICONS = {
    "icon_coin": coin, "icon_gem": gem, "icon_ammo": bullet, "icon_medkit": medkit,
    "icon_bandage": bandage, "icon_cell": cell, "icon_armor": armor, "icon_build": block,
    "icon_crosshair": crosshair, "icon_fire": fire, "icon_jump": jump, "icon_crouch": crouch,
    "icon_reload": reload_icon, "icon_interact": interact, "icon_backpack": backpack,
    "icon_map": map_icon, "icon_emote": emote, "icon_weapon_ar": rifle, "icon_weapon_smg": smg,
    "icon_weapon_shotgun": shotgun, "icon_weapon_sniper": sniper, "icon_weapon_pistol": pistol,
    "icon_weapon_melee": melee, "icon_grenade": grenade, "icon_settings": gear,
    "icon_shop": shop, "icon_missions": missions, "icon_rank": rank, "icon_trophy": trophy,
    "icon_friends": friends, "icon_team": team_icon, "icon_ping": ping, "icon_lock": lock,
    "icon_check": check, "icon_close": close, "icon_play": play, "icon_pause": pause,
    "icon_clock": clock, "icon_zone": zone, "icon_helmet": helmet, "icon_flag": flag,
    "icon_bolt": bolt,
}


def build(out_dir: str) -> list[str]:
    os.makedirs(out_dir, exist_ok=True)
    written = []
    for name, draw in sorted(ICONS.items()):
        canvas = Canvas()
        draw(canvas)
        path = os.path.join(out_dir, name + ".png")
        write_png(path, canvas.px)
        written.append(path)
    return written


def main() -> int:
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=os.path.join(root, "blockstrike-royale", "assets",
                                                 "icons", "ui"))
    ap.add_argument("--preview", default=os.path.join(root, "blockstrike-royale", "docs",
                                                      "preview"))
    args = ap.parse_args()
    written = build(args.out)
    for path in written:
        w, h, _px = read_png(path)
        assert (w, h) == (SIZE, SIZE), path
    make_sheet(written, os.path.join(args.preview, "ui_icons_preview.png"), scale=2)
    print(f"wrote {len(written)} ui icons to {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
