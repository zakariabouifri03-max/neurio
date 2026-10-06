/**
 * sourcing.js - turns a niche + market hypothesis into a sourcing plan.
 *
 * Cost inputs come from two clearly separated places:
 *   1. The niche's family band (data/suppliers.js) - modelled wholesale ranges.
 *   2. The supplier platform factor - how much that platform typically adds.
 * Both are estimates. `basis` and `confidence` travel with every row so the UI
 * can label them and the "verify before you pay" checklist can be shown.
 */

import { BASIS, round, clamp } from './metrics.js';
import { FAMILIES, getFamily, moqFor, suppliersForFamily } from '../data/suppliers.js';

const round2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

/**
 * Landed unit cost for one sourcing route.
 *
 * The niche's own cost band is the baseline (it already reflects what the item
 * costs to make/buy at small scale), and the supplier platform factor describes
 * how that platform typically shifts it - bulk import is cheaper, POD is more
 * expensive. Family bands are the fallback when a niche has no cost data.
 *
 * @param {object|string} productOrFamily niche object ({cost, family}) or family id
 * @returns {{unitLow:number, unitHigh:number, shippingLow:number, shippingHigh:number, landedLow:number, landedHigh:number}}
 */
export function landedUnitCost(productOrFamily, supplier) {
  const isProduct = productOrFamily && typeof productOrFamily === 'object';
  const family = getFamily(isProduct ? productOrFamily.family : productOrFamily);
  const base = isProduct && Number.isFinite(productOrFamily?.cost?.unitLow)
    ? {
      unit: [productOrFamily.cost.unitLow, productOrFamily.cost.unitHigh ?? productOrFamily.cost.unitLow],
      shipping: [productOrFamily.cost.inboundLow ?? 0, productOrFamily.cost.inboundHigh ?? productOrFamily.cost.inboundLow ?? 0],
    }
    : { unit: family.unitCost, shipping: family.shipping };

  const factor = Number.isFinite(supplier?.costFactor) ? supplier.costFactor : 1;
  const shipFactor = Number.isFinite(supplier?.shippingFactor) ? supplier.shippingFactor : 1;
  const unit = base.unit.map((v) => v * factor);
  const ship = base.shipping.map((v) => v * shipFactor);
  return {
    unitLow: round2(unit[0]),
    unitHigh: round2(unit[1]),
    shippingLow: round2(ship[0]),
    shippingHigh: round2(ship[1]),
    landedLow: round2(unit[0] + ship[0]),
    landedHigh: round2(unit[1] + ship[1]),
  };
}

/**
 * Build every viable sourcing option for a niche.
 *
 * @param {object} product  catalog niche
 * @param {object} ctx      { price, feesPerUnit, marketplaceName, budget:{max}, monthlyUnits }
 */
export function buildSourcingPlan(product, ctx = {}) {
  const family = getFamily(product.family);
  const price = ctx.price;
  const fees = Number.isFinite(ctx.feesPerUnit) ? ctx.feesPerUnit : 0;
  const budgetMax = Number.isFinite(ctx.budget?.max) ? ctx.budget.max : Infinity;
  const suppliers = suppliersForFamily(product.family, { includeDigital: product.digital || family.digitalCapable });

  const rows = suppliers.map((supplier) => {
    const cost = landedUnitCost(product, supplier);
    const moq = moqFor(supplier, product.family);
    const firstOrderCost = round2(Math.max(moq, 1) * cost.unitHigh + (moq > 1 ? cost.shippingHigh : cost.shippingHigh));
    const marginPerUnit = Number.isFinite(price) ? round2(price - cost.landedHigh - fees) : null;
    const marginRate = Number.isFinite(marginPerUnit) && price > 0 ? marginPerUnit / price : null;
    const affordable = firstOrderCost <= budgetMax;
    return {
      id: supplier.id,
      supplier: supplier.name,
      icon: supplier.icon,
      type: supplier.type,
      productQuery: supplier.queryFor(product),
      unitCost: [cost.unitLow, cost.unitHigh],
      shippingPerUnit: [cost.shippingLow, cost.shippingHigh],
      landedCost: [cost.landedLow, cost.landedHigh],
      moq,
      firstOrderCost,
      leadTimeDays: supplier.leadTime,
      sellingPrice: Number.isFinite(price) ? round2(price) : null,
      estimatedProfitPerUnit: marginPerUnit,
      estimatedMargin: Number.isFinite(marginRate) ? round(marginRate, 3) : null,
      link: supplier.searchUrl(supplier.queryFor(product), ctx.countryLabel),
      inventoryRisk: supplier.inventoryRisk,
      bestFor: supplier.bestFor,
      watchOut: supplier.watchOut,
      withinBudget: affordable,
      basis: supplier.basis,
      dueDiligence: 'Public platform search. Verify the live quote, MOQ and shipping before ordering.',
      confidence: 'Low',
    };
  });

  const isDigitalProduct = ['digital-pattern', 'digital-art'].includes(product.family);
  const ranked = [...rows].sort((a, b) => {
    const score = (r) => {
      const margin = Number.isFinite(r.estimatedProfitPerUnit) ? r.estimatedProfitPerUnit : -999;
      const budgetBonus = r.withinBudget ? 6 : -6;
      const riskBonus = r.inventoryRisk === 'none' || r.inventoryRisk === 'very low' ? 3 : r.inventoryRisk === 'low' ? 1.5 : 0;
      // The digital route is a different product (the file, not the physical
      // item), so it is offered as an alternative unless the niche IS digital.
      const physicalPenalty = r.id === 'digital-alternative' && !isDigitalProduct ? -8 : 0;
      const podPenalty = ['printful', 'printify'].includes(r.id) ? -1.5 : 0;
      // A big first order is a bigger bet: for small budgets prefer the routes
      // that let the user test with one or two units.
      const commitmentPenalty = budgetMax <= 500 && r.moq > 25 ? 6 : 0;
      return margin + budgetBonus + riskBonus + physicalPenalty + podPenalty + commitmentPenalty
        - (r.moq > 1 ? Math.min(4, r.moq / 50) : 0);
    };
    return score(b) - score(a);
  });

  // The digital route creates a *different* product (a file instead of the
  // physical item), so it never becomes the headline "source it here" route
  // unless the niche itself is a digital product.
  const physical = ranked.filter((r) => r.id !== 'digital-alternative');
  const recommended = isDigitalProduct
    ? (ranked.find((r) => r.withinBudget) || ranked[0] || null)
    : (physical.find((r) => r.withinBudget) || physical[0] || ranked[0] || null);
  const digitalAlternative = ranked.find((r) => r.id === 'digital-alternative') || null;

  return {
    family: { id: product.family, ...family },
    rows: ranked,
    recommended,
    digitalAlternative,
    isDigitalProduct,
    alternatives: ranked.filter((r) => r.id !== recommended?.id && r.id !== 'digital-alternative').slice(0, 3),
    basis: BASIS.MODELLED,
    note: 'All costs are estimated planning ranges based on publicly listed wholesale prices - request a live quote before committing.',
  };
}

