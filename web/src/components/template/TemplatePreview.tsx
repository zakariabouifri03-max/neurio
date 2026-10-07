'use client';

/**
 * Renders a real page (or template) with the same node renderer used in the
 * editor — so every thumbnail you see anywhere in the product is the actual,
 * editable design, not a bitmap placeholder.
 */
import { useMemo } from 'react';
import type { Page, SceneNode } from '@/engine/types';
import { NodeView } from '@/components/editor/canvas/NodeView';
import { loadFontsForDocument } from '@/data/fonts';

export type TemplatePreviewProps = {
  page: Page | null | undefined;
  width?: number;
  className?: string;
  radius?: number;
  background?: string;
};

export function TemplatePreview({ page, width = 240, className, radius = 10, background }: TemplatePreviewProps) {
  const scale = page ? width / page.width : 1;
  const height = page ? page.height * scale : width;

  useMemo(() => {
    if (!page) return;
    loadFontsForDocument(collectFonts(page.nodes));
  }, [page]);

  if (!page) {
    return (
      <div className={className} style={{ width, height: height || width, borderRadius: radius, background: 'var(--bg-input)' }} />
    );
  }

  return (
    <div
      className={className}
      style={{
        width,
        height,
        overflow: 'hidden',
        borderRadius: radius,
        background: background ?? page.background.color,
        position: 'relative',
        contain: 'paint',
      }}
      aria-hidden
    >
      <div
        style={{
          width: page.width,
          height: page.height,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          position: 'absolute',
          inset: 0,
        }}
      >
        {page.background.paint ? (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: pageBackgroundCss(page),
            }}
          />
        ) : null}
        {page.nodes.map((node) => (
          <NodeView key={node.id} node={node} mode="thumb" zoom={scale} />
        ))}
      </div>
    </div>
  );
}

function pageBackgroundCss(page: Page): string {
  const paint = page.background.paint;
  if (!paint) return page.background.color;
  if (paint.type === 'gradient') {
    const stops = paint.stops.map((s) => `${s.color} ${Math.round(s.offset * 100)}%`).join(', ');
    return paint.kind === 'radial'
      ? `radial-gradient(circle at 50% 50%, ${stops})`
      : `linear-gradient(${paint.angle}deg, ${stops})`;
  }
  if (paint.type === 'image') return `url(${paint.src}) center/cover no-repeat`;
  return paint.color;
}

export function collectFonts(nodes: SceneNode[]): string[] {
  const out = new Set<string>();
  const walk = (list: SceneNode[]) => {
    for (const node of list) {
      if (node.type === 'text' && node.style?.fontFamily) out.add(node.style.fontFamily);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(nodes);
  return [...out];
}
