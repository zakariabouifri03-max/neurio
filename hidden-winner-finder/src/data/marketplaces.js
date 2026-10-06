/**
 * marketplaces.js - where the product can be sold, plus the fee model used by
 * the profit calculator and the URL builders used by every "view / open" button.
 *
 * All fee numbers are taken from the public fee-schedule pages that each
 * marketplace publishes. They are category-dependent, change over time and are
 * therefore labelled as estimates in the UI. `feeSource` records the origin so
 * the About tab can point users at the official schedules to verify.
 */

export const FEE_DISCLAIMER =
  'Fee schedule published by the marketplace. Category-dependent and can change - verify on the official seller page.';

export const MARKETPLACES = [
  {
    id: 'etsy',
    name: 'Etsy',
    icon: '🧶',
    color: '#f1641e',
    domains: ['etsy.com'],
    audience: 'Gift buyers, decor + personalized shoppers',
    bestFor: ['personalized', 'handmade', 'digital-download', 'gifts', 'decor', 'jewelry'],
    feeRate: 0.065,
    paymentRate: 0.03,
    paymentFixed: 0.25,
    listingFee: 0.2,
    adsAllowance: 0.08,
    returnsAllowance: 0.01,
    monthlyPlatformFee: 0,
    assumedMonthlyUnits: 100,
    feeSource: 'https://www.etsy.com/legal/fees/',
    sellerUrl: 'https://www.etsy.com/sell',
    notes: 'Listing fee $0.20 per listing (4 months). Offsite Ads can add 12-15% when a sale is attributed.',
    searchUrl: (q) => `https://www.etsy.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'amazon',
    name: 'Amazon',
    icon: '📦',
    color: '#ff9900',
    domains: ['amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.ca', 'amazon.com.au'],
    audience: 'Intent-driven buyers, Prime shoppers',
    bestFor: ['utility', 'repeat-purchase', 'kit', 'consumer-goods', 'home', 'pet'],
    feeRate: 0.15,
    paymentRate: 0,
    paymentFixed: 0,
    listingFee: 0,
    adsAllowance: 0.1,
    returnsAllowance: 0.03,
    monthlyPlatformFee: 0,
    assumedMonthlyUnits: 100,
    feeSource: 'https://sell.amazon.com/pricing',
    sellerUrl: 'https://sell.amazon.com',
    notes: 'Referral fee is category-dependent (8-15%). FBA fulfilment, storage and returns are NOT included here.',
    searchUrl: (q) => `https://www.amazon.com/s?k=${encodeURIComponent(q)}`,
  },
  {
    id: 'ebay',
    name: 'eBay',
    icon: '🏷️',
    color: '#e53238',
    domains: ['ebay.com', 'ebay.co.uk', 'ebay.de'],
    audience: 'Deal hunters, collectors, replacement buyers',
    bestFor: ['collectible', 'bundle', 'parts', 'utility', 'vintage'],
    feeRate: 0.1325,
    paymentRate: 0,
    paymentFixed: 0.3,
    listingFee: 0,
    adsAllowance: 0.06,
    returnsAllowance: 0.02,
    monthlyPlatformFee: 0,
    assumedMonthlyUnits: 100,
    feeSource: 'https://www.ebay.com/help/selling/fees-credits-invoices/store-selling-fees',
    sellerUrl: 'https://www.ebay.com/sl/sell',
    notes: 'Final value fee ~13.25% for most categories on the first $7,500 per order, plus $0.30 per order.',
    searchUrl: (q) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}`,
  },
  {
    id: 'walmart',
    name: 'Walmart Marketplace',
    icon: '🛒',
    color: '#0071ce',
    domains: ['walmart.com'],
    audience: 'Value-focused mass-market shoppers',
    bestFor: ['household', 'bulk', 'utility', 'seasonal', 'toys'],
    feeRate: 0.15,
    paymentRate: 0,
    paymentFixed: 0,
    listingFee: 0,
    adsAllowance: 0.08,
    returnsAllowance: 0.03,
    monthlyPlatformFee: 0,
    assumedMonthlyUnits: 100,
    feeSource: 'https://marketplace.walmart.com/',
    sellerUrl: 'https://marketplace.walmart.com',
    notes: 'Referral fee is category-dependent (6-20%, 15% is the common default). WFS fees are not included.',
    searchUrl: (q) => `https://www.walmart.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'tiktok',
    name: 'TikTok Shop',
    icon: '🎵',
    color: '#25f4ee',
    domains: ['tiktok.com', 'shop.tiktok.com'],
    audience: 'Impulse buyers reached through short video',
    bestFor: ['viral-gadget', 'beauty', 'novelty', 'fashion-accessory', 'demo-able'],
    feeRate: 0.06,
    paymentRate: 0.029,
    paymentFixed: 0.3,
    listingFee: 0,
    adsAllowance: 0.12,
    returnsAllowance: 0.041,
    monthlyPlatformFee: 0,
    assumedMonthlyUnits: 100,
    feeSource: 'https://seller-us.tiktok.com/university',
    sellerUrl: 'https://seller-us.tiktok.com',
    notes: 'Commission rate is category/region-dependent (often 2-8% during promotions). Return rate for impulse buys is high.',
    searchUrl: (q) => `https://www.tiktok.com/search?q=${encodeURIComponent(q)}`,
  },
  {
    id: 'shopify',
    name: 'Own store (Shopify)',
    icon: '🛍️',
    color: '#95bf47',
    domains: ['myshopify.com'],
    audience: 'Brand builders driving their own traffic',
    bestFor: ['brandable', 'subscription', 'premium', 'bundle', 'marketing-driven'],
    feeRate: 0,
    paymentRate: 0.029,
    paymentFixed: 0.3,
    listingFee: 0,
    adsAllowance: 0.14,
    returnsAllowance: 0.02,
    monthlyPlatformFee: 39,
    assumedMonthlyUnits: 100,
    feeSource: 'https://www.shopify.com/pricing',
    sellerUrl: 'https://www.shopify.com',
    notes: 'No marketplace commission, but you pay for traffic. Basic plan is assumed at $39/mo spread across 100 units.',
    searchUrl: (q) => `https://www.google.com/search?q=${encodeURIComponent(`${q} site:myshopify.com`)}`,
  },
];

