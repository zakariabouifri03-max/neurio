'use client';

/**
 * Editor store.
 *
 * Holds the document, selection, viewport, tools and history. Mutations are
 * structurally shared (only touched nodes get new identities) so React re-renders
 * the minimum, and every mutation is recorded in the history engine.
 *
 * Nothing here knows about React or the network: persistence lives in
 * `useAutosave`, collaboration in `useCollab`.
 */
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { DesignDoc, ID, Page, SceneNode, DocSettings, Timeline, MediaClip, Track } from '@/engine/types';
import { defaultDocSettings } from '@/engine/types';
import { History } from '@/engine/history';
import { uid } from '@/engine/factory';
import {
  addNode as treeAdd,
  alignNodes,
  distributeNodes,
  groupNodes,
  removeNodes,
  reorder,
  scalePageContent,
  ungroupNodes,
  findInTree,
  countNodes,
} from '@/engine/scene';
import { cloneNodes } from '@/engine/factory';

export type Tool = 'select' | 'hand' | 'text' | 'comment' | 'crop' | 'draw';

export type Viewport = { x: number; y: number; zoom: number };

export type EditorState = {
  projectId: string | null;
  doc: DesignDoc;
  rev: number;
  activePage: number;
  selection: ID[];
  hovered: ID | null;
  editingTextId: ID | null;
  viewport: Viewport;
  tool: Tool;
  clipboard: SceneNode[];
  guides: { axis: 'x' | 'y'; position: number; start: number; end: number; kind: string }[];
  snapEnabled: boolean;
  gridVisible: boolean;
  rulersVisible: boolean;
  marginsVisible: boolean;
  rulersSnap: boolean;
  dirty: boolean;
  saving: boolean;
  lastSavedAt: number | null;
  version: number;
  history: History<string>;
  timeline: {
    playing: boolean;
    time: number;
    selectedClipId: ID | null;
    zoom: number;
  };
  presenting: boolean;
  panel: string;
  inspectorTab: 'design' | 'position' | 'effects' | 'animation' | 'layers' | 'notes';
  bottomPanel: 'none' | 'timeline' | 'pages';
};

