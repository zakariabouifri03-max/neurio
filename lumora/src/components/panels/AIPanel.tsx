import React, { useState } from 'react';
import { engine } from '@/editor/engine';
import { bridge } from '@/lib/bridge';
import { useApp } from '@/state/appStore';
import { useEditor } from '@/state/editorStore';
import { applyElements, previewSvg, svgDataUrl } from '@/lib/blueprint';
import { Spinner } from '@/components/common/ui';
import { removeBackgroundLocal, upscaleLocal } from '@/lib/imageOps';
import type { DesignBlueprint, DesignRequest } from '@/types/design';

const STYLES = ['modern', 'vintage', 'minimal', 'bold poster', 'hand-drawn', 'retro 80s', 'luxury', 'grunge'];
const PALETTES = ['vibrant', 'vintage', 'pastel', 'monochrome', 'neon', 'earth', 'ocean', 'sunset'];
const TYPOGRAPHY = ['modern', 'bold', 'elegant', 'playful', 'techy', 'classic'];
const ASPECTS = [
  { label: 'Square 1080×1080', value: '1080x1080' },
  { label: 'Story 1080×1920', value: '1080x1920' },
  { label: 'Thumbnail 1280×720', value: '1280x720' },
  { label: 'Poster 1240×1754', value: '1240x1754' },
  { label: 'T-shirt 4500×5400', value: '4500x5400' },
  { label: 'Wide 1920×1080', value: '1920x1080' }
];

