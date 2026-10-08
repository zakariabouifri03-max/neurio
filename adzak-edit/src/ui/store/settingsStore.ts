import { create } from 'zustand';
import type { AiPermissionSettings } from '../../core/ai/permissions';
import { DEFAULT_PERMISSIONS } from '../../core/ai/permissions';

/**
 * User settings.
 *
 * Persisted to the platform bridge (SQLite on desktop, localStorage in the
 * browser) under a single key so the shape can evolve with a version field.
 */

export type ThemeMode = 'dark' | 'light' | 'system';
export type PreviewQuality = 'draft' | 'balanced' | 'high';

export interface ShortcutMap {
  split: string;
  delete: string;
  rippleDelete: string;
  undo: string;
  redo: string;
  save: string;
  playPause: string;
  frameLeft: string;
  frameRight: string;
  zoomIn: string;
  zoomOut: string;
  toggleSnap: string;
  selectTool: string;
  addMarker: string;
}

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  split: 'S',
  delete: 'Delete',
  rippleDelete: 'Shift+Delete',
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Shift+Z',
  save: 'Ctrl+S',
  playPause: 'Space',
  frameLeft: 'ArrowLeft',
  frameRight: 'ArrowRight',
  zoomIn: 'Ctrl+=',
  zoomOut: 'Ctrl+-',
  toggleSnap: 'N',
  selectTool: 'V',
  addMarker: 'M',
};

export interface Settings {
  version: number;
  general: {
    language: string;
    autosaveSec: number;
    confirmBeforeDestructive: boolean;
    showOnboarding: boolean;
  };
  appearance: {
    theme: ThemeMode;
    timelineDensity: 'compact' | 'comfortable';
    showWaveforms: boolean;
    showThumbnails: boolean;
  };
  performance: {
    previewQuality: PreviewQuality;
    hardwareAcceleration: boolean;
    thumbnailWorkers: number;
    proxyEnabled: boolean;
    proxyHeight: number;
    maxCacheGb: number;
  };
  ai: {
    providerId: 'offline' | 'ollama' | 'llamacpp';
    ollamaUrl: string;
    ollamaModel: string;
    llamacppUrl: string;
    whisperModel: string;
    modelStoragePath: string;
    permissions: AiPermissionSettings;
  };
  storage: {
    cachePath: string;
    recentProjectsLimit: number;
    clearCacheOnExit: boolean;
  };
  export: {
    defaultPresetId: string;
    defaultFolder: string;
    openFolderWhenDone: boolean;
  };
  shortcuts: ShortcutMap;
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  general: {
    language: 'en',
    autosaveSec: 60,
    confirmBeforeDestructive: true,
    showOnboarding: true,
  },
  appearance: {
    theme: 'dark',
    timelineDensity: 'comfortable',
    showWaveforms: true,
    showThumbnails: true,
  },
  performance: {
    previewQuality: 'balanced',
    hardwareAcceleration: true,
    thumbnailWorkers: 2,
    proxyEnabled: false,
    proxyHeight: 540,
    maxCacheGb: 10,
  },
  ai: {
    providerId: 'offline',
    ollamaUrl: 'http://127.0.0.1:11434',
    ollamaModel: 'qwen2.5:7b-instruct',
    llamacppUrl: 'http://127.0.0.1:8080',
    whisperModel: 'base.en',
    modelStoragePath: '',
    permissions: DEFAULT_PERMISSIONS,
  },
  storage: {
    cachePath: '',
    recentProjectsLimit: 20,
    clearCacheOnExit: false,
  },
  export: {
    defaultPresetId: 'youtube-1080',
    defaultFolder: '',
    openFolderWhenDone: true,
  },
  shortcuts: DEFAULT_SHORTCUTS,
};

const STORAGE_KEY = 'adzak.settings.v1';

function loadPersisted(): Settings {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return mergeSettings(DEFAULT_SETTINGS, parsed);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Deep-merge so a settings file from an older build still loads. */
function mergeSettings(base: Settings, patch: Partial<Settings>): Settings {
  const out = { ...base } as unknown as Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) continue;
    const current = out[key];
    if (typeof value === 'object' && !Array.isArray(value) && typeof current === 'object' && current !== null) {
      out[key] = { ...(current as Record<string, unknown>), ...(value as Record<string, unknown>) };
    } else {
      out[key] = value;
    }
  }
  return out as unknown as Settings;
}

interface SettingsState {
  settings: Settings;
  patch: <K extends keyof Settings>(section: K, values: Partial<Settings[K]>) => void;
  patchPermissions: (values: Partial<AiPermissionSettings>) => void;
  setShortcut: (action: keyof ShortcutMap, combo: string) => void;
  reset: () => void;
}

export const useSettings = create<SettingsState>((set, get) => ({
  settings: loadPersisted(),

  patch: (section, values) => {
    set((state) => {
      const current = state.settings[section] as object;
      return {
        settings: {
          ...state.settings,
          [section]: { ...current, ...(values as object) },
        } as Settings,
      };
    });
    persist(get().settings);
  },

  patchPermissions: (values) => {
    set((state) => ({
      settings: {
        ...state.settings,
        ai: { ...state.settings.ai, permissions: { ...state.settings.ai.permissions, ...values } },
      },
    }));
    persist(get().settings);
  },

  setShortcut: (action, combo) => {
    set((state) => ({
      settings: { ...state.settings, shortcuts: { ...state.settings.shortcuts, [action]: combo } },
    }));
    persist(get().settings);
  },

  reset: () => {
    set({ settings: DEFAULT_SETTINGS });
    persist(DEFAULT_SETTINGS);
  },
}));

function persist(settings: Settings): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage full or blocked; settings simply will not survive a restart.
  }
}
