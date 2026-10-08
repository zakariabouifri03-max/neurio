import { create } from 'zustand';
import type { ProjectDocument } from '../../core/types/project';
import type { Clip, Sequence, Track } from '../../core/types/timeline';
import { createProject, clipFromAsset, createTextClip, uid } from '../../core/timeline/factory';
import {
  splitClip,
  trimClip,
  moveClips,
  deleteClips,
  rippleDelete,
  updateClip,
  addTrack,
  removeTrack,
  setTrackFlag,
  addMarker,
  removeMarker,
  type TrimEdge,
} from '../../core/timeline/operations';
import { findClip, findTrack, sequenceDuration, allClips } from '../../core/timeline/queries';
import { History } from '../../core/timeline/history';
import type { MediaAsset } from '../../core/types/media';
import { serializeProject, deserializeProject, ProjectFormatError } from '../../core/project/serialize';
import { effectRegistry } from '../../core/effects/registry';
import { defaultSubtitleStyle } from '../../core/types/subtitles';
import { endOf } from '../../core/types/time';
import { upsertKeyframe } from '../../core/types/keyframes';
import { getBridge } from '../../core/bridge';
import type { RuntimeCapabilities } from '../../core/bridge/PlatformBridge';

/**
 * The editor store.
 *
 * Holds the project document, the undo history and the UI state. Every mutation
 * goes through the pure operations in `core/timeline/operations.ts`, so the AI
 * agent (see `store/editorApi.ts`) and the mouse produce identical, undoable
 * results.
 */

export type Tool = 'select' | 'split' | 'trim' | 'hand';
export type PanelId = ProjectDocument['workspace']['activePanel'];

export interface Toast {
  id: string;
  kind: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  actions?: { label: string; run: () => void }[];
}

export interface PlaybackState {
  playing: boolean;
  startedAt: number;
  startedAtSec: number;
  rate: number;
  loop: boolean;
  loopStart: number;
  loopEnd: number;
}

export interface EditorState {
  project: ProjectDocument;
  dirty: boolean;
  projectPath: string | null;
  lastSavedAt: number | null;
  tool: Tool;
  snapping: boolean;
  selectedClipIds: string[];
  selectedTrackId: string | null;
  playheadSec: number;
  zoomPxPerSec: number;
  scrollX: number;
  activePanel: PanelId;
  playback: PlaybackState;
  toasts: Toast[];
  busy: { label: string; fraction: number } | null;
  loadWarnings: string[];
  capabilities: RuntimeCapabilities | null;

  newProject: () => void;
  loadProjectFromText: (raw: string, path: string | null) => void;
  saveProject: (path?: string) => Promise<void>;
  autosave: () => Promise<void>;
  openProjectDialog: () => Promise<void>;
  saveProjectDialog: () => Promise<void>;

  importPaths: (paths: string[]) => Promise<void>;
  importFiles: () => Promise<void>;
  relinkAsset: (assetId: string) => Promise<void>;
  removeAsset: (assetId: string) => void;
  addAssetToTimeline: (assetId: string, atSec?: number) => void;
  setAssetWaveform: (assetId: string, waveform: MediaAsset['waveform']) => void;
  setAssetThumbnails: (assetId: string, thumbnails: MediaAsset['thumbnails']) => void;

  applySequence: (next: Sequence, label: string, coalesce?: boolean) => void;
  splitAtPlayhead: () => void;
  splitClipAt: (clipId: string, time: number) => void;
  trimSelected: (edge: TrimEdge, time: number) => void;
  moveSelected: (start: number, trackId?: string, ripple?: boolean) => void;
  deleteSelected: (ripple: boolean) => void;
  select: (clipIds: string[], additive?: boolean) => void;
  selectTrack: (trackId: string | null) => void;
  setTool: (tool: Tool) => void;
  setSnapping: (on: boolean) => void;
  setClip: (clipId: string, patch: Partial<Clip>, label?: string) => void;
  addTextLayer: (text?: string) => void;
  addTrackOfKind: (kind: Track['kind']) => void;
  removeTrackById: (trackId: string) => void;
  toggleTrackFlag: (trackId: string, flag: 'muted' | 'solo' | 'locked' | 'hidden') => void;
  addEffectToClip: (clipId: string, effectId: string) => void;
  removeEffectFromClip: (clipId: string, instanceId: string) => void;
  setEffectParam: (clipId: string, instanceId: string, paramId: string, value: number | boolean | string | number[]) => void;
  toggleEffect: (clipId: string, instanceId: string) => void;
  setKeyframeOnClip: (clipId: string, property: string, time: number, value: number | number[]) => void;
  addMarkerAtPlayhead: () => void;
  removeMarkerById: (id: string) => void;
  applySilenceRemoval: (clipId: string, removals: { start: number; end: number }[]) => void;
  setSequenceSize: (width: number, height: number, fps?: number) => void;

