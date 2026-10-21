# adzakART — digital design storefront

A complete, self-contained storefront for **adzakART** (Sefrou, Morocco):
**139 original designs, $2 each, delivered instantly as transparent PNGs.**

The store belongs to you. There is no marketplace link, no outside checkout and
no third-party account in the buyer's path: **“Get this design” hands the file
over directly.**

```
adzakart/
├── index.html                 # shell (header, footer, search, saved drawer)
├── css/styles.css             # the whole design system — one file
├── js/
│   ├── config.js              # price, copy, FAQ, reviews, hero picks (edit me)
│   ├── catalog.js             # generated from data/*.tsv — do not edit
│   └── app.js                 # routing, search, saved designs, downloads
├── data/
│   ├── catalog.tsv            # 72 designs
│   ├── catalog-part2.tsv      # 67 designs
│   └── catalog.json           # generated
├── raw/                       # ← put your design files here
├── assets/
│   ├── favicon.svg
│   └── designs/
│       ├── <id>.jpg           # web previews (generated)
│       └── clean/<id>.png     # the files buyers download (generated)
└── tools/
    ├── prepare-store.py       # one command: art in, working store out
    ├── build_catalog.py       # TSV → catalog.json + catalog.js
    ├── clean-background.py    # backdrop remover (advanced / batch use)
    ├── check-transparency.py  # quality gate: proves the background is gone
    └── lib_bg.py              # shared cut-out + verification maths
```

## Run it

No build step, no dependencies, no server code:

```bash
cd adzakart
python3 tools/serve.py            # http://localhost:8080
```

`tools/serve.py` is a tiny static server that sends `Cache-Control: no-store`
for HTML, JS and CSS. Without it, a browser can keep an old copy of `app.js` in
cache and keep showing an older version of the store after you change
something. (Plain `python3 -m http.server 8080` also works — just hard-refresh
with **Ctrl/Cmd + Shift + R** if a change does not appear.)

Deploy by uploading the folder to any static host. On **GitHub Pages** it works
from a subfolder (e.g. `https://user.github.io/neurio/adzakart/`) because every
path is relative.

## The store, in short

- **One price** — every design is `$2` (set once in `js/config.js` → `price`).
- **Direct delivery** — “Get this design” is a plain download of
  `assets/designs/clean/<id>.png`. Same origin, no redirect, no account,
  no new tab. The file is named `adzakART-<slug>.png`.
- **The promise** — one high-resolution PNG, transparent background, no
  watermark, 300 DPI, nothing behind the artwork.
- **139 designs** — searchable, filterable by 10 overlapping collections,
  sortable, with “load more” pagination.
- **Saved designs** — hearts + a collection drawer, stored in `localStorage`.
- **Studio pages** — About, FAQ, License, 404, plus real customer reviews.
- **SEO ready** — per-page titles/descriptions, Open Graph, Organization +
  Product JSON-LD.
- **Mobile first** — slide-in menu, sticky buy bar on product pages,
  2-column product grid.
- **Keyboard & a11y** — `/` opens search, `Esc` closes overlays, skip link,
  visible focus, dialog roles, `aria-live` result counts.

## Adding your designs (the important part)

The store can only hand over files that exist inside it, so the artwork has to
be placed in the project once. That is one command.

```bash
pip install Pillow            # once
```

1. Put your files in `raw/` — **or pass a `.zip`**:

   ```bash
   python3 tools/prepare-store.py --in designs.zip
   ```

   Filenames can be anything. If the name starts with the design id it is used
   directly:

   ```
   raw/4523481819-funny-whiskey.jpg
   raw/4558369974-highland-cow.png
   ```

   If there is no id, the name is matched against the design titles in the
   catalog, so this works too:

   ```
   raw/I'll Be In The Backyard.png      -> 4523481819
   raw/Highland Cow Halloween.png       -> 4558369974
   ```

   It prints every guess so you can check it, and skips anything it cannot
   place with confidence.

2. Run:

   ```bash
   python3 tools/prepare-store.py
   ```

For every file it:

