/**
 * Assembly: stored observations -> EstimationInput for the (pure) engine.
 * Used by the backend AND by the extension's local mode — same code path,
 * so a number computed in-browser is identical to one computed server-side.
 * Only real stored data; never invents values.
 */
import type { SerpPeer, EstimationInput } from "./input.js";
import { snapshotFromObservation } from "./input.js";
import type { SignalStore, StoredObservation } from "@etsy-signal/shared";
import { latestMerge } from "@etsy-signal/shared";

export interface AssembleResult {
  input: EstimationInput;
  observationCount: number;
}

export async function assembleEstimationInput(
  store: SignalStore,
  listingId: string,
  now: string,
): Promise<AssembleResult | null> {
  const observations: StoredObservation[] = await store.getObservations(listingId);
  if (observations.length === 0) return null;

  const merged = latestMerge(observations);
  const serpInfo = await store.getSerpPeers(listingId);
  const visibility = await store.getVisibility(listingId);

  const peers: SerpPeer[] = serpInfo.peers.map((p) => ({
    listingId: p.listingId,
    reviewCount: p.reviewCount,
    price: p.price,
    rating: p.rating,
    isAd: p.isAd,
    badges: p.badges,
  }));

  const input: EstimationInput = {
    listingId,
    now,
    latest: {
      title: merged.title,
      url: merged.url,
      shopName: merged.shopName,
      price: merged.price,
      originalPrice: merged.originalPrice,
      currency: merged.currency,
      rating: merged.rating,
      reviewCount: merged.reviewCount,
      shopReviewCount: merged.shopReviewCount,
      shopSalesCount: merged.shopSalesCount,
      favoritesCount: merged.favoritesCount,
      badges: merged.badges,
    },
    history: observations.map(snapshotFromObservation),
    firstObservedAt: observations[0]!.observedAt,
    lastObservedAt: observations[observations.length - 1]!.observedAt,
    serp: {
      query: serpInfo.query,
      position: serpInfo.position,
      visibleResultCount: serpInfo.resultCount ?? undefined,
      peers,
      appearances: visibility.appearances,
      snapshots: visibility.snapshots,
    },
  };
  return { input, observationCount: observations.length };
}
