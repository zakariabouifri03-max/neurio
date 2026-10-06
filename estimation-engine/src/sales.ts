/**
 * SALES ESTIMATION — multi-model ensemble.
 *
 * We deliberately never use a single formula like "reviews × 10". Instead the
 * engine builds several INDEPENDENT models, each producing a log-normal
 * distribution, and pools them by reliability weight. Model disagreement
 * widens the final interval instead of being averaged away.
 *
 * Models used (each documented, each with a real-data source or a clearly
 * labelled prior):
 *
 *  1. review_propensity   — lifetime sales ≈ reviews / propensity.
 *     Propensity is a documented prior (see assumptions.ts) unless...
 *  2. shop_calibrated     — ...Etsy publicly shows the shop's total sales AND
 *     total reviews: then we compute the shop's REAL review rate and anchor
 *     to that. This is the strongest legitimate calibration available.
 *  3. velocity_rate       — recent reviews/day (OLS over extension snapshots)
 *     / propensity → sales rate. Pure historical-tracking signal.
 *  4. avg_rate_from_age   — lifetime reviews / listing age → average rate.
 *  5. favorites_model     — favorites / favorite propensity (weak, wide).
 *
 * Badge evidence ("Bestseller") applies a conservative floor to P10 only.
 */
import { clamp } from "@etsy-signal/shared";
import type { Estimate, ModelContribution, QuantileSet } from "@etsy-signal/shared";
import { PRIORS, priorToLogNormal } from "./assumptions.js";
import { clampSigma, logNormalQuantiles, opinionPool, type LogNormalModel } from "./distributions.js";
import { reviewVelocity, trackedDays } from "./history.js";
import type { EstimationInput } from "./input.js";

const LN30 = Math.log(30);
const DAYS_MS = 86_400_000;

export interface SalesContext {
  /** Listing age in days from real data (Etsy "Listed on" date), if known. */
  realAgeDays: number | null;
  /** Days since the extension first saw the listing. */
  trackedDays: number;
  propensityMedian: number;
  propensitySource: "assumed_prior" | "shop_observed";
}

export function buildSalesContext(input: EstimationInput): SalesContext {
  const now = Date.parse(input.now);
  let realAgeDays: number | null = null;
  if (input.latest.listedOnDate) {
    const t = Date.parse(input.latest.listedOnDate);
    if (Number.isFinite(t) && t <= now) realAgeDays = (now - t) / DAYS_MS;
  }
  const tDays = trackedDays(input.history);

  // Shop-level calibration: REAL data when Etsy shows both numbers.
  const { shopSalesCount, shopReviewCount } = input.latest;
  if (shopSalesCount && shopSalesCount > 0 && shopReviewCount != null && shopReviewCount > 0) {
    const pShop = clamp(shopReviewCount / shopSalesCount, 0.001, 0.3);
    return { realAgeDays, trackedDays: tDays, propensityMedian: pShop, propensitySource: "shop_observed" };
  }
  return {
    realAgeDays,
    trackedDays: tDays,
    propensityMedian: PRIORS.reviewPropensity.median,
    propensitySource: "assumed_prior",
  };
}

interface ModelOut {
  logModel: LogNormalModel;
  median: number;
  evidence: string[];
  breakdown: ModelContribution;
}

function smallCountExtraVariance(reviews: number): number {
  // Sparse review counts are noisier evidence; widen slightly. Documented.
  return reviews < 20 ? 0.5 / Math.max(1, reviews) : 0;
}

