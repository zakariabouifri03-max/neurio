import { create } from 'zustand'
import type { AiStatus } from '../../../shared/types/ai'
import type { ProjectMeta, TemplateMeta } from '../../../shared/types/project'
import type { AppSettings, PublicSettings } from '../../../shared/types/settings'
import type { FontFamily, SystemInfo } from '../../../shared/ipc'
import { DEFAULT_SETTINGS } from '../../../shared/types/settings'
import { platform } from '../platform'

export type Route = 'welcome' | 'editor' | 'settings'
export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

export interface AppState {
  ready: boolean
  route: Route
  settings: PublicSettings
  systemInfo: SystemInfo | null
  online: boolean
  aiStatus: AiStatus | null

  projects: ProjectMeta[]
  templates: TemplateMeta[]
  fonts: FontFamily[]
  currentProjectId: string | null
  saveState: SaveState
  lastSavedAt: number | null
  autoSaveEnabled: boolean

  init: () => Promise<void>
  refreshProjects: () => Promise<void>
  refreshTemplates: () => Promise<void>
  refreshFonts: (force?: boolean) => Promise<void>
  refreshAi: () => Promise<void>
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  setRoute: (route: Route) => void
  setCurrentProject: (id: string | null) => void
  setSaveState: (state: SaveState) => void
  setOnline: (online: boolean) => void
}

/** Applies theme + accent tokens to the document root. */
export function applyAppearance(settings: PublicSettings): void {
  const root = document.documentElement
  const theme = settings.appearance.theme === 'system'
    ? window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark'
    : settings.appearance.theme
  root.dataset.theme = theme
  root.style.setProperty('--k-accent', settings.appearance.accent)
  root.style.setProperty('--k-ui-scale', String(settings.appearance.uiScale))
  root.style.fontSize = `${Math.round(settings.appearance.uiScale * 100)}%`
}

export const useAppStore = create<AppState>((set, get) => ({
  ready: false,
  route: 'welcome',
  settings: {
    ...structuredClone(DEFAULT_SETTINGS),
    ai: { routing: DEFAULT_SETTINGS.ai.routing, allowOfflineFallback: true, requestTimeoutMs: DEFAULT_SETTINGS.ai.requestTimeoutMs, providers: {} }
  },
  systemInfo: null,
  online: true,
  aiStatus: null,
  projects: [],
  templates: [],
  fonts: [],
  currentProjectId: null,
  saveState: 'idle',
  lastSavedAt: null,
  autoSaveEnabled: DEFAULT_SETTINGS.general.autoSave,

  init: async () => {
    const [settings, info, projects, templates, online] = await Promise.all([
      platform.settings.get(),
      platform.system.info(),
      platform.projects.list(),
      platform.templates.list(),
      platform.system.online()
    ])
    applyAppearance(settings)
    set({
      settings,
      systemInfo: info,
      projects,
      templates,
      online,
      autoSaveEnabled: settings.general.autoSave,
      ready: true
    })
    void get().refreshAi()
    void get().refreshFonts()
  },

  refreshProjects: async () => set({ projects: await platform.projects.list() }),
  refreshTemplates: async () => set({ templates: await platform.templates.list() }),
  refreshFonts: async (force) => {
    try {
      set({ fonts: await platform.fonts.list(force) })
    } catch {
      set({ fonts: [] })
    }
  },
  refreshAi: async () => {
    try {
      set({ aiStatus: await platform.ai.status() })
    } catch {
      set({ aiStatus: null })
    }
  },
  updateSettings: async (patch) => {
    const next = await platform.settings.update(patch)
    applyAppearance(next)
    set({ settings: next, autoSaveEnabled: next.general.autoSave })
  },
  setRoute: (route) => set({ route }),
  setCurrentProject: (id) => set({ currentProjectId: id }),
  setSaveState: (state) => set({ saveState: state, lastSavedAt: state === 'saved' ? Date.now() : get().lastSavedAt }),
  setOnline: (online) => set({ online })
}))
