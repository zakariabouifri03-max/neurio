import React, { useEffect, useMemo, useState } from 'react';
import { BUILT_IN_TEMPLATES, TEMPLATE_CATEGORIES } from '@/data/templates';
import { applyElements, previewSvg, svgDataUrl } from '@/lib/blueprint';
import { engine } from '@/editor/engine';
import { useEditor } from '@/state/editorStore';
import { useApp } from '@/state/appStore';
import { bridge } from '@/lib/bridge';
import { Empty } from '@/components/common/ui';
import type { TemplateCategory } from '@/types';

export function TemplatesPanel() {
  const [category, setCategory] = useState<TemplateCategory | 'All'>('All');
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState<any[]>([]);
  const toast = useApp((s) => s.toast);
  const resizePage = useEditor((s) => s.resizePage);
  const markDirty = useEditor((s) => s.markDirty);

  const refresh = () => void bridge.templates.list().then(setCustom).catch(() => setCustom([]));
  useEffect(refresh, []);

  const list = useMemo(
    () =>
      BUILT_IN_TEMPLATES.filter(
        (t) =>
          (category === 'All' || t.category === category) &&
          (!query || t.name.toLowerCase().includes(query.toLowerCase()))
      ),
    [category, query]
  );

  const apply = async (t: (typeof BUILT_IN_TEMPLATES)[number]) => {
    resizePage(t.width, t.height);
    engine.setBackground(t.background);
    await applyElements(t.elements, { clear: true });
    markDirty();
    toast(`Template "${t.name}" applied`, 'success');
  };

  const applyCustom = async (t: any) => {
    resizePage(t.width, t.height);
    engine.setBackground(t.background);
    await engine.loadPage({ id: 'tmp', name: t.name, width: t.width, height: t.height, background: t.background, scene: t.scene });
    markDirty();
    toast(`Template "${t.name}" applied`, 'success');
  };

  const saveCurrent = async () => {
    const state = useEditor.getState();
    const page = state.project?.pages[state.activePage];
    if (!page) return;
    const name = window.prompt('Template name', `${state.project?.name} template`);
    if (!name) return;
    try {
      await bridge.templates.save({
        name,
        category: 'Custom',
        width: engine.pageWidth,
        height: engine.pageHeight,
        background: engine.pageBackground,
        scene: engine.serializeScene(),
        thumbnail: engine.thumbnail(260)
      } as any);
      refresh();
      toast('Saved as custom template', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <>
      <h3>Templates</h3>
      <input className="input" placeholder="Search templates…" value={query} onChange={(e) => setQuery(e.target.value)} />
      <select className="select" value={category} onChange={(e) => setCategory(e.target.value as TemplateCategory)}>
        <option value="All">All categories</option>
        {TEMPLATE_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {c}
          </option>
        ))}
      </select>

      <div className="grid-2">
        {list.map((t) => (
          <div key={t.id} className="template-card" onClick={() => void apply(t)} title={`${t.width} × ${t.height}`}>
            <img className="thumb" alt={t.name} src={svgDataUrl(previewSvg(t.width, t.height, t.background, t.elements))} />
            <div className="meta">
              <span>{t.name}</span>
            </div>
          </div>
        ))}
      </div>
      {!list.length ? <Empty text="No templates match your search." /> : null}

      <h3 style={{ marginTop: 8 }}>My templates</h3>
      <button className="btn sm" onClick={() => void saveCurrent()}>
        Save current page as template
      </button>
      <div className="grid-2">
        {custom.map((t) => (
          <div key={t.id} className="template-card">
            <img
              className="thumb"
              alt={t.name}
              src={t.thumbnail ?? svgDataUrl(previewSvg(t.width, t.height, t.background, []))}
              onClick={() => void applyCustom(t)}
            />
            <div className="meta">
              <span>{t.name}</span>
              <button
                className="btn ghost sm danger"
                onClick={async () => {
                  await bridge.templates.remove(t.id);
                  refresh();
                }}
              >
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
      {!custom.length ? <Empty text="Custom templates you save will appear here." /> : null}
    </>
  );
}
