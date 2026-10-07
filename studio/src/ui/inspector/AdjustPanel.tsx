import React, { useRef, useState } from 'react';
import type { VisualClip, AdjustmentKey, ColorGrade, HSLKey, CurvePoint, Curves, ColorWheel, ColorWheels } from '@/core/types';
import { patchClip, useProject } from '@/core/store';
import { Section, Slider, Toggle, SelectRow, Chips, pickFiles } from '../common';
import { AnimSlider, Row } from './anim';
import { defaultHSL, defaultCurves, defaultWheels } from '@/core/defaults';
import { allLuts, parseCube } from '@/library/luts';
import { COLOR_PRESETS, COLOR_PRESET_CATEGORIES, type ColorPreset } from '@/library/colorPresets';
import { usePresets } from '@/services/favorites';
import { RotateCcw, Save, Trash2, Upload, Wand2 } from 'lucide-react';
import { toast } from '@/core/uiStore';
import { autoColor } from '@/ai/autoColor';
import { getSelectedClips } from '@/core/store';

const ADJ: { key: AdjustmentKey; label: string; min?: number; max?: number }[] = [
  { key: 'exposure', label: 'Exposure' },
  { key: 'brightness', label: 'Brightness' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'highlights', label: 'Highlights' },
  { key: 'shadows', label: 'Shadows' },
  { key: 'whites', label: 'Whites' },
  { key: 'blacks', label: 'Blacks' },
  { key: 'saturation', label: 'Saturation' },
  { key: 'vibrance', label: 'Vibrance' },
  { key: 'temperature', label: 'Temperature' },
  { key: 'tint', label: 'Tint' },
  { key: 'sharpness', label: 'Sharpness', min: 0 },
  { key: 'clarity', label: 'Clarity' },
  { key: 'fade', label: 'Fade', min: 0 },
  { key: 'vignette', label: 'Vignette' },
  { key: 'grain', label: 'Grain', min: 0 },
];
const HSL_KEYS: { key: HSLKey; color: string }[] = [
  { key: 'red', color: '#ef4444' },
  { key: 'orange', color: '#f97316' },
  { key: 'yellow', color: '#eab308' },
  { key: 'green', color: '#22c55e' },
  { key: 'aqua', color: '#06b6d4' },
  { key: 'blue', color: '#3b82f6' },
  { key: 'purple', color: '#8b5cf6' },
  { key: 'magenta', color: '#ec4899' },
];

