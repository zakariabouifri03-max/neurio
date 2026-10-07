'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ArrowLeft,
  Undo2,
  Redo2,
  ZoomIn,
  ZoomOut,
  Maximize,
  Share2,
  Download,
  Play,
  MessageSquare,
  History,
  Scan,
  MoreHorizontal,
  Copy,
  Trash2,
  Keyboard,
  Loader2,
  Cloud,
  CloudOff,
  Grid3x3,
  Ruler,
  Magnet,
  Lock,
} from 'lucide-react';
import { useEditor } from '@/store/editor';
import { Button, IconButton, Tooltip } from '@/components/ui';
import { api } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';

export type TopBarProps = {
  onExport: () => void;
  onShare: () => void;
  onResize: () => void;
  onVersions: () => void;
  onShortcuts: () => void;
  onPresent: () => void;
  onToggleComments: () => void;
  commentsOpen: boolean;
  commentCount: number;
  saving: boolean;
  readOnly: boolean;
};

export function TopBar({
  onExport,
  onShare,
  onResize,
  onVersions,
  onShortcuts,
  onPresent,
  onToggleComments,
  commentsOpen,
  commentCount,
  saving,
  readOnly,
}: TopBarProps) {
  const doc = useEditor((s) => s.doc);
  const version = useEditor((s) => s.version);
  const lastSavedAt = useEditor((s) => s.lastSavedAt);
  const dirty = useEditor((s) => s.dirty);
  const viewport = useEditor((s) => s.viewport);
  const history = useEditor((s) => s.history);
  const snapEnabled = useEditor((s) => s.snapEnabled);
  const gridVisible = useEditor((s) => s.gridVisible);
  const rulersVisible = useEditor((s) => s.rulersVisible);

  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const zoomTo = useEditor((s) => s.zoomTo);
  const toggleSnap = useEditor((s) => s.toggleSnap);
  const toggleGrid = useEditor((s) => s.toggleGrid);
  const toggleRulers = useEditor((s) => s.toggleRulers);

  const toast = useToast();
  const [title, setTitle] = useState(doc.title);
  const [menu, setMenu] = useState(false);

  // `rev` bumps on every committed mutation, so history depth re-reads here.
  useEditor((s) => s.rev);
  const canUndo = history.canUndo();
  const canRedo = history.canRedo();

  async function commitTitle() {
    if (title === doc.title || !title.trim()) return;
    const previous = doc.title;
    useEditor.setState((state) => ({ doc: { ...state.doc, title }, dirty: true }));
    try {
      await api.patch(`/api/projects/${doc.id}`, { title });
    } catch (error) {
      useEditor.setState((state) => ({ doc: { ...state.doc, title: previous } }));
      setTitle(previous);
      toast.error('Rename failed', (error as Error).message);
    }
  }

  return (
    <header
      className="flex h-14 shrink-0 items-center gap-2 border-b px-3"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}
    >
      <Link href="/home" className="grid h-9 w-9 place-items-center rounded-lg no-underline hover:bg-[var(--bg-hover)]" aria-label="Back to dashboard">
        <ArrowLeft size={16} style={{ color: 'var(--text-muted)' }} />
      </Link>

      <div className="min-w-0">
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          onBlur={commitTitle}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          }}
          disabled={readOnly}
          className="w-[200px] rounded-lg bg-transparent px-2 py-1 text-[13.5px] font-semibold outline-none transition-colors hover:bg-[var(--bg-hover)] focus:bg-[var(--bg-input)]"
          style={{ color: 'var(--text)', border: '1px solid transparent' }}
          aria-label="Design title"
        />
        <div className="flex items-center gap-1.5 px-2 text-[11px]" style={{ color: 'var(--text-faint)' }}>
          {saving ? (
            <>
              <Loader2 size={11} className="animate-spin" /> Saving…
            </>
          ) : dirty ? (
            <>
              <CloudOff size={11} /> Unsaved changes
            </>
          ) : (
            <>
              <Cloud size={11} /> Saved{lastSavedAt ? ` · ${new Date(lastSavedAt).toLocaleTimeString()}` : ''} · v{version}
            </>
          )}
          {readOnly ? (
            <span className="flex items-center gap-1" style={{ color: 'var(--warning)' }}>
              <Lock size={10} /> read-only
            </span>
          ) : null}
        </div>
      </div>

      <div className="mx-2 h-6 w-px" style={{ background: 'var(--border)' }} />

      <div className="flex items-center gap-0.5">
        <IconButton icon={<Undo2 size={15} />} label="Undo" onClick={undo} disabled={!canUndo || readOnly} />
        <IconButton icon={<Redo2 size={15} />} label="Redo" onClick={redo} disabled={!canRedo || readOnly} />
      </div>

      <div className="flex items-center gap-0.5 rounded-lg px-1 py-0.5" style={{ border: '1px solid var(--border)' }}>
        <IconButton icon={<ZoomOut size={14} />} label="Zoom out" size={28} onClick={() => zoomTo(Math.max(0.05, viewport.zoom / 1.2))} />
        <button
          type="button"
          onClick={() => zoomTo(1)}
          className="w-12 text-center text-[12px] tabular-nums"
          style={{ color: 'var(--text-muted)' }}
          title="Reset to 100%"
        >
          {Math.round(viewport.zoom * 100)}%
        </button>
        <IconButton icon={<ZoomIn size={14} />} label="Zoom in" size={28} onClick={() => zoomTo(Math.min(8, viewport.zoom * 1.2))} />
        <IconButton icon={<Maximize size={14} />} label="Fit to screen" size={28} onClick={() => window.dispatchEvent(new CustomEvent('prism:fit'))} />
      </div>

      <div className="hidden items-center gap-0.5 lg:flex">
        <IconButton icon={<Magnet size={15} />} label="Snap to objects" active={snapEnabled} onClick={toggleSnap} />
        <IconButton icon={<Grid3x3 size={15} />} label="Show grid" active={gridVisible} onClick={toggleGrid} />
        <IconButton icon={<Ruler size={15} />} label="Show rulers" active={rulersVisible} onClick={toggleRulers} />
      </div>

      <div className="ms-auto flex items-center gap-2">
        <IconButton
          icon={<MessageSquare size={15} />}
          label="Comments"
          active={commentsOpen}
          onClick={onToggleComments}
        />
        {commentCount > 0 ? (
          <span
            className="-ms-3 grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-bold"
            style={{ background: 'var(--brand)', color: '#fff' }}
          >
            {commentCount}
          </span>
        ) : null}

        <IconButton icon={<History size={15} />} label="Version history" onClick={onVersions} />
        <IconButton icon={<Scan size={15} />} label="Resize design" onClick={onResize} />

        {doc.kind === 'presentation' ? (
          <Tooltip tip="Present (Ctrl/⌘ + Enter)">
            <IconButton icon={<Play size={15} />} label="Present" onClick={onPresent} />
          </Tooltip>
        ) : null}

        <Button variant="secondary" icon={<Share2 size={14} />} onClick={onShare} size="sm">
          Share
        </Button>
        <Button variant="primary" icon={<Download size={14} />} onClick={onExport} size="sm">
          Export
        </Button>

        <div className="relative">
          <IconButton icon={<MoreHorizontal size={15} />} label="More" onClick={() => setMenu((v) => !v)} />
          {menu ? (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
              <div
                className="absolute end-0 top-11 z-50 w-52 overflow-hidden rounded-xl py-1"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-pop)' }}
              >
                <MenuItem icon={<Keyboard size={13} />} label="Keyboard shortcuts" onClick={() => { setMenu(false); onShortcuts(); }} />
                <MenuItem
                  icon={<Copy size={13} />}
                  label="Duplicate design"
                  onClick={async () => {
                    setMenu(false);
                    try {
                      const project = await api.post<{ id: string }>(`/api/projects/${doc.id}/duplicate`);
                      window.open(`/design/${project.id}`, '_blank');
                    } catch (error) {
                      toast.error('Duplicate failed', (error as Error).message);
                    }
                  }}
                />
                <MenuItem
                  icon={<Trash2 size={13} />}
                  label="Move to trash"
                  danger
                  onClick={async () => {
                    setMenu(false);
                    if (!window.confirm('Move this design to the trash?')) return;
                    await api.del(`/api/projects/${doc.id}`).catch((error) => toast.error('Delete failed', error.message));
                    window.location.href = '/projects';
                  }}
                />
              </div>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}

function MenuItem({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-2 text-start text-[12.5px] hover:bg-[var(--bg-hover)]"
      style={{ color: danger ? 'var(--danger)' : 'var(--text-muted)' }}
    >
      {icon}
      {label}
    </button>
  );
}
