import type { AppSettings, ProjectDoc, ProjectSummary } from '@/types';
import { composeLocally } from './localDesign';
import type { DesignBlueprint } from '@/types/design';

/**
 * Single access point to the desktop backend.
 *
 * In the packaged Electron app this is `window.lumora` (contextBridge, no node
 * in the renderer). When the same UI is opened in a plain browser (dev preview,
 * design review) a local fallback keeps the offline editor fully usable with
 * localStorage persistence. AI cloud calls are desktop-only by design — API
 * keys must never live in the renderer.
 */

type Envelope<T> = { ok: boolean; data?: T; error?: string };

export const isDesktop = typeof window !== 'undefined' && Boolean((window as any).lumora);

const LS = {
  projects: 'lumora.projects',
  settings: 'lumora.settings',
  templates: 'lumora.templates'
};

function lsGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
const lsSet = (key: string, value: unknown) => localStorage.setItem(key, JSON.stringify(value));

const defaultSettings: AppSettings = {
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

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `id-${Date.now()}-${Math.random()}`);
const webOnly = <T>(msg: string): Promise<Envelope<T>> =>
  Promise.resolve({ ok: false, error: msg });

const AI_DESKTOP_ONLY =
  'Cloud AI runs in the Lumora Studio desktop app, where your API key stays in the secure main process.';

function pickFiles(accept: string, multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}

const readAsDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(new Error('Could not read the file.'));
    fr.readAsDataURL(file);
  });

function downloadBase64(name: string, base64: string, ext: string) {
  const mime =
    ext === 'pdf' ? 'application/pdf' : ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : 'image/png';
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return name;
}

const summarize = (p: ProjectDoc): ProjectSummary => ({
  id: p.id,
  name: p.name,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
  pageCount: p.pages.length,
  width: p.pages[0]?.width ?? 0,
  height: p.pages[0]?.height ?? 0,
  thumbnail: p.pages[0]?.thumbnail ?? null
});

