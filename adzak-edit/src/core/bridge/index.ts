import type { PlatformBridge, RuntimeCapabilities } from './PlatformBridge';
import { NO_CAPABILITIES } from './PlatformBridge';
import { webBridge } from './webBridge';

/**
 * Bridge resolution.
 *
 * The app picks the Tauri bridge when it is running inside the desktop shell
 * and the web bridge otherwise (development server, CI, sandbox preview). The
 * choice is made once, at import time, and the rest of the codebase just calls
 * `getBridge()`.
 */

let bridge: PlatformBridge = webBridge;
let capabilities: RuntimeCapabilities = { ...NO_CAPABILITIES };

/** True when running inside the Tauri desktop shell. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Initialise the platform bridge. Safe to call more than once; the first
 * successful initialisation wins.
 */
export async function initBridge(): Promise<PlatformBridge> {
  if (isTauri()) {
    try {
      const { TauriBridge } = await import('./tauriBridge');
      const tauri = new TauriBridge();
      capabilities = await tauri.initialise();
      bridge = tauri;
      return bridge;
    } catch (error) {
      // Falling back keeps the editor usable even if the Rust side failed to
      // load — but the UI must say so rather than silently degrade.
      console.error('Tauri bridge failed to initialise; falling back to the web runtime.', error);
    }
  }
  bridge = webBridge;
  try {
    capabilities = await webBridge.encoderCapabilities().then((caps) => ({
      ...NO_CAPABILITIES,
      ffmpeg: false,
      ffprobe: caps.videoCodecs.length > 0 || caps.audioCodecs.length > 0,
      persistentStorage: true,
      fileExport: caps.videoCodecs.length > 0 || caps.audioCodecs.length > 0,
      nativeDialogs: false,
    }));
  } catch {
    capabilities = { ...NO_CAPABILITIES };
  }
  return bridge;
}

export function getBridge(): PlatformBridge {
  return bridge;
}

export function getCapabilities(): RuntimeCapabilities {
  return capabilities;
}

/** Swap the bridge — used by tests and by the desktop shell at startup. */
export function setBridge(next: PlatformBridge): void {
  bridge = next;
}

export type { PlatformBridge, RuntimeCapabilities };
export { NO_CAPABILITIES };
