'use client';

/**
 * Quick-start bar: pick a format (or enter a custom size) and Prism creates a
 * real project in the database and opens the editor — no demo mode.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';
import { api } from '@/lib/api-client';
import { useSession } from '@/components/providers';
import { useToast } from '@/components/ui/toast';
import { SIZE_PRESETS } from '@/data/sizes';

const QUICK = [
  { id: 'instagram-post', label: 'Instagram post', w: 1080, h: 1080, kind: 'design' },
  { id: 'story', label: 'Story / Reel', w: 1080, h: 1920, kind: 'design' },
  { id: 'presentation', label: 'Presentation', w: 1920, h: 1080, kind: 'presentation' },
  { id: 'a4-doc', label: 'A4 document', w: 794, h: 1123, kind: 'document' },
  { id: 'youtube-thumb', label: 'YouTube thumbnail', w: 1280, h: 720, kind: 'design' },
  { id: 'poster', label: 'Poster A3', w: 1123, h: 1587, kind: 'print' },
] as const;

export function CreateBar({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [custom, setCustom] = useState({ width: 1200, height: 800 });

  async function create(opts: { title: string; kind: string; width: number; height: number }) {
    setBusy(opts.title);
    try {
      const project = await api.post<{ id: string }>('/api/projects', opts);
      router.push(`/design/${project.id}`);
    } catch (error) {
      toast.error('Could not create the design', (error as Error).message);
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex flex-wrap justify-center gap-2">
        {QUICK.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => create({ title: item.label, kind: item.kind, width: item.w, height: item.h })}
            disabled={!!busy}
            className="group flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-[13px] font-medium transition-all hover:-translate-y-0.5 disabled:opacity-60"
            style={{ border: '1px solid var(--border)', background: 'var(--bg-panel)', color: 'var(--text)' }}
          >
            {busy === item.label ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} style={{ color: 'var(--brand)' }} />}
            {item.label}
            <span className="text-[11px]" style={{ color: 'var(--text-faint)' }}>
              {item.w}×{item.h}
            </span>
          </button>
        ))}
      </div>

      {!compact ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-xl px-3 py-2"
          style={{ border: '1px solid var(--border)', background: 'var(--bg-panel)' }}
        >
          <span className="text-[12px]" style={{ color: 'var(--text-muted)' }}>
            Custom size
          </span>
          <input
            type="number"
            value={custom.width}
            onChange={(event) => setCustom((c) => ({ ...c, width: Number(event.target.value) }))}
            className="w-20 rounded-lg px-2 py-1.5 text-[13px]"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
            aria-label="Width"
          />
          <span style={{ color: 'var(--text-faint)' }}>×</span>
          <input
            type="number"
            value={custom.height}
            onChange={(event) => setCustom((c) => ({ ...c, height: Number(event.target.value) }))}
            className="w-20 rounded-lg px-2 py-1.5 text-[13px]"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
            aria-label="Height"
          />
          <select
            className="rounded-lg px-2 py-1.5 text-[13px]"
            style={{ background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text)' }}
            onChange={(event) => {
              const preset = SIZE_PRESETS.find((p) => p.id === event.target.value);
              if (preset) setCustom({ width: preset.width, height: preset.height });
            }}
            defaultValue=""
            aria-label="Preset sizes"
          >
            <option value="">Presets…</option>
            {SIZE_PRESETS.slice(0, 40).map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name} · {preset.width}×{preset.height}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => create({ title: 'Untitled design', kind: 'design', width: custom.width, height: custom.height })}
            disabled={!!busy}
            className="rounded-lg px-3 py-1.5 text-[13px] font-medium"
            style={{ background: 'var(--brand)', color: '#fff' }}
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
