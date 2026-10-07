import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useProject, usePlayback, seekFrameSnapped, addMarker } from '@/core/store';
import { useUI } from '@/core/uiStore';
import type { Clip, Project, Track } from '@/core/types';
import * as cmd from '@/core/commands';
import * as act from '@/services/clipActions';
import { formatTime } from '@/core/util';
import { snapToFrame } from '@/core/time';
import { Scissors, Trash2, Magnet, ZoomIn, ZoomOut, Maximize2, Plus, Flag, Lock, Unlock, Eye, EyeOff, Volume2, VolumeX, Headphones, MoreHorizontal, Copy, Snowflake, Link2, Unlink } from 'lucide-react';
import { ClipView } from './ClipView';
import { ContextMenu } from '../common';
import { getAsset, useMedia } from '@/engine/MediaManager';
import { engine } from '@/engine/PlaybackEngine';

const RULER_H = 28;

export interface DragState {
  kind: 'move' | 'trim-l' | 'trim-r';
  ids: string[];
  originX: number;
  originY: number;
  startTimes: Map<string, number>;
  trackIds: Map<string, string>;
  durations: Map<string, number>;
  primary: string;
  moved: boolean;
}

export function Timeline({ zoomFit }: { zoomFit: () => void }) {
  const project = useProject((s) => s.project)!;
  const selection = useProject((s) => s.selection);
  const zoom = useUI((s) => s.timelineZoom);
  const snapping = useUI((s) => s.snapping);
  const ripple = useUI((s) => s.ripple);
  const mode = useUI((s) => s.mode);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headersRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [snapLine, setSnapLine] = useState<number | null>(null);
  const [rubber, setRubber] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; clipId?: string; trackId?: string; time?: number } | null>(null);
  const [dropTrack, setDropTrack] = useState<string | null>(null);
  const duration = cmd.projectDuration(project);
  const contentW = Math.max((duration + 10) * zoom, 1200);
  const fps = project.settings.fps;

  const timeToX = useCallback((t: number) => t * zoom, [zoom]);
  const xToTime = useCallback((x: number) => x / zoom, [zoom]);

  // scroll sync between headers & lanes
  const onScroll = () => {
    if (headersRef.current && scrollRef.current) headersRef.current.scrollTop = scrollRef.current.scrollTop;
  };

  // wheel: ctrl = zoom, shift = horizontal
  useEffect(() => {
    const el = scrollRef.current!;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left + el.scrollLeft;
        const t = mx / zoom;
        const nz = Math.min(2000, Math.max(4, zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        useUI.getState().setZoom(nz);
        requestAnimationFrame(() => {
          el.scrollLeft = t * nz - (e.clientX - rect.left);
        });
      } else if (!e.shiftKey && Math.abs(e.deltaX) < Math.abs(e.deltaY) && e.altKey) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom]);

  // auto-follow playhead
  useEffect(() => {
    return usePlayback.subscribe((s, prev) => {
      if (!s.playing || s.time === prev.time) return;
      const el = scrollRef.current;
      if (!el) return;
      const x = s.time * useUI.getState().timelineZoom;
      if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 60);
    });
  }, []);

  /* ---------------- snapping ---------------- */
  const snap = (t: number, ignoreIds: string[] = [], extraPts: number[] = []): { t: number; snapped: number | null } => {
    if (!snapping) return { t: snapToFrame(t, fps), snapped: null };
    const thresh = 8 / zoom;
    let best: number | null = null, bd = thresh;
    const ph = usePlayback.getState().time;
    const pts = [...extraPts, ph];
    for (const tr of project.tracks) for (const c of tr.clips) if (!ignoreIds.includes(c.id)) pts.push(c.start, c.start + c.duration);
    for (const m of project.markers) pts.push(m.time);
    pts.push(0);
    for (const p of pts) {
      const d = Math.abs(p - t);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best !== null ? { t: best, snapped: best } : { t: snapToFrame(t, fps), snapped: null };
  };

  /* ---------------- scrubbing ---------------- */
  const scrubFrom = (e: React.MouseEvent) => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    const toT = (clientX: number) => Math.max(0, xToTime(clientX - rect.left + el.scrollLeft));
    const wasPlaying = usePlayback.getState().playing;
    if (wasPlaying) engine.pause();
    seekFrameSnapped(toT(e.clientX));
    const move = (ev: MouseEvent) => seekFrameSnapped(toT(ev.clientX));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  /* ---------------- clip drag / trim ---------------- */
  const onClipMouseDown = (e: React.MouseEvent, clip: Clip, kind: DragState['kind']) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const st = useProject.getState();
    let ids = st.selection;
    if (!ids.includes(clip.id)) {
      st.select([clip.id], e.shiftKey || e.ctrlKey || e.metaKey);
      ids = useProject.getState().selection;
    } else if (e.shiftKey || e.ctrlKey || e.metaKey) {
      st.select(ids.filter((i) => i !== clip.id));
      return;
    }
    if (clip.locked) return;
    const p = useProject.getState().project!;
    const clips = ids.map((id) => cmd.findClip(p, id)?.clip).filter(Boolean) as Clip[];
    const ds: DragState = {
      kind,
      ids: kind === 'move' ? clips.map((c) => c.id) : [clip.id],
      originX: e.clientX,
      originY: e.clientY,
      startTimes: new Map(clips.map((c) => [c.id, c.start])),
      trackIds: new Map(clips.map((c) => [c.id, c.trackId])),
      durations: new Map(clips.map((c) => [c.id, c.duration])),
      primary: clip.id,
      moved: false,
    };
    setDrag(ds);
    const base = useProject.getState().project!;
    const move = (ev: MouseEvent) => {
      const dx = ev.clientX - ds.originX;
      const dy = ev.clientY - ds.originY;
      if (!ds.moved && Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      ds.moved = true;
      const dt = dx / zoom;
      if (ds.kind === 'move') {
        const prim = cmd.findClip(base, ds.primary)!.clip;
        const rawStart = ds.startTimes.get(ds.primary)! + dt;
        const s1 = snap(rawStart, ds.ids);
        const s2 = snap(rawStart + prim.duration, ds.ids);
        let nt = s1.t, line: number | null = s1.snapped;
        if (s2.snapped !== null && (s1.snapped === null || Math.abs(s2.t - (rawStart + prim.duration)) < Math.abs(s1.t - rawStart))) {
          nt = s2.t - prim.duration;
          line = s2.snapped;
        }
        setSnapLine(line);
        const delta = nt - ds.startTimes.get(ds.primary)!;
        // vertical track change (single clip only)
        let newTrackId: string | undefined;
        if (ds.ids.length === 1) {
          const lane = document.elementsFromPoint(ev.clientX, ev.clientY).find((el) => (el as HTMLElement).dataset?.trackId) as HTMLElement | undefined;
          if (lane) newTrackId = lane.dataset.trackId;
        }
        useProject.getState().apply('Move clip', (proj) => {
          if (ds.ids.length === 1) {
            const target = newTrackId && cmd.clipFitsTrack(proj.tracks.find((t) => t.id === newTrackId)!, prim.kind) ? newTrackId : ds.trackIds.get(ds.primary)!;
            // reset to base then move
            const restored = cmd.updateClip(proj, ds.primary, (c) => ({ ...c, start: ds.startTimes.get(ds.primary)! }));
            return cmd.moveClip(restored, ds.primary, Math.max(0, ds.startTimes.get(ds.primary)! + delta), target);
          }
          const restored = cmd.updateClips(proj, ds.ids, (c) => ({ ...c, start: ds.startTimes.get(c.id)! }));
          return cmd.moveClips(restored, ds.ids, delta);
        }, { merge: true });
      } else {
        const c0 = cmd.findClip(base, ds.primary)!.clip;
        const mediaDur = (c0 as any).mediaId ? getAsset((c0 as any).mediaId)?.duration : undefined;
        if (ds.kind === 'trim-l') {
          const s = snap(c0.start + dt, [ds.primary]);
          setSnapLine(s.snapped);
          useProject.getState().apply('Trim', (proj) => cmd.trimClip(cmd.updateClip(proj, ds.primary, () => c0), ds.primary, 'start', s.t, mediaDur), { merge: true });
        } else {
          const s = snap(c0.start + c0.duration + dt, [ds.primary]);
          setSnapLine(s.snapped);
          useProject.getState().apply('Trim', (proj) => cmd.trimClip(cmd.updateClip(proj, ds.primary, () => c0), ds.primary, 'end', s.t, mediaDur), { merge: true });
        }
      }
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      setDrag(null);
      setSnapLine(null);
      useProject.setState({ lastLabel: '' });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  /* ---------------- rubber band ---------------- */
  const onLaneMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    const x0 = e.clientX - rect.left + el.scrollLeft, y0 = e.clientY - rect.top + el.scrollTop;
    if (!(e.shiftKey || e.ctrlKey || e.metaKey)) useProject.getState().select([]);
    let started = false;
    const move = (ev: MouseEvent) => {
      const x1 = ev.clientX - rect.left + el.scrollLeft, y1 = ev.clientY - rect.top + el.scrollTop;
      if (!started && Math.hypot(x1 - x0, y1 - y0) < 4) return;
      started = true;
      setRubber({ x0, y0, x1, y1 });
      // select clips intersecting
      const t0 = xToTime(Math.min(x0, x1)), t1 = xToTime(Math.max(x0, x1));
      const ya = Math.min(y0, y1), yb = Math.max(y0, y1);
      const p = useProject.getState().project!;
      let y = RULER_H;
      const ids: string[] = [];
      for (const tr of p.tracks) {
        const h = tr.height;
        if (y + h > ya && y < yb) for (const c of tr.clips) if (c.start < t1 && c.start + c.duration > t0) ids.push(c.id);
        y += h;
      }
      useProject.getState().select(ids);
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      if (!started) seekFrameSnapped(xToTime(ev.clientX - rect.left + el.scrollLeft));
      setRubber(null);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  /* ---------------- external drops (media panel) ---------------- */
  const onDragOver = (e: React.DragEvent, trackId: string | null) => {
    if (e.dataTransfer.types.includes('application/neurio-asset') || e.dataTransfer.types.includes('application/neurio-item')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDropTrack(trackId);
    }
  };
  const onDrop = (e: React.DragEvent, trackId: string | null) => {
    setDropTrack(null);
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    const t = Math.max(0, xToTime(e.clientX - rect.left + el.scrollLeft));
    const assetId = e.dataTransfer.getData('application/neurio-asset');
    if (assetId) {
      e.preventDefault();
      const a = useMedia.getState().assets.find((x) => x.id === assetId);
      if (a) act.addAssetToTimeline(a, { at: snapToFrame(t, fps), trackId });
      return;
    }
    const item = e.dataTransfer.getData('application/neurio-item');
    if (item) {
      e.preventDefault();
      const data = JSON.parse(item);
      usePlayback.getState().seek(snapToFrame(t, fps));
      if (data.kind === 'text') act.addTextClip(data.text, data.style, data.animation, 4, snapToFrame(t, fps));
      else if (data.kind === 'sticker') act.addStickerClip(data.stickerId, null, data.name, data.animation);
      else if (data.kind === 'effect') act.addEffectToSelection(data.id);
      else if (data.kind === 'transition') act.applyTransitionToSelection(data.id);
    }
  };

  const toolbarBtn = (icon: React.ReactNode, title: string, onClick: () => void, active = false, disabled = false) => (
    <button className={`icon-btn ${active ? 'active' : ''}`} onClick={onClick} title={title} disabled={disabled}>
      {icon}
    </button>
  );

  return (
    <div className="timeline" onContextMenu={(e) => e.preventDefault()}>
      <div className="tl-toolbar">
        {toolbarBtn(<Scissors size={15} />, 'Split at playhead (S)', act.splitAtPlayhead)}
        {toolbarBtn(<Trash2 size={15} />, 'Delete selection (Del)', () => act.deleteSelection(ripple), false, !selection.length)}
        {mode === 'pro' && toolbarBtn(<Snowflake size={15} />, 'Freeze frame (Ctrl+Shift+F)', act.freezeAtPlayhead)}
        {mode === 'pro' && toolbarBtn(<Unlink size={15} />, 'Detach audio', act.detachAudioSelection, false, !selection.length)}
        {toolbarBtn(<Copy size={15} />, 'Duplicate (Ctrl+D)', act.duplicateSelection, false, !selection.length)}
        <div className="sep" />
        {toolbarBtn(<Magnet size={15} />, `Magnetic snapping ${snapping ? 'on' : 'off'} (N)`, () => useUI.getState().set({ snapping: !snapping }), snapping)}
        {mode === 'pro' && toolbarBtn(<Link2 size={15} />, `Ripple delete ${ripple ? 'on' : 'off'}`, () => useUI.getState().set({ ripple: !ripple }), ripple)}
        {toolbarBtn(<Flag size={15} />, 'Add marker (M)', () => addMarker(usePlayback.getState().time))}
        <div className="sep" />
        <div style={{ flex: 1 }} />
        <span className="muted small mono">{formatTime(usePlayback.getState().time, fps)}</span>
        <div className="sep" />
        {toolbarBtn(<ZoomOut size={15} />, 'Zoom out (-)', () => useUI.getState().setZoom(zoom / 1.25))}
        <input type="range" min={0} max={1} step={0.001} value={Math.log(zoom / 4) / Math.log(500)} onChange={(e) => useUI.getState().setZoom(4 * Math.pow(500, parseFloat(e.target.value)))} style={{ width: 100 }} title="Timeline zoom" />
        {toolbarBtn(<ZoomIn size={15} />, 'Zoom in (+)', () => useUI.getState().setZoom(zoom * 1.25))}
        {toolbarBtn(<Maximize2 size={15} />, 'Zoom to fit (Shift+Z)', zoomFit)}
      </div>
      <div className="tl-body">
        <div className="tl-headers">
          <div className="ruler-corner">
            <button className="btn xs" onClick={(e) => setMenu({ x: e.clientX, y: e.clientY })} title="Add track">
              <Plus size={12} /> Track
            </button>
          </div>
          <div className="tl-headers-scroll" ref={headersRef}>
            {project.tracks.map((t) => (
              <TrackHeader key={t.id} track={t} />
            ))}
            <div style={{ height: 80 }} />
          </div>
        </div>
        <div className="tl-scroll" ref={scrollRef} onScroll={onScroll} onDragOver={(e) => onDragOver(e, null)} onDrop={(e) => onDrop(e, null)} onDragLeave={() => setDropTrack(null)}>
          <div className="tl-content" style={{ width: contentW }}>
            <Ruler zoom={zoom} width={contentW} onMouseDown={scrubFrom} project={project} />
            {project.tracks.map((t) => (
              <div
                key={t.id}
                className={`track-lane ${t.locked ? 'locked' : ''} ${t.hidden ? 'hidden' : ''} ${dropTrack === t.id ? 'drop-ok' : ''}`}
                style={{ height: t.height }}
                data-track-id={t.id}
                onMouseDown={onLaneMouseDown}
                onDragOver={(e) => {
                  e.stopPropagation();
                  onDragOver(e, t.id);
                }}
                onDrop={(e) => {
                  e.stopPropagation();
                  onDrop(e, t.id);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  const el = scrollRef.current!;
                  const rect = el.getBoundingClientRect();
                  setMenu({ x: e.clientX, y: e.clientY, trackId: t.id, time: xToTime(e.clientX - rect.left + el.scrollLeft) });
                }}
              >
                {t.clips.map((c, i) => (
                  <ClipView
                    key={c.id}
                    clip={c}
                    track={t}
                    zoom={zoom}
                    selected={selection.includes(c.id)}
                    dragging={!!drag && drag.ids.includes(c.id) && drag.moved}
                    onMouseDown={onClipMouseDown}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (!selection.includes(c.id)) useProject.getState().select([c.id]);
                      setMenu({ x: e.clientX, y: e.clientY, clipId: c.id });
                    }}
                    next={t.clips[i + 1]}
                  />
                ))}
              </div>
            ))}
            <div style={{ height: 80 }} />
            {snapLine !== null && <div className="snap-line" style={{ left: timeToX(snapLine) }} />}
            {rubber && <div className="rubber" style={{ left: Math.min(rubber.x0, rubber.x1), top: Math.min(rubber.y0, rubber.y1), width: Math.abs(rubber.x1 - rubber.x0), height: Math.abs(rubber.y1 - rubber.y0) }} />}
            <Playhead zoom={zoom} />
            {project.tracks.every((t) => t.clips.length === 0) && <div className="tl-empty">Drag media here, or use the panels on the left to add video, audio, text and more.</div>}
          </div>
        </div>
      </div>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={
            menu.clipId
              ? clipMenu(menu.clipId, project)
              : menu.trackId
                ? [
                    { label: 'Paste here', shortcut: 'Ctrl+V', onClick: () => { usePlayback.getState().seek(menu.time!); act.pasteClipboard(); }, disabled: !useProject.getState().clipboard.length },
                    { label: 'Close gap at this point', onClick: () => useProject.getState().apply('Close gap', (p) => cmd.closeGap(p, menu.trackId!, menu.time!)) },
                    { label: 'Add marker here', onClick: () => addMarker(menu.time!) },
                    'sep',
                    { label: 'Add video track', onClick: () => act.addTrack('video') },
                    { label: 'Add overlay track', onClick: () => act.addTrack('overlay') },
                    { label: 'Add text track', onClick: () => act.addTrack('text') },
                    { label: 'Add audio track', onClick: () => act.addTrack('audio') },
                  ]
                : [
                    { label: 'Video track', onClick: () => act.addTrack('video') },
                    { label: 'Overlay track', onClick: () => act.addTrack('overlay') },
                    { label: 'Image track', onClick: () => act.addTrack('image') },
                    { label: 'Text track', onClick: () => act.addTrack('text') },
                    { label: 'Sticker track', onClick: () => act.addTrack('sticker') },
                    { label: 'Audio track', onClick: () => act.addTrack('audio') },
                  ]
          }
        />
      )}
    </div>
  );
}

