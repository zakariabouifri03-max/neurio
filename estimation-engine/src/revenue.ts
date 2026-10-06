/**
 * REVENUE ESTIMATION.
 *
 * estimated revenue = estimated sales × observed price, done in log-space so
 * the uncertainties multiply properly (sum of variances).
 *
 * Price handling rules (no invented numbers):
 *  - No observed price at all            -> "Revenue estimate unavailable".
 *  - Sale price < original price         -> band spans [sale, original].
 *  - Public variation min/max prices     -> band spans the variation range.
 *  - Price fluctuated across snapshots   -> extra uncertainty added.
 */
import { clamp, round } from "@etsy-signal/shared";
import type { Estimate, QuantileSet } from "@etsy-signal/shared";
import { PRIORS } from "./assumptions.js";
import { clampSigma, logNormalQuantiles } from "./distributions.js";
import type { EstimationInput } from "./input.js";

export function estimateMonthlyRevenue(input: EstimationInput, monthlySales: Estimate): Estimate {
  const { latest } = input;
  const price = latest.price;
  const baseLimitations = ["Revenue = estimated sales × observed price. Etsy does not disclose revenue."];

  if (!monthlySales.available || !monthlySales.quantiles) {
    return {
      metric: "monthly_revenue",
      available: false,
      unit: "USD",
      confidencePct: 0,
      confidenceLevel: "LOW",
      evidence: [],
      modelBreakdown: [],
      limitations: baseLimitations,
      unavailableReason: "No monthly sales estimate available — revenue cannot be estimated.",
    };
  }

  if (price == null || !(price > 0)) {
    return {
      metric: "monthly_revenue",
      available: false,
      unit: "USD",
      confidencePct: 0,
      confidenceLevel: "LOW",
      evidence: monthlySales.evidence,
      modelBreakdown: monthlySales.modelBreakdown,
      limitations: baseLimitations,
      unavailableReason: "Revenue estimate unavailable — no price was publicly displayed for this listing.",
    };
  }

  // Build the effective price distribution from observed price information.
  let lo = price;
  let hi = price;
  const evidence: string[] = [...monthlySales.evidence];
  const limitations = [...baseLimitations];

  if (latest.originalPrice != null && latest.originalPrice > price) {
    hi = latest.originalPrice;
    evidence.push(`✓ sale price ${fmt(price)} with original price ${fmt(latest.originalPrice)} (discount observed)`);
    limitations.push("A discount is active; true transaction price lies between sale and original price.");
  }
  if (latest.variationPriceMin != null && latest.variationPriceMax != null && latest.variationPriceMax > latest.variationPriceMin) {
    lo = Math.min(lo, latest.variationPriceMin);
    hi = Math.max(hi, latest.variationPriceMax);
    evidence.push(`✓ public variation prices range ${fmt(latest.variationPriceMin)}–${fmt(latest.variationPriceMax)}`);
    limitations.push("Variations sell at different prices; the band spans the public variation range.");
  }

  // Historical price fluctuation adds uncertainty.
  const prices = input.history.map((h) => h.price).filter((p): p is number => p != null && p > 0);
  let histVar = 0;
  if (prices.length >= 2) {
    const mean = prices.reduce((a, b) => a + b, 0) / prices.length;
    const cv = Math.sqrt(prices.reduce((a, p) => a + (p - mean) ** 2, 0) / prices.length) / mean;
    if (cv > 0.02) {
      histVar = Math.min(0.25, cv * cv * 4);
      limitations.push(`Observed price fluctuated across ${prices.length} snapshots (CV ${(cv * 100).toFixed(0)}%).`);
    }
  }

  const geoMean = Math.sqrt(lo * hi);
  const spreadSigma = Math.log(Math.max(hi / lo, 1)) / 2; // half-width in log space
  const priceSigma2 = clamp(0.05 * 0.05 + spreadSigma * spreadSigma + histVar, 0.0025, 0.5);

  // Sales quantiles -> log-space params (invert p10/p90 to recover sigma_s).
  const sq = monthlySales.quantiles;
  const muS = Math.log(Math.max(1, sq.p50));
  const sigmaS = Math.max(0.05, Math.log(Math.max(1, sq.p90) / Math.max(1, sq.p50)) / 1.2816);

  const muR = muS + Math.log(geoMean);
  const sigmaR2 = clampSigma(sigmaS * sigmaS + priceSigma2);
  const q = logNormalQuantiles({ mu: muR, sigma2: sigmaR2 });
  const quantiles: QuantileSet = { p10: round(q.p10), p50: round(q.p50), p90: round(q.p90) };

  evidence.push(`✓ observed price ${fmt(price)}${latest.currency ? ` (${latest.currency})` : ""}`);

  const confidencePct = Math.round(Math.min(monthlySales.confidencePct, 92) * (priceSigma2 > 0.2 ? 0.85 : 1));
  const level = confidencePct < PRIORS.confidence.lowMax ? "LOW" : confidencePct >= PRIORS.confidence.highMin ? "HIGH" : "MEDIUM";

  return {
    metric: "monthly_revenue",
    available: true,
    quantiles,
    unit: "USD",
    confidencePct,
    confidenceLevel: level,
    evidence,
    modelBreakdown: monthlySales.modelBreakdown,
    limitations,
  };
}

function fmt(v: number): string {
  return `$${v.toFixed(2)}`;
}
