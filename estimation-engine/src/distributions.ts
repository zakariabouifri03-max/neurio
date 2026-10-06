/**
 * Log-normal distribution utilities and the log-space opinion pool.
 *
 * All sales/revenue uncertainty is modeled in log-space with normal
 * distributions (i.e. log-normal in natural space). Quantiles for p10/p50/p90
 * only need fixed z-scores, so no numerical inverse-CDF machinery is required.
 *
 * Everything here is deterministic: same input -> same output. Reproducible.
 */

export const Z_P10 = -1.2815515655446004;
export const Z_P90 = 1.2815515655446004;

export interface LogNormalParams {
  /** Mean of ln(X). */
  mu: number;
  /** Variance of ln(X). */
  sigma2: number;
}

export interface LogNormalModel extends LogNormalParams {
  name: string;
  /** Reliability-based weight (>= 0). Normalized during pooling. */
  weight: number;
  note: string;
}

export function logNormalQuantiles(p: LogNormalParams): { p10: number; p50: number; p90: number } {
  const sigma = Math.sqrt(Math.max(0, p.sigma2));
  return {
    p10: Math.exp(p.mu + Z_P10 * sigma),
    p50: Math.exp(p.mu),
    p90: Math.exp(p.mu + Z_P90 * sigma),
  };
}

export interface PooledResult {
  mu: number;
  sigma2: number;
  /**
   * Fraction of total pooled variance caused by disagreement between models
   * (0 = perfect agreement, 1 = models contradict each other completely).
   * Feeds the confidence engine.
   */
  disagreement: number;
  totalWeight: number;
}

/**
 * Log-space opinion pool (weighted mixture of log-normal models).
 *
 * mu_pool   = Σ w_i * mu_i
 * var_pool  = Σ w_i * (sigma_i^2 + mu_i^2) - mu_pool^2
 *
 * The second term means: when independent models disagree, the combined
 * interval gets WIDER — disagreement is uncertainty, never averaged away.
 */
export function opinionPool(models: LogNormalModel[]): PooledResult | null {
  const usable = models.filter((m) => m.weight > 0 && Number.isFinite(m.mu) && Number.isFinite(m.sigma2));
  if (usable.length === 0) return null;
  const wSum = usable.reduce((a, m) => a + m.weight, 0);
  if (wSum <= 0) return null;

  let mu = 0;
  let secondMoment = 0;
  for (const m of usable) {
    const w = m.weight / wSum;
    mu += w * m.mu;
    secondMoment += w * (m.sigma2 + m.mu * m.mu);
  }
  const sigma2 = Math.max(0, secondMoment - mu * mu);
  const withinModelVar = usable.reduce((a, m) => a + (m.weight / wSum) * m.sigma2, 0);
  const betweenModelVar = Math.max(0, sigma2 - withinModelVar);
  const disagreement = sigma2 > 1e-9 ? Math.min(1, betweenModelVar / sigma2) : 0;
  return { mu, sigma2, disagreement, totalWeight: wSum };
}

/** Clamp pooled sigma into a sane band: never overconfident, never useless. */
export const MIN_SIGMA = 0.16; // ~ ±30% 80% interval at minimum
export const MAX_SIGMA = 1.15; // ~ very wide but finite

export function clampSigma(sigma2: number): number {
  const s = Math.sqrt(Math.max(0, sigma2));
  const clamped = Math.min(MAX_SIGMA, Math.max(MIN_SIGMA, s));
  return clamped * clamped;
}