export const MARKETPLACE_IDS = MARKETPLACES.map((m) => m.id);

export const getMarketplace = (id) =>
  MARKETPLACES.find((m) => m.id === id) || MARKETPLACES[0];

export const getMarketplaceByHost = (hostname) => {
  const host = String(hostname || '').replace(/^www\./, '').toLowerCase();
  return MARKETPLACES.find((m) => m.domains.some((d) => host === d || host.endsWith(`.${d}`))) || null;
};

export const isKnownMarketplaceHost = (hostname) => Boolean(getMarketplaceByHost(hostname));

/**
 * Per-unit marketplace cost for a given price. `unitContext` lets the profit
 * calculator spread fixed platform fees (e.g. Shopify's monthly plan).
 */
export function estimateFees(marketplace, price, unitContext = {}) {
  if (!marketplace || !Number.isFinite(price) || price <= 0) return null;
  const units = Number.isFinite(unitContext.monthlyUnits) && unitContext.monthlyUnits > 0
    ? unitContext.monthlyUnits
    : marketplace.assumedMonthlyUnits || 100;
  const commission = price * marketplace.feeRate;
  const payment = price * marketplace.paymentRate + (marketplace.paymentFixed || 0);
  const listing = marketplace.listingFee || 0;
  const platform = (marketplace.monthlyPlatformFee || 0) / units;
  const adsRate = Number.isFinite(unitContext.adsRate) ? unitContext.adsRate : marketplace.adsAllowance;
  const ads = price * adsRate;
  const returns = price * (marketplace.returnsAllowance || 0);
  const total = commission + payment + listing + platform + ads + returns;
  return {
    commission: round2(commission),
    payment: round2(payment),
    listing: round2(listing),
    platform: round2(platform),
    ads: round2(ads),
    returns: round2(returns),
    total: round2(total),
    effectiveRate: price ? total / price : null,
    breakdownRates: {
      commission: marketplace.feeRate,
      payment: marketplace.paymentRate,
      ads: adsRate,
      returns: marketplace.returnsAllowance || 0,
    },
  };
}

const round2 = (value) => (Number.isFinite(value) ? Math.round(value * 100) / 100 : null);

/** Where to look at the product on a given marketplace. */
export const productSearchUrl = (marketplaceId, query) => {
  const mp = getMarketplace(marketplaceId);
  return mp.searchUrl(query);
};

export const competitorSearchUrl = (marketplaceId, query) => {
  const mp = getMarketplace(marketplaceId);
  // Competitor view = the same query sorted/ranked as the marketplace defaults to.
  return mp.searchUrl(query);
};
