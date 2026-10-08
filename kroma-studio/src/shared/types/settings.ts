/**
 * Settings are split into a public projection (safe for the renderer) and the
 * private record that lives encrypted in the main process. API keys NEVER
 * leave the main process.
 */

export type AiProviderId =
  | 'openai'
  | 'google'
  | 'stability'
  | 'removebg'
  | 'clipdrop'
  | 'custom'
  | 'offline'

export type AiCapability = 'text' | 'image' | 'background' | 'upscale'

export interface ProviderDescriptor {
  id: AiProviderId
  label: string
  capabilities: AiCapability[]
  keyLabel?: string
  keyPlaceholder?: string
  helpUrl?: string
  models: string[]
  /** Whether a custom base URL may be supplied. */
  allowBaseUrl: boolean
  builtin: boolean
}

export interface ProviderSettings {
  /** Secret. Stored encrypted; never returned to the renderer. */
  apiKey?: string
  baseUrl?: string
  model?: string
  enabled?: boolean
}

export interface AiSettings {
  providers: Partial<Record<AiProviderId, ProviderSettings>>
  /** Which provider serves which capability. */
  routing: Record<AiCapability, AiProviderId>
  /** Deterministic layout/text fallback when no provider is configured. */
  allowOfflineFallback: boolean
  requestTimeoutMs: number
}

export interface AppearanceSettings {
  theme: 'dark' | 'light' | 'system'
  accent: string
  uiScale: number
  showGrid: boolean
  showGuides: boolean
  showSafeArea: boolean
  snapToGrid: boolean
  snapToObjects: boolean
  gridSize: number
  rulers: boolean
}

export interface GeneralSettings {
  language: 'en'
  openLastProject: boolean
  confirmDelete: boolean
  telemetry: false
  autoSave: boolean
  autoSaveIntervalMs: number
}

export interface StorageSettings {
  dataDir: string
  keepBackups: number
  clearAssetCacheOnExit: boolean
}

export interface ExportSettings {
  format: 'png' | 'jpg' | 'webp' | 'pdf'
  quality: number
  scale: number
  transparent: boolean
  includeAllPages: boolean
  lastDirectory?: string | null
}

export interface PerformanceSettings {
  imageCacheSizeMb: number
  lazyImageLoading: boolean
  objectCaching: boolean
  hardwareAcceleration: boolean
  renderDebounceMs: number
}

export interface ShortcutSettings {
  undo: string
  redo: string
  save: string
  copy: string
  paste: string
  duplicate: string
  delete: string
  selectAll: string
  group: string
  ungroup: string
  export: string
  preview: string
}

export interface AppSettings {
  general: GeneralSettings
  appearance: AppearanceSettings
  storage: StorageSettings
  ai: AiSettings
  export: ExportSettings
  performance: PerformanceSettings
  shortcuts: ShortcutSettings
  firstRunCompleted: boolean
}

/** Renderer-safe projection: keys are replaced by presence booleans. */
export interface PublicSettings extends Omit<AppSettings, 'ai'> {
  ai: Omit<AiSettings, 'providers'> & {
    providers: Partial<Record<AiProviderId, Omit<ProviderSettings, 'apiKey'> & { hasKey: boolean }>>
  }
}

export const DEFAULT_SHORTCUTS: ShortcutSettings = {
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Shift+Z',
  save: 'Ctrl+S',
  copy: 'Ctrl+C',
  paste: 'Ctrl+V',
  duplicate: 'Ctrl+D',
  delete: 'Delete',
  selectAll: 'Ctrl+A',
  group: 'Ctrl+G',
  ungroup: 'Ctrl+Shift+G',
  export: 'Ctrl+E',
  preview: 'Ctrl+P'
}

export const DEFAULT_SETTINGS: AppSettings = {
  general: {
    language: 'en',
    openLastProject: true,
    confirmDelete: true,
    telemetry: false,
    autoSave: true,
    autoSaveIntervalMs: 1200
  },
  appearance: {
    theme: 'dark',
    accent: '#7C5CFF',
    uiScale: 1,
    showGrid: true,
    showGuides: true,
    showSafeArea: false,
    snapToGrid: true,
    snapToObjects: true,
    gridSize: 24,
    rulers: false
  },
  storage: {
    dataDir: '',
    keepBackups: 5,
    clearAssetCacheOnExit: false
  },
  ai: {
    providers: {},
    routing: { text: 'offline', image: 'offline', background: 'offline', upscale: 'offline' },
    allowOfflineFallback: true,
    requestTimeoutMs: 90000
  },
  export: {
    format: 'png',
    quality: 0.92,
    scale: 1,
    transparent: false,
    includeAllPages: true,
    lastDirectory: null
  },
  performance: {
    imageCacheSizeMb: 512,
    lazyImageLoading: true,
    objectCaching: true,
    hardwareAcceleration: true,
    renderDebounceMs: 16
  },
  shortcuts: { ...DEFAULT_SHORTCUTS },
  firstRunCompleted: false
}
