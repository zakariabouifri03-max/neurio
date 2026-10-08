import { create } from 'zustand';
import { bridge } from '@/lib/bridge';
import { engine } from '@/editor/engine';
import type { LayerInfo, PageDoc, ProjectDoc, SelectionProps } from '@/types';
import { useApp } from './appStore';

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `p-${Math.random().toString(36).slice(2)}`);

export const blankPage = (name: string, width: number, height: number, background: string | null = '#ffffff'): PageDoc => ({
  id: uid(),
  name,
  width,
  height,
  background,
  scene: { version: '6', objects: [] },
  thumbnail: null
});

export type LeftTab =
  | 'templates'
  | 'elements'
  | 'text'
  | 'uploads'
  | 'ai'
  | 'backgrounds'
  | 'shapes'
  | 'icons'
  | 'projects'
  | 'brand';

interface EditorState {
  project: ProjectDoc | null;
  activePage: number;
  dirty: boolean;
  saving: boolean;
  lastSavedAt: number | null;
  selection: SelectionProps | null;
  layers: LayerInfo[];
  zoom: number;
  leftTab: LeftTab;
  rightTab: 'design' | 'layers';
  previewOpen: boolean;
  exportOpen: boolean;
  canUndo: boolean;
  canRedo: boolean;
  uploads: { name: string; dataUrl: string }[];
  fonts: string[];

  setProject: (doc: ProjectDoc) => Promise<void>;
  newProject: (name: string, width: number, height: number, background?: string | null) => Promise<void>;
  openProject: (id: string) => Promise<void>;
  save: (silent?: boolean) => Promise<void>;
  renameProject: (name: string) => void;
  markDirty: () => void;
  syncFromEngine: () => void;

  gotoPage: (index: number) => Promise<void>;
  addPage: (width?: number, height?: number) => Promise<void>;
  duplicatePage: (index: number) => Promise<void>;
  deletePage: (index: number) => Promise<void>;
  movePage: (from: number, to: number) => void;
  resizePage: (width: number, height: number) => void;

  setLeftTab: (tab: LeftTab) => void;
  setRightTab: (tab: 'design' | 'layers') => void;
  setPreview: (open: boolean) => void;
  setExport: (open: boolean) => void;
  addUpload: (u: { name: string; dataUrl: string }) => void;
  addFont: (family: string) => void;
}

/** Capture the live fabric scene into the in-memory project document. */
function commitActivePage(state: EditorState): ProjectDoc | null {
  const { project, activePage } = state;
  if (!project) return null;
  const pages = project.pages.slice();
  const page = pages[activePage];
  if (!page) return project;
  pages[activePage] = {
    ...page,
    width: engine.pageWidth,
    height: engine.pageHeight,
    background: engine.pageBackground,
    scene: engine.serializeScene(),
    thumbnail: engine.thumbnail()
  };
  return { ...project, pages };
}

let autoSaveTimer: number | null = null;

