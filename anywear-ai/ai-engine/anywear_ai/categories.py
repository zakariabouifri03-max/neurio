"""Garment categories and per-category placement hints for composite mode."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Placement:
    """Relative placement of the garment on the person photo (fractions of W/H)."""
    cx: float = 0.5        # horizontal center
    top: float = 0.26      # top of garment as fraction of person height
    bottom: float = 0.72   # bottom of garment as fraction of person height
    width_ratio: float = 0.62  # garment width as fraction of person width


CATEGORY_HINTS: dict[str, Placement] = {
    "shirt":      Placement(cx=0.5, top=0.26, bottom=0.68, width_ratio=0.64),
    "tshirt":     Placement(cx=0.5, top=0.28, bottom=0.62, width_ratio=0.66),
    "dress":      Placement(cx=0.5, top=0.26, bottom=0.92, width_ratio=0.62),
    "jacket":     Placement(cx=0.5, top=0.24, bottom=0.74, width_ratio=0.70),
    "coat":       Placement(cx=0.5, top=0.22, bottom=0.84, width_ratio=0.74),
    "trousers":   Placement(cx=0.5, top=0.50, bottom=0.98, width_ratio=0.66),
    "pants":      Placement(cx=0.5, top=0.50, bottom=0.98, width_ratio=0.66),
    "skirt":      Placement(cx=0.5, top=0.48, bottom=0.82, width_ratio=0.62),
    "sweater":    Placement(cx=0.5, top=0.26, bottom=0.66, width_ratio=0.66),
    "hoodie":     Placement(cx=0.5, top=0.24, bottom=0.70, width_ratio=0.70),
    "other":      Placement(cx=0.5, top=0.28, bottom=0.75, width_ratio=0.62),
}

KEYWORDS = {
    "shirt": ("shirt", "blouse", "top", "t-shirt", "tshirt", "tees"),
    "dress": ("dress", "gown", "slip"),
    "jacket": ("jacket", "blazer", "bomber", "cardigan"),
    "coat": ("coat", "overcoat", "trench"),
    "trousers": ("trousers", "pants", "pant", "slacks", "leggings"),
    "skirt": ("skirt", "mini"),
    "sweater": ("sweater", "knit", "jumper"),
    "hoodie": ("hoodie", "hoody", "sweatshirt"),
}


def normalize_category(category: str | None) -> str:
    if not category:
        return "other"
    c = category.strip().lower()
    if c in CATEGORY_HINTS:
        return c
    for key, words in KEYWORDS.items():
        if any(w in c for w in words):
            return key
    return "other"


def placement_for(category: str | None) -> Placement:
    return CATEGORY_HINTS[normalize_category(category)]
