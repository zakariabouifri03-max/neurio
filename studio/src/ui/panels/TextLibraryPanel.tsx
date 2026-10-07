import React, { useEffect, useMemo, useState } from 'react';
import { Type, Plus, Subtitles, AlignLeft } from 'lucide-react';
import { PanelHeader } from './LeftPanels';
import { SearchBox, Chips, FavButton, Empty } from '../common';
import { useFavorites } from '@/services/favorites';
import { TEXT_PRESETS, TEXT_PRESET_CATEGORIES, type TextPreset } from '@/library/textPresets';
import { IN_OUT_ANIMATIONS, LOOP_ANIMATIONS } from '@/library/textAnimations';
import { ensureFont, onFontsChanged } from '@/library/fonts';
import { addTextClip } from '@/services/clipActions';
import { useUI } from '@/core/uiStore';
import { useProject, getSelectedClips, patchClip } from '@/core/store';
import type { TextStyle } from '@/core/types';

type Tab = 'presets' | 'animations' | 'basic';

function cssFor(style: Partial<TextStyle>, scale = 0.3): React.CSSProperties {
  const s: React.CSSProperties = {
    fontFamily: `"${style.fontFamily || 'Inter'}", sans-serif`,
    fontWeight: style.fontWeight ?? 700,
    fontStyle: style.italic ? 'italic' : 'normal',
    fontSize: Math.max(11, Math.min(26, (style.fontSize ?? 60) * scale)),
    color: style.color ?? '#fff',
    letterSpacing: (style.letterSpacing ?? 0) * scale,
    textTransform: style.uppercase ? 'uppercase' : 'none',
    textDecoration: style.underline ? 'underline' : 'none',
    lineHeight: 1.1,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: '100%',
    padding: style.background ? `${(style.background.padding ?? 10) * scale}px ${(style.background.padding ?? 10) * scale * 1.5}px` : undefined,
    background: style.background?.color,
    borderRadius: style.background ? style.background.radius * scale : undefined,
  };
  const shadows: string[] = [];
  if (style.outline && style.outline.width > 0) (s as any).WebkitTextStroke = `${Math.max(0.5, style.outline.width * scale * 0.6)}px ${style.outline.color}`;
  if (style.shadow) shadows.push(`${style.shadow.x * scale}px ${style.shadow.y * scale}px ${style.shadow.blur * scale}px ${style.shadow.color}`);
  if (style.glow) shadows.push(`0 0 ${Math.max(4, style.glow.blur * scale)}px ${style.glow.color}`, `0 0 ${Math.max(8, style.glow.blur * scale * 2)}px ${style.glow.color}`);
  if (shadows.length) s.textShadow = shadows.join(', ');
  if (style.gradient) {
    s.backgroundImage = `linear-gradient(${style.gradient.angle}deg, ${style.gradient.from}, ${style.gradient.to})`;
    (s as any).WebkitBackgroundClip = 'text';
    s.color = 'transparent';
  }
  return s;
}

export function TextPreview({ preset }: { preset: TextPreset }) {
  const [, bump] = useState(0);
  useEffect(() => {
    if (preset.style.fontFamily) void ensureFont(preset.style.fontFamily);
    return onFontsChanged(() => bump((n) => n + 1));
  }, [preset.style.fontFamily]);
  return <span style={cssFor(preset.style)}>{preset.sample || preset.name}</span>;
}

