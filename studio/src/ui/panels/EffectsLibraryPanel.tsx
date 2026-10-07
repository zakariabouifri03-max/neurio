import React, { useMemo, useState } from 'react';
import { Sparkles, Plus, Palette, Upload } from 'lucide-react';
import { PanelHeader } from './LeftPanels';
import { SearchBox, Chips, FavButton, Empty, pickFiles } from '../common';
import { useFavorites, usePresets, usePresetsOfKind } from '@/services/favorites';
import { EFFECTS, EFFECT_CATEGORIES, type EffectDef, type EffectCategory } from '@/library/effects';
import { COLOR_PRESETS, COLOR_PRESET_CATEGORIES, type ColorPreset } from '@/library/colorPresets';
import { allLuts, parseCube, type LUTDef } from '@/library/luts';
import { addEffectToSelection } from '@/services/clipActions';
import { getSelectedClips, patchClips, useProject } from '@/core/store';
import { toast, useUI } from '@/core/uiStore';
import type { VisualClip } from '@/core/types';
import { playhead } from '@/services/clipActions';
import * as cmd from '@/core/commands';

/* -------------------------------- Effects -------------------------------- */
export function EffectsLibraryPanel() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<EffectCategory | 'Favorites' | null>(null);
  const fav = useFavorites();
  const selection = useProject((s) => s.selection);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return EFFECTS.filter((e) => (cat === null ? true : cat === 'Favorites' ? fav.is('effect', e.id) : e.category === cat)).filter((e) => !t || e.name.toLowerCase().includes(t) || e.category.toLowerCase().includes(t) || e.tags?.some((x) => x.includes(t)));
  }, [q, cat, fav.favs]);
  const add = (e: EffectDef) => {
    addEffectToSelection(e.id);
    useUI.getState().setRightPanel('effects');
  };
  return (
    <>
      <PanelHeader title="Effects" sub={`${EFFECTS.length} GPU effects`} />
      <div className="panel-body" style={{ paddingBottom: 0, flex: '0 0 auto' }}>
        <SearchBox value={q} onChange={setQ} placeholder="Search effects…" />
        <Chips items={['Favorites', ...EFFECT_CATEGORIES] as (EffectCategory | 'Favorites')[]} value={cat} onChange={setCat} all="All" />
        {!selection.length && <div className="muted small" style={{ margin: '6px 0' }}>Tip: select a clip first; otherwise the effect is applied to the clip under the playhead.</div>}
      </div>
      <div className="panel-body scroll" style={{ flex: 1 }}>
        {!list.length && <Empty icon={<Sparkles />}>No effects match.</Empty>}
        <div className="card-grid">
          {list.map((e) => (
            <div key={e.id} className="card" onClick={() => add(e)} title={`${e.name} — ${e.params.length} parameter${e.params.length === 1 ? '' : 's'}`} draggable onDragStart={(ev) => ev.dataTransfer.setData('application/x-neurio-effect', e.id)}>
              <div className="thumb fx-thumb" data-cat={e.category} style={{ display: 'grid', placeItems: 'center', fontSize: 26 }}>
                {e.icon}
              </div>
              <div className="name">{e.name}</div>
              <div className="meta">{e.category}</div>
              <FavButton on={fav.is('effect', e.id)} onToggle={() => fav.toggle('effect', e.id)} />
              <button className="add" onClick={(ev) => { ev.stopPropagation(); add(e); }}><Plus size={12} /></button>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* -------------------------------- Filters -------------------------------- */
function targets(): VisualClip[] {
  const sel = getSelectedClips().filter((c) => c.kind !== 'audio') as VisualClip[];
  if (sel.length) return sel;
  const p = useProject.getState().project;
  if (!p) return [];
  return cmd.clipsInRange(p, playhead(), playhead() + 1e-6).filter((c) => c.kind !== 'audio') as VisualClip[];
}

export function FiltersLibraryPanel() {
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'filters' | 'luts'>('filters');
  const [cat, setCat] = useState<ColorPreset['category'] | 'Favorites' | 'My presets' | null>(null);
  const fav = useFavorites();
  const user = usePresetsOfKind('color');
  const [, bump] = useState(0);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return COLOR_PRESETS.filter((p) => (cat === null || cat === 'My presets' ? true : cat === 'Favorites' ? fav.is('preset', p.id) : p.category === cat)).filter((p) => !t || p.name.toLowerCase().includes(t) || p.category.toLowerCase().includes(t));
  }, [q, cat, fav.favs]);
  const luts = useMemo(() => allLuts().filter((l) => l.id !== 'none' && (!q || l.name.toLowerCase().includes(q.toLowerCase()))), [q, user.length]);

  const applyPreset = (p: ColorPreset) => {
    const ts = targets();
    if (!ts.length) return toast('Select a clip to apply the filter', 'info');
    const adj = Object.fromEntries(Object.entries(p.grade.adjustments ?? {}).map(([k, v]) => [k, { value: v }]));
    patchClips(ts.map((c) => c.id), `Filter: ${p.name}`, (c) => ({ grade: { ...(c as VisualClip).grade, adjustments: adj, lutId: p.grade.lutId, lutIntensity: p.grade.lutIntensity ?? 1 } }) as any, false);
    if (!getSelectedClips().length) useProject.getState().select(ts.map((c) => c.id));
    fav.touch('preset', p.id);
    useUI.getState().setRightPanel('adjust');
  };
  const applyUser = (data: any, name: string) => {
    const ts = targets();
    if (!ts.length) return toast('Select a clip to apply the preset', 'info');
    patchClips(ts.map((c) => c.id), `Preset: ${name}`, () => ({ grade: structuredClone(data) }) as any, false);
    useUI.getState().setRightPanel('adjust');
  };
  const applyLut = (l: LUTDef) => {
    const ts = targets();
    if (!ts.length) return toast('Select a clip to apply the LUT', 'info');
    patchClips(ts.map((c) => c.id), `LUT: ${l.name}`, (c) => ({ grade: { ...(c as VisualClip).grade, lutId: l.id, lutIntensity: 1 } }) as any, false);
    fav.touch('lut', l.id);
    useUI.getState().setRightPanel('adjust');
  };
  const importCube = async () => {
    const files = await pickFiles('.cube,.CUBE');
    for (const f of files) {
      try {
        const def = parseCube(await f.text(), f.name);
        toast(`LUT "${def.name}" imported`, 'success');
      } catch (e) {
        toast(`Could not parse ${f.name}`, 'error', String((e as Error).message || e));
      }
    }
    bump((n) => n + 1);
    setTab('luts');
  };

  return (
    <>
      <PanelHeader title="Filters">
        <div className="tabs" style={{ marginLeft: 8 }}>
          <button className={tab === 'filters' ? 'active' : ''} onClick={() => setTab('filters')}>Looks</button>
          <button className={tab === 'luts' ? 'active' : ''} onClick={() => setTab('luts')}>LUTs</button>
        </div>
      </PanelHeader>
      <div className="panel-body" style={{ paddingBottom: 0, flex: '0 0 auto' }}>
        <SearchBox value={q} onChange={setQ} placeholder={tab === 'filters' ? 'Search looks…' : 'Search LUTs…'} />
        {tab === 'filters' && <Chips items={['Favorites', 'My presets', ...COLOR_PRESET_CATEGORIES] as (ColorPreset['category'] | 'Favorites' | 'My presets')[]} value={cat} onChange={setCat} all="All" />}
      </div>
      <div className="panel-body scroll" style={{ flex: 1 }}>
        {tab === 'filters' && (
          <>
            {cat === 'My presets' || cat === null ? (
              <>
                {user.length > 0 && <h4 className="muted small" style={{ margin: '0 0 6px' }}>My presets</h4>}
                <div className="card-grid">
                  {user.map((p) => (
                    <div key={p.id} className="card" onClick={() => applyUser(p.data, p.name)} onContextMenu={(e) => { e.preventDefault(); if (confirm(`Delete preset "${p.name}"?`)) usePresets.getState().remove(p.id); }} title="Right-click to delete">
                      <div className="thumb" style={{ background: 'var(--accent-grad)' }} />
                      <div className="name">{p.name}</div>
                      <div className="meta">Custom</div>
                    </div>
                  ))}
                </div>
                {cat === 'My presets' && !user.length && <Empty icon={<Palette />}>No saved presets yet. Save one from the Adjust inspector (disk icon).</Empty>}
                {user.length > 0 && cat === null && <h4 className="muted small" style={{ margin: '12px 0 6px' }}>Built-in</h4>}
              </>
            ) : null}
            {cat !== 'My presets' && (
              <div className="card-grid">
                {list.map((p) => (
                  <div key={p.id} className="card" onClick={() => applyPreset(p)} title={p.name}>
                    <div className="thumb" style={{ background: swatchFor(p) }} />
                    <div className="name">{p.name}</div>
                    <div className="meta">{p.category}</div>
                    <FavButton on={fav.is('preset', p.id)} onToggle={() => fav.toggle('preset', p.id)} />
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {tab === 'luts' && (
          <>
            <button className="btn" style={{ width: '100%', marginBottom: 10 }} onClick={importCube}>
              <Upload size={14} /> Import .cube LUT
            </button>
            <div className="card-grid">
              {luts.map((l) => (
                <div key={l.id} className="card" onClick={() => applyLut(l)} title={l.name}>
                  <div className="thumb" style={{ background: lutSwatch(l) }} />
                  <div className="name">{l.name}</div>
                  <div className="meta">{l.category}</div>
                  <FavButton on={fav.is('lut', l.id)} onToggle={() => fav.toggle('lut', l.id)} />
                </div>
              ))}
            </div>
            <div className="muted small" style={{ marginTop: 10 }}>Built-in LUTs are generated mathematically (no third-party assets). Imported .cube files stay in this session; the LUT intensity can be changed in the Adjust inspector.</div>
          </>
        )}
      </div>
    </>
  );
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
function lutSwatch(l: LUTDef) {
  if (!l.fn && !l.data) return 'var(--bg-3)';
  const sample = (r: number, g: number, b: number) => {
    if (l.fn) return l.fn(r, g, b);
    return [r, g, b];
  };
  const c = (v: number[]) => `rgb(${v.map((x) => Math.round(Math.max(0, Math.min(1, x)) * 255)).join(',')})`;
  const a = c(sample(0.85, 0.6, 0.4)), b = c(sample(0.3, 0.5, 0.7)), d = c(sample(0.2, 0.2, 0.2));
  return `linear-gradient(135deg, ${a}, ${b} 60%, ${d})`;
}
