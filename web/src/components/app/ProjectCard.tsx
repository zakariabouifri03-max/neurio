'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MoreHorizontal, Star, Copy, Trash2, FolderInput, Pencil, Loader2 } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useToast } from '@/components/ui/toast';

export type ProjectItem = {
  id: string;
  title: string;
  kind: string;
  width: number;
  height: number;
  thumbnail?: string | null;
  favorite?: boolean;
  trashed?: boolean;
  visibility?: string;
  folderId?: string | null;
  updatedAt: number;
  createdAt: number;
  pageCount?: number;
  role?: string;
  ownerName?: string;
};

export function timeAgo(timestamp: number): string {
  const seconds = Math.max(1, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export function ProjectCard({
  project,
  onChanged,
  folders = [],
}: {
  project: ProjectItem;
  onChanged?: () => void;
  folders?: { id: string; name: string }[];
}) {
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(project.title);
  // Relative timestamps are computed after mount to avoid hydration drift.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  async function act(fn: () => Promise<unknown>, message: string) {
    setBusy(true);
    try {
      await fn();
      toast.success(message);
      onChanged?.();
    } catch (error) {
      toast.error('Action failed', (error as Error).message);
    } finally {
      setBusy(false);
      setMenu(false);
    }
  }

  return (
    <div className="group relative">
      <Link href={`/design/${project.id}`} className="block no-underline">
        <div
          className="relative overflow-hidden rounded-xl transition-transform group-hover:-translate-y-0.5"
          style={{ border: '1px solid var(--border)', background: 'var(--bg-panel)', aspectRatio: '4 / 3' }}
        >
          {project.thumbnail ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={project.thumbnail} alt={project.title} className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="grid h-full w-full place-items-center" style={{ background: 'var(--bg-input)' }}>
              <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                {project.width}×{project.height}
              </span>
            </div>
          )}
          {busy ? (
            <div className="absolute inset-0 grid place-items-center" style={{ background: 'rgba(0,0,0,.45)' }}>
              <Loader2 size={18} className="animate-spin" style={{ color: '#fff' }} />
            </div>
          ) : null}
        </div>
      </Link>

      <div className="mt-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => {
                setRenaming(false);
                if (title !== project.title) act(() => api.patch(`/api/projects/${project.id}`, { title }), 'Renamed');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
                if (event.key === 'Escape') {
                  setTitle(project.title);
                  setRenaming(false);
                }
              }}
              className="w-full rounded-md px-1.5 py-0.5 text-[13px]"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
            />
          ) : (
            <Link href={`/design/${project.id}`} className="block truncate text-[13px] font-medium no-underline" style={{ color: 'var(--text)' }}>
              {project.title}
            </Link>
          )}
          <div className="flex items-center gap-1.5 text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
            <span>{mounted ? timeAgo(project.updatedAt) : '—'}</span>
            <span>·</span>
            <span className="capitalize">{project.kind}</span>
            {project.pageCount ? (
              <>
                <span>·</span>
                <span>
                  {project.pageCount} {project.pageCount === 1 ? 'page' : 'pages'}
                </span>
              </>
            ) : null}
          </div>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenu((v) => !v)}
            className="grid h-7 w-7 place-items-center rounded-md opacity-0 transition-opacity group-hover:opacity-100"
            style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
            aria-label="Project actions"
          >
            <MoreHorizontal size={14} />
          </button>
          {menu ? (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenu(false)} />
              <div
                className="absolute end-0 top-8 z-50 w-48 overflow-hidden rounded-xl py-1"
                style={{ background: 'var(--bg-elevated)', border: '1px solid var(--border)', boxShadow: 'var(--shadow-pop)' }}
              >
                <MenuItemRow icon={<Pencil size={13} />} label="Rename" onClick={() => { setMenu(false); setRenaming(true); }} />
                <MenuItemRow
                  icon={<Star size={13} />}
                  label={project.favorite ? 'Remove from favourites' : 'Add to favourites'}
                  onClick={() => act(() => api.patch(`/api/projects/${project.id}`, { favorite: !project.favorite }), 'Updated')}
                />
                <MenuItemRow
                  icon={<Copy size={13} />}
                  label="Duplicate"
                  onClick={() => act(() => api.post(`/api/projects/${project.id}/duplicate`), 'Duplicated')}
                />
                {folders.length ? (
                  <div className="border-t px-3 py-1.5" style={{ borderColor: 'var(--border)' }}>
                    <div className="mb-1 flex items-center gap-1.5 text-[11px] uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
                      <FolderInput size={12} /> Move to
                    </div>
                    <select
                      className="w-full rounded-md px-1.5 py-1 text-[12px]"
                      style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
                      value={project.folderId ?? ''}
                      onChange={(event) =>
                        act(() => api.patch(`/api/projects/${project.id}`, { folderId: event.target.value || null }), 'Moved')
                      }
                    >
                      <option value="">No folder</option>
                      {folders.map((folder) => (
                        <option key={folder.id} value={folder.id}>
                          {folder.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : null}
                <MenuItemRow
                  icon={<Trash2 size={13} />}
                  label={project.trashed ? 'Restore' : 'Move to trash'}
                  danger
                  onClick={() =>
                    act(() => api.patch(`/api/projects/${project.id}`, { trashed: !project.trashed }), project.trashed ? 'Restored' : 'Moved to trash')
                  }
                />
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MenuItemRow({
  icon,
  label,
  onClick,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
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
