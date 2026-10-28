🎄 ADZAK — "$1 SALE" Instagram Post
====================================

Promo built for: **adzak-shop.fourthwall.com** — every design $3 → $1, 24 hours only.
All artwork is generated from code (Python + Pillow), no Canva templates.

## Files

| File | Size | Where to use it |
|---|---|---|
| `out/post_1080x1350.png` | 1080×1350 (4:5) | **Main feed post** — tall format takes the most screen in the feed |
| `out/post_1080x1350_v2.png` | 1080×1350 (4:5) | Second slide (carousel) — "CHRISTMAS PNG / ONLY $1" |
| `out/post_1080x1080.png` | 1080×1080 | Square version (grid-friendly / older layouts) |
| `out/story_1080x1920.png` | 1080×1920 (9:16) | Story + Reel cover — add the "Link" sticker on the CTA |
| `caption.txt` | — | Ready-to-paste English caption + hashtags |

Extra: `assets/flatlay_01.jpg`, `flatlay_02.jpg`, `flatlay_portrait.jpg` are the
hero photos, and `assets/fonts/` holds Anton + Inter (SIL Open Font License).

## Post it like this

1. Upload **post_1080x1350.png** first, then **post_1080x1350_v2.png** as slide 2 → carousel.
2. Paste `caption.txt`.
3. Put the shop link in your bio (`adzak-shop.fourthwall.com`) — Instagram doesn't make caption links clickable.
4. Post the story at the same time and add the **Link sticker** → "Shop now".
5. Best windows for a 24h flash sale: ~12:00 and ~19:00 local time, then re-share the story once with a "6 hours left" sticker.

## Editing / re-rendering

```bash
pip install pillow numpy
python3 instagram/make_post.py          # all sizes
python3 instagram/make_post.py story    # just the story
```

Copy lives in one place at the bottom of `make_post.py` (`post_4x5`, `post_1x1`, `story`)
— change `head1` / `head2` / `sub` and re-run. Headlines auto-shrink to fit, so
longer text won't overflow.

## Before you publish — quick check

- The line "High-resolution, print-ready PNGs" in the caption: edit it if your files differ.
- The old price shows **$3** and the new one **$1** (67% off). If you run the sale
  on $5 designs too, say "up to 80% off" instead of "save 67%" in `was_price(...)` calls.
- The 24h claim is on the art ("TODAY ONLY · 24 HOURS", "24H ONLY" seal) —
  delete the post when the sale ends so the grid stays honest.
