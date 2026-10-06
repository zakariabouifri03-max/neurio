-- Etsy Signal — PostgreSQL schema
-- Historical observations of publicly-visible Etsy listing data.
--
-- Data minimization: we store only listing-level public metrics the user's
-- own browser already rendered. No buyer data, no personal data, no auth.

CREATE TABLE IF NOT EXISTS listings (
    listing_id      TEXT PRIMARY KEY,          -- Etsy listing id (from URL)
    title           TEXT,
    url             TEXT,
    shop_name       TEXT,
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS observations (
    id                 BIGSERIAL PRIMARY KEY,
    listing_id         TEXT NOT NULL REFERENCES listings(listing_id) ON DELETE CASCADE,
    observed_at        TIMESTAMPTZ NOT NULL,
    surface            TEXT NOT NULL CHECK (surface IN ('search_card','listing_page','etsy_api')),
    price              NUMERIC(12,2),
    original_price     NUMERIC(12,2),
    currency           TEXT,
    rating             NUMERIC(3,2),
    review_count       INTEGER,
    shop_review_count  INTEGER,
    shop_sales_count   INTEGER,
    favorites_count    INTEGER,
    badges             TEXT[] DEFAULT '{}',
    search_position    INTEGER,                -- organic rank; NULL for ads/unranked
    is_ad              BOOLEAN NOT NULL DEFAULT FALSE,
    search_query       TEXT,
    serp_result_count  INTEGER,
    fields_found       TEXT[] DEFAULT '{}',    -- extraction diagnostics
    fields_missing     TEXT[] DEFAULT '{}',
    strategy           TEXT,
    UNIQUE (listing_id, observed_at, surface)
);

CREATE INDEX IF NOT EXISTS idx_observations_listing_time ON observations (listing_id, observed_at);
CREATE INDEX IF NOT EXISTS idx_observations_query_time   ON observations (search_query, observed_at);

CREATE TABLE IF NOT EXISTS serp_snapshots (
    id            BIGSERIAL PRIMARY KEY,
    query         TEXT NOT NULL,
    observed_at   TIMESTAMPTZ NOT NULL,
    result_count  INTEGER,
    organic_cards INTEGER,
    ad_cards      INTEGER
);
CREATE INDEX IF NOT EXISTS idx_serp_query_time ON serp_snapshots (query, observed_at);
