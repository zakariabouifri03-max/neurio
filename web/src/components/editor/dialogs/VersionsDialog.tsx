'use client';

import { useCallback, useEffect, useState } from 'react';
import { History, RotateCcw, Loader2, Download } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useEditor } from '@/store/editor';
import { Button, EmptyState, Modal } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import type { DesignDoc, Page } from '@/engine/types';
import { defaultDocSettings } from '@/engine/types';

type Version = {
  id: string;
  number: number;
  label: string | null;
  auto: boolean;
  creatorName: string | null;
  createdAt: number;
};

export function VersionsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const setDoc = useEditor((s) => s.setDoc);
  const toast = useToast();
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [restoring, setRestoring] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ versions: Version[] }>(`/api/projects/${doc.id}/versions`);
      setVersions(data.versions);
    } catch (error) {
      toast.error('Could not load versions', (error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [doc.id, toast]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  async function restore(version: Version) {
    if (!window.confirm(`Restore version ${version.number}? Your current canvas is saved as a new version first.`)) return;
    setRestoring(version.id);
    try {
      const data = await api.get<{ snapshot: { pages?: any[]; settings?: any } }>(`/api/projects/${doc.id}/versions/${version.id}`);
      const pages = (data.snapshot?.pages ?? []) as Page[];
      if (!pages.length) throw new Error('Snapshot has no pages');
      const next: DesignDoc = {
        ...doc,
        width: pages[0]!.width,
        height: pages[0]!.height,
        pages,
        settings: { ...defaultDocSettings(), ...(data.snapshot?.settings ?? {}) },
      };
      setDoc(next, { resetHistory: false });
      toast.success(`Restored version ${version.number}`);
      onClose();
    } catch (error) {
      toast.error('Restore failed', (error as Error).message);
    } finally {
      setRestoring(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Version history" width={560}>
      <div className="p-5">
        <p className="mb-4 mt-0 text-[12.5px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Snapshots are taken automatically every 10 saves and whenever you press{' '}
          <strong style={{ color: 'var(--text)' }}>Ctrl/⌘ + S</strong>. Restoring never destroys work — the current state is
          saved first.
        </p>

        {loading ? (
          <div className="grid place-items-center py-12">
            <Loader2 size={18} className="animate-spin" style={{ color: 'var(--brand)' }} />
          </div>
        ) : versions.length === 0 ? (
          <EmptyState icon={<History size={20} />} title="No versions yet" description="Save the design to create the first snapshot." />
        ) : (
          <div className="flex flex-col gap-1.5">
            {versions.map((version) => (
              <div
                key={version.id}
                className="flex items-center gap-3 rounded-xl px-3 py-2.5"
                style={{ border: '1px solid var(--border)', background: 'var(--bg-panel)' }}
              >
                <span
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-[11px] font-bold"
                  style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}
                >
                  v{version.number}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12.5px] font-medium" style={{ color: 'var(--text)' }}>
                    {version.label ?? (version.auto ? 'Autosave' : 'Manual save')}
                  </div>
                  <div className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                    {new Date(version.createdAt).toLocaleString()} · {version.creatorName ?? 'You'}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  loading={restoring === version.id}
                  icon={<RotateCcw size={12} />}
                  onClick={() => restore(version)}
                >
                  Restore
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="mt-4 flex justify-end">
          <Button size="sm" variant="ghost" icon={<Download size={12} />} onClick={load}>
            Refresh
          </Button>
        </div>
      </div>
    </Modal>
  );
}
