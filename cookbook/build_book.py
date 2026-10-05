#!/usr/bin/env python3
"""Build Grandma Rosie's illustrated comfort-food cookbook (PDF + HTML)."""
from __future__ import annotations

import html
import json
import math
from io import BytesIO
from pathlib import Path
from typing import Iterable

from PIL import Image, ImageEnhance, ImageOps
from reportlab.lib.colors import HexColor, Color
from reportlab.lib.pagesizes import letter
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

HERE = Path(__file__).resolve().parent
ASSETS = HERE / "assets"
DATA = json.loads((HERE / "recipes.json").read_text(encoding="utf-8"))
PDF_OUT = HERE / "Grandma-Rosies-American-Comfort-Food.pdf"
HTML_OUT = HERE / "Grandma-Rosies-American-Comfort-Food.html"

PAGE_W, PAGE_H = letter
M = 42
CONTENT_W = PAGE_W - 2 * M

PAPER = HexColor("#F7F2E8")
PAPER_DARK = HexColor("#EEE6D7")
INK = HexColor("#20372F")
INK_SOFT = HexColor("#52645B")
TOMATO = HexColor("#C65C43")
HONEY = HexColor("#C79A4D")
WHITE = HexColor("#FFFDF8")
LINE = HexColor("#DCD2C0")

FONT_PATHS = {
    "RosieSerif": "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
    "RosieSerifBold": "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
    "RosieSans": "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "RosieSansBold": "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
}
for name, path in FONT_PATHS.items():
    if Path(path).exists():
        pdfmetrics.registerFont(TTFont(name, path))

SERIF = "RosieSerif" if "RosieSerif" in pdfmetrics.getRegisteredFontNames() else "Times-Roman"
SERIF_BOLD = "RosieSerifBold" if "RosieSerifBold" in pdfmetrics.getRegisteredFontNames() else "Times-Bold"
SANS = "RosieSans" if "RosieSans" in pdfmetrics.getRegisteredFontNames() else "Helvetica"
SANS_BOLD = "RosieSansBold" if "RosieSansBold" in pdfmetrics.getRegisteredFontNames() else "Helvetica-Bold"


def wrap_lines(text: str, font: str, size: float, width: float) -> list[str]:
    """Wrap plain text using ReportLab's measured font widths."""
    output: list[str] = []
    for paragraph in str(text).split("\n"):
        if not paragraph:
            output.append("")
            continue
        words = paragraph.split()
        line = ""
        for word in words:
            candidate = word if not line else f"{line} {word}"
            if pdfmetrics.stringWidth(candidate, font, size) <= width:
                line = candidate
            else:
                if line:
                    output.append(line)
                # Keep long URLs readable by breaking at slashes when possible.
                if pdfmetrics.stringWidth(word, font, size) > width:
                    fragment = ""
                    for char in word:
                        if pdfmetrics.stringWidth(fragment + char, font, size) > width and fragment:
                            output.append(fragment)
                            fragment = char
                        else:
                            fragment += char
                    line = fragment
                else:
                    line = word
        if line:
            output.append(line)
    return output


def draw_wrapped(c, text: str, x: float, y: float, width: float,
                 font: str = SANS, size: float = 10, leading: float = 14,
                 color=INK, max_lines: int | None = None) -> float:
    c.setFont(font, size)
    c.setFillColor(color)
    lines = wrap_lines(text, font, size, width)
    if max_lines is not None and len(lines) > max_lines:
        lines = lines[:max_lines]
        if lines:
            lines[-1] = lines[-1].rstrip(" .") + "..."
    for line in lines:
        c.drawString(x, y, line)
        y -= leading
    return y


def fitted_size(text: str, font: str, initial: float, minimum: float, width: float) -> float:
    size = initial
    while size > minimum and pdfmetrics.stringWidth(text, font, size) > width:
        size -= 0.5
    return size


def make_image_reader(path: Path, ratio: float, target_w: int = 1280) -> ImageReader:
    """Crop and gently tune photos to a consistent, print-friendly editorial frame."""
    with Image.open(path) as source:
        source = ImageOps.exif_transpose(source).convert("RGB")
        target_h = int(target_w / ratio)
        framed = ImageOps.fit(source, (target_w, target_h), method=Image.Resampling.LANCZOS,
                              centering=(0.5, 0.5))
        framed = ImageEnhance.Color(framed).enhance(1.04)
        framed = ImageEnhance.Contrast(framed).enhance(1.025)
        out = BytesIO()
        framed.save(out, format="JPEG", quality=86, optimize=True, progressive=True)
        out.seek(0)
        return ImageReader(out)


def draw_bg(c, color=PAPER):
    c.setFillColor(color)
    c.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)


def draw_header(c, right_label="THE ROSIE COLLECTION"):
    c.setFillColor(INK)
    c.setFont(SANS_BOLD, 8)
    c.drawString(M, PAGE_H - 27, "GRANDMA ROSIE")
    c.setFillColor(INK_SOFT)
    c.setFont(SANS, 7.4)
    c.drawRightString(PAGE_W - M, PAGE_H - 27, right_label.upper())
    c.setStrokeColor(LINE)
    c.setLineWidth(0.7)
    c.line(M, PAGE_H - 36, PAGE_W - M, PAGE_H - 36)


def draw_footer(c, page_number: int, left="AMERICAN COMFORT FOOD"):
    c.setStrokeColor(LINE)
    c.setLineWidth(0.7)
    c.line(M, 34, PAGE_W - M, 34)
    c.setFillColor(INK_SOFT)
    c.setFont(SANS, 7.5)
    c.drawString(M, 21, left)
    c.setFillColor(TOMATO)
    c.setFont(SANS_BOLD, 8)
    c.drawRightString(PAGE_W - M, 21, f"{page_number:02d}")


def draw_pill(c, x, y, text, width, fill=WHITE, ink=INK, font_size=8.2):
    c.setFillColor(fill)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.6)
    c.roundRect(x, y - 5, width, 22, 8, fill=1, stroke=1)
    c.setFillColor(ink)
    fitted = font_size
    while fitted > 6.2 and pdfmetrics.stringWidth(text, SANS_BOLD, fitted) > width - 12:
        fitted -= 0.2
    c.setFont(SANS_BOLD, fitted)
    c.drawCentredString(x + width / 2, y + 2, text)


def draw_section_label(c, text, x, y, width=None):
    c.setFillColor(TOMATO)
    c.setFont(SANS_BOLD, 8.2)
    c.drawString(x, y, text.upper())
    if width:
        c.setStrokeColor(LINE)
        c.setLineWidth(0.7)
        c.line(x, y - 6, x + width, y - 6)


def draw_ingredient_col(c, items: list[str], x: float, y: float, width: float,
                        font_size: float = 9.0, leading: float = 12.2) -> float:
    for item in items:
        c.setFillColor(HONEY)
        c.circle(x + 3, y + 3, 2.1, fill=1, stroke=0)
        end = draw_wrapped(c, item, x + 12, y, width - 16,
                           font=SANS, size=font_size, leading=leading, color=INK)
        y = end - 5.1
    return y


