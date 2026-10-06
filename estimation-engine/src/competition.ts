/**
 * COMPETITION SCORE (0–100), computed from the observable SERP cohort.
 *
 *   results_density   : log10(total results) / 3            (weight .22)
 *   median_reviews    : log10(median peer reviews + 1) / 3  (weight .24)
 *   established_share : share of peers with ≥500 reviews    (weight .22)
 *   ad_density        : share of ad slots among peers       (weight .14)
 *   price_pressure    : price coefficient-of-variation /0.6 (weight .18)
 *
 * Interpretation: LOW < 35 ≤ MEDIUM < 65 ≤ HIGH.
 * Without any peers observed we refuse to score ("Insufficient public data").
 */
import { clamp, median, quantile } from "@etsy-signal/shared";
import type { Score, ScoreComponent } from "@etsy-signal/shared";
import type { EstimationInput, SerpPeer } from "./input.js";

export const ESTABLISHED_REVIEW_THRESHOLD = 500;

export interface CompetitionContext {
  medianReviews: number | null;
  medianPrice: number | null;
  peerCount: number;
  establishedShare: number | null;
  adShare: number | null;
  totalResults: number | null;
}

export function competitionContext(input: EstimationInput): CompetitionContext {
  const peers: SerpPeer[] = input.serp?.peers ?? [];
  const reviews = peers.map((p) => p.reviewCount).filter((r): r is number => r != null);
  const prices = peers.map((p) => p.price).filter((p): p is number => p != null && p > 0);
  const ads = peers.filter((p) => p.isAd).length;
  return {
    medianReviews: median(reviews),
    medianPrice: median(prices),
    peerCount: peers.length,
    establishedShare: reviews.length > 0 ? reviews.filter((r) => r >= ESTABLISHED_REVIEW_THRESHOLD).length / reviews.length : null,
    adShare: peers.length > 0 ? ads / peers.length : null,
    totalResults: input.serp?.visibleResultCount ?? null,
  };
}

export function scoreCompetition(input: EstimationInput): Score {
  const ctx = competitionContext(input);
  const components: ScoreComponent[] = [];
  const reasons: string[] = [];
  const limitations: string[] = [];

  if (ctx.peerCount === 0) {
    return {
      metric: "competition",
      available: false,
      value: null,
      components,
      reasons,
      limitations: ["Insufficient public data — no competing listings were observed on the same search page."],
    };
  }

  if (ctx.totalResults != null && ctx.totalResults > 0) {
    components.push({
      name: "results_density",
      value: Math.round(100 * clamp(Math.log10(ctx.totalResults + 1) / 3, 0, 1)),
      weight: 0.22,
      note: `${ctx.totalResults.toLocaleString()} results shown for the query`,
    });
  }

  if (ctx.medianReviews != null) {
    components.push({
      name: "median_reviews",
      value: Math.round(100 * clamp(Math.log10(ctx.medianReviews + 1) / 3, 0, 1)),
      weight: 0.24,
      note: `median competitor has ${Math.round(ctx.medianReviews)} reviews`,
    });
    if (ctx.medianReviews >= 300) reasons.push("⚠ competitors are review-heavy");
    else if (ctx.medianReviews <= 50) reasons.push("✓ competitors have light review counts");
  }

  if (ctx.establishedShare != null) {
    components.push({
      name: "established_share",
      value: Math.round(100 * ctx.establishedShare),
      weight: 0.22,
      note: `${Math.round(ctx.establishedShare * 100)}% of peers have ≥${ESTABLISHED_REVIEW_THRESHOLD} reviews`,
    });
  }

  if (ctx.adShare != null) {
    components.push({
      name: "ad_density",
      value: Math.round(100 * clamp(ctx.adShare / 0.5, 0, 1)),
      weight: 0.14,
      note: `${Math.round(ctx.adShare * 100)}% of visible slots are Etsy Ads`,
    });
  }

  const prices = (input.serp?.peers ?? []).map((p) => p.price).filter((p): p is number => p != null && p > 0);
  if (prices.length >= 3) {
    const m = prices.reduce((a, b) => a + b, 0) / prices.length;
    const cv = Math.sqrt(prices.reduce((a, p) => a + (p - m) ** 2, 0) / prices.length) / m;
    components.push({
      name: "price_pressure",
      value: Math.round(100 * clamp(cv / 0.6, 0, 1)),
      weight: 0.18,
      note: `price dispersion CV=${(cv * 100).toFixed(0)}% across peers`,
    });
  } else {
    limitations.push("Too few peer prices observed for price-pressure analysis.");
  }

  const usable = components.filter((c) => c.value != null);
  if (usable.length < 2) {
    return {
      metric: "competition",
      available: false,
      value: null,
      components,
      reasons,
      limitations: [...limitations, "Insufficient public data for a competition score."],
    };
  }

  const wSum = usable.reduce((a, c) => a + c.weight, 0);
  const value = Math.round(usable.reduce((a, c) => a + (c.value as number) * c.weight, 0) / wSum);
  const interpretation = value < 35 ? "LOW competition" : value < 65 ? "MEDIUM competition" : "HIGH competition";
  if (value < 35) reasons.push("✓ competition below typical niche levels");
  if (value >= 65) reasons.push("⚠ dense, established competition");

  return { metric: "competition", available: true, value, components, interpretation, reasons, limitations };
}
