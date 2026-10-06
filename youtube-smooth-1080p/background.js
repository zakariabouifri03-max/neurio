// YouTube Smooth 1080p — MV3 service worker.
// Preferences stay in chrome.storage.local; this worker never makes network requests.

const DEFAULT_SETTINGS = Object.freeze({
  smartBufferProtection: true,
  maximumSmoothness: false,
  resumeBufferSeconds: 8
});

function normalizeSettings(value) {
  const settings = value && typeof value === 'object' ? value : {};
  const target = Number(settings.resumeBufferSeconds);
  return {
    smartBufferProtection: typeof settings.smartBufferProtection === 'boolean'
      ? settings.smartBufferProtection
      : DEFAULT_SETTINGS.smartBufferProtection,
    maximumSmoothness: typeof settings.maximumSmoothness === 'boolean'
      ? settings.maximumSmoothness
      : DEFAULT_SETTINGS.maximumSmoothness,
    resumeBufferSeconds: Number.isFinite(target)
      ? Math.min(18, Math.max(6, Math.round(target / 2) * 2))
      : DEFAULT_SETTINGS.resumeBufferSeconds
  };
}

async function ensureSettings() {
  try {
    const stored = await chrome.storage.local.get('settings');
    const normalized = normalizeSettings(stored.settings);
    await chrome.storage.local.set({ settings: normalized });
  } catch (error) {
    // The extension still works with in-memory defaults if storage is unavailable.
    console.warn('[YouTube Smooth 1080p] Could not initialize local settings.', error);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void ensureSettings();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureSettings();
});
