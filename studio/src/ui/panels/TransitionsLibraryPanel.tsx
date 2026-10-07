import React, { useMemo, useState } from 'react';
import { ArrowLeftRight, Plus, Layers } from 'lucide-react';
import { PanelHeader } from './LeftPanels';
import { SearchBox, Chips, FavButton, Empty } from '../common';
import { useFavorites } from '@/services/favorites';
import { TRANSITIONS, TRANSITION_CATEGORIES, type TransitionDef, type TransitionCategory } from '@/library/transitions';
import { applyTransitionToSelection } from '@/services/clipActions';
import { useProject } from '@/core/store';
import { useUI } from '@/core/uiStore';

export function TransitionsLibraryPanel() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<TransitionCategory | 'Favorites' | null>(null);
  const fav = useFavorites();
  const selection = useProject((s) => s.selection);
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return TRANSITIONS.filter((e) => (cat === null ? true : cat === 'Favorites' ? fav.is('transition', e.id) : e.category === cat)).filter((e) => !t || e.name.toLowerCase().includes(t) || e.category.toLowerCase().includes(t));
  }, [q, cat, fav.favs]);
  const apply = (t: TransitionDef, all = false) => {
    applyTransitionToSelection(t.id, all);
    useUI.getState().setRightPanel('transition');
  };
  return (
    <>
      <PanelHeader title="Transitions" sub={`${TRANSITIONS.length} GPU transitions`} />
      <div className="panel-body" style={{ paddingBottom: 0, flex: '0 0 auto' }}>
        <SearchBox value={q} onChange={setQ} placeholder="Search transitions…" />
        <Chips items={['Favorites', ...TRANSITION_CATEGORIES] as (TransitionCategory | 'Favorites')[]} value={cat} onChange={setCat} all="All" />
        <div className="muted small" style={{ margin: '6px 0' }}>
          {selection.length ? 'Click to add at the cut next to the selected clip.' : 'Click to add at the cut nearest the playhead. Drag onto a cut in the timeline for precise placement.'}
        </div>
      </div>
      <div className="panel-body scroll" style={{ flex: 1 }}>
        {!list.length && <Empty icon={<ArrowLeftRight />}>No transitions match.</Empty>}
        <div className="card-grid">
          {list.map((t) => (
            <div key={t.id} className="card" onClick={() => apply(t)} title={`${t.name} · ${t.defaultDuration}s`} draggable onDragStart={(ev) => ev.dataTransfer.setData('application/x-neurio-transition', t.id)}>
              <div className="thumb" style={{ display: 'grid', placeItems: 'center' }}>
                <TransitionGlyph def={t} />
              </div>
              <div className="name">{t.name}</div>
              <div className="meta">{t.category} · {t.defaultDuration}s</div>
              <FavButton on={fav.is('transition', t.id)} onToggle={() => fav.toggle('transition', t.id)} />
              <button className="add" onClick={(ev) => { ev.stopPropagation(); apply(t); }} title="Add"><Plus size={12} /></button>
            </div>
          ))}
        </div>
        {list.length > 0 && (
          <div className="row" style={{ marginTop: 12, gap: 8 }}>
            <button className="btn sm" onClick={() => apply(list[0], true)} title={`Apply "${list[0].name}" to every cut on all video tracks`}>
              <Layers size={13} /> Apply "{list[0].name}" to all cuts
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/** Small animated two-tone glyph that hints at the transition motion (pure CSS, no GPU). */
function TransitionGlyph({ def }: { def: TransitionDef }) {
  return (
    <div className="tr-glyph" data-kind={def.category.toLowerCase()} aria-hidden>
      <div className="a" />
      <div className="b" />
      <span className="ic">{def.icon}</span>
    </div>
  );
}
