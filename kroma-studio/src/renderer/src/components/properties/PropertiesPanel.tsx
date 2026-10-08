import { useMemo } from 'react'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpToLine,
  Bold,
  Copy,
  FlipHorizontal,
  FlipVertical,
  Group,
  Italic,
  Lock,
  Layers as LayersIcon,
  RotateCcw,
  Trash2,
  Underline,
  Ungroup,
  Wand2
} from 'lucide-react'
import type { ImageNode, Page, SceneNode, ShapeNode, TextNode } from '../../../../shared/types/document'
import { DEFAULT_IMAGE_FILTERS, type CurveKind, type FillSpec, type MaskKind, type StrokeSpec } from '../../../../shared/types/document'
import { Button, ColorPicker, Field, NumberInput, Segmented, Select, Slider, Toggle } from '../ui/controls'
import { useEditorStore } from '../../state/editor-store'
import { useAppStore } from '../../state/app-store'
import { GRADIENT_PRESETS } from '../../lib/catalogs/gradients'
import { uniqueFamilies } from '../../services/fonts'
import { useUiStore } from '../../state/ui-store'
import { notify } from '../../state/ui-store'

type PatchOptions = string | { label?: string; coalesceMs?: number }

const toPatchOptions = (options: PatchOptions): { label?: string; coalesceMs?: number } =>
  typeof options === 'string' ? { label: options } : options

const MASK_OPTIONS: Array<{ value: MaskKind; label: string }> = [
  { value: 'none', label: 'None' },
  { value: 'circle', label: 'Circle' },
  { value: 'rounded', label: 'Rounded' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'hexagon', label: 'Hexagon' },
  { value: 'star', label: 'Star' },
  { value: 'heart', label: 'Heart' },
  { value: 'diamond', label: 'Diamond' }
]

export function PropertiesPanel(): JSX.Element {
  const document = useEditorStore((state) => state.document)
  const selection = useEditorStore((state) => state.selection)
  const pageId = useEditorStore((state) => state.activePageId)
  const fonts = useAppStore((state) => state.fonts)

  const page = document?.pages.find((item) => item.id === pageId) ?? null
  const nodes = useMemo(() => {
    if (!page) return []
    return page.nodes.filter((node) => selection.includes(node.id))
  }, [page, selection])

  if (!page) return <div className="k-empty">No page selected</div>
  if (nodes.length === 0) return <PageProperties page={page} />
  if (nodes.length > 1) return <MultiSelection nodes={nodes} />

  const node = nodes[0]
  return (
    <div className="k-col" style={{ gap: 14 }}>
      <TransformSection node={node} page={page} />
      <AppearanceSection node={node} />
      {node.kind === 'text' ? <TextSection node={node} families={uniqueFamilies(fonts)} /> : null}
      {node.kind === 'image' ? <ImageSection node={node} /> : null}
      {node.kind === 'shape' ? <ShapeSection node={node} /> : null}
      <ArrangeSection node={node} />
    </div>
  )
}

/* ------------------------------ transform ------------------------------ */