export function AIPanel() {
  const toast = useApp((s) => s.toast);
  const secrets = useApp((s) => s.secretStatus);
  const settings = useApp((s) => s.settings);
  const go = useApp((s) => s.go);
  const resizePage = useEditor((s) => s.resizePage);
  const markDirty = useEditor((s) => s.markDirty);

  const [req, setReq] = useState<DesignRequest>({
    prompt: 'Create a vintage Halloween t-shirt design with a cute raccoon.',
    style: 'vintage',
    palette: 'vintage',
    aspect: '4500x5400',
    background: 'solid',
    typography: 'bold',
    complexity: 'balanced'
  });
  const [blueprint, setBlueprint] = useState<DesignBlueprint | null>(null);
  const [source, setSource] = useState<'ai' | 'offline' | null>(null);
  const [busy, setBusy] = useState(false);

  const [imgPrompt, setImgPrompt] = useState('Photorealistic mountain cabin at sunset.');
  const [image, setImage] = useState<string | null>(null);
  const [imgBusy, setImgBusy] = useState(false);

  const generate = async () => {
    setBusy(true);
    const res = await bridge.ai.design(req);
    setBusy(false);
    if (!res.ok) {
      toast(res.error ?? 'Design generation failed.', 'error');
      return;
    }
    const payload = res.data!;
    setBlueprint(payload.blueprint);
    setSource(payload.source);
    toast(payload.source === 'ai' ? 'Design concept generated' : 'Design composed offline (no API key configured)', 'success');
  };

  const place = async () => {
    if (!blueprint) return;
    resizePage(blueprint.width, blueprint.height);
    engine.setBackground(blueprint.background === 'transparent' ? null : blueprint.background);
    await applyElements(blueprint.elements, { clear: true });
    markDirty();
    toast('Design placed on canvas', 'success');
  };

  const regenerateElement = async (index: number) => {
    if (!blueprint) return;
    const el = blueprint.elements[index];
    if (el.type !== 'text') {
      toast('Only text elements can be re-written. Shapes can be edited directly on the canvas.', 'info');
      return;
    }
    const res = await bridge.ai.regenerateText(el.text, req.prompt);
    if (!res.ok) {
      toast(res.error ?? 'Could not regenerate this element.', 'error');
      return;
    }
    const elements = blueprint.elements.slice();
    elements[index] = { ...el, text: res.data ?? el.text };
    setBlueprint({ ...blueprint, elements });
  };

  const genImage = async () => {
    setImgBusy(true);
    const res = await bridge.ai.image({ prompt: imgPrompt, size: '1024x1024', style: req.style });
    setImgBusy(false);
    if (!res.ok) {
      toast(res.error ?? 'Image generation failed.', 'error');
      return;
    }
    setImage(res.data!.dataUrl);
  };

  const imgTool = async (kind: 'bg' | 'upscale') => {
    if (!image) return;
    setImgBusy(true);
    try {
      const local = kind === 'bg' ? settings?.ai.backgroundRemovalProvider !== 'custom' : settings?.ai.upscaleProvider !== 'custom';
      if (local) {
        setImage(kind === 'bg' ? await removeBackgroundLocal(image) : await upscaleLocal(image, 2));
      } else {
        const res = kind === 'bg' ? await bridge.ai.removeBackground(image) : await bridge.ai.upscale(image, 2);
        if (!res.ok) throw new Error(res.error);
        setImage(res.data as string);
      }
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setImgBusy(false);
    }
  };

  const anyKey = secrets.openai || secrets.google || secrets.custom;

  return (
    <>
      <h3>AI Design Generator</h3>
      {!anyKey ? (
        <div className="card" style={{ padding: 10, fontSize: 11 }} >
          No AI provider key configured — designs are composed by the built-in offline layout engine.{' '}
          <button className="btn sm" onClick={() => go('settings')}>
            Add API key
          </button>
        </div>
      ) : null}
      <textarea className="textarea" value={req.prompt} onChange={(e) => setReq({ ...req, prompt: e.target.value })} />
      <div className="grid-2">
        <div>
          <span className="label">Style</span>
          <select className="select" value={req.style} onChange={(e) => setReq({ ...req, style: e.target.value })}>
            {STYLES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <span className="label">Palette</span>
          <select className="select" value={req.palette} onChange={(e) => setReq({ ...req, palette: e.target.value })}>
            {PALETTES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <span className="label">Aspect ratio</span>
          <select className="select" value={req.aspect} onChange={(e) => setReq({ ...req, aspect: e.target.value })}>
            {ASPECTS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="label">Background</span>
          <select
            className="select"
            value={req.background}
            onChange={(e) => setReq({ ...req, background: e.target.value as DesignRequest['background'] })}
          >
            <option value="solid">Solid</option>
            <option value="gradient">Gradient</option>
            <option value="transparent">Transparent</option>
            <option value="image">Image</option>
          </select>
        </div>
        <div>
          <span className="label">Typography</span>
          <select className="select" value={req.typography} onChange={(e) => setReq({ ...req, typography: e.target.value })}>
            {TYPOGRAPHY.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <span className="label">Complexity</span>
          <select
            className="select"
            value={req.complexity}
            onChange={(e) => setReq({ ...req, complexity: e.target.value as DesignRequest['complexity'] })}
          >
            <option value="minimal">Minimal</option>
            <option value="balanced">Balanced</option>
            <option value="rich">Rich</option>
          </select>
        </div>
      </div>
      <button className="btn primary" disabled={busy} onClick={() => void generate()}>
        {busy ? 'Generating…' : 'Generate Design'}
      </button>
      {busy ? <Spinner label="Composing layout…" /> : null}

      {blueprint ? (
        <div className="col">
          <img
            alt="Design preview"
            style={{ width: '100%', borderRadius: 10, border: '1px solid var(--line)', background: '#07070d' }}
            src={svgDataUrl(previewSvg(blueprint.width, blueprint.height, blueprint.background, blueprint.elements))}
          />
          <span className="muted" style={{ fontSize: 11 }}>
            {blueprint.elements.length} elements · {source === 'ai' ? 'model generated' : 'offline composer'}
          </span>
          <button className="btn primary" onClick={() => void place()}>
            Place on canvas
          </button>
          <button className="btn sm" onClick={() => void generate()}>
            Regenerate whole design
          </button>
          <span className="label">Regenerate single element</span>
          <div className="col" style={{ gap: 4 }}>
            {blueprint.elements.map((el, i) =>
              el.type === 'text' ? (
                <button key={el.id ?? i} className="btn sm" onClick={() => void regenerateElement(i)}>
                  ↻ {el.text.slice(0, 28)}
                </button>
              ) : null
            )}
          </div>
        </div>
      ) : null}

      <h3 style={{ marginTop: 12 }}>AI Image Generator</h3>
      <textarea className="textarea" value={imgPrompt} onChange={(e) => setImgPrompt(e.target.value)} />
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn primary" disabled={imgBusy} onClick={() => void genImage()}>
          Generate
        </button>
        <button className="btn sm" disabled={imgBusy || !image} onClick={() => void genImage()}>
          Regenerate
        </button>
        <button className="btn sm" disabled={imgBusy || !image} onClick={() => void imgTool('upscale')}>
          Upscale
        </button>
        <button className="btn sm" disabled={imgBusy || !image} onClick={() => void imgTool('bg')}>
          Remove Background
        </button>
      </div>
      {imgBusy ? <Spinner label="Working on the image…" /> : null}
      {image ? (
        <>
          <img src={image} alt="Generated" style={{ width: '100%', borderRadius: 10, border: '1px solid var(--line)' }} />
          <button className="btn primary" onClick={() => void engine.addImage(image, 'AI image')}>
            Add to Canvas
          </button>
        </>
      ) : null}
    </>
  );
}
