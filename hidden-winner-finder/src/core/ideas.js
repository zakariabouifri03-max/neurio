/**
 * ideas.js - the creative layer: variations, angles, audiences, titles,
 * keywords and a suggested price range for the winning product.
 *
 * The catalog holds the hand-written ideas per niche (they are specific and
 * useful); this module adapts them to the user's chosen marketplace/price and
 * generates the title/keyword set with the marketplace's own search behaviour
 * in mind.
 */

import { clamp, round } from './metrics.js';

const STOP = new Set(['a', 'an', 'the', 'for', 'with', 'and', 'of', 'to', 'in', 'on']);

/** Build 5 titles per marketplace style. */
export function buildTitles(product, ctx = {}) {
  const marketplace = ctx.marketplaceId || 'etsy';
  const price = ctx.price;
  const keywords = product.ideas?.keywords || [];
  const variations = product.ideas?.variations || [];
  const audiences = product.ideas?.audiences || [];
  const [k1 = product.name.toLowerCase(), k2 = `${product.name.toLowerCase()} gift`, k3 = `personalized ${product.name.toLowerCase()}`] = keywords;
  const audience = (audiences[0] || 'gift buyers').toLowerCase();
  const variation = (variations[0] || 'classic').toLowerCase();

  const etsyStyle = [
    `${titleCase(product.name)} | ${titleCase(variation)} ${titleCase(k2)} | Fast Personalized Gift`,
    `Custom ${titleCase(product.name)} - ${titleCase(k3)} for ${titleCase(audience)}`,
    `${titleCase(product.name)} Bundle | ${titleCase(k1)} + Gift Box | Made to Order`,
    `Personalized ${titleCase(product.name)} Gift for ${titleCase(audience)} | Ships in 48h`,
    `${titleCase(k3)} | ${titleCase(product.name)} with Free Proof Before Production`,
  ];

  const amazonStyle = [
    `${product.name}, Custom ${variation} Version, Gift-Ready Packaging, ${audiences[0] || 'Gift'} Idea`,
    `${product.name} - Personalized, Durable, ${price ? `Under $${Math.ceil(price + 5)}` : 'Value Priced'}, 1-Pack`,
    `${product.name} Set with Gift Box and Care Guide - Ideal for ${audiences[0] || 'Gifting'}`,
    `Custom-Made ${product.name} for ${audiences[1] || 'Gift Buyers'} - Fast Dispatch, Easy Returns`,
    `${product.name} (Personalized) + Bonus Guide | Premium ${variation} Design`,
  ];

  const templates = marketplace === 'amazon' || marketplace === 'walmart' ? amazonStyle : etsyStyle;
  return templates.slice(0, 5).map((template, idx) => ({
    marketplace,
    index: idx + 1,
    title: template,
    uses: idx === 0 ? 'Primary listing title' : idx === 1 ? 'A/B test title' : 'Variation or bundle listing',
    note: template.length > 140 ? 'Trim to 140 characters for Etsy' : 'Within title-length limits',
  }));
}

/** 10 keyword ideas split into head/buying/long-tail intent. */
export function buildKeywords(product, ctx = {}) {
  const base = product.ideas?.keywords || [];
  const variations = product.ideas?.variations || [];
  const audiences = product.ideas?.audiences || [];
  const generated = [
    `${product.name.toLowerCase()} for ${(audiences[0] || 'gift').toLowerCase()}`,
    `best ${product.name.toLowerCase()} ${new Date().getFullYear()}`,
    `${(variations[4] || 'custom').toLowerCase()} ${product.name.toLowerCase()}`,
    `${product.name.toLowerCase()} bundle`,
  ];
  const all = [...base, ...generated].map((k) => String(k).toLowerCase().trim()).filter(Boolean);
  const unique = [...new Set(all)];
  const classified = unique.slice(0, 10).map((keyword, idx) => {
    const words = keyword.split(/\s+/).filter((w) => !STOP.has(w)).length;
    const intent = words >= 4 ? 'long-tail' : words === 3 ? 'buying' : 'head';
    return {
      keyword,
      intent,
      where: intent === 'head' ? 'Title + first tag / back-end search term' : intent === 'buying' ? 'Title + tag 2-5' : 'Description, tags and ads',
      priority: idx < 3 ? 'Must-have' : idx < 6 ? 'High' : 'Supporting',
      estVolume: null,
      volumeNote: 'Search volume is not claimed - the extension cannot verify it without an authorized data source.',
    };
  });
  return classified;
}

/** Suggested price range from the cost band + marketplace fees + target margin. */
export function suggestPrice(product, ctx = {}) {
  const costBand = ctx.costBand || [product.cost?.unitLow ?? 0, product.cost?.unitHigh ?? 0];
  const shippingBand = ctx.shippingBand || [product.cost?.inboundLow ?? 0, product.cost?.inboundHigh ?? 0];
  const feeRate = clamp(ctx.feeRate ?? 0.2, 0.02, 0.5);
  const landed = [
    costBand[0] + shippingBand[0],
    costBand[1] + shippingBand[1],
  ];
  const priceFor = (landedCost, margin) => {
    const denom = Math.max(0.05, 1 - feeRate - margin);
    return round(landedCost / denom, 2);
  };
  const entry = priceFor(landed[0], 0.5);
  const target = priceFor(landed[1], 0.55);
  const premium = round(Math.max(target * 1.45, priceFor(landed[1], 0.68)), 2);
  return {
    entry: { price: entry, margin: 0.5, label: 'Entry price - win the first reviews' },
    target: { price: target, margin: 0.55, label: 'Target price - recommended' },
    premium: { price: premium, margin: 0.68, label: 'Premium price - bundle or personalisation upgrade' },
    note: `Computed from an estimated landed cost of $${landed[0].toFixed(2)}-$${landed[1].toFixed(2)} and a ${Math.round(feeRate * 100)}% platform cost. Confirm with a live quote.`,
    basis: 'Modelled from public wholesale ranges and published fee schedules',
  };
}

export function buildIdeaPack(product, ctx = {}) {
  const ideas = product.ideas || {};
  return {
    product: product.name,
    mainProduct: `Personalized ${product.name}`,
    variations: (ideas.variations || []).slice(0, 5),
    angles: (ideas.angles || []).slice(0, 5),
    audiences: (ideas.audiences || []).slice(0, 5),
    titles: buildTitles(product, ctx),
    keywords: buildKeywords(product, ctx),
    priceRange: suggestPrice(product, ctx),
    differentiation: (product.differentiation || []).slice(0, 5),
  };
}

function titleCase(text) {
  return String(text || '')
    .split(/\s+/)
    .map((w) => (w.length > 2 ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}
