"""Shots. Each shot draws a frame for a local time, in the ReachMora look:
lit background cached once per shot, vector puppets pasted per frame, hand-lettered
pop labels cued from the sentence times, stamps, charts, counters, polaroids."""
import math

import numpy as np
from PIL import Image, ImageDraw

import fx
import kit
import sets
from kit import (BLUE, CREAM, GOLD, GREY, GREY_D, H, INK, INK_SOFT, LIME, NAVY, NAVY_2, NIGHT, PAPER,
                 RED, RED_DEEP, W, WHITE, clamp, draw_char, ease_io, ease_out, font, grain, ic_arrow,
                 ic_camera, ic_cassette, ic_chart, ic_chemical, ic_film,
                 ic_medal, ic_newspaper, ic_pixels, ic_print, ic_sensor, ic_tv, icon, ink_circle,
                 ink_rect, ink_line, ink_rect as _ir, lerp, night_light, overshoot, paper, place_char,
                 poly, seg, text, text_plain, vignette)


# ------------------------------------------------------------------ helpers
def fit(img, w, h):
    return img.resize((w, h), Image.LANCZOS)


class Shot:
    """Base shot: prepares a lit background once, then draws per frame."""
    kind = "base"

    def __init__(self, start, end, **kw):
        self.start, self.end = start, end
        self.dur = max(0.2, end - start)
        self.kw = kw
        self._bg = None
        self._sprites = {}

    # -- setup -----------------------------------------------------------
    def build(self):
        img = Image.new("RGB", (W, H), NIGHT)
        pools = []
        img, pools = self.set(img)
        if self.kw.get("night", True) and pools is not None:
            img = night_light(img, pools)
        img = vignette(img, 0.35)
        self._bg = img
        return img

    def set(self, img):
        return img, []

    def char(self, who, pose="stand", expr="neutral", s=1.0, seated=False):
        key = (who, pose, expr, s, seated)
        if key not in self._sprites:
            self._sprites[key] = draw_char(None, 0, 0, s, who, pose, expr, seated=seated)
        return self._sprites[key]

    def put(self, img, who, x, y, s=1.0, pose="stand", expr="neutral", seated=False, alpha=255):
        sp, anc = self.char(who, pose, expr, s, seated)
        place_char(img, sp, anc, x, y, 1.0, alpha)

    # -- camera ----------------------------------------------------------
    def camera(self, t, push=0.075, shake=0.0, seed=0):
        tt = clamp(t - self.start, 0.0, self.dur)
        k = 1.0 + push * (tt / self.dur)
        w, h = int(W / k), int(H / k)
        cx, cy = W / 2, H / 2
        if shake:
            rng = np.random.default_rng(seed + int(t * 60))
            cx += rng.uniform(-1, 1) * shake * W * 0.5
            cy += rng.uniform(-1, 1) * shake * H * 0.5
        x0 = int(clamp(cx - w / 2, 0, W - w))
        y0 = int(clamp(cy - h / 2, 0, H - h))
        return x0, y0, w, h

    def frame(self, t):
        img = self._bg.copy() if self._bg is not None else self.build().copy()
        img = self.draw(img, t)
        x0, y0, w, h = self.camera(t, self.kw.get("push", 0.022),
                                   self.kw.get("shake", 0.0), hash(self.kind) % 100)
        if (w, h) != (W, H):
            img = img.crop((x0, y0, x0 + w, y0 + h)).resize((W, H), Image.BILINEAR)
        return img

    def draw(self, img, t):
        return img

    # -- cue timing ------------------------------------------------------
    def cues(self):
        """{word: local_time} from this shot's own sentences (the skill's rule)."""
        out = {}
        for s in self.kw.get("sents", []):
            for w in s["text"].replace(",", " ").replace(".", " ").split():
                key = w.strip("\"'?!;:").lower()
                if key and key not in out:
                    out[key] = s["start"]
        return out

    def at(self, word, default=0.0):
        """Local time of a word inside this shot."""
        c = self.cues()
        w = word.lower()
        if w in c:
            return max(0.0, c[w] - self.start)
        for k, v in c.items():
            if k.startswith(w) or w.startswith(k):
                return max(0.0, v - self.start)
        return default

    def labels(self, img, t, specs):
        """specs: [(text, (x,y), word, style)]"""
        for spec in specs:
            s, c, w = spec[0], spec[1], spec[2]
            style = spec[3] if len(spec) > 3 else {}
            age = t - self.at(w, 0.2)
            sp = style.get("sprite")
            if sp is None:
                sp = fx.label_sprite(s, style.get("size", 72), style.get("fill", LIME),
                                     style.get("f", "brush"), style.get("ow", 11))
                style["sprite"] = sp
            maxw = 1180
            if sp.size[0] > maxw:
                k = maxw / sp.size[0]
                sp = sp.resize((maxw, max(2, int(sp.size[1] * k))), Image.LANCZOS)
            w2, h2 = sp.size
            cx_ = clamp(c[0], 170 + w2 / 2, W - 170 - w2 / 2)
            cy_ = clamp(c[1], 240 + h2 / 2, H - 160 - h2 / 2)
            fx.paste_pop(img, sp, (cx_, cy_), age, 0.32, style.get("anchor", "mm"))
        return img


