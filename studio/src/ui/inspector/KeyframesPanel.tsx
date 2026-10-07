import React, { useMemo, useState } from 'react';
import type { Clip, Animated, Easing, Keyframe } from '@/core/types';
import { patchClip, usePlayback, seekFrameSnapped } from '@/core/store';
import { Section, Empty } from '../common';
import { EASINGS, useLocalTime } from './anim';
import { formatTime } from '@/core/util';
import { getProject } from '@/core/store';
import { ChevronLeft, ChevronRight, Trash2, Diamond, Crosshair } from 'lucide-react';
import { getEffect } from '@/library/effects';

interface AnimEntry {
  path: (string | number)[];
  label: string;
  prop: Animated<any>;
}

const LABELS: Record<string, string> = {
  'transform.position': 'Position',
  'transform.scale': 'Scale',
  'transform.rotation': 'Rotation',
  'transform.opacity': 'Opacity',
  'audio.volume': 'Volume',
  'mask.center': 'Mask center',
  'mask.size': 'Mask size',
  'mask.rotation': 'Mask rotation',
  'mask.feather': 'Mask feather',
  'mask.opacity': 'Mask opacity',
  'mask.roundness': 'Mask roundness',
  'chroma.strength': 'Chroma strength',
  'chroma.smoothness': 'Chroma smoothness',
  'chroma.spill': 'Chroma spill',
  'chroma.edgeSoftness': 'Chroma edge',
  'chroma.shadowPreservation': 'Chroma shadows',
};

function walk(obj: any, path: (string | number)[], out: AnimEntry[], clip: Clip) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj.keyframes) && 'value' in obj) {
    if (obj.keyframes.length) {
      const key = path.filter((p) => typeof p === 'string').join('.');
      let label = LABELS[key];
      if (!label && path[0] === 'grade' && path[1] === 'adjustments') label = `Adjust: ${String(path[2])}`;
      if (!label && path[0] === 'effects') {
        const fx = (clip as any).effects[path[1] as number];
        const def = getEffect(fx?.type);
        label = `${def?.name ?? fx?.type}: ${def?.params.find((p) => p.key === path[3])?.label ?? String(path[3])}`;
      }
      out.push({ path, label: label ?? key, prop: obj });
    }
    return;
  }
  if (Array.isArray(obj)) obj.forEach((v, i) => walk(v, [...path, i], out, clip));
  else for (const k of Object.keys(obj)) walk(obj[k], [...path, k], out, clip);
}

function setPath(obj: any, path: (string | number)[], value: any): any {
  if (path.length === 0) return value;
  const [h, ...rest] = path;
  if (Array.isArray(obj)) {
    const out = [...obj];
    out[h as number] = setPath(obj[h as number], rest, value);
    return out;
  }
  return { ...obj, [h]: setPath(obj?.[h], rest, value) };
}

