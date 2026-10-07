'use client';

import { useEffect, useRef, useState } from 'react';
import { Crop, Wand2, Maximize2, Eraser, Loader2, RotateCcw, Check, Sparkles } from 'lucide-react';
import { useEditor } from '@/store/editor';
import { Button, Modal, Segmented, Slider, Toggle } from '@/components/ui';
import { useToast } from '@/components/ui/toast';
import { imageDataFromSource, imageDataToDataUrl, processImage } from '@/engine/image/client';
import { FILTER_NAMES, smartCrop, type FilterName } from '@/engine/image/process';
import type { ImageNode, SceneNode } from '@/engine/types';
import type { ImageEditAction } from '../imageEditBus';

type Tab = 'adjust' | 'filters' | 'crop' | 'ai';

export function ImageEditorModal({
  open,
  initialAction,
  node,
  onClose,
}: {
  open: boolean;
  initialAction: ImageEditAction | null;
  node: SceneNode | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const updateNodeDeep = useEditor((s) => s.updateNodeDeep);
  const replaceNode = useEditor((s) => s.replaceNode);
  const [tab, setTab] = useState<Tab>('adjust');
  const [busy, setBusy] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [working, setWorking] = useState<ImageData | null>(null);
  const [adjust, setAdjust] = useState({ brightness: 0, contrast: 1, saturation: 1, temperature: 0, hue: 0, vignette: 0 });
  const [filter, setFilter] = useState<FilterName>('original');
  const [filterIntensity, setFilterIntensity] = useState(100);
  const [crop, setCrop] = useState({ x: 0, y: 0, width: 1, height: 1 });
  const [upscaleFactor, setUpscaleFactor] = useState<2 | 3 | 4>(2);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const src = node && (node.type === 'image' || node.type === 'video') ? (node as ImageNode).src : '';

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setWorking(null);
    setFilter('original');
    setFilterIntensity(100);
    setAdjust({ brightness: 0, contrast: 1, saturation: 1, temperature: 0, hue: 0, vignette: 0 });
    if (initialAction === 'crop') setTab('crop');
    else if (initialAction === 'upscale' || initialAction === 'background' || initialAction === 'enhance') setTab('ai');
    else if (initialAction === 'filters') setTab('filters');
    else setTab('adjust');
  }, [open, initialAction]);

  // Initial AI action runs once when opened with a specific request.
  useEffect(() => {
    if (!open || !initialAction || !src) return;
    if (initialAction === 'background') run('background');
    if (initialAction === 'upscale') run('upscale');
    if (initialAction === 'enhance') run('enhance');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialAction, src]);

  async function run(action: 'background' | 'upscale' | 'enhance' | 'filter' | 'adjust' | 'smartcrop' | 'posterize') {
    if (!src) return;
    setBusy('Working…');
    try {
      const image = working ?? (await imageDataFromSource(src));
      let result: ImageData | { x: number; y: number; width: number; height: number };
      switch (action) {
        case 'background':
          result = (await processImage(image, { kind: 'removeBackground' })) as ImageData;
          break;
        case 'upscale':
          result = (await processImage(image, { kind: 'upscale', factor: upscaleFactor })) as ImageData;
          break;
        case 'enhance':
          result = (await processImage(image, { kind: 'enhance' })) as ImageData;
          break;
        case 'filter':
          result = (await processImage(image, { kind: 'filter', name: filter, intensity: filterIntensity / 100 })) as ImageData;
          break;
        case 'adjust':
          result = (await processImage(image, {
            kind: 'adjust',
            brightness: adjust.brightness,
            contrast: adjust.contrast,
            saturation: adjust.saturation,
            temperature: adjust.temperature,
            hue: adjust.hue,
            vignette: adjust.vignette / 100,
          })) as ImageData;
          break;
        case 'smartcrop':
          result = smartCrop(image, image.width, image.height) as { x: number; y: number; width: number; height: number };
          break;
        default:
          result = (await processImage(image, { kind: 'posterize', levels: 6 })) as ImageData;
      }

      if ('data' in result) {
        setWorking(result as ImageData);
        setPreview(imageDataToDataUrl(result as ImageData));
      } else {
        const box = result as { x: number; y: number; width: number; height: number };
        const next = { x: box.x / image.width, y: box.y / image.height, width: box.width / image.width, height: box.height / image.height };
        setCrop(next);
        if (node) updateNodeDeep(node.id, (target) => void (target.crop = next), { label: 'Smart crop' });
        toast.success('Smart crop applied');
      }
    } catch (error) {
      toast.error('Image operation failed', (error as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function applyToDesign() {
    if (!node || !preview) return;
    replaceNode(node.id, { ...node, src: preview, crop: { x: 0, y: 0, width: 1, height: 1 } }, 'Apply image edit');
    toast.success('Applied to the design');
    onClose();
  }

  function applyCrop() {
    if (!node) return;
    updateNodeDeep(node.id, (target) => void (target.crop = crop), { label: 'Crop image' });
    toast.success('Crop applied');
    onClose();
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Image editor"
      width={760}
      footer={
        <>
          <Button
            variant="ghost"
            icon={<RotateCcw size={13} />}
            onClick={() => {
              setWorking(null);
              setPreview(null);
            }}
          >
            Reset
          </Button>
          {tab === 'crop' ? (
            <Button variant="primary" icon={<Crop size={13} />} onClick={applyCrop}>
              Apply crop
            </Button>
          ) : (
            <Button variant="primary" icon={<Check size={13} />} disabled={!preview} onClick={applyToDesign}>
              Apply to design
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4 p-4">
        <Segmented
          value={tab}
          onChange={(value) => setTab(value as Tab)}
          options={[
            { value: 'adjust', label: <span className="flex items-center gap-1"><Wand2 size={12} /> Adjust</span> },
            { value: 'filters', label: <span className="flex items-center gap-1"><Sparkles size={12} /> Filters</span> },
            { value: 'crop', label: <span className="flex items-center gap-1"><Crop size={12} /> Crop</span> },
            { value: 'ai', label: <span className="flex items-center gap-1"><Eraser size={12} /> AI tools</span> },
          ]}
        />

        <div className="grid gap-4 md:grid-cols-[1fr_240px]">
          <div className="grid min-h-[280px] place-items-center overflow-hidden rounded-xl" style={{ background: 'var(--bg-input)' }}>
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="Preview" className="max-h-[320px] max-w-full object-contain" />
            ) : node && src ? (
              <div className="relative max-h-[320px] overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt="Source"
                  className="max-h-[320px] max-w-full object-contain"
                  style={{
                    filter: `brightness(${1 + adjust.brightness / 100}) contrast(${adjust.contrast}) saturate(${adjust.saturation}) hue-rotate(${adjust.hue}deg)`,
                  }}
                />
                {tab === 'crop' ? (
                  <div
                    className="pointer-events-none absolute border-2"
                    style={{
                      borderColor: 'var(--brand)',
                      left: `${crop.x * 100}%`,
                      top: `${crop.y * 100}%`,
                      width: `${crop.width * 100}%`,
                      height: `${crop.height * 100}%`,
                    }}
                  />
                ) : null}
              </div>
            ) : (
              <p className="text-[12.5px]" style={{ color: 'var(--text-faint)' }}>
                Select an image on the canvas to edit it.
              </p>
            )}
            {busy ? (
              <div className="absolute flex items-center gap-2 text-[12px]" style={{ color: 'var(--text-muted)' }}>
                <Loader2 size={14} className="animate-spin" /> {busy}
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-3">
            {tab === 'adjust' ? (
              <>
                <Slider label="Brightness" value={adjust.brightness} min={-100} max={100} onChange={(value) => setAdjust((a) => ({ ...a, brightness: value }))} />
                <Slider label="Contrast" value={adjust.contrast} min={0.2} max={2.4} step={0.05} onChange={(value) => setAdjust((a) => ({ ...a, contrast: value }))} />
                <Slider label="Saturation" value={adjust.saturation} min={0} max={3} step={0.05} onChange={(value) => setAdjust((a) => ({ ...a, saturation: value }))} />
                <Slider label="Temperature" value={adjust.temperature} min={-100} max={100} onChange={(value) => setAdjust((a) => ({ ...a, temperature: value }))} />
                <Slider label="Hue" value={adjust.hue} min={-180} max={180} onChange={(value) => setAdjust((a) => ({ ...a, hue: value }))} />
                <Slider label="Vignette" value={adjust.vignette} min={0} max={100} onChange={(value) => setAdjust((a) => ({ ...a, vignette: value }))} />
                <Button variant="primary" size="sm" loading={busy === 'Working…'} onClick={() => run('adjust')}>
                  Render adjustment
                </Button>
              </>
            ) : null}

            {tab === 'filters' ? (
              <>
                <div className="grid grid-cols-3 gap-1.5">
                  {FILTER_NAMES.map((name) => (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setFilter(name)}
                      className="rounded-lg px-1.5 py-1 text-[10.5px] capitalize"
                      style={{
                        border: `1px solid ${filter === name ? 'var(--brand)' : 'var(--border)'}`,
                        background: filter === name ? 'var(--brand-soft)' : 'var(--bg-panel)',
                        color: 'var(--text-muted)',
                      }}
                    >
                      {name.replace(/-/g, ' ')}
                    </button>
                  ))}
                </div>
                <Slider label="Intensity" value={filterIntensity} min={0} max={100} onChange={setFilterIntensity} suffix="%" />
                <Button variant="primary" size="sm" disabled={filter === 'original'} loading={busy === 'Working…'} onClick={() => run('filter')}>
                  Apply filter
                </Button>
                <Button variant="secondary" size="sm" onClick={() => run('posterize')}>
                  Posterize
                </Button>
              </>
            ) : null}

            {tab === 'crop' ? (
              <>
                <Slider label="X" value={crop.x} min={0} max={0.9} step={0.01} onChange={(value) => setCrop((c) => ({ ...c, x: value }))} />
                <Slider label="Y" value={crop.y} min={0} max={0.9} step={0.01} onChange={(value) => setCrop((c) => ({ ...c, y: value }))} />
                <Slider label="Width" value={crop.width} min={0.1} max={1} step={0.01} onChange={(value) => setCrop((c) => ({ ...c, width: value }))} />
                <Slider label="Height" value={crop.height} min={0.1} max={1} step={0.01} onChange={(value) => setCrop((c) => ({ ...c, height: value }))} />
                <Button variant="secondary" size="sm" loading={busy === 'Working…'} onClick={() => run('smartcrop')}>
                  Smart crop (saliency)
                </Button>
                <p className="m-0 text-[11px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
                  Smart crop finds the busiest region and keeps it in frame for the current shape.
                </p>
              </>
            ) : null}

            {tab === 'ai' ? (
              <>
                <Button variant="primary" size="sm" icon={<Eraser size={12} />} loading={busy === 'Working…'} onClick={() => run('background')}>
                  Remove background
                </Button>
                <Button variant="secondary" size="sm" icon={<Wand2 size={12} />} loading={busy === 'Working…'} onClick={() => run('enhance')}>
                  Auto-enhance
                </Button>
                <div className="rounded-lg p-2" style={{ background: 'var(--bg-panel)' }}>
                  <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--text-faint)' }}>
                    Upscale
                  </div>
                  <Segmented
                    size="sm"
                    value={String(upscaleFactor)}
                    onChange={(value) => setUpscaleFactor(Number(value) as 2 | 3 | 4)}
                    options={[
                      { value: '2', label: '2×' },
                      { value: '3', label: '3×' },
                      { value: '4', label: '4×' },
                    ]}
                  />
                  <Button variant="secondary" size="sm" className="mt-2 w-full" icon={<Maximize2 size={12} />} loading={busy === 'Working…'} onClick={() => run('upscale')}>
                    Upscale
                  </Button>
                </div>
                <p className="m-0 text-[11px] leading-relaxed" style={{ color: 'var(--text-faint)' }}>
                  All processing runs locally in a web worker — your image never leaves the browser.
                </p>
              </>
            ) : null}
          </div>
        </div>

        <canvas ref={canvasRef} hidden />
      </div>
    </Modal>
  );
}
