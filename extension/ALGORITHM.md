# Estimation algorithms (transparent by design)

This document is the contract: every number the extension shows as **Estimated**
must be computable from the formulas below, and the UI must link the reasoning
(“How was this estimated?” shows the same steps with live values).

Notation: `V(x)` = verified on-page value, `A` = user assumption from Settings,
`E(x)` = estimate. Ranges are `[low, high]` around a `mid` midpoint.

---

## 1. Monthly sales `E(sales/mo)`

**Inputs (all optional; missing inputs degrade confidence, never fabricate):**
`V(listingReviews)`, `V(recentReviews30d)` (visible review dates or tracked velocity),
`V(listingAgeDays)`, `V(favorites)`, `V(shopSales)`, `V(shopReviews)`,
`A(reviewRate)` default **15%**, `A(sensitivity)` default **Balanced**.

**Step 1 — monthly review velocity:**
- If recent 30-day activity observed: `monthlyReviews = recentReviews30d`
- Else if reviews + age known: `monthlyReviews = listingReviews / max(ageMonths, 0.25)`
- Else if only reviews known: amortise over assumed 12 months (flagged in the trace)
- Else: no review signal → favorites-only fallback (`favorites / 60`, labelled “very rough”) or null

**Step 2 — effective review rate (shop calibration):**
- Start at `A(reviewRate)`.
- If `V(shopSales)` and `V(shopReviews)` both known and implied rate
  `shopReviews / shopSales` is within 2–60%: `rate = (assumed + clamped(implied)) / 2`.
  The trace always states whether calibration applied.

**Step 3 — orders → range:**
- `mid = monthlyReviews / rate` (0 when no reviews observed)
- Sensitivity multipliers: Conservative ×0.55–×1.25 · Balanced ×0.75–×1.6 · Optimistic ×0.9–×2.0
- `low = mid × lowFactor`, `high = mid × highFactor`
- Daily = monthly ÷ 30.44, weekly = monthly ÷ 4.345

**Confidence score (points):** recent velocity +2 (else lifetime +1) · age known +1 ·
shop calibration +1 · ≥3 tracked observations +1 (1–2 → +0.5) · favorites visible +0.5.
≥4 → **High**, ≥2 → **Medium**, else **Low**. Null estimate → Low.

## 2. Revenue `E(revenue)`

- `monthlyRevenue = E(sales range) × V(price)` (low/mid/high each multiplied).
- `yearlyRevenue = monthly × 12` (trace notes the stable-demand assumption).
- Confidence inherits the sales confidence. Currency: the listing’s own when known.

## 3. Views `E(views)`

- If Etsy publishes an exact view count on the page (rare): shown as **verified**, confidence High.
- Else: `monthlyViews = E(monthlyOrders) ÷ A(conversionRate)` (default 2%).
- Uplifts: Bestseller badge ×1.15, “popular” signals ×1.08 (each disclosed in the trace).
- Fallback without order signal: `favorites × A(viewsPerFavorite)` (default 25), wide ×0.5–×2.0 range.
- Confidence: order estimate +2 · favorites +0.5 · ≥3 observations +1 → ≥3.5 High, ≥2 Medium.

## 4. Shop roll-up `E(shop sales/mo)`

- Sum listing-level `E(sales)` midpoints (and lows/highs) across **visible** listings.
- Revenue = summed sales × average visible price.
- Per-listing = totals ÷ analysed count. Trace states coverage (“12 of 86 listings
  visible — true sales likely higher”). Confidence Medium only at ≥80% coverage and
  ≥10 listings, else Low.

## 5. Scores (0–100)

**Demand** = review volume 35 (log₁₀ vs 2,000) + rating 15 (3.5★→0, 5★→15) +
favorites 15 (log vs 5,000) + momentum 20 (recent reviews vs 60, or est. orders vs 120) +
badges 10 (Bestseller +7, Popular +3) + tracked growth ±5.

**Competition** (higher = tougher) = search saturation 40 (log vs 50k results) +
entrenched rivals 30 (avg competitor reviews, log vs 1,000) + price pressure 20
(value 4 / mid 10 / above-market 16) + category depth 10 (log vs 500 listings).

**Revenue potential** = est. monthly revenue 70 (log vs $20k) + price point 30 (log vs $200).

**Opportunity** = `0.45 × Demand + 0.25 × (100 − Competition) + 0.30 × Revenue`,
rounded to an integer. Labels: ≥75 Excellent · ≥60 Good · ≥45 Moderate · ≥30 Weak · else Poor.

Each score panel shows its formula and per-component points; hover tooltips in the
on-page panel repeat them.

## 6. Keywords

- Phrases (1–3 words) from visible listing titles, stop-word filtered.
- `frequency` = listings using the term; `share` = frequency ÷ visible listings.
- `competition` = share × 100. `demand` = review gravity (log) + usage.
- `opportunity` = the same 45/25/30 blend. **No search-volume numbers are invented** —
  the UI explicitly says frequency comes from visible titles only.

## 7. Trends

From local observations only: first-vs-last deltas per 7/30/90-day window,
`↑ Increasing` / `→ Stable` / `↓ Decreasing` at ±5% review change. Sparse windows
say so instead of interpolating.
