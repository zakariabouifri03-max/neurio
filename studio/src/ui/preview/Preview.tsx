import { useEffect, useRef, useState, useCallback } from 'react';
import { engine } from '@/engine/PlaybackEngine';
import { useProject, usePlayback, useSelectedClip } from '@/core/store';
import { useUI } from '@/core/uiStore';
import { formatTime } from '@/core/util';
import { projectDuration, findClip } from '@/core/commands';
import { Play, Pause, SkipBack, SkipForward, StepBack, StepForward, Repeat, Volume2, VolumeX, Maximize, Grid3X3, Scan, Gauge, Activity } from 'lucide-react';
import * as act from '@/services/clipActions';
import type { Clip, VisualClip, Vec2 } from '@/core/types';
import { vec, num, writeValue, hasKeyframes } from '@/core/keyframes';
import { getAsset } from '@/engine/MediaManager';
import { measureText } from '@/engine/TextRenderer';
import { Scopes } from './Scopes';
import { updateClip } from '@/core/commands';

/** Natural (scale=1) size of a visual clip in project pixels. */
export function clipNaturalSize(clip: VisualClip, pw: number, ph: number): { w: number; h: number } {
  if (clip.kind === 'text' || clip.kind === 'caption') {
    const m = measureText(clip, pw);
    return { w: Math.max(10, m.width), h: Math.max(10, m.height) };
  }
  if (clip.kind === 'sticker') {
    const base = pw * 0.6;
    const a = clip.mediaId ? getAsset(clip.mediaId) : null;
    const ar = a && a.height ? a.width / a.height : 1;
    return { w: base * 0.9, h: (base / ar) * 0.9 };
  }
  if (clip.kind === 'color') return { w: pw, h: ph };
  const a = getAsset((clip as any).mediaId);
  const aw = a?.width || pw, ah = a?.height || ph;
  const fit = Math.min(pw / aw, ph / ah);
  return { w: aw * fit, h: ah * fit };
}

