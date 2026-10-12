/**
 * Preload script — the only bridge between the renderer and Electron.
 * `contextIsolation` is on, so the renderer gets a tiny, explicit API and no
 * access to Node.
 */
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  isDesktop: true as const,
  version: process.env.NEURIO_APP_VERSION ?? '1.0.0',
  platform: process.platform,

  info: () =>
    ipcRenderer.invoke('neurio:info') as Promise<{
      isDesktop: true;
      version: string;
      electron: string;
      node: string;
      platform: string;
      dataDir: string;
      serverUrl: string;
      isPackaged: boolean;
    }>,

  notify: (title: string, body: string, channelId?: string) =>
    ipcRenderer.invoke('neurio:notify', { title, body, channelId }) as Promise<boolean>,

  setBadge: (count: number) => ipcRenderer.invoke('neurio:badge', count) as Promise<boolean>,

  openExternal: (url: string) => ipcRenderer.invoke('neurio:open-external', url) as Promise<boolean>,

  pickFiles: () => ipcRenderer.invoke('neurio:pick-files') as Promise<string[]>,

  saveFile: (payload: { url: string; filename: string }) =>
    ipcRenderer.invoke('neurio:save-file', payload) as Promise<boolean>,

  setLaunchAtLogin: (enabled: boolean) => ipcRenderer.invoke('neurio:set-login', enabled) as Promise<boolean>,

  setAlwaysOnTop: (enabled: boolean) => ipcRenderer.invoke('neurio:always-on-top', enabled) as Promise<boolean>,

  minimiseToTray: () => ipcRenderer.invoke('neurio:minimise-to-tray') as Promise<boolean>,

  showWindow: () => ipcRenderer.invoke('neurio:show-window') as Promise<boolean>,
};

contextBridge.exposeInMainWorld('neurio', api);

export type NeurioBridge = typeof api;
