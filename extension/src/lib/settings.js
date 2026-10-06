/* Etsy Insight Pro — settings.js
 * Central defaults + validation. Storage access lives in storage.js; this
 * module only defines the schema so it stays unit-testable.
 */
(function initSettings(root) {
  const EIP = root.EIP || (root.EIP = {});
  EIP.register && EIP.register('settings');

  const SETTINGS_KEY = 'eip_settings_v1';

  const DEFAULTS = Object.freeze({
    version: 1,
    // Display
    theme: 'auto',               // 'light' | 'dark' | 'auto'
    currency: 'USD',             // display currency for revenue estimates
    // Estimation assumptions (all user-tunable, all disclosed in UI)
    reviewRate: 0.15,            // share of orders that leave a review (0.05–0.50)
    sensitivity: 'balanced',     // 'conservative' | 'balanced' | 'optimistic'
    conversionRate: 0.02,        // orders per listing view (1%–5% typical)
    viewsPerFavorite: 25,        // fallback views implied per favorite
    // Behaviour
    autoAnalyze: true,           // run extraction automatically on Etsy pages
    autoTrack: true,             // record observation when a tracked item is visited
    trackingMinIntervalHours: 6, // min gap between two observations of same item
    historyRetentionDays: 365,
    // Privacy
    storeImages: false           // never persist listing images, only URLs in-session
  });

  const SENSITIVITY_FACTORS = Object.freeze({
    conservative: { low: 0.55, high: 1.25, label: 'Conservative' },
    balanced: { low: 0.75, high: 1.6, label: 'Balanced' },
    optimistic: { low: 0.9, high: 2.0, label: 'Optimistic' }
  });

  function sanitize(input) {
    const out = { ...DEFAULTS };
    if (!input || typeof input !== 'object') return out;
    if (['light', 'dark', 'auto'].includes(input.theme)) out.theme = input.theme;
    if (typeof input.currency === 'string' && /^[A-Z]{3}$/.test(input.currency)) out.currency = input.currency;
    if (Number.isFinite(input.reviewRate)) out.reviewRate = Math.min(0.5, Math.max(0.05, input.reviewRate));
    if (SENSITIVITY_FACTORS[input.sensitivity]) out.sensitivity = input.sensitivity;
    if (Number.isFinite(input.conversionRate)) out.conversionRate = Math.min(0.1, Math.max(0.005, input.conversionRate));
    if (Number.isFinite(input.viewsPerFavorite)) out.viewsPerFavorite = Math.min(200, Math.max(5, input.viewsPerFavorite));
    if (typeof input.autoAnalyze === 'boolean') out.autoAnalyze = input.autoAnalyze;
    if (typeof input.autoTrack === 'boolean') out.autoTrack = input.autoTrack;
    if (Number.isFinite(input.trackingMinIntervalHours)) {
      out.trackingMinIntervalHours = Math.min(168, Math.max(1, input.trackingMinIntervalHours));
    }
    if (Number.isFinite(input.historyRetentionDays)) {
      out.historyRetentionDays = Math.min(730, Math.max(30, input.historyRetentionDays));
    }
    if (typeof input.storeImages === 'boolean') out.storeImages = input.storeImages;
    return out;
  }

  EIP.settings = { SETTINGS_KEY, DEFAULTS, SENSITIVITY_FACTORS, sanitize };
})(typeof globalThis !== 'undefined' ? globalThis : this);
