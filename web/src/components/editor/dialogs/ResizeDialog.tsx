'use client';

import { useMemo, useState } from 'react';
import { Maximize2, Wand2, Loader2, Copy, Check } from 'lucide-react';
import { useEditor } from '@/store/editor';
import { Button, Field, Modal, Segmented, Select, Toggle, TextInput } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { SIZE_PRESETS, RESIZE_TARGETS } from '@/data/sizes';
import { resizeDoc, type ResizeMode } from '@/engine/resize';
import { api } from '@/lib/api-client';

export function ResizeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const doc = useEditor((s) => s.doc);
  const setDoc = useEditor((s) => s.setDoc);
  const toast = useToast();

  const [mode, setMode] = useState<ResizeMode>('smart');
  const [preset, setPreset] = useState('instagram-post');
  const [custom, setCustom] = useState({ width: doc.width, height: doc.height });
  const [busy, setBusy] = useState(false);
  const [creating, setCreating] = useState(false);

  const selected = useMemo(() => SIZE_PRESETS.find((item) => item.id === preset), [preset]);
  const target = { width: custom.width, height: custom.height };
  const useCustom = preset === 'custom';

  async function apply() {
    const width = useCustom ? custom.width : (selected?.width ?? doc.width);
    const height = useCustom ? custom.height : (selected?.height ?? doc.height);
    setBusy(true);
    try {
      setDoc(resizeDoc(doc, width, height, mode), { resetHistory: false });
      toast.success('Design resized', mode === 'smart' ? 'Content was reflowed to fit' : 'Content was scaled proportionally');
      onClose();
    } catch (error) {
      toast.error('Resize failed', (error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function createCopy() {
    const width = useCustom ? custom.width : (selected?.width ?? doc.width);
    const height = useCustom ? custom.height : (selected?.height ?? doc.height);
    setCreating(true);
    try {
      const resized = resizeDoc(doc, width, height, mode);
      const project = await api.post<{ id: string }>('/api/projects', {
        title: `${doc.title} · ${width}×${height}`,
        kind: doc.kind,
        width,
        height,
        pages: resized.pages,
      });
      window.open(`/design/${project.id}`, '_blank');
      toast.success('Copy created', 'Opened in a new tab');
    } catch (error) {
      toast.error('Could not create the copy', (error as Error).message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Resize design"
      width={620}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="secondary" loading={creating} icon={<Copy size={14} />} onClick={createCopy}>
            Create a copy
          </Button>
          <Button variant="primary" loading={busy} icon={<Maximize2 size={14} />} onClick={apply}>
            Resize this design
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 p-5">
        <Field label="Method">
          <Segmented
            value={mode}
            onChange={(value) => setMode(value as ResizeMode)}
            options={[
              { value: 'smart', label: 'Smart reflow' },
              { value: 'scale', label: 'Proportional scale' },
            ]}
          />
        </Field>
        <p className="-mt-2 text-[11.5px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
          Smart reflow scales geometry and type, then re-flows rows so nothing overlaps or falls outside the safe area.
          Proportional scale keeps the layout exactly as drawn.
        </p>

        <div>
          <h4 className="mb-2 mt-0 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
            Quick formats
          </h4>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {RESIZE_TARGETS.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setPreset(item.id === preset ? 'custom' : item.id)}
                className="rounded-xl p-2.5 text-start transition-transform hover:-translate-y-0.5"
                style={{
                  border: `1px solid ${preset === item.id ? 'var(--brand)' : 'var(--border)'}`,
                  background: preset === item.id ? 'var(--brand-soft)' : 'var(--bg-panel)',
                }}
              >
                <div className="text-[12px] font-semibold" style={{ color: 'var(--text)' }}>
                  {item.label}
                </div>
                <div className="text-[10.5px]" style={{ color: 'var(--text-faint)' }}>
                  {item.width}×{item.height}
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Preset sizes">
            <Select
              value={preset}
              onChange={setPreset}
              options={[
                ...SIZE_PRESETS.slice(0, 70).map((item) => ({ value: item.id, label: `${item.name} — ${item.width}×${item.height}` })),
                { value: 'custom', label: 'Custom size…' },
              ]}
            />
          </Field>
          <div className="flex items-end gap-2">
            <Field label="Width">
              <TextInput
                type="number"
                value={useCustom ? custom.width : (selected?.width ?? doc.width)}
                onChange={(event) => setCustom((current) => ({ ...current, width: Number(event.target.value) }))}
              />
            </Field>
            <Field label="Height">
              <TextInput
                type="number"
                value={useCustom ? custom.height : (selected?.height ?? doc.height)}
                onChange={(event) => setCustom((current) => ({ ...current, height: Number(event.target.value) }))}
              />
            </Field>
          </div>
        </div>

        <div className="rounded-xl p-3 text-[11.5px]" style={{ background: 'var(--bg-panel-2)', color: 'var(--text-muted)' }}>
          Current: {doc.width} × {doc.height} px →{' '}
          <strong style={{ color: 'var(--text)' }}>
            {useCustom ? `${target.width} × ${target.height}` : `${selected?.width} × ${selected?.height}`} px
          </strong>
        </div>
      </div>
    </Modal>
  );
}
