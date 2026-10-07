import React, { useRef } from 'react';
import type { VisualClip, Mask, MaskShape, Vec2 } from '@/core/types';
import { patchClip, useProject } from '@/core/store';
import { Section, Toggle, Empty } from '../common';
import { AnimSlider, AnimVec2 } from './anim';
import { defaultMask } from '@/core/defaults';
import { Square, Circle, Minus, PenTool, Star, Heart, Triangle, Hexagon, Trash2 } from 'lucide-react';

const SHAPES: { id: MaskShape; label: string; icon: React.ReactNode }[] = [
  { id: 'rectangle', label: 'Rectangle', icon: <Square size={16} /> },
  { id: 'circle', label: 'Circle', icon: <Circle size={16} /> },
  { id: 'linear', label: 'Linear', icon: <Minus size={16} /> },
  { id: 'star', label: 'Star', icon: <Star size={16} /> },
  { id: 'heart', label: 'Heart', icon: <Heart size={16} /> },
  { id: 'triangle', label: 'Triangle', icon: <Triangle size={16} /> },
  { id: 'hexagon', label: 'Hexagon', icon: <Hexagon size={16} /> },
  { id: 'freehand', label: 'Custom', icon: <PenTool size={16} /> },
];

export function MaskPanel({ clip }: { clip: VisualClip }) {
  const m = clip.mask;
  const set = (label: string, patch: Partial<Mask>, merge = true) => patchClip(clip.id, label, { mask: { ...(clip.mask ?? defaultMask()), ...patch } } as any, merge);
  return (
    <>
      <Section title="Mask shape" id="mask-shape">
        <div className="preset-grid cols-4">
          {SHAPES.map((s) => (
            <button key={s.id} className={`preset ${m?.shape === s.id ? 'active' : ''}`} title={s.label} onClick={() => (m ? set('Mask shape', { shape: s.id, enabled: true }, false) : patchClip(clip.id, 'Add mask', { mask: defaultMask(s.id) } as any, false))}>
              <span className="ico">{s.icon}</span>
              <span>{s.label}</span>
            </button>
          ))}
        </div>
        {m && (
          <div className="row" style={{ marginTop: 6 }}>
            <Toggle label="Enabled" value={m.enabled} onChange={(v) => set('Toggle mask', { enabled: v }, false)} />
            <button className="btn sm ghost" onClick={() => patchClip(clip.id, 'Remove mask', { mask: null } as any, false)}>
              <Trash2 size={13} /> Remove
            </button>
          </div>
        )}
      </Section>
      {!m && <Empty>Choose a shape to add a mask. Masks can be feathered, inverted and keyframed.</Empty>}
      {m && (
        <>
          <Section title="Mask settings" id="mask-settings">
            <AnimVec2 clip={clip} labels={['Center X', 'Center Y']} prop={m.center} min={-0.75} max={0.75} step={0.005} defaultValue={{ x: 0, y: 0 }} format={(v) => `${Math.round(v * 100)}%`} set={(a) => ({ mask: { ...m, center: a } })} historyLabel="Mask center" />
            {m.shape !== 'linear' && m.shape !== 'freehand' && <AnimVec2 clip={clip} labels={['Width', 'Height']} prop={m.size} fallback={{ x: 0.6, y: 0.6 }} min={0.01} max={2} step={0.005} defaultValue={{ x: 0.6, y: 0.6 }} format={(v) => `${Math.round(v * 100)}%`} set={(a) => ({ mask: { ...m, size: a } })} historyLabel="Mask size" />}
            {m.shape === 'freehand' && <AnimVec2 clip={clip} labels={['Scale X', 'Scale Y']} prop={m.size} fallback={{ x: 1, y: 1 }} min={0.05} max={3} step={0.01} defaultValue={{ x: 1, y: 1 }} format={(v) => `${Math.round(v * 100)}%`} set={(a) => ({ mask: { ...m, size: a } })} historyLabel="Mask size" />}
            <AnimSlider clip={clip} label="Rotation" prop={m.rotation} min={-180} max={180} step={0.5} unit="°" defaultValue={0} set={(a) => ({ mask: { ...m, rotation: a } })} historyLabel="Mask rotation" />
            <AnimSlider clip={clip} label="Feather" prop={m.feather} fallback={0.05} min={0} max={0.5} step={0.005} defaultValue={0.05} format={(v) => `${Math.round(v * 200)}%`} set={(a) => ({ mask: { ...m, feather: a } })} historyLabel="Mask feather" />
            <AnimSlider clip={clip} label="Opacity" prop={m.opacity} fallback={1} min={0} max={1} step={0.01} defaultValue={1} format={(v) => `${Math.round(v * 100)}%`} set={(a) => ({ mask: { ...m, opacity: a } })} historyLabel="Mask opacity" />
            {m.shape === 'rectangle' && <AnimSlider clip={clip} label="Roundness" prop={m.roundness} min={0} max={1} step={0.01} defaultValue={0} format={(v) => `${Math.round(v * 100)}%`} set={(a) => ({ mask: { ...m, roundness: a } })} historyLabel="Mask roundness" />}
            <Toggle label="Invert" value={m.invert} onChange={(v) => set('Invert mask', { invert: v }, false)} />
          </Section>
          {m.shape === 'freehand' && (
            <Section title="Draw custom shape" id="mask-draw">
              <PolygonEditor points={m.points ?? []} onChange={(pts, merge) => set('Mask points', { points: pts }, merge)} />
            </Section>
          )}
        </>
      )}
    </>
  );
}

