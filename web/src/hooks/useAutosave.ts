'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useEditor } from '@/store/editor';
import { api } from '@/lib/api-client';

/**
 * Autosave.
 *
 * Debounced (1.2 s) with a 10 s heartbeat while dirty, plus a safety flush on
 * visibility change and unload. Saves run off the render path: the editor keeps
 * responding at 60 fps while a large document is written.
 */
export function useAutosave(projectId: string | null, thumbnailProvider?: () => string | null) {
  const dirty = useEditor((s) => s.dirty);
  const saving = useEditor((s) => s.saving);
  const doc = useEditor((s) => s.doc);
  const timer = useRef<number | null>(null);
  const inFlight = useRef(false);
  const lastSnapshot = useRef<string>('');

  const save = useCallback(
    async (reason: 'debounce' | 'manual' | 'unload' = 'debounce') => {
      if (!projectId || inFlight.current) return;
      const state = useEditor.getState();
      if (!state.dirty && reason !== 'manual') return;

      const pages = state.doc.pages.map((page) => ({
        id: page.id,
        name: page.name,
        width: page.width,
        height: page.height,
        background: page.background,
        nodes: page.nodes,
        meta: { ...(page.meta ?? {}), notes: page.notes ?? '' },
      }));

      const snapshot = JSON.stringify(pages) + JSON.stringify(state.doc.settings) + JSON.stringify(state.doc.timeline ?? null);
      if (snapshot === lastSnapshot.current && reason !== 'manual') {
        state.setDirty(false);
        return;
      }

      inFlight.current = true;
      state.setSaving(true);
      try {
        const data = (await api.post(`/api/projects/${projectId}/save`, {
          pages,
          settings: state.doc.settings,
          thumbnail: thumbnailProvider?.() ?? undefined,
          createVersion: reason === 'manual',
          versionLabel: reason === 'manual' ? 'Manual save' : undefined,
        })) as { version: number; savedAt: number };
        lastSnapshot.current = snapshot;
        state.markSaved(data.version);
      } catch (error) {
        console.error('[autosave] failed', error);
        state.setSaving(false);
      } finally {
        inFlight.current = false;
      }
    },
    [projectId, thumbnailProvider],
  );

  // Debounce on document changes.
  useEffect(() => {
    if (!dirty || !projectId) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => save('debounce'), 1200);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [dirty, doc, projectId, save]);

  // Heartbeat: guarantee a save at least every 10 s while editing.
  useEffect(() => {
    if (!projectId) return;
    const id = window.setInterval(() => {
      if (useEditor.getState().dirty) save('debounce');
    }, 10_000);
    return () => window.clearInterval(id);
  }, [projectId, save]);

  // Flush before the tab goes away.
  useEffect(() => {
    const onHide = () => {
      if (useEditor.getState().dirty) save('unload');
    };
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (useEditor.getState().dirty) {
        event.preventDefault();
        event.returnValue = '';
        save('unload');
      }
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [save]);

  return { save, saving };
}
