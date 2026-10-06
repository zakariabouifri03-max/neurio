# Etsy Signal — Backend API

Base URL: `http://localhost:8787` (configurable via `PORT`; the extension's
popup → Settings points the extension at your URL).

CORS: `chrome-extension://*` origins are always allowed; additional origins via
`CORS_ORIGINS` (comma-separated, `*` wildcard suffix supported).

All bodies are JSON. Errors: `{ "error": "<message>" }` with the proper HTTP
status code. Validation failures never crash the server; bad observations are
counted and reported.

---

## `GET /health`

Liveness probe.

```json
{ "ok": true, "service": "etsy-signal-backend", "time": "2026-10-06T12:00:00.000Z" }
```

## `POST /v1/observations`

Ingest a batch of observations captured by the extension (max 60 per call).

Request:

```json
{
  "observations": [
    {
      "listingId": "1400000001",
      "observedAt": "2026-10-06T12:00:00.000Z",
      "surface": "search_card",
      "title": "Spooky Season Shirt",
      "url": "https://www.etsy.com/listing/1400000001/spooky-season-shirt",
      "shopName": "GhostlyThreads",
      "price": 19.99,
      "originalPrice": 24.99,
      "currency": "USD",
      "rating": 4.8,
      "reviewCount": 451,
      "shopReviewCount": 610,
      "shopSalesCount": 18200,
      "favoritesCount": 233,
      "badges": ["Bestseller"],
      "searchPosition": 8,
      "isAd": false,
      "searchQuery": "halloween shirt",
      "serpResultCount": 12533
    }
  ]
}
```

Field rules:

* `listingId` — required, numeric string.
* `observedAt` — required, ISO-8601.
* `surface` — required: `search_card` | `listing_page` | `etsy_api`.
* every numeric field must be ≥ 0 when present; missing means missing.

Response:

```json
{ "accepted": 1, "rejected": 0, "reasons": [] }
```

## `GET /v1/listings?limit=N`

Tracked listings, most recently seen first (limit ≤ 200, default 50).

```json
{ "listings": [ { "listingId": "…", "title": "…", "url": "…", "shopName": "…", "firstSeenAt": "…", "lastSeenAt": "…", "observationCount": 4 } ] }
```

## `GET /v1/listings/:id`

Real data only (no estimates): listing meta + every stored observation.
`404` when the listing was never tracked.

## `GET /v1/listings/:id/history`

Time-ordered snapshots for charts/audit:

```json
{ "listingId": "…", "snapshots": [ { "observedAt": "…", "reviewCount": 380, "searchPosition": 24, "price": 19.99, "favoritesCount": null } ] }
```

## `GET /v1/listings/:id/analysis`

The full deterministic analysis (the response type is `Analysis` in
`shared/src/types.ts`):

```jsonc
{
  "listingId": "1400000001",
  "generatedAt": "2026-10-06T12:00:00.000Z",
  "real": {                     // REAL data only
    "price": 19.99, "rating": 4.8, "reviewCount": 451,
    "shopReviewCount": 610, "shopSalesCount": 18200,
    "badges": ["Bestseller"], "bestSearchPosition": 8,
    "firstSeenAt": "…", "lastSeenAt": "…", "observationCount": 4, "trackedDays": 30
  },
  "estimates": {                // ESTIMATES: ranges + confidence + evidence
    "sales":          { "available": true, "quantiles": { "p10": 4583, "p50": 11343, "p90": 28076 }, "confidencePct": 79, "evidence": ["…"], "modelBreakdown": ["…"], "limitations": ["…"] },
    "monthlySales":   { "…": "…" },
    "monthlyRevenue": { "…": "…" }
  },
  "scores": { "demand": { "…": "…" }, "competition": { "…": "…" }, "trend": { "…": "…" }, "opportunity": { "…": "…" } },
  "signals": [ { "signal": "review_velocity", "value": 2.41, "unit": "reviews/day", "period": "30_days", "source": "extension_history", "timestamp": "…", "reliability": 0.9 } ]
}
```

Unavailable metrics come back as `available: false` + `unavailableReason`
(e.g. `"Revenue estimate unavailable — no price was publicly displayed"`).
