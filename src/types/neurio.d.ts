/** Types for the Electron preload bridge (absent in browser mode). */
export interface NeurioBridge {
  isDesktop: true;
  version: string;
  platform: string;
  info(): Promise<{
    isDesktop: true;
    version: string;
    electron: string;
    node: string;
    platform: string;
    dataDir: string;
    serverUrl: string;
    isPackaged: boolean;
  }>;
  notify(title: string, body: string, channelId?: string): Promise<boolean>;
  setBadge(count: number): Promise<boolean>;
  openExternal(url: string): Promise<boolean>;
  pickFiles(): Promise<string[]>;
  saveFile(payload: { url: string; filename: string }): Promise<boolean>;
  setLaunchAtLogin(enabled: boolean): Promise<boolean>;
  setAlwaysOnTop(enabled: boolean): Promise<boolean>;
  minimiseToTray(): Promise<boolean>;
  showWindow(): Promise<boolean>;
}

declare global {
  interface Window {
    neurio?: NeurioBridge;
  }
}

export {};
