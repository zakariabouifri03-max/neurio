'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { UploadCloud, Search, Trash2, Star, Loader2, Image as ImageIcon, Film, Music, FileText, Type, Copy, Check } from 'lucide-react';
import { api, upload } from '@/lib/api-client';
import { Button, EmptyState, SearchInput, Select, ProgressBar } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { formatBytes } from '@/components/app/AppShell';

type Asset = {
  id: string;
  kind: string;
  name: string;
  url: string;
  mime: string;
  size: number;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  favorite?: boolean;
  tags?: string[];
  createdAt: number;
};

const KIND_ICONS: Record<string, any> = { image: ImageIcon, video: Film, audio: Music, font: Type, document: FileText };

export default function MediaPage() {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [kind, setKind] = useState('all');
  const [favorite, setFavorite] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        ...(search ? { search } : {}),
        ...(kind !== 'all' ? { kind } : {}),
        ...(favorite ? { favorite: 'true' } : {}),
      });
      const data = await api.get<{ items: Asset[] }>(`/api/media?${params.toString()}`);
      setItems(data.items);
    } catch (error) {
      toast.error('Could not load media', (error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [search, kind, favorite, toast]);

  useEffect(() => {
    const timer = window.setTimeout(load, 180);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function uploadFiles(files: FileList | File[]) {
    const list = [...files];
    if (!list.length) return;
    for (const file of list) {
      setProgress(0);
      try {
        await upload('/api/upload', file, {}, setProgress);
        toast.success('Uploaded', file.name);
      } catch (error) {
        toast.error('Upload failed', (error as Error).message);
      }
    }
    setProgress(null);
    load();
  }

  async function remove(asset: Asset) {
    if (!window.confirm(`Delete “${asset.name}”?`)) return;
    try {
      await api.del(`/api/media/${asset.id}`);
      toast.success('Deleted');
      load();
    } catch (error) {
      toast.error('Delete failed', (error as Error).message);
    }
  }

  async function toggleFavorite(asset: Asset) {
    await api
      .patch(`/api/media/${asset.id}`, { favorite: !asset.favorite })
      .then(load)
      .catch((error) => toast.error('Update failed', error.message));
  }

  async function copyLink(asset: Asset) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${asset.url}`);
      setCopied(asset.id);
      window.setTimeout(() => setCopied(null), 1600);
    } catch {
      toast.info('Copy failed', asset.url);
    }
  }

  return (
    <div className="mx-auto max-w-[1240px] px-5 py-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-[22px] font-bold tracking-tight">Media library</h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
            {items.length} assets · images, video, audio, fonts and documents
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-[220px]">
            <SearchInput value={search} onChange={setSearch} placeholder="Search media…" />
          </div>
          <Select
            value={kind}
            onChange={setKind}
            options={[
              { value: 'all', label: 'All types' },
              { value: 'image', label: 'Images' },
              { value: 'video', label: 'Videos' },
              { value: 'audio', label: 'Audio' },
              { value: 'font', label: 'Fonts' },
              { value: 'document', label: 'Documents' },
            ]}
          />
          <label className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[13px]" style={{ background: 'var(--bg-active)', color: 'var(--text-muted)' }}>
            <Star size={13} />
            <input type="checkbox" checked={favorite} onChange={(event) => setFavorite(event.target.checked)} />
            Favourites
          </label>
          <Button variant="primary" icon={<UploadCloud size={15} />} onClick={() => inputRef.current?.click()}>
            Upload
          </Button>
          <input
            ref={inputRef}
            type="file"
            multiple
            hidden
            onChange={(event) => event.target.files && uploadFiles(event.target.files)}
          />
        </div>
      </div>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (event.dataTransfer.files?.length) uploadFiles(event.dataTransfer.files);
        }}
        className="mt-5 rounded-2xl border-2 border-dashed p-6 text-center transition-colors"
        style={{ borderColor: dragging ? 'var(--brand)' : 'var(--border)', background: dragging ? 'var(--brand-soft)' : 'transparent' }}
      >
        <UploadCloud size={22} style={{ color: 'var(--text-muted)' }} />
        <p className="mb-0 mt-2 text-[13.5px]" style={{ color: 'var(--text-muted)' }}>
          Drag files here, or{' '}
          <button type="button" onClick={() => inputRef.current?.click()} style={{ color: 'var(--brand)' }} className="bg-transparent">
            browse your device
          </button>
        </p>
        <p className="mb-0 mt-1 text-[11.5px]" style={{ color: 'var(--text-faint)' }}>
          Images, SVG, video, audio, PDF and font files. Stored through the configured storage driver (local disk by default, S3 compatible with credentials).
        </p>
        {progress !== null ? (
          <div className="mx-auto mt-3 max-w-[320px]">
            <ProgressBar value={progress} label="Uploading" />
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="grid place-items-center py-20">
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--brand)' }} />
        </div>
      ) : items.length === 0 ? (
        <div className="card mt-6">
          <EmptyState
            icon={<ImageIcon size={22} />}
            title="No media yet"
            description="Upload images, video, audio or fonts — they become available inside every design."
            action={
              <Button variant="primary" onClick={() => inputRef.current?.click()}>
                Upload files
              </Button>
            }
          />
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {items.map((asset) => {
            const Icon = KIND_ICONS[asset.kind] ?? FileText;
            return (
              <div key={asset.id} className="group overflow-hidden rounded-xl" style={{ border: '1px solid var(--border)', background: 'var(--bg-panel)' }}>
                <div className="relative grid aspect-square place-items-center" style={{ background: 'var(--bg-input)' }}>
                  {asset.kind === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" loading="lazy" />
                  ) : asset.kind === 'video' ? (
                    <video src={asset.url} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                  ) : (
                    <Icon size={28} style={{ color: 'var(--text-faint)' }} />
                  )}

                  <div className="absolute inset-x-0 bottom-0 flex justify-end gap-1.5 bg-gradient-to-t from-black/70 to-transparent p-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <button type="button" onClick={() => copyLink(asset)} className="grid h-7 w-7 place-items-center rounded-md" style={{ background: 'rgba(0,0,0,.5)', color: '#fff' }} aria-label="Copy link">
                      {copied === asset.id ? <Check size={13} /> : <Copy size={13} />}
                    </button>
                    <button type="button" onClick={() => toggleFavorite(asset)} className="grid h-7 w-7 place-items-center rounded-md" style={{ background: 'rgba(0,0,0,.5)', color: asset.favorite ? 'var(--warning)' : '#fff' }} aria-label="Favourite">
                      <Star size={13} fill={asset.favorite ? 'currentColor' : 'none'} />
                    </button>
                    <button type="button" onClick={() => remove(asset)} className="grid h-7 w-7 place-items-center rounded-md" style={{ background: 'rgba(0,0,0,.5)', color: '#fff' }} aria-label="Delete">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <div className="p-2.5">
                  <div className="truncate text-[12.5px] font-medium" style={{ color: 'var(--text)' }}>
                    {asset.name}
                  </div>
                  <div className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
                    {formatBytes(asset.size)}
                    {asset.width && asset.height ? ` · ${asset.width}×${asset.height}` : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
