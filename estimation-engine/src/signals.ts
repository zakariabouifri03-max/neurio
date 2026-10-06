/**
 * Normalized Signal assembly — every signal carries value, unit, period,
 * source, timestamp and a documented reliability weight.
 */
import type { Signal } from "@etsy-signal/shared";
import { PRIORS } from "./assumptions.js";
import { reviewVelocity } from "./history.js";
import type { EstimationInput } from "./input.js";

export function buildSignals(input: EstimationInput): Signal[] {
  const signals: Signal[] = [];
  const { latest } = input;
  const lastTs = input.lastObservedAt ?? input.now;

  if (latest.reviewCount != null) {
    signals.push({
      signal: "review_count",
      value: latest.reviewCount,
      unit: "reviews",
      period: "lifetime",
      source: "observed_public_data",
      timestamp: lastTs,
      reliability: 0.95,
    });
  }

  const vel = reviewVelocity(input.history);
  if (vel && vel.spanDays >= 3) {
    signals.push({
      signal: "review_velocity",
      value: Number(vel.slopePerDay.toFixed(4)),
      unit: "reviews/day",
      period: `${Math.round(vel.spanDays)}_days`,
      source: "extension_history",
      timestamp: lastTs,
      reliability: Number((0.5 + 0.2 * Math.min(1, vel.spanDays / 30) + 0.2 * vel.r2).toFixed(2)),
    });
  }

  if (latest.listedOnDate) {
    const age = (Date.parse(input.now) - Date.parse(latest.listedOnDate)) / 86_400_000;
    if (Number.isFinite(age) && age >= 0) {
      signals.push({
        signal: "listing_age_days",
        value: Math.round(age),
        unit: "days",
        period: "lifetime",
        source: "observed_public_data",
        timestamp: lastTs,
        reliability: 0.95,
      });
    }
  }

  if (latest.shopSalesCount != null && latest.shopReviewCount != null && latest.shopSalesCount > 0) {
    signals.push({
      signal: "shop_review_velocity",
      value: Number((latest.shopReviewCount / latest.shopSalesCount).toFixed(4)),
      unit: "reviews/sale (shop-wide public ratio)",
      period: "lifetime",
      source: "observed_public_data",
      timestamp: lastTs,
      reliability: 0.85,
    });
  }

  if (input.serp?.position != null) {
    signals.push({
      signal: "search_position",
      value: input.serp.position,
      unit: "organic_rank",
      period: "latest_serp",
      source: "observed_public_data",
      timestamp: lastTs,
      reliability: 0.8,
    });
  }

  if (latest.favoritesCount != null) {
    signals.push({
      signal: "favorites_count",
      value: latest.favoritesCount,
      unit: "favorites",
      period: "lifetime",
      source: "observed_public_data",
      timestamp: lastTs,
      reliability: 0.7,
    });
  }

  if (latest.price != null) {
    signals.push({
      signal: "price",
      value: latest.price,
      unit: latest.currency ?? "USD",
      period: "latest",
      source: "observed_public_data",
      timestamp: lastTs,
      reliability: 0.95,
    });
    if (latest.originalPrice != null && latest.originalPrice > latest.price) {
      signals.push({
        signal: "price_discount",
        value: Number((1 - latest.price / latest.originalPrice).toFixed(3)),
        unit: "fraction_off",
        period: "latest",
        source: "observed_public_data",
        timestamp: lastTs,
        reliability: 0.9,
      });
    }
  }

  for (const badge of latest.badges ?? []) {
    signals.push({
      signal: "badge",
      value: badge.toLowerCase().includes("bestseller") ? 3 : badge.toLowerCase().includes("popular") ? 2 : 1,
      unit: `badge:${badge}`,
      period: "latest",
      source: "observed_public_data",
      timestamp: lastTs,
      reliability: 0.75,
    });
  }

  if (input.serp && input.serp.peers.length > 0) {
    signals.push({
      signal: "category_competition",
      value: input.serp.peers.length,
      unit: "competing listings observed",
      period: "latest_serp",
      source: "observed_public_data",
      timestamp: lastTs,
      reliability: 0.8,
    });
  }
  if (input.serp?.visibleResultCount != null) {
    signals.push({
      signal: "serp_density",
      value: input.serp.visibleResultCount,
      unit: "results",
      period: "latest_serp",
      source: "observed_public_data",
      timestamp: lastTs,
      reliability: 0.8,
    });
  }

  return signals;
}

/** Freshness half-life decay used by confidence/weighting elsewhere. */
export function freshnessWeight(observedAtIso: string, nowIso: string): number {
  const days = (Date.parse(nowIso) - Date.parse(observedAtIso)) / 86_400_000;
  if (!Number.isFinite(days) || days < 0) return 0;
  return Math.pow(0.5, days / PRIORS.freshnessHalfLifeDays);
}