# ------------------------------------------------------------------ scenes
class ChapterShot(Shot):
    kind = "chapter"

    def build(self):
        return Image.new("RGB", (W, H), (14, 18, 32))

    def frame(self, t):
        img = Image.new("RGB", (W, H), (14, 18, 32))
        fx.chapter(img, self.kw["title"], clamp(t / 0.5), self.kw.get("sub", ""))
        return img


class LabShot(Shot):
    kind = "lab"

    def set(self, img):
        img, pools = sets.lab(img, self.kw.get("night", True), self.kw.get("seed", 1))
        self.pools = pools
        return img, pools

    def draw(self, img, t):
        cfg = self.kw
        people = cfg.get("people", [("sasson", 620, 1010, 1.25, "stand", "neutral")])
        for (who, x, y, s, pose, expr) in people:
            self.put(img, who, x, y, s, pose, expr)
        self.labels(img, t, cfg.get("labels", []))
        return img


class BoardShot(Shot):
    kind = "board"

    def set(self, img):
        img, pools = sets.boardroom(img, self.kw.get("night", True))
        return img, pools

    def build(self):
        img, pools = sets.boardroom(Image.new("RGB", (W, H)), self.kw.get("night", True))
        if self.kw.get("night", True):
            img = night_light(img, pools)
        return vignette(img, 0.35)

    def draw(self, img, t):
        cfg = self.kw
        for (who, x, y, s, pose, expr) in cfg.get("people", []):
            self.put(img, who, x, y, s, pose, expr, seated=cfg.get("seated", True))
        if cfg.get("camera_on_table"):
            k = overshoot(seg(t, 0.05, 0.45))
            ic_camera(ImageDraw.Draw(img), 0, (960, 830), 0.42 * max(0.2, k))
        self.labels(img, t, cfg.get("labels", []))
        if cfg.get("stamp"):
            for (s, c, word, col, size, ang) in cfg["stamp"]:
                age = t - self.at(word, 0.3)
                sp = fx.stamp_sprite(s, size, col, angle=ang)
                fx.paste_stamp(img, sp, c, age)
                if cfg.get("ring") and age > 0.12:
                    fx.marker_ring(img, c, size * 0.75, age - 0.1, col)
        return img


