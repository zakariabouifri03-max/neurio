/**
 * Test datasets with known properties. Dates are anchored to a fixed `now`
 * so every assertion is deterministic.
 */
import type { HistoricalSnapshot } from "@etsy-signal/shared";
import type { EstimationInput, LatestRealData, SerpInput } from "../src/input.js";

export const NOW = "2026-10-06T12:00:00.000Z";
export const DAY = 86_400_000;

export function iso(msAgo: number): string {
  return new Date(Date.parse(NOW) - msAgo).toISOString();
}

export function daysAgoIso(days: number): string {
  return iso(days * DAY);
}

/** Synthetic snapshots: reviews growing at `ratePerDay` for `days` days. */
export function snapshotsOver(days: number, ratePerDay: number, opts?: { stepDays?: number; positions?: number[] }): HistoricalSnapshot[] {
  const step = opts?.stepDays ?? 7;
  const offsets: number[] = [];
  for (let d = days; d > 0; d -= step) offsets.push(d);
  offsets.push(0); // always end exactly at "now"
  const out: HistoricalSnapshot[] = [];
  let i = 0;
  for (const d of offsets) {
    const elapsed = days - d;
    out.push({
      observedAt: iso(d * DAY),
      reviewCount: Math.round(ratePerDay * elapsed),
      searchPosition: opts?.positions?.[i] ?? undefined,
      price: 19.99,
    });
    i++;
  }
  return out;
}

export function mkInput(overrides: Partial<EstimationInput> & { latest?: Partial<LatestRealData>; serp?: SerpInput } = {}): EstimationInput {
  return {
    listingId: "1001",
    now: NOW,
    latest: {
      price: 19.99,
      currency: "USD",
      rating: 4.8,
      reviewCount: 386,
      ...overrides.latest,
    },
    history: overrides.history ?? [],
    firstObservedAt: overrides.firstObservedAt,
    lastObservedAt: overrides.lastObservedAt,
    serp: overrides.serp,
  };
}
