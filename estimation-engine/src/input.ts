/**
 * Input contract for the estimation engine.
 *
 * The backend's analysis service assembles this object exclusively from
 * stored observations (real, timestamped data). The engine is a pure
 * function of this input + `now`: fully deterministic and reproducible.
 */
import type { HistoricalSnapshot, ListingObservation } from "@etsy-signal/shared";

export interface LatestRealData {
  title?: string;
  url?: string;
  shopName?: string;
  price?: number;
  originalPrice?: number;
  currency?: string;
  rating?: number;
  reviewCount?: number;
  shopReviewCount?: number;
  shopSalesCount?: number;
  favoritesCount?: number;
  badges?: string[];
  /** Date Etsy publicly displays as "Listed on ..." when it does. */
  listedOnDate?: string;
  /** Variation count when the listing publicly exposes variations. */
  variationCount?: number;
  /** Min/max variation prices when publicly exposed. */
  variationPriceMin?: number;
  variationPriceMax?: number;
}

export interface SerpPeer {
  listingId: string;
  reviewCount?: number;
  price?: number;
  rating?: number;
  isAd?: boolean;
  badges?: string[];
}

export interface SerpInput {
  query?: string;
  /** Position of THIS listing on the most recent SERP observation. */
  position?: number;
  /** Total visible result slots on that SERP page. */
  visibleResultCount?: number;
  /** Other listings observed on the same SERP page. */
  peers: SerpPeer[];
  /** How many SERP snapshots included this listing (visibility over time). */
  appearances?: number;
  snapshots?: number;
}

export interface EstimationInput {
  listingId: string;
  /** Deterministic clock injection (ISO). */
  now: string;
  latest: LatestRealData;
  /** All stored snapshots, ascending by time. */
  history: HistoricalSnapshot[];
  firstObservedAt?: string;
  lastObservedAt?: string;
  serp?: SerpInput;
}

export function snapshotFromObservation(o: ListingObservation): HistoricalSnapshot {
  return {
    observedAt: o.observedAt,
    reviewCount: o.reviewCount,
    searchPosition: o.searchPosition,
    price: o.price,
    favoritesCount: o.favoritesCount,
  };
}