function TransformSection({ node, page }: { node: SceneNode; page: Page }): JSX.Element {
  const update = useEditorStore((state) => state.updateNodes)
  const locked = Boolean(node.locked)

  const patch = (values: Partial<SceneNode>, label?: string): void =>
    update([{ id: node.id, patch: values }], { label: label ?? 'transform', coalesceMs: 250 })

  const quickAlign = (mode: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'): void => {
    switch (mode) {
      case 'left':
        patch({ x: 0 }, 'align left')
        break
      case 'center':
        patch({ x: Math.round(page.width / 2 - node.width / 2) }, 'align center')
        break
      case 'right':
        patch({ x: Math.round(page.width - node.width) }, 'align right')
        break
      case 'top':
        patch({ y: 0 }, 'align top')
        break
      case 'middle':
        patch({ y: Math.round(page.height / 2 - node.height / 2) }, 'align middle')
        break
      case 'bottom':
        patch({ y: Math.round(page.height - node.height) }, 'align bottom')
        break
    }
  }

  return (
    <section className="k-col" style={{ gap: 8 }}>
      <div className="k-row-between">
        <span className="k-section-title">Position &amp; size</span>
        <span className="k-chip">{node.kind}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field label="X">
          <NumberInput value={node.x} disabled={locked} onChange={(x) => patch({ x }, 'position')} />
        </Field>
        <Field label="Y">
          <NumberInput value={node.y} disabled={locked} onChange={(y) => patch({ y }, 'position')} />
        </Field>
        <Field label="Width">
          <NumberInput value={node.width} min={1} disabled={locked} onChange={(width) => patch({ width }, 'size')} />
        </Field>
        <Field label="Height">
          <NumberInput value={node.height} min={1} disabled={locked} onChange={(height) => patch({ height }, 'size')} />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field label="Rotation">
          <NumberInput value={node.rotation} suffix="°" disabled={locked} onChange={(rotation) => patch({ rotation }, 'rotate')} />
        </Field>
        <Field label="Opacity">
          <NumberInput value={node.opacity * 100} min={0} max={100} suffix="%" disabled={locked} onChange={(value) => patch({ opacity: value / 100 }, 'opacity')} />
        </Field>
      </div>
      <Slider min={0} max={100} value={Math.round(node.opacity * 100)} onChange={(value) => patch({ opacity: value / 100 }, 'opacity')} />
      <div className="k-row" style={{ gap: 4, flexWrap: 'wrap' }}>
        <span className="k-section-title" style={{ marginRight: 4 }}>Align</span>
        <Button size="sm" variant="ghost" disabled={locked} onClick={() => quickAlign('left')} title="Align left">L</Button>
        <Button size="sm" variant="ghost" disabled={locked} onClick={() => quickAlign('center')} title="Align horizontal centre">H</Button>
        <Button size="sm" variant="ghost" disabled={locked} onClick={() => quickAlign('right')} title="Align right">R</Button>
        <Button size="sm" variant="ghost" disabled={locked} onClick={() => quickAlign('top')} title="Align top">T</Button>
        <Button size="sm" variant="ghost" disabled={locked} onClick={() => quickAlign('middle')} title="Align vertical centre">M</Button>
        <Button size="sm" variant="ghost" disabled={locked} onClick={() => quickAlign('bottom')} title="Align bottom">B</Button>
      </div>
      <div className="k-row" style={{ gap: 6 }}>
        <Button size="sm" variant="ghost" icon={FlipHorizontal} disabled={locked} onClick={() => patch({ flipX: !node.flipX }, 'flip horizontal')}>
          Flip H
        </Button>
        <Button size="sm" variant="ghost" icon={FlipVertical} disabled={locked} onClick={() => patch({ flipY: !node.flipY }, 'flip vertical')}>
          Flip V
        </Button>
        <Button size="sm" variant="ghost" icon={RotateCcw} disabled={locked} onClick={() => patch({ rotation: 0 }, 'reset rotation')}>
          Reset
        </Button>
      </div>
      <Toggle
        checked={Boolean(node.lockRatio)}
        label="Lock aspect ratio"
        onChange={(value) => patch({ lockRatio: value } as Partial<SceneNode>, 'lock ratio')}
      />
    </section>
  )
}

/* ------------------------------ appearance ----------------------------- */