| step | result |
|---|---|
| reads the file | if it already has real transparency it is used as-is |
| removes the backdrop | a real transparent PNG (no white box left behind) |
| trims to the artwork | no dead space around the design |
| upscales | 3000 px long edge, 300 DPI, sharpened |
| verifies | refuses anything with a background still in it |
| writes the deliverable | `assets/designs/clean/<id>.png` |
| writes a light preview | `assets/designs/<id>.jpg` (used by cards) |
| rebuilds the catalog | “Get this design” works for that design immediately |

It finishes with a status line like:

```
Store status: 1/139 designs can be downloaded right now.
```

Designs without a file stay visible but show **“The print file for this design
is still being prepared”** instead of handing over a broken download. Add the
rest, run it again, and the number climbs.

Options: `--in my-folder`, `--target 4000` (bigger prints), `--dpi 300`,
`--choke 1` (if a faint halo survives), `--force` (re-clean a finished PNG).

### Doing it by hand

The two tools underneath are usable on their own:

```bash
python3 tools/clean-background.py --in raw --out assets/designs/clean --preview
python3 tools/check-transparency.py --in assets/designs/clean
```

`clean-background.py` reads the real backdrop colour from the border, flood-fills
**only the border-connected area** (white eyes, highlights and letter counters
survive), feathers the cut edge, un-multiplies the backdrop out of
semi-transparent pixels, then writes a print-ready PNG.

`check-transparency.py` is the gate. It fails a file when it has no alpha
channel, opaque corners (a boxed or JPEG backdrop), is mostly opaque, has almost
no transparent area, or carries a white fringe on the cut edge. Exit code is `0`
only when every file is sell-ready.

### Use the real artwork, not the product photos

The images that appear on a shop's listing cards are usually **mockups**: the
design printed on a shirt, photographed on a table, with a logo stamp on top.
Removing the background from a mockup gives you a white sweatshirt with a stamp
on it — not a design.

`prepare-store.py` needs the actual artwork file for each design (the PNG you
deliver to a buyer). If you only have mockups, save the transparent master from
the design app you work in, then run the tool again.

### White-on-white warning

If a design contains white or near-white details and was flattened onto a white
canvas, those details are already gone in the source file — no tool can recover
them. `clean-background.py` names the files that came from a near-white canvas so
you can check the preview. If a detail is missing, re-export that design on a
mid-tone or dark backdrop and run it again.

## Previews without an outside host

Once a design has been prepared, its card and product image come from
`assets/designs/` — the store no longer reaches out to any image host. Designs
you have not prepared yet fall back to the preview address recorded in the
catalog, so the shop still looks complete while you migrate.

## Customising

| What | Where |
|---|---|
| Price, specs, licence text, FAQ, reviews, hero images, staff picks | `js/config.js` |
| Contact link (`contactUrl`) | `js/config.js` |
| Colours, type, spacing | `:root` in `css/styles.css` |
| Header/footer/search/drawer markup | `index.html` |
| Page templates | `js/app.js` (`homePage`, `shopPage`, `productPage`, `aboutPage`, `faqPage`, `licensePage`) |

The reviews are real quotes from customers (Michelle, Adonay, Kamber,
a verified buyer, Yvette). Update `reviews` in `js/config.js` as new ones arrive.

## Editing the catalog

`data/*.tsv` is the source of truth for which designs exist:

```
id<TAB>slug<TAB>title<TAB>image-path<TAB>source-price
```

- `id` = the design id, also the filename of its download
- `slug` = URL-friendly name, used for the download filename
- `title` = full product title used in copy, search and SEO
- `image-path` = path of the preview image after the image host prefix
- `source-price` = internal reference only; **never displayed** (the shop is $2)

After editing, rebuild:

```bash
python3 tools/build_catalog.py
```

## Notes

- Downloads are plain files on a static host: there is no payment step. If you
  later want to charge before the file is released, put the paid file behind
  your checkout of choice and point `downloadButton()` in `js/app.js` at it —
  everything else keeps working.
- Product structured data points at this store's own URLs.
- Keep `assets/designs/clean/` in version control if your host serves the repo
  directly; it is the folder buyers download from.
