import React, { useState } from 'react';
import { engine } from '@/editor/engine';
import { bridge } from '@/lib/bridge';
import { useApp } from '@/state/appStore';
import { useEditor } from '@/state/editorStore';
import { Spinner } from '@/components/common/ui';

const AI_TASKS = [
  { id: 'headline', label: 'Generate headline' },
  { id: 'rewrite', label: 'Rewrite text' },
  { id: 'shorter', label: 'Make shorter' },
  { id: 'longer', label: 'Make longer' },
  { id: 'professional', label: 'Professional tone' },
  { id: 'funny', label: 'Funny tone' },
  { id: 'marketing', label: 'Marketing copy' },
  { id: 'product', label: 'Product description' },
  { id: 'slogans', label: 'Generate slogans' },
  { id: 'caption', label: 'Social captions' }
] as const;

export function TextPanel() {
  const toast = useApp((s) => s.toast);
  const online = useApp((s) => s.online);
  const addFont = useEditor((s) => s.addFont);
  const selection = useEditor((s) => s.selection);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState('');

  const uploadFont = async () => {
    try {
      const fonts = await bridge.files.pickFonts();
      for (const f of fonts) {
        const face = new FontFace(f.family, `url(${f.dataUrl})`);
        await face.load();
        (document.fonts as any).add(face);
        addFont(f.family);
      }
      if (fonts.length) toast(`${fonts.length} font(s) installed for this session`, 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const runAI = async (task: string) => {
    const source = input.trim() || selection?.text || '';
    if (!source) {
      toast('Type a prompt or select a text layer first.', 'error');
      return;
    }
    setBusy(task);
    const res = await bridge.ai.text(task, source);
    setBusy(null);
    if (!res.ok) {
      toast(res.error ?? 'AI request failed.', 'error');
      return;
    }
    setResult(res.data ?? '');
  };

  return (
    <>
      <h3>Text</h3>
      <button className="btn primary" onClick={() => engine.addText('Your headline', 'heading')}>
        Add a heading
      </button>
      <button className="btn" onClick={() => engine.addText('Your subheading', 'subheading')}>
        Add a subheading
      </button>
      <button className="btn" onClick={() => engine.addText('Body text — double-click on canvas to edit.', 'body')}>
        Add body text
      </button>
      <button className="btn" onClick={() => engine.addText('Caption', 'caption')}>
        Add caption
      </button>
      <button className="btn sm" onClick={() => void uploadFont()}>
        Upload font…
      </button>

      <h3 style={{ marginTop: 10 }}>Text effects</h3>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <button className="btn sm" onClick={() => engine.update({ stroke: '#000000', strokeWidth: 2, paintFirst: 'stroke' })}>
          Outline
        </button>
        <button className="btn sm" onClick={() => engine.setShadow({ color: 'rgba(0,0,0,0.6)', blur: 20, offsetX: 6, offsetY: 8 })}>
          Shadow
        </button>
        <button className="btn sm" onClick={() => engine.setCurve(40)}>
          Curve
        </button>
        <button className="btn sm" onClick={() => engine.setCurve(0)}>
          Flatten
        </button>
        <button className="btn sm" onClick={() => engine.update({ skewX: 12 })}>
          Warp
        </button>
        <button className="btn sm" onClick={() => engine.update({ skewX: 0, skewY: 0, angle: 0 })}>
          Reset warp
        </button>
      </div>

      <h3 style={{ marginTop: 10 }}>AI copywriter</h3>
      <span className="muted" style={{ fontSize: 11 }}>
        {online ? 'Uses your configured text provider.' : 'Offline — connect to use AI copy tools.'}
      </span>
      <textarea
        className="textarea"
        placeholder="Describe what you need, or select a text layer on the canvas…"
        value={input}
        onChange={(e) => setInput(e.target.value)}
      />
      <div className="grid-2">
        {AI_TASKS.map((t) => (
          <button key={t.id} className="btn sm" disabled={Boolean(busy)} onClick={() => void runAI(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      {busy ? <Spinner label="Generating copy…" /> : null}
      {result ? (
        <div className="card" style={{ padding: 10, whiteSpace: 'pre-wrap', fontSize: 12 }}>
          {result}
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn sm primary" onClick={() => engine.addText(result, 'body')}>
              Add to canvas
            </button>
            <button
              className="btn sm"
              disabled={!selection?.isText}
              onClick={() => engine.update({ text: result })}
            >
              Replace selected
            </button>
            <button className="btn sm" onClick={() => void navigator.clipboard.writeText(result)}>
              Copy
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}