export function AdjustPanel({ clip }: { clip: VisualClip }) {
  const g = clip.grade;
  const setGrade = (label: string, patch: Partial<ColorGrade>, merge = true) => patchClip(clip.id, label, { grade: { ...clip.grade, ...patch } } as any, merge);
  const applyToAll = (label: string) => {
    const ids = getSelectedClips().filter((c) => c.kind !== 'audio').map((c) => c.id);
    if (ids.length < 2) return toast('Select several clips to copy the color grade to all of them', 'info');
    useProject.getState().apply(label, (p) => {
      let np = p;
      for (const id of ids) np = { ...np, tracks: np.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (c.id === id && c.kind !== 'audio' ? { ...c, grade: structuredClone(clip.grade) } : c)) })) };
      return np;
    });
    toast(`Grade applied to ${ids.length} clips`, 'success');
  };
  const [presetCat, setPresetCat] = useState<ColorPreset['category'] | null>(null);
  const userPresets = usePresets((s) => s.presets.filter((p) => p.kind === 'color'));
  const [busy, setBusy] = useState(false);

  return (
    <>
      <Section
        title="Filters & presets"
        id="adj-presets"
        actions={
          <button
            className="icon-btn sm"
            title="Save current grade as preset"
            onClick={() => {
              const name = prompt('Preset name', 'My look');
              if (name) usePresets.getState().add('color', name, clip.grade);
            }}
          >
            <Save size={12} />
          </button>
        }
      >
        <Chips items={COLOR_PRESET_CATEGORIES} value={presetCat} onChange={setPresetCat} all="All" />
        <div className="preset-grid cols-3" style={{ marginTop: 8 }}>
          {COLOR_PRESETS.filter((p) => !presetCat || p.category === presetCat || p.id === 'none').map((p) => (
            <button
              key={p.id}
              className={`preset ${g.lutId === p.grade.lutId && (p.id !== 'none' || !hasAdjustments(g)) && (p.id === 'none' ? !g.lutId : true) && matchesPreset(g, p) ? 'active' : ''}`}
              onClick={() => applyPreset(clip, p)}
              title={p.name}
            >
              <span className="swatch" style={{ background: swatchFor(p) }} />
              <span>{p.name}</span>
            </button>
          ))}
          {userPresets.map((p) => (
            <button key={p.id} className="preset" onClick={() => setGrade('Apply preset', structuredClone(p.data), false)} title={p.name} onContextMenu={(e) => { e.preventDefault(); if (confirm(`Delete preset "${p.name}"?`)) usePresets.getState().remove(p.id); }}>
              <span className="swatch" style={{ background: 'var(--accent-grad)' }} />
              <span>{p.name}</span>
            </button>
          ))}
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button
            className="btn sm"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const res = await autoColor(clip);
                if (res) {
                  setGrade('Auto color', { adjustments: { ...g.adjustments, ...Object.fromEntries(Object.entries(res.adjustments).map(([k, v]) => [k, { value: v }])) }, whiteBalance: res.whiteBalance }, false);
                  toast('Auto color applied', 'success', res.note);
                } else toast('Auto color unavailable for this clip', 'error');
              } finally {
                setBusy(false);
              }
            }}
            title="Analyze the current frame and balance exposure, contrast and white balance"
          >
            <Wand2 size={13} /> Auto color
          </button>
          <button className="btn sm ghost" onClick={() => applyToAll('Apply grade to selection')} title="Copy this grade to all selected clips">
            Apply to selected
          </button>
          <button className="btn sm ghost" onClick={() => setGrade('Reset grade', { adjustments: {}, hsl: undefined, curves: undefined, wheels: undefined, lutId: undefined, lutIntensity: 1, whiteBalance: undefined }, false)} title="Reset all color">
            <RotateCcw size={12} />
          </button>
        </div>
      </Section>

      <Section title="Adjust" id="adj-basic">
        {ADJ.map((a) => (
          <AnimSlider
            key={a.key}
            clip={clip}
            label={a.label}
            prop={g.adjustments[a.key]}
            min={a.min ?? -100}
            max={a.max ?? 100}
            step={1}
            defaultValue={0}
            format={(v) => `${Math.round(v)}`}
            set={(an) => ({ grade: { ...clip.grade, adjustments: { ...clip.grade.adjustments, [a.key]: an } } })}
            historyLabel="Adjust"
          />
        ))}
      </Section>

      <Section title="White balance" id="adj-wb" defaultOpen={false}>
        <Slider label="Temperature" value={g.whiteBalance?.temperature ?? 0} min={-100} max={100} step={1} defaultValue={0} onChange={(v) => setGrade('White balance', { whiteBalance: { temperature: v, tint: g.whiteBalance?.tint ?? 0 } })} />
        <Slider label="Tint" value={g.whiteBalance?.tint ?? 0} min={-100} max={100} step={1} defaultValue={0} onChange={(v) => setGrade('White balance', { whiteBalance: { temperature: g.whiteBalance?.temperature ?? 0, tint: v } })} />
        <div className="chips">
          {[
            ['Daylight', 0, 0],
            ['Cloudy', 12, 2],
            ['Shade', 20, 4],
            ['Tungsten', -30, -4],
            ['Fluorescent', -12, 18],
            ['Flash', 6, 0],
          ].map(([n, t, ti]) => (
            <button key={n as string} className="chip" onClick={() => setGrade('White balance', { whiteBalance: { temperature: t as number, tint: ti as number } }, false)}>
              {n}
            </button>
          ))}
        </div>
      </Section>

      <Section title="LUT" id="adj-lut" defaultOpen={!!g.lutId}>
        <SelectRow label="LUT" value={g.lutId ?? 'none'} options={allLuts().map((l) => ({ value: l.id, label: l.id === 'none' ? 'None' : `${l.name} (${l.category})` }))} onChange={(v) => setGrade('LUT', { lutId: v === 'none' ? undefined : v }, false)} />
        {g.lutId && <Slider label="Intensity" value={g.lutIntensity ?? 1} min={0} max={1} step={0.01} defaultValue={1} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => setGrade('LUT intensity', { lutIntensity: v })} />}
        <div className="row">
          <button
            className="btn sm"
            onClick={async () => {
              const files = await pickFiles('.cube', true);
              for (const f of files) {
                try {
                  const def = parseCube(await f.text(), f.name);
                  setGrade('Import LUT', { lutId: def.id, lutIntensity: 1 }, false);
                  toast(`LUT "${def.name}" imported`, 'success', 'Custom LUTs are kept for this session.');
                } catch (e: any) {
                  toast('Could not parse .cube file', 'error', e?.message);
                }
              }
            }}
          >
            <Upload size={13} /> Import .cube
          </button>
        </div>
      </Section>

      <Section title="HSL" id="adj-hsl" defaultOpen={false} actions={g.hsl && <button className="icon-btn sm" onClick={() => setGrade('Reset HSL', { hsl: undefined }, false)} title="Reset HSL"><RotateCcw size={12} /></button>}>
        <HSLEditor g={g} onChange={(hsl) => setGrade('HSL', { hsl })} />
      </Section>

      <Section title="Curves" id="adj-curves" defaultOpen={false} actions={g.curves && <button className="icon-btn sm" onClick={() => setGrade('Reset curves', { curves: undefined }, false)} title="Reset curves"><RotateCcw size={12} /></button>}>
        <CurvesEditor curves={g.curves ?? defaultCurves()} onChange={(c, merge) => setGrade('Curves', { curves: c }, merge)} />
      </Section>

      <Section title="Color wheels" id="adj-wheels" defaultOpen={false} actions={g.wheels && <button className="icon-btn sm" onClick={() => setGrade('Reset wheels', { wheels: undefined }, false)} title="Reset wheels"><RotateCcw size={12} /></button>}>
        <WheelsEditor wheels={g.wheels ?? defaultWheels()} onChange={(w) => setGrade('Color wheels', { wheels: w })} />
      </Section>
    </>
  );
}

