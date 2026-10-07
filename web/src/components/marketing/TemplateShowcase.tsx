'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { Page } from '@/engine/types';
import { TemplatePreview } from '@/components/template/TemplatePreview';

export type ShowcaseTemplate = {
  id: string;
  name: string;
  category: string;
  width: number;
  height: number;
  page: Page;
};

export function TemplateShowcase({ templates }: { templates: ShowcaseTemplate[] }) {
  const categories = useMemo(() => ['All', ...new Set(templates.map((t) => t.category))].slice(0, 9), [templates]);
  const [active, setActive] = useState('All');

  const visible = useMemo(
    () => (active === 'All' ? templates : templates.filter((t) => t.category === active)).slice(0, 12),
    [templates, active],
  );

  return (
    <div>
      <div className="mb-6 flex flex-wrap justify-center gap-2">
        {categories.map((category) => (
          <button
            key={category}
            type="button"
            onClick={() => setActive(category)}
            className="rounded-full px-3.5 py-1.5 text-[12.5px] font-medium transition-colors"
            style={{
              background: active === category ? 'var(--brand)' : 'var(--bg-panel)',
              color: active === category ? '#fff' : 'var(--text-muted)',
              border: `1px solid ${active === category ? 'var(--brand)' : 'var(--border)'}`,
            }}
          >
            {category}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {visible.map((template) => (
          <Link
            key={template.id}
            href={`/templates?use=${template.id}`}
            className="group rounded-2xl p-2 no-underline transition-all hover:-translate-y-1"
            style={{ border: '1px solid var(--border)', background: 'var(--bg-panel)' }}
          >
            <div className="grid place-items-center overflow-hidden rounded-xl" style={{ background: 'var(--bg-input)', minHeight: 168 }}>
              <TemplatePreview page={template.page} width={200} />
            </div>
            <div className="flex items-center justify-between px-1.5 pb-1 pt-2.5">
              <span className="truncate text-[12.5px] font-medium" style={{ color: 'var(--text)' }}>
                {template.name}
              </span>
              <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                {template.category}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
