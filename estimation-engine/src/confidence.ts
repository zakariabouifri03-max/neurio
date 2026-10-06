/**
 * CONFIDENCE ENGINE.
 *
 * A separate, transparent model that grades how much we trust the current
 * analysis. Components (each 0..1, weighted):
 *
 *   signalCount    — how many independent real signals are present
 *   tracking       — how long the extension has observed this listing
 *   freshness      — how recent the newest observation is
 *   consistency    — how much the sales models agree with each other
 *   dataQuality    — fraction of key public fields actually readable
 *
 * The result always ships with human-readable reasons and limitations, and
 * never pretends to be higher than the evidence supports.
 */
import { clamp } from "@etsy-signal/shared";
import { PRIORS } from "./assumptions.js";
import { reviewVelocity, trackedDays } from "./history.js";
import type { EstimationInput } from "./input.js";

export interface ConfidenceResult {
  pct: number;
  level: "LOW" | "MEDIUM" | "HIGH";
  reasons: string[];
  limitations: string[];
  components: { name: string; score: number; weight: number; note: string }[];
}

const WEIGHTS = {
  signalCount: 0.2,
  tracking: 0.26,
  freshness: 0.14,
  consistency: 0.24,
  dataQuality: 0.16,
} as const;

export function computeConfidence(input: EstimationInput, modelDisagreement: number): ConfidenceResult {
  const { latest } = input;
  const now = Date.parse(input.now);
  const reasons: string[] = [];
  const limitations: string[] = [];

  // 1) independent signals present
  let sigCount = 0;
  if (latest.reviewCount != null) sigCount++;
  if (latest.shopSalesCount != null && latest.shopReviewCount != null) sigCount++;
  if (latest.favoritesCount != null) sigCount++;
  if (latest.listedOnDate) sigCount++;
  if (latest.badges && latest.badges.length > 0) sigCount++;
  if (input.serp && input.serp.position != null) sigCount++;
  const vel = reviewVelocity(input.history);
  if (vel && vel.spanDays >= 3) sigCount++;
  const signalScore = clamp(sigCount / 6, 0, 1);

  // 2) tracking duration (log2 scale; ~1.0 at 63 days)
  const tDays = trackedDays(input.history);
  const trackingScore = clamp(Math.log2(1 + tDays) / 6, 0, 1);
  if (tDays >= 7) reasons.push(`✓ ${Math.round(tDays)} days of historical tracking`);
  else limitations.push("Historical tracking just started — confidence grows as observations accumulate.");

  // 3) freshness of newest observation
  let freshnessScore = 0;
  const lastObs = input.lastObservedAt ? Date.parse(input.lastObservedAt) : NaN;
  if (Number.isFinite(lastObs)) {
    const ageHours = Math.max(0, now - lastObs) / 3_600_000;
    freshnessScore = Math.exp(-ageHours / 96);
    if (ageHours <= 24) reasons.push("✓ fresh data (observed within the last day)");
  }
  if (freshnessScore < 0.3 && tDays > 0) limitations.push("Newest observation is stale — revisit the listing to refresh.");

  // 4) consistency between models
  const consistencyScore = clamp(1 - modelDisagreement, 0, 1);
  if (modelDisagreement < 0.25 && sigCount >= 2) reasons.push("✓ independent signals agree with each other");
  if (modelDisagreement > 0.45) limitations.push("Signals conflict with each other — interval widened, confidence reduced.");

  // 5) data quality: fraction of key fields readable
  const keys = [latest.price != null, latest.reviewCount != null, latest.rating != null, input.serp?.position != null];
  const dataQuality = keys.filter(Boolean).length / keys.length;
  if (dataQuality >= 0.75) reasons.push("✓ most key public fields readable on the page");
  if (dataQuality <= 0.5) limitations.push("Several key fields were missing on the page (layout may have changed).");

  if (vel && vel.spanDays >= 3 && vel.r2 > 0.7) reasons.push("✓ strong review velocity data");
  if (input.history.filter((h) => h.searchPosition != null).length >= 5) reasons.push("✓ consistent ranking observations");
  if (sigCount >= 4) reasons.push("✓ multiple independent signals");

  const components = [
    { name: "signal_count", score: signalScore, weight: WEIGHTS.signalCount, note: `${sigCount} independent signals` },
    { name: "tracking_duration", score: trackingScore, weight: WEIGHTS.tracking, note: `${Math.round(tDays)} days tracked` },
    { name: "freshness", score: freshnessScore, weight: WEIGHTS.freshness, note: "age of newest observation" },
    { name: "consistency", score: consistencyScore, weight: WEIGHTS.consistency, note: `${Math.round((1 - modelDisagreement) * 100)}% model agreement` },
    { name: "data_quality", score: dataQuality, weight: WEIGHTS.dataQuality, note: "fraction of key fields readable" },
  ];

  const pct = Math.round(100 * clamp(components.reduce((a, c) => a + c.score * c.weight, 0), 0, 0.97));
  const level = pct < PRIORS.confidence.lowMax ? "LOW" : pct >= PRIORS.confidence.highMin ? "HIGH" : "MEDIUM";

  if (level === "LOW") {
    limitations.push("Confidence is LOW — treat every number on this card as a rough indication only.");
  } else if (tDays >= 7) {
    reasons.push("✓ confidence improved because historical observations are available");
  }

  return { pct, level, reasons, limitations, components };
}