function AppearanceSection({ node }: { node: SceneNode }): JSX.Element {
  const update = useEditorStore((state) => state.updateNodes)
  const patch = (values: Partial<SceneNode>, label?: string): void =>
    update([{ id: node.id, patch: values }], { label: label ?? 'appearance', coalesceMs: 250 })

  const hasFill = node.kind === 'text' || node.kind === 'shape' || node.kind === 'svg'
  if (!hasFill) return <></>
  const fill = (node as TextNode | ShapeNode).fill

  const setFill = (next: FillSpec): void => patch({ fill: next } as Partial<SceneNode>, 'fill')

  return (
    <section className="k-col" style={{ gap: 8 }}>
      <span className="k-section-title">Fill</span>
      <Segmented
        value={fill.type}
        options={[
          { value: 'solid', label: 'Solid' },
          { value: 'linear', label: 'Gradient' }
        ]}
        onChange={(type) => {
          if (type === 'solid') setFill({ ...fill, type: 'solid' })
          else setFill(fill.stops ? { ...fill, type: 'linear' } : { ...GRADIENT_PRESETS[0].fill })
        }}
      />
      {fill.type === 'solid' ? (
        <ColorPicker value={fill.color} onChange={(color) => setFill({ ...fill, color })} allowTransparent label="Colour" />
      ) : (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
            {GRADIENT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                title={preset.label}
                onClick={() => setFill({ ...preset.fill })}
                style={{
                  height: 26,
                  borderRadius: 6,
                  border: '1px solid var(--k-line)',
                  cursor: 'pointer',
                  background: `linear-gradient(${preset.fill.angle ?? 90}deg, ${preset.fill.stops?.[0]?.color ?? '#000'}, ${preset.fill.stops?.[1]?.color ?? '#fff'})`
                }}
              />
            ))}
          </div>
          <Field label="Angle">
            <NumberInput value={fill.angle ?? 90} suffix="°" onChange={(angle) => setFill({ ...fill, angle })} />
          </Field>
          {(fill.stops ?? []).map((stop, index) => (
            <div key={index} className="k-row" style={{ gap: 8 }}>
              <ColorPicker
                value={stop.color}
                onChange={(color) => {
                  const stops = [...(fill.stops ?? [])]
                  stops[index] = { ...stop, color }
                  setFill({ ...fill, stops })
                }}
              />
              <Slider
                min={0}
                max={1}
                step={0.01}
                value={stop.offset}
                onChange={(offset) => {
                  const stops = [...(fill.stops ?? [])]
                  stops[index] = { ...stop, offset }
                  setFill({ ...fill, stops })
                }}
                format={(value) => `${Math.round(value * 100)}%`}
              />
            </div>
          ))}
        </>
      )}

      <StrokeEditor
        stroke={(node as TextNode | ShapeNode).stroke ?? null}
        onChange={(stroke) => patch({ stroke } as Partial<SceneNode>, 'stroke')}
      />

      <div className="k-sep" />
      <span className="k-section-title">Shadow</span>
      <Toggle
        checked={Boolean(node.shadow)}
        label="Drop shadow"
        onChange={(value) => patch({ shadow: value ? { color: '#000000', blur: 16, offsetX: 0, offsetY: 8, opacity: 0.35 } : null } as Partial<SceneNode>, 'shadow')}
      />
      {node.shadow ? (
        <>
          <Slider
            label="Blur"
            min={0}
            max={120}
            value={node.shadow.blur}
            onChange={(blur) => patch({ shadow: { ...node.shadow!, blur } } as Partial<SceneNode>, 'shadow')}
            format={(value) => `${value}px`}
          />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <Field label="Offset X">
              <NumberInput value={node.shadow.offsetX} onChange={(offsetX) => patch({ shadow: { ...node.shadow!, offsetX } } as Partial<SceneNode>, 'shadow')} />
            </Field>
            <Field label="Offset Y">
              <NumberInput value={node.shadow.offsetY} onChange={(offsetY) => patch({ shadow: { ...node.shadow!, offsetY } } as Partial<SceneNode>, 'shadow')} />
            </Field>
          </div>
          <Slider
            label="Opacity"
            min={0}
            max={100}
            value={Math.round(node.shadow.opacity * 100)}
            onChange={(value) => patch({ shadow: { ...node.shadow!, opacity: value / 100 } } as Partial<SceneNode>, 'shadow')}
            format={(value) => `${value}%`}
          />
          <ColorPicker
            value={node.shadow.color}
            onChange={(color) => patch({ shadow: { ...node.shadow!, color } } as Partial<SceneNode>, 'shadow')}
            label="Shadow colour"
          />
        </>
      ) : null}
    </section>
  )
}

