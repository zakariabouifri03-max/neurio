/**
 * storage.js - the only module that talks to persistence.
 *
 * Uses chrome.storage.local when running as an extension and transparently falls
 * back to localStorage / memory when the same UI is opened as a plain page (the
 * dashboard preview, or the Node-based render tests). Every write is serialised
 * through a queue so two fast clicks can never clobber each other, and quota
 * errors surface as typed errors instead of silent data loss.
 */

export const STORAGE_KEYS = {
  OPTIONS: 'options',
  SAVED: 'saved',
  REPORTS: 'reports',
  OBSERVED: 'observed',
  HISTORY: 'history',
  STATS: 'stats',
  LAST_RESULT: 'lastResult',
  SETTINGS: 'settings',
};

export const MAX_REPORTS = 25;
export const MAX_HISTORY_POINTS = 12;

export const DEFAULTS = {
  [STORAGE_KEYS.OPTIONS]: { categoryId: 'any', marketplaceId: 'etsy', countryId: 'US', budgetId: 'b100-500' },
  [STORAGE_KEYS.SAVED]: [],
  [STORAGE_KEYS.REPORTS]: [],
  [STORAGE_KEYS.OBSERVED]: {},
  [STORAGE_KEYS.HISTORY]: {},
  [STORAGE_KEYS.STATS]: { scans: 0, winnerFinds: 0, firstRunAt: null, lastScanAt: null },
  [STORAGE_KEYS.LAST_RESULT]: null,
  [STORAGE_KEYS.SETTINGS]: { autoScanOnOpen: false, rememberOptions: true, showEstimatesInflated: false },
};

export class StorageError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
    this.cause = cause;
  }
}

const hasChromeStorage = () =>
  typeof chrome !== 'undefined' && chrome?.storage?.local && typeof chrome.storage.local.get === 'function';

const hasLocalStorage = () => {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
};

const memory = new Map();

const rawGet = async (keys) => {
  if (hasChromeStorage()) return chrome.storage.local.get(keys);
  const list = [].concat(keys || []);
  const out = {};
  for (const key of list) {
    if (hasLocalStorage()) {
      const value = localStorage.getItem(`hwf:${key}`);
      if (value != null) {
        try {
          out[key] = JSON.parse(value);
        } catch { /* corrupted entry - treat as missing */ }
      }
    } else if (memory.has(key)) {
      out[key] = memory.get(key);
    }
  }
  return out;
};

const rawSet = async (entries) => {
  if (hasChromeStorage()) {
    try {
      await chrome.storage.local.set(entries);
      return;
    } catch (error) {
      throw new StorageError('STORAGE_FULL', 'Chrome storage rejected the write (quota or serialisation).', error);
    }
  }
  for (const [key, value] of Object.entries(entries)) {
    if (hasLocalStorage()) {
      try {
        localStorage.setItem(`hwf:${key}`, JSON.stringify(value));
        continue;
      } catch (error) {
        throw new StorageError('STORAGE_FULL', 'localStorage rejected the write (quota).', error);
      }
    }
    memory.set(key, value);
  }
};

const rawRemove = async (keys) => {
  const list = [].concat(keys || []);
  if (hasChromeStorage()) {
    await chrome.storage.local.remove(list);
    return;
  }
  for (const key of list) {
    if (hasLocalStorage()) localStorage.removeItem(`hwf:${key}`);
    memory.delete(key);
  }
};

/** Serialise writes so concurrent UI actions cannot interleave read-modify-write. */
let writeChain = Promise.resolve();
const enqueue = (task) => {
  const next = writeChain.then(task, task);
  writeChain = next.catch(() => {});
  return next;
};

export async function get(key, fallback = null) {
  try {
    const result = await rawGet(key);
    const value = result?.[key];
    return value === undefined ? fallback : value;
  } catch (error) {
    throw new StorageError('READ_FAILED', `Could not read "${key}" from storage.`, error);
  }
}

export async function getAll() {
  const keys = Object.values(STORAGE_KEYS);
  const stored = await rawGet(keys);
  const out = {};
  for (const key of keys) out[key] = stored?.[key] === undefined ? DEFAULTS[key] : stored[key];
  return out;
}

export async function set(key, value) {
  return enqueue(() => rawSet({ [key]: value }));
}

export async function patch(key, mutator, defaults = {}) {
  return enqueue(async () => {
    const current = (await rawGet([key]))?.[key];
    const next = mutator(current === undefined ? defaults : current);
    await rawSet({ [key]: next });
    return next;
  });
}

export async function remove(key) {
  return enqueue(() => rawRemove(key));
}

/* ───────────────────────── domain helpers ───────────────────────── */

export const getOptions = async () => get(STORAGE_KEYS.OPTIONS, DEFAULTS[STORAGE_KEYS.OPTIONS]);
export const setOptions = async (options) => set(STORAGE_KEYS.OPTIONS, options);

export const getObserved = async () => get(STORAGE_KEYS.OBSERVED, {});
export const getHistory = async () => get(STORAGE_KEYS.HISTORY, {});

export function pruneHistory(history, key) {
  const list = history[key] || [];
  return { ...history, [key]: list.slice(-MAX_HISTORY_POINTS) };
}

export function pruneReports(reports) {
  return [...(reports || [])]
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, MAX_REPORTS);
}

export const saveReport = async (report) =>
  patch(STORAGE_KEYS.REPORTS, (list) => pruneReports([report, ...(list || [])]), []);

export const listReports = async () => get(STORAGE_KEYS.REPORTS, []);

export const getSaved = async () => get(STORAGE_KEYS.SAVED, []);

export const toggleSaved = async (entry) =>
  patch(STORAGE_KEYS.SAVED, (list) => {
    const current = list || [];
    const exists = current.some((item) => item.productId === entry.productId);
    if (exists) return current.filter((item) => item.productId !== entry.productId);
    return [{ ...entry, savedAt: Date.now() }, ...current];
  }, []);

export const bumpStat = async (name, delta = 1) =>
  patch(STORAGE_KEYS.STATS, (stats) => ({
    ...(stats || {}),
    [name]: ((stats || {})[name] || 0) + delta,
    lastScanAt: name === 'scans' ? Date.now() : (stats || {}).lastScanAt || null,
    firstRunAt: (stats || {}).firstRunAt || Date.now(),
  }), DEFAULTS[STORAGE_KEYS.STATS]);

/** Full export for the backup button, plus a re-import that validates shape. */
export async function exportAll() {
  const data = await getAll();
  return {
    app: 'hidden-winner-finder',
    version: 1,
    exportedAt: new Date().toISOString(),
    data,
  };
}

export async function importAll(payload) {
  if (!payload || payload.app !== 'hidden-winner-finder' || typeof payload.data !== 'object') {
    throw new StorageError('BAD_IMPORT', 'That file is not a Hidden Winner Finder backup.');
  }
  for (const key of Object.values(STORAGE_KEYS)) {
    if (payload.data[key] !== undefined) await rawSet({ [key]: payload.data[key] });
  }
  return true;
}

export async function clearAll({ keepSettings = true } = {}) {
  const keys = Object.values(STORAGE_KEYS).filter((k) => !(keepSettings && k === STORAGE_KEYS.SETTINGS));
  await rawRemove(keys);
  return true;
}
