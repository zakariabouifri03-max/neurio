'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { Search, Loader2, Sparkles, X, ChevronLeft, ChevronRight, Heart } from 'lucide-react';
import { api } from '@/lib/api-client';
import { Button, EmptyState, Modal, SearchInput, Select } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { TemplatePreview } from '@/components/template/TemplatePreview';
import { TEMPLATE_CATEGORIES } from '@/data/templates';
import type { Page } from '@/engine/types';

type CatalogueTemplate = {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  tags: string[];
  width: number;
  height: number;
  kind: string;
  pages: Page[];
};

const PAGE_SIZE = 36;

function TemplatesBrowser() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [all, setAll] = useState<CatalogueTemplate[] | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('ALL');
  const [sort, setSort] = useState('featured');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [preview, setPreview] = useState<CatalogueTemplate | null>(null);
  const [busy, setBusy] = useState(false);
  const [favorites, setFavorites] = useState<string[]>([]);
  const scrollerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    import('@/data/templates').then((module) => {
      if (cancelled) return;
      setAll(
        module.allTemplates().map((template) => ({
          id: template.id,
          name: template.name,
          category: template.category,
          subcategory: template.subcategory,
          tags: template.tags,
          width: template.width,
          height: template.height,
          kind: template.kind,
          pages: template.pages,
        })),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('prism.favoriteTemplates');
      if (stored) setFavorites(JSON.parse(stored) as string[]);
    } catch {
      /* ignore */
    }
  }, []);

  // Deep link: /templates?use=<id> opens the preview and can apply a template.
  useEffect(() => {
    const use = params.get('use');
    if (!use || !all) return;
    const match = all.find((template) => template.id === use);
    if (match) setPreview(match);
  }, [params, all]);

  const results = useMemo(() => {
    if (!all) return [];
    const term = query.trim().toLowerCase();
    let list = all;
    if (category !== 'ALL') list = list.filter((template) => template.category === category);
    if (term) {
      list = list.filter((template) =>
        `${template.name} ${template.category} ${template.subcategory ?? ''} ${template.tags.join(' ')}`.toLowerCase().includes(term),
      );
    }
    if (sort === 'name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    if (sort === 'favorites') {
      const favSet = new Set(favorites);
      list = [...list].sort((a, b) => Number(favSet.has(b.id)) - Number(favSet.has(a.id)));
    }
    return list;
  }, [all, query, category, sort, favorites]);

  function toggleFavorite(id: string) {
    setFavorites((current) => {
      const next = current.includes(id) ? current.filter((item) => item !== id) : [...current, id];
      try {
        window.localStorage.setItem('prism.favoriteTemplates', JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  async function useTemplate(template: CatalogueTemplate) {
    setBusy(true);
    try {
      const project = await api.post<{ id: string }>('/api/projects', {
        templateId: template.id,
        title: template.name,
      });
      router.push(`/design/${project.id}`);
    } catch (error) {
      toast.error('Could not create the design', (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const visible = results.slice(0, limit);

  return (
    <div className="mx-auto max-w-[1240px] px-5 py-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-[22px] font-bold tracking-tight">Templates</h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
            {all ? `${results.length} templates` : 'Loading catalogue…'} — every one is a real, editable document
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-[240px]">
            <SearchInput value={query} onChange={setQuery} placeholder="Search templates…" />
          </div>
          <Select
            value={sort}
            onChange={setSort}
            options={[
              { value: 'featured', label: 'Recommended' },
              { value: 'name', label: 'Name A–Z' },
              { value: 'favorites', label: 'Favourites first' },
            ]}
          />
        </div>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        {['ALL', ...TEMPLATE_CATEGORIES].map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => {
              setCategory(item);
              setLimit(PAGE_SIZE);
            }}
            className="rounded-full px-3 py-1.5 text-[12.5px] font-medium transition-colors"
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

      {all === null ? (
        <div className="grid place-items-center py-24">
          <Loader2 size={22} className="animate-spin" style={{ color: 'var(--brand)' }} />
        </div>
      ) : results.length === 0 ? (
        <div className="card mt-6">
          <EmptyState icon={<Search size={22} />} title="No templates match" description="Try a different search term or category." />
        </div>
      ) : (
        <>
          <div ref={scrollerRef} className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {visible.map((template) => (
              <div
                key={template.id}
                className="group relative overflow-hidden rounded-2xl p-2 transition-transform hover:-translate-y-0.5"
                style={{ border: '1px solid var(--border)', background: 'var(--bg-panel)' }}
              >
                <button type="button" onClick={() => setPreview(template)} className="block w-full text-start">
                  <div className="grid place-items-center overflow-hidden rounded-xl" style={{ background: 'var(--bg-input)' }}>
                    <TemplatePreview page={template.pages[0]} width={220} />
                  </div>
                  <div className="px-1 pb-0.5 pt-2 text-[12.5px] font-medium" style={{ color: 'var(--text)' }}>
                    {template.name}
                  </div>
                  <div className="flex items-center justify-between px-1 text-[11px]" style={{ color: 'var(--text-faint)' }}>
                    <span>{template.category}</span>
                    <span>
                      {template.width}×{template.height}
                      {template.pages.length > 1 ? ` · ${template.pages.length} pages` : ''}
                    </span>
                  </div>
                </button>

                <div className="absolute end-3 top-3 flex gap-1.5 opacity-0 transition-opacity group-hover:opacity-100">
                  <button
                    type="button"
                    onClick={() => toggleFavorite(template.id)}
                    className="grid h-7 w-7 place-items-center rounded-lg"
                    style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: favorites.includes(template.id) ? 'var(--danger)' : 'var(--text-muted)' }}
                    aria-label="Favourite"
                  >
                    <Heart size={13} fill={favorites.includes(template.id) ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    type="button"
                    onClick={() => useTemplate(template)}
                    className="grid h-7 place-items-center rounded-lg px-2 text-[11.5px] font-medium"
                    style={{ background: 'var(--brand)', color: '#fff' }}
                  >
                    Use
                  </button>
                </div>
              </div>
            ))}
          </div>

          {limit < results.length ? (
            <div className="mt-6 flex justify-center">
              <Button variant="secondary" onClick={() => setLimit((value) => value + PAGE_SIZE)}>
                Load more ({results.length - limit} left)
              </Button>
            </div>
          ) : null}
        </>
      )}

      <Modal
        open={!!preview}
        onClose={() => setPreview(null)}
        title={preview?.name}
        width={860}
        footer={
          preview ? (
            <>
              <Button variant="ghost" onClick={() => setPreview(null)}>
                Close
              </Button>
              <Button variant="primary" loading={busy} icon={<Sparkles size={14} />} onClick={() => useTemplate(preview)}>
                Use this template
              </Button>
            </>
          ) : null
        }
      >
        {preview ? (
          <div className="p-5">
            <div className="flex flex-wrap items-center gap-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
              <span className="chip" style={{ background: 'var(--bg-panel-2)' }}>
                {preview.category}
              </span>
              {preview.subcategory ? (
                <span className="chip" style={{ background: 'var(--bg-panel-2)' }}>
                  {preview.subcategory}
                </span>
              ) : null}
              <span>
                {preview.width}×{preview.height} · {preview.pages.length} {preview.pages.length === 1 ? 'page' : 'pages'}
              </span>
            </div>

            <div className="mt-4 flex gap-3 overflow-x-auto pb-2">
              {preview.pages.map((page, index) => (
                <div key={page.id ?? index} className="shrink-0">
                  <TemplatePreview page={page} width={240} />
                  <div className="mt-1 text-center text-[11px]" style={{ color: 'var(--text-faint)' }}>
                    {page.name || `Page ${index + 1}`}
                  </div>
                </div>
              ))}
            </div>

            <p className="mt-4 text-[13px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              Using this template creates a copy in your account. Every shape, gradient, image frame and line of text stays
              editable in the editor — nothing is flattened.
            </p>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

export default function TemplatesPage() {
  return (
    <Suspense fallback={<div style={{ height: 400 }} />}>
      <TemplatesBrowser />
    </Suspense>
  );
}
