/**
 * risk.js - the "is this actually a trap?" layer.
 *
 * A high opportunity score is worthless if the product cannot legally be sold,
 * is structurally unprofitable at the price buyers expect, or is being given
 * away free by 40 other sellers. Risks are surfaced BEFORE the opportunity
 * verdict in the report, and they feed a bounded penalty into the score.
 */

import { clamp01, round } from './metrics.js';

export const RISK_CATALOG = {
  ip: {
    id: 'ip',
    label: 'Intellectual-property risk',
    severity: 'high',
    advice: 'Use only original artwork/designs you own or licence in writing. Never ship licensed characters or brand names.',
  },
  saturation: {
    id: 'saturation',
    label: 'Saturated category',
    advice: 'Differentiate with a bundle, service or packaging angle - competing on price alone will not work.',
    severity: 'high',
  },
  seasonality: {
    id: 'seasonality',
    label: 'Seasonal demand',
    advice: 'Plan cash flow around the peak window and build the listing history 6-8 weeks early.',
    severity: 'medium',
  },
  compliance: {
    id: 'compliance',
    label: 'Product compliance / safety',
    advice: 'Check local toy, electronics, textile or cosmetic rules. Keep test reports and paperwork.',
    severity: 'high',
  },
  shipping: {
    id: 'shipping',
    label: 'Shipping cost & damage risk',
    advice: 'Weigh real samples, price shipping into the sale price, and test your packaging before scaling.',
    severity: 'medium',
  },
  returns: {
    id: 'returns',
    label: 'Returns / personalization errors',
    advice: 'Add a proof-before-production step and publish an unmistakable size/colour guide.',
    severity: 'medium',
  },
  marginThin: {
    id: 'marginThin',
    label: 'Thin unit margin',
    advice: 'Current estimates leave little room for ads and returns. Raise the price with added value, cut landed cost, or pick another niche.',
    severity: 'high',
  },
  lowTicket: {
    id: 'lowTicket',
    label: 'Low ticket price',
    advice: 'Cheap items need volume and bundles to be worth the effort. Consider a multi-pack or a higher-value variation.',
    severity: 'medium',
  },
  labour: {
    id: 'labour',
    label: 'Labour-intensive production',
    advice: 'Hand-making takes real hours per unit. Price your time into the product or plan a supplier/handmade-partner route before scaling.',
    severity: 'medium',
  },
  general: {
    id: 'general',
    label: 'Product-specific note',
    advice: 'This niche carries its own caveat - read it before ordering anything.',
    severity: 'low',
  },
  platformRules: {
    id: 'platformRules',
    label: 'Marketplace rules',
    advice: 'Check the marketplace’s handmade / personalization / dropshipping policies before listing.',
    severity: 'medium',
  },
  digitalPiracy: {
    id: 'digitalPiracy',
    label: 'Copyable digital product',
    advice: 'Digital files are resold and shared. Price for volume, add a bonus bundle or licence tier, and expect refund requests.',
    severity: 'medium',
  },
  demandUnproven: {
    id: 'demandUnproven',
    label: 'Demand not observed yet',
    advice: 'Run SCAN MARKET on the live search page twice - if reviews and sales labels move, the demand is real.',
    severity: 'medium',
  },
};

const KEYWORDS = {
  ip: /\b(ip|licen[cs]|copyright|character|anime|trademark|brand)\b/i,
  saturation: /\b(saturated|saturation|crowded|race to the bottom|late|commodity|hyper)\b/i,
  seasonality: /\b(seasonal|season)\b/i,
  compliance: /\b(compliance|safety|testing|ceramic|food|cosmetic|battery|electronic|child|toy)\b/i,
  shipping: /\b(shipping|break|fragile|weight|damage|glass)\b/i,
  returns: /\b(return|refund|exchange|proof|personaliz)/i,
  labour: /\b(labour|labor|intensive|hours?|by hand|sewing|skill)\b/i,
};

