import { useState } from 'react';
import { useEditor, history } from '../store/editorStore';
import { useExport } from '../store/exportStore';
import { Icons } from './Icons';
import { brand, windowTitle } from '../../brand';
import { PROJECT_EXTENSION } from '../../version';
import { getBridge } from '../../core/bridge';
import { clsx } from 'clsx';

/**
 * Top toolbar: project identity, file actions, undo/redo, export.
 *
 * Every button here is wired. Anything not implemented yet is rendered with the
 * "Coming soon" treatment rather than silently doing nothing.
 */

export function Toolbar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const project = useEditor((s) => s.project);
  const dirty = useEditor((s) => s.dirty);
  const projectPath = useEditor((s) => s.projectPath);
  const busy = useEditor((s) => s.busy);
  const activePanel = useEditor((s) => s.activePanel);
  const { newProject, openProjectDialog, saveProjectDialog, addTextLayer, setActivePanel } = useEditor.getState();
  const { openDialog } = useExport.getState();
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState(project.name);

  const commitRename = () => {
    const name = draftName.trim() || project.name;
    // Renaming is document metadata, not a timeline edit, so it must not push a
    // history entry: undo should never resurrect an old project name.
    useEditor.setState((state) => ({
      project: { ...state.project, name, updatedAt: Date.now() },
      dirty: true,
    }));
    setRenaming(false);
  };

  const fileName = projectPath ? projectPath.split(/[\\/]/).pop() : `${project.name}.${PROJECT_EXTENSION}`;

  return (
    <div className="shrink-0 h-11 flex items-center gap-1 px-2 border-b border-ink-800 bg-ink-900">
      {/* Brand */}
      <div className="flex items-center gap-2 pr-2 mr-1 border-r border-ink-800 h-7">
        <div className="w-6 h-6 rounded-md bg-brand-600/25 border border-brand-500/50 flex items-center justify-center text-brand-300 text-[12px] font-bold">
          {brand.monogram}
        </div>
        <span className="text-[12px] font-semibold tracking-wide text-ink-100 hidden sm:block">{brand.name}</span>
      </div>

      {/* Project name */}
      <div className="flex items-center gap-1.5 min-w-0">
        {renaming ? (
          <input
            className="field h-7 text-[12px] w-48"
            value={draftName}
            autoFocus
            onChange={(e) => setDraftName(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') {
                setDraftName(project.name);
                setRenaming(false);
              }
            }}
          />
        ) : (
          <button
            className="flex items-center gap-1.5 px-1.5 h-7 rounded-md hover:bg-ink-800 min-w-0"
            onClick={() => {
              setDraftName(project.name);
              setRenaming(true);
            }}
            title="Rename project"
          >
            <span className="text-[12px] text-ink-200 truncate max-w-[200px]">{project.name}</span>
            <span className="text-[9px] text-ink-500 mono">{fileName}</span>
            {dirty && <span className="w-1.5 h-1.5 rounded-full bg-accent-warm" title="Unsaved changes" />}
          </button>
        )}
      </div>

      <span className="w-px h-5 bg-ink-800 mx-1" />

      {/* File */}
      <button className="btn h-7 px-2" onClick={newProject} title="New project">
        <Icons.Plus size={13} />
        <span className="hidden lg:inline">New</span>
      </button>
      <button className="btn h-7 px-2" onClick={() => void openProjectDialog()} title="Open project">
        <Icons.Folder size={13} />
        <span className="hidden lg:inline">Open</span>
      </button>
      <button className="btn h-7 px-2" onClick={() => void saveProjectDialog()} title="Save (Ctrl+S)">
        <Icons.Save size={13} />
        <span className="hidden lg:inline">Save</span>
      </button>

      <span className="w-px h-5 bg-ink-800 mx-1" />

      {/* History */}
      <HistoryButtons />

      <span className="w-px h-5 bg-ink-800 mx-1" />

      {/* Panels */}
      <button
        className={clsx('icon-btn h-7 px-2 gap-1.5', activePanel === 'ai' && 'icon-btn-on')}
        onClick={() => setActivePanel(activePanel === 'ai' ? 'media' : 'ai')}
        title="AI editor"
      >
        <Icons.Sparkle size={14} className="text-brand-400" />
        <span className="text-[11px]">AI</span>
      </button>

      <div className="ml-auto flex items-center gap-1">
        {busy && (
          <span className="text-[10px] text-ink-400 flex items-center gap-1.5 mr-2">
            <span className="w-2 h-2 rounded-full bg-brand-400 animate-pulse-soft" />
            {busy.label}
            {busy.fraction > 0 && ` ${Math.round(busy.fraction * 100)}%`}
          </span>
        )}
        <RuntimeBadge />
        <button
          className="btn h-7 px-2"
          onClick={() => addTextLayer()}
          title="Add a text layer at the playhead"
        >
          <Icons.Type size={13} />
          <span className="hidden xl:inline">Text</span>
        </button>
        <button className="btn-primary h-7 px-3" onClick={() => openDialog()} title="Export (Ctrl+E)">
          <Icons.Export size={13} />
          Export
        </button>
        <button className="icon-btn w-8 h-8" onClick={onOpenSettings} title="Settings">
          <Icons.Settings size={15} />
        </button>
      </div>

      <span className="sr-only">{windowTitle(project.name, dirty)}</span>
    </div>
  );
}

function HistoryButtons() {
  const { undo, redo, canUndo, canRedo } = useEditor.getState();
  const undoLabel = history.undoLabel;
  const redoLabel = history.redoLabel;
  return (
    <>
      <button className="btn h-7 px-2" onClick={undo} disabled={!canUndo()} title={undoLabel ? `Undo ${undoLabel}` : 'Undo'}>
        <Icons.Undo size={13} />
        <span className="hidden lg:inline truncate max-w-[110px]">{undoLabel ?? 'Undo'}</span>
      </button>
      <button className="btn h-7 px-2" onClick={redo} disabled={!canRedo()} title={redoLabel ? `Redo ${redoLabel}` : 'Redo'}>
        <Icons.Redo size={13} />
        <span className="hidden lg:inline truncate max-w-[110px]">{redoLabel ?? 'Redo'}</span>
      </button>
    </>
  );
}

function RuntimeBadge() {
  const capabilities = useEditor((s) => s.capabilities);
  if (!capabilities) return null;
  const bridge = getBridge();
  if (bridge.kind === 'tauri' && capabilities.ffmpeg) return null;
  return (
    <span
      className="chip border-accent-warm/50 text-accent-warm bg-accent-warm/10 mr-1"
      title={
        capabilities.ffmpeg
          ? 'Desktop runtime ready.'
          : 'Browser build: no FFmpeg. Preview, editing and WebM export work; MP4/H.264 export needs the desktop app.'
      }
    >
      {capabilities.ffmpeg ? 'Desktop' : 'Browser build'}
    </span>
  );
}
