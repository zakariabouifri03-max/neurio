# 🔥 Etsy Signal

**Transparent, evidence-based analytics for Etsy sellers — as a Chrome extension.**

When you search Etsy, Etsy Signal analyzes the listings on the page and adds a
compact analytics panel to each product. When you open a listing, it opens a
full multi-signal dashboard. Every number is one of two things:

1. **REAL** — copied directly from publicly observable data on the page you're viewing, or
2. **ESTIMATE** — a clearly-labelled range with a confidence score and the exact evidence behind it.

> ⚖️ **Prime directive: ACCURACY > APPEARANCE.** Etsy Signal would rather show
> *"Insufficient public data"* than a convincing fake number. No random values,
> no hidden multipliers, no fabricated history — anywhere in the codebase.

---

## What you get

| Feature | Where |
|---|---|
| 🃏 Compact panel per listing: price, rating, reviews, est. sales/revenue ranges, demand/competition/opportunity, confidence + evidence bar | search results |
| ⚡ Floating **Analyze Page** toolbar with sort modes: 🔥 Best Opportunity · 📈 Fastest Growing · 💰 Revenue Potential · 🥊 Lowest Competition · ⭐ Strongest Demand · 🆕 New Rising | search results |
| 🔍 **Why this estimate?** — data used, model-by-model breakdown, estimation quality, confidence, limitations | everywhere |
| 📊 Product dashboard: Overview / Sales Intelligence / Demand / Competition / Opportunity / Evidence + review-history chart | listing page |
| 📅 **Historical tracking**: every visit stores a timestamped snapshot; review velocity, rank movement, acceleration and confidence improve with tracked time ("Tracked for 37 days") | backend |
| 🗂 Popup: tracked listings, side-by-side comparison (up to 4), backend settings | toolbar icon |

Example panel output (real pipeline output, not a mockup):

```
🔥 Etsy Signal                                   ESTIMATE      [Why?]
Price $19.99 · ★4.8 · 451 reviews · 🏷 Bestseller
Est. sales        4.6k–28k      Est. monthly  1.1k–4.4k
Est. revenue/mo   $21k–$88k
Demand 87 · Competition 51 · Opportunity 75
Confidence 79%  ▓▓▓▓▓▓▓░░░   Tracked for 30 days
```

## How estimation works (no `reviews × 10`)

Sales are estimated by an **ensemble of independent log-normal models**, pooled
by reliability weight — disagreement *widens* the interval instead of being
averaged away:

* `review_propensity` — reviews ÷ documented propensity prior (median 3%, disclosed)
* `shop_calibrated` — reviews ÷ the **shop's actual public review rate** (real data when Etsy shows shop sales + reviews)
* `velocity_rate` — measured reviews/day from your own tracking history ÷ propensity
* `avg_rate_from_age` — lifetime reviews ÷ public listing age
* `favorites_model` — weak, wide, clearly down-weighted
* Bestseller badges floor only P10 (conservative, documented)

Revenue = monthly sales × observed price, with discounts/variation ranges
handled; **no observed price ⇒ "Revenue estimate unavailable"**.
Confidence comes from a separate engine (signal count, tracking duration,
freshness, model consistency, data quality) and is capped at 97%.

📖 Full math: [`docs/ESTIMATION_METHODOLOGY.md`](docs/ESTIMATION_METHODOLOGY.md)

## Architecture

```
Chrome Extension (MV3, TS, React, Vite)
   content script ── reads PUBLIC on-page data only (signal-engine)
   background SW  ── queue + throttle + backoff + cache
        │  REST/JSON
        ▼
Backend API (Node + Fastify + TypeScript)
        │
        ▼
PostgreSQL  (listings · observations · serp_snapshots)
        │
        ▼
Signal Engine → Estimation Engine (pure, deterministic, unit-tested)
        │
        ▼
Analysis JSON → Extension dashboards
```

```
/shared              types — hard separation of real vs estimated data
/signal-engine       DOM extraction + parsers (multi-strategy, jsdom-tested)
/estimation-engine   statistics: ensembles, velocities, scores, confidence
/backend             Fastify API + stores (Postgres & in-memory)
/database            schema.sql + notes
/extension           Manifest V3 extension (content script, SW, popup)
/docs                methodology, API, schema, installation, limitations
```

## Quick start

```bash
npm install
npm run build                                   # builds everything + extension/dist
STORAGE=memory npm run start -w backend         # zero-dependency backend on :8787
# Chrome → chrome://extensions → Developer mode → Load unpacked → extension/dist
```

Then open `https://www.etsy.com/search?q=halloween+shirt`.
Full guide + production PostgreSQL setup: [`docs/INSTALLATION.md`](docs/INSTALLATION.md).

## Testing

```bash
npm test    # 67 tests
```

* estimation-engine (40): distributions, history fits, sales/revenue edge cases
  (0 reviews, 1 review, very old/new listings, missing price/rating, rapid
  growth, conflicting signals, shop calibration, determinism), demand /
  competition / opportunity / trend / confidence
* signal-engine (17): money/count/rating/date parsers, SERP + listing-page
  extraction against Etsy-style DOM fixtures (ads, badges, i18n prices)
* backend (7): ingest validation, timeline → velocity → analysis, peers, 404s
* shared (3): utilities

## Honesty & compliance

* Reads **only** what the user's browser is already rendering — no scraping,
  no bot traffic, no bypassing auth/CAPTCHA/rate limits. Respect Etsy's ToS,
  robots rules and API policies; if you hold official Etsy API access, prefer it.
* Network client implements throttling (2 concurrent, 150 ms spacing),
  timeouts, exponential backoff + jitter on 429/5xx, TTL caching, error states.
* Every estimate ships with `evidence`, `modelBreakdown`, `limitations` and a
  confidence score. The UI prints `ESTIMATE` badges and never presents
  estimates as Etsy data.

## Docs

* [`docs/INSTALLATION.md`](docs/INSTALLATION.md) — setup, env vars, loading in Chrome
* [`docs/ESTIMATION_METHODOLOGY.md`](docs/ESTIMATION_METHODOLOGY.md) — every formula & prior
* [`docs/API.md`](docs/API.md) — REST endpoints
* [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md) — tables & columns
* [`docs/LIMITATIONS.md`](docs/LIMITATIONS.md) — what we can't know, and what we do instead

---

*Not affiliated with or endorsed by Etsy, Inc. "Etsy" is a trademark of Etsy, Inc.*