function hasAdjustments(g: ColorGrade) {
  return Object.values(g.adjustments).some((a) => a && (a.value !== 0 || a.keyframes?.length));
}
function matchesPreset(g: ColorGrade, p: ColorPreset) {
  const adj = p.grade.adjustments ?? {};
  for (const k of Object.keys(adj) as AdjustmentKey[]) if ((g.adjustments[k]?.value ?? 0) !== adj[k]) return false;
  for (const k of Object.keys(g.adjustments) as AdjustmentKey[]) if ((g.adjustments[k]?.value ?? 0) !== 0 && adj[k] === undefined) return false;
  return (g.lutId ?? undefined) === (p.grade.lutId ?? undefined);
}
function swatchFor(p: ColorPreset) {
  const a = p.grade.adjustments ?? {};
  const warm = (a.temperature ?? 0) / 100;
  const sat = 60 + (a.saturation ?? 0) / 2 + (a.vibrance ?? 0) / 3;
  const light = 50 + (a.brightness ?? 0) / 4 + (a.exposure ?? 0) / 4;
  const hue = p.grade.lutId === 'noir' || p.category === 'B&W' ? 0 : 200 - warm * 120;
  const s = p.category === 'B&W' ? 0 : Math.max(0, Math.min(100, sat));
  return `linear-gradient(135deg, hsl(${hue + 30} ${s}% ${light + 15}%), hsl(${hue} ${s}% ${light - 15}%))`;
}
export function applyPreset(clip: VisualClip, p: ColorPreset) {
  const adj = Object.fromEntries(Object.entries(p.grade.adjustments ?? {}).map(([k, v]) => [k, { value: v }]));
  patchClip(clip.id, 'Apply filter', { grade: { ...clip.grade, adjustments: adj, lutId: p.grade.lutId, lutIntensity: p.grade.lutIntensity ?? 1 } } as any, false);
}