function clipMenu(clipId: string, project: Project) {
  const f = cmd.findClip(project, clipId);
  const clip = f?.clip;
  const sel = useProject.getState().selection;
  const ui = useUI.getState();
  const items: any[] = [
    { label: 'Split at playhead', shortcut: 'S', onClick: act.splitAtPlayhead },
    { label: 'Copy', shortcut: 'Ctrl+C', onClick: act.copySelection },
    { label: 'Cut', shortcut: 'Ctrl+X', onClick: act.cutSelection },
    { label: 'Duplicate', shortcut: 'Ctrl+D', onClick: act.duplicateSelection },
    'sep',
  ];
  if (clip?.kind === 'video') {
    items.push({ label: 'Freeze frame here', shortcut: 'Ctrl+Shift+F', onClick: act.freezeAtPlayhead });
    items.push({ label: clip.speed.reversed ? 'Un-reverse' : 'Reverse', onClick: () => useProject.getState().apply('Reverse', (p) => cmd.toggleReverse(p, clipId)) });
    if (clip.hasAudio && !clip.audioDetached) items.push({ label: 'Detach audio', onClick: act.detachAudioSelection });
    items.push({ label: 'Speed…', onClick: () => ui.setRightPanel('speed') });
    items.push({ label: 'Stabilize…', onClick: () => ui.setRightPanel('stabilize') });
  }
  if (clip?.kind === 'audio') items.push({ label: clip.speed.reversed ? 'Un-reverse' : 'Reverse', onClick: () => useProject.getState().apply('Reverse', (p) => cmd.toggleReverse(p, clipId)) });
  if (clip && clip.kind !== 'audio') {
    items.push({ label: 'Replace media…', onClick: () => { ui.setLeftPanel('media'); ui.toast({ title: 'Pick a file in the Media panel and use "Replace selected"', kind: 'info' }); } });
    items.push({ label: 'Adjust colors…', onClick: () => ui.setRightPanel('adjust') });
    items.push({ label: 'Add mask…', onClick: () => ui.setRightPanel('mask') });
    items.push({ label: 'Animation / keyframes…', onClick: () => ui.setRightPanel('animation') });
  }
  items.push('sep');
  if (sel.length > 1) {
    items.push({ label: 'Group', shortcut: 'Ctrl+G', onClick: act.groupSelection });
  }
  if (clip?.groupId) items.push({ label: 'Ungroup', shortcut: 'Ctrl+Shift+G', onClick: act.ungroupSelection });
  items.push({ label: clip?.locked ? 'Unlock' : 'Lock', shortcut: 'Ctrl+L', onClick: act.toggleLockSelection });
  items.push({ label: 'Rename…', onClick: () => { const n = prompt('Clip name', clip?.name); if (n) useProject.getState().apply('Rename', (p) => cmd.updateClip(p, clipId, (c) => ({ ...c, name: n }))); } });
  items.push('sep');
  items.push({ label: 'Delete', shortcut: 'Del', onClick: () => act.deleteSelection(false), danger: true });
  items.push({ label: 'Ripple delete', shortcut: 'Shift+Del', onClick: () => act.deleteSelection(true), danger: true });
  return items;
}