class CloseShot(Shot):
    """A big closeup: one face, one object, one label."""
    kind = "close"

    def set(self, img):
        img, pools = sets.portrait(img, self.kw.get("night", True), self.kw.get("seed", 5))
        return img, pools

    def draw(self, img, t):
        cfg = self.kw
        for (who, x, y, s, pose, expr) in cfg.get("people", []):
            self.put(img, who, x, y, s, pose, expr)
        for (ico, o, s) in cfg.get("icons", []):
            ic = getattr(kit, "ic_" + ico)
            ic(ImageDraw.Draw(img), 0, o, s)
        self.labels(img, t, cfg.get("labels", []))
        if cfg.get("tag"):
            s, x, y, word = cfg["tag"]
            age = t - self.at(word, 0.25)
            fx.lower_third(img, s, cfg.get("tag_sub", ""), (x, y), age, self.dur - 0.2)
        if cfg.get("stamp"):
            for (s, c, word, col, size, ang) in cfg["stamp"]:
                age = t - self.at(word, 0.3)
                fx.paste_stamp(img, fx.stamp_sprite(s, size, col, angle=ang), c, age)
        return img


class GraphicShot(Shot):
    """Flat graphic on void: icons, charts, counters, tiles."""
    kind = "graphic"

    def set(self, img):
        img = Image.new("RGB", (W, H), (18, 24, 44))
        d = ImageDraw.Draw(img)
        for i in range(9):
            x = i * (W / 9)
            d.rectangle((x, 0, x + 1, H), fill=(21, 28, 50))
        return img, []

    def build(self):
        return self.set(Image.new("RGB", (W, H)))[0]

    def draw(self, img, t):
        cfg = self.kw
        d = ImageDraw.Draw(img)
        for it in cfg.get("items", []):
            kind = it[0]
            if kind == "icon":
                _, name, o, s, word = it
                k = overshoot(seg(t, self.at(word, 0.1) - 0.15, self.at(word, 0.1) + 0.2))
                if k > 0.02:
                    icon(img, name, o, s * max(0.3, k))
            elif kind == "chart":
                _, vals, o, s, word = it
                prog = seg(t, self.at(word, 0.1), self.at(word, 0.1) + 1.1)
                d.line((o[0] - 300 * s, o[1] + 180 * s, o[0] + 300 * s, o[1] + 180 * s), fill=INK, width=8)
                d.line((o[0] - 300 * s, o[1] + 180 * s, o[0] - 300 * s, o[1] - 220 * s), fill=INK, width=8)
                for i, v in enumerate(vals):
                    bx = o[0] - 260 * s + i * 150 * s
                    vv = v * clamp(prog * 4 - i * 0.6)
                    bh = 380 * s * vv
                    if bh > 2:
                        kit.shadow_box(d, (bx, o[1] + 176 * s - bh, bx + 96 * s, o[1] + 176 * s),
                                       LIME if i == len(vals) - 1 else CREAM, 4, (8, 8), INK, 6)
            elif kind == "counter":
                _, target, o, s, word, suffix = it
                prog = seg(t, self.at(word, 0.1), self.at(word, 0.1) + 0.9)
                val = int(target * ease_out(prog))
                kit.text(d, o, f"{val}{suffix}", size=int(150 * s), f="marker", fill=LIME, ow=12, anchor="mm")
            elif kind == "tiles":
                _, names, y, s, word = it[:5]
                n = len(names)
                span = min(420, (W - 420) / max(1, n)) * s
                for i, nm in enumerate(names):
                    x = W / 2 + (i - (n - 1) / 2) * span
                    k = overshoot(seg(t, self.at(word, 0.1) - 0.2 + i * 0.13, self.at(word, 0.1) + 0.12 + i * 0.13))
                    if k > 0.02:
                        icon(img, nm, (x, y), s * 0.92 * max(0.3, k))
            elif kind == "pixels":
                _, o, s, word = it
                prog = seg(t, self.at(word, 0.1), self.at(word, 0.1) + 2.2)
                ic_pixels(d, 0, o, s, filled=prog)
            elif kind == "arrow":
                _, o, s, up, word = it
                k = overshoot(seg(t, self.at(word, 0.1), self.at(word, 0.1) + 0.5))
                if k > 0.02:
                    ic_arrow(d, 0, o, s * max(0.2, k), up=up)
        self.labels(img, t, cfg.get("labels", []))
        return img


