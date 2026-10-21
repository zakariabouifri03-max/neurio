#!/usr/bin/env python3
"""
Build adzakART's storefront catalog.

Reads:   data/catalog.tsv + data/catalog-part2.tsv
Writes:  data/catalog.json, js/catalog.js

Add a new design by appending a row to the TSV:
    id <TAB> slug <TAB> title <TAB> image-path <TAB> etsy-price
then run:  python3 tools/build_catalog.py
"""
from __future__ import annotations

import json
import re
import sys
import unicodedata
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT_JS = ROOT / "js" / "catalog.js"
OUT_JSON = DATA / "catalog.json"
LOCAL_MAP = DATA / "local-images.json"
USE_LOCAL = "--local" in sys.argv

IMAGE_BASE = "https://i.etsystatic.com/61867927"
SHOP_URL = "https://www.etsy.com/shop/adzakART"
SHOP_NAME = "adzakART"
OWNER = "Mohammed Bouifri"
LOCATION = "Sefrou, Morocco"

# ---------------------------------------------------------------------------
# Categories: (slug, label, priority, [(regex, weight), ...])
# The highest-scoring category wins; ties go to the lower priority number.
# ---------------------------------------------------------------------------
CATEGORIES: list[tuple[str, str, int, list[tuple[str, int]]]] = [
    (
        "halloween",
        "Halloween",
        0,
        [
            (r"halloween", 5), (r"halloweentown", 5), (r"hocus pocus", 5),
            (r"mombie", 5), (r"trick or treat", 5), (r"ghost", 4),
            (r"spooky", 4), (r"haunted", 4), (r"momster", 4), (r"jack o", 4),
            (r"witch", 3), (r"skeleton", 3), (r"\bboo\b", 3),
            (r"monster", 3), (r"scarecrow", 3), (r"vampire", 3),
            (r"mummy", 3), (r"pumpkin", 1),
        ],
    ),
    (
        "fall",
        "Fall & Thanksgiving",
        1,
        [
            (r"thanksgiving", 4), (r"turkey", 3), (r"autumn", 3),
            (r"\bfall\b", 3), (r"harvest", 3), (r"leaves", 2),
            (r"pumpkin", 1),
        ],
    ),
    (
        "christmas",
        "Christmas & New Year",
        2,
        [
            (r"christmas", 5), (r"santa", 4), (r"merry", 3), (r"cocoa", 3),
            (r"new year", 3), (r"2027", 2), (r"holiday", 2),
        ],
    ),
    (
        "patriotic",
        "Patriotic & USA",
        3,
        [
            (r"4th of july", 5), (r"fourth of july", 5), (r"patriotic", 5),
            (r"juneteenth", 5), (r"1776", 5), (r"two fiddy", 5),
            (r"semiquincentennial", 5), (r"independence day", 5),
            (r"americana", 4), (r"founding fathers", 4),
            (r"stars and stripes", 4), (r"george washington", 3),
            (r"fighter jets", 3), (r"red white and", 3),
            (r"\bamerica", 2), (r"\busa\b", 2), (r"\bflag\b", 2),
        ],
    ),
    (
        "mexico",
        "Mexico & Heritage",
        4,
        [
            (r"mexic", 4), (r"latino", 4), (r"cruz azul", 5),
            (r"vamos", 4), (r"hecho en", 5),
        ],
    ),
    (
        "sports",
        "Sports & Game Day",
        5,
        [
            (r"football", 4), (r"soccer", 4), (r"softball", 4),
            (r"baseball", 4), (r"futbol", 4), (r"touch ?down", 4),
            (r"game day", 3), (r"world cup", 3), (r"scotland", 3),
            (r"sport", 1),
        ],
    ),
    (
        "western",
        "Western & Cowgirl",
        6,
        [
            (r"western", 3), (r"cowboy", 3), (r"cowgirl", 3),
            (r"rodeo", 4), (r"howdy", 3), (r"\bboots?\b", 1),
            (r"cow print", 2),
        ],
    ),
    (
        "school",
        "Teacher & School",
        7,
        [
            (r"teacher", 3), (r"school", 3), (r"classroom", 3),
            (r"library", 3), (r"class of", 3), (r"abcd", 4),
            (r"\bbook", 2), (r"read", 2), (r"crayon", 2),
            (r"first day", 2), (r"\bpod\b", 1),
        ],
    ),
    (
        "animals",
        "Pets & Animals",
        8,
        [
            (r"\bdachshund", 3), (r"\bdoxie", 3), (r"\bpuppy", 3),
            (r"\bkitten", 3), (r"\bdogs?\b", 2), (r"\bcats?\b", 2),
            (r"\bcow\b", 2), (r"\bgoose\b", 2), (r"\braccoon", 2),
            (r"\bfrog\b", 2), (r"\bwiener", 2), (r"\bpets?\b", 2),
        ],
    ),
    (
        "everyday",
        "Everyday & Funny",
        99,
        [],
    ),
]
CATEGORY_BY_ID = {slug: (label, priority) for slug, label, priority, _ in CATEGORIES}

# A handful of Etsy titles are keyword-heavy. These display names keep cards
# and product headlines elegant without touching the real listing titles.
SHORT_TITLES = {
    "4517049811": "Only Treason If You Lose",
    "4517109428": "Class of 2039",
    "4523705786": "Mexico Vintage Flag",
    "4558330710": "Boo Boo-p Dog Ghost",
    "4528570760": "Pledge Allegiance",
    "4528662327": "Stars, Stripes & Human Rights",
    "4530846466": "She Loves Jesus & America",
    "4516367686": "We Water At Dawn",
    "4532689783": "Spooky Vibes Cat",
    "4528713208": "Jesus Is The Light",
    "4592899386": "Thankful Grateful & Blessed",
    "4557781008": "Funny Halloween for Women",
    "4532419765": "Summer Santa Flamingo",
}


