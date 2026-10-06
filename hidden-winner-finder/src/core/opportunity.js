/**
 * opportunity.js - the fusion layer.
 *
 * One niche in, one complete analysis out: demand, competition, trend, profit,
 * best marketplace, sourcing routes, traffic channels, risks, a beginner read,
 * the idea pack and the final opportunity score with its breakdown.
 *
 * Order of operations matters and is deliberate:
 *   trend → demand (needs trend + marketplace fit) → competition → profit
 *   (needs the volume estimate) → markets → channels → risks → verdict.
 */

import {
  BASIS, CONFIDENCE, aggregateConfidence, clamp, metric, round,
  scoreBand, shrinkToNeutral, weightedMeanDetailed,
} from './metrics.js';
import { getMarketplace } from '../data/marketplaces.js';
import { computeTrend } from './trend.js';
import { computeDemand, marketplaceFit } from './demand.js';
import { computeCompetition } from './competition.js';
import { computeProfit } from './profit.js';
import { buildSourcingPlan, budgetFit as computeBudgetFit } from './sourcing.js';
import { computeMarketplaceFit } from './markets.js';
import { computeChannels } from './channels.js';
import { assessRisks, beginnerFit } from './risk.js';
import { buildIdeaPack } from './ideas.js';

export const OPPORTUNITY_WEIGHTS = {
  demand: 0.28,
  competitionRoom: 0.22,
  profit: 0.24,
  trend: 0.18,
  beginner: 0.08,
};

/**
 * @param {object} product catalog niche
 * @param {object} ctx { marketplaceId, country, budget, observed, history, now, targetMargin }
 */