export function estimateLifetimeSales(input: EstimationInput): Estimate {
  const ctx = buildSalesContext(input);
  const { latest } = input;
  const reviews = latest.reviewCount;
  const evidence: string[] = [];
  const limitations: string[] = [];
  const models: ModelOut[] = [];

  const propensityNote =
    ctx.propensitySource === "shop_observed"
      ? `shop review rate ${(ctx.propensityMedian * 100).toFixed(1)}% observed from public shop totals`
      : `assumed review propensity ~${(ctx.propensityMedian * 100).toFixed(1)}% (documented prior — Etsy does not publish this)`;

  // ---- Model 1: review count / propensity (lifetime) -------------------
  // When the shop's own public review rate is known, this model keeps the
  // general prior as an INDEPENDENT second opinion; the shop-calibrated model
  // below carries the real data. Without shop data, this model uses the prior.
  if (reviews != null && reviews > 0) {
    const m1Propensity = ctx.propensitySource === "shop_observed" ? PRIORS.reviewPropensity.median : ctx.propensityMedian;
    const m1Note =
      ctx.propensitySource === "shop_observed"
        ? `lifetime: ${reviews} reviews ÷ general prior (${(m1Propensity * 100).toFixed(1)}%) — cross-check vs shop-calibrated model`
        : `lifetime: ${reviews} observed reviews ÷ ${propensityNote}`;
    const { mu, sigma2 } = priorToLogNormal({ median: m1Propensity, sigma: PRIORS.reviewPropensity.sigma });
    // ln(sales) = ln(reviews) - ln(propensity).
    const m: LogNormalModel = {
      name: "review_propensity",
      mu: Math.log(reviews) - mu,
      sigma2: sigma2 + smallCountExtraVariance(reviews),
      weight: 0.5 + (reviews >= 25 ? 0.15 : 0),
      note: m1Note,
    };
    const med = Math.exp(m.mu);
    models.push({
      logModel: m,
      median: med,
      evidence: [`✓ ${reviews} public reviews observed on Etsy`],
      breakdown: { model: "review_propensity", modelMedian: med, weight: m.weight, reliability: m.weight, note: m.note },
    });
    evidence.push(`✓ ${reviews} public reviews observed on Etsy`);
  } else if (reviews === 0) {
    evidence.push("✓ 0 reviews observed on the listing");
  }

  // ---- Model 2: shop-calibrated (only when model 1 used the prior) -----
  if (ctx.propensitySource === "shop_observed" && reviews != null && reviews > 0) {
    const { shopReviewCount } = latest;
    const extraVar = Math.min(0.5, 1 / Math.max(1, shopReviewCount ?? 1));
    const m: LogNormalModel = {
      name: "shop_calibrated",
      mu: Math.log(reviews) - Math.log(ctx.propensityMedian),
      sigma2: 0.22 * 0.22 + extraVar,
      weight: 0.9 * clamp(Math.sqrt((latest.shopSalesCount ?? 0) / 200), 0.5, 1),
      note: `lifetime: ${reviews} reviews ÷ shop's own public review rate (${(ctx.propensityMedian * 100).toFixed(1)}%)`,
    };
    const med = Math.exp(m.mu);
    models.push({
      logModel: m,
      median: med,
      evidence: [
        `✓ Shop publicly shows ${latest.shopSalesCount} sales and ${latest.shopReviewCount} reviews`,
        `✓ Shop review rate ${(ctx.propensityMedian * 100).toFixed(1)}% computed from public totals`,
      ],
      breakdown: { model: "shop_calibrated", modelMedian: med, weight: m.weight, reliability: m.weight, note: m.note },
    });
    evidence.push(
      `✓ Shop publicly shows ${latest.shopSalesCount} sales & ${latest.shopReviewCount} reviews → ${(ctx.propensityMedian * 100).toFixed(1)}% review rate`,
    );
  }

  // ---- Model 3: velocity × age (lifetime from tracked velocity) --------
  const vel = reviewVelocity(input.history);
  if (vel && ctx.realAgeDays != null && ctx.realAgeDays > 0 && vel.slopePerDay > 0) {
    const ratePerDay = vel.slopePerDay / ctx.propensityMedian;
    const m: LogNormalModel = {
      name: "velocity_lifetime",
      mu: Math.log(ratePerDay * ctx.realAgeDays),
      sigma2: PRIORS.reviewPropensity.sigma ** 2 + (1 - vel.r2) * 0.35,
      weight: 0.35 + 0.2 * clamp(vel.spanDays / 30, 0, 1),
      note: `lifetime: ${vel.slopePerDay.toFixed(2)} reviews/day ÷ propensity × ${Math.round(ctx.realAgeDays)} listing days`,
    };
    const med = Math.exp(m.mu);
    models.push({
      logModel: m,
      median: med,
      evidence: [
        `✓ review velocity ${vel.slopePerDay.toFixed(2)}/day over ${Math.round(vel.spanDays)} tracked days (R²=${vel.r2.toFixed(2)})`,
        `✓ listing age ${Math.round(ctx.realAgeDays)} days (public "listed on" date)`,
      ],
      breakdown: { model: "velocity_lifetime", modelMedian: med, weight: m.weight, reliability: m.weight, note: m.note },
    });
    evidence.push(`✓ review velocity ${vel.slopePerDay.toFixed(2)}/day over ${Math.round(vel.spanDays)} tracked days`);
  }

  // ---- Model 4: favorites (weak, wide) ----------------------------------
  const favs = latest.favoritesCount;
  if (favs != null && favs > 0) {
    const m: LogNormalModel = {
      name: "favorites_model",
      mu: Math.log(favs) - Math.log(PRIORS.favoritePropensity.median),
      sigma2: PRIORS.favoritePropensity.sigma ** 2,
      weight: 0.15,
      note: `lifetime: ${favs} public favorites ÷ favorite propensity prior (weak signal)`,
    };
    const med = Math.exp(m.mu);
    models.push({
      logModel: m,
      median: med,
      evidence: [`✓ ${favs} favorites publicly shown`],
      breakdown: { model: "favorites_model", modelMedian: med, weight: m.weight, reliability: m.weight, note: m.note },
    });
    evidence.push(`✓ ${favs} favorites publicly shown (weak signal)`);
  }

  // ---- Zero-review upper bound ------------------------------------------
  if (reviews === 0 && models.length === 0) {
    const upper95 = Math.round(3 / ctx.propensityMedian);
    return {
      metric: "sales",
      available: false,
      unit: "sales",
      confidencePct: 0,
      confidenceLevel: "LOW",
      evidence,
      modelBreakdown: [],
      limitations: [
        "Etsy does not disclose sales figures.",
        `With 0 observed reviews, sales above ~${upper95} are statistically unlikely (95%) under the documented review-propensity prior.`,
      ],
      unavailableReason: `0 reviews observed — no legitimate basis for a sales range. Upper bound ≈ ${upper95} sales (95%, prior-based).`,
    };
  }

  if (models.length === 0) {
    return unavailableSales("No review, favorite, or historical evidence available for this listing.");
  }

  const pooled = opinionPool(models.map((m) => m.logModel));
  if (!pooled) return unavailableSales("Models could not be combined.");
  const sigma2 = clampSigma(pooled.sigma2);
  const q = logNormalQuantiles({ mu: pooled.mu, sigma2 });
  const quantiles: QuantileSet = {
    p10: Math.max(0, Math.round(q.p10)),
    p50: Math.max(0, Math.round(q.p50)),
    p90: Math.max(0, Math.round(q.p90)),
  };

  if (ctx.propensitySource === "assumed_prior") {
    limitations.push(
      `Review→sales conversion uses an assumed propensity (~${(ctx.propensityMedian * 100).toFixed(1)}% of buyers leave a review). Etsy does not publish this figure.`,
    );
  } else {
    limitations.push("Calibrated with this shop's public totals; individual listings can deviate from shop average behavior.");
  }
  limitations.push("Etsy does not disclose actual sales — this is an estimate from public signals, not official data.");
  if (ctx.realAgeDays == null) {
    limitations.push("Listing age not publicly shown; the review count is treated as lifetime-to-date regardless of age.");
  }
  if (pooled.disagreement > 0.4) {
    limitations.push("Independent models disagree noticeably; the interval was widened to reflect that.");
  }

  evidence.push(propensityNote.startsWith("assumed") ? `⚠ ${propensityNote}` : `✓ ${propensityNote}`);
  if (ctx.trackedDays > 0) evidence.push(`✓ tracked by Etsy Signal for ${Math.round(ctx.trackedDays)} days`);

  const confidence = estimateConfidence(models.length, pooled.disagreement, evidenceStrength(input, ctx));

  return {
    metric: "sales",
    available: true,
    quantiles,
    unit: "sales",
    confidencePct: confidence.pct,
    confidenceLevel: confidence.level,
    evidence,
    modelBreakdown: models.map((m) => m.breakdown),
    limitations,
  };
}

