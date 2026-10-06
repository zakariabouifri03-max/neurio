/**
 * report.js - turns an analysis into the storable / exportable deliverable.
 *
 * The report is deliberately plain JSON (no class instances, no functions) so it
 * can live in chrome.storage.local, be exported as a .json backup, or be copied
 * as Markdown into a notes app.
 */

import { formatReport } from './format-report.js';

export const REPORT_VERSION = 3;

export function buildReport(winnerResult, options = {}) {
  const analysis = winnerResult?.winner?.analysis;
  if (!analysis) return null;

  const {
    product, demand, competition, trend, profit, sourcing, marketFit, channels,
    risks, beginner, ideaPack, opportunity, budgetFit, why, verdict, chosenRoute,
  } = analysis;

  return {
    version: REPORT_VERSION,
    id: `report-${product.id}-${Date.now()}`,
    createdAt: Date.now(),
    selection: {
      category: options.category || 'Any category',
      marketplace: options.marketplace || analysis.marketplace.name,
      country: options.country || 'United States',
      budget: options.budget || 'Any budget',
    },
    product: {
      id: product.id,
      name: product.name,
      category: product.category,
      emoji: product.emoji,
      blurb: product.blurb,
      family: product.family,
      digital: Boolean(product.digital),
      risks: product.risks || [],
      differentiation: product.differentiation || [],
    },
    scores: {
      demand: demand.score,
      competition: competition.score,
      profit: opportunity.metrics.find((m) => m.id === 'profit')?.value ?? null,
      trend: trend.score,
      opportunity: opportunity.score,
      label: opportunity.label,
      raw: opportunity.rawScore,
      riskPenalty: opportunity.riskPenalty,
    },
    confidence: {
      overall: opportunity.confidence.label,
      demand: demand.confidence.label,
      competition: competition.confidence.label,
      trend: trend.confidence,
      profit: profit?.confidence?.label || 'Low',
      sourcing: 'Low',
    },
    demand: {
      score: demand.score,
      label: demand.label,
      reasons: demand.reasons,
      metrics: demand.metrics,
      contributors: demand.contributors,
      missing: demand.missing,
      volume: demand.volume,
      note: demand.note,
    },
    competition: {
      score: competition.score,
      band: competition.band,
      summary: competition.summary,
      metrics: competition.metrics,
      contributors: competition.contributors,
      missing: competition.missing,
      note: competition.note,
    },
    trend: {
      score: trend.score,
      band: trend.band,
      windows: trend.windows,
      seasonality: trend.seasonality,
      spark: trend.spark,
      basis: trend.basis,
      confidence: trend.confidence,
      historyUsed: trend.historyUsed,
      note: trend.note,
    },
    marketFit: {
      best: marketFit.best,
      rows: marketFit.rows,
      runnersUp: marketFit.runnersUp,
      note: marketFit.note,
    },
    profit: profit && {
      marketplace: profit.marketplace,
      price: profit.price,
      priceBasis: profit.priceBasis,
      unit: profit.unit,
      fees: profit.fees,
      priceBands: profit.priceBands,
      monthly: profit.monthly,
      monthlyAtTarget: profit.monthlyAtTarget,
      targetUnits: profit.targetUnits,
      notes: profit.notes,
      feeSource: profit.feeSource,
      confidence: profit.confidence,
    },
    sourcing: {
      family: sourcing.family,
      rows: sourcing.rows,
      recommended: sourcing.recommended,
      alternatives: sourcing.alternatives,
      note: sourcing.note,
      dueDiligence: sourcing.dueDiligence,
    },
    chosenRoute: chosenRoute || null,
    channels: {
      best: channels.best,
      secondary: channels.secondary,
      rows: channels.rows,
      note: channels.note,
    },
    risks: {
      level: risks.level,
      penalty: risks.penalty,
      risks: risks.risks,
      counts: risks.counts,
    },
    beginner,
    ideaPack,
    budgetFit,
    why,
    opportunity: {
      score: opportunity.score,
      label: opportunity.label,
      confidence: opportunity.confidence,
      components: opportunity.components,
      metrics: opportunity.metrics,
      // adjustments travels with the report so a reopened report still explains
      // exactly which points were deducted and why.
      adjustments: opportunity.adjustments,
      blockers: opportunity.blockers,
      riskPenalty: opportunity.riskPenalty,
      rawScore: opportunity.rawScore,
      weights: opportunity.weights,
      note: opportunity.note,
    },
    verdict: verdict || null,
    meta: winnerResult.meta,
  };
}

export function reportToMarkdown(report) {
  return formatReport(report);
}

/** Compact one-line summary for lists / notifications. */
export const reportSummary = (report) =>
  report
    ? `${report.product.name} - opportunity ${report.scores.opportunity}/100 (demand ${report.scores.demand}, competition ${report.scores.competition}, trend ${report.scores.trend}) on ${report.marketFit.best?.name || 'n/a'}`
    : 'No report';
