# Etsy Signal — Estimation Methodology

This document is the single source of truth for *how every number is produced*.
Every formula, prior and threshold lives here (and in
`estimation-engine/src/assumptions.ts`). Nothing downstream invents additional
constants.

## 0. Prime directive

> **ACCURACY > APPEARANCE.** When evidence is insufficient the system outputs
> `"Insufficient public data"` / `"Not enough historical observations"` — never
> a plausible-looking invented number.

All uncertainty is modeled with **log-normal distributions** and combined with
a **weighted log-space opinion pool**, so results are always ranges
(P10/P50/P90), never point values.

---

## 1. Data classes

| Class | Examples | Rendering rule |
|---|---|---|
| **REAL** (observed) | price, rating, review count, shop sales (when public), badges, search position, listed-on date, title, shop name | shown as-is, no transformation |
| **ESTIMATED** | sales, monthly sales, revenue, demand/competition/opportunity/trend scores | always shown as range + confidence + evidence + limitations, always flagged `ESTIMATE` |

The two classes are different TypeScript types (`ListingObservation` vs
`Estimate`/`Score`), so the UI physically cannot present one as the other.

## 2. The review→sales problem

Etsy does not disclose sales. The strongest *public* proxy is the review count,
but only a fraction `p` of buyers leave a review (**review propensity**).

### 2.1 The prior (documented assumption)

```
p ~ LogNormal(median = 3.0%, sigma = 0.55 in log space)
→ interdecile range ≈ 1.2% … 7.6%
```

Rationale: published marketplace research places organic review rates in the
~1–7% band. Etsy publishes no figure, so this is **explicitly an assumption**
and every estimate that relies on it says so in its `limitations`.

### 2.2 Shop calibration (real data overrides the prior)

When Etsy publicly shows a shop's **total sales** and **total reviews**
(e.g. "18,200 sales", "610 reviews" on the shop page), we compute the shop's
*actual* review rate:

```
p_shop = shop_reviews / shop_sales     (clamped to [0.1%, 30%])
```

This is **real observed data**, and when present it anchors the
`shop_calibrated` model with a much tighter variance
(`sigma² = 0.22² + 1/shop_reviews`, the latter from the binomial delta method).

## 3. Sales models (the ensemble)

Each model outputs a log-normal `(mu, sigma², weight, note)`.

| Model | Formula (median) | When active | Weight basis |
|---|---|---|---|
| `review_propensity` | `reviews / p_prior` | reviews > 0 | 0.5 (+0.15 if reviews ≥ 25) |
| `shop_calibrated` | `reviews / p_shop` | shop totals public | 0.9 · √(shop_sales/200) capped |
| `velocity_lifetime` | `(reviews/day ÷ p) × age_days` | tracked velocity + public listing age | 0.35 + 0.2·min(1, span/30) |
| `velocity_rate` (monthly) | `(reviews/day ÷ p) × 30` | ≥2 snapshots ≥3 days apart | 0.55 + 0.25·min(1, span/30) + 0.1·min(1,(n−2)/6) |
| `velocity_rate_near_zero` | floor-rate, wide | tracked velocity ≈ 0 | 0.3 |
| `avg_rate_from_age` (monthly) | `reviews / age_days ÷ p × 30` | public age ≥ 14 days | 0.35 |
| `favorites_model` | `favorites / 0.12` | favorites publicly shown | 0.15 (weak on purpose) |

Notes:

