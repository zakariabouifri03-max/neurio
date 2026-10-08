import path from 'node:path';
import { dataDir, readJSON, writeJSON } from './store';
import type { AppSettings } from '../shared/types';

const file = () => path.join(dataDir(), 'settings.json');

export const defaultSettings: AppSettings = {
  theme: 'dark',
  accent: '#7c5cff',
  autoSave: true,
  autoSaveIntervalMs: 4000,
  defaultExportFormat: 'png',
  defaultExportScale: 2,
  defaultExportQuality: 0.92,
  showGrid: false,
  snapToGrid: true,
  gridSize: 20,
  safeAreaGuides: false,
  hardwareAcceleration: true,
  maxUndoSteps: 60,
  firstRunComplete: false,
  ai: {
    textProvider: 'openai',
    imageProvider: 'openai',
    backgroundRemovalProvider: 'local',
    upscaleProvider: 'local',
    removeBgUrl: '',
    upscaleUrl: '',
    openaiBaseUrl: 'https://api.openai.com/v1',
    openaiTextModel: 'gpt-4o-mini',
    openaiImageModel: 'gpt-image-1',
    googleBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    googleTextModel: 'gemini-2.0-flash',
    googleImageModel: 'imagen-3.0-generate-002',
    customBaseUrl: '',
    customTextModel: '',
    customImageModel: ''
  }
};

export const settings = {
  get(): AppSettings {
    const stored = readJSON<Partial<AppSettings>>(file(), {});
    return { ...defaultSettings, ...stored, ai: { ...defaultSettings.ai, ...(stored.ai ?? {}) } };
  },
  update(patch: Partial<AppSettings>): AppSettings {
    const next: AppSettings = {
      ...settings.get(),
      ...patch,
      ai: { ...settings.get().ai, ...(patch.ai ?? {}) }
    };
    writeJSON(file(), next);
    return next;
  },
  reset(): AppSettings {
    writeJSON(file(), defaultSettings);
    return defaultSettings;
  }
};
