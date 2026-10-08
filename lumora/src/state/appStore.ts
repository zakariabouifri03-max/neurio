import { create } from 'zustand';
import { bridge, isDesktop } from '@/lib/bridge';
import type { AppSettings, Toast } from '@/types';

type Route = 'home' | 'editor' | 'settings';

interface AppState {
  route: Route;
  settings: AppSettings | null;
  secretStatus: Record<string, boolean>;
  online: boolean;
  toasts: Toast[];
  appInfo: any;
  ready: boolean;
  init: () => Promise<void>;
  go: (route: Route) => void;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
  refreshSecrets: () => Promise<void>;
  toast: (message: string, kind?: Toast['kind']) => void;
  dismiss: (id: string) => void;
}

const uid = () => Math.random().toString(36).slice(2);

export const useApp = create<AppState>((set, get) => ({
  route: 'home',
  settings: null,
  secretStatus: {},
  online: typeof navigator !== 'undefined' ? navigator.onLine : false,
  toasts: [],
  appInfo: null,
  ready: false,

  async init() {
    const [settings, appInfo] = await Promise.all([bridge.settings.get(), bridge.app.info()]);
    let secretStatus: Record<string, boolean> = {};
    try {
      secretStatus = await bridge.secrets.status();
    } catch {
      /* non-fatal */
    }
    const online = await bridge.app.isOnline().catch(() => navigator.onLine);
    set({ settings, appInfo, secretStatus, online, ready: true });

    window.addEventListener('online', () => set({ online: true }));
    window.addEventListener('offline', () => set({ online: false }));
    if (isDesktop) {
      window.setInterval(async () => {
        const next = await bridge.app.isOnline().catch(() => navigator.onLine);
        if (next !== get().online) set({ online: next });
      }, 15000);
    }
  },

  go(route) {
    set({ route });
  },

  async updateSettings(patch) {
    const settings = await bridge.settings.update(patch);
    set({ settings });
  },

  async refreshSecrets() {
    try {
      set({ secretStatus: await bridge.secrets.status() });
    } catch {
      /* ignore */
    }
  },

  toast(message, kind = 'info') {
    const t: Toast = { id: uid(), kind, message };
    set({ toasts: [...get().toasts, t] });
    window.setTimeout(() => get().dismiss(t.id), kind === 'error' ? 7000 : 3500);
  },

  dismiss(id) {
    set({ toasts: get().toasts.filter((t) => t.id !== id) });
  }
}));