export function KeyframesPanel({ clip }: { clip: Clip }) {
  const entries = useMemo(() => {
    const out: AnimEntry[] = [];
    walk(clip, [], out, clip);
    return out;
  }, [clip]);
  const lt = useLocalTime(clip);
  const fps = getProject().settings.fps;
  const allTimes = useMemo(() => Array.from(new Set(entries.flatMap((e) => e.prop.keyframes!.map((k: Keyframe) => k.time)))).sort((a, b) => a - b), [entries]);
  const [filter, setFilter] = useState<string | null>(null);

  const update = (e: AnimEntry, prop: Animated<any>, label = 'Edit keyframe') => patchClip(clip.id, label, (c) => setPath(c, e.path, prop), false);
  const jump = (dir: -1 | 1) => {
    const next = dir > 0 ? allTimes.find((t) => t > lt + 1e-4) : [...allTimes].reverse().find((t) => t < lt - 1e-4);
    if (next !== undefined) seekFrameSnapped(clip.start + next);
  };

  if (entries.length === 0)
    return (
      <Empty icon={<Diamond size={22} />}>
        No keyframes on this clip yet.
        <div className="muted small" style={{ marginTop: 6 }}>Move the playhead, then click the ◇ next to any property (position, scale, opacity, effect parameters, volume, mask…) to add a keyframe. Change the value at another time to animate it.</div>
      </Empty>
    );

  return (
    <>
      <div className="row" style={{ padding: '10px 10px 0' }}>
        <button className="btn sm" onClick={() => jump(-1)} title="Previous keyframe (Shift+K)"><ChevronLeft size={13} /></button>
        <span className="mono small" style={{ flex: 1, textAlign: 'center' }}>{formatTime(lt, fps)} / {allTimes.length} keys</span>
        <button className="btn sm" onClick={() => jump(1)} title="Next keyframe (K)"><ChevronRight size={13} /></button>
        <button className="btn sm danger" title="Remove all keyframes from clip" onClick={() => { if (confirm('Remove all keyframes from this clip?')) patchClip(clip.id, 'Clear keyframes', (c) => { let out: any = c; for (const e of entries) out = setPath(out, e.path, { value: e.prop.value }); return out; }, false); }}>
          <Trash2 size={13} />
        </button>
      </div>
      <div className="kf-timeline">
        {allTimes.map((t) => (
          <button key={t} className={`kf-tick ${Math.abs(t - lt) < 1e-4 ? 'current' : ''}`} style={{ left: `${(t / Math.max(1e-6, clip.duration)) * 100}%` }} onClick={() => seekFrameSnapped(clip.start + t)} title={formatTime(t, fps)} />
        ))}
        <div className="kf-cursor" style={{ left: `${(lt / Math.max(1e-6, clip.duration)) * 100}%` }} />
      </div>
      <div className="chips" style={{ padding: '6px 10px' }}>
        <button className={`chip ${!filter ? 'active' : ''}`} onClick={() => setFilter(null)}>All</button>
        {entries.map((e) => (
          <button key={e.label} className={`chip ${filter === e.label ? 'active' : ''}`} onClick={() => setFilter(filter === e.label ? null : e.label)}>{e.label}</button>
        ))}
      </div>
      {entries.filter((e) => !filter || e.label === filter).map((e) => (
        <Section key={e.label} title={`${e.label} (${e.prop.keyframes!.length})`} id={`kfs-${e.label}`}>
          <div className="kf-list">
            {e.prop.keyframes!.map((k: Keyframe<any>, i: number) => (
              <div key={k.id} className={`kf-row ${Math.abs(k.time - lt) < 1e-4 ? 'current' : ''}`}>
                <button className="icon-btn sm" title="Go to keyframe" onClick={() => seekFrameSnapped(clip.start + k.time)}><Crosshair size={12} /></button>
                <input
                  type="number"
                  className="t"
                  value={Math.round(k.time * 1000) / 1000}
                  step={1 / fps}
                  min={0}
                  max={clip.duration}
                  onChange={(ev) => {
                    const nt = Math.max(0, Math.min(clip.duration, parseFloat(ev.target.value) || 0));
                    const kfs = e.prop.keyframes!.map((x: Keyframe) => (x.id === k.id ? { ...x, time: nt } : x)).sort((a: Keyframe, b: Keyframe) => a.time - b.time);
                    update(e, { ...e.prop, keyframes: kfs }, 'Move keyframe');
                  }}
                  title="Time (s, relative to clip start)"
                />
                <span className="v mono small" title={JSON.stringify(k.value)}>{fmtValue(k.value)}</span>
                {i < e.prop.keyframes!.length - 1 ? (
                  <select value={typeof k.easing === 'string' ? k.easing : 'custom'} onChange={(ev) => update(e, { ...e.prop, keyframes: e.prop.keyframes!.map((x: Keyframe) => (x.id === k.id ? { ...x, easing: ev.target.value as Easing } : x)) }, 'Keyframe easing')} title="Easing to next keyframe">
                    {EASINGS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                    {typeof k.easing !== 'string' && <option value="custom">Custom bezier</option>}
                  </select>
                ) : (
                  <span className="muted small" style={{ flex: 1 }}>last</span>
                )}
                {i < e.prop.keyframes!.length - 1 && (
                  <button className="icon-btn sm" title="Custom cubic-bezier easing" onClick={() => { const cur = Array.isArray(k.easing) ? k.easing.join(',') : '0.42,0,0.58,1'; const s = prompt('Cubic bezier (x1,y1,x2,y2)', cur); if (!s) return; const nums = s.split(',').map((x) => parseFloat(x.trim())); if (nums.length === 4 && nums.every((n) => !isNaN(n))) update(e, { ...e.prop, keyframes: e.prop.keyframes!.map((x: Keyframe) => (x.id === k.id ? { ...x, easing: nums as Easing } : x)) }, 'Keyframe easing'); }}>
                    ∿
                  </button>
                )}
                <button className="icon-btn sm" title="Delete keyframe" onClick={() => { const kfs = e.prop.keyframes!.filter((x: Keyframe) => x.id !== k.id); update(e, kfs.length ? { ...e.prop, keyframes: kfs } : { value: k.value }, 'Delete keyframe'); }}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn sm ghost" onClick={() => update(e, { ...e.prop, keyframes: e.prop.keyframes!.map((x: Keyframe) => ({ ...x, easing: 'linear' as Easing })) }, 'Easing')}>All linear</button>
            <button className="btn sm ghost" onClick={() => update(e, { ...e.prop, keyframes: e.prop.keyframes!.map((x: Keyframe) => ({ ...x, easing: 'easeInOut' as Easing })) }, 'Easing')}>All smooth</button>
            <button className="btn sm ghost" onClick={() => update(e, { ...e.prop, keyframes: [...e.prop.keyframes!].reverse().map((x: Keyframe, i: number) => ({ ...x, time: e.prop.keyframes![i].time })) }, 'Reverse keyframes')}>Reverse</button>
          </div>
        </Section>
      ))}
      <div style={{ padding: 10 }} className="muted small">
        Playhead at {formatTime(usePlayback.getState().time, fps)}. Keyframe times are relative to the clip start.
      </div>
    </>
  );
}

function fmtValue(v: any): string {
  if (typeof v === 'number') return (Math.round(v * 100) / 100).toString();
  if (v && typeof v === 'object' && 'x' in v) return `${Math.round(v.x * 100) / 100}, ${Math.round(v.y * 100) / 100}`;
  return JSON.stringify(v);
}
