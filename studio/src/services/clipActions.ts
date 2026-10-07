/** High-level editing actions shared by UI, context menus and keyboard shortcuts. */
import type { Clip, MediaAsset, TextStyle, TextAnimation, Track, TrackKind, VisualClip } from '@/core/types';
import * as cmd from '@/core/commands';
import { useProject, usePlayback, getSelectedClips, seekFrameSnapped } from '@/core/store';
import { makeAudioClip, makeColorClip, makeImageClip, makeStickerClip, makeTextClip, makeVideoClip } from '@/core/defaults';
import { getAsset } from '@/engine/MediaManager';
import { getEffect } from '@/library/effects';
import { getTransition } from '@/library/transitions';
import { toast } from '@/core/uiStore';
import { uid, deepClone } from '@/core/util';
import { useFavorites } from './favorites';
import { snapToFrame } from '@/core/time';

const store = () => useProject.getState();
export const playhead = () => usePlayback.getState().time;

export function addAssetToTimeline(asset: MediaAsset, opts: { at?: number; trackId?: string | null; duration?: number } = {}): Clip | null {
  const at = opts.at ?? playhead();
  let clip: Clip;
  if (asset.type === 'video') clip = makeVideoClip({ trackId: '', mediaId: asset.id, name: asset.name, start: at, duration: opts.duration ?? asset.duration, hasAudio: asset.hasAudio });
  else if (asset.type === 'audio') clip = makeAudioClip({ trackId: '', mediaId: asset.id, name: asset.name, start: at, duration: opts.duration ?? asset.duration });
  else if (asset.type === 'image') clip = makeImageClip({ trackId: '', mediaId: asset.id, name: asset.name, start: at, duration: opts.duration ?? 5 });
  else return null;
  let placed: Clip | null = null;
  store().apply(`Add ${asset.type}`, (p) => {
    const r = cmd.addClip(p, clip, opts.trackId ?? null);
    placed = r.clip;
    return { ...r.project, mediaIds: p.mediaIds.includes(asset.id) ? p.mediaIds : [...p.mediaIds, asset.id] };
  });
  useFavorites.getState().touch('media', asset.id);
  if (placed) store().select([(placed as Clip).id]);
  return placed;
}

export function addTextClip(text = 'Your text here', style: Partial<TextStyle> = {}, animation: Partial<TextAnimation> = {}, duration = 4, at?: number): Clip | null {
  const clip = makeTextClip({ trackId: '', text, start: at ?? playhead(), duration, style, animation });
  let placed: Clip | null = null;
  store().apply('Add text', (p) => {
    const r = cmd.addClip(p, clip, null);
    placed = r.clip;
    return r.project;
  });
  if (placed) store().select([(placed as Clip).id]);
  return placed;
}

export function addStickerClip(stickerId: string | null, mediaId: string | null, name: string, animation: string | null = null, duration = 4): Clip | null {
  const clip = makeStickerClip({ trackId: '', stickerId: stickerId ?? undefined, mediaId: mediaId ?? undefined, name, start: playhead(), duration, animation });
  let placed: Clip | null = null;
  store().apply('Add sticker', (p) => {
    const r = cmd.addClip(p, clip, null);
    placed = r.clip;
    return r.project;
  });
  if (placed) store().select([(placed as Clip).id]);
  if (stickerId) useFavorites.getState().touch('sticker', stickerId);
  return placed;
}

export function addColorClip(color = '#111111', duration = 5): Clip | null {
  const clip = makeColorClip({ trackId: '', color, start: playhead(), duration });
  let placed: Clip | null = null;
  store().apply('Add color', (p) => {
    const r = cmd.addClip(p, clip, null);
    placed = r.clip;
    return r.project;
  });
  if (placed) store().select([(placed as Clip).id]);
  return placed;
}

export function splitAtPlayhead() {
  const t = playhead();
  const sel = getSelectedClips();
  const p = store().project!;
  const targets = sel.length ? sel : cmd.clipsInRange(p, t - 1e-6, t + 1e-6).filter((c) => !cmd.findClip(p, c.id)?.track.locked);
  const hit = targets.filter((c) => t > c.start + 1e-3 && t < c.start + c.duration - 1e-3);
  if (!hit.length) {
    toast('Nothing to split at the playhead', 'info');
    return;
  }
  const newIds: string[] = [];
  store().apply('Split', (proj) => {
    let out = proj;
    for (const c of hit) {
      const r = cmd.splitClip(out, c.id, t);
      out = r.project;
      if (r.newId) newIds.push(r.newId);
    }
    return out;
  });
  if (newIds.length) store().select(newIds);
}

export function deleteSelection(ripple = false) {
  const ids = store().selection;
  if (!ids.length) return;
  store().apply(ripple ? 'Ripple delete' : 'Delete', (p) => (ripple ? cmd.rippleDelete(p, ids) : cmd.removeClips(p, ids)));
  store().select([]);
}

export function copySelection() {
  const clips = getSelectedClips();
  if (!clips.length) return;
  store().setClipboard(clips);
  toast(`Copied ${clips.length} clip${clips.length > 1 ? 's' : ''}`, 'info');
}