/** Derive the risk list for a niche from the catalog + computed signals. */
export function assessRisks(product, ctx = {}) {
  const found = new Map();

  const add = (key, detail) => {
    const base = RISK_CATALOG[key];
    if (!base) return;
    if (found.has(key)) {
      if (detail) found.get(key).details.push(detail);
      return;
    }
    found.set(key, { ...base, details: detail ? [detail] : [] });
  };

  for (const risk of product?.risks || []) {
    const text = String(risk);
    let matched = false;
    for (const [key, re] of Object.entries(KEYWORDS)) {
      if (re.test(text)) {
        add(key, text);
        matched = true;
      }
    }
    if (!matched) add('general', text);
  }

  const competition = ctx.competitionScore;
  if (Number.isFinite(competition)) {
    if (competition >= 78) add('saturation', `Competition scores ${Math.round(competition)}/100 - the visible ranking is heavily defended.`);
    else if (competition >= 62) add('saturation', `Competition scores ${Math.round(competition)}/100 - expect a real fight for page-one placement.`);
  }

  if (product?.digital) {
    add('digitalPiracy', 'A digital or printable version of this product can be copied and resold by anyone who buys it once.');
  }

  const margin = ctx.margin;
  if (Number.isFinite(margin)) {
    if (margin <= 0) {
      add('marginThin', `Estimated margin is ${Math.round(margin * 100)}% on the recommended route - the product loses money at the current price and cost.`);
    } else if (margin < 0.2) {
      add('marginThin', `Estimated margin of ${Math.round(margin * 100)}% leaves almost no room for ads and returns.`);
    } else if (margin < 0.32) {
      add('marginThin', `Estimated margin of ${Math.round(margin * 100)}% is workable but tight.`);
    }
  }

  const price = ctx.price;
  if (Number.isFinite(price) && price < 12) {
    add('lowTicket', `Average price of $${price.toFixed(2)} means shipping and fees eat a large share of each sale.`);
  }

  if (ctx.demandConfidence === 'Low' || (Number.isFinite(ctx.demandScore) && ctx.demandScore < 45)) {
    add('demandUnproven', 'Demand relies on snapshot signals for this niche - scan the live search page to confirm.');
  }

  const seasonPeaks = product?.trend?.seasonPeakMonths || [];
  const seasonOff = ctx.seasonality?.id === 'off-season';
  if (seasonPeaks.length && seasonOff) {
    add('seasonality', `Peak months are ${(ctx.seasonality?.peakMonths || []).join(', ')} - you are currently outside the buying window.`);
  }

  // A non-positive margin is not "a bit tight", it is a deal-breaker.
  if (Number.isFinite(ctx.margin) && ctx.margin <= 0 && found.has('marginThin')) {
    found.get('marginThin').severity = 'high';
  }
  const risks = [...found.values()];
  const severityWeight = { high: 1, medium: 0.55, low: 0.25 };
  const totalWeight = risks.reduce((acc, r) => acc + (severityWeight[r.severity] || 0.4), 0);
  const penalty = clamp01(totalWeight * 0.035) * 22; // up to 22 points off the opportunity score

  return {
    risks,
    penalty: round(penalty, 1),
    level: penalty >= 12 ? 'High' : penalty >= 6 ? 'Medium' : penalty > 0 ? 'Low' : 'None',
    hasHighRisk: risks.some((r) => r.severity === 'high'),
    counts: {
      high: risks.filter((r) => r.severity === 'high').length,
      medium: risks.filter((r) => r.severity === 'medium').length,
    },
  };
}

/** Beginner suitability: how well the niche fits a first-time seller. */
export function beginnerFit(product, ctx = {}) {
  const base = Number.isFinite(product?.beginnerFriendly) ? product.beginnerFriendly : 0.5;
  let score = base * 100;
  const reasons = [];

  if (Number.isFinite(ctx.competitionScore)) {
    if (ctx.competitionScore <= 35) { score += 6; reasons.push('Competition is low enough to rank without paid ads.'); }
    else if (ctx.competitionScore >= 70) { score -= 10; reasons.push('Competition is high - ranking will likely need ad spend.'); }
  }
  if (Number.isFinite(ctx.margin)) {
    if (ctx.margin >= 0.45) { score += 5; reasons.push('Healthy margin absorbs beginner mistakes.'); }
    else if (ctx.margin < 0.28) { score -= 6; reasons.push('Tight margin leaves little room for error.'); }
  }
  if (ctx.startableOnBudget) reasons.push('Starting route fits inside the selected budget with no inventory.');
  else if (ctx.startableOnBudget === false) reasons.push('Cheapest route still exceeds the selected budget.');
  if (ctx.riskLevel === 'High') { score -= 12; reasons.push('Risk flags are significant - review them before ordering.'); }
  if (product?.digital) { score += 3; reasons.push('A zero-inventory digital version exists, which de-risks the first month.'); }

  const value = Math.max(0, Math.min(100, score));
  return {
    score: Math.round(value),
    label: value >= 75 ? 'Great for beginners' : value >= 55 ? 'Manageable for beginners' : 'Better for experienced sellers',
    reasons,
  };
}
