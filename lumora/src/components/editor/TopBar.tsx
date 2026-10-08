import React, { useState } from 'react';
import { engine } from '@/editor/engine';
import { useEditor } from '@/state/editorStore';
import { useApp } from '@/state/appStore';
import { Icon } from '@/components/common/Icons';
import { bridge } from '@/lib/bridge';

export function TopBar() {
  const { project, dirty, saving, canUndo, canRedo } = useEditor();
  const setExport = useEditor((s) => s.setExport);
  const setPreview = useEditor((s) => s.setPreview);
  const rename = useEditor((s) => s.renameProject);
  const save = useEditor((s) => s.save);
  const sync = useEditor((s) => s.syncFromEngine);
  const { online, go, toast } = useApp();
  const [editingName, setEditingName] = useState(false);

  const share = async () => {
    if (!project) return;
    try {
      const file = await bridge.projects.exportFile(project.id, project.name);
      if (file) toast(`Shareable project file saved to ${file}`, 'success');
    } catch (err) {
      toast(`Could not share project: ${(err as Error).message}`, 'error');
    }
  };

  return (
    <div className="topbar">
      <button className="btn ghost" title="Home" onClick={() => go('home')}>
        <Icon name="home" size={16} />
      </button>
      <div className="brand">
        <span className="logo" />
        <span>Lumora</span>
      </div>
      <div style={{ width: 1, height: 22, background: 'var(--line)', margin: '0 4px' }} />

      {editingName ? (
        <input
          className="input"
          style={{ width: 230 }}
          autoFocus
          defaultValue={project?.name}
          onBlur={(e) => {
            rename(e.target.value.trim() || 'Untitled design');
            setEditingName(false);
          }}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      ) : (
        <button className="btn ghost" onClick={() => setEditingName(true)} title="Rename project">
          <strong>{project?.name ?? 'Untitled design'}</strong>
          {dirty ? <span className="muted">•</span> : null}
        </button>
      )}

      <div className="spacer" />

      <button className="btn icon" disabled={!canUndo} title="Undo (Ctrl+Z)" onClick={() => void engine.undo().then(sync)}>
        <Icon name="undo" size={16} />
      </button>
      <button className="btn icon" disabled={!canRedo} title="Redo (Ctrl+Shift+Z)" onClick={() => void engine.redo().then(sync)}>
        <Icon name="redo" size={16} />
      </button>
      <button className="btn icon" title="Duplicate (Ctrl+D)" onClick={() => void engine.duplicateSelection()}>
        <Icon name="copy" size={16} />
      </button>
      <button className="btn icon" title="Delete (Del)" onClick={() => engine.deleteSelection()}>
        <Icon name="trash" size={16} />
      </button>

      <div style={{ width: 1, height: 22, background: 'var(--line)', margin: '0 4px' }} />

      <span className={`pill ${online ? 'ok' : 'off'}`} title={online ? 'Cloud AI features available' : 'Working offline'}>
        {online ? 'AI Online' : 'Offline Mode'}
      </span>

      <button className="btn" onClick={() => setPreview(true)} title="Preview (Ctrl+P)">
        <Icon name="play" size={14} /> Preview
      </button>
      <button className="btn" onClick={share} title="Share project file">
        <Icon name="share" size={14} /> Share
      </button>
      <button className="btn" onClick={() => void save()} disabled={saving} title="Save (Ctrl+S)">
        <Icon name="save" size={14} /> {saving ? 'Saving…' : 'Save'}
      </button>
      <button className="btn primary" onClick={() => setExport(true)} title="Export (Ctrl+E)">
        <Icon name="download" size={14} /> Export
      </button>
      <button className="btn icon" title="Settings" onClick={() => go('settings')}>
        <Icon name="settings" size={16} />
      </button>
    </div>
  );
}
