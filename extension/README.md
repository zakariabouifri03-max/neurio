# Etsy Insight Pro — Chrome Extension (Manifest V3)

A professional, local-first research assistant for Etsy sellers and product researchers.
It reads **publicly visible** data on Etsy product, shop, and search pages and turns it
into clearly-labelled insights: verified on-page facts vs. transparent **estimates**
(sales, views, revenue, scores) with confidence levels and written explanations.

- No backend. No accounts. No tracking. All data stays in `chrome.storage.local`.
- No bundler / no dependencies: plain HTML + CSS + JS, dependency-free canvas charts.
- Respects Etsy: reads only pages you already opened; never scrapes in the background,
  never touches private data (passwords, cookies, messages, payments).

## Features

| Area | What you get |
|---|---|
| **Product pages** | Verified title/price/reviews/rating/shop/category/digital-vs-physical/badges + estimated daily/weekly/monthly sales, views, revenue, demand/competition/opportunity scores |
| **Estimation engine** | `estimated orders = review velocity ÷ review rate`, shop-calibrated, sensitivity ranges, High/Medium/Low confidence, “How was this estimated?” trace |
| **Shop analytics** | Verified sales/listings/reviews/rating + estimated monthly/yearly revenue, per-listing sales, sortable listing table, top & most-reviewed picks, niche guess |
| **Research mode** | Search-page table (rank, price, reviews, est. sales/revenue, scores), saved sessions, **Export CSV/JSON** |
| **Keywords** | Term frequency from visible titles, long-tail detection, competition/demand/opportunity per keyword, suggestions — no fake search-volume claims |
| **Tracking** | Save products/shops, auto-snapshot on revisit, 7/30/90-day charts (reviews, sales, price, demand), trend labels |
| **UI** | Floating “Analyze” button + slide-over panel on Etsy, full dashboard (Overview/Research/Keywords/Tracked/Settings/Privacy), dark/light/auto theme, toolbar popup |

Every estimated number is badged **“Estimated”** with a confidence pill. Verified
on-page facts are badged **“Verified Etsy data”**.

## Folder structure

```
extension/
├── manifest.json                  # MV3 manifest (content scripts, popup, worker, icons)
├── README.md  INSTALL.md  TESTING.md  ALGORITHM.md  PRIVACY.md
├── icons/                         # icon16/32/48/128.png
├── sample-data/                   # mock extractor output for development (NOT real data)
├── test/run-tests.mjs             # manifest + syntax + unit tests (node, no browser)
└── src/
    ├── background/service-worker.js   # install defaults, context menu, badge, pruning alarm
    ├── content/
    │   ├── content.js                 # router, floating button, shadow-DOM panel, messaging
    │   └── extractors/                # resilient Etsy DOM readers (never invent values)
    │       ├── common.js              # selectors, JSON-LD, page-type detection
    │       ├── product.js  shop.js  search.js
    ├── popup/ (popup.html/css/js)     # toolbar popup: page type + quick actions
    ├── dashboard/                     # full analytics app
    │   ├── dashboard.html/css/js      # shell, theme, hash router, table helpers
    │   └── views/                     # overview, research, keywords, tracked-*, settings, privacy
    └── lib/                           # shared, unit-tested, dependency-free modules
        ├── namespace.js utils.js settings.js storage.js
        ├── estimation.js scores.js keywords.js
        └── tracking.js export.js charts.js
```

## Quick start

1. Open `chrome://extensions`, enable **Developer mode**, click **Load unpacked**,
   select the `extension/` folder. (Full steps: [`INSTALL.md`](INSTALL.md))
2. Open any Etsy listing → press **Analyze Product**. Open a shop → **Analyze Shop**.
   Open a search page → **Analyze Results**.
3. Press the toolbar icon for quick actions, or open the **dashboard** for history,
   research tables, keywords and settings.

## Estimation transparency

See [`ALGORITHM.md`](ALGORITHM.md) for the full math. In short:

- **Sales:** monthly review velocity ÷ assumed review rate (default 15%, adjustable),
  blended with observed shop data when available, widened into a range by the
  sensitivity setting (Conservative ×0.55–×1.25 · Balanced ×0.75–×1.6 · Optimistic ×0.9–×2.0).
- **Views:** estimated orders ÷ assumed conversion rate (default 2%), badge uplifts,
  favorites fallback. Etsy doesn’t publish competitor views, so this is always an estimate.
- **Revenue:** estimated sales × visible price.
- **Scores (0–100):** Demand (volume/rating/favorites/momentum/badges),
  Competition (saturation/rivals/price/depth, higher = tougher),
  Revenue potential (log-scaled), Opportunity = 45/25/30 blend.
- **Confidence:** High/Medium/Low from evidence actually present
  (recent activity, listing age, shop calibration, history depth, favorites).

## Privacy

Local-first: see [`PRIVACY.md`](PRIVACY.md) and the in-app Privacy tab.
Nothing is sent anywhere; exports/backups are files you create explicitly.

## Testing

```bash
cd extension/test
npm install   # once: jsdom for DOM tests (test-only dependency)
npm test      # unit suite (88) + real-DOM extractor suite (48) = 136 checks
```

- `node run-tests.mjs` — manifest validation + `node --check` + unit tests (no deps).
- `node dom-tests.mjs` — extractors run against realistic Etsy-style HTML
  fixtures (product incl. variant pricing + distractors, shop, search),
  plus estimation edge cases (shop cap, unreviewed bound, tracked velocity).

Plus manual checks on live Etsy pages — see [`TESTING.md`](TESTING.md).

## Limitations (honest)

- Etsy doesn’t expose exact per-listing sales or competitor views; those figures are
  **estimates** and are always labelled as such.
- Extraction depends on Etsy’s markup; selectors are multi-fallback and JSON-LD-first,
  and every field degrades to “—” (never fabricated) when missing.
- Revenue uses the visible price with no currency conversion or fee modelling.
