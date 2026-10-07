import React, { Suspense } from 'react';
import { useUI } from '@/core/uiStore';
import { MediaPanel } from './MediaPanel';
import { AudioLibraryPanel } from './AudioLibraryPanel';
import { TextLibraryPanel } from './TextLibraryPanel';
import { CaptionsToolPanel } from './CaptionsToolPanel';
import { StickersPanel } from './StickersPanel';
import { EffectsLibraryPanel, FiltersLibraryPanel } from './EffectsLibraryPanel';
import { TransitionsLibraryPanel } from './TransitionsLibraryPanel';
import { TemplatesPanel } from './TemplatesPanel';
import { RecordPanel } from './RecordPanel';
import { AIPanel } from './AIPanel';
import { Spinner } from '../common';

export function LeftPanels() {
  const panel = useUI((s) => s.leftPanel);
  const open = useUI((s) => s.leftOpen);
  if (!open) return <aside className="panel collapsed" />;
  return (
    <aside className="panel">
      <Suspense fallback={<div className="panel-body"><Spinner /></div>}>
        {panel === 'media' && <MediaPanel />}
        {panel === 'audio' && <AudioLibraryPanel />}
        {panel === 'text' && <TextLibraryPanel />}
        {panel === 'captions' && <CaptionsToolPanel />}
        {panel === 'stickers' && <StickersPanel />}
        {panel === 'effects' && <EffectsLibraryPanel />}
        {panel === 'filters' && <FiltersLibraryPanel />}
        {panel === 'transitions' && <TransitionsLibraryPanel />}
        {panel === 'templates' && <TemplatesPanel />}
        {panel === 'record' && <RecordPanel />}
        {panel === 'ai' && <AIPanel />}
      </Suspense>
    </aside>
  );
}

export function PanelHeader({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="panel-header">
      <span>{title}</span>
      {sub && <span className="sub muted small" style={{ margin: 0, textTransform: 'none', letterSpacing: 0 }}>{sub}</span>}
      <span style={{ flex: 1 }} />
      {children}
    </div>
  );
}
