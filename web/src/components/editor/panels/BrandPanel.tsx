'use client';

import { useEffect, useState } from 'react';
import { Palette, Type, Image as ImageIcon, Wand2, Loader2 } from 'lucide-react';
import { api } from '@/lib/api-client';
import { Button, EmptyState, ColorSwatch } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { useEditor } from '@/store/editor';
import { applyCommand } from '@/engine/apply-command';
import { createImage } from '@/engine/factory';
import { addAtViewCenter } from '../insert';
import { loadFont } from '@/data/fonts';
import { CURATED_PALETTES } from '@/engine/color';
import { recolorDoc, applyTypography } from '@/engine/apply-command';

export type EditorBrandKit = {
  id: string;
  name: string;
  colors: { name?: string; value: string }[];
  fonts: { heading: string; body: string } | null;
  logoUrl: string | null;
};

export function BrandPanel({ kit: initialKit }: { kit: EditorBrandKit | null }) {
  const [kit, setKit] = useState<EditorBrandKit | null>(initialKit);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const doc = useEditor((s) => s.doc);
  const setDoc = useEditor((s) => s.setDoc);
  const activePage = useEditor((s) => s.activePage);
  const page = doc.pages[activePage];

  useEffect(() => {
    if (initialKit) {
      setKit(initialKit);
      return;
    }
    api
      .get<{ kits: EditorBrandKit[] }>('/api/brand')
      .then((data) => setKit(data.kits.find((item) => (item as any).isDefault) ?? data.kits[0] ?? null))
      .catch(() => undefined);
  }, [initialKit]);

  function applyColors(colors: string[]) {
    setBusy(true);
    setDoc(recolorDoc(doc, colors, 'all'), { resetHistory: false });
    toast.success('Brand colours applied');
    setBusy(false);
  }

  function applyFonts(fonts: { heading: string; body: string }) {
    loadFont(fonts.heading);
    loadFont(fonts.body);
    setDoc(
      applyTypography(doc, {
        id: 'brand',
        name: 'Brand',
        heading: { family: fonts.heading, weight: 700, tracking: -0.5, lineHeight: 1.1 },
        body: { family: fonts.body, weight: 400, tracking: 0, lineHeight: 1.6 },
        scale: 2.4,
      }),
      { resetHistory: false },
    );
    toast.success('Brand fonts applied');
  }

  function insertLogo(url: string) {
    if (!page) return;
    const node = createImage(url, { name: 'Logo', width: 240, height: 240 });
    const ratio = 1;
    node.height = 240 * ratio;
    addAtViewCenter(node, 'Add logo');
  }

  function applyEverything() {
    if (!kit) return;
    setBusy(true);
    const result = applyCommand(
      doc,
      { intent: 'brand', params: {}, reply: 'Applying your brand kit' },
      { brandKit: { colors: kit.colors, fonts: kit.fonts } },
    );
    setDoc(result.doc, { resetHistory: false });
    toast.success('Brand kit applied', result.changes.join(' · '));
    setBusy(false);
  }

  if (!kit) {
    return (
      <div className="p-4">
        <EmptyState
          icon={<Palette size={20} />}
          title="No brand kit"
          description="Create a brand kit to keep every design consistent."
          action={
            <a href="/brand" className="no-underline">
              <Button variant="primary" size="sm">
                Create a kit
              </Button>
            </a>
          }
        />
      </div>
    );
  }

  return (
    <div className="scroll-thin flex h-full flex-col overflow-y-auto p-3">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="m-0 text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
          {kit.name}
        </h3>
        <Button variant="primary" size="sm" loading={busy} icon={<Wand2 size={13} />} onClick={applyEverything}>
          Apply all
        </Button>
      </div>

      <Section icon={<Palette size={12} />} title="Brand colours">
        <div className="flex flex-wrap gap-1.5">
          {kit.colors.map((color, index) => (
            <ColorSwatch key={`${color.value}-${index}`} color={color.value} size={30} title={`${color.name ?? 'Colour'} · ${color.value}`} />
          ))}
        </div>
        <Button size="sm" variant="secondary" className="mt-2 w-full" onClick={() => applyColors(kit.colors.map((c) => c.value))}>
          Apply to this design
        </Button>
      </Section>

      <Section icon={<Type size={12} />} title="Brand fonts">
        <div className="rounded-xl p-3" style={{ background: 'var(--bg-panel)' }}>
          <div style={{ fontFamily: `"${kit.fonts?.heading}", serif`, fontSize: 20, fontWeight: 700, color: 'var(--text)' }}>
            Heading — {kit.fonts?.heading}
          </div>
          <div style={{ fontFamily: `"${kit.fonts?.body}", sans-serif`, fontSize: 13, color: 'var(--text-muted)' }}>
            Body — {kit.fonts?.body}
          </div>
        </div>
        {kit.fonts ? (
          <Button size="sm" variant="secondary" className="mt-2 w-full" onClick={() => applyFonts(kit.fonts!)}>
            Apply typography
          </Button>
        ) : null}
      </Section>

      <Section icon={<ImageIcon size={12} />} title="Logo">
        {kit.logoUrl ? (
          <>
            <div className="grid place-items-center rounded-xl p-3" style={{ background: 'var(--bg-panel)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={kit.logoUrl} alt="Logo" className="max-h-16 max-w-full object-contain" />
            </div>
            <Button size="sm" variant="secondary" className="mt-2 w-full" onClick={() => insertLogo(kit.logoUrl!)}>
              Insert logo
            </Button>
          </>
        ) : (
          <p className="m-0 text-[12px]" style={{ color: 'var(--text-muted)' }}>
            No logo uploaded yet. Add one from Brand kits.
          </p>
        )}
      </Section>

      <Section icon={<Palette size={12} />} title="Colour harmonies">
        <div className="flex flex-col gap-2">
          {CURATED_PALETTES.slice(0, 8).map((palette) => (
            <button
              key={palette.name}
              type="button"
              onClick={() => applyColors(palette.colors)}
              className="rounded-lg p-2 text-start transition-colors hover:bg-[var(--bg-hover)]"
              style={{ border: '1px solid var(--border)', background: 'var(--bg-panel)' }}
            >
              <div className="mb-1 text-[11.5px]" style={{ color: 'var(--text-muted)' }}>
                {palette.name}
              </div>
              <div className="flex gap-1">
                {palette.colors.map((color) => (
                  <span key={color} className="h-4 flex-1 rounded" style={{ background: color }} />
                ))}
              </div>
            </button>
          ))}
        </div>
      </Section>

      <div className="h-4" />
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <h4 className="mb-2 mt-0 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
        {icon} {title}
      </h4>
      {children}
    </div>
  );
}
