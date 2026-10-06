/**
 * Typed message protocol between content scripts, popup and the background
 * service worker. All network I/O lives in the background worker so we get
 * one throttled, cached, retrying client for the whole extension.
 */
import type { Analysis, ListingObservation } from "@etsy-signal/shared";

export type ContentToBackground =
  | { type: "ingest"; observations: ListingObservation[] }
  | { type: "analysis"; listingId: string }
  | { type: "history"; listingId: string }
  | { type: "listings" }
  | { type: "config:get" }
  | { type: "config:set"; apiUrl?: string; mode?: "local" | "backend" }
  | { type: "health" };

export interface BackendConfig {
  apiUrl: string;
  /**
   * "local"  = run the estimation engine inside the extension, history kept
   *            in chrome.storage.local. Works out of the box, zero setup.
   * "backend" = talk to the self-hosted Fastify + PostgreSQL backend.
   */
  mode: "local" | "backend";
}

export const DEFAULT_CONFIG: BackendConfig = { apiUrl: "http://localhost:8787", mode: "local" };

export type BgResponse<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; error: string };

export function sendMessage(msg: ContentToBackground): Promise<BgResponse<any>> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(msg, (resp) => {
        if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message ?? "runtime error" });
        else resolve(resp ?? { ok: false, error: "no response" });
      });
    } catch (e) {
      resolve({ ok: false, error: String(e) });
    }
  });
}

export interface HistoryResponse {
  listingId: string;
  snapshots: { observedAt: string; reviewCount: number | null; searchPosition: number | null; price: number | null }[];
}

export interface ListingsResponse {
  listings: {
    listingId: string;
    title?: string;
    url?: string;
    shopName?: string;
    firstSeenAt: string;
    lastSeenAt: string;
    observationCount: number;
  }[];
}

export type AnalysisResponse = Analysis;
