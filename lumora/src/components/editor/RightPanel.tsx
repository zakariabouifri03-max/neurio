import React from 'react';
import * as fabric from 'fabric';
import { engine } from '@/editor/engine';
import { useEditor } from '@/state/editorStore';
import { useApp } from '@/state/appStore';
import { ColorInput, Empty, NumberInput, Slider } from '@/components/common/ui';
import { FONT_STACKS } from '@/data/elements';
import { LayersPanel } from './LayersPanel';
import { removeBackgroundLocal, upscaleLocal } from '@/lib/imageOps';
import { bridge } from '@/lib/bridge';

export function RightPanel() {
  const rightTab = useEditor((s) => s.rightTab);
  const setRightTab = useEditor((s) => s.setRightTab);

  return (
    <div className="right">
      <div className="tabs">
        <button className={rightTab === 'design' ? 'active' : ''} onClick={() => setRightTab('design')}>
          Properties
        </button>
        <button className={rightTab === 'layers' ? 'active' : ''} onClick={() => setRightTab('layers')}>
          Layers
        </button>
      </div>
      {rightTab === 'design' ? <Properties /> : <LayersPanel />}
    </div>
  );
}

function Properties() {
  const sel = useEditor((s) => s.selection);
  const project = useEditor((s) => s.project);
  const activePage = useEditor((s) => s.activePage);
  const resizePage = useEditor((s) => s.resizePage);
  const fonts = useEditor((s) => s.fonts);
  const toast = useApp((s) => s.toast);
  const settings = useApp((s) => s.settings);
  const page = project?.pages[activePage];

  if (!sel) {
    return (
      <div>
        <div className="section">
          <span className="title">Page</span>
          <div className="grid-2">
            <div>
              <span className="label">Width</span>
              <NumberInput value={page?.width ?? 0} onChange={(v) => v > 0 && resizePage(Math.round(v), page!.height)} />
            </div>
            <div>
              <span className="label">Height</span>
              <NumberInput value={page?.height ?? 0} onChange={(v) => v > 0 && resizePage(page!.width, Math.round(v))} />
            </div>
          </div>
          <span className="label">Background</span>
          <ColorInput
            value={page?.background ?? 'transparent'}
            allowTransparent
            onChange={(v) => {
              engine.setBackground(v === 'transparent' ? null : v);
            }}
          />
          <button className="btn sm" onClick={() => engine.clearBackgroundImage()}>
            Clear background image
          </button>
        </div>
        <div className="section">
          <span className="title">Canvas guides</span>
          <label className="row" style={{ justifyContent: 'space-between' }}>
            <span>Grid</span>
            <input
              type="checkbox"
              checked={settings?.showGrid ?? false}
              onChange={(e) => useApp.getState().updateSettings({ showGrid: e.target.checked })}
            />
          </label>
          <label className="row" style={{ justifyContent: 'space-between' }}>
            <span>Snap to grid</span>
            <input
              type="checkbox"
              checked={settings?.snapToGrid ?? true}
              onChange={(e) => useApp.getState().updateSettings({ snapToGrid: e.target.checked })}
            />
          </label>
          <label className="row" style={{ justifyContent: 'space-between' }}>
            <span>Safe-area guides</span>
            <input
              type="checkbox"
              checked={settings?.safeAreaGuides ?? false}
              onChange={(e) => useApp.getState().updateSettings({ safeAreaGuides: e.target.checked })}
            />
          </label>
          <div>
            <span className="label">Grid size</span>
            <NumberInput
              value={settings?.gridSize ?? 20}
              min={4}
              max={200}
              onChange={(v) => useApp.getState().updateSettings({ gridSize: Math.max(4, Math.round(v)) })}
            />
          </div>
        </div>
        <Empty text="Select an object on the canvas to edit its properties." />
      </div>
    );
  }

  const set = (patch: Record<string, unknown>, commit = true) => engine.update(patch, commit);

  const imageAction = async (kind: 'removebg' | 'upscale') => {
    const dataUrl = engine.activeImageDataUrl();
    if (!dataUrl) return;
    try {
      const providerLocal =
        kind === 'removebg'
          ? settings?.ai.backgroundRemovalProvider !== 'custom'
          : settings?.ai.upscaleProvider !== 'custom';
      toast(kind === 'removebg' ? 'Removing background…' : 'Upscaling…');
      let result: string;
      if (providerLocal) {
        result = kind === 'removebg' ? await removeBackgroundLocal(dataUrl) : await upscaleLocal(dataUrl, 2);
      } else {
        const res = kind === 'removebg' ? await bridge.ai.removeBackground(dataUrl) : await bridge.ai.upscale(dataUrl, 2);
        if (!res.ok) throw new Error(res.error);
        result = res.data as string;
      }
      await engine.replaceActiveImageSrc(result);
      toast(kind === 'removebg' ? 'Background removed' : 'Image upscaled', 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div>
      <div className="section">
        <span className="title">
          {sel.count > 1 ? `${sel.count} objects selected` : sel.name}
        </span>
        <div className="grid-2">
          <div>
            <span className="label">X</span>
            <NumberInput value={sel.left} onChange={(v) => set({ left: v })} />
          </div>
          <div>
            <span className="label">Y</span>
            <NumberInput value={sel.top} onChange={(v) => set({ top: v })} />
          </div>
          <div>
            <span className="label">W</span>
            <NumberInput
              value={sel.width}
              min={1}
              onChange={(v) => {
                const obj = engine.canvas?.getActiveObject() as any;
                if (obj && v > 0) set({ scaleX: (obj.scaleX ?? 1) * (v / sel.width) });
              }}
            />
          </div>
          <div>
            <span className="label">H</span>
            <NumberInput
              value={sel.height}
              min={1}
              onChange={(v) => {
                const obj = engine.canvas?.getActiveObject() as any;
                if (obj && v > 0) set({ scaleY: (obj.scaleY ?? 1) * (v / sel.height) });
              }}
            />
          </div>
        </div>
        <Slider label="Rotation" min={-180} max={180} step={1} value={sel.angle} display={`${sel.angle}°`} onChange={(v) => set({ angle: v }, false)} onCommit={() => set({}, true)} />
        <Slider label="Opacity" min={0} max={1} step={0.01} value={sel.opacity} display={`${Math.round(sel.opacity * 100)}%`} onChange={(v) => set({ opacity: v }, false)} onCommit={() => set({}, true)} />
        <div className="row">
          <button className="btn sm" onClick={() => engine.flip('x')}>
            Flip H
          </button>
          <button className="btn sm" onClick={() => engine.flip('y')}>
            Flip V
          </button>
          <button className="btn sm" onClick={() => engine.group()} title="Ctrl+G">
            Group
          </button>
          <button className="btn sm" onClick={() => engine.ungroup()} title="Ctrl+Shift+G">
            Ungroup
          </button>
        </div>
      </div>

      {!sel.isImage ? (
        <div className="section">
          <span className="title">Fill &amp; stroke</span>
          <ColorInput value={sel.fill} onChange={(v) => set({ fill: v })} />
          <span className="label">Stroke</span>
          <ColorInput value={sel.stroke || '#000000'} onChange={(v) => set({ stroke: v })} />
          <Slider label="Stroke width" min={0} max={60} step={1} value={sel.strokeWidth} onChange={(v) => set({ strokeWidth: v }, false)} onCommit={() => set({}, true)} />
          {sel.type === 'rect' ? (
            <Slider label="Border radius" min={0} max={300} step={1} value={sel.rx} onChange={(v) => set({ rx: v, ry: v }, false)} onCommit={() => set({}, true)} />
          ) : null}
        </div>
      ) : null}

      {sel.isText ? (
        <div className="section">
          <span className="title">Text</span>
          <textarea
            className="textarea"
            value={sel.text}
            onChange={(e) => set({ text: e.target.value }, false)}
            onBlur={() => set({}, true)}
          />
          <select className="select" value={sel.fontFamily} onChange={(e) => set({ fontFamily: e.target.value })}>
            {[...new Set([...FONT_STACKS, ...fonts])].map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <div className="grid-2">
            <div>
              <span className="label">Size</span>
              <NumberInput value={sel.fontSize} min={4} onChange={(v) => set({ fontSize: v })} />
            </div>
            <div>
              <span className="label">Line height</span>
              <NumberInput value={sel.lineHeight} step={0.05} min={0.4} onChange={(v) => set({ lineHeight: v })} />
            </div>
          </div>
          <Slider label="Letter spacing" min={-200} max={1200} step={10} value={sel.charSpacing} onChange={(v) => set({ charSpacing: v }, false)} onCommit={() => set({}, true)} />
          <div className="row">
            <button className={`btn sm ${sel.fontWeight === 'bold' ? 'primary' : ''}`} onClick={() => set({ fontWeight: sel.fontWeight === 'bold' ? 'normal' : 'bold' })}>
              <b>B</b>
            </button>
            <button className={`btn sm ${sel.fontStyle === 'italic' ? 'primary' : ''}`} onClick={() => set({ fontStyle: sel.fontStyle === 'italic' ? 'normal' : 'italic' })}>
              <i>I</i>
            </button>
            <button className={`btn sm ${sel.underline ? 'primary' : ''}`} onClick={() => set({ underline: !sel.underline })}>
              <u>U</u>
            </button>
            <div className="spacer" />
            {(['left', 'center', 'right', 'justify'] as const).map((a) => (
              <button key={a} className={`btn sm ${sel.textAlign === a ? 'primary' : ''}`} onClick={() => set({ textAlign: a })}>
                {a[0].toUpperCase()}
              </button>
            ))}
          </div>
          <Slider label="Curve text" min={-100} max={100} step={1} value={sel.curve} onChange={(v) => engine.setCurve(v)} />
          <div className="row">
            <button
              className="btn sm"
              onClick={() =>
                set(gradientFill())
              }
              title="Apply a gradient fill to the text"
            >
              Gradient text
            </button>
            <button className="btn sm" onClick={() => set({ stroke: '#000000', strokeWidth: 2, paintFirst: 'stroke' })}>
              Outline
            </button>
            <button
              className="btn sm"
              onClick={() => engine.setShadow({ color: 'rgba(0,0,0,0.55)', blur: 18, offsetX: 6, offsetY: 8 })}
            >
              Shadow
            </button>
          </div>
        </div>
      ) : null}

      <div className="section">
        <span className="title">Shadow</span>
        <ColorInput value={sel.shadowColor} onChange={(v) => engine.setShadow({ color: v, blur: sel.shadowBlur, offsetX: sel.shadowOffsetX, offsetY: sel.shadowOffsetY })} />
        <Slider label="Blur" min={0} max={120} step={1} value={sel.shadowBlur} onChange={(v) => engine.setShadow({ color: sel.shadowColor, blur: v, offsetX: sel.shadowOffsetX, offsetY: sel.shadowOffsetY })} />
        <div className="grid-2">
          <div>
            <span className="label">Offset X</span>
            <NumberInput value={sel.shadowOffsetX} onChange={(v) => engine.setShadow({ color: sel.shadowColor, blur: sel.shadowBlur, offsetX: v, offsetY: sel.shadowOffsetY })} />
          </div>
          <div>
            <span className="label">Offset Y</span>
            <NumberInput value={sel.shadowOffsetY} onChange={(v) => engine.setShadow({ color: sel.shadowColor, blur: sel.shadowBlur, offsetX: sel.shadowOffsetX, offsetY: v })} />
          </div>
        </div>
        <button className="btn sm" onClick={() => engine.setShadow(null)}>
          Remove shadow
        </button>
      </div>

      {sel.isImage ? (
        <>
          <div className="section">
            <span className="title">Adjustments</span>
            <Slider label="Brightness" min={-1} max={1} step={0.02} value={sel.brightness} onChange={(v) => engine.applyImageAdjustments({ brightness: v, contrast: sel.contrast, saturation: sel.saturation, blur: sel.blur })} />
            <Slider label="Contrast" min={-1} max={1} step={0.02} value={sel.contrast} onChange={(v) => engine.applyImageAdjustments({ brightness: sel.brightness, contrast: v, saturation: sel.saturation, blur: sel.blur })} />
            <Slider label="Saturation" min={-1} max={1} step={0.02} value={sel.saturation} onChange={(v) => engine.applyImageAdjustments({ brightness: sel.brightness, contrast: sel.contrast, saturation: v, blur: sel.blur })} />
            <Slider label="Blur" min={0} max={1} step={0.02} value={sel.blur} onChange={(v) => engine.applyImageAdjustments({ brightness: sel.brightness, contrast: sel.contrast, saturation: sel.saturation, blur: v })} />
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {(['none', 'grayscale', 'sepia', 'invert', 'vintage', 'cool', 'warm'] as const).map((p) => (
                <button key={p} className="btn sm" onClick={() => engine.applyPresetFilter(p)}>
                  {p}
                </button>
              ))}
            </div>
          </div>
          <div className="section">
            <span className="title">Image tools</span>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <button className="btn sm" onClick={() => void imageAction('removebg')}>
                Remove background
              </button>
              <button className="btn sm" onClick={() => void imageAction('upscale')}>
                Upscale ×2
              </button>
              <button className="btn sm" onClick={() => void engine.cropActiveImage({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 })}>
                Crop 10%
              </button>
            </div>
            <span className="label">Mask into shape</span>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              {(['none', 'circle', 'rounded', 'triangle', 'star'] as const).map((s) => (
                <button key={s} className="btn sm" onClick={() => engine.maskActiveImage(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        </>
      ) : null}

      <div className="section">
        <span className="title">Layer</span>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <button className="btn sm" onClick={() => reorderActive('front')}>
            Bring to front
          </button>
          <button className="btn sm" onClick={() => reorderActive('up')}>
            Forward
          </button>
          <button className="btn sm" onClick={() => reorderActive('down')}>
            Backward
          </button>
          <button className="btn sm" onClick={() => reorderActive('back')}>
            Send to back
          </button>
        </div>
      </div>
    </div>
  );
}

function reorderActive(action: 'up' | 'down' | 'front' | 'back') {
  const obj = engine.canvas?.getActiveObject() as any;
  if (obj?.lid) engine.reorder(obj.lid, action);
}

function gradientFill() {
  const obj = engine.canvas?.getActiveObject() as any;
  if (!obj) return {};
  const width = obj.width ?? 200;
  return {
    fill: new fabric.Gradient({
      type: 'linear',
      coords: { x1: 0, y1: 0, x2: width, y2: 0 },
      colorStops: [
        { offset: 0, color: '#7c5cff' },
        { offset: 1, color: '#ff3d9a' }
      ]
    })
  };
}