class DocumentShot(Shot):
    kind = "doc"

    def set(self, img):
        img, pools = sets.desk(img, True)
        return img, pools

    def draw(self, img, t):
        cfg = self.kw
        d = ImageDraw.Draw(img)
        if cfg.get("paper") == "patent":
            k = ease_out(seg(t, 0.1, 0.8))
            x0 = int(lerp(2100, 430, k))
            paper(d, (x0, 190, x0 + 860, 960), PAPER, 9, 4, 6, (10, 10))
            d = ImageDraw.Draw(img)
            text(d, (x0 + 54, 250), "UNITED STATES PATENT", size=40, f="marker", fill=INK, ow=3)
            text(d, (x0 + 54, 322), "ELECTRONIC STILL CAMERA", size=34, f="kalam_b", fill=(60, 58, 54), ow=0)
            d.line((x0 + 54, 380, x0 + 800, 380), fill=INK, width=6)
            for i in range(8):
                d.line((x0 + 54, 430 + i * 58, x0 + 780 - (i % 3) * 80, 430 + i * 58), fill=(176, 170, 158), width=5)
            if cmd := cfg.get("stamp_patent"):
                age = t - self.at("nineteen", 0.4) - 0.4
                fx.paste_stamp(img, fx.stamp_sprite("1977", 110, RED, angle=-9), (1120, 790), age)
            if cfg.get("label_patent"):
                self.labels(img, t, [(cfg["label_patent"], (1500, 330), "patented", {"size": 56})])
        elif cfg.get("paper") == "news":
            k = ease_out(seg(t, 0.1, 0.8))
            cx = int(lerp(2400, 960, k))
            ic_newspaper(d, 0, (cx, 540), 1.35)
            if k > 0.85:
                fx.paste_stamp(img, fx.stamp_sprite("CHAPTER 11", 96, RED, angle=-7), (cx, 760),
                               t - self.at("bankruptcy", 0.5) - 0.1)
        return img


class BlackShot(Shot):
    kind = "black"

    def build(self):
        return Image.new("RGB", (W, H), (14, 18, 32))

    def frame(self, t):
        img = Image.new("RGB", (W, H), (14, 18, 32))
        d = ImageDraw.Draw(img)
        lines = self.kw.get("lines", [])
        for i, (s, size, f, col) in enumerate(lines):
            a = clamp((t - 0.18 - i * 0.35) / 0.45)
            c = tuple(int(v * (0.25 + 0.75 * a)) for v in col)
            text(d, (W / 2, H / 2 - 40 - (len(lines) - 1) * 62 + i * 130), s, size=size, f=f, fill=c,
                 ow=8 if f != "kalam" else 0, anchor="mm")
        return img


