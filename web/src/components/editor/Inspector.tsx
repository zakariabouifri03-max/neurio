'use client';

import { useMemo } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  FlipHorizontal2,
  FlipVertical2,
  Image as ImageIcon,
  Layers as LayersIcon,
  Lock,
  Maximize2,
  MoveHorizontal,
  MoveVertical,
  RotateCw,
  Sparkles,
  Square,
  Type as TypeIcon,
  Unlock,
} from 'lucide-react';
import { useEditor, useSelectedNodes } from '@/store/editor';
import {
  Button,
  ColorPicker,
  Field,
  IconButton,
  NumberField,
  Segmented,
  Select,
  Section,
  Slider,
  TextArea,
  Toggle,
} from '@/components/ui';
import { CURATED_PALETTES, gradientCss } from '@/engine/color';
import { FILTER_NAMES } from '@/engine/image/process';
import { onRequestImageEdit } from './imageEditBus';
import type { Adjustments, AnimationPreset, BlendMode, Easing, Stroke } from '@/engine/types';

const BLEND_MODES: BlendMode[] = [
  'normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn',
  'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity',
];

const ANIMATIONS: AnimationPreset[] = [
  'none', 'fade', 'rise', 'drop', 'pan-left', 'pan-right', 'zoom-in', 'zoom-out', 'flip', 'pop',
  'blur-in', 'typewriter', 'reveal', 'float', 'pulse', 'spin', 'wipe',
];

