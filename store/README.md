# 🖤 ATLAS INK — a digital t-shirt design store

A complete, production-quality storefront for selling **print-ready t-shirt graphics as
digital downloads**. No build step, no framework, no CDN — every design is drawn from code
as SVG, every mockup is a generated garment, and downloads are produced in the browser.

**Open it:** serve the folder and visit it in a browser.

```bash
cd store && python3 -m http.server 8000   # → http://localhost:8000
```

---

## What's inside

| Area | Details |
|---|---|
| **Catalogue** | 12 original designs + a free studio sample + a 12-design bundle |
| **Previews** | Every design rendered on a photoreal-ish tee mockup, colour-switchable, plus a "flat file" view |
| **Shop tools** | Collection chips, live search (bilingual), sorting, saved/wishlist view |
| **Cart** | Slide-over drawer, quantities, promo codes (`INK20`, `WELCOME10`), persisted in `localStorage` |
| **Checkout** | Validated demo card form, order summary, generated order ID, downloads kept in the browser |
| **Downloads** | Real **standalone SVG** (fonts embedded as base64), **300 DPI PNG** rendered on canvas, and a **ZIP pack** built with a hand-written ZIP writer |
| **Pages** | Hero, shop, vault bundle, freebie, how-it-works, licensing, reviews, FAQ, newsletter, footer |
| **Bilingual** | Full English / Arabic copy with `dir="rtl"` layout, Cairo for Arabic body, auto-detected on first visit |
| **A11y** | Skip link, focus trapping in drawers/modals, `aria-live` toasts, keyboard-friendly cards, reduced-motion support |

## File map

```
store/
├── index.html              # page shell + static (translated) copy
├── css/style.css           # the whole design system, RTL + responsive rules
├── js/
│   ├── data.js             # 12 designs, collections, pricing, bilingual copy
│   ├── designs.js          # each graphic as pure SVG (font-driven, print-legible)
│   ├── i18n.js             # EN / AR dictionary
│   └── app.js              # rendering, cart, checkout, SVG/PNG/ZIP export
└── assets/
    ├── fonts/              # Anton, Instrument Serif, Inter, Space Mono, Cairo (self-hosted)
    └── favicon.svg
```

## Notes on the exports

- **SVG** — the design is rebuilt with an inline `@font-face` block (woff2 → base64) so the file
  opens identically anywhere, with no missing-font warnings.
- **PNG** — rasterised at 3000 × 3600 px through a canvas; the type is embedded in the drawing
  before rasterisation, so the PNG is a finished artwork.
- **ZIP** — `buildZip()` writes a valid store-method archive (local headers, central directory,
  EOCD) so a bundle is one download instead of twelve.

## Demo behaviour

Payments are simulated: the card form validates but never charges anything. Orders and the cart
live in `localStorage` (`atlasink.store.v1`, `atlasink.order.v1`), so *My downloads* keeps working
after a refresh in the same browser. Swap `handlePayment()` for a real provider when you go live.

Made with love — print something worth wearing.
