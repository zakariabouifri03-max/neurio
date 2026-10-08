import type {
  AiBackgroundRemovalRequest,
  AiImageRequest,
  AiImageResult,
  AiStatus,
  AiTextRequest,
  AiTextResult,
  AiUpscaleRequest,
  DesignGeneratorOptions,
  DesignPlan
} from './types/ai'
import type { ExportRequest, ExportResult } from './types/export'
import type {
  AssetRecord,
  CreateProjectInput,
  Project,
  ProjectMeta,
  SaveProjectInput,
  TemplateMeta,
  TemplateRecord
} from './types/project'
import type { AppSettings, AiCapability, AiProviderId, ProviderDescriptor, PublicSettings } from './types/settings'

/** Every renderer → main channel. The preload only exposes these. */
export const IPC = {
  PROJECTS_LIST: 'projects:list',
  PROJECTS_CREATE: 'projects:create',
  PROJECTS_READ: 'projects:read',
  PROJECTS_SAVE: 'projects:save',
  PROJECTS_DUPLICATE: 'projects:duplicate',
  PROJECTS_DELETE: 'projects:delete',
  PROJECTS_RENAME: 'projects:rename',

  TEMPLATES_LIST: 'templates:list',
  TEMPLATES_READ: 'templates:read',
  TEMPLATES_CREATE: 'templates:create',
  TEMPLATES_DELETE: 'templates:delete',

  ASSETS_IMPORT_FILES: 'assets:import-files',
  ASSETS_IMPORT_DATA_URL: 'assets:import-data-url',
  ASSETS_LIST: 'assets:list',
  ASSETS_DELETE: 'assets:delete',

  FONTS_LIST: 'fonts:list',
  FONTS_IMPORT: 'fonts:import',

  EXPORT_WRITE: 'export:write',
  EXPORT_DIRECTORY: 'export:directory',

  DIALOG_OPEN_IMAGES: 'dialogs:open-images',
  DIALOG_OPEN_FONTS: 'dialogs:open-fonts',
  DIALOG_OPEN_SVG: 'dialogs:open-svg',
  DIALOG_READ_TEXT: 'dialogs:read-text',

  SETTINGS_GET: 'settings:get',
  SETTINGS_UPDATE: 'settings:update',
  SETTINGS_SET_KEY: 'settings:set-key',
  SETTINGS_CLEAR_KEY: 'settings:clear-key',
  SETTINGS_TEST_PROVIDER: 'settings:test-provider',
  SETTINGS_FIRST_RUN_DONE: 'settings:first-run-done',
  SETTINGS_OPEN_DATA_DIR: 'settings:open-data-dir',

  AI_STATUS: 'ai:status',
  AI_PROVIDERS: 'ai:providers',
  AI_TEXT: 'ai:text',
  AI_IMAGE: 'ai:image',
  AI_REMOVE_BG: 'ai:remove-background',
  AI_UPSCALE: 'ai:upscale',
  AI_DESIGN: 'ai:design',

  SYSTEM_INFO: 'system:info',
  SYSTEM_ONLINE: 'system:online',
  SYSTEM_OPEN_EXTERNAL: 'system:open-external',
  SYSTEM_SHOW_ITEM: 'system:show-item',
  SYSTEM_QUIT: 'system:quit',
  SYSTEM_MINIMIZE: 'system:minimize',
  SYSTEM_MAXIMIZE: 'system:maximize',
  SYSTEM_CLOSE: 'system:close'
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]
export const IPC_CHANNELS: readonly string[] = Object.values(IPC)

export interface IpcErrorPayload {
  code: string
  message: string
  details?: string
}

/** Result envelope — the only shape that crosses the IPC boundary. */
export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcErrorPayload }

export class KromaError extends Error {
  readonly code: string
  readonly details?: string
  constructor(code: string, message: string, details?: string) {
    super(message)
    this.name = 'KromaError'
    this.code = code
    this.details = details
  }
}

export interface FontFamily {
  family: string
  subfamily?: string
  file: string
  weight?: number
  style?: string
  source: 'system' | 'user'
  /** data: URL for user fonts so the renderer can register a FontFace */
  dataUrl?: string
}