export function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const project = useProject((s) => s.project)!;
  const { width: pw, height: ph } = project.settings;
  const [box, setBox] = useState({ w: 320, h: 180 });
  const showSafe = useUI((s) => s.showSafeZones);
  const showGrid = useUI((s) => s.showGrid);
  const scopes = useUI((s) => s.scopes);

  useEffect(() => {
    const c = canvasRef.current!;
    engine.attach(c);
    return () => engine.detach();
  }, []);

  useEffect(() => {
    const el = stageRef.current!;
    const ro = new ResizeObserver(() => {
      const W = el.clientWidth - 32, H = el.clientHeight - 32;
      const s = Math.min(W / pw, H / ph);
      setBox({ w: Math.max(80, Math.floor(pw * s)), h: Math.max(45, Math.floor(ph * s)) });
      engine.invalidate();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [pw, ph]);

  const eyedropper = useUI((s) => s.eyedropper);
  const regionPick = useUI((s) => s.regionPick);
  useEffect(() => {
    if (!eyedropper && !regionPick) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useUI.getState().set({ eyedropper: null, regionPick: null });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [eyedropper, regionPick]);

  return (
    <section className="preview">
      <div className="preview-stage" ref={stageRef} onMouseDown={(e) => e.target === e.currentTarget && useProject.getState().select([])}>
        <div className="preview-canvas-wrap" style={{ width: box.w, height: box.h }}>
          <canvas ref={canvasRef} />
          <div className="preview-overlay">
            {eyedropper && (
              <div
                className="eyedropper-layer"
                style={{ position: 'absolute', inset: 0, cursor: 'crosshair', zIndex: 50 }}
                title="Click a color in the preview (Esc to cancel)"
                onMouseDown={(e) => {
                  e.stopPropagation();
                  const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                  const rgb = engine.pickColor((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
                  useUI.getState().set({ eyedropper: null });
                  if (rgb) eyedropper(rgb);
                }}
              />
            )}
            {regionPick && <RegionPicker label={regionPick.label} onPick={(r) => { useUI.getState().set({ regionPick: null }); regionPick.onPick(r); }} />}
            {showSafe && (
              <>
                <div className="safe" />
                <div className="safe inner" />
              </>
            )}
            {showGrid && (
              <>
                <div className="grid-line" style={{ left: '33.33%', top: 0, bottom: 0, width: 1 }} />
                <div className="grid-line" style={{ left: '66.66%', top: 0, bottom: 0, width: 1 }} />
                <div className="grid-line" style={{ top: '33.33%', left: 0, right: 0, height: 1 }} />
                <div className="grid-line" style={{ top: '66.66%', left: 0, right: 0, height: 1 }} />
              </>
            )}
            <SelectionOverlay boxW={box.w} boxH={box.h} />
            {scopes && <Scopes mode={scopes} />}
          </div>
        </div>
      </div>
      <Transport />
    </section>
  );
}

function SelectionOverlay({ boxW, boxH }: { boxW: number; boxH: number }) {
  const clip = useSelectedClip();
  const project = useProject((s) => s.project)!;
  const time = usePlayback((s) => s.time);
  const playing = usePlayback((s) => s.playing);
  const [, force] = useState(0);
  if (!clip || clip.kind === 'audio' || playing) return null;
  const vc = clip as VisualClip;
  if (time < vc.start || time > vc.start + vc.duration) return null;
  const { width: pw, height: ph } = project.settings;
  const k = boxW / pw;
  const rel = time - vc.start;
  const nat = clipNaturalSize(vc, pw, ph);
  const pos = vec(vc.transform.position, rel);
  const sc = vec(vc.transform.scale, rel, { x: 1, y: 1 });
  const rot = num(vc.transform.rotation, rel);
  const w = nat.w * sc.x * k, h = nat.h * sc.y * k;
  const cx = (pw / 2 + pos.x) * k, cy = (ph / 2 + pos.y) * k;

  const commit = (label: string, patch: (c: VisualClip) => Partial<VisualClip>) =>
    useProject.getState().apply(label, (p) => updateClip(p, vc.id, (c) => ({ ...c, ...patch(c as VisualClip) }) as Clip), { merge: true });

  const startDrag = (e: React.MouseEvent, mode: 'move' | 'scale' | 'rotate', corner?: { x: number; y: number }) => {
    e.stopPropagation();
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const p0 = { ...pos }, s0 = { ...sc }, r0 = rot;
    const rect = (e.currentTarget as HTMLElement).closest('.preview-canvas-wrap')!.getBoundingClientRect();
    const center = { x: rect.left + cx, y: rect.top + cy };
    const a0 = Math.atan2(sy - center.y, sx - center.x);
    const d0 = Math.hypot(sx - center.x, sy - center.y) || 1;
    const move = (ev: MouseEvent) => {
      const dx = (ev.clientX - sx) / k, dy = (ev.clientY - sy) / k;
      if (mode === 'move') {
        let nx = p0.x + dx, ny = p0.y + dy;
        if (ev.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) ny = p0.y;
          else nx = p0.x;
        }
        // snap to center
        if (Math.abs(nx) < 6) nx = 0;
        if (Math.abs(ny) < 6) ny = 0;
        commit('Move', (c) => ({ transform: { ...c.transform, position: writeValue(c.transform.position, rel, { x: nx, y: ny }, { x: 0, y: 0 }) } }));
      } else if (mode === 'scale') {
        const d = Math.hypot(ev.clientX - center.x, ev.clientY - center.y);
        const f = Math.max(0.02, d / d0);
        const uniform = !ev.altKey;
        const ns: Vec2 = uniform ? { x: s0.x * f, y: s0.y * f } : { x: s0.x * (corner!.x ? f : 1), y: s0.y * (corner!.y ? f : 1) };
        commit('Scale', (c) => ({ transform: { ...c.transform, scale: writeValue(c.transform.scale, rel, ns, { x: 1, y: 1 }) } }));
      } else {
        const a = Math.atan2(ev.clientY - center.y, ev.clientX - center.x);
        let deg = r0 + ((a - a0) * 180) / Math.PI;
        if (ev.shiftKey) deg = Math.round(deg / 15) * 15;
        commit('Rotate', (c) => ({ transform: { ...c.transform, rotation: writeValue(c.transform.rotation, rel, deg, 0) } }));
      }
      force((n) => n + 1);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const keyed = hasKeyframes(vc.transform.position) || hasKeyframes(vc.transform.scale) || hasKeyframes(vc.transform.rotation);
  return (
    <div className="sel-box" style={{ left: cx - w / 2, top: cy - h / 2, width: w, height: h, transform: `rotate(${rot}deg)` }} onMouseDown={(e) => startDrag(e, 'move')} onDoubleClick={() => useUI.getState().setRightPanel(vc.kind === 'text' || vc.kind === 'caption' ? 'text' : 'properties')}>
      <div className="label">
        {vc.name}
        {keyed ? ' ◆' : ''}
      </div>
      {[
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 0, y: 1 },
        { x: 1, y: 1 },
      ].map((c, i) => (
        <div key={i} className="h" style={{ left: `${c.x * 100}%`, top: `${c.y * 100}%`, cursor: (c.x === c.y ? 'nwse' : 'nesw') + '-resize' }} onMouseDown={(e) => startDrag(e, 'scale', { x: 1, y: 1 })} />
      ))}
      <div className="h" style={{ left: '50%', top: 0, cursor: 'ns-resize' }} onMouseDown={(e) => startDrag(e, 'scale', { x: 0, y: 1 })} />
      <div className="h" style={{ left: '50%', top: '100%', cursor: 'ns-resize' }} onMouseDown={(e) => startDrag(e, 'scale', { x: 0, y: 1 })} />
      <div className="h" style={{ left: 0, top: '50%', cursor: 'ew-resize' }} onMouseDown={(e) => startDrag(e, 'scale', { x: 1, y: 0 })} />
      <div className="h" style={{ left: '100%', top: '50%', cursor: 'ew-resize' }} onMouseDown={(e) => startDrag(e, 'scale', { x: 1, y: 0 })} />
      <div className="h rot" onMouseDown={(e) => startDrag(e, 'rotate')} title="Rotate (Shift = 15° steps)" />
    </div>
  );
}

/** Drag a rectangle on the preview → normalized {x,y,w,h} (top-left origin). */
function RegionPicker({ label, onPick }: { label: string; onPick: (r: { x: number; y: number; w: number; h: number }) => void }) {
  const [rect, setRect] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const norm = (e: React.MouseEvent | MouseEvent, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  };
  const onDown = (e: React.MouseEvent<HTMLDivElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const el = e.currentTarget;
    const p = norm(e, el);
    const cur = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    setRect(cur);
    const move = (ev: MouseEvent) => { const q = norm(ev, el); cur.x1 = q.x; cur.y1 = q.y; setRect({ ...cur }); };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const x = Math.min(cur.x0, cur.x1), y = Math.min(cur.y0, cur.y1), w = Math.abs(cur.x1 - cur.x0), h = Math.abs(cur.y1 - cur.y0);
      setRect(null);
      if (w > 0.005 && h > 0.005) onPick({ x, y, w, h });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  const box = rect ? { left: `${Math.min(rect.x0, rect.x1) * 100}%`, top: `${Math.min(rect.y0, rect.y1) * 100}%`, width: `${Math.abs(rect.x1 - rect.x0) * 100}%`, height: `${Math.abs(rect.y1 - rect.y0) * 100}%` } : null;
  return (
    <div className="region-picker" style={{ position: 'absolute', inset: 0, cursor: 'crosshair', zIndex: 50 }} onMouseDown={onDown} title="Drag a rectangle (Esc to cancel)">
      <div className="region-hint">{label} — drag a rectangle · Esc to cancel</div>
      {box && <div className="region-box" style={box} />}
    </div>
  );
}

function Transport() {
  const time = usePlayback((s) => s.time);
  const playing = usePlayback((s) => s.playing);
  const loop = usePlayback((s) => s.loop);
  const muted = usePlayback((s) => s.muted);
  const volume = usePlayback((s) => s.volume);
  const quality = usePlayback((s) => s.previewQuality);
  const fps = useProject((s) => s.project!.settings.fps);
  const duration = useProject((s) => projectDuration(s.project!));
  const showSafe = useUI((s) => s.showSafeZones);
  const showGrid = useUI((s) => s.showGrid);
  const scopesOn = useUI((s) => !!s.scopes);
  const [stats, setStats] = useState({ frameMs: 0, fps: 0, quality: 1, clips: 0, passes: 0 });
  useEffect(() => {
    const id = setInterval(() => setStats(engine.getStats()), 500);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    engine.audio?.setVolume(muted ? 0 : volume);
  }, [muted, volume]);
  const onFullscreen = useCallback(() => {
    const el = document.querySelector('.preview-stage');
    if (document.fullscreenElement) void document.exitFullscreen();
    else void el?.requestFullscreen?.();
  }, []);
  return (
    <div className="transport">
      <div className="time">
        <b>{formatTime(time, fps)}</b> / {formatTime(duration, fps)}
      </div>
      <div className="center">
        <button className="icon-btn" onClick={act.goToStart} title="Go to start (Home)">
          <SkipBack size={16} />
        </button>
        <button className="icon-btn" onClick={() => act.stepFrames(-1)} title="Previous frame (←)">
          <StepBack size={16} />
        </button>
        <button className="play-btn" onClick={() => engine.toggle()} title="Play / Pause (Space)">
          {playing ? <Pause fill="currentColor" /> : <Play fill="currentColor" style={{ marginLeft: 2 }} />}
        </button>
        <button className="icon-btn" onClick={() => act.stepFrames(1)} title="Next frame (→)">
          <StepForward size={16} />
        </button>
        <button className="icon-btn" onClick={act.goToEnd} title="Go to end (End)">
          <SkipForward size={16} />
        </button>
        <button className={`icon-btn ${loop ? 'active' : ''}`} onClick={() => usePlayback.getState().set({ loop: !loop })} title="Loop playback">
          <Repeat size={15} />
        </button>
      </div>
      <button className={`icon-btn ${showGrid ? 'active' : ''}`} onClick={() => useUI.getState().set({ showGrid: !showGrid })} title="Rule-of-thirds grid">
        <Grid3X3 size={15} />
      </button>
      <button className={`icon-btn ${showSafe ? 'active' : ''}`} onClick={() => useUI.getState().set({ showSafeZones: !showSafe })} title="Safe zones">
        <Scan size={15} />
      </button>
      <button className={`icon-btn ${scopesOn ? 'active' : ''}`} onClick={() => useUI.getState().set({ scopes: scopesOn ? null : 'waveform' })} title="Video scopes (waveform / RGB parade / vectorscope / histogram)">
        <Activity size={15} />
      </button>
      <select value={quality} onChange={(e) => usePlayback.getState().set({ previewQuality: e.target.value as any })} title="Preview quality" style={{ height: 26, padding: '0 6px', fontSize: 11 }}>
        <option value="auto">Auto</option>
        <option value="full">Full</option>
        <option value="half">1/2</option>
        <option value="quarter">1/4</option>
      </select>
      <span className="stats" title="Render time per frame · effective preview scale · clips/passes">
        <Gauge size={11} style={{ verticalAlign: -2 }} /> {stats.frameMs.toFixed(1)}ms · {Math.round(stats.quality * 100)}% · {stats.clips}c/{stats.passes}p
      </span>
      <button className="icon-btn" onClick={() => usePlayback.getState().set({ muted: !muted })} title={muted ? 'Unmute' : 'Mute'}>
        {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
      </button>
      <input type="range" min={0} max={1} step={0.01} value={volume} onChange={(e) => usePlayback.getState().set({ volume: parseFloat(e.target.value) })} style={{ width: 70 }} title="Preview volume" />
      <button className="icon-btn" onClick={onFullscreen} title="Fullscreen (F)">
        <Maximize size={15} />
      </button>
    </div>
  );
}
