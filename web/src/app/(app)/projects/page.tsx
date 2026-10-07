'use client';

import { useCallback, useEffect, useState } from 'react';
import { FolderPlus, Search, Star, Trash2, Users, LayoutGrid, List, Loader2, Plus } from 'lucide-react';
import { api } from '@/lib/api-client';
import { ProjectCard, type ProjectItem } from '@/components/app/ProjectCard';
import { NewDesignModal } from '@/components/app/AppShell';
import { Button, EmptyState, SearchInput, Select, Toggle } from '@/components/ui';
import { useToast } from '@/components/ui/toast';

type Folder = { id: string; name: string; color: string | null };

export default function ProjectsPage() {
  const toast = useToast();
  const [items, setItems] = useState<ProjectItem[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const [sort, setSort] = useState<'updated' | 'created' | 'title'>('updated');
  const [favorite, setFavorite] = useState(false);
  const [trashed, setTrashed] = useState(false);
  const [shared, setShared] = useState(false);
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [loading, setLoading] = useState(true);
  const [newOpen, setNewOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        sort,
        limit: '60',
        ...(search ? { search } : {}),
        ...(kind !== 'all' ? { kind } : {}),
        ...(favorite ? { favorite: 'true' } : {}),
        ...(trashed ? { trashed: 'true' } : {}),
        ...(shared ? { shared: 'true' } : {}),
        ...(folderId ? { folderId } : folderId === null ? {} : { folderId: 'null' }),
      });
      const data = await api.get<{ items: ProjectItem[]; folders: Folder[] }>(`/api/projects?${params.toString()}`);
      setItems(data.items);
      setFolders(data.folders ?? []);
    } catch (error) {
      toast.error('Could not load projects', (error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [sort, search, kind, favorite, trashed, shared, folderId, toast]);

  useEffect(() => {
    const timer = window.setTimeout(load, 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function createFolder() {
    const name = window.prompt('Folder name');
    if (!name) return;
    try {
      const data = await api.post<{ folders: Folder[] }>('/api/folders', { name });
      setFolders(data.folders);
      toast.success('Folder created');
    } catch (error) {
      toast.error('Could not create the folder', (error as Error).message);
    }
  }

  async function removeFolder(id: string, name: string) {
    if (!window.confirm(`Delete the folder “${name}”? Designs inside move to All projects.`)) return;
    await api.del(`/api/folders/${id}`).catch((error) => toast.error('Delete failed', error.message));
    setFolderId(null);
    load();
  }

  async function emptyTrash() {
    if (!window.confirm('Permanently delete every design in the trash? This cannot be undone.')) return;
    for (const project of items) {
      await api.del(`/api/projects/${project.id}?permanent=true`).catch(() => undefined);
    }
    toast.success('Trash emptied');
    load();
  }

  return (
    <div className="mx-auto max-w-[1240px] px-5 py-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="m-0 text-[22px] font-bold tracking-tight">Projects</h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
            {items.length} {items.length === 1 ? 'design' : 'designs'}
            {trashed ? ' in trash' : ''} · folders, favourites and sharing
          </p>
        </div>
        <div className="flex items-center gap-2">
          {trashed ? (
            <Button variant="danger" icon={<Trash2 size={14} />} onClick={emptyTrash}>
              Empty trash
            </Button>
          ) : null}
          <Button variant="primary" icon={<Plus size={15} />} onClick={() => setNewOpen(true)}>
            New design
          </Button>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[200px_1fr]">
        {/* ------------------------------------------------------- folders */}
        <aside>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
              Folders
            </span>
            <button type="button" onClick={createFolder} className="grid h-6 w-6 place-items-center rounded-md" style={{ color: 'var(--text-muted)' }} aria-label="New folder">
              <FolderPlus size={14} />
            </button>
          </div>
          <div className="flex flex-col gap-0.5">
            {[
              { id: null, name: 'All projects' },
              ...folders.map((folder) => ({ id: folder.id, name: folder.name, color: folder.color })),
            ].map((folder) => (
              <div key={folder.id ?? 'all'} className="group flex items-center">
                <button
                  type="button"
                  onClick={() => setFolderId(folder.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-1.5 text-start text-[13px]"
                  style={{
                    background: folderId === folder.id ? 'var(--bg-active)' : 'transparent',
                    color: folderId === folder.id ? 'var(--text)' : 'var(--text-muted)',
                  }}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: (folder as { color?: string | null }).color ?? 'var(--brand)' }}
                  />
                  <span className="truncate">{folder.name}</span>
                </button>
                {folder.id ? (
                  <button
                    type="button"
                    onClick={() => removeFolder(folder.id!, folder.name)}
                    className="opacity-0 transition-opacity group-hover:opacity-100"
                    style={{ color: 'var(--text-faint)' }}
                    aria-label={`Delete ${folder.name}`}
                  >
                    <Trash2 size={12} />
                  </button>
                ) : null}
              </div>
            ))}
          </div>

          <div className="mt-6 flex flex-col gap-2.5 border-t pt-4" style={{ borderColor: 'var(--border)' }}>
            <ToggleRow label="Favourites only" checked={favorite} onChange={setFavorite} />
            <ToggleRow label="Shared with me" checked={shared} onChange={setShared} />
            <ToggleRow label="Trash" checked={trashed} onChange={setTrashed} />
          </div>
        </aside>

        {/* --------------------------------------------------------- list */}
        <section>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="min-w-[220px] flex-1">
              <SearchInput value={search} onChange={setSearch} placeholder="Search designs…" />
            </div>
            <Select
              value={kind}
              onChange={setKind}
              options={[
                { value: 'all', label: 'All types' },
                { value: 'design', label: 'Designs' },
                { value: 'presentation', label: 'Presentations' },
                { value: 'document', label: 'Documents' },
                { value: 'video', label: 'Videos' },
                { value: 'whiteboard', label: 'Whiteboards' },
              ]}
            />
            <Select
              value={sort}
              onChange={(value) => setSort(value as 'updated' | 'created' | 'title')}
              options={[
                { value: 'updated', label: 'Last modified' },
                { value: 'created', label: 'Date created' },
                { value: 'title', label: 'Name A–Z' },
              ]}
            />
            <div className="flex rounded-lg p-0.5" style={{ border: '1px solid var(--border)' }}>
              {(
                [
                  ['grid', LayoutGrid],
                  ['list', List],
                ] as const
              ).map(([id, Icon]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setView(id)}
                  className="grid h-7 w-8 place-items-center rounded-md"
                  style={{ background: view === id ? 'var(--bg-active)' : 'transparent', color: view === id ? 'var(--text)' : 'var(--text-muted)' }}
                  aria-label={id}
                >
                  <Icon size={14} />
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="grid place-items-center py-20">
              <Loader2 size={20} className="animate-spin" style={{ color: 'var(--brand)' }} />
            </div>
          ) : items.length === 0 ? (
            <div className="card">
              <EmptyState
                icon={<Search size={22} />}
                title="No designs here"
                description="Try another filter, or create a new design to get started."
                action={
                  <Button variant="primary" onClick={() => setNewOpen(true)}>
                    New design
                  </Button>
                }
              />
            </div>
          ) : view === 'grid' ? (
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-3 xl:grid-cols-4">
              {items.map((project) => (
                <ProjectCard key={project.id} project={project} onChanged={load} folders={folders} />
              ))}
            </div>
          ) : (
            <div className="card overflow-hidden p-0">
              <table className="w-full text-[13px]">
                <thead>
                  <tr style={{ color: 'var(--text-faint)', textAlign: 'start' }}>
                    <th className="px-4 py-2.5 text-start font-medium">Name</th>
                    <th className="px-4 py-2.5 text-start font-medium">Type</th>
                    <th className="px-4 py-2.5 text-start font-medium">Size</th>
                    <th className="px-4 py-2.5 text-start font-medium">Modified</th>
                    <th className="px-4 py-2.5 text-start font-medium">Owner</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((project) => (
                    <tr key={project.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td className="px-4 py-2.5">
                        <a href={`/design/${project.id}`} className="flex items-center gap-2 no-underline" style={{ color: 'var(--text)' }}>
                          {project.favorite ? <Star size={12} style={{ color: 'var(--warning)' }} /> : null}
                          {project.title}
                        </a>
                      </td>
                      <td className="px-4 py-2.5 capitalize" style={{ color: 'var(--text-muted)' }}>
                        {project.kind}
                      </td>
                      <td className="px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>
                        {project.width}×{project.height}
                      </td>
                      <td className="px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>
                        {new Date(project.updatedAt).toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5" style={{ color: 'var(--text-muted)' }}>
                        <span className="flex items-center gap-1.5">
                          {project.role && project.role !== 'OWNER' ? <Users size={12} /> : null}
                          {project.ownerName ?? 'You'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>

      <NewDesignModal open={newOpen} onClose={() => setNewOpen(false)} />
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
      <span>{label}</span>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </label>
  );
}
