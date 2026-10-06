/**
 * profit.js - the profit calculator.
 *
 * Selling price, product cost, shipping, marketplace fees, estimated profit and
 * margin - each one tagged with where it came from:
 *   price      → the niche's public price band (snapshot) or an observed price
 *   cost/ship  → the sourcing route estimate (modelled)
 *   fees       → the marketplace's published fee schedule (modelled, verifiable)
 * Every figure is a planning estimate, never a promise.
 */

import { BASIS, round, clamp } from './metrics.js';
import { estimateFees } from '../data/marketplaces.js';
import { getSupplier } from '../data/suppliers.js';
import { landedUnitCost, profitBreakdown, projectMonthly } from './sourcing.js';

const round2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

/**
 * @param {object} product catalog niche
 * @param {object} ctx     { marketplace, price, supplier, monthlyUnits, observedPrice }
 */
export function computeProfit(product, ctx = {}) {
  const marketplace = ctx.marketplace;
  const priceSource = Number.isFinite(ctx.observedPrice)
    ? { value: ctx.observedPrice, basis: BASIS.OBSERVED }
    : { value: product?.price?.median, basis: BASIS.SNAPSHOT };

  const price = Number.isFinite(ctx.price) ? ctx.price : priceSource.value;
  if (!Number.isFinite(price) || !marketplace) return null;

  // Accept either a full supplier object or just its id, and always resolve it
  // so the cost factor of the recommended sourcing route is actually applied.
  const supplierId = ctx.supplier?.id;
  const supplier = supplierId ? (ctx.supplier?.costFactor != null ? ctx.supplier : getSupplier(supplierId)) : null;
  const costInfo = supplier
    ? landedUnitCost(product, supplier)
    : {
      unitLow: product?.cost?.unitLow ?? null,
      unitHigh: product?.cost?.unitHigh ?? null,
      shippingLow: product?.cost?.inboundLow ?? null,
      shippingHigh: product?.cost?.inboundHigh ?? null,
      landedLow: (product?.cost?.unitLow ?? 0) + (product?.cost?.inboundLow ?? 0),
      landedHigh: (product?.cost?.unitHigh ?? 0) + (product?.cost?.inboundHigh ?? 0),
    };

  const monthlyUnits = Number.isFinite(ctx.monthlyUnits) ? ctx.monthlyUnits : 1;
  const fees = estimateFees(marketplace, price, { monthlyUnits, adsRate: ctx.adsRate });

  // Use the higher end of the landed-cost band as the planning cost: an
  // underestimate on cost is the most common way a "winner" turns out to be a loss.
  const landed = costInfo.landedHigh;
  const breakdown = profitBreakdown({ price, landedCost: landed, fees: fees.total });

  const unit = {
    ...breakdown,
    productCost: round2(costInfo.unitHigh),
    shipping: round2(costInfo.shippingHigh),
    landedCostRange: [costInfo.landedLow, costInfo.landedHigh],
    priceRange: [product?.price?.low ?? null, product?.price?.high ?? null],
    breakEvenUnits: computeBreakEven(price, landed, fees.total, ctx.fixedCosts),
    breakEvenPrice: computeBreakEvenPrice(landed, fees.total),
  };

  // What-if table: the same economics at the low / median / premium price points.
  const priceBands = [product?.price?.low, product?.price?.median, product?.price?.high]
    .filter((v) => Number.isFinite(v))
    .map((p) => {
      const f = estimateFees(marketplace, p, { monthlyUnits, adsRate: ctx.adsRate });
      const b = profitBreakdown({ price: p, landedCost: landed, fees: f.total });
      return { price: round2(p), fees: f.total, profit: b?.estimatedProfit ?? null, margin: b?.profitMargin ?? null };
    });

  const monthly = projectMonthly(breakdown?.estimatedProfit, monthlyUnits);
  const monthlyAtTarget = Number.isFinite(ctx.targetUnits)
    ? projectMonthly(breakdown?.estimatedProfit, ctx.targetUnits)
    : null;

  return {
    id: 'profit',
    marketplace: { id: marketplace.id, name: marketplace.name, icon: marketplace.icon },
    currency: 'USD',
    price,
    priceBasis: priceSource.basis,
    unit,
    fees,
    priceBands,
    monthly,
    monthlyAtTarget,
    targetUnits: ctx.targetUnits ?? null,
    confidence: {
      id: 'Low',
      label: 'Low',
      blurb: 'Fees come from published schedules and costs from public wholesale bands. Confirm both before you commit.',
    },
    basis: BASIS.MODELLED,
    notes: [
      `Fees use ${marketplace.name}'s published schedule (${Math.round((marketplace.feeRate + marketplace.paymentRate) * 100)}% commission+payment, plus platform allowances).`,
      'Product and shipping costs are estimated planning ranges - a live supplier quote replaces them.',
      'Profit is calculated at the top of the cost band, so a real quote usually improves it.',
    ],
    feeSource: marketplace.feeSource,
  };
}

function computeBreakEven(price, landed, fees, fixedCosts) {
  const contribution = price - landed - fees;
  if (!Number.isFinite(contribution) || contribution <= 0) return null;
  const fixed = Number.isFinite(fixedCosts) ? fixedCosts : 0;
  return Math.ceil((fixed + 0) / contribution) || 1;
}

function computeBreakEvenPrice(landed, fees) {
  // Price at which the sale exactly covers cost: price = (cost + fees) / (1 - variableRate)
  const variableRate = 0.3;
  return round2((landed + fees) / (1 - clamp(variableRate, 0, 0.8)));
}

/**
 * Rank sourcing routes by profit *and* feasibility for the user's budget.
 * Returns the rows with the best blended score first.
 */
export function rankRoutesByProfit(product, routes, ctx = {}) {
  const { marketplace, price, budget } = ctx;
  const fees = marketplace ? estimateFees(marketplace, price, { monthlyUnits: ctx.monthlyUnits }).total : 0;
  return [...(routes || [])]
    .map((route) => {
      const landed = route.landedCost?.[1];
      const b = profitBreakdown({ price, landedCost: landed, fees });
      const budgetOk = !budget || route.firstOrderCost <= (budget.max ?? Infinity);
      return { ...route, profit: b, score: (b?.estimatedProfit ?? -999) + (budgetOk ? 5 : -5) };
    })
    .sort((a, b) => b.score - a.score);
}

/** Suggested price band for a niche given costs + target margin. */
export function suggestPriceRange(product, supplier, marketplace, targetMargins = [0.45, 0.6, 0.7]) {
  const cost = landedUnitCost(product, supplier);
  const landed = cost.landedHigh;
  return targetMargins.map((m) => ({
    targetMargin: m,
    price: round2(landed / Math.max(0.05, 1 - m - (marketplace ? marketplace.feeRate + marketplace.paymentRate : 0.15))),
  }));
}