* Sparse counts add variance: `sigma² += 0.5/reviews` when reviews < 20.
* A **Bestseller badge** applies a conservative *floor* of 30 sales/month to
  **P10 only** (Etsy's badge thresholds are private — documented assumption).
* `reviews = 0` → **no range is emitted**; instead we report the statistical
  upper bound `sales ≤ 3/p_median` (95%, ≈ 100) as a limitation note.

### 3.1 Pooling

```
mu_pool  = Σ wᵢ·muᵢ / Σ wᵢ
var_pool = Σ wᵢ·(sigmaᵢ² + muᵢ²)/Σ wᵢ − mu_pool²
```

Model **disagreement inflates the variance** (mixture variance), so conflicting
signals produce wider intervals — they are never silently averaged away.
Sigma is clamped to `[0.16, 1.15]` (never overconfident, never useless).

Quantiles: `Pq = exp(mu_pool + z_q · sqrt(var_pool))` with
`z_0.10 = −1.2816`, `z_0.50 = 0`, `z_0.90 = +1.2816`.

## 4. Revenue

```
ln(revenue) = ln(monthly_sales) + ln(effective_price)
sigma²_revenue = sigma²_sales + sigma²_price
```

Price handling (no invented numbers):

* no observed price → **"Revenue estimate unavailable"**
* active discount → effective price band `[sale, original]`
* public variation prices → band spans `[min, max]`
* historical price fluctuation (CV) → added variance (capped 0.25)

## 5. Historical tracking

Every observation is stored with its real timestamp. Velocities are ordinary
least-squares fits of value-vs-time over the stored snapshots:

```
review velocity   = d(reviews)/dt        (floored at 0, inconsistencies flagged)
position velocity = d(position)/dt       (negative = improving rank)
acceleration      = slope(second half) / slope(first half)
tracked_days      = last snapshot − first snapshot
```

Tracking only makes the system *more* certain about what it already observes —
confidence terms for tracking duration and velocity reliability grow with
`log2(1 + tracked_days)` and `min(1, span/30)` respectively. The system never
back-fills or interpolates history it did not record.

## 6. Confidence engine

```
confidence = 100 · Σ weightᵢ·scoreᵢ  (capped at 97% — no false certainty)

signal_count     w=0.20  min(1, independent_signals/6)
tracking         w=0.26  min(1, log2(1+tracked_days)/6)      → 1.0 at 63 days
freshness        w=0.14  exp(−age_hours/96) of newest observation
consistency      w=0.24  (1 − model_disagreement) · min(1, models/2)
data_quality     w=0.16  fraction of key fields readable on the page
```

Levels: `<40` LOW · `40–69` MEDIUM · `≥70` HIGH. Every result ships with the
human-readable `reasons` (✓…) and `limitations` (⚠…) that produced it.

## 7. Demand score (0–100)

| Component | Weight | Formula |
|---|---|---|
| review_velocity | 0.30 | `100·v/(v+0.5 reviews/day)` — saturating |
| review_count_static | 0.18 | `100·log10(reviews+1)/3` — *only* as fallback when no velocity yet, flagged as weaker |
| search_position | 0.20 | `100·(61−pos)/60` clamped |
| badges | 0.18 | Bestseller 100 / Popular now 75 / Star Seller 55 |
| rating | 0.12 | `100·clamp((rating−4.0)/1.0)` |
| favorites | 0.10 | `100·f/(f+50)` (only when Etsy shows them) |
| visibility | 0.10 | appearances / SERP snapshots |

Missing components drop out and weights renormalize. At least two components
including a *core* one (velocity/reviews/position) are required — otherwise
`"Insufficient public data"`.

**Trend**: `rising` if acceleration > 1.15 or rank improving faster than
0.05 positions/day; `falling` if acceleration < 0.75 or rank worsening;
conflicting indicators → `flat` with an explicit "mixed signals" note.
Trend score: rising ≈ 60–100, flat 50, falling ≈ 0–40.

## 8. Competition score (0–100, SERP cohort)

| Component | Weight | Formula |
|---|---|---|
| results_density | 0.22 | `100·min(1, log10(total_results+1)/3)` |
| median_reviews | 0.24 | `100·min(1, log10(median+1)/3)` |
| established_share | 0.22 | share of peers with ≥ 500 reviews |
| ad_density | 0.14 | ad share of visible slots, /0.5 capped |
| price_pressure | 0.18 | `100·min(1, CV(prices)/0.6)` |

Interpretation: `<35` LOW · `35–64` MEDIUM · `≥65` HIGH.
No peers observed in the same session → score unavailable (honest).

## 9. Opportunity score (0–100)

```
opportunity = 0.40·demand + 0.30·(100 − competition) + 0.15·trend + 0.15·commercial
```

Missing pillars drop out (weights renormalize); at least two pillars, one of
them demand/competition, are required — otherwise `"Insufficient evidence"`.

**Commercial attractiveness** (documented heuristic): base 40 (price observed);
+30 price inside cohort P25–P75 (+15 undercut, +20 premium); +20 rating ≥ 4.7
(+10 at ≥ 4.4); +10 active discount.

## 10. What we refuse to do

* ❌ fixed `reviews × N` multipliers
* ❌ random/jittered numbers anywhere in the pipeline
* ❌ exact Etsy search-volume claims (we have no legitimate source)
* ❌ exact conversion-rate claims
* ❌ fabricated history, products, or "demo data" shipped in the product
* ❌ bypassing Etsy auth, CAPTCHAs, anti-bot or rate limits

Everything the extension reads is already rendered on the page the user is
viewing; ingestion happens only through the user's own browser session.
