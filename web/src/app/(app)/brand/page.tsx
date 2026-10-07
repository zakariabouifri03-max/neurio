'use client';

import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { Plus, Trash2, Check, Palette, Upload, Type, Loader2 } from 'lucide-react';
import { api, upload } from '@/lib/api-client';
import { Button, ColorPicker, EmptyState, Field, Modal, TextArea, TextInput, ColorSwatch } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { FONTS } from '@/data/fonts';
import { generatePalette, contrastRatio, contrastRating, isDark } from '@/engine/color';
import { loadFont } from '@/data/fonts';

type Kit = {
  id: string;
  name: string;
  colors: { name?: string; value: string }[];
  fonts: { heading: string; body: string; accent?: string | null };
  logoUrl?: string | null;
  guidelines?: string | null;
  isDefault?: boolean;
};

export default function BrandPage() {
  const toast = useToast();
  const [kits, setKits] = useState<Kit[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Kit | null>(null);
  const [draft, setDraft] = useState<Kit | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<{ kits: Kit[] }>('/api/brand');
      setKits(data.kits);
    } catch (error) {
      toast.error('Could not load brand kits', (error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function createKit() {
    try {
      const data = await api.post<{ kits: Kit[] }>('/api/brand', { name: 'New brand kit' });
      setKits(data.kits);
      toast.success('Brand kit created');
    } catch (error) {
      toast.error('Could not create the kit', (error as Error).message);
    }
  }

  async function saveKit() {
    if (!draft) return;
    try {
      await api.patch(`/api/brand/${draft.id}`, {
        name: draft.name,
        colors: draft.colors,
        fonts: draft.fonts,
        logoUrl: draft.logoUrl ?? null,
        guidelines: draft.guidelines ?? null,
        isDefault: draft.isDefault,
      });
      toast.success('Brand kit saved');
      setEditing(null);
      load();
    } catch (error) {
      toast.error('Save failed', (error as Error).message);
    }
  }

  async function removeKit(kit: Kit) {
    if (!window.confirm(`Delete “${kit.name}”?`)) return;
    await api.del(`/api/brand/${kit.id}`).catch((error) => toast.error('Delete failed', error.message));
    load();
  }

  async function setDefault(kit: Kit) {
    await api.patch(`/api/brand/${kit.id}`, { isDefault: true }).catch((error) => toast.error('Update failed', error.message));
    load();
  }

  async function uploadLogo(file: File) {
    try {
      const asset = await upload('/api/upload', file);
      setDraft((current) => (current ? { ...current, logoUrl: asset.url } : current));
    } catch (error) {
      toast.error('Upload failed', (error as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-[1100px] px-5 py-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="m-0 text-[22px] font-bold tracking-tight">Brand kits</h1>
          <p className="mt-1 text-[13px]" style={{ color: 'var(--text-muted)' }}>
            Colours, typography, logos and guidelines — applied to new designs and suggested by the assistant.
          </p>
        </div>
        <Button variant="primary" icon={<Plus size={15} />} onClick={createKit}>
          New brand kit
        </Button>
      </div>

      {loading ? (
        <div className="grid place-items-center py-20">
          <Loader2 size={20} className="animate-spin" style={{ color: 'var(--brand)' }} />
        </div>
      ) : kits.length === 0 ? (
        <div className="card mt-6">
          <EmptyState
            icon={<Palette size={22} />}
            title="No brand kits yet"
            description="Create a kit to keep colours, fonts and logos consistent across every design."
            action={
              <Button variant="primary" onClick={createKit}>
                Create a kit
              </Button>
            }
          />
        </div>
      ) : (
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {kits.map((kit) => (
            <div key={kit.id} className="card p-5">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="m-0 flex items-center gap-2 text-[15px] font-semibold">
                    {kit.name}
                    {kit.isDefault ? (
                      <span className="chip" style={{ background: 'var(--brand-soft)', color: 'var(--brand)' }}>
                        Default
                      </span>
                    ) : null}
                  </h3>
                  <p className="mb-0 mt-1 text-[12px]" style={{ color: 'var(--text-faint)' }}>
                    {kit.fonts.heading} · {kit.fonts.body}
                  </p>
                </div>
                {kit.logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={kit.logoUrl} alt="" className="h-9 w-9 rounded-lg object-contain" style={{ background: 'var(--bg-input)' }} />
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap gap-1.5">
                {kit.colors.map((color, index) => (
                  <ColorSwatch key={`${color.value}-${index}`} color={color.value} title={`${color.name ?? 'Colour'} ${color.value}`} size={26} />
                ))}
              </div>

              {kit.guidelines ? (
                <p className="mb-0 mt-4 line-clamp-3 text-[12.5px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
                  {kit.guidelines}
                </p>
              ) : null}

              <div className="mt-4 flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => { setEditing(kit); setDraft({ ...kit, colors: [...kit.colors], fonts: { ...kit.fonts } }); }}>
                  Edit
                </Button>
                {!kit.isDefault ? (
                  <Button size="sm" variant="ghost" icon={<Check size={13} />} onClick={() => setDefault(kit)}>
                    Make default
                  </Button>
                ) : null}
                <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={() => removeKit(kit)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={!!editing && !!draft}
        onClose={() => setEditing(null)}
        title="Edit brand kit"
        width={720}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={saveKit}>
              Save kit
            </Button>
          </>
        }
      >
        {draft ? <KitEditor draft={draft} setDraft={setDraft} uploadLogo={uploadLogo} /> : null}
      </Modal>
    </div>
  );
}

function KitEditor({
  draft,
  setDraft,
  uploadLogo,
}: {
  draft: Kit;
  setDraft: Dispatch<SetStateAction<Kit | null>>;
  uploadLogo: (file: File) => void;
}) {
  const update = (updater: (kit: Kit) => Kit): void =>
    setDraft((current) => (current ? updater(current) : current));
  return (
    <div className="flex flex-col gap-5 p-5">
      <Field label="Kit name">
        <TextInput value={draft.name} onChange={(event) => update((kit) => ({ ...kit, name: event.target.value }))} />
      </Field>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
            Colours
          </span>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={<Plus size={13} />}
              onClick={() => update((kit) => ({ ...kit, colors: [...kit.colors, { name: 'New colour', value: '#6C5CE7' }] }))}
            >
              Add
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                const base = draft.colors[0]?.value ?? '#6C5CE7';
                update((kit) => ({
                  ...kit,
                  colors: generatePalette(base, 5, 'analogous').map((value, index) => ({ name: `Harmony ${index + 1}`, value })),
                }));
              }}
            >
              Generate harmony
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {draft.colors.map((color, index) => (
            <div key={index} className="flex items-center gap-2">
              <ColorPicker
                value={color.value}
                onChange={(value) =>
                  update((kit) => ({ ...kit, colors: kit.colors.map((c, i) => (i === index ? { ...c, value } : c)) }))
                }
              />
              <TextInput
                value={color.name ?? ''}
                placeholder="Name"
                onChange={(event) =>
                  update((kit) => ({ ...kit, colors: kit.colors.map((c, i) => (i === index ? { ...c, name: event.target.value } : c)) }))
                }
                className="flex-1"
              />
              <Button
                size="sm"
                variant="ghost"
                icon={<Trash2 size={13} />}
                onClick={() => update((kit) => ({ ...kit, colors: kit.colors.filter((_, i) => i !== index) }))}
              />
            </div>
          ))}
        </div>

        {draft.colors.length >= 2 ? (
          <div className="mt-3 rounded-xl p-3 text-[12px]" style={{ background: 'var(--bg-panel-2)', color: 'var(--text-muted)' }}>
            <strong style={{ color: 'var(--text)' }}>Contrast check:</strong> text {draft.colors[1]?.value} on {draft.colors[0]?.value} ={' '}
            {contrastRatio(draft.colors[1]?.value ?? '#000', draft.colors[0]?.value ?? '#fff').toFixed(2)}:1 (
            {contrastRating(contrastRatio(draft.colors[1]?.value ?? '#000', draft.colors[0]?.value ?? '#fff'))})
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Heading font">
          <select
            className="field"
            value={draft.fonts.heading}
            onChange={(event) => {
              const family = event.target.value;
              loadFont(family);
              update((kit) => ({ ...kit, fonts: { ...kit.fonts, heading: family } }));
            }}
          >
            {FONTS.map((font) => (
              <option key={font.family} value={font.family}>
                {font.family}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Body font">
          <select
            className="field"
            value={draft.fonts.body}
            onChange={(event) => {
              const family = event.target.value;
              loadFont(family);
              update((kit) => ({ ...kit, fonts: { ...kit.fonts, body: family } }));
            }}
          >
            {FONTS.map((font) => (
              <option key={font.family} value={font.family}>
                {font.family}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div
        className="rounded-xl p-4"
        style={{ background: draft.colors[0]?.value ?? '#111', color: isDark(draft.colors[0]?.value ?? '#111') ? '#fff' : '#000' }}
      >
        <div style={{ fontFamily: `"${draft.fonts.heading}", sans-serif`, fontSize: 26, fontWeight: 700 }}>
          The quick brown fox
        </div>
        <div style={{ fontFamily: `"${draft.fonts.body}", sans-serif`, fontSize: 14, opacity: 0.85 }}>
          Brand preview using your heading and body fonts.
        </div>
      </div>

      <div>
        <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
          Logo
        </span>
        <div className="flex items-center gap-3">
          {draft.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={draft.logoUrl} alt="" className="h-12 w-12 rounded-lg object-contain" style={{ background: 'var(--bg-input)' }} />
          ) : null}
          <label className="btn btn-secondary">
            <Upload size={14} /> Upload logo
            <input
              type="file"
              accept="image/*,image/svg+xml"
              hidden
              onChange={(event) => event.target.files?.[0] && uploadLogo(event.target.files[0])}
            />
          </label>
          {draft.logoUrl ? (
            <Button variant="ghost" onClick={() => update((kit) => ({ ...kit, logoUrl: null }))}>
              Remove
            </Button>
          ) : null}
        </div>
      </div>

      <Field label="Guidelines">
        <TextArea
          rows={4}
          value={draft.guidelines ?? ''}
          onChange={(event) => update((kit) => ({ ...kit, guidelines: event.target.value }))}
          placeholder="Logo clear space, tone of voice, do's and don'ts…"
        />
      </Field>
    </div>
  );
}
