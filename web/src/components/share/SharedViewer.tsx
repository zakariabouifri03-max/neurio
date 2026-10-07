'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Download, Loader2 } from 'lucide-react';
import type { Page } from '@/engine/types';
import { NodeView } from '@/components/editor/canvas/NodeView';
import { exportPageImage, downloadBlob, safeFilename } from '@/engine/export';
import { loadFontsForDocument } from '@/data/fonts';
import { collectFonts } from '@/components/template/TemplatePreview';

/** Read-only, responsive viewer for shared designs (desktop and mobile). */
export function SharedViewer({ pages, title }: { pages: Page[]; title: string }) {
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [exporting, setExporting] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const page = pages[index];

  useEffect(() => {
    loadFontsForDocument(pages.flatMap((item) => collectFonts(item.nodes)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const fit = () => {
      const el = containerRef.current;
      if (!el || !page) return;
      setZoom(Math.min((el.clientWidth - 48) / page.width, (el.clientHeight - 48) / page.height, 1));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [page, index]);

  if (!page) {
    return (
      <div className="grid flex-1 place-items-center" style={{ color: 'var(--text-muted)' }}>
        This design has no pages.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <div ref={containerRef} className="flex flex-1 items-center justify-center overflow-auto p-6">
        <div
          className="relative shrink-0 overflow-hidden rounded-lg shadow-2xl"
          style={{ width: page.width * zoom, height: page.height * zoom, background: page.background.color }}
        >
          <div
            style={{
              width: page.width,
              height: page.height,
              transform: `scale(${zoom})`,
              transformOrigin: 'top left',
              position: 'absolute',
            }}
          >
            {page.nodes.map((node) => (
              <NodeView key={node.id} node={node} mode="present" />
            ))}
          </div>
        </div>
      </div>

      <div
        className="flex items-center justify-center gap-3 border-t py-3"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}
      >
        <button
          type="button"
          onClick={() => setIndex((value) => Math.max(0, value - 1))}
          disabled={index === 0}
          className="grid h-9 w-9 place-items-center rounded-lg disabled:opacity-40"
          style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
          {index + 1} / {pages.length}
        </span>
        <button
          type="button"
          onClick={() => setIndex((value) => Math.min(pages.length - 1, value + 1))}
          disabled={index === pages.length - 1}
          className="grid h-9 w-9 place-items-center rounded-lg disabled:opacity-40"
          style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
          aria-label="Next page"
        >
          <ChevronRight size={16} />
        </button>

        <div className="mx-3 h-5 w-px" style={{ background: 'var(--border)' }} />

        <button
          type="button"
          onClick={() => setZoom((value) => Math.max(0.1, value / 1.2))}
          className="grid h-9 w-9 place-items-center rounded-lg"
          style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
          aria-label="Zoom out"
        >
          <ZoomOut size={15} />
        </button>
        <span className="w-12 text-center text-[12px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => setZoom((value) => Math.min(4, value * 1.2))}
          className="grid h-9 w-9 place-items-center rounded-lg"
          style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
          aria-label="Zoom in"
        >
          <ZoomIn size={15} />
        </button>

        <button
          type="button"
          disabled={exporting}
          onClick={async () => {
            setExporting(true);
            try {
              const blob = await exportPageImage(page, { format: 'png', scale: 2 });
              downloadBlob(blob, `${safeFilename(title)}-${index + 1}.png`);
            } finally {
              setExporting(false);
            }
          }}
          className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-[12.5px]"
          style={{ border: '1px solid var(--border)', color: 'var(--text-muted)' }}
        >
          {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />} Download PNG
        </button>
      </div>
    </div>
  );
}