function TrackHeader({ track }: { track: Track }) {
  const [editing, setEditing] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const colors: Record<string, string> = { video: 'var(--video)', audio: 'var(--audio)', text: 'var(--text-clip)', sticker: 'var(--sticker)', overlay: 'var(--overlay)', image: 'var(--image)' };
  const selectedTrack = useProject((s) => s.selectedTrackId);
  return (
    <div className={`track-header ${track.locked ? 'locked' : ''}`} style={{ height: track.height, background: selectedTrack === track.id ? 'var(--bg-3)' : undefined }} onClick={() => useProject.getState().selectTrack(track.id)} onContextMenu={(e) => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); }}>
      <div className="kind" style={{ background: colors[track.kind] }} />
      {editing ? (
        <input
          className="nm"
          autoFocus
          defaultValue={track.name}
          onBlur={(e) => {
            act.setTrack(track.id, { name: e.target.value || track.name });
            setEditing(false);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      ) : (
        <span className="nm" onDoubleClick={() => setEditing(true)} title="Double-click to rename">
          {track.name}
        </span>
      )}
      {track.kind !== 'audio' && (
        <button className={`icon-btn ${track.hidden ? 'on red' : ''}`} onClick={() => act.setTrack(track.id, { hidden: !track.hidden })} title={track.hidden ? 'Show track' : 'Hide track'}>
          {track.hidden ? <EyeOff /> : <Eye />}
        </button>
      )}
      {(track.kind === 'audio' || track.kind === 'video') && (
        <>
          <button className={`icon-btn ${track.muted ? 'on red' : ''}`} onClick={() => act.setTrack(track.id, { muted: !track.muted })} title={track.muted ? 'Unmute' : 'Mute'}>
            {track.muted ? <VolumeX /> : <Volume2 />}
          </button>
          <button className={`icon-btn ${track.solo ? 'on' : ''}`} onClick={() => act.setTrack(track.id, { solo: !track.solo })} title="Solo">
            <Headphones />
          </button>
        </>
      )}
      <button className={`icon-btn ${track.locked ? 'on' : ''}`} onClick={() => act.setTrack(track.id, { locked: !track.locked })} title={track.locked ? 'Unlock track' : 'Lock track'}>
        {track.locked ? <Lock /> : <Unlock />}
      </button>
      <button className="icon-btn" onClick={(e) => setMenu({ x: e.clientX, y: e.clientY })} title="Track options">
        <MoreHorizontal />
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Rename', onClick: () => setEditing(true) },
            { label: 'Move up', onClick: () => useProject.getState().apply('Move track', (p) => cmd.moveTrack(p, track.id, -1)) },
            { label: 'Move down', onClick: () => useProject.getState().apply('Move track', (p) => cmd.moveTrack(p, track.id, 1)) },
            { label: track.height > 48 ? 'Compact height' : 'Tall height', onClick: () => act.setTrack(track.id, { height: track.height > 48 ? 40 : 72 }) },
            'sep',
            { label: 'Volume 100%', onClick: () => act.setTrack(track.id, { volume: 1 }), disabled: track.kind !== 'audio' && track.kind !== 'video' },
            { label: 'Volume 50%', onClick: () => act.setTrack(track.id, { volume: 0.5 }), disabled: track.kind !== 'audio' && track.kind !== 'video' },
            'sep',
            { label: 'Delete track', onClick: () => act.removeTrack(track.id), danger: true },
          ]}
        />
      )}
    </div>
  );
}

