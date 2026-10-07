'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Loader2, Plus, Shapes } from 'lucide-react';
import { ELEMENT_CATEGORIES, searchElements, subcategories, type LibraryElement } from '@/data/elements';
import { SearchInput, Button, EmptyState } from '@/components/ui';
import { createSvg } from '@/engine/factory';
import { addAtViewCenter, freshNode } from '../insert';
import { useEditor } from '@/store/editor';
import { CURATED_PALETTES } from '@/engine/color';

const PALETTE = CURATED_PALETTES[0]!.colors;

export function ElementsPanel() {
  const [category, setCategory] = useState<string>('ALL');
  const [sub, setSub] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<LibraryElement[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(80);
  const requestId = useRef(0);

  const addNode = useEditor((s) => s.addNode);
  const doc = useEditor((s) => s.doc);
  const activePage = useEditor((s) => s.activePage);

  const search = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    try {
      const result = await searchElements({
        category: (category === 'ALL' ? undefined : category) as LibraryElement['category'] | undefined,
        subcategory: sub ?? undefined,
        search: query || undefined,
        limit,
      });
      if (id === requestId.current) {
        setItems(result.items);
        setTotal(result.total);
      }
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [category, sub, query, limit]);

  useEffect(() => {
    const timer = window.setTimeout(search, 160);
    return () => window.clearTimeout(timer);
  }, [search]);

  const subs = useMemo(() => (category === 'ALL' ? [] : subcategories(category as LibraryElement['category'])), [category]);

  function insert(element: LibraryElement) {
    const page = doc.pages[activePage];
    if (!page) return;
    const svg = element.svg
      .replace(/currentColor/g, PALETTE[2]!)
      .replace(/#2D3436/gi, PALETTE[2]!)
      .replace(/#6C5CE7/gi, PALETTE[0]!);
    const node = freshNode(
      createSvg(svg, {
        name: element.name,
        width: element.width,
        height: element.height,
        x: 0,
        y: 0,
      }),
    );
    const max = Math.min(page.width * 0.5, 420);
    const ratio = element.height / Math.max(1, element.width);
    const width = element.width > max ? max : element.width;
    node.width = width;
    node.height = width * ratio;
    node.x = Math.round((page.width - node.width) / 2);
    node.y = Math.round((page.height - node.height) / 2);
    addNode(node, { label: `Add ${element.name}` });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <SearchInput value={query} onChange={setQuery} placeholder="Search 1,600+ elements…" autoFocus />
      </div>

      <div className="flex flex-wrap gap-1 px-3 pb-2">
        <Chip active={category === 'ALL'} onClick={() => { setCategory('ALL'); setSub(null); }}>
          All
        </Chip>
        {ELEMENT_CATEGORIES.map((item) => (
          <Chip
            key={item.id}
            active={category === item.id}
            onClick={() => {
              setCategory(item.id);
              setSub(null);
            }}
            title={item.hint}
          >
            {item.id}
          </Chip>
        ))}
      </div>

      {subs.length ? (
        <div className="flex flex-wrap gap-1 px-3 pb-2">
          <Chip active={!sub} onClick={() => setSub(null)}>
            Any
          </Chip>
          {subs.slice(0, 14).map((item) => (
            <Chip key={item} active={sub === item} onClick={() => setSub(item)}>
              {item}
            </Chip>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between px-3 pb-2 text-[11px]" style={{ color: 'var(--text-faint)' }}>
        <span>{loading ? 'Searching…' : `${total.toLocaleString()} elements`}</span>
        <span>click to insert</span>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {loading && items.length === 0 ? (
          <div className="grid place-items-center py-12">
            <Loader2 size={18} className="animate-spin" style={{ color: 'var(--brand)' }} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={<Shapes size={20} />} title="No elements found" description="Try a different search term." />
        ) : (
          <>
            <div className="grid grid-cols-3 gap-2">
              {items.map((element) => (
                <button
                  key={element.id}
                  type="button"
                  onClick={() => insert(element)}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData('application/x-prism-element', element.svg);
                    event.dataTransfer.effectAllowed = 'copy';
                  }}
                  className="group grid aspect-square place-items-center rounded-lg p-2 transition-transform hover:-translate-y-0.5"
                  style={{ border: '1px solid var(--border)', background: 'var(--bg-panel)' }}
                  title={element.name}
                >
                  <span
                    className="pointer-events-none grid h-full w-full place-items-center [&>svg]:h-full [&>svg]:w-full"
                    dangerouslySetInnerHTML={{ __html: element.svg }}
                  />
                </button>
              ))}
            </div>
            {items.length < total ? (
              <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={() => setLimit((value) => value + 80)}>
                <Plus size={13} /> Load more
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}

function Chip({
  children,
  active,
  onClick,
  title,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick: () => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className="rounded-full px-2.5 py-1 text-[11.5px] font-medium transition-colors"
      style={{
        background: active ? 'var(--brand)' : 'var(--bg-panel)',
        color: active ? '#fff' : 'var(--text-muted)',
        border: `1px solid ${active ? 'var(--brand)' : 'var(--border)'}`,
      }}
    >
      {children}
    </button>
  );
}