function StrokeEditor({ stroke, onChange }: { stroke: StrokeSpec | null; onChange: (stroke: StrokeSpec | null) => void }): JSX.Element {
  const enabled = Boolean(stroke && stroke.width > 0)
  return (
    <div className="k-col" style={{ gap: 8 }}>
      <div className="k-sep" />
      <Toggle
        checked={enabled}
        label="Outline"
        onChange={(value) => onChange(value ? { color: '#FFFFFF', width: 4, align: 'outside' } : null)}
      />
      {enabled && stroke ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <ColorPicker value={stroke.color} onChange={(color) => onChange({ ...stroke, color })} label="Colour" />
            <Field label="Width">
              <NumberInput value={stroke.width} min={0} max={200} onChange={(width) => onChange({ ...stroke, width })} />
            </Field>
          </div>
          <Field label="Style">
            <Select
              value={stroke.dash?.length ? 'dashed' : 'solid'}
              options={[
                { value: 'solid', label: 'Solid' },
                { value: 'dashed', label: 'Dashed' },
                { value: 'dotted', label: 'Dotted' }
              ]}
              onChange={(value) =>
                onChange({
                  ...stroke,
                  dash: value === 'solid' ? undefined : value === 'dashed' ? [12, 8] : [3, 5]
                })
              }
            />
          </Field>
        </>
      ) : null}
    </div>
  )
}

/* -------------------------------- text ---------------------------------- */

const CURVE_OPTIONS: Array<{ value: CurveKind; label: string }> = [
  { value: 'none', label: 'Straight' },
  { value: 'arc', label: 'Arc up' },
  { value: 'arcReverse', label: 'Arc down' },
  { value: 'wave', label: 'Wave' },
  { value: 'valley', label: 'Valley' },
  { value: 'circle', label: 'Circle' }
]

function TextSection({ node, families }: { node: TextNode; families: string[] }): JSX.Element {
  const update = useEditorStore((state) => state.updateNodes)
  const patch = (values: Partial<TextNode>, options: PatchOptions = 'text'): void =>
    update([{ id: node.id, patch: values as Partial<SceneNode> }], toPatchOptions(options))

  return (
    <section className="k-col" style={{ gap: 8 }}>
      <div className="k-sep" />
      <span className="k-section-title">Typography</span>
      <Field label="Font">
        <Select
          ariaLabel="Font family"
          value={families.includes(node.fontFamily) ? node.fontFamily : families[0] ?? 'Inter'}
          options={(families.length ? families : ['Inter']).map((family) => ({ value: family, label: family }))}
          onChange={(fontFamily) => patch({ fontFamily }, 'font')}
        />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <Field label="Size">
          <NumberInput value={node.fontSize} min={4} max={2000} onChange={(fontSize) => patch({ fontSize }, 'font size')} />
        </Field>
        <Field label="Weight">
          <Select
            ariaLabel="Font weight"
            value={String(node.fontWeight)}
            options={[
              { value: '300', label: 'Light 300' },
              { value: '400', label: 'Regular 400' },
              { value: '500', label: 'Medium 500' },
              { value: '600', label: 'Semi 600' },
              { value: '700', label: 'Bold 700' },
              { value: '800', label: 'Heavy 800' },
              { value: '900', label: 'Black 900' }
            ]}
            onChange={(value) => patch({ fontWeight: Number(value) }, 'font weight')}
          />
        </Field>
      </div>
      <div className="k-row" style={{ gap: 4 }}>
        <Button size="sm" variant={node.fontWeight >= 700 ? 'primary' : 'ghost'} icon={Bold} onClick={() => patch({ fontWeight: node.fontWeight >= 700 ? 400 : 700 }, 'bold')} title="Bold" />
        <Button size="sm" variant={node.italic ? 'primary' : 'ghost'} icon={Italic} onClick={() => patch({ italic: !node.italic }, 'italic')} title="Italic" />
        <Button size="sm" variant={node.underline ? 'primary' : 'ghost'} icon={Underline} onClick={() => patch({ underline: !node.underline }, 'underline')} title="Underline" />
        <div style={{ flex: 1 }} />
        <Segmented
          value={node.align}
          options={[
            { value: 'left', label: '', icon: AlignLeft, title: 'Align left' },
            { value: 'center', label: '', icon: AlignCenter, title: 'Align centre' },
            { value: 'right', label: '', icon: AlignRight, title: 'Align right' }
          ]}
          onChange={(align) => patch({ align }, 'align')}
        />
      </div>
      <Slider
        label="Letter spacing"
        min={-20}
        max={60}
        step={0.5}
        value={node.letterSpacing}
        onChange={(letterSpacing) => patch({ letterSpacing }, 'letter spacing')}
        format={(value) => `${value}px`}
      />
      <Slider
        label="Line height"
        min={0.6}
        max={3}
        step={0.05}
        value={node.lineHeight}
        onChange={(lineHeight) => patch({ lineHeight }, { label: 'line height', coalesceMs: 200 })}
        format={(value) => value.toFixed(2)}
      />

      <div className="k-sep" />
      <span className="k-section-title">Text effects</span>
      <Field label="Warp / curve">
        <Select
          ariaLabel="Text curve"
          value={node.curve?.kind ?? 'none'}
          options={CURVE_OPTIONS}
          onChange={(kind) => patch({ curve: kind === 'none' ? null : { kind, amount: node.curve?.amount ?? 40 } }, 'curve')}
        />
      </Field>
      {node.curve ? (
        <Slider
          label="Curve strength"
          min={-100}
          max={100}
          value={node.curve.amount}
          onChange={(amount) => patch({ curve: { ...node.curve!, amount } }, { label: 'curve', coalesceMs: 200 })}
        />
      ) : null}
      <Field label="Vertical align">
        <Segmented
          value={node.valign}
          options={[
            { value: 'top', label: 'Top' },
            { value: 'middle', label: 'Middle' },
            { value: 'bottom', label: 'Bottom' }
          ]}
          onChange={(valign) => patch({ valign }, 'valign')}
        />
      </Field>
      <Field label="Vertical padding">
        <NumberInput value={node.padding} min={0} max={400} onChange={(padding) => patch({ padding }, 'padding')} />
      </Field>
      <Button
        size="sm"
        icon={Wand2}
        onClick={() => useUiStore.getState().openModal('ai-text', { text: node.text, nodeId: node.id })}
      >
        AI text tools
      </Button>
    </section>
  )
}