function HSLEditor({ g, onChange }: { g: ColorGrade; onChange: (h: NonNullable<ColorGrade['hsl']>) => void }) {
  const [band, setBand] = useState<HSLKey>('red');
  const hsl = g.hsl ?? defaultHSL();
  const b = hsl[band];
  const set = (patch: Partial<typeof b>) => onChange({ ...hsl, [band]: { ...b, ...patch } });
  return (
    <>
      <div className="hsl-bands">
        {HSL_KEYS.map((k) => (
          <button key={k.key} className={`band ${band === k.key ? 'active' : ''}`} style={{ background: k.color }} onClick={() => setBand(k.key)} title={k.key} />
        ))}
      </div>
      <Slider label="Hue" value={b.hue} min={-100} max={100} step={1} defaultValue={0} onChange={(v) => set({ hue: v })} />
      <Slider label="Saturation" value={b.saturation} min={-100} max={100} step={1} defaultValue={0} onChange={(v) => set({ saturation: v })} />
      <Slider label="Luminance" value={b.luminance} min={-100} max={100} step={1} defaultValue={0} onChange={(v) => set({ luminance: v })} />
    </>
  );
}

function CurvesEditor({ curves, onChange }: { curves: Curves; onChange: (c: Curves, merge?: boolean) => void }) {
  const [ch, setCh] = useState<keyof Curves>('master');
  const ref = useRef<SVGSVGElement>(null);
  const S = 200;
  const pts = curves[ch];
  const color = { master: '#fff', red: '#ef4444', green: '#22c55e', blue: '#3b82f6' }[ch];
  const update = (np: CurvePoint[], merge = true) => onChange({ ...curves, [ch]: np.sort((a, b) => a.x - b.x) }, merge);
  // monotone-ish path via sampled polyline using the same sampler as the renderer
  const path = (() => {
    const out: string[] = [];
    const sorted = [...pts].sort((a, b) => a.x - b.x);
    for (let i = 0; i <= 64; i++) {
      const x = i / 64;
      out.push(`${i ? 'L' : 'M'}${x * S},${(1 - evalCurve(sorted, x)) * S}`);
    }
    return out.join(' ');
  })();
  const onDown = (i: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = ref.current!.getBoundingClientRect();
    const move = (ev: MouseEvent) => {
      const x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const y = Math.max(0, Math.min(1, 1 - (ev.clientY - rect.top) / rect.height));
      const np = pts.map((p, j) => (j === i ? { x: i === 0 ? 0 : i === pts.length - 1 ? 1 : x, y } : p));
      update(np);
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  return (
    <div className="curve-editor">
      <div className="seg" style={{ marginBottom: 6 }}>
        {(['master', 'red', 'green', 'blue'] as const).map((c) => (
          <button key={c} className={ch === c ? 'active' : ''} onClick={() => setCh(c)} style={{ color: ch === c ? undefined : { master: undefined, red: '#ef4444', green: '#22c55e', blue: '#3b82f6' }[c] }}>
            {c === 'master' ? 'RGB' : c[0].toUpperCase()}
          </button>
        ))}
      </div>
      <svg
        ref={ref}
        viewBox={`0 0 ${S} ${S}`}
        width="100%"
        style={{ background: 'var(--bg-1)', border: '1px solid var(--line)', borderRadius: 6, aspectRatio: '1' }}
        onDoubleClick={(e) => {
          const rect = ref.current!.getBoundingClientRect();
          const x = (e.clientX - rect.left) / rect.width;
          const y = 1 - (e.clientY - rect.top) / rect.height;
          update([...pts, { x, y }], false);
        }}
      >
        {[0.25, 0.5, 0.75].map((v) => (
          <g key={v}>
            <line x1={v * S} x2={v * S} y1={0} y2={S} stroke="var(--line)" />
            <line y1={v * S} y2={v * S} x1={0} x2={S} stroke="var(--line)" />
          </g>
        ))}
        <line x1={0} y1={S} x2={S} y2={0} stroke="var(--line-2)" strokeDasharray="3 3" />
        <path d={path} fill="none" stroke={color} strokeWidth={2} />
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={p.x * S}
            cy={(1 - p.y) * S}
            r={5}
            fill={color}
            stroke="#000"
            style={{ cursor: 'grab' }}
            onMouseDown={onDown(i)}
            onContextMenu={(e) => {
              e.preventDefault();
              if (i > 0 && i < pts.length - 1) update(pts.filter((_, j) => j !== i), false);
            }}
          />
        ))}
      </svg>
      <div className="muted small">Drag points · double-click adds · right-click removes</div>
      <div className="chips" style={{ marginTop: 6 }}>
        <button className="chip" onClick={() => update([{ x: 0, y: 0 }, { x: 0.25, y: 0.2 }, { x: 0.75, y: 0.8 }, { x: 1, y: 1 }], false)}>S-curve</button>
        <button className="chip" onClick={() => update([{ x: 0, y: 0.08 }, { x: 0.5, y: 0.5 }, { x: 1, y: 0.95 }], false)}>Matte</button>
        <button className="chip" onClick={() => update([{ x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }], false)}>Brighten</button>
        <button className="chip" onClick={() => update([{ x: 0, y: 0 }, { x: 1, y: 1 }], false)}>Reset</button>
      </div>
    </div>
  );
}