export function analyzeNiche(product, ctx = {}) {
  const marketplace = getMarketplace(ctx.marketplaceId || 'etsy');
  const observed = ctx.observed || {};

  // ── 1. trend
  const trend = computeTrend(product, {
    now: ctx.now,
    history: ctx.history,
    observed: observed.trend,
  });

  // ── 2. demand
  const fit = marketplaceFit(product, marketplace.id);
  const demand = computeDemand(product, observed, trend.score, fit);

  // ── 3. competition
  const competition = computeCompetition(product, observed);

  // ── 4. profit (needs a volume estimate for platform-fee spreading)
  const nicheUnitsHigh = demand.volume?.nicheUnits?.high ?? 100;
  const price = Number.isFinite(ctx.price) ? ctx.price : product.price?.median;
  const profit = computeProfit(product, {
    marketplace,
    price,
    monthlyUnits: Number.isFinite(ctx.monthlyUnits) ? ctx.monthlyUnits : Math.max(50, nicheUnitsHigh),
    observedPrice: observed.priceMedian,
    targetUnits: Number.isFinite(ctx.targetUnits) ? ctx.targetUnits : Math.max(10, Math.round((demand.volume?.newSellerUnits?.low ?? 10) * 1.5)),
  });

  const profitScoreParts = profit ? [
    metric({
      id: 'margin',
      label: 'Profit margin',
      value: scale(profit.unit.profitMargin, 0.05, 0.6, 30, 100),
      weight: 1.6,
      basis: BASIS.MODELLED,
      note: `Estimated margin of ${Math.round((profit.unit.profitMargin || 0) * 100)}% per unit`,
    }),
    metric({
      id: 'unitProfit',
      label: 'Profit per unit',
      value: scale(profit.unit.estimatedProfit, 0, 15, 35, 100),
      weight: 1.0,
      basis: BASIS.MODELLED,
      note: `About $${(profit.unit.estimatedProfit ?? 0).toFixed(2)} profit per sale`,
    }),
    metric({
      id: 'roi',
      label: 'Return on cash invested',
      value: scale(profit.unit.roi, 0.1, 1.5, 45, 100),
      weight: 0.9,
      basis: BASIS.MODELLED,
      note: `Every $1 of cost returns about $${(1 + (profit.unit.roi || 0)).toFixed(2)}`,
    }),
  ] : [];
  const profitFused = weightedMeanDetailed(profitScoreParts);

  // ── 5. sourcing (needs price + fees so each route can show real profit)
  const sourcing = buildSourcingPlan(product, {
    price,
    feesPerUnit: profit?.fees?.total,
    budget: ctx.budget,
    countryLabel: ctx.country?.label,
  });
  const budgetFitResult = computeBudgetFit(product, ctx.budget, sourcing);
  const chosenRoute = sourcing.recommended;

  // Re-run profit against the recommended route so the headline numbers match
  // the sourcing row the user is being told to use.
  const profitOnRoute = computeProfit(product, {
    marketplace,
    price,
    monthlyUnits: Math.max(50, nicheUnitsHigh),
    supplier: chosenRoute ? { id: chosenRoute.id } : null,
    targetUnits: profit?.targetUnits,
  });

  // ── 6. markets, channels, risks, beginner read
  const observedMarkets = ctx.observedMarkets || (observed ? { [marketplace.id]: observed } : {});
  const marketFit = computeMarketplaceFit(product, {
    price,
    margin: profit?.unit.profitMargin,
    competitionScore: competition.score,
    demandScore: demand.score,
    unitProfit: profit?.unit.estimatedProfit,
    observedMarkets,
  });

  const channels = computeChannels(product, { trendScore: trend.score, price, visualAppeal: product.tags?.includes('photo-driven') ? 0.85 : 0.7 });

  const risks = assessRisks(product, {
    competitionScore: competition.score,
    margin: profit?.unit.profitMargin,
    price,
    demandScore: demand.score,
    demandConfidence: demand.confidence?.id,
    seasonality: trend.seasonality,
  });

  const beginner = beginnerFit(product, {
    competitionScore: competition.score,
    margin: profit?.unit.profitMargin,
    startableOnBudget: budgetFitResult?.startable,
    riskLevel: risks.level,
  });

  // ── 7. opportunity score
  const competitionRoom = Number.isFinite(competition.score) ? 100 - competition.score : null;
  const components = [
    metric({ id: 'demand', label: 'Demand', value: demand.score, weight: OPPORTUNITY_WEIGHTS.demand, basis: demand.confidence?.id === 'High' ? BASIS.OBSERVED : BASIS.SNAPSHOT, note: 'Buyer activity across public marketplace signals' }),
    metric({ id: 'competitionRoom', label: 'Competition (inverted)', value: competitionRoom, weight: OPPORTUNITY_WEIGHTS.competitionRoom, basis: competition.confidence?.id === 'High' ? BASIS.OBSERVED : BASIS.SNAPSHOT, note: 'How much room is left for a new seller' }),
    metric({ id: 'profit', label: 'Profit potential', value: profitFused.value, weight: OPPORTUNITY_WEIGHTS.profit, basis: BASIS.MODELLED, note: 'Margin, profit per unit and return on cost' }),
    metric({ id: 'trend', label: 'Trend', value: trend.score, weight: OPPORTUNITY_WEIGHTS.trend, basis: trend.basis, note: '30/90-day momentum and seasonality position' }),
    metric({ id: 'beginner', label: 'Beginner suitability', value: beginner.score, weight: OPPORTUNITY_WEIGHTS.beginner, basis: BASIS.MODELLED, note: beginner.label }),
  ];
  const fused = weightedMeanDetailed(components);
  const confidence = aggregateConfidence(components);
  const raw = fused.value;
  const blockers = collectBlockers({ competition, demand, profit: profitOnRoute || profit, risks, trend });
  // Every point removed from the raw score is listed, so the user can see WHY a
  // promising-looking niche is not the winner instead of guessing.
  const adjustments = computeAdjustments({ risks, competition, demand, profit: profitOnRoute || profit, trend, blockers });
  const penalised = Number.isFinite(raw) ? clamp(raw - adjustments.total, 0, 100) : null;
  const finalScore = Number.isFinite(penalised)
    ? Math.round(clamp(shrinkToNeutral(penalised, confidence), 0, 100))
    : null;

  const analysis = {
    id: product.id,
    product,
    marketplace: { id: marketplace.id, name: marketplace.name, icon: marketplace.icon },
    price,
    demand,
    competition,
    trend,
    profit: profitOnRoute || profit,
    profitOnRecommendedRoute: profitOnRoute,
    profitBaseline: profit,
    sourcing,
    chosenRoute,
    budgetFit: budgetFitResult,
    marketFit,
    channels,
    risks,
    beginner,
    ideaPack: buildIdeaPack(product, {
      marketplaceId: marketplace.id,
      price,
      feeRate: (marketplace.feeRate + marketplace.paymentRate),
      costBand: [product.cost?.unitLow, product.cost?.unitHigh],
      shippingBand: [product.cost?.inboundLow, product.cost?.inboundHigh],
    }),
    opportunity: {
      id: 'opportunity',
      score: finalScore,
      rawScore: Number.isFinite(raw) ? round(raw, 1) : null,
      label: scoreBand(finalScore),
      confidence,
      components: fused.contributors,
      metrics: components,
      riskPenalty: risks.penalty,
      adjustments,
      blockers,
      weights: OPPORTUNITY_WEIGHTS,
      note: 'Weighted blend of demand (28%), profit potential (24%), competition room (22%), trend (18%) and beginner suitability (8%), minus the listed deductions and a confidence shrink. Low-confidence scores are pulled toward 50 so an estimate can never outrank observed data.',
    },
  };

  analysis.why = buildWhy(analysis);
  analysis.verdict = buildVerdict(analysis);
  return analysis;
}