/* -------------------------------- image --------------------------------- */

function ImageSection({ node }: { node: ImageNode }): JSX.Element {
  const update = useEditorStore((state) => state.updateNodes)
  const patch = (values: Partial<ImageNode>, options: PatchOptions = 'image'): void =>
    update([{ id: node.id, patch: values as Partial<SceneNode> }], { coalesceMs: 250, ...toPatchOptions(options) })
  const filters = { ...DEFAULT_IMAGE_FILTERS, ...(node.filters ?? {}) }

  return (
    <section className="k-col" style={{ gap: 8 }}>
      <div className="k-sep" />
      <span className="k-section-title">Image</span>
      <Field label="Mask into shape">
        <Select ariaLabel="Mask shape" value={node.mask ?? 'none'} options={MASK_OPTIONS} onChange={(mask) => patch({ mask }, 'mask')} />
      </Field>
      <Field label="Fit">
        <Segmented
          value={node.fit}
          options={[
            { value: 'cover', label: 'Cover' },
            { value: 'contain', label: 'Contain' }
          ]}
          onChange={(fit) => patch({ fit }, 'fit')}
        />
      </Field>
      <Toggle
        checked={Boolean(node.crop)}
        label="Crop"
        onChange={(value) => patch({ crop: value ? { x: 0, y: 0, width: 1, height: 1 } : null }, 'crop')}
      />
      {node.crop ? (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="Crop X">
            <NumberInput value={node.crop.x} min={0} max={1} step={0.01} onChange={(x) => patch({ crop: { ...node.crop!, x } }, { label: 'crop', coalesceMs: 200 })} />
          </Field>
          <Field label="Crop Y">
            <NumberInput value={node.crop.y} min={0} max={1} step={0.01} onChange={(y) => patch({ crop: { ...node.crop!, y } }, { label: 'crop', coalesceMs: 200 })} />
          </Field>
          <Field label="Crop width">
            <NumberInput value={node.crop.width} min={0.05} max={1} step={0.01} onChange={(width) => patch({ crop: { ...node.crop!, width } }, { label: 'crop', coalesceMs: 200 })} />
          </Field>
          <Field label="Crop height">
            <NumberInput value={node.crop.height} min={0.05} max={1} step={0.01} onChange={(height) => patch({ crop: { ...node.crop!, height } }, { label: 'crop', coalesceMs: 200 })} />
          </Field>
        </div>
      ) : null}

      <div className="k-sep" />
      <div className="k-row-between">
        <span className="k-section-title">Adjustments</span>
        <Button size="sm" variant="ghost" icon={RotateCcw} onClick={() => patch({ filters: { ...DEFAULT_IMAGE_FILTERS } }, 'reset adjustments')}>
          Reset
        </Button>
      </div>
      <Slider label="Brightness" min={-1} max={1} step={0.01} value={filters.brightness} onChange={(brightness) => patch({ filters: { ...filters, brightness } }, { label: 'brightness', coalesceMs: 120 })} format={(v) => `${Math.round(v * 100)}`} />
      <Slider label="Contrast" min={-1} max={1} step={0.01} value={filters.contrast} onChange={(contrast) => patch({ filters: { ...filters, contrast } }, { label: 'contrast', coalesceMs: 120 })} format={(v) => `${Math.round(v * 100)}`} />
      <Slider label="Saturation" min={-1} max={1} step={0.01} value={filters.saturation} onChange={(saturation) => patch({ filters: { ...filters, saturation } }, { label: 'saturation', coalesceMs: 120 })} format={(v) => `${Math.round(v * 100)}`} />
      <Slider label="Blur" min={0} max={60} step={0.5} value={filters.blur} onChange={(blur) => patch({ filters: { ...filters, blur } }, { label: 'blur', coalesceMs: 120 })} format={(v) => `${v}px`} />
      <Slider label="Sharpen" min={0} max={1} step={0.02} value={filters.sharpen} onChange={(sharpen) => patch({ filters: { ...filters, sharpen } }, { label: 'sharpen', coalesceMs: 120 })} />
      <Slider label="Fade" min={0} max={1} step={0.01} value={filters.grayscale} onChange={(grayscale) => patch({ filters: { ...filters, grayscale } }, { label: 'grayscale', coalesceMs: 120 })} />
      <Slider label="Sepia" min={0} max={1} step={0.01} value={filters.sepia} onChange={(sepia) => patch({ filters: { ...filters, sepia } }, { label: 'sepia', coalesceMs: 120 })} />
      <Slider label="Invert" min={0} max={1} step={0.01} value={filters.invert} onChange={(invert) => patch({ filters: { ...filters, invert } }, { label: 'invert', coalesceMs: 120 })} />
      <Slider label="Pixelate" min={0} max={60} step={1} value={filters.pixelate} onChange={(pixelate) => patch({ filters: { ...filters, pixelate } }, { label: 'pixelate', coalesceMs: 120 })} />

      <div className="k-sep" />
      <div className="k-row" style={{ gap: 6 }}>
        <Button
          size="sm"
          icon={Wand2}
          onClick={() => useUiStore.getState().openModal('image', { nodeId: node.id })}
        >
          Background / upscale
        </Button>
      </div>
    </section>
  )
}

