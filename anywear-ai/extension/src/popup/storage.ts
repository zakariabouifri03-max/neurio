/** Persisted popup settings (chrome.storage.local). */

export interface Settings {
  apiBaseURL: string; // default http://localhost:8000
  apiKey: string;
  defaultCategory: string;
  pollIntervalMs: number;
}

export const DEFAULT_SETTINGS: Settings = {
  apiBaseURL: "http://localhost:8000",
  apiKey: "",
  defaultCategory: "other",
  pollIntervalMs: 1500,
};

export async function loadSettings(): Promise<Settings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(["anywearSettings"], (res) => {
      resolve({ ...DEFAULT_SETTINGS, ...(res.anywearSettings || {}) });
    });
  });
}

export async function saveSettings(s: Settings): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ anywearSettings: s }, () => resolve());
  });
}
