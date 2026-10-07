'use client';

import { useState } from 'react';
import { Type, AlignLeft, AlignCenter, AlignRight, Sparkles, Wand2 } from 'lucide-react';
import { Button, Field, Segmented, Slider, SearchInput, ColorPicker, Select } from '@/components/ui';
import { useEditor } from '@/store/editor';
import { createText } from '@/engine/factory';
import { addAtViewCenter } from '../insert';
import { FONTS, FONT_PAIRINGS, TYPOGRAPHY_PRESETS, loadFont } from '@/data/fonts';
import { applyTypography } from '@/engine/apply-command';
import type { TextNode } from '@/engine/types';

const HEADINGS = [
  { label: 'Add a heading', size: 72, weight: 800, tracking: -1.5, sample: 'Add a heading' },
  { label: 'Add a subheading', size: 42, weight: 600, tracking: -0.5, sample: 'Add a subheading' },
  { label: 'Add a little bit of body text', size: 22, weight: 400, tracking: 0, sample: 'Add a little bit of body text' },
];

export function TextPanel() {
  const doc = useEditor((s) => s.doc);
  const activePage = useEditor((s) => s.activePage);
  const selection = useEditor((s) => s.selection);
  const setDoc = useEditor((s) => s.setDoc);
  const updateNodes = useEditor((s) => s.updateNodes);
  const updateNodeDeep = useEditor((s) => s.updateNodeDeep);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<'ALL' | 'sans' | 'serif' | 'display' | 'handwriting' | 'mono' | 'arabic'>('ALL');

  const page = doc.pages[activePage];
  const selectedText = page?.nodes.find((node) => node.id === selection[0] && node.type === 'text') as TextNode | undefined;

  function addPreset(preset: (typeof HEADINGS)[number]) {
    const node = createText(preset.sample, {
      fontSize: preset.size,
      fontWeight: preset.weight,
      letterSpacing: preset.tracking,
      fontFamily: doc.settings.theme.fontHeading,
    });
    if (!page) return;
    node.width = Math.min(page.width * 0.8, 900);
    node.height = preset.size * 1.4;
    addAtViewCenter(node, 'Add text');
  }

  const fonts = FONTS.filter((font) => (category === 'ALL' ? true : font.category === category))
    .filter((font) => (query ? font.family.toLowerCase().includes(query.toLowerCase()) : true))
    .slice(0, 60);

  function applyFont(family: string) {
    loadFont(family);
    if (selection.length) {
      updateNodes(selection, (node) => (node.type === 'text' ? { style: { ...(node.style as any), fontFamily: family } } : {}), {
        label: 'Change font',
      });
    }
  }

  function updateStyle(patch: Record<string, unknown>) {
    if (!selection.length) return;
    updateNodes(selection, (node) => (node.type === 'text' ? { style: { ...(node.style as any), ...patch } } : {}), {
      label: 'Text style',
      coalesce: 'text-style',
    });
  }

  function applyTextPath(kind: 'none' | 'arc' | 'wave') {
    if (!selectedText) return;
    const width = selectedText.width;
    const height = selectedText.height;
    const d =
      kind === 'arc'
        ? `M 0 ${height * 0.85} Q ${width / 2} ${-height * 0.35} ${width} ${height * 0.85}`
        : kind === 'wave'
          ? `M 0 ${height * 0.6} C ${width * 0.25} ${height * 0.35}, ${width * 0.75} ${height * 0.85}, ${width} ${height * 0.6}`
          : '';
    updateNodeDeep(selectedText.id, (node) => {
      if (node.type === 'text') node.style = { ...(node.style as any), path: kind === 'none' ? null : { d, startOffset: 0, spacing: 0 } };
    }, { label: 'Curved text' });
  }

  return (
    <div className="scroll-thin flex h-full flex-col overflow-y-auto p-3">
      <SectionTitle>Text presets</SectionTitle>
      <div className="flex flex-col gap-2">
        {HEADINGS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            onClick={() => addPreset(preset)}
            className="rounded-xl px-3 py-2.5 text-start transition-colors hover:bg-[var(--bg-hover)]"
            style={{ border: '1px solid var(--border)', background: 'var(--bg-panel)' }}
          >
            <span style={{ color: 'var(--text)', fontSize: Math.min(22, preset.size * 0.4), fontWeight: preset.weight }}>
              {preset.sample}
            </span>
          </button>
        ))}
      </div>

      <SectionTitle>Font pairings</SectionTitle>
      <div className="flex flex-col gap-2">
        {FONT_PAIRINGS.slice(0, 6).map((pairing) => (
          <button
            key={pairing.name}
            type="button"
            onClick={() => {
              loadFont(pairing.heading);
              loadFont(pairing.body);
              const next = applyTypography(
                doc,
                {
                  id: pairing.name,
                  name: pairing.name,
                  heading: { family: pairing.heading, weight: 700, tracking: -0.5, lineHeight: 1.1 },
                  body: { family: pairing.body, weight: 400, tracking: 0, lineHeight: 1.6 },
                  scale: 2.4,
                },
              );
              setDoc(next, { resetHistory: false });
            }}
            className="rounded-xl px-3 py-2 text-start transition-colors hover:bg-[var(--bg-hover)]"
            style={{ border: '1px solid var(--border)', background: 'var(--bg-panel)' }}
          >
            <span className="block text-[14px] font-semibold" style={{ color: 'var(--text)' }}>
              {pairing.heading}
            </span>
            <span className="block text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
              {pairing.body} · {pairing.mood}
            </span>
          </button>
        ))}
      </div>

      <SectionTitle>Typography systems</SectionTitle>
      <div className="flex flex-wrap gap-1.5">
        {TYPOGRAPHY_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            onClick={() => setDoc(applyTypography(doc, preset), { resetHistory: false })}
            className="rounded-lg px-2.5 py-1.5 text-[11.5px]"
            style={{ border: '1px solid var(--border)', color: 'var(--text-muted)', background: 'var(--bg-panel)' }}
          >
            {preset.name}
          </button>
        ))}
      </div>

      {selectedText ? (
        <>
          <SectionTitle>Selected text</SectionTitle>
          <Field label="Alignment">
            <Segmented
              size="sm"
              value={selectedText.style?.textAlign ?? 'left'}
              onChange={(value) => updateStyle({ textAlign: value })}
              options={[
                { value: 'left', label: <AlignLeft size={13} /> },
                { value: 'center', label: <AlignCenter size={13} /> },
                { value: 'right', label: <AlignRight size={13} /> },
              ]}
            />
          </Field>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <Field label="Size">
              <input
                type="number"
                value={Math.round(selectedText.style?.fontSize ?? 32)}
                onChange={(event) => updateStyle({ fontSize: Number(event.target.value) })}
                className="field"
              />
            </Field>
            <Field label="Weight">
              <Select
                value={String(selectedText.style?.fontWeight ?? 400)}
                onChange={(value) => updateStyle({ fontWeight: Number(value) })}
                options={[300, 400, 500, 600, 700, 800].map((weight) => ({ value: String(weight), label: String(weight) }))}
              />
            </Field>
            <Field label="Line height">
              <input
                type="number"
                step={0.05}
                value={selectedText.style?.lineHeight ?? 1.2}
                onChange={(event) => updateStyle({ lineHeight: Number(event.target.value) })}
                className="field"
              />
            </Field>
          </div>

          <div className="mt-3">
            <Field label="Letter spacing">
              <Slider
                value={selectedText.style?.letterSpacing ?? 0}
                min={-10}
                max={20}
                step={0.5}
                onChange={(value) => updateStyle({ letterSpacing: value })}
                suffix="px"
              />
            </Field>
          </div>

          <div className="mt-3">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
              Colour
            </span>
            <ColorPicker value={selectedText.style?.color ?? '#111827'} onChange={(color) => updateStyle({ color })} />
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <Button size="sm" variant="secondary" onClick={() => updateStyle({ outline: { color: '#6C5CE7', width: 2 } })}>
              Outline
            </Button>
            <Button size="sm" variant="secondary" onClick={() => updateStyle({ glow: { color: '#00E0C6', blur: 18 } })}>
              Glow
            </Button>
            <Button size="sm" variant="secondary" onClick={() => updateStyle({ shadow: { color: 'rgba(0,0,0,.35)', x: 2, y: 3, blur: 6 } })}>
              Shadow
            </Button>
          </div>

          <div className="mt-2 grid grid-cols-3 gap-2">
            <Button size="sm" variant="ghost" onClick={() => applyTextPath('none')}>
              Straight
            </Button>
            <Button size="sm" variant="ghost" onClick={() => applyTextPath('arc')}>
              Arc
            </Button>
            <Button size="sm" variant="ghost" onClick={() => applyTextPath('wave')}>
              Wave
            </Button>
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                updateStyle({
                  gradient: {
                    angle: 90,
                    stops: [
                      { offset: 0, color: '#6C5CE7' },
                      { offset: 1, color: '#00E0C6' },
                    ],
                  },
                })
              }
            >
              <Sparkles size={12} /> Gradient
            </Button>
            <Button size="sm" variant="ghost" onClick={() => updateStyle({ textTransform: 'uppercase' })}>
              <Wand2 size={12} /> Uppercase
            </Button>
          </div>
        </>
      ) : null}

      <SectionTitle>Fonts</SectionTitle>
      <div className="mb-2">
        <SearchInput value={query} onChange={setQuery} placeholder="Search fonts…" />
      </div>
      <div className="mb-2 flex flex-wrap gap-1">
        {(['ALL', 'sans', 'serif', 'display', 'handwriting', 'mono', 'arabic'] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setCategory(item)}
            className="rounded-full px-2 py-0.5 text-[11px]"
            style={{
              background: category === item ? 'var(--brand)' : 'var(--bg-panel)',
              color: category === item ? '#fff' : 'var(--text-muted)',
              border: `1px solid ${category === item ? 'var(--brand)' : 'var(--border)'}`,
            }}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-1">
        {fonts.map((font) => (
          <button
            key={font.family}
            type="button"
            onClick={() => applyFont(font.family)}
            className="rounded-lg px-2.5 py-2 text-start transition-colors hover:bg-[var(--bg-hover)]"
            style={{ color: 'var(--text)' }}
          >
            <span className="block text-[15px]" style={{ fontFamily: `"${font.family}", ${font.category === 'serif' ? 'serif' : 'sans-serif'}` }}>
              {font.family}
            </span>
          </button>
        ))}
      </div>
      <div className="h-4" />
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 mt-4 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
      <Type size={12} /> {children}
    </h3>
  );
}