export interface SystemInfo {
  appVersion: string
  electronVersion: string
  chromeVersion: string
  nodeVersion: string
  platform: NodeJS.Platform | 'web'
  arch: string
  dataDir: string
  isPackaged: boolean
}

export interface ProviderTestResult {
  ok: boolean
  message: string
  model?: string
}

export interface SaveBlobInput {
  request: ExportRequest
  /** Page index → data URL / pdf data URL */
  files: Array<{ fileName: string; dataUrl: string }>
  directory?: string
}

export interface KromaApi {
  readonly meta: { isDesktop: true; version: string }
  projects: {
    list(): Promise<ProjectMeta[]>
    create(input: CreateProjectInput): Promise<Project>
    read(id: string): Promise<Project | null>
    save(input: SaveProjectInput): Promise<ProjectMeta>
    duplicate(id: string): Promise<ProjectMeta>
    remove(id: string): Promise<{ ok: boolean }>
    rename(id: string, name: string): Promise<ProjectMeta>
  }
  templates: {
    list(): Promise<TemplateMeta[]>
    read(id: string): Promise<TemplateRecord | null>
    create(input: { name: string; category: string; document: unknown; thumbnail?: string | null }): Promise<TemplateMeta>
    remove(id: string): Promise<{ ok: boolean }>
  }
  assets: {
    importFiles(paths: string[]): Promise<AssetRecord[]>
    importDataUrl(dataUrl: string, name?: string): Promise<AssetRecord>
    list(): Promise<AssetRecord[]>
    remove(id: string): Promise<{ ok: boolean }>
  }
  fonts: {
    list(force?: boolean): Promise<FontFamily[]>
    importFiles(paths: string[]): Promise<FontFamily[]>
  }
  export: {
    write(input: SaveBlobInput): Promise<ExportResult>
    chooseDirectory(defaultName: string): Promise<string | null>
  }
  dialogs: {
    openImages(): Promise<string[]>
    openFonts(): Promise<string[]>
    openSvg(): Promise<string[]>
    readTextFile(path: string): Promise<{ name: string; text: string } | null>
  }
  settings: {
    get(): Promise<PublicSettings>
    update(patch: Partial<AppSettings>): Promise<PublicSettings>
    setKey(provider: AiProviderId, key: string, extra?: { baseUrl?: string; model?: string; enabled?: boolean }): Promise<PublicSettings>
    clearKey(provider: AiProviderId): Promise<PublicSettings>
    testProvider(provider: AiProviderId, capability?: AiCapability): Promise<ProviderTestResult>
    markFirstRunComplete(): Promise<PublicSettings>
    openDataDir(): Promise<string>
  }
  ai: {
    status(): Promise<AiStatus>
    providers(): Promise<ProviderDescriptor[]>
    text(request: AiTextRequest): Promise<AiTextResult>
    image(request: AiImageRequest): Promise<AiImageResult>
    removeBackground(request: AiBackgroundRemovalRequest): Promise<AiImageResult>
    upscale(request: AiUpscaleRequest): Promise<AiImageResult>
    design(options: DesignGeneratorOptions): Promise<DesignPlan>
  }
  system: {
    info(): Promise<SystemInfo>
    online(): Promise<boolean>
    openExternal(url: string): Promise<void>
    showItem(path: string): Promise<void>
    quit(): Promise<void>
    minimize(): Promise<void>
    maximize(): Promise<void>
    close(): Promise<void>
    onConnectivity(handler: (online: boolean) => void): () => void
    onMenuAction(handler: (action: MenuAction) => void): () => void
  }
}

export type MenuAction =
  | 'undo'
  | 'redo'
  | 'save'
  | 'export'
  | 'preview'
  | 'copy'
  | 'paste'
  | 'duplicate'
  | 'delete'
  | 'select-all'
  | 'group'
  | 'ungroup'
  | 'new-design'
  | 'open-project'
  | 'settings'

export const MENU_ACTION_CHANNEL = 'menu:action'
export const CONNECTIVITY_CHANNEL = 'system:connectivity'

declare global {
  interface Window {
    kroma?: KromaApi
  }
}