const webBridge = {
  app: {
    info: async () => ({
      version: '1.0.0-web',
      name: 'Lumora Studio',
      platform: 'web',
      electron: '-',
      chrome: '-',
      node: '-',
      dataDir: 'browser localStorage'
    }),
    isOnline: async () => navigator.onLine,
    openDataFolder: async () => '',
    openExternal: async (url: string) => {
      window.open(url, '_blank', 'noopener');
    },
    storageUsage: async () => ({
      bytes: new Blob([localStorage.getItem(LS.projects) ?? '']).size,
      path: 'browser localStorage'
    })
  },
  projects: {
    list: async () =>
      lsGet<ProjectDoc[]>(LS.projects, [])
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .map(summarize),
    get: async (id: string) => lsGet<ProjectDoc[]>(LS.projects, []).find((p) => p.id === id) ?? null,
    create: async (doc: any) => {
      const now = Date.now();
      const next: ProjectDoc = { ...doc, id: uid(), createdAt: now, updatedAt: now, format: 'lumora/project@1' };
      lsSet(LS.projects, [...lsGet<ProjectDoc[]>(LS.projects, []), next]);
      return next;
    },
    save: async (doc: ProjectDoc) => {
      const all = lsGet<ProjectDoc[]>(LS.projects, []);
      const next = { ...doc, updatedAt: Date.now() };
      const idx = all.findIndex((p) => p.id === doc.id);
      if (idx >= 0) all[idx] = next;
      else all.push(next);
      lsSet(LS.projects, all);
      return summarize(next);
    },
    rename: async (id: string, name: string) => {
      const all = lsGet<ProjectDoc[]>(LS.projects, []);
      const p = all.find((x) => x.id === id);
      if (!p) throw new Error('Project not found');
      p.name = name;
      p.updatedAt = Date.now();
      lsSet(LS.projects, all);
      return summarize(p);
    },
    duplicate: async (id: string) => {
      const all = lsGet<ProjectDoc[]>(LS.projects, []);
      const src = all.find((x) => x.id === id);
      if (!src) throw new Error('Project not found');
      const copy: ProjectDoc = { ...src, id: uid(), name: `${src.name} (copy)`, updatedAt: Date.now() };
      lsSet(LS.projects, [...all, copy]);
      return copy;
    },
    remove: async (id: string) => {
      lsSet(
        LS.projects,
        lsGet<ProjectDoc[]>(LS.projects, []).filter((p) => p.id !== id)
      );
      return true;
    },
    exportFile: async (id: string, name: string) => {
      const doc = lsGet<ProjectDoc[]>(LS.projects, []).find((p) => p.id === id);
      if (!doc) throw new Error('Project not found');
      downloadBase64(`${name}.lumora.json`, btoa(unescape(encodeURIComponent(JSON.stringify(doc, null, 2)))), 'json');
      return name;
    },
    importFile: async () => {
      const [file] = await pickFiles('application/json', false);
      if (!file) return null;
      const doc = JSON.parse(await file.text()) as ProjectDoc;
      doc.id = uid();
      lsSet(LS.projects, [...lsGet<ProjectDoc[]>(LS.projects, []), doc]);
      return doc;
    }
  },
  templates: {
    list: async () => lsGet<any[]>(LS.templates, []),
    save: async (t: any) => {
      const next = { ...t, id: uid(), custom: true, createdAt: Date.now() };
      lsSet(LS.templates, [...lsGet<any[]>(LS.templates, []), next]);
      return next;
    },
    remove: async (id: string) => {
      lsSet(
        LS.templates,
        lsGet<any[]>(LS.templates, []).filter((t) => t.id !== id)
      );
      return true;
    }
  },
  files: {
    pickImages: async () => {
      const files = await pickFiles('image/png,image/jpeg,image/webp,image/gif,image/svg+xml', true);
      return Promise.all(files.map(async (f) => ({ name: f.name, dataUrl: await readAsDataUrl(f) })));
    },
    readImage: async () => {
      throw new Error('Not available in the browser preview.');
    },
    pickFonts: async () => {
      const files = await pickFiles('.ttf,.otf,.woff,.woff2', true);
      return Promise.all(
        files.map(async (f) => ({ family: f.name.replace(/\.[^.]+$/, ''), dataUrl: await readAsDataUrl(f) }))
      );
    },
    saveAsset: async (_name: string, dataUrl: string) => dataUrl,
    exportBinary: async (name: string, base64: string, ext: string) => downloadBase64(name, base64, ext),
    showItem: async () => undefined
  },
  settings: {
    get: async () => ({ ...defaultSettings, ...lsGet<Partial<AppSettings>>(LS.settings, {}) }) as AppSettings,
    update: async (patch: Partial<AppSettings>) => {
      const next = { ...defaultSettings, ...lsGet<Partial<AppSettings>>(LS.settings, {}), ...patch } as AppSettings;
      lsSet(LS.settings, next);
      return next;
    },
    reset: async () => {
      lsSet(LS.settings, defaultSettings);
      return defaultSettings;
    }
  },
  secrets: {
    status: async () => ({ openai: false, google: false, custom: false, removebg: false }),
    set: async (_provider: string, _value: string): Promise<Record<string, boolean>> => {
      throw new Error(AI_DESKTOP_ONLY);
    }
  },
  ai: {
    text: (_task: string, _input: string, _extra?: string) => webOnly<string>(AI_DESKTOP_ONLY),
    image: (_req: unknown) => webOnly<{ dataUrl: string }>(AI_DESKTOP_ONLY),
    removeBackground: (_dataUrl: string) => webOnly<string>(AI_DESKTOP_ONLY),
    upscale: (_dataUrl: string, _scale?: 2 | 4) => webOnly<string>(AI_DESKTOP_ONLY),
    design: async (req: any): Promise<Envelope<{ blueprint: DesignBlueprint; source: 'ai' | 'offline' }>> => ({
      ok: true,
      data: { blueprint: composeLocally(req), source: 'offline' }
    }),
    regenerateText: (_current: string, _brief: string) => webOnly<string>(AI_DESKTOP_ONLY)
  },
  on: (_channel: 'menu:action', _cb: (payload: string) => void): (() => void) => () => undefined
};

export const bridge: typeof webBridge = (isDesktop ? (window as any).lumora : webBridge) as typeof webBridge;
