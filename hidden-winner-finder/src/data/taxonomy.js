/**
 * taxonomy.js - categories, countries, budgets and the data-source registry.
 *
 * The registry is the honest core of the extension: it lists, per signal, where
 * the number can come from and whether the extension actually observed it,
 * estimated it from a public-data snapshot, or modelled it.
 */

export const CATEGORIES = [
  { id: 'any', label: 'Any category', icon: '✨', keywords: [] },
  { id: 'home-decor', label: 'Home & Living', icon: '🏠', keywords: ['home', 'decor', 'wall', 'ornament', 'candle', 'kitchen'] },
  { id: 'jewelry', label: 'Jewelry & Accessories', icon: '💍', keywords: ['necklace', 'bracelet', 'ring', 'jewelry', 'charm', 'earring'] },
  { id: 'pet', label: 'Pet Products', icon: '🐾', keywords: ['pet', 'dog', 'cat', 'puppy', 'kitten', 'leash', 'collar'] },
  { id: 'baby-kids', label: 'Baby & Kids', icon: '🧸', keywords: ['baby', 'kids', 'toddler', 'nursery', 'toy', 'children'] },
  { id: 'apparel', label: 'Apparel & Print on Demand', icon: '👕', keywords: ['shirt', 'hoodie', 'apparel', 'tote', 'hat', 'mug', 'print'] },
  { id: 'beauty', label: 'Beauty & Self-care', icon: '💄', keywords: ['beauty', 'skin', 'hair', 'soap', 'candle', 'spa', 'care'] },
  { id: 'crafts', label: 'Craft Supplies', icon: '🧵', keywords: ['craft', 'supply', 'sticker', 'planner', 'paper', 'svg', 'template'] },
  { id: 'digital', label: 'Digital Products', icon: '💾', keywords: ['digital', 'printable', 'template', 'planner', 'svg', 'ebook', 'course'] },
  { id: 'gadgets', label: 'Gadgets & Novelty', icon: '🔌', keywords: ['gadget', 'led', 'mini', 'portable', 'novelty', 'tech'] },
  { id: 'outdoor', label: 'Outdoor & Garden', icon: '🌿', keywords: ['garden', 'outdoor', 'camping', 'patio', 'plant'] },
  { id: 'sports', label: 'Sports & Fitness', icon: '🏋️', keywords: ['fitness', 'sport', 'gym', 'yoga', 'running', 'bike'] },
];

export const COUNTRIES = [
  { id: 'US', label: 'United States', currency: 'USD', symbol: '$', flag: '🇺🇸' },
  { id: 'GB', label: 'United Kingdom', currency: 'GBP', symbol: '£', flag: '🇬🇧' },
  { id: 'CA', label: 'Canada', currency: 'CAD', symbol: 'CA$', flag: '🇨🇦' },
  { id: 'AU', label: 'Australia', currency: 'AUD', symbol: 'A$', flag: '🇦🇺' },
  { id: 'DE', label: 'Germany', currency: 'EUR', symbol: '€', flag: '🇩🇪' },
  { id: 'FR', label: 'France', currency: 'EUR', symbol: '€', flag: '🇫🇷' },
  { id: 'MA', label: 'Morocco', currency: 'MAD', symbol: 'MAD ', flag: '🇲🇦' },
  { id: 'GLOBAL', label: 'Global / no preference', currency: 'USD', symbol: '$', flag: '🌍' },
];

export const BUDGETS = [
  { id: 'b0-100', label: '$0 – $100', min: 0, max: 100, inventoryHint: 'Validate with samples + digital or POD (no stock).' },
  { id: 'b100-500', label: '$100 – $500', min: 100, max: 500, inventoryHint: 'Small first batch or 3-5 samples plus basic branding.' },
  { id: 'b500-1500', label: '$500 – $1,500', min: 500, max: 1500, inventoryHint: 'First real batch (100-300 units) with a supplier.' },
  { id: 'b1500-plus', label: '$1,500+', min: 1500, max: 50000, inventoryHint: 'Bulk order or private label with custom packaging.' },
  { id: 'any', label: 'Any budget', min: 0, max: Infinity, inventoryHint: 'Matched to the lowest-risk sourcing route first.' },
];

/**
 * Which sourcing routes a budget can realistically unlock.
 * `minUnits` x `unitCost` is compared with the budget's max.
 */
