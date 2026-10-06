/**
 * OPPORTUNITY SCORE (0–100) — transparent weighted model, not an arbitrary
 * average.
 *
 *   opportunity = 0.40·demand + 0.30·(100 − competition) + 0.15·trend + 0.15·commercial
 *
 * Missing pillars are dropped and weights renormalized; at least two pillars
 * (including demand or competition) are required, otherwise we output
 * "Insufficient evidence" rather than a made-up score.
 *
 * `commercial` (commercial attractiveness) is itself documented:
 *   base 40 when a price is observed
 *   +30 if price sits inside the cohort's 25th–75th percentile band
 *   +15 if below (undercut) / +20 if above (premium)
 *   +20 rating ≥ 4.7, +10 rating ≥ 4.4
 *   +10 if a public discount is active
 */
import { clamp, quantile } from "@etsy-signal/shared";
import type { Score, ScoreComponent } from "@etsy-signal/shared";
import type { EstimationInput } from "./input.js";

export function scoreOpportunity(input: EstimationInput, demand: Score, competition: Score, trend: Score): Score {
  const components: ScoreComponent[] = [];
  const reasons: string[] = [];
  const limitations: string[] = [];

  if (demand.available && demand.value != null) {
    components.push({ name: "demand", value: demand.value, weight: 0.4, note: "demand pillar" });
    if (demand.value >= 70) reasons.push("✓ strong demand signals");
    else if (demand.value <= 35) reasons.push("⚠ weak demand signals");
  } else {
    limitations.push("Demand pillar missing — insufficient demand evidence.");
  }

  if (competition.available && competition.value != null) {
    const headroom = 100 - competition.value;
    components.push({ name: "competition_headroom", value: headroom, weight: 0.3, note: "100 − competition" });
    if (competition.value < 35) reasons.push("✓ competition below niche average");
    else if (competition.value >= 65) reasons.push("⚠ high competition");
  } else {
    limitations.push("Competition pillar missing — observe this listing on a search page.");
  }

  if (trend.available && trend.value != null) {
    components.push({ name: "trend", value: trend.value, weight: 0.15, note: `trend: ${trend.trend}` });
    if (trend.trend === "rising") reasons.push("✓ positive ranking/velocity trend");
    if (trend.trend === "falling") reasons.push("⚠ negative trend");
  } else if (input.history.length < 4) {
    limitations.push("Historical data limited — trend pillar unavailable.");
  }

  // Commercial attractiveness
  const commercial = commercialAttractiveness(input);
  if (commercial != null) {
    components.push({ name: "commercial", value: commercial.value, weight: 0.15, note: commercial.note });
    if (commercial.value >= 70) reasons.push("✓ healthy price range for this niche");
  } else {
    limitations.push("Commercial pillar missing — no readable price.");
  }

  const hasCore = components.some((c) => c.name === "demand" || c.name === "competition_headroom");
  if (components.length < 2 || !hasCore) {
    return {
      metric: "opportunity",
      available: false,
      value: null,
      components,
      reasons,
      limitations: [...limitations, "Insufficient evidence for an opportunity score."],
    };
  }

  const wSum = components.reduce((a, c) => a + c.weight, 0);
  const value = Math.round(components.reduce((a, c) => a + (c.value as number) * c.weight, 0) / wSum);

  return { metric: "opportunity", available: true, value, components, reasons, limitations };
}

function commercialAttractiveness(input: EstimationInput): { value: number; note: string } | null {
  const { latest, serp } = input;
  const price = latest.price;
  if (price == null || !(price > 0)) return null;

  let score = 40;
  const notes: string[] = ["price observed"];
  const peerPrices = (serp?.peers ?? []).map((p) => p.price).filter((p): p is number => p != null && p > 0);
  if (peerPrices.length >= 4) {
    const p25 = quantile(peerPrices, 0.25);
    const p75 = quantile(peerPrices, 0.75);
    if (p25 != null && p75 != null) {
      if (price >= p25 && price <= p75) {
        score += 30;
        notes.push("inside cohort price band");
      } else if (price < p25) {
        score += 15;
        notes.push("below cohort price band (undercutting)");
      } else {
        score += 20;
        notes.push("above cohort price band (premium)");
      }
    }
  }
  if (latest.rating != null) {
    if (latest.rating >= 4.7) {
      score += 20;
      notes.push("excellent rating");
    } else if (latest.rating >= 4.4) {
      score += 10;
      notes.push("good rating");
    }
  }
  if (latest.originalPrice != null && latest.originalPrice > price) {
    score += 10;
    notes.push("active discount");
  }
  return { value: Math.round(clamp(score, 0, 100)), note: notes.join("; ") };
}
