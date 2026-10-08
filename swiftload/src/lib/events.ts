/**
 * Engine → UI event bridge.
 *
 * The Rust engine emits exactly six events (see `src-tauri/src/lib.rs`). The UI
 * is a pure consumer: it never polls for progress, it renders what the engine
 * pushed. Each subscription is optional so views can hook only what they need.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { hasBackend } from "./api";
import type { DownloadProgress, DownloadRecord, StatsSnapshot } from "./types";

/** Event names, identical to the `emit` calls in `src-tauri/src/lib.rs`. */
export const EVENTS = {
  list: "downloads:list",
  record: "downloads:record",
  removed: "downloads:removed",
  progress: "downloads:progress",
  stats: "downloads:stats",
  launchUrl: "app:launch-url",
} as const;

export interface EngineHandlers {
  /** Full list (initial load, reorder, batch status changes). */
  onList?: (records: DownloadRecord[]) => void;
  /** A single record changed. */
  onRecord?: (record: DownloadRecord) => void;
  /** A download was removed from the list. */
  onRemoved?: (id: string) => void;
  /** A fresh progress snapshot for every running download. */
  onProgress?: (progress: DownloadProgress[]) => void;
  /** Aggregate counters and total throughput. */
  onStats?: (stats: StatsSnapshot) => void;
  /** A `swiftload:` URL arrived from the shell, a shortcut or another instance. */
  onLaunchUrl?: (url: string) => void;
}

/**
 * Subscribes to the engine and returns an unsubscribe function.
 *
 * Outside the Tauri shell (UI review in a browser) this resolves to a no-op so
 * the interface still renders, just without live data.
 */
export async function subscribeEngine(handlers: EngineHandlers): Promise<() => void> {
  if (!hasBackend) return () => {};

  const unlisteners: UnlistenFn[] = [];

  const bind = async <T>(name: string, handler?: (payload: T) => void) => {
    if (!handler) return;
    try {
      const unlisten = await listen<T>(name, (event) => {
        try {
          handler(event.payload);
        } catch (error) {
          console.error(`failed to handle ${name}`, error);
        }
      });
      unlisteners.push(unlisten);
    } catch (error) {
      console.error(`failed to subscribe to ${name}`, error);
    }
  };

  await Promise.all([
    bind<DownloadRecord[]>(EVENTS.list, handlers.onList),
    bind<DownloadRecord>(EVENTS.record, handlers.onRecord),
    bind<string>(EVENTS.removed, handlers.onRemoved),
    bind<DownloadProgress[]>(EVENTS.progress, handlers.onProgress),
    bind<StatsSnapshot>(EVENTS.stats, handlers.onStats),
    bind<string>(EVENTS.launchUrl, handlers.onLaunchUrl),
  ]);

  return () => {
    for (const unlisten of unlisteners.splice(0)) {
      try {
        unlisten();
      } catch {
        /* the window is going away anyway */
      }
    }
  };
}