def draw_food_mark(c, kind: str, x: float, y: float, scale: float = 1.0):
    """Tiny original vector food illustration, drawn in a 40 x 34 unit box."""
    c.saveState()
    c.translate(x, y)
    c.scale(scale, scale)
    gold = HexColor("#E7B958")
    bun = HexColor("#D9A15C")
    meat = HexColor("#8B4F35")
    cheese = HexColor("#F2CC58")
    green = HexColor("#6B9564")
    red = HexColor("#CF6548")
    white = WHITE

    if kind in {"burger", "sandwich", "sub", "grilled_cheese"}:
        c.setFillColor(bun if kind != "grilled_cheese" else HexColor("#D69A4E"))
        c.roundRect(5, 21, 30, 7, 3, fill=1, stroke=0)
        c.setFillColor(meat if kind in {"burger", "sub"} else cheese)
        c.roundRect(6, 15, 28, 5, 1.5, fill=1, stroke=0)
        c.setFillColor(cheese if kind != "grilled_cheese" else bun)
        c.roundRect(7, 12, 26, 3.5, 1, fill=1, stroke=0)
        c.setFillColor(green)
        c.roundRect(8, 10, 24, 2, 1, fill=1, stroke=0)
        c.setFillColor(bun if kind != "grilled_cheese" else HexColor("#D69A4E"))
        c.roundRect(7, 5, 26, 4, 2, fill=1, stroke=0)
    elif kind in {"pasta", "mac"}:
        c.setFillColor(HexColor("#E7DDC7"))
        c.ellipse(4, 5, 36, 29, fill=1, stroke=0)
        c.setStrokeColor(gold)
        c.setLineWidth(2.2)
        for offset in (0, 4, 8):
            path = c.beginPath()
            path.moveTo(10, 17 + offset * 0.25)
            path.curveTo(14, 27, 17, 8, 21, 18)
            path.curveTo(25, 27, 28, 10, 31, 18)
            c.drawPath(path, stroke=1, fill=0)
        c.setFillColor(green)
        c.circle(19, 21, 1.7, fill=1, stroke=0)
    elif kind == "taco":
        path = c.beginPath()
        path.moveTo(5, 9)
        path.curveTo(8, 28, 31, 30, 35, 9)
        path.curveTo(25, 4, 14, 4, 5, 9)
        path.close()
        c.setFillColor(gold)
        c.drawPath(path, fill=1, stroke=0)
        c.setFillColor(meat)
        c.ellipse(10, 13, 30, 21, fill=1, stroke=0)
        c.setFillColor(green)
        for px, py in ((14, 21), (21, 23), (27, 20)):
            c.circle(px, py, 1.8, fill=1, stroke=0)
        c.setFillColor(red)
        c.circle(18, 16, 1.2, fill=1, stroke=0)
    elif kind in {"pizza", "pizza_bread"}:
        path = c.beginPath()
        path.moveTo(7, 7)
        path.lineTo(34, 7)
        path.lineTo(19, 29)
        path.close()
        c.setFillColor(HexColor("#C98944"))
        c.drawPath(path, fill=1, stroke=0)
        path2 = c.beginPath()
        path2.moveTo(10, 10)
        path2.lineTo(31, 10)
        path2.lineTo(19, 26)
        path2.close()
        c.setFillColor(cheese)
        c.drawPath(path2, fill=1, stroke=0)
        c.setFillColor(red)
        for px, py in ((17, 15), (22, 19), (19, 22)):
            c.circle(px, py, 1.8, fill=1, stroke=0)
    elif kind == "fries":
        c.setFillColor(HexColor("#D9A15C"))
        c.roundRect(7, 5, 27, 11, 3, fill=1, stroke=0)
        c.setFillColor(gold)
        for px, ht in ((10, 17), (15, 21), (20, 18), (25, 22), (30, 17)):
            c.roundRect(px, 12, 3.2, ht, 1.2, fill=1, stroke=0)
    elif kind == "pancakes":
        c.setFillColor(bun)
        c.ellipse(5, 6, 35, 15, fill=1, stroke=0)
        c.ellipse(7, 12, 33, 21, fill=1, stroke=0)
        c.ellipse(9, 18, 31, 27, fill=1, stroke=0)
        c.setFillColor(cheese)
        c.roundRect(16, 23, 9, 5, 2, fill=1, stroke=0)
    elif kind == "tenders":
        c.setFillColor(HexColor("#E5B15A"))
        for px, py, ang in ((7, 7, 0), (14, 15, 0), (21, 8, 0)):
            c.saveState()
            c.translate(px, py)
            c.rotate(ang)
            c.roundRect(0, 0, 15, 6, 3, fill=1, stroke=0)
            c.restoreState()
        c.setFillColor(gold)
        c.circle(29, 25, 4, fill=1, stroke=0)
    elif kind in {"wrap", "burrito"}:
        c.setFillColor(HexColor("#E6D2A4"))
        c.roundRect(5, 9, 31, 17, 8, fill=1, stroke=0)
        c.setStrokeColor(HexColor("#C79A4D"))
        c.setLineWidth(1)
        c.line(13, 10, 13, 25)
        c.line(25, 10, 25, 25)
        c.setFillColor(red)
        c.circle(9, 17, 1.4, fill=1, stroke=0)
        c.setFillColor(green)
        c.circle(31, 17, 1.4, fill=1, stroke=0)
    elif kind == "potato":
        c.setFillColor(HexColor("#B97A46"))
        c.ellipse(5, 7, 35, 27, fill=1, stroke=0)
        c.setFillColor(white)
        c.ellipse(10, 12, 30, 24, fill=1, stroke=0)
        c.setFillColor(cheese)
        c.circle(16, 19, 3, fill=1, stroke=0)
        c.circle(24, 17, 3, fill=1, stroke=0)
        c.setFillColor(green)
        c.circle(20, 23, 1.5, fill=1, stroke=0)
    elif kind == "cookies":
        c.setFillColor(HexColor("#D6A05B"))
        for px, py in ((11, 12), (25, 13), (19, 24)):
            c.circle(px, py, 8, fill=1, stroke=0)
            c.setFillColor(meat)
            c.circle(px - 2, py + 2, 1, fill=1, stroke=0)
            c.circle(px + 3, py - 2, 1, fill=1, stroke=0)
            c.setFillColor(HexColor("#D6A05B"))
    elif kind == "brownie":
        c.setFillColor(HexColor("#6C3E31"))
        for px, py in ((7, 8), (21, 8), (14, 20)):
            c.roundRect(px, py, 12, 11, 1.5, fill=1, stroke=0)
        c.setFillColor(cheese)
        c.circle(12, 13, 1, fill=1, stroke=0)
        c.circle(25, 13, 1, fill=1, stroke=0)
    elif kind == "pb_cup":
        c.setFillColor(meat)
        for px in (7, 18, 29):
            c.roundRect(px, 7, 8, 15, 2, fill=1, stroke=0)
            c.setFillColor(cheese)
            c.ellipse(px + 1, 14, px + 7, 20, fill=1, stroke=0)
            c.setFillColor(meat)
    elif kind == "cheesecake":
        c.setFillColor(HexColor("#9E744A"))
        c.roundRect(8, 5, 24, 24, 3, fill=1, stroke=0)
        c.setFillColor(HexColor("#F3E4C5"))
        c.rect(10, 9, 20, 15, fill=1, stroke=0)
        c.setFillColor(HexColor("#D87C66"))
        c.ellipse(16, 23, 24, 30, fill=1, stroke=0)
        c.setFillColor(green)
        c.ellipse(20, 28, 24, 31, fill=1, stroke=0)
    else:
        c.setFillColor(gold)
        c.ellipse(7, 8, 33, 28, fill=1, stroke=0)
    c.restoreState()


def draw_stage_icon(c, stage_index: int, label: str, kind: str, x: float, y: float):
    """Draw prep, cooking, or plated-food pictograms for the visual recipe sequence."""
    c.saveState()
    c.translate(x, y)
    c.setStrokeColor(INK)
    c.setLineWidth(1.25)
    if stage_index == 0:
        c.setFillColor(PAPER_DARK)
        c.roundRect(3, 5, 35, 25, 4, fill=1, stroke=0)
        c.setFillColor(HexColor("#D96E50"))
        c.circle(12, 19, 3, fill=1, stroke=0)
        c.setFillColor(HONEY)
        c.circle(21, 14, 3.4, fill=1, stroke=0)
        c.setFillColor(HexColor("#77946A"))
        c.circle(30, 21, 3, fill=1, stroke=0)
        c.setStrokeColor(INK_SOFT)
        c.setLineWidth(1.4)
        c.line(8, 9, 22, 27)
        c.line(7, 8, 11, 9)
    elif stage_index == 1:
        word = label.upper()
        if "BAKE" in word or "AIR-FRY" in word:
            c.setFillColor(PAPER_DARK)
            c.roundRect(5, 3, 31, 35, 4, fill=1, stroke=1)
            c.setFillColor(WHITE)
            c.roundRect(10, 12, 21, 17, 3, fill=1, stroke=0)
            c.setStrokeColor(LINE)
            c.line(11, 20, 30, 20)
            c.setFillColor(HONEY)
            c.circle(14, 33, 1.4, fill=1, stroke=0)
            c.setFillColor(TOMATO)
            c.circle(21, 33, 1.4, fill=1, stroke=0)
            draw_food_mark(c, kind, 13, 15, 0.38)
        elif "CHILL" in word or "SET" in word:
            c.setFillColor(PAPER_DARK)
            c.roundRect(7, 2, 27, 37, 4, fill=1, stroke=1)
            c.setStrokeColor(LINE)
            c.line(8, 22, 33, 22)
            c.setStrokeColor(INK_SOFT)
            c.line(28, 27, 28, 32)
            c.line(28, 10, 28, 16)
            c.setFillColor(HexColor("#D6B877"))
            c.roundRect(12, 7, 11, 8, 2, fill=1, stroke=0)
        else:
            c.setFillColor(INK_SOFT)
            c.roundRect(1, 14, 12, 4, 2, fill=1, stroke=0)
            c.setFillColor(PAPER_DARK)
            c.roundRect(10, 7, 27, 15, 5, fill=1, stroke=1)
            c.setFillColor(HexColor("#D7A352"))
            c.ellipse(14, 11, 32, 20, fill=1, stroke=0)
            draw_food_mark(c, kind, 16, 12, 0.32)
            c.setStrokeColor(TOMATO)
            c.setLineWidth(1.1)
            for sx in (17, 25, 33):
                path = c.beginPath()
                path.moveTo(sx, 24)
                path.curveTo(sx - 3, 28, sx + 3, 31, sx, 36)
                c.drawPath(path, stroke=1, fill=0)
    else:
        c.setFillColor(WHITE)
        c.ellipse(2, 3, 39, 37, fill=1, stroke=1)
        c.setStrokeColor(LINE)
        c.ellipse(7, 8, 34, 32, fill=0, stroke=1)
        draw_food_mark(c, kind, 7, 8, 0.68)
    c.restoreState()