/* -------------------------------- shape --------------------------------- */

function ShapeSection({ node }: { node: ShapeNode }): JSX.Element {
  const update = useEditorStore((state) => state.updateNodes)
  const patch = (values: Partial<ShapeNode>, options: PatchOptions = 'shape'): void =>
    update([{ id: node.id, patch: values as Partial<SceneNode> }], { coalesceMs: 250, ...toPatchOptions(options) })

  return (
    <section className="k-col" style={{ gap: 8 }}>
      <div className="k-sep" />
      <span className="k-section-title">Shape</span>
      {node.shape === 'rect' || node.shape === 'pill' ? (
        <Slider
          label="Corner radius"
          min={0}
          max={50}
          value={node.cornerRadius ?? 0}
          onChange={(cornerRadius) => patch({ cornerRadius }, { label: 'corner radius', coalesceMs: 120 })}
          format={(value) => `${value}%`}
        />
      ) : null}
      {node.shape === 'star' ? (
        <Slider label="Points" min={3} max={12} value={node.points ?? 5} onChange={(points) => patch({ points }, 'points')} />
      ) : null}
      {node.shape === 'line' || node.shape === 'arrow' ? (
        <Slider label="Thickness" min={1} max={80} value={node.thickness ?? 4} onChange={(thickness) => patch({ thickness }, { label: 'thickness', coalesceMs: 120 })} />
      ) : null}
    </section>
  )
}