/**
 * Turn a per-unit fee figure into the profit breakdown the UI shows.
 * Keeps the arithmetic in one place so the calculator tab and the report always
 * agree with each other.
 */
export function profitBreakdown({ price, landedCost, fees }) {
  const revenue = Number.isFinite(price) ? price : null;
  const totalCost = Number.isFinite(landedCost) ? landedCost : null;
  const fee = Number.isFinite(fees) ? fees : 0;
  if (revenue == null || totalCost == null) return null;
  const profit = revenue - totalCost - fee;
  return {
    sellingPrice: round2(revenue),
    productCost: round2(totalCost),
    fees: round2(fee),
    estimatedProfit: round2(profit),
    profitMargin: revenue ? round(profit / revenue, 4) : null,
    roi: totalCost + fee > 0 ? round(profit / (totalCost + fee), 4) : null,
  };
}

/** Monthly projection with an honest range instead of one fake number. */
export function projectMonthly(unitProfit, units, { lowFactor = 0.75, highFactor = 1.2 } = {}) {
  if (!Number.isFinite(unitProfit) || !Number.isFinite(units)) return null;
  const base = unitProfit * units;
  return {
    base: round2(base),
    low: round2(base * lowFactor),
    high: round2(base * highFactor),
  };
}

/** Budget fit for the whole niche, used by the "can I even start?" explainer. */
export function budgetFit(product, budget, sourcingPlan) {
  if (!budget) return null;
  const cheapest = sourcingPlan?.rows
    ?.filter((r) => r.firstOrderCost != null)
    .sort((a, b) => a.firstOrderCost - b.firstOrderCost)[0];
  const riskiest = sourcingPlan?.rows
    ?.filter((r) => r.firstOrderCost != null)
    .sort((a, b) => b.firstOrderCost - a.firstOrderCost)[0];
  const startable = Boolean(cheapest && cheapest.firstOrderCost <= (budget.max ?? Infinity));
  return {
    startable,
    cheapestRoute: cheapest || null,
    bulkRoute: riskiest || null,
    budgetLabel: budget.label,
    hint: startable
      ? `${budget.inventoryHint} Lowest-commitment route: ${cheapest.supplier} (${cheapest.moq} unit minimum, estimated ${fmt(cheapest.firstOrderCost)} first order).`
      : `The selected budget (${budget.label}) is below the lowest first-order estimate (${cheapest ? fmt(cheapest.firstOrderCost) : 'n/a'}). Use the digital or print-on-demand alternative, or raise the budget.`,
    confidence: 'Low',
  };
}

const fmt = (v) => (Number.isFinite(v) ? `$${Math.round(v).toLocaleString('en-US')}` : '—');

/** Estimated inventory depth the budget can buy (used in the beginner checklist). */
export function inventoryDepth(product, budget) {
  const family = FAMILIES[product.family] || FAMILIES['hard-goods'];
  const unitCost = family.unitCost[1];
  if (!budget || !Number.isFinite(unitCost) || unitCost <= 0) return null;
  const units = Math.floor((budget.max * 0.75) / unitCost);
  return { units: clamp(units, 0, 100000), unitCostEstimate: unitCost, basis: BASIS.MODELLED };
}
