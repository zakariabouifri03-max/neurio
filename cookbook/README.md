# Grandma Rosie's American Comfort Food

A professional English-language cookbook built from the Grandma Rosie concept: 20 approachable American favorites, clear U.S. measurements with practical metric equivalents, detailed step-by-step methods, timing, equipment, storage guidance, a finished-dish image, and three illustrated prep/cook/finish stages for every recipe.

## Deliverables

- `Grandma-Rosies-American-Comfort-Food.pdf` — designed, 46-page, letter-size cookbook.
- `Grandma-Rosies-American-Comfort-Food.html` — responsive web edition with recipe navigation and print styles.
- `recipes.json` — editable recipe copy and photo-source metadata.
- `assets/` — the photographs used by both editions.
- `build_book.py` — regenerates the PDF and HTML from `recipes.json`.

## Rebuild

From the repository root:

```bash
python3 -m venv .venv
.venv/bin/pip install -r cookbook/requirements.txt
.venv/bin/python cookbook/build_book.py
```

## Image notes

Recipes 01–10 use original AI-generated food images created for this edition. Recipes 11–20 use stock images for serving inspiration and are credited in the book; the Pexels images are used under the [Pexels License](https://www.pexels.com/license/). Recipe 14 uses “Philly cheesesteak sandwich.jpg” by jeffreyw, via Wikimedia Commons, under [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/); it is cropped to fit the page. The recipe data preserves source links and Pexels photo IDs where available.

The Grandma Rosie persona is fictional. Stock photographs are illustrative; plating and final appearance may vary from the recipe as written.