export function estimateMonthlySales(input: EstimationInput): Estimate {
  const ctx = buildSalesContext(input);
  const { latest } = input;
  const reviews = latest.reviewCount;
  const evidence: string[] = [];
  const limitations: string[] = [];
  const models: ModelOut[] = [];
  const badges = (latest.badges ?? []).map((b) => b.toLowerCase());
  const isBestseller = badges.some((b) => b.includes("bestseller"));

  const vel = reviewVelocity(input.history);

  // ---- Model A: review velocity → monthly rate --------------------------
  if (vel && vel.spanDays >= 3 && vel.n >= 2) {
    if (vel.slopePerDay >= 0.005) {
      const monthly = (vel.slopePerDay / ctx.propensityMedian) * 30;
      const m: LogNormalModel = {
        name: "velocity_rate",
        mu: Math.log(monthly),
        sigma2: PRIORS.reviewPropensity.sigma ** 2 + (1 - vel.r2) * 0.35 + (vel.inconsistent ? 0.15 : 0),
        weight: 0.55 + 0.25 * clamp(vel.spanDays / 30, 0, 1) + 0.1 * clamp((vel.n - 2) / 6, 0, 1),
        note: `monthly: ${vel.slopePerDay.toFixed(2)} reviews/day ÷ propensity × 30`,
      };
      const med = Math.exp(m.mu);
      models.push({
        logModel: m,
        median: med,
        evidence: [`✓ review velocity ${vel.slopePerDay.toFixed(2)}/day over ${Math.round(vel.spanDays)} days (R²=${vel.r2.toFixed(2)}, n=${vel.n})`],
        breakdown: { model: "velocity_rate", modelMedian: med, weight: m.weight, reliability: m.weight, note: m.note },
      });
      evidence.push(`✓ review velocity ${vel.slopePerDay.toFixed(2)} reviews/day over ${Math.round(vel.spanDays)} tracked days`);
    } else {
      // Near-zero velocity is real information: recent sales are probably low,
      // but reviews are sparse, so keep it wide and lightly weighted.
      const monthlyUpper = (0.005 / ctx.propensityMedian) * 30;
      const m: LogNormalModel = {
        name: "velocity_rate_near_zero",
        mu: Math.log(monthlyUpper) - 0.5,
        sigma2: PRIORS.reviewPropensity.sigma ** 2 + 0.3,
        weight: 0.3,
        note: "recent review velocity ≈ 0/day → suggests low recent sales (wide interval)",
      };
      models.push({
        logModel: m,
        median: Math.exp(m.mu),
        evidence: ["✓ review velocity ≈ 0/day during tracking window"],
        breakdown: { model: "velocity_rate_near_zero", modelMedian: Math.exp(m.mu), weight: m.weight, reliability: m.weight, note: m.note },
      });
      evidence.push("✓ review velocity ≈ 0/day during tracking window");
    }
  }

  // ---- Model B: average rate from known listing age ---------------------
  if (reviews != null && reviews > 0 && ctx.realAgeDays != null && ctx.realAgeDays >= 14) {
    const monthly = (reviews / ctx.propensityMedian / ctx.realAgeDays) * 30;
    const m: LogNormalModel = {
      name: "avg_rate_from_age",
      mu: Math.log(monthly),
      sigma2: PRIORS.reviewPropensity.sigma ** 2 + smallCountExtraVariance(reviews) + 0.1, // age-average smooths away recency
      weight: 0.35,
      note: `monthly: ${reviews} reviews ÷ ${Math.round(ctx.realAgeDays)} days ÷ propensity × 30 (lifetime average)`,
    };
    const med = Math.exp(m.mu);
    models.push({
      logModel: m,
      median: med,
      evidence: [`✓ ${reviews} reviews over public listing age of ${Math.round(ctx.realAgeDays)} days`],
      breakdown: { model: "avg_rate_from_age", modelMedian: med, weight: m.weight, reliability: m.weight, note: m.note },
    });
    evidence.push(`✓ public listing age ${Math.round(ctx.realAgeDays)} days`);
  }

  if (models.length === 0) {
    const e = unavailableSales(
      ctx.realAgeDays == null && !vel
        ? "Not enough historical observations and no public listing age — cannot estimate a monthly rate."
        : "Not enough historical observations yet. Keep tracking this listing to unlock monthly estimates.",
    );
    if (reviews === 0) e.unavailableReason = "0 reviews observed — no legitimate basis for a monthly sales estimate.";
    return e;
  }

  const pooled = opinionPool(models.map((m) => m.logModel));
  if (!pooled) return unavailableSales("Models could not be combined.");
  const sigma2 = clampSigma(pooled.sigma2);
  const q = logNormalQuantiles({ mu: pooled.mu, sigma2 });
  const quantiles: QuantileSet = {
    p10: Math.max(0, Math.round(q.p10)),
    p50: Math.max(0, Math.round(q.p50)),
    p90: Math.max(0, Math.round(q.p90)),
  };

  // Bestseller badge: conservative floor on P10 only (documented assumption).
  if (isBestseller && quantiles.p10 < PRIORS.bestsellerMonthlySalesFloor) {
    quantiles.p10 = PRIORS.bestsellerMonthlySalesFloor;
    if (quantiles.p50 < quantiles.p10) quantiles.p50 = quantiles.p10;
    evidence.push("✓ Bestseller badge observed (Etsy award for strong recent sales)");
    limitations.push(
      `Bestseller badge applied a conservative floor of ${PRIORS.bestsellerMonthlySalesFloor}/month to the low end only (Etsy does not publish badge thresholds — documented assumption).`,
    );
  }

  if (ctx.propensitySource === "assumed_prior") {
    limitations.push(`Review→sales conversion uses an assumed propensity (~${(ctx.propensityMedian * 100).toFixed(1)}%). Not official Etsy data.`);
  } else {
    limitations.push("Calibrated with the shop's public sales/review totals.");
  }
  limitations.push("Monthly rate is an estimate; actual month-to-month sales vary.");

  const confidence = estimateConfidence(models.length, pooled.disagreement, evidenceStrength(input, ctx));

  return {
    metric: "monthly_sales",
    available: true,
    quantiles,
    unit: "sales",
    confidencePct: confidence.pct,
    confidenceLevel: confidence.level,
    evidence,
    modelBreakdown: models.map((m) => m.breakdown),
    limitations,
  };
}

