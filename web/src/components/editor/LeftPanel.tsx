'use client';

import { useState } from 'react';
import {
  LayoutTemplate,
  Shapes,
  Type,
  Upload,
  Palette,
  FileStack,
  BarChart3,
  Sparkles,
  Layers,
  ChevronLeft,
} from 'lucide-react';
import { useEditor } from '@/store/editor';
import { TemplatesPanel } from './panels/TemplatesPanel';
import { ElementsPanel } from './panels/ElementsPanel';
import { TextPanel } from './panels/TextPanel';
import { MediaPanel } from './panels/MediaPanel';
import { BrandPanel, type EditorBrandKit } from './panels/BrandPanel';
import { PagesPanel } from './panels/PagesPanel';
import { ChartsPanel } from './panels/ChartsPanel';
import { AIPanel } from './panels/AIPanel';
import { LayersPanel } from './panels/LayersPanel';

const TABS = [
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
  { id: 'elements', label: 'Elements', icon: Shapes },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'uploads', label: 'Uploads', icon: Upload },
  { id: 'brand', label: 'Brand', icon: Palette },
  { id: 'pages', label: 'Pages', icon: FileStack },
  { id: 'charts', label: 'Charts', icon: BarChart3 },
  { id: 'ai', label: 'AI', icon: Sparkles },
  { id: 'layers', label: 'Layers', icon: Layers },
] as const;

export type PanelId = (typeof TABS)[number]['id'];

export function LeftPanel({ brandKit }: { brandKit: EditorBrandKit | null }) {
  const panel = useEditor((s) => s.panel) as string;
  const setPanel = useEditor((s) => s.setPanel);
  const [width, setWidth] = useState(300);

  return (
    <aside
      className="flex shrink-0 border-e"
      style={{ width, borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}
      aria-label="Design tools"
    >
      <nav className="flex w-16 shrink-0 flex-col items-center gap-1 border-e py-2" style={{ borderColor: 'var(--border)' }}>
        {TABS.map((tab) => {
          const active = panel === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setPanel(active ? 'none' : tab.id)}
              title={tab.label}
              className="flex w-14 flex-col items-center gap-0.5 rounded-lg py-1.5 text-[9.5px] font-medium transition-colors"
              style={{ color: active ? 'var(--brand)' : 'var(--text-muted)', background: active ? 'var(--brand-soft)' : 'transparent' }}
            >
              <tab.icon size={17} />
              {tab.label}
            </button>
          );
        })}
      </nav>

      {panel !== 'none' ? (
        <div className="relative min-w-0 flex-1">
          <div className="h-full">{renderPanel(panel, brandKit)}</div>
          <button
            type="button"
            onClick={() => setPanel('none')}
            className="absolute end-1 top-1/2 grid h-7 w-5 place-items-center rounded-md"
            style={{ background: 'var(--bg-panel)', border: '1px solid var(--border)', color: 'var(--text-faint)' }}
            aria-label="Collapse panel"
          >
            <ChevronLeft size={12} />
          </button>
        </div>
      ) : null}
    </aside>
  );
}

function renderPanel(panel: string, brandKit: EditorBrandKit | null) {
  switch (panel) {
    case 'templates':
      return <TemplatesPanel />;
    case 'elements':
      return <ElementsPanel />;
    case 'text':
      return <TextPanel />;
    case 'uploads':
      return <MediaPanel />;
    case 'brand':
      return <BrandPanel kit={brandKit} />;
    case 'pages':
      return <PagesPanel vertical />;
    case 'charts':
      return <ChartsPanel />;
    case 'ai':
      return <AIPanel kit={brandKit} />;
    case 'layers':
      return <LayersPanel />;
    default:
      return null;
  }
}
