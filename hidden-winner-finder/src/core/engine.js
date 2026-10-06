/**
 * engine.js - candidate selection and ranking.
 *
 * SCAN MARKET analyses every candidate niche and returns a ranked table.
 * FIND MY WINNING PRODUCT returns exactly one niche: the top-ranked one after
 * the confidence, profit and competition tie-breakers.
 */

import { CATALOG, productsByCategory } from '../data/catalog.js';
import { getMarketplace } from '../data/marketplaces.js';
import { getBudget, getCountry, getCategory } from './options.js';
import { analyzeNiche, compareAnalyses } from './opportunity.js';
import { BASIS } from './metrics.js';

/**
 * @param {object} options {
 *   categoryId, marketplaceId, countryId, budgetId,
 *   observedByProduct: { [productId]: signals },   // from live scans
 *   historyByProduct:  { [productId]: [snapshots] },
 *   now, limit
 * }
 */
export function analyzeAll(options = {}) {
  const marketplace = getMarketplace(options.marketplaceId);
  const budget = getBudget(options.budgetId);
  const country = getCountry(options.countryId);
  const category = getCategory(options.categoryId);

  const candidates = productsByCategory(category.id);
  const analyses = candidates.map((product) => {
    const observed = options.observedByProduct?.[product.id] || null;
    const history = options.historyByProduct?.[product.id] || [];
    const analysis = analyzeNiche(product, {
      marketplaceId: marketplace.id,
      country,
      budget,
      observed,
      history,
      now: options.now,
      price: observed?.priceMedian,
    });
    analysis.observedLive = Boolean(observed);
    return analysis;
  });

  return {
    options: {
      category: { id: category.id, label: category.label },
      marketplace: { id: marketplace.id, name: marketplace.name },
      country: { id: country.id, label: country.label },
      budget: { id: budget.id, label: budget.label },
    },
    analyses: analyses.sort(compareAnalyses),
    catalogVersion: CATALOG.length,
  };
}

/** Ranked opportunity list for the SCAN MARKET table. */
export function scanMarket(options = {}) {
  const { analyses, options: resolved } = analyzeAll(options);
  const limit = Number.isFinite(options.limit) ? options.limit : analyses.length;
  const rows = analyses.slice(0, limit).map((a, index) => ({
    rank: index + 1,
    productId: a.product.id,
    product: a.product.name,
    category: a.product.category,
    demand: a.demand.score,
    competition: a.competition.score,
    competitionBand: a.competition.band,
    profit: a.profit?.unit?.estimatedProfit ?? null,
    margin: a.profit?.unit?.profitMargin ?? null,
    trend: a.trend.score,
    trendBand: a.trend.band,
    opportunity: a.opportunity.score,
    opportunityLabel: a.opportunity.label,
    confidence: a.opportunity.confidence.label,
    blockers: a.opportunity.blockers.length,
    observed: a.observedLive,
    analysis: a,
  }));
  return {
    ...resolved,
    rows,
    scannedAt: Date.now(),
    total: analyses.length,
    basis: BASIS.SNAPSHOT,
    note: 'Ranking fuses demand, competition room, profit potential, trend and beginner suitability. Every row keeps its own confidence label.',
  };
}

/**
 * Analyse a single niche by id - used by the "Inspect" action in the scan table
 * so any row can be opened in full without re-ranking the whole market.
 */
export function analyzeOne(options = {}, productId) {
  const marketplace = getMarketplace(options.marketplaceId);
  const budget = getBudget(options.budgetId);
  const country = getCountry(options.countryId);
  const product = CATALOG.find((p) => p.id === productId);
  if (!product) return null;

  const observed = options.observedByProduct?.[productId] || null;
  const history = options.historyByProduct?.[productId] || [];
  const analysis = analyzeNiche(product, {
    marketplaceId: marketplace.id,
    country,
    budget,
    observed,
    history,
    now: options.now,
    price: observed?.priceMedian,
  });
  analysis.observedLive = Boolean(observed);
  return {
    rank: 1,
    productId: product.id,
    product: product.name,
    category: product.category,
    demand: analysis.demand.score,
    competition: analysis.competition.score,
    competitionBand: analysis.competition.band,
    profit: analysis.profit?.unit?.estimatedProfit ?? null,
    margin: analysis.profit?.unit?.profitMargin ?? null,
    trend: analysis.trend.score,
    trendBand: analysis.trend.band,
    opportunity: analysis.opportunity.score,
    opportunityLabel: analysis.opportunity.label,
    confidence: analysis.opportunity.confidence.label,
    blockers: analysis.opportunity.blockers.length,
    observed: analysis.observedLive,
    analysis,
  };
}

/** FIND MY WINNING PRODUCT - one and only one recommendation. */
export function findWinner(options = {}) {
  const scan = scanMarket(options);
  const ranked = scan.rows;
  if (!ranked.length) {
    return {
      winner: null,
      runnersUp: [],
      error: 'No candidate niches matched the selected category. Try "Any category".',
      scan,
    };
  }

  const [winner, ...rest] = ranked;
  const runnerUp = rest[0] || null;
  const observedWinner = Boolean(winner.observed);

  return {
    winner,
    runnerUp,
    alternatives: rest.slice(0, 4),
    scan,
    meta: {
      foundAt: Date.now(),
      candidatesEvaluated: scan.total,
      marketplace: scan.marketplace,
      category: scan.category,
      country: scan.country,
      budget: scan.budget,
      winnerConfidence: winner.confidence,
      basis: observedWinner ? BASIS.OBSERVED : BASIS.SNAPSHOT,
      assumptions: [
        `Prices, costs and fees are estimates for ${scan.marketplace?.name || 'the selected marketplace'}; confirm with live quotes.`,
        'Sales volume is inferred from review activity, never counted directly.',
        'Search volume is not claimed anywhere - the extension cannot verify it without an authorized data source.',
        'Rankings change as soon as you scan a live search page; observed signals override the snapshot for 30 days.',
      ],
      confidenceMeaning: {
        High: 'Backed by numbers read from a public page in your browser.',
        Medium: 'From the public-data snapshot or a published fee schedule.',
        Low: 'Modelled from assumptions - verify before investing.',
      },
    },
  };
}

export const allNiches = () => CATALOG;
