import React from 'react';
import { engine } from '@/editor/engine';
import { useEditor } from '@/state/editorStore';
import { bridge } from '@/lib/bridge';
import { useApp } from '@/state/appStore';
import { FONT_STACKS } from '@/data/elements';

export function BrandPanel() {
  const project = useEditor((s) => s.project);
  const markDirty = useEditor((s) => s.markDirty);
  const toast = useApp((s) => s.toast);
  const kit = project?.brandKit ?? { colors: [], fonts: [], logos: [] };

  const update = (patch: Partial<typeof kit>) => {
    if (!project) return;
    useEditor.setState({ project: { ...project, brandKit: { ...kit, ...patch } } });
    markDirty();
  };

  return (
    <>
      <h3>Brand Kit</h3>
      <span className="label">Brand colours</span>
      <div className="grid-4">
        {kit.colors.map((c, i) => (
          <button
            key={`${c}-${i}`}
            className="tile"
            style={{ background: c }}
            title={`${c} — click to apply to selection`}
            onClick={() => engine.update({ fill: c })}
            onContextMenu={(e) => {
              e.preventDefault();
              update({ colors: kit.colors.filter((_, j) => j !== i) });
            }}
          />
        ))}
      </div>
      <div className="row">
        <input type="color" defaultValue="#7c5cff" id="brand-color" />
        <button
          className="btn sm"
          onClick={() => {
            const el = document.getElementById('brand-color') as HTMLInputElement;
            update({ colors: [...kit.colors, el.value] });
          }}
        >
          Add colour
        </button>
      </div>

      <span className="label">Brand fonts</span>
      {kit.fonts.map((f) => (
        <button key={f} className="btn sm" onClick={() => engine.update({ fontFamily: f })}>
          {f}
        </button>
      ))}
      <select
        className="select"
        value=""
        onChange={(e) => e.target.value && update({ fonts: Array.from(new Set([...kit.fonts, e.target.value])) })}
      >
        <option value="">Add a font…</option>
        {FONT_STACKS.map((f) => (
          <option key={f}>{f}</option>
        ))}
      </select>

      <span className="label">Logos</span>
      <div className="grid-3">
        {kit.logos.map((l, i) => (
          <button key={i} className="tile" onClick={() => void engine.addImage(l, 'Logo')}>
            <img src={l} alt="logo" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </button>
        ))}
      </div>
      <button
        className="btn sm"
        onClick={async () => {
          try {
            const files = await bridge.files.pickImages();
            if (files.length) update({ logos: [...kit.logos, ...files.map((f) => f.dataUrl)] });
          } catch (err) {
            toast((err as Error).message, 'error');
          }
        }}
      >
        Upload logo
      </button>
    </>
  );
}
