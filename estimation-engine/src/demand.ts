/**
 * DEMAND SCORE (0–100) + TREND.
 *
 * Built only from observable signals. Missing components are excluded and the
 * remaining weights renormalized; if too little remains, the score is not
 * emitted at all ("Insufficient public data").
 *
 * Component formulas (each saturating so no single signal can dominate):
 *   review_velocity : 100 · v / (v + 0.5 reviews/day)   [documented baseline]
 *   search_position : 100 · (61 − pos) / 60             [top-of-grid ≈ high]
 *   badges          : Bestseller 100 / Popular now 75 / Star Seller 55
 *   rating          : 100 · clamp((rating − 4.0) / 1.0)
 *   favorites       : 100 · f / (f + 50)                [only when shown]
 *   visibility      : appearance share across SERP snapshots
 */
import { clamp, median } from "@etsy-signal/shared";
import type { Score, ScoreComponent, TrendDirection } from "@etsy-signal/shared";
import { positionVelocity, reviewVelocity, velocityAcceleration } from "./history.js";
import type { EstimationInput } from "./input.js";

export function scoreTrend(input: EstimationInput): Score {
  const accel = velocityAcceleration(input.history);
  const posVel = positionVelocity(input.history);
  const reasons: string[] = [];
  const limitations: string[] = [];

  let trend: TrendDirection = "unknown";
  let value: number | null = null;

  const posSlope = posVel && posVel.spanDays >= 3 ? posVel.slopePerDay : null;
  if (posSlope != null) {
    if (posSlope < -0.05) reasons.push(`✓ ranking improving ${Math.abs(posSlope).toFixed(2)} positions/day`);
    else if (posSlope > 0.05) reasons.push(`⚠ ranking slipping ${posSlope.toFixed(2)} positions/day`);
  } else {
    limitations.push("Not enough ranking observations for a movement trend.");
  }
  if (accel != null) {
    if (accel > 1.15) reasons.push(`✓ review velocity accelerating ×${accel.toFixed(2)}`);
    else if (accel < 0.85) reasons.push(`⚠ review velocity decelerating ×${accel.toFixed(2)}`);
  }

  if (accel != null || posSlope != null) {
    const rising = (accel != null && accel > 1.15) || (posSlope != null && posSlope < -0.05);
    // Wider deceleration band: review velocity is noisy, so only a clear
    // slowdown (or worsening rank) counts as "falling".
    const falling = (accel != null && accel < 0.75) || (posSlope != null && posSlope > 0.05);
    trend = rising && !falling ? "rising" : falling && !rising ? "falling" : "flat";
    if (rising && falling) reasons.push("⚠ mixed signals: some indicators improve while others weaken");
    value = trend === "rising" ? Math.round(clamp(60 + (accel ? 25 * Math.log2(Math.max(1, accel)) : 15), 0, 100))
      : trend === "falling" ? Math.round(clamp(40 - (accel ? 25 * Math.log2(Math.max(1, 1 / accel)) : 10), 0, 100))
      : 50;
  } else {
    limitations.push("Trend requires repeated observations over several days.");
  }

  return {
    metric: "trend",
    available: value != null,
    value,
    trend,
    components: [],
    reasons,
    limitations,
  };
}

export function scoreDemand(input: EstimationInput): Score {
  const { latest, serp } = input;
  const components: ScoreComponent[] = [];
  const reasons: string[] = [];
  const limitations: string[] = [];

  const vel = reviewVelocity(input.history);
  if (vel && vel.spanDays >= 3) {
    const v = vel.slopePerDay;
    components.push({
      name: "review_velocity",
      value: Math.round((100 * v) / (v + 0.5)),
      weight: 0.3,
      note: `${v.toFixed(2)} reviews/day over ${Math.round(vel.spanDays)} days`,
    });
    if (v >= 0.5) reasons.push("✓ strong review velocity");
  } else if (latest.reviewCount != null && latest.reviewCount > 0 && input.history.length < 2) {
    // Static fallback: a large lifetime review count is itself demand evidence,
    // but weaker than measured velocity — flag it as such.
    const rc = latest.reviewCount;
    components.push({
      name: "review_count_static",
      value: Math.round(100 * Math.log10(rc + 1) / 3),
      weight: 0.18,
      note: `${rc} lifetime reviews (no velocity yet — start tracking)`,
    });
    limitations.push("No tracked velocity yet; using static review count as a weaker demand proxy.");
  } else {
    limitations.push("Review velocity unavailable — needs at least two snapshots days apart.");
  }

  if (serp && serp.position != null) {
    const pos = serp.position;
    components.push({
      name: "search_position",
      value: Math.round(100 * clamp((61 - pos) / 60, 0, 1)),
      weight: 0.2,
      note: `organic position #${pos} on “${serp.query ?? "query"}”`,
    });
    if (pos <= 16) reasons.push("✓ high search visibility (top of grid)");
  }

  const badges = (latest.badges ?? []).map((b) => b.toLowerCase());
  if (badges.some((b) => b.includes("bestseller"))) {
    components.push({ name: "badges", value: 100, weight: 0.18, note: "Bestseller badge" });
    reasons.push("✓ Etsy Bestseller badge");
  } else if (badges.some((b) => b.includes("popular now"))) {
    components.push({ name: "badges", value: 75, weight: 0.18, note: "“Popular now” badge" });
  } else if (badges.some((b) => b.includes("star seller"))) {
    components.push({ name: "badges", value: 55, weight: 0.12, note: "Star Seller shop" });
  }

  if (latest.rating != null) {
    components.push({
      name: "rating",
      value: Math.round(100 * clamp((latest.rating - 4.0) / 1.0, 0, 1)),
      weight: 0.12,
      note: `${latest.rating.toFixed(1)}★`,
    });
  } else {
    limitations.push("No rating displayed on the listing.");
  }

  if (latest.favoritesCount != null && latest.favoritesCount > 0) {
    const f = latest.favoritesCount;
    components.push({ name: "favorites", value: Math.round((100 * f) / (f + 50)), weight: 0.1, note: `${f} favorites` });
  }

  if (serp && serp.appearances != null && serp.snapshots != null && serp.snapshots > 0) {
    components.push({
      name: "visibility",
      value: Math.round(100 * clamp(serp.appearances / serp.snapshots, 0, 1)),
      weight: 0.1,
      note: `appeared in ${serp.appearances}/${serp.snapshots} tracked SERP snapshots`,
    });
  }

  const usable = components.filter((c) => c.value != null);
  const hasCore = usable.some((c) => c.name.startsWith("review_") || c.name === "search_position");
  if (usable.length < 2 || !hasCore) {
    return {
      metric: "demand",
      available: false,
      value: null,
      components,
      reasons,
      limitations: [...limitations, "Insufficient public data for a demand score."],
    };
  }

  const wSum = usable.reduce((a, c) => a + c.weight, 0);
  const value = Math.round(usable.reduce((a, c) => a + (c.value as number) * c.weight, 0) / wSum);

  return { metric: "demand", available: true, value, components, reasons, limitations };
}
