/* Etsy Insight Pro — storage.js
 * Thin promise wrapper around chrome.storage.local with an in-memory
 * fallback (used by unit tests and when the API is unavailable).
 * All extension data is local-first: nothing ever leaves the device.
 *
 * Keys:
 *   eip_settings_v1  object
 *   eip_products_v1  { [listingId]: TrackedProduct }
 *   eip_shops_v1     { [shopName]: TrackedShop }
 *   eip_research_v1  ResearchSession[] (newest first, capped)
 *   eip_meta_v1      { installDate, observationCount }
 */
(function initStorage(root) {
  const EIP = root.EIP || (root.EIP = {});
  EIP.register && EIP.register('storage');

  const KEYS = {
    SETTINGS: 'eip_settings_v1',
    PRODUCTS: 'eip_products_v1',
    SHOPS: 'eip_shops_v1',
    RESEARCH: 'eip_research_v1',
    META: 'eip_meta_v1'
  };
  const RESEARCH_CAP = 25;

  const memory = {}; // fallback store
  let memoryMode = false;

  function backend() {
    try {
      if (root.chrome && root.chrome.storage && root.chrome.storage.local) return root.chrome.storage.local;
    } catch (e) { /* ignore */ }
    return null;
  }

  async function get(keys) {
    const b = backend();
    const arr = Array.isArray(keys) ? keys : [keys];
    if (!b) {
      memoryMode = true;
      const out = {};
      for (const k of arr) out[k] = memory[k];
      return out;
    }
    try {
      return await b.get(arr);
    } catch (e) {
      memoryMode = true;
      const out = {};
      for (const k of arr) out[k] = memory[k];
      return out;
    }
  }

  async function set(obj) {
    Object.assign(memory, obj);
    const b = backend();
    if (!b) { memoryMode = true; return; }
    try {
      await b.set(obj);
    } catch (e) {
      memoryMode = true;
      throw e;
    }
  }

  async function remove(keys) {
    const arr = Array.isArray(keys) ? keys : [keys];
    for (const k of arr) delete memory[k];
    const b = backend();
    if (b) { try { await b.remove(arr); } catch (e) { /* keep memory */ } }
  }

  async function clearAll() {
    for (const k of Object.keys(memory)) delete memory[k];
    const b = backend();
    if (b) { try { await b.clear(); } catch (e) { /* ignore */ } }
  }

  async function getBytesInUse() {
    const b = backend();
    if (!b || !b.getBytesInUse) {
      return JSON.stringify(memory).length;
    }
    try {
      return await b.getBytesInUse(null);
    } catch (e) {
      return JSON.stringify(memory).length;
    }
  }

  // ---- Settings ----
  async function loadSettings() {
    const sanitize = (EIP.settings && EIP.settings.sanitize) || ((x) => x || {});
    const res = await get(KEYS.SETTINGS);
    return sanitize(res[KEYS.SETTINGS]);
  }

  async function saveSettings(next) {
    const sanitize = (EIP.settings && EIP.settings.sanitize) || ((x) => x);
    const clean = sanitize(next);
    await set({ [KEYS.SETTINGS]: clean });
    return clean;
  }

  // ---- Tracked products ----
  async function loadProducts() {
    const res = await get(KEYS.PRODUCTS);
    return res[KEYS.PRODUCTS] || {};
  }

  async function saveProducts(map) {
    await set({ [KEYS.PRODUCTS]: map || {} });
  }

  async function loadShops() {
    const res = await get(KEYS.SHOPS);
    return res[KEYS.SHOPS] || {};
  }

  async function saveShops(map) {
    await set({ [KEYS.SHOPS]: map || {} });
  }

  // ---- Research sessions ----
  async function loadResearch() {
    const res = await get(KEYS.RESEARCH);
    return Array.isArray(res[KEYS.RESEARCH]) ? res[KEYS.RESEARCH] : [];
  }

  async function pushResearch(session) {
    const list = await loadResearch();
    list.unshift({ ...session, savedAt: Date.now() });
    await set({ [KEYS.RESEARCH]: list.slice(0, RESEARCH_CAP) });
    return list;
  }

  async function clearResearch() {
    await set({ [KEYS.RESEARCH]: [] });
  }

  // ---- Meta ----
  async function loadMeta() {
    const res = await get(KEYS.META);
    return res[KEYS.META] || { installDate: Date.now(), observationCount: 0 };
  }

  async function saveMeta(meta) {
    await set({ [KEYS.META]: meta });
  }

  async function bumpObservations(n) {
    const meta = await loadMeta();
    meta.observationCount = (meta.observationCount || 0) + (n || 1);
    await saveMeta(meta);
    return meta;
  }

  /** Export everything (for Settings → Export data). */
  async function exportAll() {
    const res = await get([KEYS.SETTINGS, KEYS.PRODUCTS, KEYS.SHOPS, KEYS.RESEARCH, KEYS.META]);
    return {
      app: 'Etsy Insight Pro',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: res[KEYS.SETTINGS] || null,
      products: res[KEYS.PRODUCTS] || {},
      shops: res[KEYS.SHOPS] || {},
      research: res[KEYS.RESEARCH] || [],
      meta: res[KEYS.META] || null
    };
  }

  /** Import a previously exported payload (validated, local only). */
  async function importAll(payload) {
    if (!payload || typeof payload !== 'object') throw new Error('Invalid backup file.');
    const out = {};
    if (payload.settings) {
      const sanitize = (EIP.settings && EIP.settings.sanitize) || ((x) => x);
      out[KEYS.SETTINGS] = sanitize(payload.settings);
    }
    if (payload.products && typeof payload.products === 'object') out[KEYS.PRODUCTS] = payload.products;
    if (payload.shops && typeof payload.shops === 'object') out[KEYS.SHOPS] = payload.shops;
    if (Array.isArray(payload.research)) out[KEYS.RESEARCH] = payload.research.slice(0, RESEARCH_CAP);
    await set(out);
    return out;
  }

  function isMemoryMode() { return memoryMode; }
  function __resetMemoryForTests() {
    for (const k of Object.keys(memory)) delete memory[k];
    memoryMode = true;
  }

  EIP.storage = {
    KEYS, RESEARCH_CAP, get, set, remove, clearAll, getBytesInUse,
    loadSettings, saveSettings, loadProducts, saveProducts, loadShops, saveShops,
    loadResearch, pushResearch, clearResearch, loadMeta, saveMeta, bumpObservations,
    exportAll, importAll, isMemoryMode, __resetMemoryForTests
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
