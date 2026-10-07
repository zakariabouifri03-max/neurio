'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, Film, FileStack } from 'lucide-react';
import type { DesignDoc } from '@/engine/types';
import { useEditor } from '@/store/editor';
import { useAutosave } from '@/hooks/useAutosave';
import { useShortcuts, SHORTCUT_HELP } from '@/hooks/useShortcuts';
import { useToast } from '@/components/ui/toast';
import { CanvasStage } from './canvas/CanvasStage';
import { TopBar } from './TopBar';
import { LeftPanel } from './LeftPanel';
import { Inspector } from './Inspector';
import { Timeline } from './Timeline';
import { PresentMode } from './PresentMode';
import { ExportDialog } from './dialogs/ExportDialog';
import { ShareDialog } from './dialogs/ShareDialog';
import { ResizeDialog } from './dialogs/ResizeDialog';
import { VersionsDialog } from './dialogs/VersionsDialog';
import { CommentsPanel } from './dialogs/CommentsPanel';
import { ImageEditorModal } from './dialogs/ImageEditorModal';
import { Modal } from '@/components/ui';
import { PagesPanel } from './panels/PagesPanel';
import { subscribeImageEdit, type ImageEditAction } from './imageEditBus';
import { pageThumbnail } from '@/engine/export';
import { loadFontsForDocument } from '@/data/fonts';
import { collectFonts } from '@/components/template/TemplatePreview';
import type { EditorBrandKit } from './panels/BrandPanel';

export type EditorShellProps = {
  projectId: string;
  initialDoc: DesignDoc;
  version: number;
  role: string;
  visibility: string;
  shareSlug: string | null;
  brandKit: EditorBrandKit | null;
};

