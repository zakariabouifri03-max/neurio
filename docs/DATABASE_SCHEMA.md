# Etsy Signal — Database Schema (PostgreSQL)

Canonical DDL: [`database/schema.sql`](../database/schema.sql).
Apply with `DATABASE_URL=… npm run db:init -w backend`, or boot with
`DATABASE_AUTO_MIGRATE=1`.

## `listings`

| column | type | notes |
|---|---|---|
| `listing_id` | `TEXT` PK | Etsy listing id from the public URL |
| `title` | `TEXT` | last observed title |
| `url` | `TEXT` | canonical listing URL |
| `shop_name` | `TEXT` | last observed shop name |
| `first_seen_at` | `TIMESTAMPTZ` | extension's first observation |
| `last_seen_at` | `TIMESTAMPTZ` | newest observation |

## `observations`

One row per timestamped snapshot of public metrics.

| column | type | notes |
|---|---|---|
| `id` | `BIGSERIAL` PK | |
| `listing_id` | `TEXT` FK → listings | cascades on delete |
| `observed_at` | `TIMESTAMPTZ` | when the user's browser saw it |
| `surface` | `TEXT` | `search_card` / `listing_page` / `etsy_api` |
| `price`, `original_price` | `NUMERIC(12,2)` | NULL when not displayed |
| `currency` | `TEXT` | as displayed |
| `rating` | `NUMERIC(3,2)` | 0–5 |
| `review_count`, `shop_review_count`, `shop_sales_count`, `favorites_count` | `INTEGER` | NULL = not shown |
| `badges` | `TEXT[]` | e.g. `Bestseller`, `Popular now` |
| `search_position` | `INTEGER` | organic rank; NULL for ads |
| `is_ad` | `BOOLEAN` | "Ad by Etsy" slot |
| `search_query` | `TEXT` | query of the SERP it appeared on |
| `serp_result_count` | `INTEGER` | total results shown for the query |
| `fields_found`, `fields_missing` | `TEXT[]` | extraction diagnostics (layout-change detection) |
| `strategy` | `TEXT` | which selector strategy matched |

Uniqueness: `(listing_id, observed_at, surface)`.
Indexes: `(listing_id, observed_at)`, `(search_query, observed_at)`.

## `serp_snapshots`

| column | type | notes |
|---|---|---|
| `id` | `BIGSERIAL` PK | |
| `query` | `TEXT` | search query |
| `observed_at` | `TIMESTAMPTZ` | |
| `result_count` | `INTEGER` | results displayed for the query |
| `organic_cards`, `ad_cards` | `INTEGER` | card counts on the page |

## Data minimization

Only listing-level public metrics the user's own browser rendered are stored.
No buyer data, no personal data, no credentials, no cookies.
