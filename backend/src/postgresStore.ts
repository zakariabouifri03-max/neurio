import pg from "pg";
import type { ListingMeta, SignalStore, StoredObservation } from "./store.js";

/**
 * Production store backed by PostgreSQL.
 * Connection via DATABASE_URL. Schema applied from database/schema.sql
 * through src/db/init.ts (or DATABASE_AUTO_MIGRATE=1 at boot).
 */
export class PostgresStore implements SignalStore {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({ connectionString, max: 5 });
  }

  async ingest(obs: StoredObservation): Promise<void> {
    await this.pool.query(
      `INSERT INTO listings (listing_id, title, url, shop_name, first_seen_at, last_seen_at)
       VALUES ($1,$2,$3,$4,$5,$5)
       ON CONFLICT (listing_id) DO UPDATE SET
         title = COALESCE(EXCLUDED.title, listings.title),
         url = COALESCE(EXCLUDED.url, listings.url),
         shop_name = COALESCE(EXCLUDED.shop_name, listings.shop_name),
         last_seen_at = EXCLUDED.last_seen_at`,
      [obs.listingId, obs.title ?? null, obs.url ?? null, obs.shopName ?? null, obs.observedAt],
    );
    await this.pool.query(
      `INSERT INTO observations (listing_id, observed_at, surface, price, original_price, currency, rating,
        review_count, shop_review_count, shop_sales_count, favorites_count, badges,
        search_position, is_ad, search_query, serp_result_count, fields_found, fields_missing, strategy)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (listing_id, observed_at, surface) DO NOTHING`,
      [
        obs.listingId, obs.observedAt, obs.surface, obs.price ?? null, obs.originalPrice ?? null,
        obs.currency ?? null, obs.rating ?? null, obs.reviewCount ?? null, obs.shopReviewCount ?? null,
        obs.shopSalesCount ?? null, obs.favoritesCount ?? null, obs.badges ?? [],
        obs.searchPosition ?? null, obs.isAd ?? false, obs.searchQuery ?? null, obs.serpResultCount ?? null,
        obs.fieldsFound ?? [], obs.fieldsMissing ?? [], obs.strategy ?? null,
      ],
    );
    if (obs.searchQuery) {
      await this.pool.query(
        `INSERT INTO serp_snapshots (query, observed_at, result_count, organic_cards, ad_cards)
         VALUES ($1,$2,$3,1,$4)
         ON CONFLICT DO NOTHING`,
        [obs.searchQuery, obs.observedAt, obs.serpResultCount ?? null, obs.isAd ? 1 : 0],
      );
    }
  }

  async getListing(listingId: string): Promise<ListingMeta | null> {
    const r = await this.pool.query(
      `SELECT l.listing_id, l.title, l.url, l.shop_name, l.first_seen_at, l.last_seen_at,
              (SELECT count(*) FROM observations o WHERE o.listing_id = l.listing_id) AS obs_count
       FROM listings l WHERE l.listing_id = $1`,
      [listingId],
    );
    const row = r.rows[0];
    if (!row) return null;
    return {
      listingId: row.listing_id,
      title: row.title ?? undefined,
      url: row.url ?? undefined,
      shopName: row.shop_name ?? undefined,
      firstSeenAt: new Date(row.first_seen_at).toISOString(),
      lastSeenAt: new Date(row.last_seen_at).toISOString(),
      observationCount: Number(row.obs_count),
    };
  }

  async listListings(limit = 100): Promise<ListingMeta[]> {
    const r = await this.pool.query(
      `SELECT l.listing_id, l.title, l.url, l.shop_name, l.first_seen_at, l.last_seen_at,
              (SELECT count(*) FROM observations o WHERE o.listing_id = l.listing_id) AS obs_count
       FROM listings l ORDER BY l.last_seen_at DESC LIMIT $1`,
      [limit],
    );
    return r.rows.map((row) => ({
      listingId: row.listing_id,
      title: row.title ?? undefined,
      url: row.url ?? undefined,
      shopName: row.shop_name ?? undefined,
      firstSeenAt: new Date(row.first_seen_at).toISOString(),
      lastSeenAt: new Date(row.last_seen_at).toISOString(),
      observationCount: Number(row.obs_count),
    }));
  }

  async getObservations(listingId: string): Promise<StoredObservation[]> {
    const r = await this.pool.query(
      `SELECT * FROM observations WHERE listing_id = $1 ORDER BY observed_at ASC`,
      [listingId],
    );
    return r.rows.map(rowToObservation);
  }

  async getSerpPeers(listingId: string): Promise<{ position?: number; query?: string; resultCount?: number; peers: StoredObservation[] }> {
    const own = await this.pool.query(
      `SELECT * FROM observations
       WHERE listing_id = $1 AND search_query IS NOT NULL AND search_position IS NOT NULL AND is_ad = FALSE
       ORDER BY observed_at DESC LIMIT 1`,
      [listingId],
    );
    const latest = own.rows[0];
    if (!latest) return { peers: [] };
    const peers = await this.pool.query(
      `SELECT * FROM observations
       WHERE listing_id <> $1 AND search_query = $2 AND is_ad = FALSE
         AND observed_at BETWEEN $3::timestamptz - interval '1 hour' AND $3::timestamptz + interval '1 hour'
       ORDER BY observed_at ASC`,
      [listingId, latest.search_query, latest.observed_at],
    );
    return {
      position: latest.search_position ?? undefined,
      query: latest.search_query ?? undefined,
      resultCount: latest.serp_result_count ?? undefined,
      peers: peers.rows.map(rowToObservation),
    };
  }

  async getVisibility(listingId: string): Promise<{ appearances: number; snapshots: number }> {
    const r = await this.pool.query(
      `WITH own AS (
         SELECT search_query, date_trunc('day', observed_at) AS day
         FROM observations WHERE listing_id = $1 AND search_query IS NOT NULL
         GROUP BY 1,2
       ),
       all_q AS (
         SELECT o.search_query, date_trunc('day', o.observed_at) AS day
         FROM observations o WHERE o.search_query IN (SELECT DISTINCT search_query FROM own)
         GROUP BY 1,2
       )
       SELECT (SELECT count(*) FROM own) AS appearances, (SELECT count(*) FROM all_q) AS snapshots`,
      [listingId],
    );
    return { appearances: Number(r.rows[0]?.appearances ?? 0), snapshots: Number(r.rows[0]?.snapshots ?? 0) };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

function rowToObservation(row: Record<string, unknown>): StoredObservation {
  return {
    listingId: String(row.listing_id),
    observedAt: new Date(row.observed_at as string).toISOString(),
    surface: row.surface as StoredObservation["surface"],
    price: row.price != null ? Number(row.price) : undefined,
    originalPrice: row.original_price != null ? Number(row.original_price) : undefined,
    currency: (row.currency as string) ?? undefined,
    rating: row.rating != null ? Number(row.rating) : undefined,
    reviewCount: row.review_count != null ? Number(row.review_count) : undefined,
    shopReviewCount: row.shop_review_count != null ? Number(row.shop_review_count) : undefined,
    shopSalesCount: row.shop_sales_count != null ? Number(row.shop_sales_count) : undefined,
    favoritesCount: row.favorites_count != null ? Number(row.favorites_count) : undefined,
    badges: (row.badges as string[]) ?? undefined,
    searchPosition: row.search_position != null ? Number(row.search_position) : undefined,
    isAd: Boolean(row.is_ad),
    searchQuery: (row.search_query as string) ?? undefined,
    serpResultCount: row.serp_result_count != null ? Number(row.serp_result_count) : undefined,
    title: undefined,
  };
}