export function TextLibraryPanel() {
  const [tab, setTab] = useState<Tab>('presets');
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<TextPreset['category'] | 'Favorites' | null>(null);
  const fav = useFavorites();
  const setRight = useUI((s) => s.setRightPanel);
  const selection = useProject((s) => s.selection);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return TEXT_PRESETS.filter((p) => (cat === null ? true : cat === 'Favorites' ? fav.is('textpreset', p.id) : p.category === cat)).filter((p) => !t || p.name.toLowerCase().includes(t) || p.category.toLowerCase().includes(t) || (p.style.fontFamily || '').toLowerCase().includes(t));
  }, [q, cat, fav.favs]);

  const add = (p: TextPreset) => {
    if (p.style.fontFamily) void ensureFont(p.style.fontFamily);
    addTextClip(p.sample || 'Your text here', p.style, p.animation ?? {}, 4);
    fav.touch('textpreset', p.id);
    setRight('text');
  };

  return (
    <>
      <PanelHeader title="Text">
        <div className="tabs" style={{ marginLeft: 8 }}>
          <button className={tab === 'basic' ? 'active' : ''} onClick={() => setTab('basic')}>Add</button>
          <button className={tab === 'presets' ? 'active' : ''} onClick={() => setTab('presets')}>Presets</button>
          <button className={tab === 'animations' ? 'active' : ''} onClick={() => setTab('animations')}>Animations</button>
        </div>
      </PanelHeader>

      {tab === 'basic' && (
        <div className="panel-body scroll">
          <div className="card-grid wide">
            <button className="card" onClick={() => { addTextClip('Your title', { fontFamily: 'Poppins', fontSize: 110, fontWeight: 800 }, { in: { type: 'slideUp', duration: 0.5, unit: 'word', stagger: 0.05 }, out: { type: 'fade', duration: 0.4, unit: 'block', stagger: 0 } }, 4); setRight('text'); }}>
              <div className="thumb" style={{ display: 'grid', placeItems: 'center' }}><span style={{ fontSize: 22, fontWeight: 800 }}>Title</span></div>
              <div className="name">Headline</div>
              <div className="meta">Big centered title</div>
            </button>
            <button className="card" onClick={() => { addTextClip('Body text goes here', { fontFamily: 'Inter', fontSize: 48, fontWeight: 500 }, {}, 5); setRight('text'); }}>
              <div className="thumb" style={{ display: 'grid', placeItems: 'center' }}><AlignLeft /></div>
              <div className="name">Body text</div>
              <div className="meta">Plain paragraph</div>
            </button>
            <button className="card" onClick={() => { addTextClip('Subtitle line', { fontFamily: 'Inter', fontSize: 46, fontWeight: 600, outline: { color: '#000', width: 3 } }, {}, 3); setRight('text'); }}>
              <div className="thumb" style={{ display: 'grid', placeItems: 'center' }}><Subtitles /></div>
              <div className="name">Subtitle</div>
              <div className="meta">Bottom-safe caption style</div>
            </button>
            <button className="card" onClick={() => { addTextClip('Name Surname', { fontFamily: 'Inter', fontSize: 44, fontWeight: 700, align: 'left', background: { color: 'rgba(0,0,0,0.6)', padding: 14, radius: 6 } }, { in: { type: 'slideLeft', duration: 0.4, unit: 'block', stagger: 0 }, out: { type: 'slideLeft', duration: 0.4, unit: 'block', stagger: 0 } }, 5); setRight('text'); }}>
              <div className="thumb" style={{ display: 'grid', placeItems: 'center' }}><span style={{ fontSize: 12, background: '#000a', padding: '4px 8px', borderRadius: 4 }}>Lower third</span></div>
              <div className="name">Lower third</div>
              <div className="meta">Name/title bar</div>
            </button>
          </div>
          <div className="muted small" style={{ marginTop: 12 }}>
            Text is added at the playhead on a text track. Edit font, colors, outline, shadow, glow, background and animation in the <b>Text</b> inspector on the right.
          </div>
        </div>
      )}

      {tab === 'presets' && (
        <>
          <div className="panel-body" style={{ paddingBottom: 0, flex: '0 0 auto' }}>
            <SearchBox value={q} onChange={setQ} placeholder="Search text styles…" />
            <Chips items={['Favorites', ...TEXT_PRESET_CATEGORIES] as (TextPreset['category'] | 'Favorites')[]} value={cat} onChange={setCat} all="All" />
          </div>
          <div className="panel-body scroll" style={{ flex: 1 }}>
            {!list.length && <Empty icon={<Type />}>No presets match.</Empty>}
            <div className="card-grid wide">
              {list.map((p) => (
                <div key={p.id} className="card" onClick={() => add(p)} title="Click to add">
                  <div className="thumb" style={{ display: 'grid', placeItems: 'center', padding: 8, background: p.style.color === '#000000' || p.style.background?.color === '#ffffff' ? '#3b3b44' : undefined }}>
                    <TextPreview preset={p} />
                  </div>
                  <div className="name">{p.name}</div>
                  <div className="meta">{p.style.fontFamily} · {p.category}</div>
                  <FavButton on={fav.is('textpreset', p.id)} onToggle={() => fav.toggle('textpreset', p.id)} />
                  <button className="add" onClick={(e) => { e.stopPropagation(); add(p); }} title="Add to timeline"><Plus size={14} /></button>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === 'animations' && (
        <div className="panel-body scroll">
          <div className="muted small" style={{ marginBottom: 8 }}>
            {selection.length ? 'Click an animation to apply it to the selected text clip(s).' : 'Select a text clip in the timeline, then click an animation to apply it. Or click to add new animated text.'}
          </div>
          <h4 className="muted small" style={{ margin: '8px 0 6px' }}>Entrance / Exit</h4>
          <div className="card-grid">
            {IN_OUT_ANIMATIONS.map((a) => (
              <button key={a.id} className="card" onClick={() => applyAnim(a.id, 'inout')}>
                <div className="thumb" style={{ display: 'grid', placeItems: 'center', fontSize: 22 }}>{a.icon}</div>
                <div className="name">{a.name}</div>
              </button>
            ))}
          </div>
          <h4 className="muted small" style={{ margin: '12px 0 6px' }}>Loop</h4>
          <div className="card-grid">
            {LOOP_ANIMATIONS.map((a) => (
              <button key={a.id} className="card" onClick={() => applyAnim(a.id, 'loop')}>
                <div className="thumb" style={{ display: 'grid', placeItems: 'center', fontSize: 22 }}>{a.icon}</div>
                <div className="name">{a.name}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function applyAnim(id: string, kind: 'inout' | 'loop') {
  const textIds = getSelectedClips().filter((c) => c.kind === 'text' || c.kind === 'caption').map((c) => c.id);
  if (!textIds.length) {
    addTextClip('Animated text', { fontFamily: 'Poppins', fontSize: 96, fontWeight: 800 }, kind === 'inout' ? { in: { type: id, duration: 0.6, unit: 'word', stagger: 0.06 }, out: { type: 'fade', duration: 0.4, unit: 'block', stagger: 0 } } : { loop: { type: id, speed: 1, intensity: 1 } }, 4);
    useUI.getState().setRightPanel('text');
    return;
  }
  for (const cid of textIds) {
    patchClip(cid, 'Text animation', (c: any) => ({
      animation: kind === 'inout' ? { ...c.animation, in: { ...c.animation.in, type: id, duration: c.animation.in.duration || 0.5 } } : { ...c.animation, loop: id === 'none' ? null : { type: id, speed: c.animation.loop?.speed ?? 1, intensity: c.animation.loop?.intensity ?? 1 } },
    }));
  }
  useUI.getState().setRightPanel('text');
}
