# Neurio storefront

A production-shaped, dependency-free storefront for a curated **digital products**
marketplace — UI kits, templates, courses, e-books, Notion systems, presets and icons.

Open it with any static server:

```bash
cd site
python3 -m http.server 4173 --bind 0.0.0.0
# then visit http://localhost:4173
```

## What's inside

| File | Purpose |
| --- | --- |
| `index.html` | Full page: hero, categories, catalog, seller pitch, reviews, newsletter, footer, cart drawer, product quick view, seller form |
| `assets/styles.css` | Design tokens + all components (light theme, violet/mint palette, self-hosted Inter variable font) |
| `assets/app.js` | Product data, filtering/sorting/search, cart, wishlist, quick view, promo codes, demo checkout |
| `assets/fonts/` | Inter variable woff2 (latin) — no external font requests |
| `assets/hero-ambient-light.jpg` | Hero backdrop |
| `snippets/fourthwall-header.html` | Header-code snippet: light 5-star trust bar |
| `snippets/fourthwall-footer.html` | Footer-code snippet: reviews band, floating badge, AggregateRating |
| `snippets/fourthwall-trust-header.html` | All-in-one variant (single field) |
| `neurio-standalone.html` | Generated single-file build (all CSS/JS/fonts/images inlined) |
| `tools/build-standalone.mjs` | Rebuilds the single-file version |
| `FOURTHWALL.md` | Guide: Fourthwall setup, theme colours, limits |

## Interactions

- **Search** — hero search, catalog search, popular tags and `/` shortcut. Results are ranked by relevance (title > category > creator > formats).
- **Filter & sort** — category chips, "Saved" wishlist view, five sort modes, load more (9 → 18).
- **Product quick view** — description, deliverables, formats, price, add to cart, save.
- **Five-star catalogue** — every product is rated 5/5 in the seeded data; change `rating` on any product in `PRODUCTS` to adjust.
- **Cart drawer** — quantity control, remove, discount codes (`LAUNCH30` = 30%, `WELCOME10` = 10%), totals, demo checkout that issues an order number.
- **Wishlist** — persisted in `localStorage`, reflected in the header badge.
- **Seller flow** — application modal with inline validation.
- **Newsletter** — email validation and confirmation copy.

All data lives in the `PRODUCTS` array at the top of `assets/app.js`; every card, filter
chip and quick view is generated from it. Currency, copy and colours are centralised in
CSS custom properties at the top of `assets/styles.css`.

## Deploy

- **Any static host:** upload the `site/` folder.
- **Single file:** upload `site/neurio-standalone.html` alone (Netlify Drop, Vercel, GitHub Pages, even open it from disk). Rebuild with `node site/tools/build-standalone.mjs` after edits.
- **Fourthwall shop:** paste `snippets/fourthwall-header.html` into Header code and `snippets/fourthwall-footer.html` into Footer code (each well under the 30,000 character limit). See `FOURTHWALL.md`.

## Accessibility & performance

- Keyboard support: focus-visible rings, Escape closes overlays, focus trapping in the drawer and modals, skip link, ARIA states on toggles.
- Semantic landmarks, `aria-live` result counts and toasts.
- `prefers-reduced-motion` disables animation; no JS framework, no build step, ~50 KB of code plus fonts.
- Responsive from 320 px up; no external assets required at runtime.

> Note: the cart, checkout and seller form are front-end demos. Nothing is charged,
> stored on a server or emailed. Wire `#checkout` to Stripe/Paddle and `#sellForm`
> to your CRM before going live.
