'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { UploadCloud, Search, Loader2, Sparkles, Trash2, Image as ImageIcon, Film, Music, Type } from 'lucide-react';
import { api, upload } from '@/lib/api-client';
import { Button, EmptyState, SearchInput, ProgressBar } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { useEditor } from '@/store/editor';
import { createImage, createVideo, createSticker, uid } from '@/engine/factory';
import { addAtViewCenter } from '../insert';
import { registerUploadedFont } from '@/data/fonts';
import { generateArtwork } from '@/engine/ai-art';
import { SPARK_ICONS } from '@/components/editor/panels/spark-icons';

type Asset = {
  id: string;
  kind: string;
  name: string;
  url: string;
  mime: string;
  size: number;
  width?: number | null;
  height?: number | null;
  createdAt: number;
};

export function MediaPanel() {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [progress, setProgress] = useState<number | null>(null);
  const [aiPrompt, setAiPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const doc = useEditor((s) => s.doc);
  const activePage = useEditor((s) => s.activePage);
  const page = doc.pages[activePage];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ items: Asset[] }>(`/api/media${query ? `?search=${encodeURIComponent(query)}` : ''}`);
      setItems(data.items);
    } catch (error) {
      toast.error('Could not load media', (error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [query, toast]);

  useEffect(() => {
    const timer = window.setTimeout(load, 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function handleFiles(files: FileList) {
    for (const file of [...files]) {
      setProgress(0);
      try {
        const asset = await upload('/api/upload', file, {}, setProgress);
        if (file.type.startsWith('font/') || /\.(ttf|otf|woff2?)$/i.test(file.name)) {
          const family = file.name.replace(/\.(ttf|otf|woff2?)$/i, '');
          await registerUploadedFont(family, asset.url);
          toast.success('Font registered', family);
        } else {
          insertAsset(asset as Asset);
        }
      } catch (error) {
        toast.error('Upload failed', (error as Error).message);
      }
    }
    setProgress(null);
    load();
  }

  function insertAsset(asset: Asset, urlOverride?: string) {
    if (!page) return;
    const url = urlOverride ?? asset.url;
    if (asset.kind === 'video') {
      const node = createVideo(url, { name: asset.name, width: page.width * 0.6, height: (page.width * 0.6 * 9) / 16 });
      addAtViewCenter(node, 'Add video');
      return;
    }
    if (asset.kind === 'font' || asset.kind === 'document') {
      toast.info('Fonts and documents are available in the text and document tools', asset.name);
      return;
    }
    const node = createImage(url, {
      name: asset.name,
      width: Math.min(page.width * 0.6, 700),
      height: Math.min(page.width * 0.6, 700) * (asset.height && asset.width ? asset.height / asset.width : 0.7),
      natural: asset.width && asset.height ? { width: asset.width, height: asset.height } : undefined,
    });
    addAtViewCenter(node, 'Add image');
  }

  async function generateAiArt() {
    if (!aiPrompt.trim() || !page) return;
    setGenerating(true);
    try {
      const result = await api.post<{ images?: { url: string }[]; dataUrl?: string }>('/api/ai/image', {
        prompt: aiPrompt,
        size: '1024x1024',
        style: 'auto',
        count: 2,
      });
      const urls = result.images?.map((image) => image.url) ?? (result.dataUrl ? [result.dataUrl] : []);
      if (!urls.length) throw new Error('No image returned');
      for (const url of urls) {
        const node = createImage(url, { name: `AI · ${aiPrompt.slice(0, 40)}`, width: page.width * 0.5, height: page.width * 0.5 });
        addAtViewCenter(node, 'Add AI image');
      }
      toast.success('AI image added');
      load();
    } catch (error) {
      // Offline fallback: the built-in procedural generator always works.
      const svg = generateArtwork(aiPrompt, { width: 1024, height: 1024 });
      const node = createSticker(svg, { name: `AI · ${aiPrompt.slice(0, 40)}`, width: page.width * 0.5, height: page.width * 0.5 });
      node.id = uid('svg');
      addAtViewCenter(node, 'Add AI artwork');
      toast.info('Generated with the offline engine', (error as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function removeAsset(asset: Asset) {
    if (!window.confirm(`Delete “${asset.name}”?`)) return;
    await api.del(`/api/media/${asset.id}`).catch((error) => toast.error('Delete failed', error.message));
    load();
  }

  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <SearchInput value={query} onChange={setQuery} placeholder="Search your media…" />
      </div>

      <div className="px-3 pb-2">
        <div className="flex gap-2">
          <input type="file" multiple hidden ref={inputRef} onChange={(event) => event.target.files && handleFiles(event.target.files)} />
          <div
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (event.dataTransfer.files?.length) handleFiles(event.dataTransfer.files);
            }}
            className="flex-1 rounded-xl border-2 border-dashed p-3 text-center"
            style={{ borderColor: 'var(--border)' }}
          >
            <UploadCloud size={18} style={{ color: 'var(--text-muted)' }} />
            <div className="mt-1 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
              Drop files or{' '}
              <button type="button" onClick={() => inputRef.current?.click()} style={{ color: 'var(--brand)' }} className="bg-transparent">
                upload
              </button>
            </div>
          </div>
        </div>
        {progress !== null ? (
          <div className="mt-2">
            <ProgressBar value={progress} label="Uploading" />
          </div>
        ) : null}
      </div>

      <div className="px-3 pb-3">
        <div className="flex gap-2">
          <input
            value={aiPrompt}
            onChange={(event) => setAiPrompt(event.target.value)}
            placeholder="Describe an image to generate…"
            className="field flex-1"
            onKeyDown={(event) => {
              if (event.key === 'Enter') generateAiArt();
            }}
          />
          <Button variant="primary" size="sm" loading={generating} icon={<Sparkles size={13} />} onClick={generateAiArt}>
            Gen
          </Button>
        </div>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-3 pb-4">
        {loading ? (
          <div className="grid place-items-center py-12">
            <Loader2 size={18} className="animate-spin" style={{ color: 'var(--brand)' }} />
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={<ImageIcon size={20} />} title="No media yet" description="Upload images, video, audio or fonts to reuse them across designs." />
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {items.map((asset) => (
              <div key={asset.id} className="group relative overflow-hidden rounded-lg" style={{ border: '1px solid var(--border)' }}>
                <button type="button" onClick={() => insertAsset(asset)} className="block w-full" title={asset.name}>
                  {asset.kind === 'image' ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={asset.url} alt={asset.name} className="aspect-square w-full object-cover" loading="lazy" />
                  ) : asset.kind === 'video' ? (
                    <video src={asset.url} className="aspect-square w-full object-cover" muted playsInline preload="metadata" />
                  ) : (
                    <div className="grid aspect-square place-items-center" style={{ background: 'var(--bg-input)' }}>
                      {asset.kind === 'audio' ? (
                        <Music size={18} style={{ color: 'var(--text-faint)' }} />
                      ) : asset.kind === 'font' ? (
                        <Type size={18} style={{ color: 'var(--text-faint)' }} />
                      ) : (
                        <Film size={18} style={{ color: 'var(--text-faint)' }} />
                      )}
                    </div>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => removeAsset(asset)}
                  className="absolute end-1 top-1 grid h-6 w-6 place-items-center rounded-md opacity-0 transition-opacity group-hover:opacity-100"
                  style={{ background: 'rgba(0,0,0,.55)', color: '#fff' }}
                  aria-label="Delete"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </div>
        )}

        <h3 className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
          Quick shapes & icons
        </h3>
        <div className="grid grid-cols-6 gap-1.5">
          {SPARK_ICONS.slice(0, 18).map((icon) => (
            <button
              key={icon.name}
              type="button"
              onClick={() => {
                const node = createSticker(icon.svg, { name: icon.name, width: 120, height: 120 });
                addAtViewCenter(node, `Add ${icon.name}`);
              }}
              className="grid aspect-square place-items-center rounded-lg p-1.5"
              style={{ border: '1px solid var(--border)', background: 'var(--bg-panel)' }}
              title={icon.name}
            >
              <span className="[&>svg]:h-4 [&>svg]:w-4" dangerouslySetInnerHTML={{ __html: icon.svg }} />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
