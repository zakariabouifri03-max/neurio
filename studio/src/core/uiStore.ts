import { create } from 'zustand';
import type { EditorMode } from './types';

export type LeftPanel = 'media' | 'audio' | 'text' | 'effects' | 'transitions' | 'stickers' | 'templates' | 'ai' | 'captions' | 'record' | 'filters';
export type RightPanel = 'properties' | 'adjust' | 'effects' | 'animation' | 'keyframes' | 'audio' | 'mask' | 'chroma' | 'speed' | 'stabilize' | 'text' | 'transition' | 'captions';
export type Route = { name: 'home' } | { name: 'projects' } | { name: 'editor'; projectId: string };

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'error' | 'progress';
  title: string;
  message?: string;
  progress?: number; // 0..1
  timeout?: number;
}

interface UIStore {
  route: Route;
  mode: EditorMode;
  leftPanel: LeftPanel;
  rightPanel: RightPanel;
  leftOpen: boolean;
  rightOpen: boolean;
  timelineZoom: number; // pixels per second
  timelineScroll: number; // seconds
  snapping: boolean;
  ripple: boolean;
  showSafeZones: boolean;
  showGrid: boolean;
  /** Video scopes overlay on the preview (null = hidden). */
  scopes: null | 'waveform' | 'parade' | 'vectorscope' | 'histogram';
  dialog: null | { kind: 'export' } | { kind: 'settings' } | { kind: 'shortcuts' } | { kind: 'record'; mode: 'screen' | 'voice' | 'camera' } | { kind: 'newProject' } | { kind: 'template'; templateId: string } | { kind: 'about' };
  toasts: Toast[];
  previewFit: number;
  /** Transition selected in the timeline (edge pill clicked). */
  selectedTransition: { clipId: string; edge: 'in' | 'out' } | null;
  /** When set, the next click on the preview reports the color under the cursor. */
  eyedropper: ((rgb: { r: number; g: number; b: number }) => void) | null;
  theme: 'dark';
  navigate: (r: Route) => void;
  setMode: (m: EditorMode) => void;
  setLeftPanel: (p: LeftPanel) => void;
  setRightPanel: (p: RightPanel) => void;
  setZoom: (z: number) => void;
  setScroll: (s: number) => void;
  set: (p: Partial<UIStore>) => void;
  openDialog: (d: UIStore['dialog']) => void;
  closeDialog: () => void;
  toast: (t: Omit<Toast, 'id'> & { id?: string }) => string;
  updateToast: (id: string, t: Partial<Toast>) => void;
  dismissToast: (id: string) => void;
}

export const useUI = create<UIStore>((set, get) => ({
  route: { name: 'home' },
  mode: (localStorage.getItem('neurio.mode') as EditorMode) || 'pro',
  leftPanel: 'media',
  rightPanel: 'properties',
  leftOpen: true,
  rightOpen: true,
  timelineZoom: 80,
  timelineScroll: 0,
  snapping: true,
  ripple: false,
  showSafeZones: false,
  showGrid: false,
  scopes: null,
  dialog: null,
  toasts: [],
  selectedTransition: null,
  eyedropper: null,
  previewFit: 1,
  theme: 'dark',
  navigate: (route) => set({ route }),
  setMode: (mode) => {
    localStorage.setItem('neurio.mode', mode);
    set({ mode });
  },
  setLeftPanel: (leftPanel) => set({ leftPanel, leftOpen: true }),
  setRightPanel: (rightPanel) => set({ rightPanel, rightOpen: true }),
  setZoom: (z) => set({ timelineZoom: Math.min(2000, Math.max(4, z)) }),
  setScroll: (s) => set({ timelineScroll: Math.max(0, s) }),
  set: (p) => set(p),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  toast: (t) => {
    const id = t.id || `t${Date.now()}${Math.random().toString(36).slice(2, 6)}`;
    const toast = { ...t, id } as Toast;
    set({ toasts: [...get().toasts.filter((x) => x.id !== id), toast] });
    const timeout = t.timeout ?? (t.kind === 'progress' ? 0 : t.kind === 'error' ? 7000 : 3500);
    if (timeout > 0) setTimeout(() => get().dismissToast(id), timeout);
    return id;
  },
  updateToast: (id, patch) => set({ toasts: get().toasts.map((x) => (x.id === id ? { ...x, ...patch } : x)) }),
  dismissToast: (id) => set({ toasts: get().toasts.filter((x) => x.id !== id) }),
}));

export const toast = (title: string, kind: Toast['kind'] = 'info', message?: string) => useUI.getState().toast({ title, kind, message });