/** Bounded, itemised score deductions (documented in the UI). */
export function computeAdjustments({ risks, competition, demand, profit, trend }) {
  const items = [];
  const push = (id, label, points) => {
    if (points > 0) items.push({ id, label, points: round(points, 1) });
  };

  for (const risk of risks?.risks || []) {
    push(`risk-${risk.id}`, `${risk.label} (${risk.severity} risk)`, risk.severity === 'high' ? 3 : risk.severity === 'medium' ? 1.5 : 0.75);
  }
  if (Number.isFinite(competition?.score)) {
    if (competition.score >= 80) push('competition', 'Very high competition - ranking is heavily defended', 7);
    else if (competition.score >= 65) push('competition', 'High competition - expect to compete on price or ads', 3.5);
  }
  if (Number.isFinite(demand?.score) && demand.score < 42) push('demand', 'Weak public demand signals', 7);
  const margin = profit?.unit?.profitMargin;
  if (Number.isFinite(margin)) {
    if (margin <= 0) push('margin', 'Negative estimated margin on the recommended route', 12);
    else if (margin < 0.2) push('margin', 'Thin estimated margin', 4);
  }
  if (Number.isFinite(trend?.score) && trend.score < 40) push('trend', 'Declining trend', 5);

  const total = round(Math.min(38, items.reduce((acc, i) => acc + i.points, 0)), 1);
  return { items, total };
}

const scale = (value, lo, hi, outLo = 0, outHi = 100) => {
  if (!Number.isFinite(value)) return null;
  const t = clamp((value - lo) / (hi - lo), 0, 1);
  return outLo + (outHi - outLo) * t;
};

function collectBlockers({ competition, demand, profit, risks, trend }) {
  const blockers = [];
  if (Number.isFinite(competition.score) && competition.score >= 80) {
    blockers.push({ id: 'competition', text: `Competition scores ${competition.score}/100 (Very High) - entering on price alone would fail.` });
  }
  if (Number.isFinite(demand.score) && demand.score < 42) {
    blockers.push({ id: 'demand', text: `Demand scores ${demand.score}/100 - the niche does not show enough public buyer activity.` });
  }
  const margin = profit?.unit?.profitMargin;
  if (Number.isFinite(margin)) {
    if (margin <= 0) {
      blockers.push({ id: 'margin', text: `Estimated margin on the recommended route is ${Math.round(margin * 100)}% - at this price and cost the product loses money. Reprice, switch to a bulk route, or pick a different niche.` });
    } else if (margin < 0.2) {
      blockers.push({ id: 'margin', text: `Estimated margin is only ${Math.round(margin * 100)}% - too thin to absorb ads and returns.` });
    }
  }
  if (Number.isFinite(trend.score) && trend.score < 40) {
    blockers.push({ id: 'trend', text: `Trend is declining (${trend.score}/100) - build on a falling market at your own risk.` });
  }
  if (risks.hasHighRisk) {
    blockers.push({ id: 'risk', text: 'At least one high-severity risk applies. Read the risk list before ordering anything.' });
  }
  return blockers;
}