function Ruler({ zoom, width, onMouseDown, project }: { zoom: number; width: number; onMouseDown: (e: React.MouseEvent) => void; project: Project }) {
  const inPoint = usePlayback((s) => s.inPoint);
  const outPoint = usePlayback((s) => s.outPoint);
  const fps = project.settings.fps;
  // choose tick interval
  const candidates = [1 / fps, 2 / fps, 5 / fps, 10 / fps, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const minPx = 70;
  const step = candidates.find((c) => c * zoom >= minPx) ?? 600;
  const sub = step * zoom >= 140 ? step / 4 : step / 2;
  const ticks: { t: number; major: boolean }[] = [];
  const total = width / zoom;
  for (let t = 0; t <= total; t += sub) {
    const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
    ticks.push({ t, major });
  }
  return (
    <div className="ruler" onMouseDown={onMouseDown}>
      {ticks.map((tk, i) => (
        <div key={i} className={`tick ${tk.major ? 'major' : ''}`} style={{ left: tk.t * zoom }}>
          {tk.major && <span>{step < 1 ? formatTime(tk.t, fps) : formatTime(tk.t, fps, false)}</span>}
        </div>
      ))}
      {inPoint !== null && outPoint !== null && outPoint > inPoint && <div className="io" style={{ left: inPoint * zoom, width: (outPoint - inPoint) * zoom }} />}
      {project.markers.map((m) => (
        <div
          key={m.id}
          className={`marker ${m.kind}`}
          style={{ left: m.time * zoom, color: m.color }}
          title={`${m.label || m.kind} ${formatTime(m.time, fps)} — click to jump, right-click to delete`}
          onMouseDown={(e) => {
            e.stopPropagation();
            if (e.button === 2) useProject.getState().apply('Remove marker', (p) => ({ ...p, markers: p.markers.filter((x) => x.id !== m.id) }));
            else seekFrameSnapped(m.time);
          }}
          onContextMenu={(e) => e.preventDefault()}
        />
      ))}
    </div>
  );
}

function Playhead({ zoom }: { zoom: number }) {
  const time = usePlayback((s) => s.time);
  return <div className="playhead" style={{ left: time * zoom }} />;
}
