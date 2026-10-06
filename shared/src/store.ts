/**
 * Storage abstraction shared by backend AND extension.
 *
 * The extension ships its own in-browser store ("local mode") so the product
 * works out of the box with zero setup; the PostgreSQL backend remains the
 * option for durable / shared history.
 */
import type { ListingObservation } from "./types.js";

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

/**
 * In-memory store: used by the extension (persisted to chrome.storage.local),
 * by the test suite, and by the backend's zero-dependency demo mode.
 * Behaves identically to PostgresStore (same dedupe/merge semantics).
 */
export class MemoryStore implements SignalStore {
  private observations: StoredObservation[] = [];

  /** Hydrate from a previously persisted array (extension local mode). */
  load(initial: StoredObservation[]): void {
    this.observations = [...initial];
  }

  dump(): StoredObservation[] {
    return [...this.observations];
  }

  async ingest(obs: StoredObservation): Promise<void> {
    // Dedupe: same listing + same minute + same surface with identical
    // review count & price & position is a duplicate capture.
    const dup = this.observations.some(
      (o) =>
        o.listingId === obs.listingId &&
        o.surface === obs.surface &&
        Math.abs(Date.parse(o.observedAt) - Date.parse(obs.observedAt)) < 60_000 &&
        o.reviewCount === obs.reviewCount &&
        o.price === obs.price &&
        o.searchPosition === obs.searchPosition,
    );
    if (dup) return;
    this.observations.push({ ...obs });
  }

  async getListing(listingId: string): Promise<ListingMeta | null> {
    const obs = await this.getObservations(listingId);
    if (obs.length === 0) return null;
    const first = obs[0]!;
    const last = obs[obs.length - 1]!;
    return {
      listingId,
      title: last.title ?? first.title,
      url: last.url ?? first.url,
      shopName: last.shopName ?? first.shopName,
      firstSeenAt: first.observedAt,
      lastSeenAt: last.observedAt,
      observationCount: obs.length,
    };
  }

  async listListings(limit = 100): Promise<ListingMeta[]> {
    const ids = [...new Set(this.observations.map((o) => o.listingId))];
    const out: ListingMeta[] = [];
    for (const id of ids) {
      const meta = await this.getListing(id);
      if (meta) out.push(meta);
      if (out.length >= limit) break;
    }
    return out.sort((a, b) => Date.parse(b.lastSeenAt) - Date.parse(a.lastSeenAt));
  }

  async getObservations(listingId: string): Promise<StoredObservation[]> {
    return this.observations
      .filter((o) => o.listingId === listingId)
      .sort((a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt));
  }

  async getSerpPeers(listingId: string): Promise<{ position?: number; query?: string; resultCount?: number; peers: StoredObservation[] }> {
    const own = (await this.getObservations(listingId)).filter((o) => o.searchQuery && o.searchPosition != null && !o.isAd);
    if (own.length === 0) return { peers: [] };
    const latest = own[own.length - 1]!;
    const t = Date.parse(latest.observedAt!);
    const peers = this.observations.filter(
      (o) =>
        o.listingId !== listingId &&
        o.searchQuery === latest.searchQuery &&
        Math.abs(Date.parse(o.observedAt) - t) <= 3_600_000 &&
        !o.isAd,
    );
    return { position: latest.searchPosition, query: latest.searchQuery, resultCount: latest.serpResultCount, peers };
  }

  async getVisibility(listingId: string): Promise<{ appearances: number; snapshots: number }> {
    const own = await this.getObservations(listingId);
    const queries = new Set(own.map((o) => o.searchQuery).filter((q): q is string => !!q));
    let appearances = 0;
    let snapshots = 0;
    for (const q of queries) {
      const qObs = this.observations.filter((o) => o.searchQuery === q);
      const days = new Set(qObs.map((o) => Math.floor(Date.parse(o.observedAt!) / 86_400_000)));
      snapshots += days.size;
      const ownDays = new Set(own.filter((o) => o.searchQuery === q).map((o) => Math.floor(Date.parse(o.observedAt!) / 86_400_000)));
      appearances += ownDays.size;
    }
    return { appearances, snapshots };
  }

  async close(): Promise<void> {
    this.observations = [];
  }
}
