export interface AppSettings {
  aiProvider: string;
  cloudEndpoint: string;
  cloudKey: string;
  customEndpoint: string;
  customKey: string;
  autosaveMs: number;
  tabletPressure: boolean;
  leftWidth: number;
  rightWidth: number;
  bottomHeight: number;
  themeAccent: string;
}

const KEY = "animai.settings.v1";

export const DEFAULT_SETTINGS: AppSettings = {
  aiProvider: "local",
  cloudEndpoint: "",
  cloudKey: "",
  customEndpoint: "",
  customKey: "",
  autosaveMs: 45000,
  tabletPressure: true,
  leftWidth: 72,
  rightWidth: 300,
  bottomHeight: 196,
  themeAccent: "#3ee0c5",
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: AppSettings): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}
