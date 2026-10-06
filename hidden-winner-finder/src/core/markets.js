/**
 * markets.js - "find where to sell it".
 *
 * Each marketplace gets a fit score built from four things:
 *   1. Audience/tag affinity (does this marketplace's buyer intent match the niche?)
 *   2. Effective unit economics on that marketplace after its published fees
 *   3. Competitive room (observed scans on that marketplace lower/raise the read)
 *   4. Reachability for a new seller (fees, ad dependence, listing friction)
 *
 * The result is a ranked set of venues, with ONE "best marketplace" verdict -
 * matching the extension's single-answer philosophy.
 */

import { MARKETPLACES, estimateFees } from '../data/marketplaces.js';
import { BASIS, clamp, round, weightedMeanDetailed, metric, scoreBand, shrinkToNeutral } from './metrics.js';

const n = (v) => (Number.isFinite(v) ? v : null);

/** Tag → marketplace affinity 0..1 */
function affinity(marketplace, product) {
  const tags = product?.tags || [];
  const overlaps = tags.filter((t) => marketplace.bestFor.includes(t)).length;
  if (!tags.length) return 0.5;
  return clamp(0.32 + overlaps * 0.17, 0, 1);
}

export function computeMarketplaceFit(product, ctx = {}) {
  const price = ctx.price ?? product?.price?.median;
  const margin = ctx.margin;
  const competition = ctx.competitionScore;
  const demand = ctx.demandScore;
  const observedMarkets = ctx.observedMarkets || {};

  const rows = MARKETPLACES.map((marketplace) => {
    const aff = affinity(marketplace, product);
    const fees = Number.isFinite(price) ? estimateFees(marketplace, price, { monthlyUnits: ctx.monthlyUnits || 100 }) : null;

    // Economics: how much of the price survives this marketplace's fees.
    const feeRate = fees ? fees.total / price : null;
    const economics = Number.isFinite(feeRate) ? clamp(100 - feeRate * 260, 10, 100) : null;

    // Competition is read per marketplace: if we scanned this marketplace for
    // this niche we know more, otherwise assume the niche pressure transfers.
    const observed = observedMarkets[marketplace.id];
    const competitionLocal = n(observed?.competitionScore) ?? competition;
    const room = Number.isFinite(competitionLocal) ? clamp(100 - competitionLocal * 0.75, 5, 100) : null;

    const demandLocal = n(observed?.demandScore) ?? demand;
    const demandScore = Number.isFinite(demandLocal) ? clamp(demandLocal * (0.7 + aff * 0.4), 0, 100) : null;

    const reach = clamp(
      100
      - (marketplace.adsAllowance * 260)
      - (marketplace.feeRate * 180)
      - (marketplace.monthlyPlatformFee ? 12 : 0),
      15,
      100,
    );

    const fused = weightedMeanDetailed([
      metric({ id: 'affinity', label: 'Buyer-intent match', value: aff * 100, weight: 1.5, basis: BASIS.MODELLED }),
      metric({ id: 'economics', label: 'Unit economics after fees', value: economics, weight: 1.2, basis: BASIS.MODELLED }),
      metric({ id: 'room', label: 'Competitive room', value: room, weight: 1.3, basis: observed ? BASIS.OBSERVED : BASIS.SNAPSHOT }),
      metric({ id: 'demand', label: 'Demand on this marketplace', value: demandScore, weight: 1.2, basis: observed ? BASIS.OBSERVED : BASIS.SNAPSHOT }),
      metric({ id: 'reach', label: 'New-seller reachability', value: reach, weight: 0.9, basis: BASIS.MODELLED }),
    ]);

    const score = fused.value == null ? null : Math.round(fused.value);
    return {
      id: marketplace.id,
      name: marketplace.name,
      icon: marketplace.icon,
      color: marketplace.color,
      score,
      confidence: observed ? 'High' : 'Medium',
      observed: Boolean(observed),
      demand: Number.isFinite(demandScore) ? (demandScore >= 72 ? 'High' : demandScore >= 50 ? 'Medium' : 'Low') : 'Unknown',
      competition: Number.isFinite(competitionLocal) ? (competitionLocal <= 30 ? 'Low' : competitionLocal <= 60 ? 'Medium' : competitionLocal <= 80 ? 'High' : 'Very High') : 'Unknown',
      opportunity: scoreBand(score),
      feesPerUnit: fees ? fees.total : null,
      effectiveFeeRate: feeRate,
      audience: marketplace.audience,
      searchUrl: marketplace.searchUrl(product?.name || ''),
      sellerUrl: marketplace.sellerUrl,
      notes: marketplace.notes,
      feeSource: marketplace.feeSource,
      why: explainRow(marketplace, aff, economics, room, fees, price),
    };
  }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));

  const best = rows[0] || null;
  const runnersUp = rows.slice(1, 3);

  return {
    rows,
    best,
    runnersUp,
    marginPerUnitOnBest: n(ctx.unitProfit),
    note: 'Fit combines buyer-intent match, published fee schedules, competitive room and how reachable the venue is for a brand-new seller.',
    confidence: best?.observed ? 'High' : 'Medium',
  };
}

function explainRow(marketplace, aff, economics, room, fees, price) {
  const parts = [];
  if (aff >= 0.75) parts.push(`buyer intent on ${marketplace.name} matches this niche closely`);
  else if (aff >= 0.55) parts.push(`reasonable buyer-intent match (${Math.round(aff * 100)}%)`);
  else parts.push('audience overlap is limited - expect to educate buyers');

  if (Number.isFinite(economics)) parts.push(`unit economics score ${economics.toFixed(0)}/100 after platform fees`);
  if (Number.isFinite(room)) parts.push(`competitive room ${Math.round(room)}/100`);
  if (fees && Number.isFinite(price)) parts.push(`~${((fees.total / price) * 100).toFixed(0)}% of the price goes to platform costs`);
  return `${parts.join(', ')}.`;
}

/** Honest confidence shrink for a marketplace row (no observed data = Medium). */
export const marketConfidenceScore = (row) => shrinkToNeutral(row?.score, { shrinkFactor: row?.observed ? 1 : 0.9 });

/** Verdict sentence for the report header. */
export function bestMarketVerdict(marketFit) {
  const best = marketFit?.best;
  if (!best) return 'No marketplace evaluation available.';
  return `${best.name} looks strongest: ${best.opportunity} opportunity, ${best.competition.toLowerCase()} competition, ${best.demand.toLowerCase()} demand.`;
}

export const round1 = (v) => round(v, 1);
