/**
 * Background service worker: the single data gateway.
 *
 * Two modes (popup → Settings):
 *   - "local"   (default): the SAME estimation engine that the backend runs,
 *     executed in-browser, with history persisted in chrome.storage.local.
 *     Works with zero setup.
 *   - "backend": REST calls to the self-hosted Fastify + PostgreSQL backend,
 *     with the reliability requirements implemented here:
 *       request queue (max 2 concurrent, 150ms spacing), timeouts,
 *       retries with exponential backoff + jitter, TTL cache.
 */
import { analyze, assembleEstimationInput } from "@etsy-signal/estimation-engine";
import { MemoryStore, type StoredObservation } from "@etsy-signal/shared";
import { DEFAULT_CONFIG, type BackendConfig, type ContentToBackground, type BgResponse } from "../common/messages.js";

const MAX_CONCURRENT = 2;
const MIN_SPACING_MS = 150;
const TIMEOUT_MS = 10_000;
const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 600;
const CACHE_TTL_MS = 10 * 60 * 1000;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

async function getConfig(): Promise<BackendConfig> {
  const stored = await chrome.storage.sync.get("config");
  return { ...DEFAULT_CONFIG, ...(stored.config ?? {}) };
}

// ---------------------------------------------------------------------------
// Local-mode store (persisted history in chrome.storage.local)
// ---------------------------------------------------------------------------

const localStore = new MemoryStore();
let hydrated = false;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

async function hydrate(): Promise<void> {
  if (hydrated) return;
  try {
    const stored = await chrome.storage.local.get("es_observations");
    localStore.load((stored.es_observations ?? []) as StoredObservation[]);
  } catch {
    /* fresh install */
  }
  hydrated = true;
}

function persist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    void chrome.storage.local.set({ es_observations: localStore.dump() }).catch(() => undefined);
  }, 500);
}

async function handleLocal(msg: ContentToBackground): Promise<BgResponse> {
  await hydrate();
  switch (msg.type) {
    case "ingest": {
      let accepted = 0;
      for (const obs of msg.observations.slice(0, 60)) {
        await localStore.ingest(obs as StoredObservation);
        accepted++;
      }
      persist();
      return { ok: true, data: { accepted, rejected: 0 } };
    }
    case "analysis": {
      const assembled = await assembleEstimationInput(localStore, msg.listingId, new Date().toISOString());
      if (!assembled) return { ok: false, error: "listing not tracked yet" };
      return { ok: true, data: analyze(assembled.input) };
    }
    case "history": {
      const obs = await localStore.getObservations(msg.listingId);
      if (obs.length === 0) return { ok: false, error: "listing not tracked yet" };
      return {
        ok: true,
        data: {
          listingId: msg.listingId,
          snapshots: obs.map((o) => ({
            observedAt: o.observedAt,
            reviewCount: o.reviewCount ?? null,
            searchPosition: o.searchPosition ?? null,
            price: o.price ?? null,
          })),
        },
      };
    }
    case "listings":
      return { ok: true, data: { listings: await localStore.listListings(100) } };
    case "health":
      return { ok: true, data: { ok: true, service: "etsy-signal-local", mode: "local" } };
    default:
      return { ok: false, error: "not handled in local mode" };
  }
}

// ---------------------------------------------------------------------------
// Backend-mode network client (queue + throttle + backoff + cache)
// ---------------------------------------------------------------------------

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

interface CacheEntry {
  at: number;
  body: unknown;
}
const memCache = new Map<string, CacheEntry>();

async function cacheGet(key: string): Promise<unknown | undefined> {
  const hit = memCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.body;
  return undefined;
}

async function cacheSet(key: string, body: unknown): Promise<void> {
  memCache.set(key, { at: Date.now(), body });
  if (memCache.size > 300) {
    const oldest = [...memCache.entries()].sort((a, b) => a[1].at - b[1].at).slice(0, 100);
    for (const [k] of oldest) memCache.delete(k);
  }
}

function invalidate(url: string): void {
  for (const method of ["GET", "POST"]) memCache.delete(`${method} ${url}`);
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

async function handleBackend(msg: ContentToBackground): Promise<BgResponse> {
  switch (msg.type) {
    case "health":
      return { ok: true, data: await fetchJson("GET", "/health", undefined, false) };
    case "ingest": {
      const observations = msg.observations.slice(0, 60);
      const data = await fetchJson("POST", "/v1/observations", { observations });
      const { apiUrl } = await getConfig();
      const base = apiUrl.replace(/\/$/, "");
      for (const o of observations) {
        const id = encodeURIComponent(o.listingId);
        invalidate(`${base}/v1/listings/${id}/analysis`);
        invalidate(`${base}/v1/listings/${id}/history`);
      }
      return { ok: true, data };
    }
    case "analysis":
      return { ok: true, data: await fetchJson("GET", `/v1/listings/${encodeURIComponent(msg.listingId)}/analysis`, undefined, true) };
    case "history":
      return { ok: true, data: await fetchJson("GET", `/v1/listings/${encodeURIComponent(msg.listingId)}/history`, undefined, true) };
    case "listings":
      return { ok: true, data: await fetchJson("GET", "/v1/listings?limit=100", undefined, false) };
    default:
      return { ok: false, error: "not handled in backend mode" };
  }
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((msg: ContentToBackground, _sender, sendResponse) => {
  handleMessage(msg)
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  return true; // async response
});

async function handleMessage(msg: ContentToBackground): Promise<BgResponse> {
  if (msg.type === "config:get") return { ok: true, data: await getConfig() };
  if (msg.type === "config:set") {
    const apiUrl = String(msg.apiUrl ?? "").trim().replace(/\/$/, "");
    if (msg.apiUrl && !/^https?:\/\//.test(apiUrl)) return { ok: false, error: "API URL must start with http:// or https://" };
    const current = await getConfig();
    const next: BackendConfig = {
      apiUrl: msg.apiUrl ? apiUrl : current.apiUrl,
      mode: msg.mode === "backend" || msg.mode === "local" ? msg.mode : current.mode,
    };
    await chrome.storage.sync.set({ config: next });
    return { ok: true, data: next };
  }
  const config = await getConfig();
  return config.mode === "backend" ? handleBackend(msg) : handleLocal(msg);
}

// Wake-up: periodic hygiene for the in-memory cache.
chrome.alarms.create("etsy-signal-cache-sweep", { periodInMinutes: 30 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== "etsy-signal-cache-sweep") return;
  const now = Date.now();
  for (const [k, v] of memCache) if (now - v.at > CACHE_TTL_MS) memCache.delete(k);
});
