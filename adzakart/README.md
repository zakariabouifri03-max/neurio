# adzakART — digital design storefront

A complete, production-ready storefront for **adzakART** (Sefrou, Morocco): **139 original designs, $2 each, delivered instantly as a transparent PNG.**

Live catalog is generated from your real Etsy shop — no placeholder products.

```
adzakart/
├── index.html                 # shell (header, footer, search, saved drawer)
├── css/styles.css             # the whole design system — one file
├── js/
│   ├── config.js              # price, copy, FAQ, reviews, hero picks (edit me)
│   ├── catalog.js             # generated from data/*.tsv — do not edit
│   └── app.js                 # routing, search, saved designs, rendering
├── data/
│   ├── catalog.tsv            # 72 designs
│   ├── catalog-part2.tsv      # 67 designs
│   └── catalog.json           # generated
├── assets/favicon.svg
└── tools/
    ├── build_catalog.py       # TSV → catalog.json + catalog.js
    └── fetch-images.mjs       # optional: mirror Etsy images locally
```

## Run it

No build step, no dependencies:

```bash
cd adzakart
python3 -m http.server 8080
# open http://localhost:8080
```

Deploy by uploading the folder to any static host. On **GitHub Pages** it works from a subfolder (e.g. `https://user.github.io/neurio/adzakart/`) because every path is relative.

## The store, in short

- **One price** — every design is `$2` (set once in `js/config.js` → `price`).
- **Real checkout** — each “Get this design” button opens that exact Etsy listing. Payment, delivery and buyer protection stay on Etsy; there is no backend to maintain.
- **The promise** — one high-resolution PNG, transparent background, no watermark, instant download.
- **139 designs** — searchable, filterable by 10 overlapping collections, sortable, with “load more” pagination.
- **Saved designs** — hearts + a collection drawer, stored in `localStorage`.
- **Studio pages** — About, FAQ, License, 404, plus real reviews from the Etsy shop.
- **SEO ready** — per-page titles/descriptions, Open Graph, Organization + Product JSON-LD.
- **Mobile first** — slide-in menu, sticky buy bar on product pages, 2-column product grid.
- **Keyboard & a11y** — `/` opens search, `Esc` closes overlays, skip link, visible focus, dialog roles, `aria-live` result counts.
- **Search** — instant filtering across titles, tags and collections, with a themed clear button and suggested terms.

## ⚠️ Align the price on Etsy

The storefront displays **$2.00**. Etsy currently charges the listing price (mostly $2.20–$3.16 on sale, $4–$6.75 regular). If a buyer checks out from this site, Etsy will charge the Etsy price, not $2.

To make the promise true, do one of these:

1. **Set every listing to $2.00** in Etsy (Shop Manager → Listings → bulk edit price), or
2. Run a sale that brings every listing to exactly $2, or
3. Change `price` in `js/config.js` to your real Etsy price and rebuild nothing (it is read at runtime).

That is the only thing that needs your attention before sharing the link.

## Adding or editing designs

Everything is generated from two tab-separated files. Append a row:

```
listing_id<TAB>slug<TAB>title<TAB>image-path<TAB>etsy-price
```

- `image-path` = the part of the Etsy image URL after `https://i.etsystatic.com/61867927`
  (e.g. `/r/il/2cc865/8195628549/il_340x270.8195628549_lx1e.jpg`)
- The builder derives the clean card title, the collection tags, the 680×540 card image and the 794px product image.
- Then run:

```bash
python3 tools/build_catalog.py
```

Deleting a design = delete its row and rebuild.

## Self-host the images (optional but recommended)

By default images stream from Etsy's CDN. To own every asset:

```bash
node tools/fetch-images.mjs          # downloads assets/designs/<id>.jpg
python3 tools/build_catalog.py --local
```

That writes `data/local-images.json` and points the catalog at local files. Re-run both commands whenever you add designs. Commit the `assets/designs/` folder if you want the host to serve them.

## Customising

| What | Where |
|---|---|
| Price, specs, licence text, FAQ, reviews, hero images, staff picks | `js/config.js` |
| Colours, type, spacing | `:root` in `css/styles.css` |
| Header/footer/search/drawer markup | `index.html` |
| Page templates | `js/app.js` (`homePage`, `shopPage`, `productPage`, `aboutPage`, `faqPage`, `licensePage`) |

The reviews are real quotes from the Etsy shop (Michelle, Adonay, Kamber, Etsy buyer, Yvette). Update `reviews` in `js/config.js` as new ones arrive.

## Notes

- Checkout is intentionally delegated to Etsy so files are delivered automatically and buyer protection applies. If you later add Stripe/Gumroad/Payhip, replace the `href` of the buy buttons in `productPage()` and the `data-buy` links.
- The brand mark is a hand-drawn eight-petal flower in `assets/favicon.svg`; reuse it for social avatars.
- Fonts (Fraunces + Inter) load from Google Fonts with system fallbacks.
- No trackers, no cookies, no external JS libraries.