export function EditorShell({ projectId, initialDoc, version, role, visibility, brandKit }: EditorShellProps) {
  const toast = useToast();
  const readOnly = role === 'VIEWER';

  const doc = useEditor((s) => s.doc);
  const saving = useEditor((s) => s.saving);
  const activePage = useEditor((s) => s.activePage);
  const bottomPanel = useEditor((s) => s.bottomPanel);
  const setBottomPanel = useEditor((s) => s.setBottomPanel);
  const presenting = useEditor((s) => s.presenting);
  const setPresenting = useEditor((s) => s.setPresenting);

  const [dialog, setDialog] = useState<'export' | 'share' | 'resize' | 'versions' | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentCount, setCommentCount] = useState(0);
  const [imageEdit, setImageEdit] = useState<{ action: ImageEditAction | null; nodeId: string | null } | null>(null);

  const thumbnailRef = useRef<string | null>(null);
  const saveRef = useRef<(reason?: 'debounce' | 'manual' | 'unload') => Promise<void>>(async () => undefined);

  /* --------------------------------------------------------- initialisation */
  useEffect(() => {
    const store = useEditor.getState();
    if (store.projectId !== projectId) {
      store.setProject(projectId, initialDoc, version);
    }
    loadFontsForDocument(collectFonts(initialDoc.pages.flatMap((page) => page.nodes)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  /* -------------------------------------------------------------- thumbnails */
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const page = useEditor.getState().doc.pages[useEditor.getState().activePage];
      if (!page) return;
      pageThumbnail(page, 480)
        .then((dataUrl) => {
          thumbnailRef.current = dataUrl;
        })
        .catch(() => undefined);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [doc, activePage]);

  // Stable callback: autosave reads the latest thumbnail through the ref.
  const thumbnailProvider = useCallback(() => thumbnailRef.current, []);
  const { save } = useAutosave(projectId, thumbnailProvider);
  saveRef.current = save;

  /* --------------------------------------------------------------- shortcuts */
  const handlers = useMemo(
    () => ({
      onExport: () => setDialog('export'),
      onShare: () => setDialog('share'),
      onResize: () => setDialog('resize'),
      onSave: () => {
        void saveRef.current('manual').then(() => toast.success('Saved', 'A version snapshot was created'));
      },
      onDelete: () => {
        const state = useEditor.getState();
        if (state.selection.length) state.deleteNodes(state.selection);
      },
    }),
    [toast],
  );
  useShortcuts(handlers);

  /* ------------------------------------------------------------ image editor */
  useEffect(
    () =>
      subscribeImageEdit((action) => {
        const state = useEditor.getState();
        const id = state.selection[0];
        if (!id) {
          toast.info('Select an image first');
          return;
        }
        setImageEdit({ action, nodeId: id });
      }),
    [toast],
  );

  useEffect(() => {
    const onFit = () => window.dispatchEvent(new CustomEvent('prism:fit-request'));
    window.addEventListener('prism:fit', onFit);
    return () => window.removeEventListener('prism:fit', onFit);
  }, []);

  const onRequestUpload = useCallback(
    async (files: FileList) => {
      if (readOnly) return;
      const { upload } = await import('@/lib/api-client');
      const { createImage } = await import('@/engine/factory');
      const state = useEditor.getState();
      const page = state.doc.pages[state.activePage];
      if (!page) return;
      for (const file of [...files]) {
        try {
          const asset = (await upload('/api/upload', file)) as { url: string; width?: number | null; height?: number | null };
          const node = createImage(asset.url, {
            name: file.name,
            width: Math.min(page.width * 0.6, 800),
            height: Math.min(page.width * 0.6, 800) * 0.7,
            natural: asset.width && asset.height ? { width: asset.width, height: asset.height } : undefined,
          });
          node.x = (page.width - node.width) / 2;
          node.y = (page.height - node.height) / 2;
          state.addNode(node, { label: `Add ${file.name}` });
        } catch (error) {
          toast.error('Upload failed', (error as Error).message);
        }
      }
    },
    [readOnly, toast],
  );

  const selectedNode = useEditor((s) => {
    const page = s.doc.pages[s.activePage];
    if (!page) return null;
    return page.nodes.find((node) => node.id === s.selection[0]) ?? null;
  });

  const showTimeline = doc.kind === 'video' || bottomPanel === 'timeline' || (doc.timeline?.tracks ?? []).some((track) => track.clips.length > 0);

  if (presenting) {
    return <PresentMode onExit={() => setPresenting(false)} />;
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden" style={{ background: 'var(--canvas-bg)' }}>
      <TopBar
        onExport={() => setDialog('export')}
        onShare={() => setDialog('share')}
        onResize={() => setDialog('resize')}
        onVersions={() => setDialog('versions')}
        onShortcuts={() => setShortcutsOpen(true)}
        onPresent={() => setPresenting(true)}
        onToggleComments={() => setCommentsOpen((value) => !value)}
        commentsOpen={commentsOpen}
        commentCount={commentCount}
        saving={saving}
        readOnly={readOnly}
      />

      <div className="flex min-h-0 flex-1">
        <LeftPanel brandKit={brandKit} />

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <CanvasStage onRequestUpload={onRequestUpload} onDropElement={() => undefined} />
          </div>

          {/* ------------------------------------------------ bottom dock */}
          <div
            className="flex shrink-0 items-stretch border-t"
            style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)', height: showTimeline ? 240 : 96 }}
          >
            <div className="flex w-[120px] shrink-0 flex-col gap-1 border-e p-2" style={{ borderColor: 'var(--border)' }}>
              <button
                type="button"
                onClick={() => setBottomPanel('pages')}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11.5px]"
                style={{
                  background: bottomPanel !== 'timeline' ? 'var(--bg-active)' : 'transparent',
                  color: bottomPanel !== 'timeline' ? 'var(--text)' : 'var(--text-muted)',
                }}
              >
                <FileStack size={13} /> Pages
              </button>
              <button
                type="button"
                onClick={() => setBottomPanel('timeline')}
                className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11.5px]"
                style={{
                  background: bottomPanel === 'timeline' ? 'var(--bg-active)' : 'transparent',
                  color: bottomPanel === 'timeline' ? 'var(--text)' : 'var(--text-muted)',
                }}
              >
                <Film size={13} /> Timeline
              </button>
            </div>

            <div className="min-w-0 flex-1 overflow-x-auto p-2">
              {showTimeline ? <Timeline /> : <PagesPanel />}
            </div>
          </div>
        </div>

        <Inspector onResize={() => setDialog('resize')} readOnly={readOnly} />

        {commentsOpen ? (
          <CommentsPanel open={commentsOpen} onClose={() => setCommentsOpen(false)} onCountChange={setCommentCount} />
        ) : null}
      </div>

      {/* ------------------------------------------------------------ dialogs */}
      <ExportDialog open={dialog === 'export'} onClose={() => setDialog(null)} />
      <ShareDialog open={dialog === 'share'} onClose={() => setDialog(null)} visibility={visibility} role={role} />
      <ResizeDialog open={dialog === 'resize'} onClose={() => setDialog(null)} />
      <VersionsDialog open={dialog === 'versions'} onClose={() => setDialog(null)} />
      <ImageEditorModal
        open={!!imageEdit}
        initialAction={imageEdit?.action ?? null}
        node={imageEdit?.nodeId === selectedNode?.id ? selectedNode : null}
        onClose={() => setImageEdit(null)}
      />

      <Modal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} title="Keyboard shortcuts" width={560}>
        <div className="grid gap-1.5 p-5 sm:grid-cols-2">
          {SHORTCUT_HELP.map((shortcut) => (
            <div key={shortcut.keys} className="flex items-center justify-between gap-3 text-[12.5px]">
              <span style={{ color: 'var(--text-muted)' }}>{shortcut.description}</span>
              <span className="kbd">{shortcut.keys}</span>
            </div>
          ))}
        </div>
        <div className="border-t px-5 py-3" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-1.5 text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
            <Keyboard size={12} /> Shortcuts are ignored while typing in a text field.
          </div>
        </div>
      </Modal>

      {readOnly ? (
        <div
          className="pointer-events-none fixed bottom-4 start-1/2 z-[8000] -translate-x-1/2 rounded-full px-4 py-1.5 text-[12px]"
          style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
        >
          You have view-only access
        </div>
      ) : null}
    </div>
  );
}
