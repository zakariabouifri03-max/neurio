🎄 ADZAK — "$1 SALE" Instagram Kit
==================================

Promo for **adzak-shop.fourthwall.com** — every design **$3 → $1**, 24 hours only.
Built from the **real shop designs** (the four shirt PNGs), drawn entirely in code
(Python + Pillow, real font files — no Canva templates).

## Post it

| File | Size | Where |
|---|---|---|
| **`out/post_shop_1080x1350.png`** | 1080×1350 (4:5) | **Main feed post** — all 4 designs, each with a `$3 → $1` tag |
| `out/carousel_1..4_1080x1350.png` | 1080×1350 | **Carousel slides** — one design per slide (post these 4 together) |
| `out/post_shop_1080x1080.png` | 1080×1080 | Square version of the main post |
| `out/story_shop_1080x1920.png` | 1080×1920 | Story / Reel cover (add the Link sticker on the CTA) |
| `caption.txt` | — | Ready-to-paste English caption + hashtags |

Two ways to post, both work:

1. **Single post** → `post_shop_1080x1350.png` (fastest, everything at a glance).
2. **Carousel** → `carousel_1` → `carousel_4` (each design gets its own big slide).

## The four designs

| # | Slide label | Product |
|---|---|---|
| 1 | SPOOKY SEASON | ghost + plaid lettering (pink tee) |
| 2 | THE SEASON | "The Season / The Reason" Christian Christmas |
| 3 | COWBOY SANTA | western Santa |
| 4 | RETRO COLLAGE | "It's the Most Wonderful Time" retro characters |

⚠️ **Check design #1 in your shop:** the product image says **"SPOOKY season"**
(Halloween) but its listing title says *"Merry Christmas PNG, Patterned Holiday
Letter Design…"* on $1 while the others are $3. I labelled the artwork by what the
shirt actually shows; fix the listing title/price if it's a mistake.

## Editing / re-rendering

```bash
pip install pillow numpy
python3 instagram/make_shop_post.py     # all sizes + carousel
```

- Product order, labels and captions live in `assets/products/_manifest.json`
  (`label` = big word on the slide, `sub` = the grey line under it).
- Prices are two constants at the top of `make_shop_post.py`: `WAS`, `NOW`.
- ⚠️ Don't remove `from studio import ...` from inside `instagram/` — run the script
  from the repo root as shown, or from inside `instagram/`; `studio.py` is the shared
  drawing kit (fonts, colours, cards, QR).

## Also in this folder

`make_post.py` + `assets/flatlay_*.jpg` = a previous, **generic** version of the same
sale (styled flat-lay photos instead of your designs): `post_1080x1350.png`,
`post_1080x1350_v2.png`, `post_1080x1080.png`, `story_1080x1920.png`.
Use it as a second post later in the day if you want variety — the `$1` message is identical.

## Before you publish

- The art promises "24 HOURS / ENDS TONIGHT" — post it when the clock actually starts,
  and delete/archive the post when the sale ends.
- `was $3 · SAVE 67%` matches $3 → $1. If you also discount $5 designs, change the copy.
- Instagram doesn't make caption links clickable → the CTA says **link in bio**;
  put `adzak-shop.fourthwall.com` in your bio before posting.