/** The "WHY THIS PRODUCT?" bullets - each one carries its own evidence. */
function buildWhy(a) {
  const bullets = [];
  const { demand, competition, trend, profit, marketFit, beginner, product } = a;

  if (Number.isFinite(demand.score)) {
    const reviewNote = demand.metrics.find((m) => m.id === 'reviewActivity')?.note || '';
    bullets.push({
      id: 'demand',
      title: 'Strong customer demand',
      text: `${demand.score}/100 demand score. ${reviewNote}`,
      value: demand.score,
      basis: demand.confidence?.id === 'High' ? BASIS.OBSERVED : BASIS.SNAPSHOT,
      confidence: demand.confidence,
    });
  }
  if (Number.isFinite(competition.score)) {
    const strong = competition.metrics.find((m) => m.id === 'strongCompetitors');
    bullets.push({
      id: 'competition',
      title: competition.score <= 35 ? 'Few strong competitors' : competition.score <= 60 ? 'Competition is manageable' : 'Competition is the main obstacle',
      text: `Competition ${competition.score}/100 (${competition.band}). ${strong?.note || ''}`,
      value: 100 - competition.score,
      basis: competition.confidence?.id === 'High' ? BASIS.OBSERVED : BASIS.SNAPSHOT,
      confidence: competition.confidence,
    });
  }
  if (Number.isFinite(profit?.unit?.estimatedProfit)) {
    bullets.push({
      id: 'price',
      title: Number(a.price) >= 18
        ? 'Good average selling price'
        : Number(a.price) >= 12
          ? 'Reasonable price with room to bundle'
          : 'Low ticket price - volume or bundling required',
      text: `Typical price is around $${Number(a.price).toFixed(2)} and the estimated profit per sale is $${profit.unit.estimatedProfit.toFixed(2)} on ${marketFit.best?.name || a.marketplace.name} (about ${Math.round((profit.unit.profitMargin || 0) * 100)}% margin).${Number(a.price) < 12 ? ' At this price, plan a multi-pack or bundle to protect the shipping cost.' : ''}`,
      value: profit.unit.estimatedProfit,
      basis: BASIS.MODELLED,
      confidence: CONFIDENCE.Low,
    });
  }
  if (Number.isFinite(trend.score)) {
    bullets.push({
      id: 'trend',
      title: trend.band.id === 'rising' ? 'Growing interest' : trend.band.id === 'stable' ? 'Stable, predictable interest' : 'Interest is cooling',
      text: `${trend.band.icon} ${trend.band.label} (${trend.score}/100). 30 days: ${trend.windows[0].icon} ${trend.windows[0].movement}; 90 days: ${trend.windows[1].icon} ${trend.windows[1].movement}. ${trend.seasonality.note}`,
      value: trend.score,
      basis: trend.basis,
      confidence: { id: trend.confidence, label: trend.confidence },
    });
  }
  if (product.differentiation?.length) {
    bullets.push({
      id: 'differentiation',
      title: 'Multiple ways to differentiate',
      text: `${product.differentiation.length} concrete angles are available, starting with: ${product.differentiation[0]}`,
      value: product.differentiation.length,
      basis: BASIS.MODELLED,
      confidence: CONFIDENCE.Medium,
    });
  }
  bullets.push({
    id: 'beginner',
    title: 'Suitable for beginners',
    text: `${beginner.label} (${beginner.score}/100). ${beginner.reasons[0] || ''}`,
    value: beginner.score,
    basis: BASIS.MODELLED,
    confidence: CONFIDENCE.Low,
  });
  return bullets;
}

function buildVerdict(a) {
  const score = a.opportunity.score;
  const conf = a.opportunity.confidence?.label || 'Low';
  if (a.opportunity.blockers.length && Number.isFinite(score) && score < 80) {
    return {
      headline: score >= 65 ? 'Promising, but with caveats' : 'Not recommended as your first product',
      text: `Opportunity score ${score}/100 (${conf} confidence). ${a.opportunity.blockers.length} blocker${a.opportunity.blockers.length > 1 ? 's' : ''} found - read them before you spend anything.`,
      tone: score >= 65 ? 'warn' : 'bad',
    };
  }
  if (!Number.isFinite(score)) {
    return { headline: 'Not enough data', text: 'The extension could not build a complete picture for this niche. Scan the live search page to fill the gaps.', tone: 'warn' };
  }
  if (score >= 85) return { headline: 'Excellent opportunity', text: `Opportunity score ${score}/100 with ${conf.toLowerCase()} confidence. Worth a small, fast test this week.`, tone: 'good' };
  if (score >= 70) return { headline: 'Strong opportunity', text: `Opportunity score ${score}/100 (${conf} confidence). Validate with one sample and a small listing test.`, tone: 'good' };
  if (score >= 55) return { headline: 'Workable niche', text: `Opportunity score ${score}/100 (${conf} confidence). Real demand, but you will need a sharp angle.`, tone: 'warn' };
  return { headline: 'Weak opportunity', text: `Opportunity score ${score}/100 (${conf} confidence). Consider one of the runners-up instead.`, tone: 'bad' };
}

export const opportunityRank = (analysis) => analysis?.opportunity?.score ?? -1;

/** Tie-breaker: prefer higher confidence, then stronger profit, then lower competition. */
export function compareAnalyses(a, b) {
  const byScore = opportunityRank(b) - opportunityRank(a);
  if (byScore !== 0) return byScore;
  const confRank = (x) => CONFIDENCE[x?.opportunity?.confidence?.id]?.rank || 0;
  const byConf = confRank(b) - confRank(a);
  if (byConf !== 0) return byConf;
  const byProfit = (b?.profit?.unit?.estimatedProfit ?? -1) - (a?.profit?.unit?.estimatedProfit ?? -1);
  if (byProfit !== 0) return byProfit;
  return (a?.competition?.score ?? 100) - (b?.competition?.score ?? 100);
}