/* -------------------------------- arrange ------------------------------- */

function ArrangeSection({ node }: { node: SceneNode }): JSX.Element {
  const state = useEditorStore()
  return (
    <section className="k-col" style={{ gap: 8 }}>
      <div className="k-sep" />
      <span className="k-section-title">Arrange</span>
      <div className="k-row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <Button size="sm" variant="ghost" icon={ArrowUpToLine} onClick={() => state.reorderSelection('front')} title="Bring to front" />
        <Button size="sm" variant="ghost" icon={ArrowUp} onClick={() => state.reorderSelection('up')} title="Bring forward" />
        <Button size="sm" variant="ghost" icon={ArrowDown} onClick={() => state.reorderSelection('down')} title="Send backward" />
        <Button size="sm" variant="ghost" icon={ArrowDownToLine} onClick={() => state.reorderSelection('back')} title="Send to back" />
        <Button size="sm" variant="ghost" icon={Group} onClick={() => state.groupSelection()} title="Group (Ctrl+G)" />
        <Button size="sm" variant="ghost" icon={Ungroup} onClick={() => state.ungroupSelection()} title="Ungroup (Ctrl+Shift+G)" />
      </div>
      <div className="k-row" style={{ gap: 6 }}>
        <Button size="sm" variant="ghost" icon={Copy} onClick={() => state.duplicateSelection()} title="Duplicate (Ctrl+D)">
          Duplicate
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={Lock}
          active={node.locked}
          onClick={() => state.toggleNodeFlag(node.id, 'locked')}
          title="Lock"
        >
          {node.locked ? 'Locked' : 'Lock'}
        </Button>
        <Button
          size="sm"
          variant="danger"
          icon={Trash2}
          onClick={() => {
            state.deleteNodes([node.id])
            notify.info('Object deleted')
          }}
          title="Delete"
        />
      </div>
    </section>
  )
}

/* --------------------------- multi selection ---------------------------- */

function MultiSelection({ nodes }: { nodes: SceneNode[] }): JSX.Element {
  const state = useEditorStore()
  return (
    <div className="k-col" style={{ gap: 12 }}>
      <div className="k-row-between">
        <span className="k-section-title">{nodes.length} objects selected</span>
      </div>
      <p style={{ color: 'var(--k-text-dim)', fontSize: 12, margin: 0 }}>
        Use the toolbar or shortcuts to align, distribute and group the selection.
      </p>
      <div className="k-row" style={{ gap: 6, flexWrap: 'wrap' }}>
        <Button size="sm" icon={Group} onClick={() => state.groupSelection()}>
          Group
        </Button>
        <Button size="sm" icon={Copy} onClick={() => state.duplicateSelection()}>
          Duplicate
        </Button>
        <Button size="sm" variant="danger" icon={Trash2} onClick={() => state.deleteNodes(nodes.map((n) => n.id))}>
          Delete
        </Button>
      </div>
      <div className="k-sep" />
      <LayerQuickList nodes={nodes} />
    </div>
  )
}

function LayerQuickList({ nodes }: { nodes: SceneNode[] }): JSX.Element {
  return (
    <div className="k-col" style={{ gap: 4 }}>
      <span className="k-section-title">In selection</span>
      {nodes.map((node) => (
        <div key={node.id} className="k-row" style={{ gap: 8, padding: '4px 6px', background: 'var(--k-panel-2)', borderRadius: 6 }}>
          <LayersIcon size={13} color="var(--k-text-mute)" />
          <span className="k-truncate" style={{ flex: 1, fontSize: 12 }}>
            {node.kind === 'text' ? node.text.slice(0, 28) || 'Text' : node.name}
          </span>
          <span className="k-chip">{node.kind}</span>
        </div>
      ))}
    </div>
  )
}

