/**
 * Storage abstraction. Two implementations:
 *   - PostgresStore: production (historical observations in PostgreSQL)
 *   - MemoryStore:   tests + zero-dependency demo mode
 */
import type { ListingObservation } from "@etsy-signal/shared";

export interface StoredObservation extends ListingObservation {
  fieldsFound?: string[];
  fieldsMissing?: string[];
  strategy?: string;
}

export interface ListingMeta {
  listingId: string;
  title?: string;
  url?: string;
  shopName?: string;
  firstSeenAt: string;
  lastSeenAt: string;
  observationCount: number;
}

export interface SignalStore {
  ingest(obs: StoredObservation): Promise<void>;
  getListing(listingId: string): Promise<ListingMeta | null>;
  listListings(limit?: number): Promise<ListingMeta[]>;
  /** Ascending by time. */
  getObservations(listingId: string): Promise<StoredObservation[]>;
  /**
   * Other listings observed on the same search query as `listingId`'s latest
   * SERP appearance, within the same snapshot window (± 1 hour).
   */
  getSerpPeers(listingId: string): Promise<{ position?: number; query?: string; resultCount?: number; peers: StoredObservation[] }>;
  /** How many SERP snapshots for that query contained this listing / total snapshots. */
  getVisibility(listingId: string): Promise<{ appearances: number; snapshots: number }>;
  close(): Promise<void>;
}

export function latestMerge(obs: StoredObservation[]): StoredObservation {
  const merged: Partial<StoredObservation> = { listingId: "", observedAt: "" };
  const sorted = [...obs].sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  for (const o of sorted) {
    merged.listingId = o.listingId;
    merged.observedAt = o.observedAt;
    for (const key of [
      "url", "title", "shopName", "price", "originalPrice", "currency", "rating",
      "reviewCount", "shopReviewCount", "shopSalesCount", "favoritesCount",
      "badges", "searchPosition", "searchQuery", "isAd", "serpResultCount", "surface",
    ] as const) {
      const v = o[key];
      if (v !== undefined && v !== null) (merged as unknown as Record<string, unknown>)[key] = v;
    }
  }
  return merged as StoredObservation;
}