def draw_visual_flow(c, recipe: dict, x: float, y: float, width: float, height: float):
    stages = recipe.get("visual_steps", [])
    if not stages:
        return
    gap = 7
    card_w = (width - gap * 2) / 3
    accents = [TOMATO, HONEY, HexColor("#6E8B68")]
    for i, stage in enumerate(stages[:3]):
        card_x = x + i * (card_w + gap)
        c.setFillColor(WHITE)
        c.setStrokeColor(LINE)
        c.setLineWidth(0.65)
        c.roundRect(card_x, y, card_w, height, 8, fill=1, stroke=1)
        c.setFillColor(accents[i])
        c.roundRect(card_x, y + height - 4, card_w, 4, 2, fill=1, stroke=0)
        draw_stage_icon(c, i, stage["label"], recipe.get("visual_icon", "dish"), card_x + 7, y + 14)
        text_x = card_x + 49
        c.setFillColor(accents[i])
        c.setFont(SANS_BOLD, 6.8)
        c.drawString(text_x, y + height - 15, stage["label"].upper())
        draw_wrapped(c, stage["text"], text_x, y + height - 28, card_w - 55,
                     font=SANS, size=6.9, leading=8.1, color=INK_SOFT, max_lines=3)


def draw_recipe_opening(c, recipe: dict, page_number: int):
    draw_bg(c)
    draw_header(c, recipe["category"])
    photo_path = HERE / recipe["image"]
    img = make_image_reader(photo_path, ratio=CONTENT_W / 248)
    img_x, img_y, img_w, img_h = M, 481, CONTENT_W, 248
    c.drawImage(img, img_x, img_y, width=img_w, height=img_h, mask="auto")

    # Small category badge over the photograph.
    badge = recipe["category"].upper()
    badge_w = min(245, pdfmetrics.stringWidth(badge, SANS_BOLD, 7.2) + 22)
    c.setFillColor(Color(0.12, 0.21, 0.18, alpha=0.92))
    c.roundRect(img_x + 13, img_y + img_h - 29, badge_w, 18, 8, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont(SANS_BOLD, 7.2)
    c.drawString(img_x + 23, img_y + img_h - 23, badge)

    c.setFillColor(INK_SOFT)
    c.setFont(SANS, 7.1)
    c.drawRightString(PAGE_W - M, img_y - 12, recipe["photo_caption"])
    draw_visual_flow(c, recipe, M, 394, CONTENT_W, 66)

    title = recipe["title"]
    title_size = fitted_size(title, SERIF_BOLD, 25, 19, CONTENT_W)
    c.setFillColor(INK)
    c.setFont(SERIF_BOLD, title_size)
    c.drawString(M, 363, title)

    tagline_y = 344
    tagline_end = draw_wrapped(c, recipe["tagline"], M, tagline_y, CONTENT_W,
                                font=SERIF, size=10.2, leading=13.5, color=INK_SOFT, max_lines=2)

    pill_y = min(306, tagline_end - 6)
    gap = 7
    widths = [100, 100, 105, CONTENT_W - 100 - 100 - 105 - 3 * gap]
    labels = [f"PREP  {recipe['prep']}", f"COOK  {recipe['cook']}",
              f"TOTAL  {recipe['total']}", f"MAKES  {recipe['serves']}"]
    x = M
    for label, width in zip(labels, widths):
        draw_pill(c, x, pill_y, label, width, fill=WHITE, font_size=7.3)
        x += width + gap

    section_y = pill_y - 34
    draw_section_label(c, "Ingredients", M, section_y, CONTENT_W)
    ingredient_y = section_y - 21
    split = math.ceil(len(recipe["ingredients"]) / 2)
    col_gap = 26
    col_w = (CONTENT_W - col_gap) / 2
    left_bottom = draw_ingredient_col(c, recipe["ingredients"][:split], M, ingredient_y, col_w)
    right_bottom = draw_ingredient_col(c, recipe["ingredients"][split:], M + col_w + col_gap,
                                      ingredient_y, col_w)
    equipment_top = min(112, min(left_bottom, right_bottom) - 3)
    equipment_top = max(73, equipment_top)
    c.setFillColor(PAPER_DARK)
    c.roundRect(M, equipment_top - 36, CONTENT_W, 38, 9, fill=1, stroke=0)
    c.setFillColor(TOMATO)
    c.setFont(SANS_BOLD, 7.3)
    c.drawString(M + 12, equipment_top - 14, "YOU'LL NEED")
    draw_wrapped(c, recipe["equipment"], M + 96, equipment_top - 14, CONTENT_W - 108,
                 font=SANS, size=8, leading=10, color=INK)

    draw_footer(c, page_number)
    c.bookmarkPage(f"recipe-{recipe['number']}")
    c.addOutlineEntry(f"{recipe['number']:02d}. {recipe['title']}", f"recipe-{recipe['number']}", level=0, closed=False)
    c.showPage()


def draw_note_card(c, x, top, width, height, title, text, accent=TOMATO, font_size=9.1):
    bottom = top - height
    c.setFillColor(WHITE)
    c.setStrokeColor(LINE)
    c.setLineWidth(0.7)
    c.roundRect(x, bottom, width, height, 10, fill=1, stroke=1)
    c.setFillColor(accent)
    c.roundRect(x, bottom + height - 6, width, 6, 3, fill=1, stroke=0)
    c.setFillColor(INK)
    c.setFont(SANS_BOLD, 8.2)
    c.drawString(x + 12, top - 20, title.upper())
    draw_wrapped(c, text, x + 12, top - 37, width - 24,
                 font=SANS, size=font_size, leading=12.1, color=INK_SOFT, max_lines=5)


def draw_recipe_method(c, recipe: dict, page_number: int):
    draw_bg(c)
    draw_header(c, "FROM ROSIE'S KITCHEN")
    c.setFillColor(TOMATO)
    c.setFont(SANS_BOLD, 8.5)
    c.drawString(M, 722, f"RECIPE {recipe['number']:02d}  /  {recipe['category'].upper()}")
    c.setFillColor(INK)
    title_size = fitted_size(recipe["title"], SERIF_BOLD, 20, 16, CONTENT_W)
    c.setFont(SERIF_BOLD, title_size)
    c.drawString(M, 694, recipe["title"])
    c.setStrokeColor(LINE)
    c.line(M, 680, PAGE_W - M, 680)
    c.setFillColor(INK)
    c.setFont(SERIF_BOLD, 23)
    c.drawString(M, 647, "Let's make it.")
    c.setFillColor(INK_SOFT)
    c.setFont(SANS, 8.5)
    c.drawRightString(PAGE_W - M, 650, recipe["total"].upper() + " TOTAL")

    y = 615
    for i, step in enumerate(recipe["steps"], start=1):
        c.setFillColor(TOMATO if i % 2 else HONEY)
        c.circle(M + 13, y + 1, 12, fill=1, stroke=0)
        c.setFillColor(WHITE)
        c.setFont(SANS_BOLD, 9)
        c.drawCentredString(M + 13, y - 2.5, str(i))
        c.setFillColor(INK)
        c.setFont(SANS_BOLD, 9.4)
        c.drawString(M + 36, y + 5, step["title"].upper())
        body_end = draw_wrapped(c, step["text"], M + 36, y - 11, CONTENT_W - 42,
                                font=SANS, size=9.2, leading=12.3, color=INK_SOFT)
        y = body_end - 13

    # Notes are placed below the last instruction with a consistent safety margin.
    tip_top = min(y - 2, 360)
    tip_top = max(tip_top, 305)
    draw_note_card(c, M, tip_top, CONTENT_W, 83, "Rosie's tip", recipe["rosie_tip"], accent=HONEY)
    row_top = tip_top - 96
    gap = 12
    half = (CONTENT_W - gap) / 2
    draw_note_card(c, M, row_top, half, 108, "Make ahead & storage", recipe["storage"], accent=TOMATO, font_size=8.7)
    draw_note_card(c, M + half + gap, row_top, half, 108, "Serve it with", recipe["serve_with"], accent=HONEY, font_size=8.7)
    c.setFillColor(INK_SOFT)
    c.setFont(SANS, 7.6)
    c.drawString(M, 74, "TIMES ARE ESTIMATES. OVEN AND AIR-FRYER PERFORMANCE VARIES BY MODEL.")
    draw_footer(c, page_number)
    c.showPage()


def draw_cover(c):
    draw_bg(c)
    c.setFillColor(INK)
    c.setFont(SANS_BOLD, 8)
    c.drawCentredString(PAGE_W / 2, 748, "A GRANDMA ROSIE COOKBOOK")
    c.setStrokeColor(HONEY)
    c.setLineWidth(1.2)
    c.line(PAGE_W / 2 - 72, 733, PAGE_W / 2 + 72, 733)
    c.setFillColor(INK)
    c.setFont(SERIF_BOLD, 42)
    c.drawCentredString(PAGE_W / 2, 674, "GRANDMA ROSIE'S")
    c.setFillColor(TOMATO)
    c.setFont(SERIF_BOLD, 32)
    c.drawCentredString(PAGE_W / 2, 632, "AMERICAN COMFORT FOOD")
    c.setFillColor(INK_SOFT)
    c.setFont(SANS, 10)
    c.drawCentredString(PAGE_W / 2, 604, "20 all-American favorites, made with a little more love")
    c.setFillColor(HONEY)
    c.roundRect(PAGE_W / 2 - 112, 566, 224, 25, 12, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont(SANS_BOLD, 8.2)
    c.drawCentredString(PAGE_W / 2, 575, "BIG FLAVOR  •  CLEAR STEPS  •  NO BORING BITES")

    cover_image = make_image_reader(HERE / DATA[0]["image"], ratio=1.42, target_w=1500)
    c.drawImage(cover_image, M, 138, width=CONTENT_W, height=373, mask="auto")
    c.setFillColor(Color(0.11, 0.2, 0.16, alpha=0.90))
    c.roundRect(M + 15, 160, CONTENT_W - 30, 52, 12, fill=1, stroke=0)
    c.setFillColor(WHITE)
    c.setFont(SERIF_BOLD, 18)
    c.drawCentredString(PAGE_W / 2, 190, "The good stuff belongs at home.")
    c.setFillColor(WHITE)
    c.setFont(SANS, 8.5)
    c.drawCentredString(PAGE_W / 2, 174, "BURGERS  •  BREAKFAST  •  COMFORT FOOD  •  DESSERT")
    c.setFillColor(INK_SOFT)
    c.setFont(SANS, 8)
    c.drawCentredString(PAGE_W / 2, 90, "A cook-at-home companion to the Grandma Rosie 15-second recipe series")
    c.showPage()


def draw_welcome(c, page_number):
    draw_bg(c)
    draw_header(c, "A NOTE FROM ROSIE")
    c.setFillColor(TOMATO)
    c.setFont(SANS_BOLD, 8)
    c.drawString(M, 714, "PULL UP A CHAIR")
    c.setFillColor(INK)
    c.setFont(SERIF_BOLD, 31)
    c.drawString(M, 672, "Welcome to Rosie's kitchen.")
    c.setFillColor(INK_SOFT)
    c.setFont(SERIF, 15)
    c.drawString(M, 630, "The videos may be 15 seconds. Dinner still takes the time it takes.")
    c.setFillColor(INK)
    y = 588
    paragraphs = [
        "This book is the cook-at-home companion to the Grandma Rosie recipe series: twenty familiar American favorites, written for real kitchens and hungry people. You will find crisp burgers, creamy pasta, breakfast sandwiches, quick snacks, and a few sweet reasons to preheat the oven.",
        "Every recipe starts with a finished-dish image and a three-panel prep, cook, and finish illustration. You will also find the yield, timing, equipment, measured ingredients, clear steps, and a practical storage note. The photos are visual inspiration; ingredients, brands, ovens, and plating can change the final look.",
        "Rosie's rule is simple: no long introductions, no mystery measurements, and no shame in using a shortcut when the day is busy. Read the recipe through once, gather what you need, and let the skillet do the talking."
    ]
    for para in paragraphs:
        y = draw_wrapped(c, para, M, y, CONTENT_W, font=SANS, size=11, leading=17, color=INK_SOFT)
        y -= 17
    # Signature quote panel
    c.setFillColor(INK)
    c.roundRect(M, 194, CONTENT_W, 103, 14, fill=1, stroke=0)
    c.setFillColor(HONEY)
    c.setFont(SANS_BOLD, 8)
    c.drawString(M + 20, 273, "GRANDMA ROSIE SAYS")
    c.setFillColor(WHITE)
    c.setFont(SERIF_BOLD, 19)
    c.drawString(M + 20, 241, "Good food doesn't need a long speech.")
    c.setFillColor(HexColor("#DCE5D9"))
    c.setFont(SANS, 9)
    c.drawString(M + 20, 218, "It needs a hot pan, a little patience, and enough cheese.")
    c.setFillColor(INK_SOFT)
    draw_wrapped(c, "A note on the character: Grandma Rosie is a fictional cooking persona created for this collection.",
                 M, 158, CONTENT_W, font=SANS, size=9, leading=13, color=INK_SOFT)
    draw_footer(c, page_number)
    c.showPage()


def draw_kitchen_notes(c, page_number):
    draw_bg(c)
    draw_header(c, "BEFORE YOU COOK")
    c.setFillColor(TOMATO)
    c.setFont(SANS_BOLD, 8)
    c.drawString(M, 714, "THE ROSIE KITCHEN GUIDE")
    c.setFillColor(INK)
    c.setFont(SERIF_BOLD, 30)
    c.drawString(M, 672, "A few good things to know.")
    c.setFillColor(INK_SOFT)
    draw_wrapped(c, "The recipes use familiar U.S. kitchen measures first. Metric amounts are practical approximations; for baking, a scale is the surest way to get consistent results.",
                 M, 636, CONTENT_W, font=SANS, size=10.5, leading=15, color=INK_SOFT)

    cards = [
        ("MEASUREMENTS", ["1 cup liquid = 240 ml", "1 tablespoon = 15 ml", "1 teaspoon = 5 ml", "1 ounce = about 28 g", "Spoon flour into the cup and level it; don't pack it."], TOMATO),
        ("OVEN CONVERSIONS", ["325°F = 165°C", "350°F = 175°C", "375°F = 190°C", "400°F = 200°C", "425°F = 220°C"], HONEY),
        ("SAFE TEMPERATURES", ["Ground beef: 160°F / 71°C", "Poultry: 165°F / 74°C", "Reheated leftovers: 165°F / 74°C", "Use an instant-read thermometer in the thickest part."], TOMATO),
        ("A FEW KITCHEN HABITS", ["Preheat the oven fully.", "Grate cheese from a block for smoother melting.", "Keep raw meat separate from ready-to-eat foods.", "Refrigerate perishable leftovers within 2 hours."], HONEY)
    ]
    card_w = (CONTENT_W - 16) / 2
    card_h = 174
    positions = [(M, 430), (M + card_w + 16, 430), (M, 237), (M + card_w + 16, 237)]
    for (title, lines, accent), (x, top) in zip(cards, positions):
        c.setFillColor(WHITE)
        c.setStrokeColor(LINE)
        c.roundRect(x, top - card_h, card_w, card_h, 12, fill=1, stroke=1)
        c.setFillColor(accent)
        c.roundRect(x, top - 7, card_w, 7, 3, fill=1, stroke=0)
        c.setFillColor(INK)
        c.setFont(SANS_BOLD, 8)
        c.drawString(x + 14, top - 26, title)
        y = top - 49
        for line in lines:
            c.setFillColor(accent)
            c.circle(x + 16, y + 2, 2, fill=1, stroke=0)
            y = draw_wrapped(c, line, x + 26, y, card_w - 40, font=SANS, size=8.8,
                             leading=12.4, color=INK_SOFT)
            y -= 8
    c.setFillColor(INK_SOFT)
    c.setFont(SANS, 7.8)
    c.drawString(M, 70, "People with food allergies should check every package label and adapt the recipe safely.")
    draw_footer(c, page_number)
    c.showPage()


def draw_contents(c, page_number):
    draw_bg(c)
    draw_header(c, "FIND YOUR FAVORITE")
    c.setFillColor(TOMATO)
    c.setFont(SANS_BOLD, 8)
    c.drawString(M, 714, "THE RECIPE INDEX")
    c.setFillColor(INK)
    c.setFont(SERIF_BOLD, 31)
    c.drawString(M, 672, "Twenty very good reasons to eat.")
    c.setFillColor(INK_SOFT)
    c.setFont(SANS, 9)
    c.drawString(M, 645, "The page number points to the recipe's photo and ingredient list.")

    split = 10
    columns = [DATA[:split], DATA[split:]]
    col_w = (CONTENT_W - 34) / 2
    for col, items in enumerate(columns):
        x = M + col * (col_w + 34)
        y = 601
        for recipe in items:
            page_no = 5 + (recipe["number"] - 1) * 2
            c.setFillColor(TOMATO)
            c.setFont(SANS_BOLD, 8)
            c.drawString(x, y, f"{recipe['number']:02d}")
            c.setFillColor(INK)
            title_font = SANS_BOLD if len(recipe["title"]) < 31 else SANS
            title_size = 8.4 if len(recipe["title"]) < 34 else 7.7
            c.setFont(title_font, title_size)
            title_lines = wrap_lines(recipe["title"], title_font, title_size, col_w - 42)
            for line in title_lines[:2]:
                c.drawString(x + 29, y, line)
                y -= 10.6
            c.setFillColor(INK_SOFT)
            c.setFont(SANS, 7.1)
            c.drawString(x + 29, y + 1, recipe["category"].upper())
            c.setFillColor(TOMATO)
            c.setFont(SANS_BOLD, 8)
            c.drawRightString(x + col_w, y + 1, str(page_no))
            y -= 14
            c.setStrokeColor(LINE)
            c.setLineWidth(0.5)
            c.line(x, y, x + col_w, y)
            y -= 11
    c.setFillColor(PAPER_DARK)
    c.roundRect(M, 65, CONTENT_W, 36, 9, fill=1, stroke=0)
    c.setFillColor(INK_SOFT)
    c.setFont(SANS, 8)
    c.drawCentredString(PAGE_W / 2, 79, "Burgers  •  Breakfast  •  Comfort food  •  Snacks  •  Sweet things")
    draw_footer(c, page_number)
    c.showPage()


def draw_credits(c, page_number):
    draw_bg(c)
    draw_header(c, "IMAGE CREDITS")
    c.setFillColor(TOMATO)
    c.setFont(SANS_BOLD, 8)
    c.drawString(M, 714, "A NOTE ABOUT THE PHOTOGRAPHS")
    c.setFillColor(INK)
    c.setFont(SERIF_BOLD, 29)
    c.drawString(M, 674, "Image credits & use.")
    intro = ("Every recipe includes three original vector illustrations for the prep, cooking, and serving stages. "
             "Recipes 01–10 use original AI-generated finished-dish images created for this edition. "
             "Recipes 11–20 use stock food photographs for serving inspiration; these images were cropped for the page layout. "
             "Pexels attribution is optional under its license. The recipe 14 image is separately credited below.")
    y = draw_wrapped(c, intro, M, 642, CONTENT_W, font=SANS, size=9.5, leading=14, color=INK_SOFT)
    y -= 14

    credits = [r for r in DATA if r["number"] >= 11]
    col_gap = 22
    col_w = (CONTENT_W - col_gap) / 2
    row_h = 45
    for idx, recipe in enumerate(credits):
        col = idx // 5
        row = idx % 5
        x = M + col * (col_w + col_gap)
        top = y - row * row_h
        c.setFillColor(INK)
        c.setFont(SANS_BOLD, 8)
        c.drawString(x, top, f"{recipe['number']:02d}  {recipe['title']}")
        source = recipe.get("source_url", "")
        if recipe["number"] == 14:
            label = "jeffreyw via Wikimedia Commons · CC BY 2.0"
        else:
            photo_id = recipe.get("photo_id", "")
            label = f"Pexels stock photo · ID {photo_id} · attribution optional" if photo_id else "Pexels stock photo · attribution optional"
        c.setFillColor(INK_SOFT)
        c.setFont(SANS, 7.2)
        c.drawString(x, top - 12, label)
        if source:
            c.setFillColor(TOMATO)
            c.setFont(SANS, 7)
            c.drawString(x, top - 24, "Open source photo page")
            link_w = pdfmetrics.stringWidth("Open source photo page", SANS, 7)
            c.linkURL(source, (x, top - 26, x + link_w, top - 16), relative=0, thickness=0)
        else:
            c.setFillColor(INK_SOFT)
            c.setFont(SANS, 7)
            c.drawString(x, top - 24, "Original image made for this edition")

    license_y = y - 5 * row_h - 16
    box_top = max(305, license_y - 5)
    box_bottom = 225
    box_height = box_top - box_bottom
    c.setFillColor(PAPER_DARK)
    c.roundRect(M, box_bottom, CONTENT_W, box_height, 10, fill=1, stroke=0)
    c.setFillColor(INK)
    c.setFont(SANS_BOLD, 8)
    c.drawString(M + 13, box_top - 18, "LICENSE NOTES")
    note = ("Pexels photos are used under the Pexels License (free use; attribution not required): "
            "pexels.com/license/. Recipe 14: “Philly cheesesteak sandwich.jpg” by jeffreyw, "
            "licensed CC BY 2.0 via Wikimedia Commons; cropped for layout. "
            "The Grandma Rosie persona is fictional. Photos are illustrative; your finished dish may look different.")
    note_y = box_top - 35
    draw_wrapped(c, note, M + 13, note_y, CONTENT_W - 26, font=SANS, size=7.5, leading=10, color=INK_SOFT)
    c.linkURL("https://www.pexels.com/license/", (M + 13, note_y - 12, M + 145, note_y + 2), relative=0, thickness=0)
    c.linkURL("https://creativecommons.org/licenses/by/2.0/", (M + 13, note_y - 23, M + 160, note_y - 10), relative=0, thickness=0)
    draw_footer(c, page_number)
    c.showPage()


def draw_notes_page(c, page_number):
    draw_bg(c)
    draw_header(c, "ONE LAST THING")
    c.setFillColor(TOMATO)
    c.setFont(SANS_BOLD, 8)
    c.drawString(M, 714, "FROM ROSIE'S TABLE")
    c.setFillColor(INK)
    c.setFont(SERIF_BOLD, 31)
    c.drawString(M, 672, "Make it yours.")
    c.setFillColor(INK_SOFT)
    draw_wrapped(c, "Swap a topping, make the sauce a little spicier, or write down the change that made everyone ask for seconds. The best family recipe is the one that gets cooked again.",
                 M, 635, CONTENT_W, font=SANS, size=10.5, leading=16, color=INK_SOFT)
    c.setFillColor(INK)
    c.setFont(SANS_BOLD, 8)
    c.drawString(M, 556, "MY KITCHEN NOTES")
    c.setStrokeColor(LINE)
    c.setLineWidth(0.8)
    for i in range(7):
        yy = 520 - i * 57
        c.line(M, yy, PAGE_W - M, yy)
    c.setFillColor(PAPER_DARK)
    c.roundRect(M, 72, CONTENT_W, 54, 10, fill=1, stroke=0)
    c.setFillColor(INK_SOFT)
    c.setFont(SANS, 7.8)
    c.drawCentredString(PAGE_W / 2, 103, "Cook times are estimates. Use safe internal temperatures and follow your appliance instructions.")
    c.drawCentredString(PAGE_W / 2, 88, "Created in English for the Grandma Rosie American comfort-food collection · 2026")
    draw_footer(c, page_number)
    c.showPage()


def build_pdf():
    c = canvas.Canvas(str(PDF_OUT), pagesize=letter, pageCompression=1)
    c.setTitle("Grandma Rosie's American Comfort Food")
    c.setAuthor("Grandma Rosie Kitchen")
    c.setSubject("20 detailed American comfort-food recipes with finished-dish images")
    draw_cover(c)
    draw_welcome(c, 2)
    draw_kitchen_notes(c, 3)
    draw_contents(c, 4)
    page = 5
    for recipe in DATA:
        draw_recipe_opening(c, recipe, page)
        draw_recipe_method(c, recipe, page + 1)
        page += 2
    draw_credits(c, page)
    draw_notes_page(c, page + 1)
    c.save()


def html_ingredients(items: Iterable[str]) -> str:
    return "\n".join(f"<li>{html.escape(item)}</li>" for item in items)


def html_steps(steps: list[dict]) -> str:
    parts = []
    for i, step in enumerate(steps, 1):
        parts.append(
            f'<li><span class="step-number">{i:02d}</span><div><h3>{html.escape(step["title"])}</h3>'
            f'<p>{html.escape(step["text"])}</p></div></li>'
        )
    return "\n".join(parts)


def html_stage_svg(stage_index: int, label: str, kind: str) -> str:
    if stage_index == 0:
        body = '<rect x="5" y="19" width="46" height="28" rx="6" fill="#eee6d7"/><circle cx="17" cy="32" r="5" fill="#c65c43"/><circle cx="30" cy="39" r="5" fill="#c79a4d"/><circle cx="42" cy="29" r="5" fill="#6e8b68"/><path d="M12 45 33 18m-23 29 7-1" stroke="#20372f" stroke-width="2" stroke-linecap="round"/>'
    elif stage_index == 1:
        if "BAKE" in label.upper() or "AIR-FRY" in label.upper():
            body = '<rect x="12" y="5" width="32" height="48" rx="6" fill="#eee6d7" stroke="#20372f" stroke-width="2"/><rect x="18" y="20" width="20" height="21" rx="3" fill="#fffdf8"/><path d="M18 31h20" stroke="#dcd2c0" stroke-width="2"/><circle cx="22" cy="12" r="2" fill="#c65c43"/><circle cx="32" cy="12" r="2" fill="#c79a4d"/><path d="M23 34c2-7 9-7 11 0" fill="#e7b958"/>'
        elif "CHILL" in label.upper() or "SET" in label.upper():
            body = '<rect x="15" y="4" width="26" height="50" rx="5" fill="#eee6d7" stroke="#20372f" stroke-width="2"/><path d="M16 27h24" stroke="#dcd2c0" stroke-width="2"/><path d="M36 13v8m0 12v8" stroke="#52645b" stroke-width="2" stroke-linecap="round"/><rect x="21" y="34" width="10" height="7" rx="2" fill="#d9a15c"/>'
        else:
            body = '<path d="M4 28h10" stroke="#20372f" stroke-width="4" stroke-linecap="round"/><path d="M12 25h37l-4 17a6 6 0 0 1-6 5H21a6 6 0 0 1-6-5z" fill="#eee6d7" stroke="#20372f" stroke-width="2"/><ellipse cx="30" cy="34" rx="13" ry="7" fill="#e7b958"/><path d="M20 19c-4-5 4-6 1-11m10 12c-4-5 4-6 1-11m9 15c-3-4 3-6 1-9" fill="none" stroke="#c65c43" stroke-width="2" stroke-linecap="round"/>'
    else:
        plate = '<ellipse cx="29" cy="30" rx="25" ry="22" fill="#fffdf8" stroke="#20372f" stroke-width="2"/><ellipse cx="29" cy="30" rx="18" ry="15" fill="none" stroke="#dcd2c0" stroke-width="2"/>'
        foods = {
            'burger':'<path d="M16 28q13-15 26 0" fill="#d9a15c"/><rect x="16" y="29" width="26" height="6" rx="2" fill="#8b4f35"/><path d="m16 34 7 3 3-3 7 3 3-3 6 2" fill="#f2cc58"/><rect x="17" y="37" width="24" height="4" rx="2" fill="#d9a15c"/>',
            'pasta':'<path d="M14 27c4-12 10 15 15 2s10 10 16-2M14 33c4-12 10 15 15 2s10 10 16-2" fill="none" stroke="#e7b958" stroke-width="4" stroke-linecap="round"/>',
            'mac':'<path d="M14 27c4-12 10 15 15 2s10 10 16-2M14 34c4-12 10 15 15 2s10 10 16-2" fill="none" stroke="#e7b958" stroke-width="4" stroke-linecap="round"/>',
            'taco':'<path d="M14 38q4-24 30-18l-4 21q-11-8-26-3" fill="#e7b958"/><circle cx="23" cy="29" r="3" fill="#8b4f35"/><circle cx="31" cy="27" r="3" fill="#6e8b68"/><circle cx="37" cy="32" r="3" fill="#c65c43"/>',
            'pizza':'<path d="m16 42 26-2-13-23z" fill="#e7b958" stroke="#c98944" stroke-width="3"/><circle cx="27" cy="29" r="2" fill="#c65c43"/><circle cx="33" cy="35" r="2" fill="#c65c43"/>',
            'pizza_bread':'<path d="M15 25q14-9 29 0v15q-15 8-29 0z" fill="#d9a15c"/><path d="M18 28q11-7 23 0v8q-11 6-23 0z" fill="#e7b958"/><circle cx="25" cy="31" r="2" fill="#c65c43"/><circle cx="34" cy="34" r="2" fill="#c65c43"/>',
            'fries':'<path d="M17 31h25l-3 13H20z" fill="#c65c43"/><path d="M20 31V17h4v14m3 0V13h4v18m3 0V18h4v13" fill="#e7b958"/>',
            'pancakes':'<ellipse cx="29" cy="39" rx="16" ry="5" fill="#d9a15c"/><ellipse cx="29" cy="33" rx="15" ry="5" fill="#e7b958"/><ellipse cx="29" cy="27" rx="13" ry="5" fill="#d9a15c"/><rect x="25" y="22" width="8" height="5" rx="2" fill="#f2cc58"/>',
            'tenders':'<rect x="15" y="25" width="20" height="7" rx="4" transform="rotate(-18 15 25)" fill="#e7b958"/><rect x="25" y="34" width="19" height="7" rx="4" transform="rotate(16 25 34)" fill="#d9a15c"/>',
            'wrap':'<rect x="15" y="23" width="29" height="14" rx="7" fill="#e6d2a4"/><path d="M23 24v12m12-12v12" stroke="#c79a4d" stroke-width="2"/>',
            'burrito':'<rect x="15" y="23" width="29" height="14" rx="7" fill="#e6d2a4"/><path d="M23 24v12m12-12v12" stroke="#c79a4d" stroke-width="2"/>',
            'potato':'<ellipse cx="29" cy="31" rx="17" ry="11" fill="#b97a46"/><path d="M18 31q11-13 23 0" fill="#fffdf8"/><circle cx="25" cy="28" r="3" fill="#f2cc58"/><circle cx="34" cy="30" r="3" fill="#6e8b68"/>',
            'cookies':'<circle cx="22" cy="31" r="9" fill="#d6a05b"/><circle cx="36" cy="33" r="8" fill="#d6a05b"/><circle cx="19" cy="29" r="1.5" fill="#8b4f35"/><circle cx="25" cy="34" r="1.5" fill="#8b4f35"/><circle cx="35" cy="30" r="1.5" fill="#8b4f35"/>',
            'brownie':'<rect x="18" y="23" width="12" height="13" rx="2" fill="#6c3e31"/><rect x="31" y="29" width="13" height="12" rx="2" fill="#6c3e31"/>',
            'pb_cup':'<rect x="17" y="25" width="10" height="15" rx="3" fill="#6c3e31"/><rect x="30" y="25" width="10" height="15" rx="3" fill="#6c3e31"/><ellipse cx="22" cy="28" rx="4" ry="2" fill="#e7b958"/><ellipse cx="35" cy="28" rx="4" ry="2" fill="#e7b958"/>',
            'cheesecake':'<rect x="18" y="21" width="24" height="20" rx="4" fill="#9e744a"/><rect x="20" y="23" width="20" height="14" rx="2" fill="#f3e4c5"/><circle cx="31" cy="22" r="4" fill="#d87c66"/>',
            'sandwich':'<path d="M16 26 30 20l13 7-1 15-25-1z" fill="#d9a15c"/><rect x="19" y="31" width="21" height="4" rx="2" fill="#8b4f35"/><rect x="20" y="36" width="19" height="4" rx="2" fill="#f2cc58"/>',
            'sub':'<rect x="14" y="25" width="31" height="14" rx="7" fill="#d9a15c"/><path d="M18 31h24" stroke="#8b4f35" stroke-width="5"/><path d="M20 27h18" stroke="#f2cc58" stroke-width="3"/>',
            'grilled_cheese':'<path d="M17 23h25v18H17z" fill="#d69a4e"/><path d="M20 27h19v10H20z" fill="#f2cc58"/>',
        }
        body = plate + foods.get(kind, foods['sandwich'])
    return f'<svg class="stage-svg" viewBox="0 0 58 58" aria-hidden="true">{body}</svg>'


def html_visual_flow(recipe: dict) -> str:
    cards = []
    for i, stage in enumerate(recipe.get("visual_steps", [])[:3]):
        cards.append(
            f'<div class="visual-card">{html_stage_svg(i, stage["label"], recipe.get("visual_icon", "dish"))}'
            f'<div><b>{html.escape(stage["label"].upper())}</b><p>{html.escape(stage["text"])}</p></div></div>'
        )
    return ''.join(cards)


def render_html() -> str:
    toc = []
    articles = []
    for recipe in DATA:
        page_no = 5 + (recipe["number"] - 1) * 2
        toc.append(
            f'<a href="#recipe-{recipe["number"]}"><span>{recipe["number"]:02d}</span>'
            f'<b>{html.escape(recipe["title"])}</b><em>{page_no:02d}</em></a>'
        )
        articles.append(f'''<article class="recipe" id="recipe-{recipe['number']}">
  <section class="page recipe-opening">
    <header class="running"><b>GRANDMA ROSIE</b><span>{html.escape(recipe['category'].upper())}</span></header>
    <figure class="hero">
      <img src="{html.escape(recipe['image'])}" alt="{html.escape(recipe['photo_caption'])}">
      <figcaption>{html.escape(recipe['photo_caption'])}</figcaption>
    </figure>
    <div class="visual-flow" aria-label="Illustrated preparation, cooking, and serving stages">{html_visual_flow(recipe)}</div>
    <p class="eyebrow">RECIPE {recipe['number']:02d} · {html.escape(recipe['category'].upper())}</p>
    <h2>{html.escape(recipe['title'])}</h2>
    <p class="tagline">{html.escape(recipe['tagline'])}</p>
    <div class="meta">
      <span><small>PREP</small>{html.escape(recipe['prep'])}</span>
      <span><small>COOK</small>{html.escape(recipe['cook'])}</span>
      <span><small>TOTAL</small>{html.escape(recipe['total'])}</span>
      <span><small>MAKES</small>{html.escape(recipe['serves'])}</span>
    </div>
    <div class="ingredients-wrap">
      <div class="section-heading"><h3>Ingredients</h3><span>Gather these first</span></div>
      <ul class="ingredients">{html_ingredients(recipe['ingredients'])}</ul>
      <p class="equipment"><b>YOU'LL NEED</b> {html.escape(recipe['equipment'])}</p>
    </div>
    <footer class="folio"><span>AMERICAN COMFORT FOOD</span><b>{page_no:02d}</b></footer>
  </section>
  <section class="page method-page">
    <header class="running"><b>GRANDMA ROSIE</b><span>FROM ROSIE'S KITCHEN</span></header>
    <p class="eyebrow">RECIPE {recipe['number']:02d} · {html.escape(recipe['category'].upper())}</p>
    <h2 class="method-title">Let's make it.</h2>
    <p class="method-recipe-name">{html.escape(recipe['title'])} <span>{html.escape(recipe['total'])} total</span></p>
    <ol class="steps">{html_steps(recipe['steps'])}</ol>
    <div class="tip"><b>ROSIE'S TIP</b><p>{html.escape(recipe['rosie_tip'])}</p></div>
    <div class="bottom-cards">
      <section><b>MAKE AHEAD & STORAGE</b><p>{html.escape(recipe['storage'])}</p></section>
      <section><b>SERVE IT WITH</b><p>{html.escape(recipe['serve_with'])}</p></section>
    </div>
    <p class="fine-print">Times are estimates. Oven and air-fryer performance varies by model.</p>
    <footer class="folio"><span>AMERICAN COMFORT FOOD</span><b>{page_no + 1:02d}</b></footer>
  </section>
</article>''')

    toc_html = "\n".join(toc)
    recipes_html = "\n".join(articles)
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="Grandma Rosie's American Comfort Food: 20 detailed, illustrated home-cooking favorites.">
<title>Grandma Rosie's American Comfort Food</title>
<style>
:root {{ --paper:#f7f2e8; --paper-dark:#eee6d7; --ink:#20372f; --muted:#52645b; --tomato:#c65c43; --honey:#c79a4d; --line:#dcd2c0; --white:#fffdf8; }}
* {{ box-sizing:border-box; }}
html {{ scroll-behavior:smooth; }}
body {{ margin:0; color:var(--ink); background:#e7dfd1; font-family:Georgia,'Times New Roman',serif; }}
main {{ max-width:1080px; margin:auto; background:var(--paper); box-shadow:0 10px 50px #24362f22; }}
.page {{ min-height:1056px; padding:50px 58px 48px; position:relative; page-break-after:always; break-after:page; background:var(--paper); overflow:hidden; }}
.cover {{ min-height:1056px; text-align:center; padding-top:64px; display:flex; flex-direction:column; align-items:center; }}
.cover .mark {{ font:700 11px/1.2 Arial,sans-serif; letter-spacing:.2em; }}
.cover .rule {{ width:120px; height:2px; background:var(--honey); margin:18px auto 35px; }}
.cover h1 {{ margin:0; font-size:56px; line-height:1.02; letter-spacing:-.04em; }}
.cover h1 span {{ display:block; color:var(--tomato); font-size:39px; margin-top:8px; letter-spacing:-.025em; }}
.cover .subtitle {{ font:15px/1.5 Arial,sans-serif; color:var(--muted); margin:16px 0 18px; }}
.cover .ribbon {{ background:var(--honey); color:white; padding:9px 18px; border-radius:99px; font:700 10px Arial,sans-serif; letter-spacing:.09em; }}
.cover img {{ width:100%; height:420px; object-fit:cover; border-radius:18px; margin-top:35px; }}
.cover .cover-quote {{ margin-top:-65px; z-index:2; background:var(--ink); color:white; width:92%; border-radius:14px; padding:17px; font-size:23px; }}
.cover .small {{ margin-top:35px; font:11px Arial,sans-serif; color:var(--muted); }}
.running {{ display:flex; justify-content:space-between; align-items:center; border-bottom:1px solid var(--line); padding-bottom:10px; font:700 9px Arial,sans-serif; letter-spacing:.1em; }}
.running span {{ color:var(--muted); font-weight:400; }}
.eyebrow {{ font:700 9px Arial,sans-serif; letter-spacing:.12em; color:var(--tomato); margin:24px 0 10px; }}
.welcome h2,.guide h2,.contents h2 {{ font-size:39px; line-height:1.1; margin:0 0 18px; }}
.welcome .lead {{ font-size:19px; color:var(--muted); }}
.welcome p,.guide p {{ font:15px/1.75 Arial,sans-serif; color:var(--muted); max-width:760px; }}
.quote {{ background:var(--ink); color:white; border-radius:14px; padding:25px; margin-top:46px; }}
.quote b {{ display:block; color:var(--honey); font:700 10px Arial,sans-serif; letter-spacing:.13em; margin-bottom:14px; }}
.quote strong {{ font-size:26px; line-height:1.3; }}
.note-grid {{ display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:35px; }}
.note-grid section {{ background:var(--white); border:1px solid var(--line); border-radius:13px; padding:20px; min-height:180px; }}
.note-grid h3 {{ font:700 11px Arial,sans-serif; letter-spacing:.1em; color:var(--tomato); margin:0 0 14px; }}
.note-grid ul {{ margin:0; padding-left:18px; font:13px/1.8 Arial,sans-serif; color:var(--muted); }}
.contents .toc {{ columns:2; column-gap:35px; margin-top:30px; }}
.toc a {{ break-inside:avoid; display:grid; grid-template-columns:28px 1fr 24px; gap:8px; align-items:start; text-decoration:none; color:var(--ink); border-bottom:1px solid var(--line); padding:11px 0; font:12px/1.3 Arial,sans-serif; }}
.toc a span {{ color:var(--tomato); font-weight:700; }} .toc a em {{ font-style:normal; text-align:right; color:var(--muted); }}
.recipe-opening .hero {{ height:390px; margin:22px 0 0; position:relative; }}
.hero img {{ display:block; width:100%; height:100%; object-fit:cover; border-radius:16px; }}
.hero figcaption {{ position:absolute; bottom:11px; right:13px; color:white; background:#20372fdd; padding:6px 9px; border-radius:8px; font:9px Arial,sans-serif; max-width:72%; }}
.visual-flow {{ display:grid; grid-template-columns:repeat(3,1fr); gap:9px; margin:12px 0 14px; }}
.visual-card {{ display:grid; grid-template-columns:42px 1fr; gap:8px; align-items:center; background:var(--white); border:1px solid var(--line); border-radius:10px; padding:8px; min-height:76px; }}
.visual-card:nth-child(1) {{ border-top:3px solid var(--tomato); }} .visual-card:nth-child(2) {{ border-top:3px solid var(--honey); }} .visual-card:nth-child(3) {{ border-top:3px solid #6e8b68; }}
.stage-svg {{ width:40px; height:40px; display:block; }}
.visual-card b {{ display:block; color:var(--tomato); font:700 8px Arial,sans-serif; letter-spacing:.08em; }}
.visual-card p {{ margin:5px 0 0; color:var(--muted); font:9px/1.32 Arial,sans-serif; }}
.recipe-opening .eyebrow {{ margin-top:18px; }}
.recipe-opening h2 {{ margin:0; font-size:31px; line-height:1.12; letter-spacing:-.025em; }}
.tagline {{ margin:10px 0 15px; color:var(--muted); font-size:15px; line-height:1.45; }}
.meta {{ display:grid; grid-template-columns:repeat(4,1fr); gap:9px; margin:16px 0 19px; }}
.meta span {{ background:var(--white); border:1px solid var(--line); border-radius:9px; padding:10px 12px; font:700 11px Arial,sans-serif; }}
.meta small {{ display:block; color:var(--tomato); font:700 8px Arial,sans-serif; letter-spacing:.1em; margin-bottom:4px; }}
.section-heading {{ display:flex; align-items:baseline; gap:12px; border-bottom:1px solid var(--line); padding-bottom:8px; }}
.section-heading h3 {{ margin:0; font-size:21px; }} .section-heading span {{ color:var(--muted); font:10px Arial,sans-serif; }}
.ingredients {{ columns:2; column-gap:30px; margin:16px 0 12px; padding-left:18px; font:12px/1.55 Arial,sans-serif; }}
.ingredients li {{ break-inside:avoid; padding:0 4px 9px 0; }}
.equipment {{ background:var(--paper-dark); border-radius:9px; padding:12px 14px; margin:15px 0 0; color:var(--muted); font:10px/1.5 Arial,sans-serif; }}
.equipment b {{ color:var(--tomato); letter-spacing:.08em; font-size:9px; margin-right:8px; }}
.method-title {{ font-size:33px; margin:25px 0 5px; }}
.method-recipe-name {{ margin:0 0 25px; color:var(--muted); font:12px Arial,sans-serif; display:flex; justify-content:space-between; }}
.method-recipe-name span {{ color:var(--tomato); font-weight:700; text-transform:uppercase; font-size:9px; letter-spacing:.08em; }}
.steps {{ list-style:none; padding:0; margin:0; }}
.steps li {{ display:grid; grid-template-columns:34px 1fr; gap:10px; padding:0 0 18px; }}
.step-number {{ border-radius:50%; background:var(--tomato); color:white; width:26px; height:26px; display:flex; align-items:center; justify-content:center; font:700 10px Arial,sans-serif; }}
.steps h3 {{ margin:2px 0 5px; font:700 10px Arial,sans-serif; letter-spacing:.08em; text-transform:uppercase; }}
.steps p {{ margin:0; font:12px/1.55 Arial,sans-serif; color:var(--muted); }}
.tip {{ background:var(--ink); color:white; border-radius:12px; padding:17px 20px; margin-top:5px; }}
.tip b,.bottom-cards b {{ color:var(--honey); font:700 9px Arial,sans-serif; letter-spacing:.1em; }}
.tip p,.bottom-cards p {{ margin:7px 0 0; color:inherit; font:11px/1.5 Arial,sans-serif; }}
.bottom-cards {{ display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-top:13px; }}
.bottom-cards section {{ background:var(--white); border:1px solid var(--line); border-radius:10px; padding:14px; }}
.bottom-cards b {{ color:var(--tomato); }}
.bottom-cards p {{ color:var(--muted); font-size:10px; }}
.fine-print {{ color:var(--muted); font:9px Arial,sans-serif; margin-top:18px; }}
.folio {{ position:absolute; bottom:21px; left:58px; right:58px; border-top:1px solid var(--line); padding-top:9px; display:flex; justify-content:space-between; color:var(--muted); font:8px Arial,sans-serif; letter-spacing:.08em; }}
.folio b {{ color:var(--tomato); }}
.credits-list {{ display:grid; grid-template-columns:1fr 1fr; gap:15px 28px; margin-top:28px; }}
.credits-list section {{ border-bottom:1px solid var(--line); padding-bottom:12px; }}
.credits-list b {{ display:block; font:700 11px Arial,sans-serif; }}
.credits-list span,.credits-list a {{ display:block; color:var(--muted); font:10px/1.5 Arial,sans-serif; margin-top:4px; overflow-wrap:anywhere; }}
.credits-list a {{ color:var(--tomato); }}
.disclaimer {{ background:var(--paper-dark); border-radius:11px; padding:16px; margin-top:25px; font:11px/1.6 Arial,sans-serif; color:var(--muted); }}
.notes-lines {{ margin-top:38px; }} .notes-lines div {{ height:57px; border-bottom:1px solid var(--line); }}
@media (max-width:720px) {{ main {{ box-shadow:none; }} .page {{ padding:28px 22px 48px; min-height:auto; }} .cover {{ min-height:900px; }} .cover h1 {{ font-size:39px; }} .cover h1 span {{ font-size:27px; }} .cover img {{ height:300px; }} .recipe-opening .hero {{ height:260px; }} .recipe-opening h2 {{ font-size:26px; }} .meta {{ grid-template-columns:repeat(2,1fr); }} .visual-flow {{ grid-template-columns:1fr; }} .ingredients {{ columns:1; }} .toc {{ columns:1 !important; }} .folio {{ left:22px; right:22px; }} }}
@media print {{ body {{ background:white; }} main {{ max-width:none; box-shadow:none; }} .page {{ width:8.5in; min-height:11in; height:11in; padding:.52in .58in .55in; break-after:page; page-break-after:always; }} .recipe-opening .hero {{ height:3.43in; }} .visual-flow {{ gap:.06in; margin:.08in 0 .1in; }} .visual-card {{ min-height:.68in; padding:.05in; }} .stage-svg {{ width:.37in; height:.37in; }} .folio {{ left:.58in; right:.58in; }} a {{ color:inherit; }} @page {{ size:letter; margin:0; }} }}
</style>
</head>
<body>
<main>
<section class="page cover">
  <p class="mark">A GRANDMA ROSIE COOKBOOK</p><div class="rule"></div>
  <h1>GRANDMA ROSIE'S<span>AMERICAN COMFORT FOOD</span></h1>
  <p class="subtitle">20 all-American favorites, made with a little more love</p>
  <div class="ribbon">BIG FLAVOR · CLEAR STEPS · NO BORING BITES</div>
  <img src="assets/01-smash-burger.jpg" alt="Juicy American smash burger with melted cheese">
  <div class="cover-quote">The good stuff belongs at home.</div>
  <p class="small">A cook-at-home companion to the Grandma Rosie 15-second recipe series</p>
</section>
<section class="page welcome"><header class="running"><b>GRANDMA ROSIE</b><span>A NOTE FROM ROSIE</span></header>
  <p class="eyebrow">PULL UP A CHAIR</p><h2>Welcome to Rosie's kitchen.</h2>
  <p class="lead">The videos may be 15 seconds. Dinner still takes the time it takes.</p>
  <p>This book is the cook-at-home companion to the Grandma Rosie recipe series: twenty familiar American favorites, written for real kitchens and hungry people. You will find crisp burgers, creamy pasta, breakfast sandwiches, quick snacks, and a few sweet reasons to preheat the oven.</p>
  <p>Every recipe starts with a finished-dish image and a three-panel prep, cook, and finish illustration. You will also find the yield, timing, equipment, measured ingredients, clear steps, and a practical storage note. The photos are visual inspiration; ingredients, brands, ovens, and plating can change the final look.</p>
  <p>Rosie's rule is simple: no long introductions, no mystery measurements, and no shame in using a shortcut when the day is busy. Read the recipe through once, gather what you need, and let the skillet do the talking.</p>
  <div class="quote"><b>GRANDMA ROSIE SAYS</b><strong>Good food doesn't need a long speech.<br>It needs a hot pan, a little patience, and enough cheese.</strong></div>
  <p class="fine-print">Grandma Rosie is a fictional cooking persona created for this collection.</p>
  <footer class="folio"><span>AMERICAN COMFORT FOOD</span><b>02</b></footer>
</section>
<section class="page guide"><header class="running"><b>GRANDMA ROSIE</b><span>BEFORE YOU COOK</span></header>
  <p class="eyebrow">THE ROSIE KITCHEN GUIDE</p><h2>A few good things to know.</h2>
  <p>The recipes use familiar U.S. kitchen measures first. Metric amounts are practical approximations; for baking, a scale is the surest way to get consistent results.</p>
  <div class="note-grid">
    <section><h3>MEASUREMENTS</h3><ul><li>1 cup liquid = 240 ml</li><li>1 tablespoon = 15 ml</li><li>1 teaspoon = 5 ml</li><li>1 ounce = about 28 g</li><li>Spoon flour into the cup and level it; don't pack it.</li></ul></section>
    <section><h3>OVEN CONVERSIONS</h3><ul><li>325°F = 165°C</li><li>350°F = 175°C</li><li>375°F = 190°C</li><li>400°F = 200°C</li><li>425°F = 220°C</li></ul></section>
    <section><h3>SAFE TEMPERATURES</h3><ul><li>Ground beef: 160°F / 71°C</li><li>Poultry: 165°F / 74°C</li><li>Reheated leftovers: 165°F / 74°C</li><li>Use an instant-read thermometer in the thickest part.</li></ul></section>
    <section><h3>A FEW KITCHEN HABITS</h3><ul><li>Preheat the oven fully.</li><li>Grate cheese from a block for smoother melting.</li><li>Keep raw meat separate from ready-to-eat foods.</li><li>Refrigerate perishable leftovers within 2 hours.</li></ul></section>
  </div>
  <p class="fine-print">People with food allergies should check every package label and adapt the recipe safely.</p>
  <footer class="folio"><span>AMERICAN COMFORT FOOD</span><b>03</b></footer>
</section>
<section class="page contents"><header class="running"><b>GRANDMA ROSIE</b><span>FIND YOUR FAVORITE</span></header>
  <p class="eyebrow">THE RECIPE INDEX</p><h2>Twenty very good reasons to eat.</h2>
  <p class="tagline">The page number points to the recipe's photo and ingredient list.</p>
  <nav class="toc">{toc_html}</nav>
  <footer class="folio"><span>AMERICAN COMFORT FOOD</span><b>04</b></footer>
</section>
{recipes_html}
<section class="page credits"><header class="running"><b>GRANDMA ROSIE</b><span>IMAGE CREDITS</span></header>
  <p class="eyebrow">A NOTE ABOUT THE PHOTOGRAPHS</p><h2>Image credits & use.</h2>
  <p class="tagline">Every recipe includes three original vector illustrations for the prep, cooking, and serving stages. Recipes 01–10 use original AI-generated finished-dish images; recipes 11–20 use stock food photographs for serving inspiration.</p>
  <div class="credits-list">{''.join(f'<section><b>{r["number"]:02d} · {html.escape(r["title"])}</b><span>{html.escape(r["image_credit"])}</span>' + (f'<span>Pexels photo ID {html.escape(r["photo_id"])}</span>' if r.get("photo_id") else '') + (f'<a href="{html.escape(r["source_url"])}" target="_blank" rel="noreferrer">Open source photo page</a>' if r.get("source_url") else '') + '</section>' for r in DATA if r['number'] >= 11)}</div>
  <div class="disclaimer">Pexels photos are used under the <a href="https://www.pexels.com/license/">Pexels License</a> (free use; attribution not required). Recipe 14: “Philly cheesesteak sandwich.jpg” by jeffreyw, licensed <a href="https://creativecommons.org/licenses/by/2.0/">CC BY 2.0</a> via Wikimedia Commons; cropped for layout. The photos are illustrative; your finished dish may look different. Grandma Rosie is a fictional cooking persona.</div>
  <footer class="folio"><span>AMERICAN COMFORT FOOD</span><b>45</b></footer>
</section>
<section class="page notes"><header class="running"><b>GRANDMA ROSIE</b><span>ONE LAST THING</span></header>
  <p class="eyebrow">FROM ROSIE'S TABLE</p><h2>Make it yours.</h2>
  <p class="tagline">Swap a topping, make the sauce a little spicier, or write down the change that made everyone ask for seconds. The best family recipe is the one that gets cooked again.</p>
  <p class="eyebrow" style="margin-top:55px">MY KITCHEN NOTES</p><div class="notes-lines">{''.join('<div></div>' for _ in range(7))}</div>
  <p class="fine-print">Cook times are estimates. Use safe internal temperatures and follow your appliance instructions.<br>Created in English for the Grandma Rosie American comfort-food collection · 2026</p>
  <footer class="folio"><span>AMERICAN COMFORT FOOD</span><b>46</b></footer>
</section>
</main>
</body></html>'''


def build_html():
    HTML_OUT.write_text(render_html(), encoding="utf-8")


def main():
    build_pdf()
    build_html()
    print(f"Wrote {PDF_OUT}")
    print(f"Wrote {HTML_OUT}")
    print(f"Recipes: {len(DATA)} · PDF pages: {4 + len(DATA) * 2 + 2}")


if __name__ == "__main__":
    main()