export function cutSelection() {
  copySelection();
  deleteSelection();
}

export function pasteClipboard() {
  const { clipboard } = store();
  if (!clipboard.length) return;
  const t = playhead();
  const min = Math.min(...clipboard.map((c) => c.start));
  const newIds: string[] = [];
  store().apply('Paste', (p) => {
    let out = p;
    for (const c of clipboard) {
      const copy = { ...deepClone(c), id: uid('clip'), start: t + (c.start - min), groupId: undefined } as Clip;
      const r = cmd.addClip(out, copy, c.trackId);
      out = r.project;
      newIds.push(r.clip.id);
    }
    return out;
  });
  store().select(newIds);
}

export function duplicateSelection() {
  const ids = store().selection;
  if (!ids.length) return;
  let newIds: string[] = [];
  store().apply('Duplicate', (p) => {
    const r = cmd.duplicateClips(p, ids);
    newIds = r.newIds;
    return r.project;
  });
  store().select(newIds);
}

export function selectAll() {
  const p = store().project!;
  store().select(cmd.allClips(p).map((c) => c.id));
}

export function nudgeSelection(frames: number) {
  const ids = store().selection;
  if (!ids.length) return;
  const fps = store().project!.settings.fps;
  store().apply('Nudge', (p) => cmd.moveClips(p, ids, frames / fps), { merge: true });
}

export function groupSelection() {
  const ids = store().selection;
  if (ids.length < 2) return;
  store().apply('Group', (p) => cmd.groupClips(p, ids));
}
export function ungroupSelection() {
  const ids = store().selection;
  if (!ids.length) return;
  store().apply('Ungroup', (p) => cmd.ungroupClips(p, ids));
}

export function toggleLockSelection() {
  const clips = getSelectedClips();
  if (!clips.length) return;
  const lock = !clips.every((c) => c.locked);
  store().apply(lock ? 'Lock clips' : 'Unlock clips', (p) => cmd.updateClips(p, clips.map((c) => c.id), (c) => ({ ...c, locked: lock })));
}

export function stepFrames(n: number) {
  const fps = store().project!.settings.fps;
  seekFrameSnapped(playhead() + n / fps);
}

export function jumpToEdge(dir: 1 | -1) {
  const p = store().project!;
  const e = cmd.nextEdge(p, playhead(), dir);
  seekFrameSnapped(e ?? (dir > 0 ? cmd.projectDuration(p) : 0));
}

export function setTransition(clipId: string, edge: 'in' | 'out', type: string | null, duration?: number) {
  const def = type ? getTransition(type) : null;
  store().apply(type ? 'Add transition' : 'Remove transition', (p) =>
    cmd.updateClip(p, clipId, (c) => {
      const key = edge === 'in' ? 'transitionIn' : 'transitionOut';
      if (!def) return { ...c, [key]: null } as Clip;
      const params: Record<string, number> = {};
      def.params.forEach((pd) => (params[pd.key] = pd.default));
      return { ...c, [key]: { type: def.id, duration: duration ?? def.defaultDuration, params } } as Clip;
    }),
  );
  if (type) useFavorites.getState().touch('transition', type);
}

/** Apply a transition between the selected clip and its neighbour (or to all cuts if `all`). */
export function applyTransitionToSelection(type: string, all = false) {
  const p = store().project!;
  const sel = getSelectedClips().filter((c) => c.kind !== 'audio');
  const def = getTransition(type);
  if (!def) return;
  const targets: { id: string; edge: 'in' | 'out' }[] = [];
  const pick = (c: Clip) => {
    const track = cmd.findClip(p, c.id)!.track;
    const idx = track.clips.findIndex((x) => x.id === c.id);
    const next = track.clips[idx + 1];
    const prev = track.clips[idx - 1];
    if (next && Math.abs(next.start - (c.start + c.duration)) < 1e-3) targets.push({ id: c.id, edge: 'out' });
    else if (prev && Math.abs(c.start - (prev.start + prev.duration)) < 1e-3) targets.push({ id: prev.id, edge: 'out' });
    else targets.push({ id: c.id, edge: 'out' }); // leads to nothing; still store (applies when a neighbour is added)
  };
  if (all) {
    for (const t of p.tracks) if (t.kind !== 'audio') for (let i = 0; i < t.clips.length - 1; i++) if (Math.abs(t.clips[i + 1].start - (t.clips[i].start + t.clips[i].duration)) < 1e-3) targets.push({ id: t.clips[i].id, edge: 'out' });
  } else if (sel.length) sel.forEach(pick);
  else {
    // nearest cut to playhead
    const t = playhead();
    let best: { id: string; d: number } | null = null;
    for (const tr of p.tracks) if (tr.kind !== 'audio') for (let i = 0; i < tr.clips.length - 1; i++) {
      const c = tr.clips[i];
      const d = Math.abs(c.start + c.duration - t);
      if (!best || d < best.d) best = { id: c.id, d };
    }
    if (best) targets.push({ id: best.id, edge: 'out' });
  }
  if (!targets.length) {
    toast('Select a clip next to a cut to add a transition', 'info');
    return;
  }
  const params: Record<string, number> = {};
  def.params.forEach((pd) => (params[pd.key] = pd.default));
  store().apply('Add transition', (proj) => {
    let out = proj;
    for (const t of targets) out = cmd.updateClip(out, t.id, (c) => ({ ...c, [t.edge === 'in' ? 'transitionIn' : 'transitionOut']: { type: def.id, duration: def.defaultDuration, params } }) as Clip);
    return out;
  });
  useFavorites.getState().touch('transition', type);
  toast(`${def.name} transition added`, 'success');
}

