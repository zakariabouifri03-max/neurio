import React, { useMemo, useState } from 'react';
import { LayoutTemplate } from 'lucide-react';
import { PanelHeader } from './LeftPanels';
import { SearchBox, Chips, FavButton, Empty } from '../common';
import { useFavorites } from '@/services/favorites';
import { TEMPLATES, TEMPLATE_CATEGORIES, mediaSlotsOf, type TemplateDef, type TemplateCategory } from '@/library/templates';
import { SOCIAL_PRESETS } from '@/core/defaults';
import { useUI } from '@/core/uiStore';

export function TemplateCard({ t, onClick, tall }: { t: TemplateDef; onClick: () => void; tall?: boolean }) {
  const fav = useFavorites();
  const preset = SOCIAL_PRESETS.find((p) => p.id === t.presetId);
  const slots = mediaSlotsOf(t).length;
  return (
    <div className={`tpl-card ${tall ? 'tall' : ''}`} onClick={onClick} title={t.description}>
      <div className="tpl-thumb" style={{ background: t.cover }}>
        <div className="tpl-preview">
          <span style={{ fontFamily: `"${t.theme.headingFont}", "Inter", sans-serif`, fontSize: tall ? 20 : 17 }}>{t.name}</span>
        </div>
        <span className="tag">{preset?.ratio} · {t.duration}s</span>
        <FavButton on={fav.is('template', t.id)} onToggle={() => fav.toggle('template', t.id)} />
      </div>
      <div className="tpl-info">
        <b>{t.name}</b>
        <span>
          {t.category} · {slots} media slot{slots === 1 ? '' : 's'}
        </span>
      </div>
    </div>
  );
}

export function TemplatesPanel() {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<TemplateCategory | 'Favorites' | null>(null);
  const fav = useFavorites();
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return TEMPLATES.filter((x) => (cat === null ? true : cat === 'Favorites' ? fav.is('template', x.id) : x.category === cat)).filter((x) => !t || x.name.toLowerCase().includes(t) || x.category.toLowerCase().includes(t) || x.tags.some((g) => g.includes(t)) || x.description.toLowerCase().includes(t));
  }, [q, cat, fav.favs]);
  return (
    <>
      <PanelHeader title="Templates" sub={`${TEMPLATES.length} editable`} />
      <div className="panel-body" style={{ paddingBottom: 0, flex: '0 0 auto' }}>
        <SearchBox value={q} onChange={setQ} placeholder="Search templates…" />
        <Chips items={['Favorites', ...TEMPLATE_CATEGORIES] as (TemplateCategory | 'Favorites')[]} value={cat} onChange={setCat} all="All" />
      </div>
      <div className="panel-body scroll" style={{ flex: 1 }}>
        {!list.length && <Empty icon={<LayoutTemplate />}>No templates match.</Empty>}
        <div className="tpl-row grid">
          {list.map((t) => (
            <TemplateCard key={t.id} t={t} onClick={() => useUI.getState().openDialog({ kind: 'template', templateId: t.id })} />
          ))}
        </div>
        <div className="muted small" style={{ marginTop: 10 }}>Templates open in a setup dialog where you pick media for each slot, change colors, fonts and music. Every element stays editable afterwards.</div>
      </div>
    </>
  );
}