function unavailableSales(reason: string): Estimate {
  return {
    metric: "sales",
    available: false,
    unit: "sales",
    confidencePct: 0,
    confidenceLevel: "LOW",
    evidence: [],
    modelBreakdown: [],
    limitations: ["Etsy does not disclose sales — estimates require observable public signals."],
    unavailableReason: reason,
  };
}

function evidenceStrength(input: EstimationInput, ctx: SalesContext): number {
  const l = input.latest;
  let s = 0;
  if (l.reviewCount != null) s += 0.3;
  if (l.shopSalesCount != null && l.shopReviewCount != null) s += 0.25;
  if (l.favoritesCount != null) s += 0.1;
  if (ctx.realAgeDays != null) s += 0.15;
  if (input.history.length >= 3) s += 0.2;
  return clamp(s, 0, 1);
}

function estimateConfidence(
  modelCount: number,
  disagreement: number,
  strength: number,
): { pct: number; level: "LOW" | "MEDIUM" | "HIGH" } {
  // "Agreement" only means something with 2+ independent models; a lone model
  // cannot agree with itself, so its consistency credit is capped.
  const consistencyCredit = (1 - disagreement) * clamp(modelCount / 2, 0.3, 1);
  const pct = Math.round(
    100 * clamp(0.28 * clamp(modelCount / 3, 0, 1) + 0.37 * consistencyCredit + 0.35 * strength, 0, 0.97),
  );
  const level = pct < PRIORS.confidence.lowMax ? "LOW" : pct >= PRIORS.confidence.highMin ? "HIGH" : "MEDIUM";
  return { pct, level };
}
