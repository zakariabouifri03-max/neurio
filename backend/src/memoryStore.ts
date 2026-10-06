import type { ListingMeta, SignalStore, StoredObservation } from "./store.js";

/**
 * In-memory store: used by the test suite and by `STORAGE=memory` demo mode.
 * Behaves identically to PostgresStore (same dedupe/merge semantics).
 */
export class MemoryStore implements SignalStore {
  private observations: StoredObservation[] = [];

  async ingest(obs: StoredObservation): Promise<void> {
    // Dedupe: same listing + same minute + same surface with identical
    // review count & price is a duplicate scroll/pagination capture.
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