export const SOURCING_ROUTES = [
  { id: 'pod', label: 'Print on demand (no inventory)', minUnits: 1, risk: 'very low' },
  { id: 'dropship', label: 'Dropshipping (no inventory)', minUnits: 1, risk: 'low' },
  { id: 'handmade', label: 'Handmade / small-batch supplier', minUnits: 10, risk: 'low' },
  { id: 'local', label: 'Local manufacturer', minUnits: 25, risk: 'medium' },
  { id: 'bulk', label: 'Bulk import (Alibaba)', minUnits: 100, risk: 'medium' },
  { id: 'digital', label: 'Digital file (zero unit cost)', minUnits: 1, risk: 'very low' },
];

export const CHANNELS = [
  { id: 'etsy-search', label: 'Etsy Search', icon: '🔎', type: 'marketplace', cost: 'Free organic', strengths: ['personalized', 'handmade', 'gifts', 'decor', 'digital-download'] },
  { id: 'amazon-search', label: 'Amazon Search', icon: '📦', type: 'marketplace', cost: 'Free organic + PPC', strengths: ['utility', 'consumer-goods', 'pet', 'home', 'kit'] },
  { id: 'pinterest', label: 'Pinterest', icon: '📌', type: 'social-search', cost: 'Free organic', strengths: ['decor', 'gift', 'wedding', 'seasonal', 'printable', 'jewelry'] },
  { id: 'tiktok', label: 'TikTok', icon: '🎵', type: 'social', cost: 'Free organic + paid', strengths: ['novelty', 'demo-able', 'beauty', 'viral-gadget', 'fashion-accessory'] },
  { id: 'instagram', label: 'Instagram', icon: '📸', type: 'social', cost: 'Free organic + paid', strengths: ['personalized', 'jewelry', 'aesthetic', 'pet', 'baby'] },
  { id: 'google', label: 'Google Search / Shopping', icon: '🔍', type: 'search', cost: 'Free organic + paid', strengths: ['utility', 'replacement', 'problem-solving', 'expensive'] },
  { id: 'youtube-shorts', label: 'YouTube Shorts', icon: '▶️', type: 'video', cost: 'Free organic', strengths: ['demo-able', 'craft', 'diy', 'gadget', 'satisfying'] },
  { id: 'facebook-groups', label: 'Facebook Groups', icon: '💬', type: 'community', cost: 'Free organic', strengths: ['hobby', 'collector', 'pet', 'local', 'fan-merch'] },
];

/** Perceptual source registry - surfaced in the UI's "Data & honesty" panel. */
export const DATA_SOURCES = [
  {
    id: 'page-observation',
    label: 'Page observation (your browser)',
    basis: 'observed',
    confidence: 'High',
    describes: 'Listing titles, prices, review counts, badges, result counts read from the marketplace page you scanned.',
    limits: 'Only what the page renders publicly. Never logs in, never bypasses paywalls or rate limits.',
  },
  {
    id: 'catalog-snapshot',
    label: 'Public-data catalog snapshot',
    basis: 'snapshot',
    confidence: 'Medium',
    describes: 'Curated per-niche signal ranges (typical listing counts, review moats, price bands, seasonality) maintained in src/data/catalog.js.',
    limits: 'A directional snapshot, not a live feed. Marketplace numbers move weekly.',
  },
  {
    id: 'fee-model',
    label: 'Published fee schedules',
    basis: 'modelled',
    confidence: 'Low',
    describes: 'Commission, payment, listing, ad and return allowances published by each marketplace.',
    limits: 'Category-dependent and change over time. Verify on the official seller page before pricing.',
  },
  {
    id: 'sales-inference',
    label: 'Sales inference from review activity',
    basis: 'modelled',
    confidence: 'Low',
    describes: 'Monthly sales are inferred from the review counts and "sold" labels a listing shows publicly, using a conservative 2-8% review-rate band.',
    limits: 'Never an exact figure. Review rates differ per category and per buyer behaviour.',
  },
  {
    id: 'trend-snapshot',
    label: 'Trend snapshot',
    basis: 'snapshot',
    confidence: 'Medium',
    describes: '30/90-day momentum and seasonality bands curated per niche, refreshed by re-running scans over time.',
    limits: 'Not a search-volume feed. Search volume is only claimed as observed when a public page shows it.',
  },
];

export const DISCLAIMER_TEXT =
  'Hidden Winner Finder never claims a sales, demand, view or search-volume number is exact unless it was read from an authorized, publicly available source in your own browser. Everything else is labelled Estimated, Approx. or Public-data based, with a confidence score.';

export const REVIEW_TO_SALES_BAND = { low: 0.02, high: 0.08 };
