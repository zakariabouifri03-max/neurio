/**
 * Estimation engine entry point: produces a complete, fully-labelled
 * Analysis bundle from stored observations. Pure and deterministic.
 */
import type { Analysis } from "@etsy-signal/shared";
import { computeConfidence } from "./confidence.js";
import { scoreDemand, scoreTrend } from "./demand.js";
import { scoreCompetition } from "./competition.js";
import { scoreOpportunity } from "./opportunity.js";
import { estimateLifetimeSales, estimateMonthlySales, buildSalesContext } from "./sales.js";
import { estimateMonthlyRevenue } from "./revenue.js";
import { buildSignals } from "./signals.js";
import { trackedDays } from "./history.js";
import type { EstimationInput } from "./input.js";
import { median } from "@etsy-signal/shared";

export * from "./assumptions.js";
export * from "./distributions.js";
export * from "./history.js";
export * from "./input.js";
export * from "./sales.js";
export * from "./revenue.js";
export * from "./confidence.js";
export * from "./demand.js";
export * from "./competition.js";
export * from "./opportunity.js";
export * from "./signals.js";
export * from "./assemble.js";

export function analyze(input: EstimationInput): Analysis {
  const sales = estimateLifetimeSales(input);
  const monthlySales = estimateMonthlySales(input);
  const monthlyRevenue = estimateMonthlyRevenue(input, monthlySales);

  // Model disagreement across every contributing model (feeds confidence).
  const medians = [
    ...sales.modelBreakdown.map((b) => b.modelMedian),
    ...monthlySales.modelBreakdown.map((b) => b.modelMedian),
  ].filter((m): m is number => m != null && m > 0);
  const logs = medians.map((m) => Math.log(m));
  let disagreement = 0;
  if (logs.length >= 2) {
    const mu = logs.reduce((a, b) => a + b, 0) / logs.length;
    const variance = logs.reduce((a, l) => a + (l - mu) ** 2, 0) / logs.length;
    disagreement = Math.min(1, variance / 2.5);
  }

  const confidence = computeConfidence(input, disagreement);
  const demand = scoreDemand(input);
  const competition = scoreCompetition(input);
  const trend = scoreTrend(input);
  const opportunity = scoreOpportunity(input, demand, competition, trend);

  // Stamp the global confidence into the primary estimates where available.
  const stamp = (e: typeof sales): typeof sales =>
    e.available ? { ...e, confidencePct: Math.round((e.confidencePct + confidence.pct) / 2), confidenceLevel: blended(e.confidencePct, confidence.pct) } : e;

  const tDays = trackedDays(input.history);
  const historyPositions = input.history.map((h) => h.searchPosition).filter((p): p is number => p != null);

  return {
    listingId: input.listingId,
    generatedAt: input.now,
    real: {
      title: input.latest.title,
      url: input.latest.url,
      shopName: input.latest.shopName,
      price: input.latest.price,
      currency: input.latest.currency,
      rating: input.latest.rating,
      reviewCount: input.latest.reviewCount,
      shopReviewCount: input.latest.shopReviewCount,
      shopSalesCount: input.latest.shopSalesCount,
      badges: input.latest.badges,
      bestSearchPosition: historyPositions.length ? Math.min(...historyPositions) : undefined,
      firstSeenAt: input.firstObservedAt,
      lastSeenAt: input.lastObservedAt,
      observationCount: input.history.length,
      trackedDays: tDays > 0 ? Math.round(tDays) : undefined,
    },
    estimates: {
      sales: stamp(sales),
      monthlySales: stamp(monthlySales),
      monthlyRevenue: stamp(monthlyRevenue),
    },
    scores: { demand, competition, trend, opportunity },
    signals: buildSignals(input),
  };
}

function blended(a: number, b: number): "LOW" | "MEDIUM" | "HIGH" {
  const v = Math.round((a + b) / 2);
  return v < 40 ? "LOW" : v >= 70 ? "HIGH" : "MEDIUM";
}

export { median };
