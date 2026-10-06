/**
 * Documented statistical assumptions (priors) used by the estimation engine.
 *
 * READ THIS FILE CAREFULLY. These are the ONLY "made-up" numbers in the whole
 * system, and every one of them is:
 *   1. centralized here (not scattered through the code),
 *   2. named and commented,
 *   3. surfaced to the user in every estimate's `limitations` list, and
 *   4. overridden by REAL data whenever real data exists (see shop calibration
 *      in sales.ts — when Etsy publicly shows a shop's total sales AND total
 *      reviews, we compute that shop's actual review propensity instead of
 *      using the prior below).
 *
 * Nothing downstream is allowed to invent additional magic numbers.
 */

export interface LogNormalPrior {
  /** Median of the distribution (exp(mu)). */
  median: number;
  /** Sigma in log-space — controls how wide the uncertainty is. */
  sigma: number;
}

export const PRIORS = {
  /**
   * Review propensity: fraction of actual buyers who leave a review.
   * Etsy does not publish this. Published e-commerce research puts organic
   * review rates roughly in the 1%–7% band depending on category and buyer
   * engagement. We model it as log-normal with a median of 3% and wide
   * uncertainty (sigma 0.55 in log space => roughly 1.2%..7.6% interdecile).
   *
   * This is explicitly an ASSUMPTION, shown to the user in every estimate's
   * limitations. When shop-level sales+reviews are public, the engine uses
   * the shop's empirical ratio instead (see calibration in sales.ts).
   */
  reviewPropensity: { median: 0.03, sigma: 0.55 } as LogNormalPrior,

  /**
   * Favorite propensity: fraction of actual buyers (or serious shoppers) who
   * favorite an item. Etsy shows favorites counts on some surfaces but not
   * reliably. This prior is much looser than review propensity because
   * favoriting behavior is far less studied. Used only as a weak supporting
   * signal, never as the primary basis.
   */
  favoritePropensity: { median: 0.12, sigma: 0.8 } as LogNormalPrior,

  /**
   * Review velocity -> sales recency. Recent (trailing-30-day) review velocity
   * is converted with the same propensity prior, but treated as a *rate*.
   */

  /**
   * Bestseller badge anchor. Etsy's Bestseller badge is awarded to listings in
   * the top of their category by recent sales. The exact threshold is private,
   * but it is strong evidence of a MINIMUM sales rate. We encode it as a soft
   * lower-bound multiplier applied to the pooled median, never as a point value.
   * The value below is a deliberately conservative floor (sales/month) that a
   * badge-holder plausibly exceeds; it only raises P10, never P50/P90.
   */
  bestsellerMonthlySalesFloor: 30,

  /**
   * Search position demand prior. Being on page 1 / top of the grid implies a
   * minimum impression share. We only use position to bound DEMAND score, not
   * to fabricate sales — sales still must come from review/favorite evidence.
   */

  /**
   * Minimum observations before we will emit ANY estimate. Below this we
   * return available=false with a clear reason. This is the "no fake data"
   * gate.
   */
  minSignalsForEstimate: 1,

  /**
   * Confidence thresholds (percent). Below `low` we report LOW and encourage
   * the user to keep tracking. These map to the ConfidenceLevel enum.
   */
  confidence: {
    lowMax: 40,
    highMin: 70,
  },

  /**
   * Freshness half-life in days: evidence loses half its confidence weight
   * every N days since it was observed.
   */
  freshnessHalfLifeDays: 45,
} as const;

/** Convert a prior median/sigma to log-space params. */
export function priorToLogNormal(p: LogNormalPrior): { mu: number; sigma2: number } {
  return { mu: Math.log(p.median), sigma2: p.sigma * p.sigma };
}
