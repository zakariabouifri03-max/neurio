import React, { useEffect, useState } from 'react';
import type { TextClip, CaptionClip, TextStyle } from '@/core/types';
import { patchClip, getSelectedClips, useProject } from '@/core/store';
import { toast } from '@/core/uiStore';
import { Section, Slider, Toggle, SelectRow, ColorRow, Chips, SearchBox, pickFiles } from '../common';
import { allFonts, ensureFont, FONT_CATEGORIES, onFontsChanged, registerUserFont, type FontDef } from '@/library/fonts';
import { TEXT_PRESETS, TEXT_PRESET_CATEGORIES, type TextPreset } from '@/library/textPresets';
import { usePresets, usePresetsOfKind } from '@/services/favorites';
import { importFile } from '@/engine/MediaManager';
import { AlignLeft, AlignCenter, AlignRight, Bold, Italic, Underline, CaseUpper, Upload, Save, Copy } from 'lucide-react';
import { defaultTextStyle } from '@/core/defaults';
import { TextAnimationSection } from './AnimationPanel';
import { engine } from '@/engine/PlaybackEngine';

export function TextPanel({ clip }: { clip: TextClip | CaptionClip }) {
  const s = clip.style;
  const set = (label: string, patch: Partial<TextStyle>, merge = true) => patchClip(clip.id, label, { style: { ...clip.style, ...patch } } as any, merge);
  const [presetCat, setPresetCat] = useState<TextPreset['category'] | null>(null);
  const userPresets = usePresetsOfKind('text');

  const applyPreset = (p: TextPreset) => {
    const style = { ...defaultTextStyle(), ...p.style, fontSize: p.style.fontSize ?? s.fontSize };
    void ensureFont(style.fontFamily).then(() => engine.invalidate());
    patchClip(clip.id, `Text preset ${p.name}`, { style, ...(p.animation && clip.kind === 'text' ? { animation: { ...clip.animation, ...p.animation } } : {}) } as any, false);
  };
  const applyStyleToSelection = () => {
    const ids = getSelectedClips().filter((c) => (c.kind === 'text' || c.kind === 'caption') && c.id !== clip.id).map((c) => c.id);
    if (!ids.length) return toast('Select other text clips to copy this style to them', 'info');
    useProject.getState().apply('Copy text style', (p) => ({ ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.map((c) => (ids.includes(c.id) ? ({ ...c, style: structuredClone(clip.style) } as any) : c)) })) }));
    toast(`Style copied to ${ids.length} clip(s)`, 'success');
  };

  return (
    <>
      {clip.kind === 'text' && (
        <Section title="Text" id="text-content">
          <textarea className="text-input" value={clip.text} rows={3} onChange={(e) => patchClip(clip.id, 'Edit text', { text: e.target.value, name: e.target.value.split('\n')[0].slice(0, 40) || 'Text' } as any)} placeholder="Type your text…" />
        </Section>
      )}
      <Section
        title="Presets"
        id="text-presets"
        defaultOpen={clip.kind === 'text'}
        actions={
          <>
            <button className="icon-btn sm" title="Copy style to selected text clips" onClick={applyStyleToSelection}><Copy size={12} /></button>
            <button className="icon-btn sm" title="Save style as preset" onClick={() => { const n = prompt('Preset name', 'My text style'); if (n) usePresets.getState().add('text', n, { style: clip.style, animation: (clip as TextClip).animation }); }}><Save size={12} /></button>
          </>
        }
      >
        <Chips items={TEXT_PRESET_CATEGORIES} value={presetCat} onChange={setPresetCat} all="All" />
        <div className="text-presets">
          {TEXT_PRESETS.filter((p) => !presetCat || p.category === presetCat).map((p) => (
            <button key={p.id} className="text-preset" onClick={() => applyPreset(p)} title={p.name}>
              <PresetSample p={p} />
              <span>{p.name}</span>
            </button>
          ))}
          {userPresets.map((p) => (
            <button key={p.id} className="text-preset" onClick={() => patchClip(clip.id, 'Apply text preset', { style: structuredClone(p.data.style), ...(clip.kind === 'text' && p.data.animation ? { animation: structuredClone(p.data.animation) } : {}) } as any, false)} onContextMenu={(e) => { e.preventDefault(); if (confirm(`Delete preset "${p.name}"?`)) usePresets.getState().remove(p.id); }} title={`${p.name} (right-click to delete)`}>
              <span className="sample" style={{ fontFamily: p.data.style.fontFamily, color: p.data.style.color, fontWeight: p.data.style.fontWeight }}>Aa</span>
              <span>{p.name}</span>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Font" id="text-font">
        <FontPicker value={s.fontFamily} onChange={(f) => { set('Font', { fontFamily: f }, false); void ensureFont(f).then((ok) => { engine.invalidate(); if (!ok) toast(`Font "${f}" could not be loaded`, 'error', 'Check your network connection — Google Fonts are fetched on demand.'); }); }} />
        <Slider label="Size" value={s.fontSize} min={8} max={400} step={1} unit="px" defaultValue={72} onChange={(v) => set('Font size', { fontSize: v })} />
        <div className="row">
          <label>Style</label>
          <SelectRow label="" value={String(s.fontWeight)} options={[300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: String(w), label: ({ 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semibold', 700: 'Bold', 800: 'Extra bold', 900: 'Black' } as any)[w] }))} onChange={(v) => set('Font weight', { fontWeight: parseInt(v) }, false)} />
        </div>
        <div className="row">
          <label>Format</label>
          <button className={`icon-btn ${s.fontWeight >= 700 ? 'active' : ''}`} title="Bold" onClick={() => set('Bold', { fontWeight: s.fontWeight >= 700 ? 400 : 700 }, false)}><Bold size={14} /></button>
          <button className={`icon-btn ${s.italic ? 'active' : ''}`} title="Italic" onClick={() => set('Italic', { italic: !s.italic }, false)}><Italic size={14} /></button>
          <button className={`icon-btn ${s.underline ? 'active' : ''}`} title="Underline" onClick={() => set('Underline', { underline: !s.underline }, false)}><Underline size={14} /></button>
          <button className={`icon-btn ${s.uppercase ? 'active' : ''}`} title="Uppercase" onClick={() => set('Uppercase', { uppercase: !s.uppercase }, false)}><CaseUpper size={14} /></button>
          <span style={{ width: 8 }} />
          <button className={`icon-btn ${s.align === 'left' ? 'active' : ''}`} title="Align left" onClick={() => set('Align', { align: 'left' }, false)}><AlignLeft size={14} /></button>
          <button className={`icon-btn ${s.align === 'center' ? 'active' : ''}`} title="Align center" onClick={() => set('Align', { align: 'center' }, false)}><AlignCenter size={14} /></button>
          <button className={`icon-btn ${s.align === 'right' ? 'active' : ''}`} title="Align right" onClick={() => set('Align', { align: 'right' }, false)}><AlignRight size={14} /></button>
        </div>
        <Slider label="Letter spacing" value={s.letterSpacing} min={-20} max={80} step={0.5} unit="px" defaultValue={0} onChange={(v) => set('Letter spacing', { letterSpacing: v })} />
        <Slider label="Line height" value={s.lineHeight} min={0.6} max={3} step={0.05} defaultValue={1.2} onChange={(v) => set('Line height', { lineHeight: v })} />
        <Slider label="Max width" value={s.maxWidth} min={0.1} max={1} step={0.01} defaultValue={0.85} format={(v) => `${Math.round(v * 100)}%`} onChange={(v) => set('Max width', { maxWidth: v })} />
      </Section>
      <Section title="Fill" id="text-fill">
        <ColorRow label="Color" value={s.color} onChange={(v) => set('Text color', { color: v || '#ffffff' })} />
        <Toggle label="Gradient" value={!!s.gradient} onChange={(v) => set('Gradient', { gradient: v ? { from: s.color, to: '#22d3ee', angle: 90 } : null }, false)} />
        {s.gradient && (
          <>
            <ColorRow label="From" value={s.gradient.from} onChange={(v) => set('Gradient', { gradient: { ...s.gradient!, from: v || '#fff' } })} />
            <ColorRow label="To" value={s.gradient.to} onChange={(v) => set('Gradient', { gradient: { ...s.gradient!, to: v || '#fff' } })} />
            <Slider label="Angle" value={s.gradient.angle} min={0} max={360} step={1} unit="°" onChange={(v) => set('Gradient', { gradient: { ...s.gradient!, angle: v } })} />
          </>
        )}
      </Section>
      <Section title="Outline" id="text-outline" defaultOpen={!!s.outline}>
        <Toggle label="Outline" value={!!s.outline} onChange={(v) => set('Outline', { outline: v ? { color: '#000000', width: 4 } : null }, false)} />
        {s.outline && (
          <>
            <ColorRow label="Color" value={s.outline.color} onChange={(v) => set('Outline', { outline: { ...s.outline!, color: v || '#000' } })} />
            <Slider label="Width" value={s.outline.width} min={0.5} max={40} step={0.5} unit="px" onChange={(v) => set('Outline', { outline: { ...s.outline!, width: v } })} />
          </>
        )}
      </Section>
      <Section title="Shadow" id="text-shadow" defaultOpen={false}>
        <Toggle label="Shadow" value={!!s.shadow} onChange={(v) => set('Shadow', { shadow: v ? { color: 'rgba(0,0,0,0.6)', blur: 12, x: 0, y: 4 } : null }, false)} />
        {s.shadow && (
          <>
            <ColorRow label="Color" value={toHex(s.shadow.color)} onChange={(v) => set('Shadow', { shadow: { ...s.shadow!, color: v || '#000' } })} />
            <Slider label="Blur" value={s.shadow.blur} min={0} max={80} step={1} unit="px" onChange={(v) => set('Shadow', { shadow: { ...s.shadow!, blur: v } })} />
            <Slider label="Offset X" value={s.shadow.x} min={-60} max={60} step={1} unit="px" onChange={(v) => set('Shadow', { shadow: { ...s.shadow!, x: v } })} />
            <Slider label="Offset Y" value={s.shadow.y} min={-60} max={60} step={1} unit="px" onChange={(v) => set('Shadow', { shadow: { ...s.shadow!, y: v } })} />
          </>
        )}
      </Section>
      <Section title="Glow" id="text-glow" defaultOpen={!!s.glow}>
        <Toggle label="Glow" value={!!s.glow} onChange={(v) => set('Glow', { glow: v ? { color: s.color, blur: 30 } : null }, false)} />
        {s.glow && (
          <>
            <ColorRow label="Color" value={s.glow.color} onChange={(v) => set('Glow', { glow: { ...s.glow!, color: v || '#fff' } })} />
            <Slider label="Blur" value={s.glow.blur} min={1} max={100} step={1} unit="px" onChange={(v) => set('Glow', { glow: { ...s.glow!, blur: v } })} />
          </>
        )}
      </Section>
      <Section title="Background" id="text-bg" defaultOpen={!!s.background}>
        <Toggle label="Background box" value={!!s.background} onChange={(v) => set('Background', { background: v ? { color: '#000000', padding: 16, radius: 10 } : null }, false)} />
        {s.background && (
          <>
            <ColorRow label="Color" value={toHex(s.background.color)} onChange={(v) => set('Background', { background: { ...s.background!, color: v || '#000' } })} />
            <Slider label="Padding" value={s.background.padding} min={0} max={120} step={1} unit="px" onChange={(v) => set('Background', { background: { ...s.background!, padding: v } })} />
            <Slider label="Radius" value={s.background.radius} min={0} max={100} step={1} unit="px" onChange={(v) => set('Background', { background: { ...s.background!, radius: v } })} />
          </>
        )}
      </Section>
      {clip.kind === 'text' && <TextAnimationSection clip={clip} />}
    </>
  );
}

function toHex(c: string) {
  if (/^#/.test(c)) return c;
  const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return '#000000';
  return '#' + [m[1], m[2], m[3]].map((x) => parseInt(x).toString(16).padStart(2, '0')).join('');
}

function PresetSample({ p }: { p: TextPreset }) {
  useEffect(() => {
    if (p.style.fontFamily) void ensureFont(p.style.fontFamily);
  }, [p.style.fontFamily]);
  const st = p.style;
  const css: React.CSSProperties = {
    fontFamily: st.fontFamily,
    fontWeight: st.fontWeight ?? 700,
    fontStyle: st.italic ? 'italic' : undefined,
    color: st.color,
    textTransform: st.uppercase ? 'uppercase' : undefined,
    letterSpacing: st.letterSpacing ? Math.min(4, st.letterSpacing / 4) : undefined,
    WebkitTextStroke: st.outline ? `${Math.min(2, st.outline.width / 4)}px ${st.outline.color}` : undefined,
    textShadow: [st.glow ? `0 0 ${Math.min(14, st.glow.blur / 3)}px ${st.glow.color}` : '', st.shadow ? `${st.shadow.x / 3}px ${st.shadow.y / 3}px ${st.shadow.blur / 3}px ${st.shadow.color}` : ''].filter(Boolean).join(', ') || undefined,
    background: st.gradient ? `linear-gradient(${st.gradient.angle}deg, ${st.gradient.from}, ${st.gradient.to})` : st.background ? st.background.color : undefined,
    WebkitBackgroundClip: st.gradient ? 'text' : undefined,
    WebkitTextFillColor: st.gradient ? 'transparent' : undefined,
    padding: st.background ? '2px 8px' : undefined,
    borderRadius: st.background ? Math.min(12, st.background.radius / 2) : undefined,
  };
  return (
    <span className="sample" style={css}>
      {p.sample ?? 'Aa'}
    </span>
  );
}

export function FontPicker({ value, onChange }: { value: string; onChange: (family: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<FontDef['category'] | null>(null);
  const [, bump] = useState(0);
  useEffect(() => onFontsChanged(() => bump((v) => v + 1)), []);
  useEffect(() => {
    void ensureFont(value);
  }, [value]);
  const fonts = allFonts().filter((f) => (!cat || f.category === cat) && (!q || f.family.toLowerCase().includes(q.toLowerCase())));
  const upload = async () => {
    const files = await pickFiles('.ttf,.otf,.woff,.woff2', true);
    for (const f of files) {
      try {
        const family = f.name.replace(/\.[^.]+$/, '');
        const face = new FontFace(family, await f.arrayBuffer());
        await face.load();
        document.fonts.add(face);
        registerUserFont(family);
        await importFile(f, { name: f.name, type: 'font' });
        onChange(family);
        toast(`Font "${family}" installed`, 'success');
      } catch (e: any) {
        toast(`Could not load ${f.name}`, 'error', e?.message);
      }
    }
  };
  return (
    <div className="font-picker">
      <div className="row">
        <label>Font</label>
        <button className="btn sm font-current" style={{ fontFamily: value, flex: 1, justifyContent: 'flex-start' }} onClick={() => setOpen(!open)} title="Choose font">
          {value}
        </button>
        <button className="icon-btn" title="Upload font (.ttf/.otf/.woff)" onClick={upload}><Upload size={14} /></button>
      </div>
      {open && (
        <div className="font-list">
          <SearchBox value={q} onChange={setQ} placeholder="Search fonts…" autoFocus />
          <Chips items={FONT_CATEGORIES} value={cat} onChange={setCat} all="All" />
          <div className="font-items">
            {fonts.map((f) => (
              <FontItem key={f.family} f={f} active={f.family === value} onPick={() => { onChange(f.family); setOpen(false); }} />
            ))}
            {fonts.length === 0 && <div className="muted small" style={{ padding: 8 }}>No fonts match.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

function FontItem({ f, active, onPick }: { f: FontDef; active: boolean; onPick: () => void }) {
  useEffect(() => {
    void ensureFont(f.family);
  }, [f.family]);
  return (
    <button className={`font-item ${active ? 'active' : ''}`} onClick={onPick} style={{ fontFamily: `"${f.family}"` }}>
      <span>{f.family}</span>
      <span className="muted small" style={{ fontFamily: 'var(--font)' }}>{f.category}</span>
    </button>
  );
}
