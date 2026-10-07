import { useCallback, useEffect, useRef } from 'react';
import { useUI, type LeftPanel } from '@/core/uiStore';
import { useProject } from '@/core/store';
import { TopBar } from './TopBar';
import { Preview } from '../preview/Preview';
import { Timeline } from '../timeline/Timeline';
import { Inspector } from '../inspector/Inspector';
import { LeftPanels } from '../panels/LeftPanels';
import { useEditorShortcuts } from '@/services/shortcuts';
import { Film, Music, Type, Sparkles, Shuffle, Smile, LayoutTemplate, Bot, Captions, Mic, Palette } from 'lucide-react';
import { Dialogs } from '../dialogs/Dialogs';
import { projectDuration } from '@/core/commands';
import { importFiles } from '@/engine/MediaManager';
import { toast } from '@/core/uiStore';
import { useDropFiles } from '../common';

const RAIL: { id: LeftPanel; label: string; icon: any; pro?: boolean }[] = [
  { id: 'media', label: 'Media', icon: Film },
  { id: 'audio', label: 'Audio', icon: Music },
  { id: 'text', label: 'Text', icon: Type },
  { id: 'captions', label: 'Captions', icon: Captions },
  { id: 'stickers', label: 'Stickers', icon: Smile },
  { id: 'effects', label: 'Effects', icon: Sparkles },
  { id: 'filters', label: 'Filters', icon: Palette },
  { id: 'transitions', label: 'Transitions', icon: Shuffle },
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
  { id: 'record', label: 'Record', icon: Mic },
  { id: 'ai', label: 'AI Tools', icon: Bot },
];

export function EditorShell() {
  const project = useProject((s) => s.project);
  const mode = useUI((s) => s.mode);
  const leftPanel = useUI((s) => s.leftPanel);
  const leftOpen = useUI((s) => s.leftOpen);
  const rightOpen = useUI((s) => s.rightOpen);
  const setLeftPanel = useUI((s) => s.setLeftPanel);
  const timelineRef = useRef<HTMLDivElement>(null);

  const zoomFit = useCallback(() => {
    const p = useProject.getState().project;
    if (!p) return;
    const dur = Math.max(1, projectDuration(p));
    const w = (timelineRef.current?.querySelector('.tl-scroll') as HTMLElement | null)?.clientWidth ?? 800;
    useUI.getState().setZoom((w - 40) / dur);
    useUI.getState().setScroll(0);
  }, []);

  useEditorShortcuts({ zoomFit });

  useEffect(() => {
    document.title = project ? `${project.name} — Neurio Studio` : 'Neurio Studio';
  }, [project?.name]);

  const drop = useDropFiles(async (files) => {
    const r = await importFiles(files);
    if (r.assets.length) toast(`Imported ${r.assets.length} file${r.assets.length > 1 ? 's' : ''}`, 'success');
    for (const e of r.errors) toast('Import failed', 'error', e);
  });

  if (!project) return <div className="loading-screen">No project loaded</div>;

  const rail = mode === 'beginner' ? RAIL.filter((r) => !['record'].includes(r.id)) : RAIL;

  return (
    <div className={`editor ${mode}`} {...drop.props}>
      <TopBar />
      <div className={`editor-main ${leftOpen ? '' : 'no-left'} ${rightOpen ? '' : 'no-right'}`}>
        <nav className="rail">
          {rail.map((r) => (
            <button
              key={r.id}
              className={leftOpen && leftPanel === r.id ? 'active' : ''}
              onClick={() => {
                if (leftOpen && leftPanel === r.id) useUI.getState().set({ leftOpen: false });
                else setLeftPanel(r.id);
              }}
              title={r.label}
            >
              <r.icon />
              <span>{r.label}</span>
            </button>
          ))}
        </nav>
        <LeftPanels />
        <Preview />
        <Inspector />
      </div>
      <div ref={timelineRef} style={{ minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        <Timeline zoomFit={zoomFit} />
      </div>
      <Dialogs />
      {drop.over && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(139,92,246,0.15)', border: '3px dashed var(--accent)', zIndex: 400, display: 'grid', placeItems: 'center', fontSize: 20, fontWeight: 700, pointerEvents: 'none' }}>Drop files to import</div>
      )}
    </div>
  );
}