  setPlayhead: (sec: number) => void;
  play: () => void;
  pause: () => void;
  togglePlay: () => void;
  stop: () => void;
  stepFrame: (delta: number) => void;
  setPlaybackRate: (rate: number) => void;
  setZoom: (pxPerSec: number) => void;
  setScrollX: (x: number) => void;
  setActivePanel: (panel: PanelId) => void;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  toast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: string) => void;
  setBusy: (busy: EditorState['busy']) => void;
  setCapabilities: (caps: RuntimeCapabilities | null) => void;
}

/** Kept outside the store: it is a mutable object, not serialisable state. */
export const history = new History<Sequence>(createProject().sequence, {
  limit: 200,
  coalesceMs: 450,
});

export const useEditor = create<EditorState>((set, get) => ({
  project: createProject('Untitled Project'),
  dirty: false,
  projectPath: null,
  lastSavedAt: null,
  tool: 'select',
  snapping: true,
  selectedClipIds: [],
  selectedTrackId: null,
  playheadSec: 0,
  zoomPxPerSec: 60,
  scrollX: 0,
  activePanel: 'media',
  playback: { playing: false, startedAt: 0, startedAtSec: 0, rate: 1, loop: false, loopStart: 0, loopEnd: 0 },
  toasts: [],
  busy: null,
  loadWarnings: [],
  capabilities: null,

  /* ---------------- lifecycle ---------------- */

  newProject: () => {
    const project = createProject('Untitled Project');
    history.replaceCurrent(project.sequence);
    history.clear();
    set({ project, dirty: false, projectPath: null, selectedClipIds: [], selectedTrackId: null, playheadSec: 0, loadWarnings: [] });
  },

  loadProjectFromText: (raw, path) => {
    try {
      const report = deserializeProject(raw);
      history.replaceCurrent(report.document.sequence);
      history.clear();
      set({
        project: report.document,
        dirty: false,
        projectPath: path,
        selectedClipIds: [],
        playheadSec: report.document.workspace.playheadSec ?? 0,
        zoomPxPerSec: report.document.workspace.zoomPxPerSec ?? 60,
        activePanel: report.document.workspace.activePanel ?? 'media',
        loadWarnings: report.warnings,
        lastSavedAt: report.document.updatedAt,
      });
      if (report.warnings.length) {
        get().toast({
          kind: 'warning',
          title: 'Project opened with warnings',
          message:
            report.warnings.slice(0, 3).join('\n') +
            (report.warnings.length > 3 ? `\n…and ${report.warnings.length - 3} more` : ''),
        });
      }
    } catch (error) {
      const message =
        error instanceof ProjectFormatError
          ? error.message
          : 'That file could not be opened. It may be damaged or not an ADZAK project.';
      set({ loadWarnings: [message] });
      get().toast({ kind: 'error', title: 'Could not open the project', message });
    }
  },

  saveProject: async (path) => {
    const state = get();
    const target = path ?? state.projectPath;
    const doc = { ...state.project, updatedAt: Date.now() };
    try {
      const content = serializeProject(doc);
      await getBridge().writeTextFile(target ?? `idb:${doc.id}`, content);
      set({ project: doc, dirty: false, projectPath: target ?? `idb:${doc.id}`, lastSavedAt: Date.now() });
      get().toast({ kind: 'success', title: 'Project saved' });
    } catch (error) {
      get().toast({ kind: 'error', title: 'Could not save the project', message: (error as Error).message });
    }
  },

  autosave: async () => {
    const state = get();
    if (!state.dirty) return;
    const doc = { ...state.project, updatedAt: Date.now() };
    try {
      await getBridge().writeTextFile(state.projectPath ?? `idb:${doc.id}`, serializeProject(doc));
      set({ project: doc, dirty: false, lastSavedAt: Date.now() });
    } catch (error) {
      getBridge().log('warn', 'autosave', (error as Error).message);
    }
  },

  openProjectDialog: async () => {
    try {
      const paths = await getBridge().pickFiles([{ name: 'ADZAK project', extensions: ['adzak', 'json'] }]);
      if (!paths.length) return;
      const raw = await getBridge().readTextFile(paths[0]!);
      get().loadProjectFromText(raw, paths[0]!);
    } catch (error) {
      get().toast({ kind: 'error', title: 'Could not open the project', message: (error as Error).message });
    }
  },

  saveProjectDialog: async () => {
    try {
      const safeName = get().project.name.replace(/[\\/:*?"<>|]/g, '_');
      const path = await getBridge().pickSavePath(`${safeName}.adzak`, [
        { name: 'ADZAK project', extensions: ['adzak'] },
      ]);
      if (!path) return;
      await get().saveProject(path);
    } catch (error) {
      get().toast({ kind: 'error', title: 'Could not save the project', message: (error as Error).message });
    }
  },

  /* ---------------- media ---------------- */

  importPaths: async (paths) => {
    if (!paths.length) return;
    const bridge = getBridge();
    get().setBusy({ label: 'Analysing media…', fraction: 0 });
    const added: MediaAsset[] = [];
    for (let i = 0; i < paths.length; i++) {
      const path = paths[i]!;
      const name = path.split(/[\\/]/).pop() ?? path;
      get().setBusy({ label: `Analysing ${name}…`, fraction: (i + 1) / paths.length });
      const stat = await bridge.stat(path).catch(() => null);
      const asset: MediaAsset = {
        id: uid('asset'),
        name,
        kind: 'unknown',
        location: { kind: 'file', path },
        originalPath: path,
        sizeBytes: stat?.sizeBytes ?? 0,
        importedAt: Date.now(),
        probe: null,
        probeState: 'probing',
        isMissing: false,
      };
      try {
        const probe = await bridge.probe(path);
        asset.probe = probe;
        asset.probeState = 'ready';
        asset.kind =
          name.toLowerCase().endsWith('.gif') ? 'gif' : probe.hasVideo ? 'video' : probe.hasAudio ? 'audio' : 'image';
      } catch (error) {
        asset.probeState = 'error';
        asset.probeError = (error as Error).message;
        get().toast({ kind: 'error', title: `Could not read ${name}`, message: (error as Error).message });
      }
      added.push(asset);
    }
    set((state) => ({ project: { ...state.project, assets: [...state.project.assets, ...added] }, dirty: true }));
    get().setBusy(null);

    // Derived data is generated in the background: the timeline shows a clip the
    // moment the probe lands, and fills in thumbnails and waveforms afterwards.
    void Promise.allSettled(
      added.map(async (asset) => {
        if (asset.probeState !== 'ready') return;
        if (asset.kind !== 'audio') {
          try {
            const thumbs = await bridge.generateThumbnails(asset.originalPath, { count: 8, width: 160, height: 90 });
            get().setAssetThumbnails(asset.id, {
              uri: thumbs.uri,
              tiles: [thumbs.uri],
              times: thumbs.times,
              tileWidth: 160,
              tileHeight: 90,
              generatedAt: Date.now(),
            });
          } catch (error) {
            bridge.log('warn', 'thumbnails', (error as Error).message);
          }
        }
        if (asset.probe?.hasAudio) {
          try {
            const waveform = await bridge.generateWaveform(asset.originalPath, { buckets: 1200 });
            get().setAssetWaveform(asset.id, waveform);
          } catch (error) {
            bridge.log('warn', 'waveform', (error as Error).message);
          }
        }
      }),
    );
  },

  importFiles: async () => {
    const paths = await getBridge().pickFiles([
      {
        name: 'Media',
        extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'mpg', 'mpeg', 'wav', 'mp3', 'aac', 'm4a', 'flac', 'ogg', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'],
      },
    ]);
    await get().importPaths(paths);
  },

  relinkAsset: async (assetId) => {
    const asset = get().project.assets.find((a) => a.id === assetId);
    if (!asset) return;
    try {
      const paths = await getBridge().pickFiles([
        { name: 'Media', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'wav', 'mp3', 'png', 'jpg', 'jpeg'] },
      ]);
      if (!paths.length) return;
      const path = paths[0]!;
      const probe = await getBridge().probe(path);
      set((state) => ({
        dirty: true,
        project: {
          ...state.project,
          assets: state.project.assets.map((a) =>
            a.id === assetId
              ? { ...a, originalPath: path, location: { kind: 'file', path }, probe, probeState: 'ready', isMissing: false, probeError: undefined }
              : a,
          ),
        },
      }));
      get().toast({ kind: 'success', title: 'Media relinked', message: asset.name });
    } catch (error) {
      get().toast({ kind: 'error', title: 'Relink failed', message: (error as Error).message });
    }
  },

  removeAsset: (assetId) =>
    set((state) => ({
      dirty: true,
      project: { ...state.project, assets: state.project.assets.filter((a) => a.id !== assetId) },
    })),

  addAssetToTimeline: (assetId, atSec) => {
    const state = get();
    const asset = state.project.assets.find((a) => a.id === assetId);
    if (!asset) return;
    const wantsAudio = asset.kind === 'audio';
    const track =
      state.project.sequence.tracks.find((t) => t.id === state.selectedTrackId && t.kind === (wantsAudio ? 'audio' : 'video')) ??
      state.project.sequence.tracks.find((t) => t.kind === (wantsAudio ? 'audio' : 'video') && !t.locked) ??
      state.project.sequence.tracks[0]!;
    if (track.locked) {
      get().toast({ kind: 'warning', title: `Track ${track.name} is locked`, message: 'Unlock it to add clips.' });
      return;
    }
    const clip = clipFromAsset(asset, track.id, atSec ?? state.playheadSec, { fps: state.project.sequence.fps });
    const sequence: Sequence = {
      ...state.project.sequence,
      tracks: state.project.sequence.tracks.map((t) => (t.id === track.id ? { ...t, clips: [...t.clips, clip] } : t)),
    };
    get().applySequence(sequence, `Add ${asset.name}`);
    set({ selectedClipIds: [clip.id] });
  },

  setAssetWaveform: (assetId, waveform) =>
    set((state) => ({
      project: {
        ...state.project,
        assets: state.project.assets.map((a) => (a.id === assetId ? { ...a, waveform, waveformState: 'ready' } : a)),
      },
    })),

  setAssetThumbnails: (assetId, thumbnails) =>
    set((state) => ({
      project: {
        ...state.project,
        assets: state.project.assets.map((a) => (a.id === assetId ? { ...a, thumbnails } : a)),
      },
    })),

  /* ---------------- timeline edits ---------------- */

  applySequence: (next, label, coalesce = false) => {
    if (coalesce) history.pushCoalesced(next, label);
    else history.push(next, label);
    set((state) => ({ project: { ...state.project, sequence: next }, dirty: true }));
  },

  splitAtPlayhead: () => {
    const state = get();
    const time = state.playheadSec;
    const targets = state.selectedClipIds.length
      ? state.selectedClipIds
      : allClips(state.project.sequence)
          .filter((c) => c.timeline.start < time && endOf(c.timeline) > time)
          .map((c) => c.id);
    let sequence = state.project.sequence;
    const newIds: string[] = [];
    for (const id of targets) {
      const result = splitClip(sequence, id, time);
      if (result.ok) {
        sequence = result.sequence;
        newIds.push(result.data.rightId);
      }
    }
    if (!newIds.length) {
      get().toast({ kind: 'info', title: 'Nothing to split here', message: 'Move the playhead over a clip first.' });
      return;
    }
    get().applySequence(sequence, 'Split clip');
    set({ selectedClipIds: newIds });
  },

  splitClipAt: (clipId, time) => {
    const result = splitClip(get().project.sequence, clipId, time);
    if (!result.ok) {
      get().toast({ kind: 'warning', title: 'Cannot split here', message: result.error.message });
      return;
    }
    get().applySequence(result.sequence, 'Split clip');
    set({ selectedClipIds: [result.data.rightId] });
  },

  trimSelected: (edge, time) => {
    const state = get();
    const clipId = state.selectedClipIds[0];
    if (!clipId) return;
    const clip = findClip(state.project.sequence, clipId);
    const asset = clip?.assetId ? state.project.assets.find((a) => a.id === clip.assetId) : undefined;
    const maxSource = asset?.probe?.durationSec ?? Number.POSITIVE_INFINITY;
    const result = trimClip(state.project.sequence, clipId, edge, time, maxSource);
    if (!result.ok) return; // the handle simply stops; no toast mid-drag
    get().applySequence(result.sequence, `Trim ${edge}`, true);
  },

  moveSelected: (start, trackId, ripple) => {
    const state = get();
    if (!state.selectedClipIds.length) return;
    const result = moveClips(state.project.sequence, state.selectedClipIds, {
      start,
      ...(trackId ? { trackId } : {}),
      ...(ripple === undefined ? {} : { ripple }),
    });
    if (!result.ok) {
      get().toast({ kind: 'warning', title: 'Cannot move there', message: result.error.message });
      return;
    }
    get().applySequence(result.sequence, 'Move clip', true);
  },

  deleteSelected: (ripple) => {
    const state = get();
    if (!state.selectedClipIds.length) return;
    const sequence = state.project.sequence;
    const result = ripple ? rippleDelete(sequence, state.selectedClipIds) : deleteClips(sequence, state.selectedClipIds);
    if (!result.ok) {
      get().toast({ kind: 'warning', title: 'Cannot delete', message: result.error.message });
      return;
    }
    get().applySequence(result.sequence, ripple ? 'Ripple delete' : 'Delete clip');
    set({ selectedClipIds: [] });
  },

  select: (clipIds, additive) =>
    set((state) => ({
      selectedClipIds: additive ? [...new Set([...state.selectedClipIds, ...clipIds])] : clipIds,
    })),

  selectTrack: (trackId) => set({ selectedTrackId: trackId }),
  setTool: (tool) => set({ tool }),
  setSnapping: (on) => set({ snapping: on }),

  setClip: (clipId, patch, label = 'Edit clip') => {
    const result = updateClip(get().project.sequence, clipId, patch);
    if (!result.ok) {
      get().toast({ kind: 'warning', title: 'Cannot edit that clip', message: result.error.message });
      return;
    }
    get().applySequence(result.sequence, label, true);
  },

  addTextLayer: (text = 'Your text') => {
    const state = get();
    let sequence = state.project.sequence;
    let track = sequence.tracks.find((t) => t.kind === 'video' && !t.locked && t.clips.length === 0 && t.name !== 'V1');
    if (!track) {
      const added = addTrack(sequence, 'video', 'Text');
      if (!added.ok) return;
      sequence = added.sequence;
      track = findTrack(sequence, added.data.trackId);
    }
    if (!track) return;
    const clip = createTextClip(track.id, state.playheadSec, 3, text, sequence.fps);
    const next: Sequence = {
      ...sequence,
      tracks: sequence.tracks.map((t) => (t.id === track!.id ? { ...t, clips: [...t.clips, clip] } : t)),
    };
    get().applySequence(next, 'Add text');
    set({ selectedClipIds: [clip.id], selectedTrackId: track.id });
  },

  addTrackOfKind: (kind) => {
    const result = addTrack(get().project.sequence, kind);
    if (!result.ok) return;
    get().applySequence(result.sequence, `Add ${kind} track`);
    set({ selectedTrackId: result.data.trackId });
  },

  removeTrackById: (trackId) => {
    const result = removeTrack(get().project.sequence, trackId);
    if (!result.ok) {
      get().toast({ kind: 'warning', title: 'Cannot remove track', message: result.error.message });
      return;
    }
    get().applySequence(result.sequence, 'Remove track');
  },

  toggleTrackFlag: (trackId, flag) => {
    const track = findTrack(get().project.sequence, trackId);
    if (!track) return;
    let sequence = get().project.sequence;
    if (flag === 'solo' && !track.solo) {
      for (const other of sequence.tracks.filter((t) => t.solo && t.id !== trackId)) {
        const cleared = setTrackFlag(sequence, other.id, 'solo', false);
        if (cleared.ok) sequence = cleared.sequence;
      }
    }
    const result = setTrackFlag(sequence, trackId, flag, !track[flag]);
    if (!result.ok) return;
    get().applySequence(result.sequence, `Track ${flag}`, true);
  },

  addEffectToClip: (clipId, effectId) => {
    const clip = findClip(get().project.sequence, clipId);
    const def = effectRegistry.get(effectId);
    if (!clip || !def) return;
    const instance = { id: uid('fx'), effectId, enabled: true, params: effectRegistry.defaults(effectId) };
    const result = updateClip(get().project.sequence, clipId, { effects: [...clip.effects, instance] });
    if (result.ok) get().applySequence(result.sequence, `Add ${def.name}`);
  },

  removeEffectFromClip: (clipId, instanceId) => {
    const clip = findClip(get().project.sequence, clipId);
    if (!clip) return;
    const result = updateClip(get().project.sequence, clipId, {
      effects: clip.effects.filter((e) => e.id !== instanceId),
    });
    if (result.ok) get().applySequence(result.sequence, 'Remove effect');
  },

  setEffectParam: (clipId, instanceId, paramId, value) => {
    const clip = findClip(get().project.sequence, clipId);
    if (!clip) return;
    const effects = clip.effects.map((e) => (e.id === instanceId ? { ...e, params: { ...e.params, [paramId]: value } } : e));
    const result = updateClip(get().project.sequence, clipId, { effects });
    if (result.ok) get().applySequence(result.sequence, 'Adjust effect', true);
  },

  toggleEffect: (clipId, instanceId) => {
    const clip = findClip(get().project.sequence, clipId);
    if (!clip) return;
    const effects = clip.effects.map((e) => (e.id === instanceId ? { ...e, enabled: !e.enabled } : e));
    const result = updateClip(get().project.sequence, clipId, { effects });
    if (result.ok) get().applySequence(result.sequence, 'Toggle effect');
  },

  setKeyframeOnClip: (clipId, property, time, value) => {
    const clip = findClip(get().project.sequence, clipId);
    if (!clip) return;
    const keyframe = { id: uid('kf'), time, value, interpolation: 'linear' as const };
    const result = updateClip(get().project.sequence, clipId, {
      keyframes: { ...clip.keyframes, [property]: upsertKeyframe(clip.keyframes[property], keyframe) },
    });
    if (result.ok) get().applySequence(result.sequence, 'Set keyframe');
  },

  addMarkerAtPlayhead: () => {
    const result = addMarker(get().project.sequence, get().playheadSec, `Marker ${get().project.sequence.markers.length + 1}`);
    if (result.ok) get().applySequence(result.sequence, 'Add marker');
  },

  removeMarkerById: (id) => {
    const result = removeMarker(get().project.sequence, id);
    if (result.ok) get().applySequence(result.sequence, 'Remove marker');
  },

  applySilenceRemoval: (clipId, removals) => {
    let sequence = get().project.sequence;
    // Cut from the end backwards so earlier timestamps stay valid.
    for (const removal of [...removals].sort((a, b) => b.start - a.start)) {
      const first = splitClip(sequence, clipId, removal.start);
      if (!first.ok) continue;
      const second = splitClip(first.sequence, first.data.rightId, removal.end);
      if (!second.ok) continue;
      const removed = deleteClips(second.sequence, [first.data.rightId]);
      if (!removed.ok) continue;
      sequence = removed.sequence;
    }
    // Close the gaps left behind so the result plays back-to-back.
    const track = sequence.tracks.find((t) => t.clips.some((c) => c.id === clipId));
    if (track) {
      let cursor = 0;
      const repositioned = [...track.clips]
        .sort((a, b) => a.timeline.start - b.timeline.start)
        .map((c) => {
          const moved = { ...c, timeline: { ...c.timeline, start: cursor } };
          cursor += c.timeline.duration;
          return moved;
        });
      sequence = {
        ...sequence,
        tracks: sequence.tracks.map((t) => (t.id === track.id ? { ...t, clips: repositioned } : t)),
      };
    }
    get().applySequence(sequence, `Remove ${removals.length} silent section${removals.length === 1 ? '' : 's'}`);
  },

  setSequenceSize: (width, height, fps) =>
    set((state) => {
      const nextSettings = { ...state.project.settings, width, height, ...(fps ? { fps } : {}) };
      return {
        dirty: true,
        project: {
          ...state.project,
          settings: nextSettings,
          sequence: { ...state.project.sequence, width, height, ...(fps ? { fps } : {}) },
        },
      };
    }),

  /* ---------------- playback ---------------- */

  setPlayhead: (sec) => set({ playheadSec: Math.max(0, sec) }),

  play: () => {
    const state = get();
    const duration = sequenceDuration(state.project.sequence);
    const start = duration > 0 && state.playheadSec >= duration - 0.02 ? 0 : state.playheadSec;
    set({
      playheadSec: start,
      playback: { ...state.playback, playing: true, startedAt: performance.now(), startedAtSec: start },
    });
  },

  pause: () => set((state) => ({ playback: { ...state.playback, playing: false } })),
  togglePlay: () => (get().playback.playing ? get().pause() : get().play()),
  stop: () => set((state) => ({ playheadSec: 0, playback: { ...state.playback, playing: false } })),

  stepFrame: (delta) => {
    const fps = get().project.sequence.fps || 30;
    set((state) => ({
      playheadSec: Math.max(0, state.playheadSec + delta / fps),
      playback: { ...state.playback, playing: false },
    }));
  },

  setPlaybackRate: (rate) => set((state) => ({ playback: { ...state.playback, rate } })),
  setZoom: (pxPerSec) => set({ zoomPxPerSec: Math.min(1200, Math.max(4, pxPerSec)) }),
  setScrollX: (x) => set({ scrollX: Math.max(0, x) }),
  setActivePanel: (panel) => set({ activePanel: panel }),

  undo: () => {
    const previous = history.undo();
    if (!previous) {
      get().toast({ kind: 'info', title: 'Nothing to undo' });
      return;
    }
    set((state) => ({ project: { ...state.project, sequence: previous }, dirty: true }));
  },

  redo: () => {
    const next = history.redo();
    if (!next) {
      get().toast({ kind: 'info', title: 'Nothing to redo' });
      return;
    }
    set((state) => ({ project: { ...state.project, sequence: next }, dirty: true }));
  },

  canUndo: () => history.canUndo,
  canRedo: () => history.canRedo,

  toast: (toast) => {
    const id = uid('toast');
    set((state) => ({ toasts: [...state.toasts.slice(-4), { ...toast, id }] }));
    setTimeout(() => get().dismissToast(id), toast.kind === 'error' ? 12_000 : 5000);
  },

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
  setBusy: (busy) => set({ busy }),
  setCapabilities: (caps) => set({ capabilities: caps }),
}));

/** Subtitle clips reuse the text style shape; this maps the subtitle defaults onto it. */
export function subtitleStyleAsText(): NonNullable<Clip['text']> {
  const style = defaultSubtitleStyle();
  return {
    text: '',
    fontFamily: style.fontName,
    fontSizePx: style.fontSizePx,
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? 'italic' : 'normal',
    color: style.primaryColor,
    align: 'center',
    lineHeight: 1.2,
    letterSpacing: 0,
    uppercase: style.uppercase,
    strokeColor: style.outlineColor,
    strokeWidthPx: style.outlineWidthPx,
    shadow: {
      enabled: style.shadowOffsetPx > 0,
      color: style.shadowColor,
      blurPx: 4,
      offsetX: 0,
      offsetY: style.shadowOffsetPx,
    },
    background: { enabled: style.backOpacity > 0, color: style.backColor, paddingPx: 12, radiusPx: 6 },
    box: null,
    animation: 'none',
    animationSec: 0.4,
  };
}

export { sequenceDuration };