export type EditorActions = {
  setDoc: (doc: DesignDoc, opts?: { resetHistory?: boolean }) => void;
  setProject: (projectId: string, doc: DesignDoc, version: number) => void;
  setActivePage: (index: number) => void;
  setSelection: (ids: ID[]) => void;
  toggleSelection: (id: ID) => void;
  addToSelection: (ids: ID[]) => void;
  clearSelection: () => void;
  setHovered: (id: ID | null) => void;
  setEditingText: (id: ID | null) => void;
  setTool: (tool: Tool) => void;
  setViewport: (viewport: Partial<Viewport>) => void;
  zoomTo: (zoom: number, center?: { x: number; y: number }) => void;
  setGuides: (guides: EditorState['guides']) => void;
  toggleSnap: () => void;
  toggleGrid: () => void;
  toggleRulers: () => void;
  toggleMargins: () => void;

  /* document */
  addNode: (node: SceneNode, opts?: { parentId?: ID | null; select?: boolean; label?: string }) => void;
  addNodes: (nodes: SceneNode[], opts?: { parentId?: ID | null; label?: string }) => void;
  updateNodes: (ids: ID[], patch: Partial<SceneNode> | ((node: SceneNode) => Partial<SceneNode>), opts?: { label?: string; coalesce?: string; silent?: boolean }) => void;
  updateNodeDeep: (id: ID, fn: (node: SceneNode) => void, opts?: { label?: string; coalesce?: string }) => void;
  replaceNode: (id: ID, next: SceneNode, label?: string) => void;
  deleteNodes: (ids: ID[]) => void;
  duplicateNodesById: (ids: ID[]) => ID[];
  copySelection: () => void;
  paste: () => void;
  cutSelection: () => void;
  groupSelection: () => void;
  ungroupSelection: () => void;
  alignSelection: (mode: 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom', target?: 'selection' | 'page') => void;
  distributeSelection: (mode: 'horizontal' | 'vertical') => void;
  zMove: (move: 'front' | 'back' | 'forward' | 'backward') => void;
  toggleLock: (ids?: ID[]) => void;
  toggleVisible: (ids?: ID[]) => void;

  /* pages */
  addPage: (after?: boolean) => void;
  duplicatePage: (index: number) => void;
  deletePage: (index: number) => void;
  movePage: (from: number, to: number) => void;
  renamePage: (index: number, name: string) => void;
  updatePage: (index: number, patch: Partial<Page>) => void;
  setPageSize: (width: number, height: number) => void;

  /* settings */
  updateSettings: (patch: Partial<DocSettings>) => void;

  /* history */
  commit: (label: string, key?: string) => void;
  undo: () => void;
  redo: () => void;
  snapshot: () => DesignDoc;

  /* timeline (video) */
  setTimeline: (timeline: Timeline) => void;
  updateTimeline: (fn: (timeline: Timeline) => void, label?: string) => void;
  setPlaying: (playing: boolean) => void;
  setTime: (time: number) => void;
  selectClip: (id: ID | null) => void;
  addClip: (clip: MediaClip, trackId?: ID) => void;
  updateClip: (clipId: ID, patch: Partial<MediaClip>, label?: string) => void;
  removeClip: (clipId: ID) => void;
  addTrack: (track: Track) => void;

  /* ui */
  setDirty: (dirty: boolean) => void;
  setSaving: (saving: boolean) => void;
  markSaved: (version: number) => void;
  setPresenting: (presenting: boolean) => void;
  setPanel: (panel: string) => void;
  setInspectorTab: (tab: EditorState['inspectorTab']) => void;
  setBottomPanel: (panel: EditorState['bottomPanel']) => void;
};

export type EditorStore = EditorState & EditorActions;

export function createEmptyDoc(width = 1080, height = 1080, kind: DesignDoc['kind'] = 'design'): DesignDoc {
  return {
    id: uid('doc'),
    title: 'Untitled design',
    kind,
    width,
    height,
    pages: [
      {
        id: uid('pag'),
        name: kind === 'presentation' ? 'Slide 1' : 'Page 1',
        width,
        height,
        background: { color: '#ffffff' },
        nodes: [],
        notes: '',
        meta: {},
      },
    ],
    settings: defaultDocSettings(),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: 1,
  };
}

function serialize(doc: DesignDoc): string {
  return JSON.stringify({ ...doc, updatedAt: 0 });
}

/* ------------------------------------------------------------ tree helpers */

function mapTree(nodes: SceneNode[], ids: Set<string>, patch: Partial<SceneNode> | ((node: SceneNode) => Partial<SceneNode>)): SceneNode[] {
  const out: SceneNode[] = [];
  let changed = false;
  for (const node of nodes) {
    let next = node;
    if (ids.has(node.id)) {
      const applied = typeof patch === 'function' ? patch(node) : patch;
      next = { ...node, ...applied };
      changed = true;
    }
    if (next.children?.length) {
      const kids = mapTree(next.children, ids, patch);
      if (kids !== next.children) {
        next = { ...next, children: kids };
        changed = true;
      }
    }
    out.push(next);
  }
  return changed ? out : nodes;
}

function removeTree(nodes: SceneNode[], ids: Set<string>): SceneNode[] {
  const out: SceneNode[] = [];
  let changed = false;
  for (const node of nodes) {
    if (ids.has(node.id)) {
      changed = true;
      continue;
    }
    if (node.children?.length) {
      const kids = removeTree(node.children, ids);
      if (kids !== node.children) {
        out.push({ ...node, children: kids });
        changed = true;
        continue;
      }
    }
    out.push(node);
  }
  return changed ? out : nodes;
}

function collect(nodes: SceneNode[]): SceneNode[] {
  const out: SceneNode[] = [];
  const walk = (list: SceneNode[]) => {
    for (const n of list) {
      out.push(n);
      if (n.children?.length) walk(n.children);
    }
  };
  walk(nodes);
  return out;
}

/* ------------------------------------------------------------------- store */

const initialDoc = createEmptyDoc();

export const useEditor = create<EditorStore>((set, get) => ({
  projectId: null,
  doc: initialDoc,
  rev: 0,
  activePage: 0,
  selection: [],
  hovered: null,
  editingTextId: null,
  viewport: { x: 0, y: 0, zoom: 1 },
  tool: 'select',
  clipboard: [],
  guides: [],
  snapEnabled: true,
  gridVisible: false,
  rulersVisible: true,
  marginsVisible: false,
  rulersSnap: true,
  dirty: false,
  saving: false,
  lastSavedAt: null,
  version: 1,
  history: new History<string>(serialize(initialDoc), 'New document'),
  timeline: { playing: false, time: 0, selectedClipId: null, zoom: 1 },
  presenting: false,
  panel: 'templates',
  inspectorTab: 'design',
  bottomPanel: 'none',

  /* ------------------------------------------------------------ lifecycle */

  setDoc: (doc, opts) =>
    set((state) => ({
      doc,
      rev: state.rev + 1,
      activePage: Math.min(state.activePage, Math.max(0, doc.pages.length - 1)),
      history: opts?.resetHistory === false ? state.history : new History<string>(serialize(doc), 'Open document'),
      dirty: false,
    })),

  setProject: (projectId, doc, version) =>
    set(() => ({
      projectId,
      doc,
      version,
      activePage: 0,
      selection: [],
      rev: 0,
      dirty: false,
      history: new History<string>(serialize(doc), 'Open document'),
      timeline: { playing: false, time: 0, selectedClipId: null, zoom: 1 },
    })),

  setActivePage: (index) =>
    set((state) => ({
      activePage: Math.max(0, Math.min(index, state.doc.pages.length - 1)),
      selection: [],
      editingTextId: null,
      rev: state.rev + 1,
    })),

  setSelection: (ids) => set((state) => ({ selection: ids, rev: state.rev + 1 })),
  toggleSelection: (id) =>
    set((state) => ({
      selection: state.selection.includes(id) ? state.selection.filter((s) => s !== id) : [...state.selection, id],
      rev: state.rev + 1,
    })),
  addToSelection: (ids) =>
    set((state) => ({ selection: [...new Set([...state.selection, ...ids])], rev: state.rev + 1 })),
  clearSelection: () => set((state) => ({ selection: [], editingTextId: null, rev: state.rev + 1 })),
  setHovered: (id) => set({ hovered: id }),
  setEditingText: (id) => set({ editingTextId: id }),
  setTool: (tool) => set({ tool }),
  setViewport: (viewport) => set((state) => ({ viewport: { ...state.viewport, ...viewport } })),
  zoomTo: (zoom) => set((state) => ({ viewport: { ...state.viewport, zoom: Math.max(0.02, Math.min(8, zoom)) } })),
  setGuides: (guides) => set({ guides }),
  toggleSnap: () => set((state) => ({ snapEnabled: !state.snapEnabled })),
  toggleGrid: () =>
    set((state) => ({
      gridVisible: !state.gridVisible,
      doc: {
        ...state.doc,
        settings: { ...state.doc.settings, grid: { ...state.doc.settings.grid, visible: !state.gridVisible } },
      },
      rev: state.rev + 1,
    })),
  toggleRulers: () => set((state) => ({ rulersVisible: !state.rulersVisible })),
  toggleMargins: () => set((state) => ({ marginsVisible: !state.marginsVisible })),

  /* --------------------------------------------------------------- nodes */

  addNode: (node, opts) => {
    const { doc, activePage } = get();
    const pages = doc.pages.map((page, i) => {
      if (i !== activePage) return page;
      return { ...page, nodes: [...page.nodes, node] };
    });
    commitPages(set, get, pages, opts?.label ?? `Add ${node.name}`);
    if (opts?.select !== false) set({ selection: [node.id] });
  },

  addNodes: (nodes, opts) => {
    const { doc, activePage } = get();
    const pages = doc.pages.map((page, i) => {
      if (i !== activePage) return page;
      let next = page.nodes;
      for (const node of nodes) next = [...next, node];
      return { ...page, nodes: next };
    });
    commitPages(set, get, pages, opts?.label ?? `Add ${nodes.length} element${nodes.length === 1 ? '' : 's'}`);
    set({ selection: nodes.map((n) => n.id) });
  },

  updateNodes: (ids, patch, opts) => {
    if (!ids.length) return;
    const { doc, activePage } = get();
    const set_ = new Set(ids);
    const pages = doc.pages.map((page, i) => {
      if (i !== activePage) return page;
      return { ...page, nodes: mapTree(page.nodes, set_, patch) };
    });
    commitPages(set, get, pages, opts?.label ?? 'Edit', opts?.coalesce, opts?.silent);
  },

  updateNodeDeep: (id, fn, opts) => {
    const { doc, activePage } = get();
    const pages = doc.pages.map((page, i) => {
      if (i !== activePage) return page;
      const root = findInTree(page.nodes, id);
      if (!root) return page;
      // Clone the branch so mutations stay contained and identities change.
      const clone: SceneNode = JSON.parse(JSON.stringify(root));
      fn(clone);
      const replace = (list: SceneNode[]): SceneNode[] =>
        list.map((n) => {
          if (n.id === id) return clone;
          if (n.children?.length) {
            const kids = replace(n.children);
            if (kids !== n.children) return { ...n, children: kids };
          }
          return n;
        });
      return { ...page, nodes: replace(page.nodes) };
    });
    commitPages(set, get, pages, opts?.label ?? 'Edit', opts?.coalesce);
  },

  replaceNode: (id, next, label) => {
    const { doc, activePage } = get();
    const pages = doc.pages.map((page, i) => {
      if (i !== activePage) return page;
      const replace = (list: SceneNode[]): SceneNode[] =>
        list.map((n) => (n.id === id ? next : n.children?.length ? { ...n, children: replace(n.children) } : n));
      return { ...page, nodes: replace(page.nodes) };
    });
    commitPages(set, get, pages, label ?? 'Edit');
  },

  deleteNodes: (ids) => {
    const { doc, activePage } = get();
    const set_ = new Set(ids);
    const pages = doc.pages.map((page, i) => {
      if (i !== activePage) return page;
      return { ...page, nodes: removeTree(page.nodes, set_) };
    });
    commitPages(set, get, pages, 'Delete');
    set((state) => ({ selection: state.selection.filter((s) => !set_.has(s)) }));
  },

  duplicateNodesById: (ids) => {
    const { doc, activePage } = get();
    const page = doc.pages[activePage];
    if (!page) return [];
    const sources = collect(page.nodes).filter((n) => ids.includes(n.id));
    if (!sources.length) return [];
    const copies = cloneNodes(sources, { x: 24, y: 24 });
    const pages = doc.pages.map((p, i) => (i === activePage ? { ...p, nodes: [...p.nodes, ...copies] } : p));
    commitPages(set, get, pages, 'Duplicate');
    set({ selection: copies.map((c) => c.id) });
    return copies.map((c) => c.id);
  },

  copySelection: () => {
    const { doc, activePage, selection } = get();
    const page = doc.pages[activePage];
    if (!page) return;
    set({ clipboard: JSON.parse(JSON.stringify(collect(page.nodes).filter((n) => selection.includes(n.id)))) });
  },

  paste: () => {
    const { clipboard } = get();
    if (!clipboard.length) return;
    const copies = cloneNodes(clipboard, { x: 24, y: 24 });
    const { doc, activePage } = get();
    const pages = doc.pages.map((p, i) => (i === activePage ? { ...p, nodes: [...p.nodes, ...copies] } : p));
    commitPages(set, get, pages, 'Paste');
    set({ selection: copies.map((c) => c.id) });
  },

  cutSelection: () => {
    get().copySelection();
    get().deleteNodes(get().selection);
  },

  groupSelection: () => {
    const { doc, activePage, selection } = get();
    const page = doc.pages[activePage];
    if (!page || selection.length < 2) return;
    const working: Page = JSON.parse(JSON.stringify(page));
    const groupId = groupNodes(working, selection);
    if (!groupId) return;
    const pages = doc.pages.map((p, i) => (i === activePage ? working : p));
    commitPages(set, get, pages, 'Group');
    set({ selection: [groupId] });
  },

  ungroupSelection: () => {
    const { doc, activePage, selection } = get();
    const page = doc.pages[activePage];
    if (!page) return;
    const working: Page = JSON.parse(JSON.stringify(page));
    const ids = ungroupNodes(working, selection);
    const pages = doc.pages.map((p, i) => (i === activePage ? working : p));
    commitPages(set, get, pages, 'Ungroup');
    if (ids.length) set({ selection: ids });
  },

  alignSelection: (mode, target = 'selection') => {
    const { doc, activePage, selection } = get();
    const page = doc.pages[activePage];
    if (!page || !selection.length) return;
    const working: Page = JSON.parse(JSON.stringify(page));
    alignNodes(working, selection, mode, target);
    const pages = doc.pages.map((p, i) => (i === activePage ? working : p));
    commitPages(set, get, pages, 'Align');
  },

  distributeSelection: (mode) => {
    const { doc, activePage, selection } = get();
    const page = doc.pages[activePage];
    if (!page || selection.length < 3) return;
    const working: Page = JSON.parse(JSON.stringify(page));
    distributeNodes(working, selection, mode);
    const pages = doc.pages.map((p, i) => (i === activePage ? working : p));
    commitPages(set, get, pages, 'Distribute');
  },

  zMove: (move) => {
    const { doc, activePage, selection } = get();
    const page = doc.pages[activePage];
    if (!page || !selection.length) return;
    const working: Page = JSON.parse(JSON.stringify(page));
    reorder(working, selection, move);
    const pages = doc.pages.map((p, i) => (i === activePage ? working : p));
    commitPages(set, get, pages, 'Arrange');
  },

  toggleLock: (ids) => {
    const { doc, activePage, selection } = get();
    const target = ids ?? selection;
    if (!target.length) return;
    const page = doc.pages[activePage];
    if (!page) return;
    const shouldLock = collect(page.nodes).filter((n) => target.includes(n.id)).some((n) => !n.locked);
    get().updateNodes(target, { locked: shouldLock }, { label: shouldLock ? 'Lock' : 'Unlock' });
    if (shouldLock) set({ selection: [] });
  },

  toggleVisible: (ids) => {
    const { doc, activePage, selection } = get();
    const target = ids ?? selection;
    if (!target.length) return;
    const page = doc.pages[activePage];
    if (!page) return;
    const shouldHide = collect(page.nodes).filter((n) => target.includes(n.id)).some((n) => n.visible);
    get().updateNodes(target, { visible: !shouldHide }, { label: shouldHide ? 'Hide' : 'Show' });
  },

  /* --------------------------------------------------------------- pages */

  addPage: (after = true) => {
    const { doc, activePage } = get();
    const source = doc.pages[activePage];
    if (!source) return;
    const page: Page = {
      id: uid('pag'),
      name: `${doc.kind === 'presentation' ? 'Slide' : 'Page'} ${doc.pages.length + 1}`,
      width: source.width,
      height: source.height,
      background: { ...source.background },
      nodes: [],
      notes: '',
      meta: {},
    };
    const pages = [...doc.pages];
    pages.splice(after ? activePage + 1 : activePage, 0, page);
    commitPages(set, get, pages, 'Add page', undefined, false, after ? activePage + 1 : activePage);
  },

  duplicatePage: (index) => {
    const { doc } = get();
    const source = doc.pages[index];
    if (!source) return;
    const copy: Page = JSON.parse(JSON.stringify(source));
    copy.id = uid('pag');
    copy.name = `${source.name} copy`;
    copy.nodes = copy.nodes.map((n) => ({ ...n, id: uid() }));
    const pages = [...doc.pages];
    pages.splice(index + 1, 0, copy);
    commitPages(set, get, pages, 'Duplicate page', undefined, false, index + 1);
  },

  deletePage: (index) => {
    const { doc, activePage } = get();
    if (doc.pages.length <= 1) return;
    const pages = doc.pages.filter((_, i) => i !== index);
    commitPages(set, get, pages, 'Delete page', undefined, false, Math.max(0, Math.min(activePage, pages.length - 1)));
  },

  movePage: (from, to) => {
    const { doc } = get();
    if (from === to || !doc.pages[from]) return;
    const pages = [...doc.pages];
    const [page] = pages.splice(from, 1);
    pages.splice(Math.max(0, Math.min(to, pages.length)), 0, page!);
    commitPages(set, get, pages, 'Reorder pages', undefined, false, Math.max(0, Math.min(to, pages.length - 1)));
  },

  renamePage: (index, name) => {
    const { doc } = get();
    const pages = doc.pages.map((p, i) => (i === index ? { ...p, name } : p));
    commitPages(set, get, pages, 'Rename page');
  },

  updatePage: (index, patch) => {
    const { doc } = get();
    const pages = doc.pages.map((p, i) => (i === index ? { ...p, ...patch } : p));
    commitPages(set, get, pages, 'Update page');
  },

  setPageSize: (width, height) => {
    const { doc, activePage } = get();
    const pages = doc.pages.map((page, i) => {
      if (i !== activePage) return page;
      const working: Page = JSON.parse(JSON.stringify(page));
      scalePageContent(working, width, height);
      return working;
    });
    commitPages(set, get, pages, 'Resize canvas');
  },

  updateSettings: (patch) => {
    const { doc } = get();
    const next = { ...doc, settings: { ...doc.settings, ...patch } };
    set((state) => {
      state.history.push(serialize(next), 'Settings', 'settings');
      return { doc: next, rev: state.rev + 1, dirty: true };
    });
  },

  /* -------------------------------------------------------------- history */

  commit: (label, key) => {
    const { doc } = get();
    set((state) => {
      state.history.push(serialize(doc), label, key, true);
      return {};
    });
  },

  undo: () => {
    const { history } = get();
    const state = history.undo();
    if (!state) return;
    const doc = JSON.parse(state) as DesignDoc;
    set((s) => ({ doc, selection: [], editingTextId: null, rev: s.rev + 1, dirty: true }));
  },

  redo: () => {
    const { history } = get();
    const state = history.redo();
    if (!state) return;
    const doc = JSON.parse(state) as DesignDoc;
    set((s) => ({ doc, selection: [], editingTextId: null, rev: s.rev + 1, dirty: true }));
  },

  snapshot: () => JSON.parse(JSON.stringify(get().doc)) as DesignDoc,

  /* ------------------------------------------------------------- timeline */

  setTimeline: (timeline) => {
    const { doc } = get();
    const next = { ...doc, timeline };
    set((state) => {
      state.history.push(serialize(next), 'Update timeline');
      return { doc: next, rev: state.rev + 1, dirty: true };
    });
  },

  updateTimeline: (fn, label = 'Edit timeline') => {
    const { doc } = get();
    const timeline: Timeline = doc.timeline
      ? JSON.parse(JSON.stringify(doc.timeline))
      : { fps: 30, duration: 10000, tracks: [], subtitles: [] };
    fn(timeline);
    const next = { ...doc, timeline };
    set((state) => {
      state.history.push(serialize(next), label, 'timeline');
      return { doc: next, rev: state.rev + 1, dirty: true };
    });
  },

  setPlaying: (playing) => set((state) => ({ timeline: { ...state.timeline, playing } })),
  setTime: (time) => set((state) => ({ timeline: { ...state.timeline, time: Math.max(0, time) } })),
  selectClip: (id) => set((state) => ({ timeline: { ...state.timeline, selectedClipId: id } })),

  addClip: (clip, trackId) => {
    get().updateTimeline((timeline) => {
      let track = trackId ? timeline.tracks.find((t) => t.id === trackId) : timeline.tracks.find((t) => t.kind === clip.kind);
      if (!track) {
        track = {
          id: uid('trk'),
          kind: clip.kind === 'audio' ? 'audio' : 'video',
          name: clip.kind === 'audio' ? 'Audio' : 'Video',
          muted: false,
          locked: false,
          clips: [],
        };
        timeline.tracks.push(track);
      }
      clip.trackId = track.id;
      // Place after the last clip on the track by default.
      const end = track.clips.reduce((max, c) => Math.max(max, c.start + c.duration), 0);
      if (clip.start == null || clip.start < 0) clip.start = end;
      track.clips.push(clip);
      timeline.duration = Math.max(timeline.duration, clip.start + clip.duration);
    }, 'Add clip');
    set((state) => ({ timeline: { ...state.timeline, selectedClipId: clip.id } }));
  },

  updateClip: (clipId, patch, label = 'Edit clip') => {
    get().updateTimeline((timeline) => {
      for (const track of timeline.tracks) {
        const clip = track.clips.find((c) => c.id === clipId);
        if (clip) {
          Object.assign(clip, patch);
          timeline.duration = Math.max(
            timeline.duration,
            ...timeline.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration)),
          );
          return;
        }
      }
    }, label);
  },

  removeClip: (clipId) => {
    get().updateTimeline((timeline) => {
      for (const track of timeline.tracks) {
        const index = track.clips.findIndex((c) => c.id === clipId);
        if (index >= 0) track.clips.splice(index, 1);
      }
      timeline.tracks = timeline.tracks.filter((t) => t.clips.length > 0 || t.kind === 'subtitle');
    }, 'Remove clip');
  },

  addTrack: (track) => {
    get().updateTimeline((timeline) => {
      timeline.tracks.push(track);
    }, 'Add track');
  },

  /* ------------------------------------------------------------------- ui */

  setDirty: (dirty) => set({ dirty }),
  setSaving: (saving) => set({ saving }),
  markSaved: (version) => set({ dirty: false, saving: false, lastSavedAt: Date.now(), version }),
  setPresenting: (presenting) => set({ presenting }),
  setPanel: (panel) => set({ panel }),
  setInspectorTab: (inspectorTab) => set({ inspectorTab }),
  setBottomPanel: (bottomPanel) => set({ bottomPanel }),
}));

/* ------------------------------------------------------------- commit helper */

type SetFn = (partial: Partial<EditorStore> | ((state: EditorStore) => Partial<EditorStore>)) => void;
type GetFn = () => EditorStore;

function commitPages(
  set: SetFn,
  get: GetFn,
  pages: Page[],
  label: string,
  coalesceKey?: string,
  _silent?: boolean,
  nextActivePage?: number,
): void {
  const state = get();
  const doc: DesignDoc = { ...state.doc, pages, updatedAt: Date.now() };
  state.history.push(serialize(doc), label, coalesceKey);
  set({
    doc,
    rev: state.rev + 1,
    dirty: true,
    ...(nextActivePage !== undefined ? { activePage: nextActivePage } : {}),
  });
}

/* ---------------------------------------------------------------- selectors */

export function useActivePage(): Page | undefined {
  return useEditor((s) => s.doc.pages[s.activePage]);
}

export function useSelectedNodes(): SceneNode[] {
  return useEditor(
    useShallow((s) => {
    const page = s.doc.pages[s.activePage];
    if (!page) return [];
      const all = collect(page.nodes);
      return all.filter((n) => s.selection.includes(n.id));
    }),
  );
}

export function nodeCount(page: Page): number {
  return countNodes(page);
}
