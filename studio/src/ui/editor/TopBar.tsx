import { useEffect, useState } from 'react';
import { useProject } from '@/core/store';
import { useUI } from '@/core/uiStore';
import { Home, Undo2, Redo2, Download, Settings, Keyboard, PanelLeft, PanelRight, Save, ChevronDown } from 'lucide-react';
import { saveCurrent, exportProjectFile } from '@/services/projects';
import { SOCIAL_PRESETS } from '@/core/defaults';
import { ContextMenu } from '../common';

export function TopBar() {
  const project = useProject((s) => s.project)!;
  const dirty = useProject((s) => s.dirty);
  const canUndo = useProject((s) => s.past.length > 0);
  const canRedo = useProject((s) => s.future.length > 0);
  const undoLabel = useProject((s) => s.past[s.past.length - 1]?.label);
  const redoLabel = useProject((s) => s.future[0]?.label);
  const mode = useUI((s) => s.mode);
  const leftOpen = useUI((s) => s.leftOpen);
  const rightOpen = useUI((s) => s.rightOpen);
  const [name, setName] = useState(project.name);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => setName(project.name), [project.name]);
  const preset = SOCIAL_PRESETS.find((p) => p.id === project.settings.presetId);

  return (
    <header className="topbar">
      <button className="icon-btn" title="Back to home" onClick={async () => {
        await saveCurrent();
        useUI.getState().navigate({ name: 'home' });
      }}>
        <Home size={18} />
      </button>
      <div className="brand">
        <div className="brand-mark">N</div>
        <span style={{ display: 'none' }}>Neurio</span>
      </div>
      <input
        className="project-name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => name.trim() && name !== project.name && useProject.getState().rename(name.trim())}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        title="Project name"
      />
      <button className="btn ghost sm" onClick={(e) => setMenu({ x: e.clientX, y: e.clientY + 10 })} title="Project settings">
        {project.settings.width}×{project.settings.height} · {project.settings.fps}fps {preset ? `· ${preset.label}` : ''} <ChevronDown size={12} />
      </button>
      <span className={`save-state ${dirty ? 'dirty' : ''}`}>{dirty ? 'Unsaved changes' : 'Saved'}</span>
      <div className="spacer" />
      <button className="icon-btn" disabled={!canUndo} onClick={() => useProject.getState().undo()} title={canUndo ? `Undo ${undoLabel} (Ctrl+Z)` : 'Undo'}>
        <Undo2 size={17} />
      </button>
      <button className="icon-btn" disabled={!canRedo} onClick={() => useProject.getState().redo()} title={canRedo ? `Redo ${redoLabel} (Ctrl+Shift+Z)` : 'Redo'}>
        <Redo2 size={17} />
      </button>
      <div className="seg sm" title="Beginner mode hides advanced tools; Pro mode shows everything">
        <button className={mode === 'beginner' ? 'active' : ''} onClick={() => useUI.getState().setMode('beginner')}>
          Beginner
        </button>
        <button className={mode === 'pro' ? 'active' : ''} onClick={() => useUI.getState().setMode('pro')}>
          Pro
        </button>
      </div>
      <button className={`icon-btn ${leftOpen ? 'active' : ''}`} onClick={() => useUI.getState().set({ leftOpen: !leftOpen })} title="Toggle left panel">
        <PanelLeft size={17} />
      </button>
      <button className={`icon-btn ${rightOpen ? 'active' : ''}`} onClick={() => useUI.getState().set({ rightOpen: !rightOpen })} title="Toggle inspector">
        <PanelRight size={17} />
      </button>
      <button className="icon-btn" onClick={() => useUI.getState().openDialog({ kind: 'shortcuts' })} title="Keyboard shortcuts (?)">
        <Keyboard size={17} />
      </button>
      <button className="icon-btn" onClick={() => useUI.getState().openDialog({ kind: 'settings' })} title="Project settings">
        <Settings size={17} />
      </button>
      <button className="btn sm" onClick={() => void saveCurrent().then(() => useUI.getState().toast({ title: 'Project saved', kind: 'success', timeout: 1500 }))} title="Save (Ctrl+S)">
        <Save size={14} /> Save
      </button>
      <button className="btn primary sm" onClick={() => useUI.getState().openDialog({ kind: 'export' })} title="Export (Ctrl+E)">
        <Download size={14} /> Export
      </button>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          items={[
            { label: 'Project settings…', onClick: () => useUI.getState().openDialog({ kind: 'settings' }) },
            'sep',
            { label: 'Export project file (.neurio.json)', onClick: () => void exportProjectFile(project, false) },
            { label: 'Export project with media…', onClick: () => void exportProjectFile(project, true) },
          ]}
        />
      )}
    </header>
  );
}