function evalCurve(pts: CurvePoint[], x: number): number {
  if (pts.length === 0) return x;
  if (x <= pts[0].x) return pts[0].y;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if (x <= b.x) {
      const t = (x - a.x) / Math.max(1e-6, b.x - a.x);
      const s = t * t * (3 - 2 * t);
      return a.y + (b.y - a.y) * s;
    }
  }
  return pts[pts.length - 1].y;
}

function WheelsEditor({ wheels, onChange }: { wheels: ColorWheels; onChange: (w: ColorWheels) => void }) {
  return (
    <div className="wheels">
      {(['shadows', 'midtones', 'highlights'] as const).map((k) => (
        <Wheel key={k} label={k[0].toUpperCase() + k.slice(1)} value={wheels[k]} onChange={(w) => onChange({ ...wheels, [k]: w })} />
      ))}
    </div>
  );
}

function Wheel({ label, value, onChange }: { label: string; value: ColorWheel; onChange: (w: ColorWheel) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // map (r,g,b) offset to a 2D point: use hue angle & magnitude
  const toXY = (w: ColorWheel) => {
    // project rgb offsets onto 2D color plane
    const x = w.r * 0.5 - w.g * 0.25 - w.b * 0.25;
    const y = (w.g - w.b) * 0.433;
    return { x, y };
  };
  const fromXY = (x: number, y: number): Pick<ColorWheel, 'r' | 'g' | 'b'> => {
    const r = x;
    const g = -x * 0.5 + y * 0.866;
    const b = -x * 0.5 - y * 0.866;
    return { r, g, b };
  };
  const { x, y } = toXY(value);
  const onDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const rect = ref.current!.getBoundingClientRect();
    const move = (ev: MouseEvent) => {
      let nx = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
      let ny = -(((ev.clientY - rect.top) / rect.height) * 2 - 1);
      const m = Math.hypot(nx, ny);
      if (m > 1) {
        nx /= m;
        ny /= m;
      }
      onChange({ ...value, ...fromXY(nx * 0.5, ny * 0.5) });
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    move(e.nativeEvent);
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  return (
    <div className="wheel">
      <div className="lbl">{label}</div>
      <div ref={ref} className="disc" onMouseDown={onDown} onDoubleClick={() => onChange({ r: 0, g: 0, b: 0, lum: value.lum })} title="Drag to tint · double-click to reset">
        <div className="dot" style={{ left: `${50 + x * 100}%`, top: `${50 - y * 100}%` }} />
      </div>
      <input type="range" min={-1} max={1} step={0.01} value={value.lum} onChange={(e) => onChange({ ...value, lum: parseFloat(e.target.value) })} title="Luminance" />
    </div>
  );
}

export { Toggle, Row };
