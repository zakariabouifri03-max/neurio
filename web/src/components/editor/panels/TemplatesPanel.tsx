'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, Loader2, Replace, Plus } from 'lucide-react';
import { SearchInput, Button, EmptyState } from '@/components/ui';
import { TemplatePreview } from '@/components/template/TemplatePreview';
import { useEditor } from '@/store/editor';
import { useToast } from '@/components/ui/toast';
import type { Page } from '@/engine/types';
import { uid } from '@/engine/factory';

type Entry = { id: string; name: string; category: string; width: number; height: number; pages: Page[] };

export function TemplatesPanel() {
  const [catalogue, setCatalogue] = useState<Entry[] | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('ALL');
  const [open, setOpen] = useState<Entry | null>(null);
  const toast = useToast();

  const doc = useEditor((s) => s.doc);
  const activePage = useEditor((s) => s.activePage);
  const updateSettings = useEditor((s) => s.updateSettings);
  const setDoc = useEditor((s) => s.setDoc);

  useEffect(() => {
    let cancelled = false;
    import('@/data/templates').then((module) => {
      if (cancelled) return;
      setCatalogue(
        module.allTemplates().map((template) => ({
          id: template.id,
          name: template.name,
          category: template.category,
          width: template.width,
          height: template.height,
          pages: template.pages,
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const categories = useMemo(() => ['ALL', ...new Set((catalogue ?? []).map((item) => item.category))].slice(0, 12), [catalogue]);

  const results = useMemo(() => {
    if (!catalogue) return [];
    const term = query.trim().toLowerCase();
    return catalogue
      .filter((item) => (category === 'ALL' ? true : item.category === category))
      .filter((item) => (term ? `${item.name} ${item.category}`.toLowerCase().includes(term) : true))
      .slice(0, 40);
  }, [catalogue, query, category]);

  function applyTemplate(entry: Entry, mode: 'replace' | 'append') {
    const pages = entry.pages.map((page, index) => ({
      ...(JSON.parse(JSON.stringify(page)) as Page),
      id: uid('pg'),
      name: page.name || `Page ${index + 1}`,
    }));

    const next = { ...doc };
    if (mode === 'replace') {
      next.pages = pages;
      next.width = entry.width;
      next.height = entry.height;
    } else {
      next.pages = [...doc.pages, ...pages];
    }
    setDoc(next, { resetHistory: false });
    updateSettings({ theme: { ...doc.settings.theme, colors: doc.settings.theme.colors } });
    toast.success(mode === 'replace' ? 'Template applied' : 'Pages added', entry.name);
    setOpen(null);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <SearchInput value={query} onChange={setQuery} placeholder="Search templates…" />
      </div>
      <div className="flex flex-wrap gap-1 px-3 pb-2">
        {categories.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setCategory(item)}
            className="rounded-full px-2.5 py-1 text-[11.5px]"
            style={{
              background: category === item ? 'var(--brand)' : 'var(--bg-panel)',
              color: category === item ? '#fff' : 'var(--text-muted)',
              border: `1px solid ${category === item ? 'var(--brand)' : 'var(--border)'}`,
            }}
          >
            {item === 'ALL' ? 'All' : item}
          </button>
        ))}
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {catalogue === null ? (
          <div className="grid place-items-center py-12">
            <Loader2 size={18} className="animate-spin" style={{ color: 'var(--brand)' }} />
          </div>
        ) : results.length === 0 ? (
          <EmptyState icon={<Search size={20} />} title="No templates match" />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {results.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setOpen(entry)}
                className="overflow-hidden rounded-xl text-start transition-transform hover:-translate-y-0.5"
                style={{ border: '1px solid var(--border)', background: 'var(--bg-panel)' }}
              >
                <div className="grid place-items-center" style={{ background: 'var(--bg-input)' }}>
                  <TemplatePreview page={entry.pages[0]} width={140} />
                </div>
                <div className="truncate px-2 py-1.5 text-[11.5px]" style={{ color: 'var(--text)' }}>
                  {entry.name}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {open ? (
        <div className="border-t p-3" style={{ borderColor: 'var(--border)' }}>
          <div className="mb-2 text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
            {open.name}
          </div>
          <p className="mb-3 mt-0 text-[11.5px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
            {open.width}×{open.height} · {open.pages.length} {open.pages.length === 1 ? 'page' : 'pages'} — everything stays editable.
          </p>
          <div className="flex gap-2">
            <Button variant="primary" size="sm" icon={<Replace size={13} />} onClick={() => applyTemplate(open, 'replace')}>
              Replace design
            </Button>
            <Button variant="secondary" size="sm" icon={<Plus size={13} />} onClick={() => applyTemplate(open, 'append')}>
              Add pages
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setOpen(null)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
