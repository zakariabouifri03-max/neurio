/**
 * options.js - resolves the UI selections (category / marketplace / country /
 * budget) into the objects the engine uses, with safe fallbacks so a corrupted
 * stored option can never break a scan.
 */

import { CATEGORIES, COUNTRIES, BUDGETS } from '../data/taxonomy.js';
import { MARKETPLACES } from '../data/marketplaces.js';

export const DEFAULT_OPTIONS = {
  categoryId: 'any',
  marketplaceId: 'etsy',
  countryId: 'US',
  budgetId: 'b100-500',
};

export function normalizeOptions(input = {}) {
  const merged = { ...DEFAULT_OPTIONS, ...(input && typeof input === 'object' ? input : {}) };
  return {
    categoryId: getCategory(merged.categoryId).id,
    marketplaceId: getMarketplace(merged.marketplaceId).id,
    countryId: getCountry(merged.countryId).id,
    budgetId: getBudget(merged.budgetId).id,
  };
}

export const getCategory = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[0];
export const getCountry = (id) => COUNTRIES.find((c) => c.id === id) || COUNTRIES[0];
export const getBudget = (id) => BUDGETS.find((b) => b.id === id) || BUDGETS[1];
export const getMarketplace = (id) => MARKETPLACES.find((m) => m.id === id) || MARKETPLACES[0];

export const optionLabels = (options) => {
  const normalized = normalizeOptions(options);
  return {
    category: getCategory(normalized.categoryId).label,
    marketplace: getMarketplace(normalized.marketplaceId).name,
    country: getCountry(normalized.countryId).label,
    budget: getBudget(normalized.budgetId).label,
  };
};

export const isKnownOption = (key, id) => {
  if (key === 'categoryId') return CATEGORIES.some((c) => c.id === id);
  if (key === 'countryId') return COUNTRIES.some((c) => c.id === id);
  if (key === 'budgetId') return BUDGETS.some((b) => b.id === id);
  if (key === 'marketplaceId') return MARKETPLACES.some((m) => m.id === id);
  return false;
};
