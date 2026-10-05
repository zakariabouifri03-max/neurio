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


def draw_recipe_opening(c, recipe: dict, page_number: int):
    draw_bg(c)
    draw_header(c, recipe["category"])
    photo_path = HERE / recipe["image"]
    img = make_image_reader(photo_path, ratio=1.78)
    img_x, img_y, img_w, img_h = M, 433, CONTENT_W, 297
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

    title = recipe["title"]
    title_size = fitted_size(title, SERIF_BOLD, 25, 19, CONTENT_W)
    c.setFillColor(INK)
    c.setFont(SERIF_BOLD, title_size)
    c.drawString(M, 397, title)

    tagline_y = 378
    tagline_end = draw_wrapped(c, recipe["tagline"], M, tagline_y, CONTENT_W,
                                font=SERIF, size=10.2, leading=13.5, color=INK_SOFT, max_lines=2)

    pill_y = min(340, tagline_end - 6)
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
        "Every recipe starts with a finished-dish image, then gives you the yield, timing, equipment, measured ingredients, clear steps, and a practical storage note. The photos are visual inspiration; ingredients, brands, ovens, and plating can change the final look.",
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
    intro = ("Recipes 01–10 use original AI-generated food images created for this edition. "
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
@media (max-width:720px) {{ main {{ box-shadow:none; }} .page {{ padding:28px 22px 48px; min-height:auto; }} .cover {{ min-height:900px; }} .cover h1 {{ font-size:39px; }} .cover h1 span {{ font-size:27px; }} .cover img {{ height:300px; }} .recipe-opening .hero {{ height:260px; }} .recipe-opening h2 {{ font-size:26px; }} .meta {{ grid-template-columns:repeat(2,1fr); }} .ingredients {{ columns:1; }} .toc {{ columns:1 !important; }} .folio {{ left:22px; right:22px; }} }}
@media print {{ body {{ background:white; }} main {{ max-width:none; box-shadow:none; }} .page {{ width:8.5in; min-height:11in; height:11in; padding:.52in .58in .55in; break-after:page; page-break-after:always; }} .recipe-opening .hero {{ height:3.65in; }} .folio {{ left:.58in; right:.58in; }} a {{ color:inherit; }} @page {{ size:letter; margin:0; }} }}
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
  <p>Every recipe starts with a finished-dish image, then gives you the yield, timing, equipment, measured ingredients, clear steps, and a practical storage note. The photos are visual inspiration; ingredients, brands, ovens, and plating can change the final look.</p>
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
  <p class="tagline">Recipes 01–10 use original AI-generated food images created for this edition. Recipes 11–20 use stock food photographs for serving inspiration; these images were cropped for the page layout.</p>
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