export function Inspector({ onResize, readOnly }: { onResize: () => void; readOnly: boolean }) {
  const doc = useEditor((s) => s.doc);
  const activePage = useEditor((s) => s.activePage);
  const selection = useEditor((s) => s.selection);
  const updateNodes = useEditor((s) => s.updateNodes);
  const updatePage = useEditor((s) => s.updatePage);
  const updateSettings = useEditor((s) => s.updateSettings);
  const alignSelection = useEditor((s) => s.alignSelection);
  const distributeSelection = useEditor((s) => s.distributeSelection);
  const zMove = useEditor((s) => s.zMove);
  const toggleLock = useEditor((s) => s.toggleLock);
  const groupSelection = useEditor((s) => s.groupSelection);
  const duplicateNodesById = useEditor((s) => s.duplicateNodesById);
  const deleteNodes = useEditor((s) => s.deleteNodes);

  const nodes = useSelectedNodes();
  const page = doc.pages[activePage];
  const node = nodes[0];
  const multi = nodes.length > 1;

  const patch = (value: Record<string, unknown>, coalesce?: string) =>
    updateNodes(selection, value, { label: 'Edit', coalesce, silent: readOnly });

  const patchAdjustments = (value: Partial<Adjustments>) =>
    updateNodes(selection, (target) => ({ adjustments: { ...(target.adjustments ?? {}), ...value } }), {
      label: 'Adjust',
      coalesce: 'adjust',
    });

  if (!page) return null;

  /* ------------------------------------------------------------ no selection */
  if (!node) {
    return (
      <aside
        className="scroll-thin w-[288px] shrink-0 overflow-y-auto border-s p-3"
        style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}
        aria-label="Inspector"
      >
        <Section title="Page">
          <Field label="Background">
            <ColorPicker
              value={page.background.color}
              onChange={(color) => updatePage(activePage, { background: { ...page.background, color } })}
            />
          </Field>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {CURATED_PALETTES.slice(0, 6).map((palette) => (
              <button
                key={palette.name}
                type="button"
                onClick={() => updatePage(activePage, { background: { ...page.background, color: palette.colors[0]! } })}
                className="h-6 w-6 rounded-md"
                style={{ background: palette.colors[0] }}
                title={palette.name}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {CURATED_PALETTES.slice(0, 6).map((palette) => (
              <button
                key={`grad-${palette.name}`}
                type="button"
                onClick={() =>
                  updatePage(activePage, {
                    background: {
                      ...page.background,
                      paint: {
                        type: 'gradient',
                        kind: 'linear',
                        angle: 135,
                        stops: palette.colors.map((color, index) => ({ offset: index / (palette.colors.length - 1), color })),
                      },
                    },
                  })
                }
                className="h-6 w-6 rounded-md"
                style={{ background: gradientCss(palette.colors.map((color, index) => ({ offset: index / (palette.colors.length - 1), color })), 135) }}
                title={`${palette.name} gradient`}
              />
            ))}
          </div>
        </Section>

        <Section title="Size">
          <div className="flex items-center justify-between text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
            <span>
              {page.width} × {page.height} px
            </span>
            <Button size="sm" variant="secondary" icon={<Maximize2 size={12} />} onClick={onResize}>
              Resize
            </Button>
          </div>
        </Section>

        <Section title="Grid & guides">
          <ToggleRow
            label="Show grid"
            checked={!!doc.settings.grid.visible}
            onChange={(value) => updateSettings({ grid: { ...doc.settings.grid, visible: value } })}
          />
          <ToggleRow label="Snap to grid" checked={!!doc.settings.grid.snap} onChange={(value) => updateSettings({ grid: { ...doc.settings.grid, snap: value } })} />
          <ToggleRow label="Snap to objects" checked={!!doc.settings.snapToObjects} onChange={(value) => updateSettings({ snapToObjects: value })} />
          <div className="mt-2">
            <Field label="Grid size">
              <Slider value={doc.settings.grid.size} min={4} max={120} step={2} onChange={(value) => updateSettings({ grid: { ...doc.settings.grid, size: value } })} suffix="px" />
            </Field>
          </div>
        </Section>

        <Section title="Notes">
          <TextArea
            rows={4}
            value={page.notes ?? ''}
            onChange={(event) => updatePage(activePage, { notes: event.target.value })}
            placeholder={doc.kind === 'presentation' ? 'Speaker notes…' : 'Page notes…'}
          />
        </Section>
      </aside>
    );
  }

  /* -------------------------------------------------------------- selection */
  return (
    <aside
      className="scroll-thin w-[288px] shrink-0 overflow-y-auto border-s p-3"
      style={{ borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}
      aria-label="Inspector"
    >
      <div className="mb-3 flex items-center justify-between">
        <span className="truncate text-[13px] font-semibold" style={{ color: 'var(--text)' }}>
          {multi ? `${nodes.length} selected` : node.name || node.type}
        </span>
        <div className="flex gap-0.5">
          <IconButton icon={node.locked ? <Lock size={13} /> : <Unlock size={13} />} label="Lock" size={26} onClick={() => toggleLock(selection)} />
          <IconButton icon={<LayersIcon size={13} />} label="Group" size={26} onClick={groupSelection} />
          <IconButton icon={<Square size={13} />} label="Duplicate" size={26} onClick={() => duplicateNodesById(selection)} />
        </div>
      </div>

      {/* --------------------------------------------------------- position */}
      <Section title="Position">
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="X" value={Math.round(node.x)} onChange={(value) => patch({ x: value }, 'pos')} />
          <NumberField label="Y" value={Math.round(node.y)} onChange={(value) => patch({ y: value }, 'pos')} />
          <NumberField label="W" value={Math.round(node.width)} min={1} onChange={(value) => patch({ width: value }, 'pos')} />
          <NumberField label="H" value={Math.round(node.height)} min={1} onChange={(value) => patch({ height: value }, 'pos')} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <NumberField label="Rotate" value={Math.round(node.rotation)} suffix="°" onChange={(value) => patch({ rotation: value }, 'pos')} />
          <Field label="Opacity">
            <Slider value={Math.round((node.opacity ?? 1) * 100)} min={0} max={100} onChange={(value) => patch({ opacity: value / 100 }, 'opacity')} suffix="%" />
          </Field>
        </div>
        <div className="mt-2 flex gap-1">
          <IconButton icon={<FlipHorizontal2 size={13} />} label="Flip horizontally" size={26} onClick={() => updateNodes(selection, (target) => ({ flipX: !target.flipX }))} />
          <IconButton icon={<FlipVertical2 size={13} />} label="Flip vertically" size={26} onClick={() => updateNodes(selection, (target) => ({ flipY: !target.flipY }))} />
          <IconButton icon={<RotateCw size={13} />} label="Rotate 90°" size={26} onClick={() => updateNodes(selection, (target) => ({ rotation: (target.rotation + 90) % 360 }))} />
        </div>
      </Section>

      {/* ----------------------------------------------------------- align */}
      <Section title="Align">
        <div className="grid grid-cols-6 gap-1">
          <IconButton icon={<AlignStartVertical size={13} />} label="Align left" size={26} onClick={() => alignSelection('left')} />
          <IconButton icon={<AlignCenterVertical size={13} />} label="Align centre" size={26} onClick={() => alignSelection('hcenter')} />
          <IconButton icon={<AlignEndVertical size={13} />} label="Align right" size={26} onClick={() => alignSelection('right')} />
          <IconButton icon={<AlignStartHorizontal size={13} />} label="Align top" size={26} onClick={() => alignSelection('top')} />
          <IconButton icon={<AlignCenterHorizontal size={13} />} label="Align middle" size={26} onClick={() => alignSelection('vcenter')} />
          <IconButton icon={<AlignEndHorizontal size={13} />} label="Align bottom" size={26} onClick={() => alignSelection('bottom')} />
        </div>
        <div className="mt-1 grid grid-cols-2 gap-1">
          <Button size="sm" variant="secondary" icon={<MoveHorizontal size={12} />} onClick={() => distributeSelection('horizontal')}>
            Spread H
          </Button>
          <Button size="sm" variant="secondary" icon={<MoveVertical size={12} />} onClick={() => distributeSelection('vertical')}>
            Spread V
          </Button>
        </div>
        <div className="mt-1 grid grid-cols-4 gap-1">
          <Button size="sm" variant="ghost" onClick={() => zMove('front')}>Front</Button>
          <Button size="sm" variant="ghost" onClick={() => zMove('forward')}>Up</Button>
          <Button size="sm" variant="ghost" onClick={() => zMove('backward')}>Down</Button>
          <Button size="sm" variant="ghost" onClick={() => zMove('back')}>Back</Button>
        </div>
      </Section>

      {/* ------------------------------------------------------------- fill */}
      <Section title="Fill">
        <ColorPicker
          value={node.fill?.type === 'solid' ? node.fill.color : node.fill?.type === 'gradient' ? (node.fill.stops[0]?.color ?? '#6C5CE7') : '#ffffff'}
          onChange={(color) => patch({ fill: { type: 'solid', color } }, 'fill')}
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {CURATED_PALETTES[0]!.colors.map((color) => (
            <button key={color} type="button" onClick={() => patch({ fill: { type: 'solid', color } }, 'fill')} className="h-5 w-5 rounded" style={{ background: color }} />
          ))}
        </div>
        <div className="mt-2 flex gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              patch(
                {
                  fill: {
                    type: 'gradient',
                    kind: 'linear',
                    angle: 135,
                    stops: CURATED_PALETTES[0]!.colors.map((color, index) => ({ offset: index / 4, color })),
                  },
                },
                'fill',
              )
            }
          >
            Gradient
          </Button>
          <Button size="sm" variant="ghost" onClick={() => patch({ fill: null }, 'fill')}>
            None
          </Button>
        </div>
      </Section>

      {/* ----------------------------------------------------------- stroke */}
      <Section title="Border">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Colour">
            <ColorPicker value={node.stroke?.color ?? '#111827'} onChange={(color) => patch({ stroke: { ...(node.stroke ?? { width: 2, style: 'solid' }), color } as Stroke }, 'stroke')} />
          </Field>
          <NumberField
            label="Width"
            value={node.stroke?.width ?? 0}
            min={0}
            max={80}
            onChange={(value) => patch({ stroke: { ...(node.stroke ?? { color: '#111827', style: 'solid' }), width: value } as Stroke }, 'stroke')}
          />
        </div>
        <div className="mt-2">
          <Segmented
            size="sm"
            value={node.stroke?.style ?? 'solid'}
            onChange={(value) => patch({ stroke: { ...(node.stroke ?? { color: '#111827', width: 2 }), style: value } as Stroke }, 'stroke')}
            options={[
              { value: 'solid', label: 'Solid' },
              { value: 'dashed', label: 'Dashed' },
              { value: 'dotted', label: 'Dotted' },
            ]}
          />
        </div>
        <div className="mt-2">
          <NumberField label="Corner radius" value={typeof node.radius === 'number' ? node.radius : 0} min={0} max={400} onChange={(value) => patch({ radius: value }, 'radius')} />
        </div>
      </Section>

      {/* ---------------------------------------------------------- effects */}
      <Section title="Effects">
        <Field label="Blur">
          <Slider value={node.blur ?? 0} min={0} max={60} onChange={(value) => patch({ blur: value }, 'blur')} suffix="px" />
        </Field>
        <Field label="Blend mode">
          <Select value={node.blendMode} onChange={(value) => patch({ blendMode: value })} options={BLEND_MODES.map((mode) => ({ value: mode, label: mode }))} />
        </Field>
        <div className="mt-2 flex flex-wrap gap-1">
          {[
            { label: 'None', value: null },
            { label: 'Soft', value: { color: 'rgba(0,0,0,.18)', x: 0, y: 6, blur: 18 } },
            { label: 'Medium', value: { color: 'rgba(0,0,0,.28)', x: 0, y: 12, blur: 32 } },
            { label: 'Hard', value: { color: 'rgba(0,0,0,.45)', x: 0, y: 2, blur: 0 } },
            { label: 'Glow', value: { color: 'rgba(108,92,231,.55)', x: 0, y: 0, blur: 28 } },
          ].map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => patch({ shadow: preset.value })}
              className="rounded-md px-2 py-1 text-[11px]"
              style={{ border: '1px solid var(--border)', color: 'var(--text-muted)', background: 'var(--bg-panel)' }}
            >
              {preset.label}
            </button>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------------ adjustments */}
      <Section title="Adjustments">
        <SliderRow label="Brightness" value={node.adjustments?.brightness ?? 0} min={-100} max={100} onChange={(value) => patchAdjustments({ brightness: value })} />
        <SliderRow label="Contrast" value={node.adjustments?.contrast ?? 0} min={-100} max={100} onChange={(value) => patchAdjustments({ contrast: value })} />
        <SliderRow label="Saturation" value={node.adjustments?.saturation ?? 0} min={-100} max={100} onChange={(value) => patchAdjustments({ saturation: value })} />
        <SliderRow label="Temperature" value={node.adjustments?.temperature ?? 0} min={-100} max={100} onChange={(value) => patchAdjustments({ temperature: value })} />
        <SliderRow label="Hue" value={node.adjustments?.hue ?? 0} min={-180} max={180} onChange={(value) => patchAdjustments({ hue: value })} />
        <SliderRow label="Vignette" value={node.adjustments?.vignette ?? 0} min={0} max={100} onChange={(value) => patchAdjustments({ vignette: value })} />

        <Field label="Filter preset">
          <Select
            value={node.adjustments?.filterPreset ?? 'original'}
            onChange={(value) => patchAdjustments({ filterPreset: value === 'original' ? null : value })}
            options={FILTER_NAMES.map((name) => ({ value: name, label: name.replace(/-/g, ' ') }))}
          />
        </Field>

        {node.type === 'image' || node.type === 'video' ? (
          <div className="mt-2 flex flex-wrap gap-1">
            <Button size="sm" variant="secondary" icon={<ImageIcon size={12} />} onClick={() => onRequestImageEdit('crop')}>
              Crop
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onRequestImageEdit('background')}>
              Remove BG
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onRequestImageEdit('upscale')}>
              Upscale
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onRequestImageEdit('enhance')}>
              Enhance
            </Button>
          </div>
        ) : null}
      </Section>

      {/* -------------------------------------------------------- animation */}
      <Section title="Animation">
        <Field label="Entrance">
          <Select
            value={node.animation?.preset ?? 'none'}
            onChange={(value) =>
              updateNodes(selection, (target) => ({ animation: { ...(target.animation ?? { preset: 'none', duration: 600, delay: 0, easing: 'ease-out', loop: false, direction: 'normal' }), preset: value as AnimationPreset } }))
            }
            options={ANIMATIONS.map((preset) => ({ value: preset, label: preset }))}
          />
        </Field>
        {node.animation && node.animation.preset !== 'none' ? (
          <>
            <SliderRow
              label="Duration"
              value={node.animation.duration}
              min={100}
              max={4000}
              step={50}
              onChange={(value) => updateNodes(selection, (target) => ({ animation: { ...(target.animation as any), duration: value } }), { coalesce: 'anim' })}
              suffix="ms"
            />
            <SliderRow
              label="Delay"
              value={node.animation.delay}
              min={0}
              max={4000}
              step={50}
              onChange={(value) => updateNodes(selection, (target) => ({ animation: { ...(target.animation as any), delay: value } }), { coalesce: 'anim' })}
              suffix="ms"
            />
            <Field label="Easing">
              <Select
                value={node.animation.easing}
                onChange={(value) => updateNodes(selection, (target) => ({ animation: { ...(target.animation as any), easing: value as Easing } }))}
                options={['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'spring'].map((easing) => ({ value: easing, label: easing }))}
              />
            </Field>
          </>
        ) : null}
      </Section>

      <div className="pb-6 pt-2">
        <Button variant="danger" size="sm" className="w-full" onClick={() => deleteNodes(selection)}>
          Delete selection
        </Button>
      </div>
    </aside>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  suffix?: string;
}) {
  return (
    <div className="mb-2">
      <Slider label={label} value={value} min={min} max={max} step={step} onChange={onChange} suffix={suffix} />
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="mb-2 flex items-center justify-between text-[12.5px]" style={{ color: 'var(--text-muted)' }}>
      <span>{label}</span>
      <Toggle checked={checked} onChange={onChange} label={label} />
    </label>
  );
}

export { Sparkles, TypeIcon };
