import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { BRAND } from '../shared/brand'
import { CONNECTIVITY_CHANNEL, IPC, IPC_CHANNELS, KromaError, MENU_ACTION_CHANNEL, type IpcResult, type KromaApi, type MenuAction } from '../shared/ipc'

const ALLOWED = new Set<string>([...IPC_CHANNELS, MENU_ACTION_CHANNEL, CONNECTIVITY_CHANNEL])

/** Every call goes through here: channel whitelist + structured error unwrap. */
async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  if (!ALLOWED.has(channel)) throw new KromaError('FORBIDDEN', `Blocked IPC channel: ${channel}`)
  const result = (await ipcRenderer.invoke(channel, ...args)) as IpcResult<T>
  if (!result || typeof result !== 'object' || !('ok' in result)) {
    throw new KromaError('BAD_RESPONSE', 'The app returned an unexpected response.')
  }
  if (!result.ok) throw new KromaError(result.error.code, result.error.message, result.error.details)
  return result.value
}

const subscribe = <T,>(channel: string, handler: (payload: T) => void): (() => void) => {
  if (!ALLOWED.has(channel)) return () => {}
  const listener = (_event: IpcRendererEvent, payload: T): void => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: KromaApi = {
  meta: { isDesktop: true, version: BRAND.version },
  projects: {
    list: () => invoke(IPC.PROJECTS_LIST),
    create: (input) => invoke(IPC.PROJECTS_CREATE, input),
    read: (id) => invoke(IPC.PROJECTS_READ, id),
    save: (input) => invoke(IPC.PROJECTS_SAVE, input),
    duplicate: (id) => invoke(IPC.PROJECTS_DUPLICATE, id),
    remove: (id) => invoke(IPC.PROJECTS_DELETE, id),
    rename: (id, name) => invoke(IPC.PROJECTS_RENAME, id, name)
  },
  templates: {
    list: () => invoke(IPC.TEMPLATES_LIST),
    read: (id) => invoke(IPC.TEMPLATES_READ, id),
    create: (input) => invoke(IPC.TEMPLATES_CREATE, input),
    remove: (id) => invoke(IPC.TEMPLATES_DELETE, id)
  },
  assets: {
    importFiles: (paths) => invoke(IPC.ASSETS_IMPORT_FILES, paths),
    importDataUrl: (dataUrl, name) => invoke(IPC.ASSETS_IMPORT_DATA_URL, dataUrl, name),
    list: () => invoke(IPC.ASSETS_LIST),
    remove: (id) => invoke(IPC.ASSETS_DELETE, id)
  },
  fonts: {
    list: () => invoke(IPC.FONTS_LIST, true),
    importFiles: (paths) => invoke(IPC.FONTS_IMPORT, paths)
  },
  export: {
    write: (input) => invoke(IPC.EXPORT_WRITE, input),
    chooseDirectory: (defaultName) => invoke(IPC.EXPORT_DIRECTORY, defaultName)
  },
  dialogs: {
    openImages: () => invoke(IPC.DIALOG_OPEN_IMAGES),
    openFonts: () => invoke(IPC.DIALOG_OPEN_FONTS),
    openSvg: () => invoke(IPC.DIALOG_OPEN_SVG),
    readTextFile: (path) => invoke(IPC.DIALOG_READ_TEXT, path)
  },
  settings: {
    get: () => invoke(IPC.SETTINGS_GET),
    update: (patch) => invoke(IPC.SETTINGS_UPDATE, patch),
    setKey: (provider, key, extra) => invoke(IPC.SETTINGS_SET_KEY, provider, key, extra),
    clearKey: (provider) => invoke(IPC.SETTINGS_CLEAR_KEY, provider),
    testProvider: (provider) => invoke(IPC.SETTINGS_TEST_PROVIDER, provider),
    markFirstRunComplete: () => invoke(IPC.SETTINGS_FIRST_RUN_DONE),
    openDataDir: () => invoke(IPC.SETTINGS_OPEN_DATA_DIR)
  },
  ai: {
    status: () => invoke(IPC.AI_STATUS),
    providers: () => invoke(IPC.AI_PROVIDERS),
    text: (request) => invoke(IPC.AI_TEXT, request),
    image: (request) => invoke(IPC.AI_IMAGE, request),
    removeBackground: (request) => invoke(IPC.AI_REMOVE_BG, request),
    upscale: (request) => invoke(IPC.AI_UPSCALE, request),
    design: (options) => invoke(IPC.AI_DESIGN, options)
  },
  system: {
    info: () => invoke(IPC.SYSTEM_INFO),
    online: () => invoke(IPC.SYSTEM_ONLINE),
    openExternal: (url) => invoke(IPC.SYSTEM_OPEN_EXTERNAL, url),
    showItem: (path) => invoke(IPC.SYSTEM_SHOW_ITEM, path),
    quit: () => invoke(IPC.SYSTEM_QUIT),
    minimize: () => invoke(IPC.SYSTEM_MINIMIZE),
    maximize: () => invoke(IPC.SYSTEM_MAXIMIZE),
    close: () => invoke(IPC.SYSTEM_CLOSE),
    onConnectivity: (handler) => subscribe<boolean>(CONNECTIVITY_CHANNEL, handler),
    onMenuAction: (handler) => subscribe<MenuAction>(MENU_ACTION_CHANNEL, handler)
  }
}

contextBridge.exposeInMainWorld('kroma', api)