def score_categories(title: str) -> dict[str, int]:
    text = title.lower()
    scores: dict[str, int] = {}
    for slug, _label, _priority, rules in CATEGORIES:
        score = sum(weight for pattern, weight in rules if re.search(pattern, text))
        if score:
            scores[slug] = score
    return scores


def categorize(title: str) -> tuple[str, list[str]]:
    """Return (primary category, extra collection tags)."""
    scores = score_categories(title)
    priority = {slug: p for slug, _l, p, _r in CATEGORIES}
    ranked = sorted(scores, key=lambda slug: (-scores[slug], priority[slug]))
    primary = ranked[0] if ranked else "everyday"
    tags = [primary]
    for slug in ranked[1:]:
        if len(tags) >= 4:
            break
        if slug == "everyday" or scores[slug] < 2:
            continue
        tags.append(slug)
    return primary, tags


def make_short(title: str) -> str:
    """A boutique-label version of the keyword-stuffed Etsy title."""
    # Drop the keyword tail: split on the first separator that is not part of
    # a phrase such as "PNG:".
    head = re.split(r"\s*(?:,|\||\u2014| - )", title, maxsplit=1)[0]
    head = re.split(r"\s*:\s+(?=[A-Z])", head, maxsplit=1)[0]
    head = re.sub(r"\s*\bPNG\b\s*$", "", head, flags=re.I)
    head = re.sub(r"\s*\((?:digital download|instant download)\)\s*$", "", head, flags=re.I)
    head = re.sub(r"\s+", " ", head).strip(" ,.-")
    head = re.sub(r"\s*\bPNG\b\s*$", "", head, flags=re.I)
    if len(head) < 4:
        head = re.split(r"\s*(?:,|\|)", title, maxsplit=1)[0]
    return head.strip()


def slugify(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return value


def read_rows() -> list[dict]:
    rows: list[dict] = []
    for name in ("catalog.tsv", "catalog-part2.tsv"):
        path = DATA / name
        if not path.exists():
            continue
        for lineno, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if not raw.strip():
                continue
            parts = raw.split("\t")
            if parts[0] == "id":
                continue
            if len(parts) < 5:
                sys.exit(f"{name}:{lineno}: expected 5 columns, got {len(parts)}")
            listing_id, slug, title, image, price = (p.strip() for p in parts[:5])
            rows.append(
                {
                    "id": listing_id,
                    "slug": slug or slugify(title),
                    "title": title,
                    "imagePath": image,
                    "etsyPrice": float(price) if price else None,
                }
            )
    seen: set[str] = set()
    for row in rows:
        if row["id"] in seen:
            sys.exit(f"Duplicate listing id: {row['id']}")
        seen.add(row["id"])
    return rows


def main() -> None:
    rows = read_rows()
    local_map = {}
    if USE_LOCAL and LOCAL_MAP.exists():
        local_map = json.loads(LOCAL_MAP.read_text(encoding="utf-8"))
    designs = []
    for index, row in enumerate(rows):
        category, tags = categorize(row["title"])
        label = CATEGORY_BY_ID[category][0]
        local = local_map.get(row["id"])
        image = local if local else IMAGE_BASE + row["imagePath"]
        designs.append(
            {
                "id": row["id"],
                "slug": row["slug"],
                "title": row["title"],
                "short": SHORT_TITLES.get(row["id"], make_short(row["title"])),
                "category": category,
                "categoryLabel": label,
                "tags": tags,
                "tagLabels": [CATEGORY_BY_ID[t][0] for t in tags],
                "image": image,
                "imageLarge": image if local else image.replace("il_340x270", "il_794xN"),
                "imageCard": image if local else image.replace("il_340x270", "il_680x540"),
                "etsyPrice": row["etsyPrice"],
                "etsy": f"https://www.etsy.com/listing/{row['id']}/{row['slug']}",
                "index": index,
            }
        )

    counts: dict[str, int] = {slug: 0 for slug, *_ in CATEGORIES}
    for design in designs:
        for tag in design["tags"]:
            counts[tag] += 1

    categories = [
        {"id": slug, "label": label, "count": counts[slug]}
        for slug, label, _priority, _rules in CATEGORIES
    ]

    payload = {
        "shop": {
            "name": SHOP_NAME,
            "owner": OWNER,
            "location": LOCATION,
            "url": SHOP_URL,
            "sales": 118,
            "rating": 4.5,
            "reviewCount": 6,
            "totalDesigns": len(designs),
        },
        "categories": categories,
        "designs": designs,
    }

    OUT_JSON.write_text(json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8")
    OUT_JS.parent.mkdir(parents=True, exist_ok=True)
    OUT_JS.write_text(
        "/* Generated by tools/build_catalog.py — edit the TSV, not this file. */\n"
        "window.ADZAK_CATALOG = "
        + json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
        + ";\n",
        encoding="utf-8",
    )

    mode = "local images" if local_map else "Etsy CDN images"
    print(f"Built {len(designs)} designs ({mode}) -> {OUT_JSON.relative_to(ROOT)} / {OUT_JS.relative_to(ROOT)}")
    for category in categories:
        print(f"  {category['label']:<24} {category['count']:>3}")


if __name__ == "__main__":
    main()