class SplitShot(Shot):
    kind = "split"

    def build(self):
        img = Image.new("RGB", (W, H), (16, 22, 40))
        return img

    def frame(self, t):
        img = Image.new("RGB", (W, H), (16, 22, 40))
        d = ImageDraw.Draw(img)
        d.rectangle((0, 0, W / 2 - 4, H), fill=(20, 26, 46))
        d.line((W / 2, 0, W / 2, H), fill=INK, width=10)
        # left: a perfect film photo
        photo = Image.new("RGB", (760, 520), (120, 150, 170))
        pd = ImageDraw.Draw(photo)
        for i in range(9):
            pd.rectangle((0, 60 + i * 62, 760, 60 + i * 62 + 20), fill=(100, 132, 156))
        pd.ellipse((250, 120, 500, 370), fill=(226, 196, 168))
        pd.ellipse((320, 210, 356, 246), fill=INK)
        pd.ellipse((400, 210, 436, 246), fill=INK)
        pd.arc((330, 270, 430, 340), 20, 160, fill=INK, width=8)
        img.paste(photo, (150, 280))
        d.rectangle((150, 280, 910, 800), outline=INK, width=8)
        # right: 100x100 static
        pix = Image.new("RGB", (760, 520), (30, 32, 38))
        pdd = ImageDraw.Draw(pix)
        rng = np.random.default_rng(7)
        n = 64
        cw, ch = 760 // n, 520 // 40
        for i in range(n):
            for j in range(40):
                v = 60 + 150 * rng.random()
                if ((i - 30) ** 2 / 200 + (j - 18) ** 2 / 90) < 1:
                    v = max(v, 140 + 60 * rng.random())
                g = int(v)
                pdd.rectangle((i * cw, j * ch, i * cw + cw, j * ch + ch), fill=(g, g, g - 4))
        img.paste(pix, (1010, 280))
        d.rectangle((1010, 280, 1770, 800), outline=INK, width=8)
        self.labels(img, t, self.kw.get("labels", []))
        text(d, (530, 900), "FILM", size=60, f="marker", fill=CREAM, ow=8, anchor="mm")
        lab = fx.label_sprite("NO FILM", 60, kit.LIME, "marker", 8)
        fx.paste_pop(img, lab, (1390, 900), t - 0.9, 0.3)
        return img


class PolaroidShot(Shot):
    kind = "polaroid"

    def build(self):
        img, _ = sets.boardroom(Image.new("RGB", (W, H)), True)
        img = night_light(img, [(1520, 330, 620, 1.0)])
        self._inner = img.crop((420, 120, 1500, 860)).resize((760, 524), Image.LANCZOS)
        bg = Image.new("RGB", (W, H), (12, 16, 28))
        d = ImageDraw.Draw(bg)
        for i in range(40):
            d.ellipse((i * 61, 900 + (i % 4) * 20, i * 61 + 5, 905 + (i % 4) * 20), fill=(30, 38, 58))
        return vignette(bg, 0.5)

    def draw(self, img, t):
        k = seg(t, 0.15, 0.8)
        if k > 0:
            fr = fx.polaroid(img, self._inner, (W / 2, H / 2 - 40), t - 0.15)
        flash = 1.0 - seg(t, 0.05, 0.4)
        if flash > 0:
            img = fx.shutter_flash(img, flash * 0.8)
        if t > 1.4:
            k2 = seg(t, 1.5, 2.0)
            if k2 > 0:
                d = ImageDraw.Draw(img)
                text(d, (W / 2, H - 96), "THE ARITHMETIC WON.", size=76,
                     f="brush", fill=CREAM, ow=10, anchor="mm")
        return img


class MedalShot(Shot):
    kind = "medal"

    def build(self):
        img = kit.gradient(W, H, (58, 78, 116), (214, 206, 186))
        d = ImageDraw.Draw(img)
        for i in range(14):
            x = i * 150
            d.rectangle((x, 0, x + 70, H * 0.55), fill=(196, 190, 176) if i % 2 else (204, 198, 184))
        d.rectangle((0, H * 0.55, W, H), fill=(176, 170, 156))
        d.line((0, H * 0.55, W, H * 0.55), fill=INK, width=7)
        self.pools = []
        return img

    def draw(self, img, t):
        d = ImageDraw.Draw(img)
        k = overshoot(seg(t, 0.1, 0.7))
        if k > 0.02:
            ic_medal(d, 0, (W / 2 + 420, 470), 0.95 * max(0.3, k))
        for (who, x, y, s, pose, expr) in self.kw.get("people", []):
            self.put(img, who, x, y, s, pose, expr)
        self.labels(img, t, self.kw.get("labels", []))
        if self.kw.get("stamp"):
            for (s, c, word, col, size, ang) in self.kw["stamp"]:
                age = t - self.at(word, 0.4)
                fx.paste_stamp(img, fx.stamp_sprite(s, size, col, angle=ang), c, age)
        return img