function PolygonEditor({ points, onChange }: { points: Vec2[]; onChange: (p: Vec2[], merge?: boolean) => void }) {
  const project = useProject((s) => s.project)!;
  const ref = useRef<SVGSVGElement>(null);
  const W = 240, H = (W * project.settings.height) / project.settings.width;
  const toPx = (p: Vec2) => ({ x: (p.x + 0.5) * W, y: (p.y + 0.5) * H });
  const fromEvent = (ev: MouseEvent | React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: Math.max(-0.5, Math.min(0.5, (ev.clientX - r.left) / r.width - 0.5)), y: Math.max(-0.5, Math.min(0.5, (ev.clientY - r.top) / r.height - 0.5)) };
  };
  const drag = (i: number) => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const move = (ev: MouseEvent) => onChange(points.map((p, j) => (j === i ? fromEvent(ev) : p)));
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  return (
    <div>
      <svg ref={ref} width="100%" viewBox={`0 0 ${W} ${H}`} style={{ background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 6, cursor: 'crosshair' }} onMouseDown={(e) => { if (e.target === ref.current) onChange([...points, fromEvent(e)], false); }}>
        <line x1={W / 2} y1={0} x2={W / 2} y2={H} stroke="var(--line)" />
        <line x1={0} y1={H / 2} x2={W} y2={H / 2} stroke="var(--line)" />
        {points.length > 1 && <polygon points={points.map((p) => { const q = toPx(p); return `${q.x},${q.y}`; }).join(' ')} fill="rgba(139,92,246,0.25)" stroke="var(--accent)" strokeWidth={1.5} />}
        {points.map((p, i) => {
          const q = toPx(p);
          return <circle key={i} cx={q.x} cy={q.y} r={5} fill="#fff" stroke="var(--accent)" strokeWidth={2} style={{ cursor: 'grab' }} onMouseDown={drag(i)} onContextMenu={(e) => { e.preventDefault(); onChange(points.filter((_, j) => j !== i), false); }} />;
        })}
      </svg>
      <div className="muted small" style={{ marginTop: 4 }}>Click to add points (up to 64) · drag to move · right-click to delete. {points.length} points.</div>
      <div className="row" style={{ marginTop: 6 }}>
        <button className="btn sm ghost" onClick={() => onChange([], false)}>Clear</button>
        <button className="btn sm ghost" onClick={() => onChange([{ x: -0.3, y: -0.3 }, { x: 0.3, y: -0.3 }, { x: 0.3, y: 0.3 }, { x: -0.3, y: 0.3 }], false)}>Square</button>
        <button className="btn sm ghost" onClick={() => { const n = 24; onChange(Array.from({ length: n }, (_, i) => ({ x: Math.cos((i / n) * Math.PI * 2) * 0.3, y: Math.sin((i / n) * Math.PI * 2) * 0.3 })), false); }}>Circle</button>
      </div>
    </div>
  );
}
