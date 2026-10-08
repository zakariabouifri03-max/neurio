import { contextBridge, ipcRenderer } from 'electron';

type Envelope<T> = { ok: boolean; data?: T; error?: string };

/** Unwrap main-process envelopes, converting failures into real exceptions. */
async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const res = (await ipcRenderer.invoke(channel, ...args)) as Envelope<T>;
  if (!res?.ok) throw new Error(res?.error ?? 'Operation failed.');
  return res.data as T;
}

const api = {
  app: {
    info: () => call<any>('app:info'),
    isOnline: () => call<boolean>('app:online'),
    openDataFolder: () => call<string>('app:openDataFolder'),
    openExternal: (url: string) => call<void>('app:openExternal', url),
    storageUsage: () => call<{ bytes: number; path: string }>('app:storageUsage')
  },
  projects: {
    list: () => call<any[]>('projects:list'),
    get: (id: string) => call<any>('projects:get', id),
    create: (doc: unknown) => call<any>('projects:create', doc),
    save: (doc: unknown) => call<any>('projects:save', doc),
    rename: (id: string, name: string) => call<any>('projects:rename', id, name),
    duplicate: (id: string) => call<any>('projects:duplicate', id),
    remove: (id: string) => call<boolean>('projects:delete', id),
    exportFile: (id: string, name: string) => call<string | null>('projects:exportFile', id, name),
    importFile: () => call<any>('projects:importFile')
  },
  templates: {
    list: () => call<any[]>('templates:list'),
    save: (t: unknown) => call<any>('templates:save', t),
    remove: (id: string) => call<boolean>('templates:delete', id)
  },
  files: {
    pickImages: () => call<{ name: string; dataUrl: string }[]>('files:pickImages'),
    readImage: (p: string) => call<{ name: string; dataUrl: string }>('files:readImage', p),
    pickFonts: () => call<{ family: string; dataUrl: string }[]>('files:pickFonts'),
    saveAsset: (name: string, dataUrl: string) => call<string>('files:saveAsset', name, dataUrl),
    exportBinary: (name: string, base64: string, ext: string) =>
      call<string | null>('files:exportBinary', name, base64, ext),
    showItem: (p: string) => call<void>('files:showItem', p)
  },
  settings: {
    get: () => call<any>('settings:get'),
    update: (patch: unknown) => call<any>('settings:update', patch),
    reset: () => call<any>('settings:reset')
  },
  secrets: {
    status: () => call<Record<string, boolean>>('secrets:status'),
    set: (provider: string, value: string) => call<Record<string, boolean>>('secrets:set', provider, value)
  },
  ai: {
    text: (task: string, input: string, extra?: string) =>
      ipcRenderer.invoke('ai:text', task, input, extra) as Promise<Envelope<string>>,
    image: (req: unknown) => ipcRenderer.invoke('ai:image', req) as Promise<Envelope<{ dataUrl: string }>>,
    removeBackground: (dataUrl: string) =>
      ipcRenderer.invoke('ai:removeBackground', dataUrl) as Promise<Envelope<string>>,
    upscale: (dataUrl: string, scale: 2 | 4) =>
      ipcRenderer.invoke('ai:upscale', dataUrl, scale) as Promise<Envelope<string>>,
    design: (req: unknown) => ipcRenderer.invoke('ai:design', req) as Promise<Envelope<any>>,
    regenerateText: (current: string, brief: string) =>
      ipcRenderer.invoke('ai:regenerateText', current, brief) as Promise<Envelope<string>>
  },
  on: (channel: 'menu:action', cb: (payload: string) => void) => {
    const allowed = ['menu:action'];
    if (!allowed.includes(channel)) return () => undefined;
    const listener = (_e: unknown, payload: string) => cb(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  }
};

contextBridge.exposeInMainWorld('lumora', api);
export type LumoraApi = typeof api;
