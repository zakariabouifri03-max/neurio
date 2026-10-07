import { create } from 'zustand';
import type { Clip, Project, Track } from './types';
import * as cmd from './commands';
import { deepClone, uid } from './util';
import { snapToFrame } from './time';

const MAX_HISTORY = 100;

export interface HistoryEntry {
  label: string;
  project: Project;
}

interface ProjectStore {
  project: Project | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  dirty: boolean;
  selection: string[];
  selectedTrackId: string | null;
  clipboard: Clip[];
  lastLabel: string;

  load: (p: Project | null) => void;
  /** Apply a project transformation, recording history (unless `history: false`). */
  apply: (label: string, fn: (p: Project) => Project, opts?: { history?: boolean; merge?: boolean }) => void;
  undo: () => void;
  redo: () => void;
  select: (ids: string[], additive?: boolean) => void;
  selectTrack: (id: string | null) => void;
  setClipboard: (clips: Clip[]) => void;
  markSaved: () => void;
  rename: (name: string) => void;
}

export const useProject = create<ProjectStore>((set, get) => ({
  project: null,
  past: [],
  future: [],
  dirty: false,
  selection: [],
  selectedTrackId: null,
  clipboard: [],
  lastLabel: '',

  load: (p) => set({ project: p, past: [], future: [], dirty: false, selection: [], selectedTrackId: null, lastLabel: '' }),

  apply: (label, fn, opts = {}) => {
    const { project, past, lastLabel } = get();
    if (!project) return;
    let next: Project;
    try {
      next = fn(project);
    } catch (e) {
      console.error('Edit failed', e);
      return;
    }
    if (next === project) return;
    next = { ...next, updatedAt: Date.now() };
    if (opts.history === false) {
      set({ project: next, dirty: true });
      return;
    }
    // merge consecutive identical-label edits (e.g. slider drags) into one history entry
    const merge = opts.merge && lastLabel === label && past.length > 0;
    const newPast = merge ? past : [...past, { label, project }].slice(-MAX_HISTORY);
    // prune selection of deleted clips
    const ids = new Set(cmd.allClips(next).map((c) => c.id));
    const selection = get().selection.filter((id) => ids.has(id));
    set({ project: next, past: newPast, future: [], dirty: true, lastLabel: label, selection });
  },

  undo: () => {
    const { project, past, future } = get();
    if (!project || !past.length) return;
    const entry = past[past.length - 1];
    set({
      project: entry.project,
      past: past.slice(0, -1),
      future: [{ label: entry.label, project }, ...future].slice(0, MAX_HISTORY),
      dirty: true,
      lastLabel: '',
      selection: get().selection.filter((id) => cmd.findClip(entry.project, id)),
    });
  },

  redo: () => {
    const { project, past, future } = get();
    if (!project || !future.length) return;
    const entry = future[0];
    set({
      project: entry.project,
      past: [...past, { label: entry.label, project }],
      future: future.slice(1),
      dirty: true,
      lastLabel: '',
      selection: get().selection.filter((id) => cmd.findClip(entry.project, id)),
    });
  },

  select: (ids, additive = false) => {
    const { project, selection } = get();
    let next = additive ? [...new Set([...selection, ...ids])] : ids;
    if (project) next = cmd.expandGroups(project, next);
    set({ selection: next });
  },
  selectTrack: (id) => set({ selectedTrackId: id }),
  setClipboard: (clips) => set({ clipboard: deepClone(clips) }),
  markSaved: () => set({ dirty: false }),
  rename: (name) => {
    const p = get().project;
    if (p) set({ project: { ...p, name, updatedAt: Date.now() }, dirty: true });
  },
}));

/* ---------- Transient playback state (updated at high frequency) ---------- */

interface PlaybackStore {
  time: number;
  playing: boolean;
  loop: boolean;
  inPoint: number | null;
  outPoint: number | null;
  rate: number;
  muted: boolean;
  volume: number;
  /** Rendering is in "preview quality" (reduced resolution) while playing/scrubbing */
  previewQuality: 'auto' | 'full' | 'half' | 'quarter';
  seek: (t: number) => void;
  setPlaying: (v: boolean) => void;
  setTimeInternal: (t: number) => void;
  set: (p: Partial<PlaybackStore>) => void;
}

export const usePlayback = create<PlaybackStore>((set) => ({
  time: 0,
  playing: false,
  loop: false,
  inPoint: null,
  outPoint: null,
  rate: 1,
  muted: false,
  volume: 1,
  previewQuality: 'auto',
  seek: (t) => set({ time: Math.max(0, t) }),
  setPlaying: (v) => set({ playing: v }),
  setTimeInternal: (t) => set({ time: t }),
  set: (p) => set(p),
}));

/* ---------- Convenience selectors / helpers ---------- */

export function getProject(): Project {
  const p = useProject.getState().project;
  if (!p) throw new Error('No project loaded');
  return p;
}

export function getFps(): number {
  return useProject.getState().project?.settings.fps ?? 30;
}

export function getSelectedClips(): Clip[] {
  const { project, selection } = useProject.getState();
  if (!project) return [];
  return selection.map((id) => cmd.findClip(project, id)?.clip).filter(Boolean) as Clip[];
}

export function useSelectedClip(): Clip | null {
  const sel = useProject((s) => s.selection);
  const project = useProject((s) => s.project);
  if (!project || !sel.length) return null;
  return cmd.findClip(project, sel[sel.length - 1])?.clip ?? null;
}

export function useTrackOf(clipId: string | null): Track | null {
  const project = useProject((s) => s.project);
  if (!project || !clipId) return null;
  return cmd.findClip(project, clipId)?.track ?? null;
}

/** Shortcut for the common "update selected clip with partial" pattern. */
export function patchClip(clipId: string, label: string, patch: Partial<Clip> | ((c: Clip) => Partial<Clip>), merge = true) {
  useProject.getState().apply(label, (p) => cmd.updateClip(p, clipId, (c) => ({ ...c, ...(typeof patch === 'function' ? patch(c) : patch) }) as Clip), { merge });
}

export function patchClips(ids: string[], label: string, patch: (c: Clip) => Partial<Clip>, merge = true) {
  useProject.getState().apply(label, (p) => cmd.updateClips(p, ids, (c) => ({ ...c, ...patch(c) }) as Clip), { merge });
}

export function seekFrameSnapped(t: number) {
  usePlayback.getState().seek(snapToFrame(Math.max(0, t), getFps()));
}

export function addMarker(time: number, label = '', kind: 'marker' | 'beat' | 'chapter' = 'marker', color = '#38bdf8') {
  useProject.getState().apply('Add marker', (p) => ({ ...p, markers: [...p.markers, { id: uid('mk'), time, label, kind, color }].sort((a, b) => a.time - b.time) }));
}