export const useEditor = create<EditorState>((set, get) => ({
  project: null,
  activePage: 0,
  dirty: false,
  saving: false,
  lastSavedAt: null,
  selection: null,
  layers: [],
  zoom: 1,
  leftTab: 'templates',
  rightTab: 'design',
  previewOpen: false,
  exportOpen: false,
  canUndo: false,
  canRedo: false,
  uploads: [],
  fonts: [],

  async setProject(doc) {
    set({ project: doc, activePage: 0, dirty: false, lastSavedAt: doc.updatedAt });
    await engine.loadPage(doc.pages[0]);
    get().syncFromEngine();
  },

  async newProject(name, width, height, background = '#ffffff') {
    const doc = await bridge.projects.create({
      name,
      pages: [blankPage('Page 1', width, height, background)],
      brandKit: { colors: ['#7c5cff', '#ff3d9a', '#22d3ee', '#ffffff', '#0d0d14'], fonts: ['Inter'], logos: [] }
    });
    await get().setProject(doc);
    useApp.getState().go('editor');
  },

  async openProject(id) {
    const doc = await bridge.projects.get(id);
    if (!doc) throw new Error('Project not found.');
    await get().setProject(doc);
    useApp.getState().go('editor');
  },

  async save(silent = false) {
    const state = get();
    const doc = commitActivePage(state);
    if (!doc) return;
    set({ saving: true });
    try {
      await bridge.projects.save(doc);
      set({ project: doc, dirty: false, saving: false, lastSavedAt: Date.now() });
      if (!silent) useApp.getState().toast('Project saved', 'success');
    } catch (err) {
      set({ saving: false });
      useApp.getState().toast(`Save failed: ${(err as Error).message}`, 'error');
    }
  },

  renameProject(name) {
    const project = get().project;
    if (!project) return;
    set({ project: { ...project, name }, dirty: true });
    get().markDirty();
  },

  markDirty() {
    set({ dirty: true });
    const settings = useApp.getState().settings;
    if (!settings?.autoSave) return;
    if (autoSaveTimer) window.clearTimeout(autoSaveTimer);
    autoSaveTimer = window.setTimeout(() => void get().save(true), settings.autoSaveIntervalMs);
  },

  syncFromEngine() {
    set({
      selection: engine.selectionProps(),
      layers: engine.layers(),
      zoom: engine.zoom,
      canUndo: engine.canUndo(),
      canRedo: engine.canRedo()
    });
  },

  async gotoPage(index) {
    const state = get();
    const doc = commitActivePage(state);
    if (!doc || !doc.pages[index]) return;
    set({ project: doc, activePage: index });
    await engine.loadPage(doc.pages[index]);
    get().syncFromEngine();
  },

  async addPage(width, height) {
    const state = get();
    const doc = commitActivePage(state);
    if (!doc) return;
    const base = doc.pages[state.activePage];
    const page = blankPage(`Page ${doc.pages.length + 1}`, width ?? base.width, height ?? base.height, base.background);
    const next = { ...doc, pages: [...doc.pages, page] };
    set({ project: next, activePage: next.pages.length - 1 });
    await engine.loadPage(page);
    get().syncFromEngine();
    get().markDirty();
  },

  async duplicatePage(index) {
    const state = get();
    const doc = commitActivePage(state);
    if (!doc) return;
    const src = doc.pages[index];
    const copy: PageDoc = { ...src, id: uid(), name: `${src.name} copy` };
    const pages = [...doc.pages.slice(0, index + 1), copy, ...doc.pages.slice(index + 1)];
    set({ project: { ...doc, pages }, activePage: index + 1 });
    await engine.loadPage(copy);
    get().syncFromEngine();
    get().markDirty();
  },

  async deletePage(index) {
    const state = get();
    const doc = commitActivePage(state);
    if (!doc || doc.pages.length <= 1) {
      useApp.getState().toast('A project needs at least one page.', 'error');
      return;
    }
    const pages = doc.pages.filter((_, i) => i !== index);
    const nextIndex = Math.max(0, Math.min(index, pages.length - 1));
    set({ project: { ...doc, pages }, activePage: nextIndex });
    await engine.loadPage(pages[nextIndex]);
    get().syncFromEngine();
    get().markDirty();
  },

  movePage(from, to) {
    const doc = commitActivePage(get());
    if (!doc) return;
    const pages = doc.pages.slice();
    const [moved] = pages.splice(from, 1);
    pages.splice(to, 0, moved);
    set({ project: { ...doc, pages }, activePage: to });
    get().markDirty();
  },

  resizePage(width, height) {
    engine.setPageSize(width, height);
    const doc = get().project;
    if (!doc) return;
    const pages = doc.pages.slice();
    pages[get().activePage] = { ...pages[get().activePage], width, height };
    set({ project: { ...doc, pages } });
    get().markDirty();
  },

  setLeftTab: (leftTab) => set({ leftTab }),
  setRightTab: (rightTab) => set({ rightTab }),
  setPreview: (previewOpen) => set({ previewOpen }),
  setExport: (exportOpen) => set({ exportOpen }),
  addUpload: (u) => set({ uploads: [u, ...get().uploads].slice(0, 60) }),
  addFont: (family) => set({ fonts: Array.from(new Set([family, ...get().fonts])) })
}));

/** Collect every page (including unsaved canvas state) for export. */
export function snapshotPages(): PageDoc[] {
  const state = useEditor.getState();
  const doc = commitActivePage(state);
  return doc?.pages ?? [];
}