/* ------------------------------- page props ----------------------------- */

function PageProperties({ page }: { page: Page }): JSX.Element {
  const state = useEditorStore()
  const appearance = useAppStore((state) => state.settings.appearance)

  return (
    <div className="k-col" style={{ gap: 12 }}>
      <section className="k-col" style={{ gap: 8 }}>
        <span className="k-section-title">Page</span>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="Width">
            <NumberInput
              value={page.width}
              min={16}
              max={12000}
              onChange={(width) => state.resizeActivePage(width, page.height, false)}
            />
          </Field>
          <Field label="Height">
            <NumberInput
              value={page.height}
              min={16}
              max={12000}
              onChange={(height) => state.resizeActivePage(page.width, height, false)}
            />
          </Field>
        </div>
        <p style={{ fontSize: 11, color: 'var(--k-text-mute)', margin: 0 }}>
          Resizing keeps object positions. Hold no modifier to scale contents separately.
        </p>
      </section>

      <section className="k-col" style={{ gap: 8 }}>
        <div className="k-sep" />
        <span className="k-section-title">Background</span>
        <Segmented
          value={page.background.type}
          options={[
            { value: 'solid', label: 'Solid' },
            { value: 'gradient', label: 'Gradient' },
            { value: 'transparent', label: 'None' }
          ]}
          onChange={(type) => state.updatePageBackground(page.id, { type })}
        />
        {page.background.type !== 'transparent' ? (
          <ColorPicker
            value={page.background.color}
            onChange={(color) => state.updatePageBackground(page.id, { color })}
            label="Colour"
          />
        ) : null}
        {page.background.type === 'gradient' ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6 }}>
            {GRADIENT_PRESETS.map((preset) => (
              <button
                key={preset.id}
                type="button"
                title={preset.label}
                onClick={() => state.updatePageBackground(page.id, { gradient: preset.fill })}
                style={{
                  height: 26,
                  borderRadius: 6,
                  border: '1px solid var(--k-line)',
                  cursor: 'pointer',
                  background: `linear-gradient(${preset.fill.angle ?? 90}deg, ${preset.fill.stops?.[0]?.color ?? '#000'}, ${preset.fill.stops?.[1]?.color ?? '#fff'})`
                }}
              />
            ))}
          </div>
        ) : null}
      </section>

      <section className="k-col" style={{ gap: 8 }}>
        <div className="k-sep" />
        <span className="k-section-title">Guides</span>
        <Toggle label="Show grid" checked={appearance.showGrid} onChange={(value) => void useAppStore.getState().updateSettings({ appearance: { ...appearance, showGrid: value } })} />
        <Toggle label="Snap to grid" checked={appearance.snapToGrid} onChange={(value) => void useAppStore.getState().updateSettings({ appearance: { ...appearance, snapToGrid: value } })} />
        <Toggle label="Snap to objects" checked={appearance.snapToObjects} onChange={(value) => void useAppStore.getState().updateSettings({ appearance: { ...appearance, snapToObjects: value } })} />
        <Toggle label="Alignment guides" checked={appearance.showGuides} onChange={(value) => void useAppStore.getState().updateSettings({ appearance: { ...appearance, showGuides: value } })} />
        <Toggle label="Safe-area guide" checked={appearance.showSafeArea} onChange={(value) => void useAppStore.getState().updateSettings({ appearance: { ...appearance, showSafeArea: value } })} />
        <Field label="Grid size">
          <NumberInput value={appearance.gridSize} min={4} max={400} onChange={(gridSize) => void useAppStore.getState().updateSettings({ appearance: { ...appearance, gridSize } })} />
        </Field>
        {appearance.showSafeArea ? (
          <Slider
            label="Safe area inset"
            min={0}
            max={20}
            step={0.5}
            value={page.safeArea ?? 0}
            onChange={(safeArea) => state.updatePage(page.id, { safeArea })}
            format={(value) => `${value}%`}
          />
        ) : null}
      </section>
    </div>
  )
}