export function addEffectToSelection(type: string) {
  const def = getEffect(type);
  if (!def) return;
  const sel = getSelectedClips().filter((c) => c.kind !== 'audio') as VisualClip[];
  const targets = sel.length ? sel : (cmd.clipsInRange(store().project!, playhead(), playhead() + 1e-6).filter((c) => c.kind !== 'audio') as VisualClip[]);
  if (!targets.length) {
    toast('Select a clip to apply the effect', 'info');
    return;
  }
  const params: Record<string, any> = {};
  def.params.forEach((pd) => (params[pd.key] = { value: pd.default }));
  store().apply(`Add ${def.name}`, (p) => cmd.updateClips(p, targets.map((c) => c.id), (c) => ({ ...c, effects: [...(c as VisualClip).effects, { id: uid('fx'), type, enabled: true, params: deepClone(params) }] }) as Clip));
  useFavorites.getState().touch('effect', type);
  if (!sel.length) store().select(targets.map((c) => c.id));
  toast(`${def.name} applied`, 'success');
}

export function addTrack(kind: TrackKind) {
  store().apply('Add track', (p) => cmd.addTrack(p, kind).project);
}

export function setTrack(trackId: string, props: Partial<Track>) {
  store().apply('Track', (p) => cmd.setTrackProps(p, trackId, props), { merge: true });
}

export function removeTrack(trackId: string) {
  store().apply('Remove track', (p) => cmd.removeTrack(p, trackId));
}

export function freezeAtPlayhead() {
  const sel = getSelectedClips().find((c) => c.kind === 'video');
  const t = playhead();
  const p = store().project!;
  const target = sel ?? cmd.clipsInRange(p, t, t + 1e-6).find((c) => c.kind === 'video');
  if (!target) {
    toast('Place the playhead over a video clip', 'info');
    return;
  }
  store().apply('Freeze frame', (proj) => cmd.freezeFrame(proj, target.id, snapToFrame(t, proj.settings.fps), 2));
}

export function detachAudioSelection() {
  const sel = getSelectedClips().filter((c) => c.kind === 'video');
  if (!sel.length) return;
  store().apply('Detach audio', (p) => {
    let out = p;
    for (const c of sel) out = cmd.detachAudio(out, c.id);
    return out;
  });
}

export function replaceSelectedMedia(asset: MediaAsset) {
  const sel = getSelectedClips().find((c) => c.kind === 'video' || c.kind === 'image' || c.kind === 'audio' || c.kind === 'sticker');
  if (!sel) {
    toast('Select a clip to replace its media', 'info');
    return;
  }
  const compatible = (sel.kind === 'audio' && asset.type === 'audio') || ((sel.kind === 'video' || sel.kind === 'image' || sel.kind === 'sticker') && (asset.type === 'video' || asset.type === 'image'));
  if (!compatible) {
    toast('Media type does not match the selected clip', 'error');
    return;
  }
  store().apply('Replace media', (p) => {
    let out = cmd.replaceMedia(p, sel.id, asset.id, asset.duration, asset.name);
    if (sel.kind === 'image' && asset.type === 'video') out = cmd.updateClip(out, sel.id, (c) => ({ ...(makeVideoClip({ trackId: c.trackId, mediaId: asset.id, name: asset.name, start: c.start, duration: Math.min(c.duration, asset.duration), hasAudio: asset.hasAudio }) as any), id: c.id, transform: (c as any).transform, grade: (c as any).grade, effects: (c as any).effects }));
    if (sel.kind === 'video' && asset.type === 'image') out = cmd.updateClip(out, sel.id, (c) => ({ ...(makeImageClip({ trackId: c.trackId, mediaId: asset.id, name: asset.name, start: c.start, duration: c.duration }) as any), id: c.id, transform: (c as any).transform, grade: (c as any).grade, effects: (c as any).effects }));
    return { ...out, mediaIds: out.mediaIds.includes(asset.id) ? out.mediaIds : [...out.mediaIds, asset.id] };
  });
  toast('Media replaced', 'success');
}

export function goToStart() {
  seekFrameSnapped(0);
}
export function goToEnd() {
  seekFrameSnapped(cmd.projectDuration(store().project!));
}

export function setInPoint() {
  usePlayback.getState().set({ inPoint: playhead() });
}
export function setOutPoint() {
  usePlayback.getState().set({ outPoint: playhead() });
}
export function clearInOut() {
  usePlayback.getState().set({ inPoint: null, outPoint: null });
}
