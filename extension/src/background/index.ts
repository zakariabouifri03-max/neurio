/**
 * Background service worker: the single network gateway.
 *
 * Implements the reliability requirements:
 *   - request queue (max 2 concurrent, 150ms spacing — throttling)
 *   - timeout (10s)
 *   - retries with exponential backoff + jitter (429/5xx/network)
 *   - TTL cache for GETs (session storage survives worker restarts)
 *   - config in chrome.storage.sync
 */
import type { ListingObservation } from "@etsy-signal/shared";
import { DEFAULT_CONFIG, type BackendConfig, type ContentToBackground, type BgResponse } from "../common/messages.js";

const MAX_CONCURRENT = 2;
const MIN_SPACING_MS = 150;
const TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 600;
const CACHE_TTL_MS = 10 * 60 * 1000;

let running = 0;
let lastStart = 0;
const waiters: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  while (running >= MAX_CONCURRENT) {
    await new Promise<void>((res) => waiters.push(res));
  }
  const sinceLast = Date.now() - lastStart;
  if (sinceLast < MIN_SPACING_MS) await sleep(MIN_SPACING_MS - sinceLast);
  running++;
  lastStart = Date.now();
}

function releaseSlot(): void {
  running--;
  const next = waiters.shift();
  if (next) next();
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getConfig(): Promise<BackendConfig> {
  const stored = await chrome.storage.sync.get("config");
  return { ...DEFAULT_CONFIG, ...(stored.config ?? {}) };
}

interface CacheEntry {
  at: number;
  body: unknown;
}
const memCache = new Map<string, CacheEntry>();

async function cacheGet(key: string): Promise<unknown | undefined> {
  const hit = memCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.body;
  try {
    const stored = await chrome.storage.session.get("netcache");
    const entry = (stored.netcache ?? {})[key] as CacheEntry | undefined;
    if (entry && Date.now() - entry.at < CACHE_TTL_MS) {
      memCache.set(key, entry);
      return entry.body;
    }
  } catch {
    /* session storage unavailable (e.g. in tests) */
  }
  return undefined;
}

async function invalidate(url: string): Promise<void> {
  for (const method of ["GET", "POST"]) memCache.delete(`${method} ${url}`);
  try {
    const stored = await chrome.storage.session.get("netcache");
    const all = { ...(stored.netcache ?? {}) };
    for (const k of Object.keys(all)) {
      if (k.endsWith(url)) delete (all as Record<string, unknown>)[k];
    }
    await chrome.storage.session.set({ netcache: all });
  } catch {
    /* best-effort */
  }
}

async function cacheSet(key: string, body: unknown): Promise<void> {
  const entry = { at: Date.now(), body };
  memCache.set(key, entry);
  try {
    const stored = await chrome.storage.session.get("netcache");
    const all = { ...(stored.netcache ?? {}), [key]: entry };
    // Keep the cache bounded.
    const keys = Object.keys(all);
    if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete (all as Record<string, unknown>)[k];
    await chrome.storage.session.set({ netcache: all });
  } catch {
    /* ignore quota/session errors — cache is best-effort */
  }
}

async function fetchJson(method: "GET" | "POST", path: string, body?: unknown, cacheable = false): Promise<unknown> {
  const { apiUrl } = await getConfig();
  const url = apiUrl.replace(/\/$/, "") + path;
  const cacheKey = method + " " + url;
  if (cacheable) {
    const hit = await cacheGet(cacheKey);
    if (hit !== undefined) return hit;
  }

  await acquireSlot();
  try {
    let lastErr: unknown = new Error("request failed");
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method,
          headers: { "content-type": "application/json" },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`HTTP ${res.status}`);
          throw lastErr; // retryable
        }
        const text = await res.text();
        let json: unknown = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          json = null;
        }
        if (!res.ok) {
          const message = (json as { error?: string } | null)?.error ?? `HTTP ${res.status}`;
          throw new HttpError(res.status, message, false);
        }
        if (cacheable) await cacheSet(cacheKey, json);
        return json;
      } catch (e) {
        const retryable = e instanceof HttpError ? e.retryable : true;
        lastErr = e;
        if (!retryable || attempt === MAX_RETRIES) break;
        const backoff = BACKOFF_BASE_MS * 2 ** attempt + Math.random() * 250;
        await sleep(backoff);
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastErr;
  } finally {
    releaseSlot();
  }
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public retryable: boolean,
  ) {
    super(message);
  }
}

chrome.runtime.onMessage.addListener((msg: ContentToBackground, _sender, sendResponse) => {
  handleMessage(msg)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  return true; // async response
});

async function handleMessage(msg: ContentToBackground): Promise<BgResponse> {
  switch (msg.type) {
    case "config:get":
      return { ok: true, data: await getConfig() };
    case "config:set": {
      const apiUrl = String(msg.apiUrl).trim().replace(/\/$/, "");
      if (!/^https?:\/\//.test(apiUrl)) return { ok: false, error: "API URL must start with http:// or https://" };
      await chrome.storage.sync.set({ config: { apiUrl } });
      return { ok: true, data: { apiUrl } };
    }
    case "health": {
      const data = await fetchJson("GET", "/health", undefined, false);
      return { ok: true, data };
    }
    case "ingest": {
      const observations = msg.observations.slice(0, 60);
      const data = await fetchJson("POST", "/v1/observations", { observations });
      // Fresh evidence arrived -> drop stale cached analyses/history for those listings.
      const { apiUrl } = await getConfig();
      const base = apiUrl.replace(/\/$/, "");
      for (const o of observations) {
        const id = encodeURIComponent(o.listingId);
        await invalidate(`${base}/v1/listings/${id}/analysis`);
        await invalidate(`${base}/v1/listings/${id}/history`);
      }
      return { ok: true, data };
    }
    case "analysis": {
      const data = await fetchJson("GET", `/v1/listings/${encodeURIComponent(msg.listingId)}/analysis`, undefined, true);
      return { ok: true, data };
    }
    case "history": {
      const data = await fetchJson("GET", `/v1/listings/${encodeURIComponent(msg.listingId)}/history`, undefined, true);
      return { ok: true, data };
    }
    case "listings": {
      const data = await fetchJson("GET", "/v1/listings?limit=100", undefined, false);
      return { ok: true, data };
    }
    default:
      return { ok: false, error: "unknown message" };
  }
}

// Wake-up: periodically clear stale cache entries (memory hygiene only).
chrome.alarms.create("etsy-signal-cache-sweep", { periodInMinutes: 30 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== "etsy-signal-cache-sweep") return;
  const now = Date.now();
  for (const [k, v] of memCache) if (now - v.at > CACHE_TTL_MS) memCache.delete(k);
});
