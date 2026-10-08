import React from 'react';
import { engine } from '@/editor/engine';
import { GRADIENT_PRESETS, SOLID_BACKGROUNDS } from '@/data/elements';
import { bridge } from '@/lib/bridge';
import { useApp } from '@/state/appStore';

export function BackgroundsPanel() {
  const toast = useApp((s) => s.toast);

  const uploadBackground = async () => {
    try {
      const [file] = await bridge.files.pickImages();
      if (file) await engine.setBackgroundImage(file.dataUrl);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <>
      <h3>Backgrounds</h3>
      <span className="label">Solid colours</span>
      <div className="grid-4">
        {SOLID_BACKGROUNDS.map((c) => (
          <button
            key={c}
            className="tile"
            style={{ background: c }}
            title={c}
            onClick={() => engine.setBackground(c)}
          />
        ))}
      </div>
      <button className="btn sm" onClick={() => engine.setBackground(null)}>
        Transparent background
      </button>

      <span className="label">Gradient backgrounds</span>
      <div className="grid-2">
        {GRADIENT_PRESETS.map((g) => (
          <button
            key={g.id}
            className="btn sm"
            style={{ background: `linear-gradient(135deg, ${g.from}, ${g.to})`, color: '#fff', border: 'none', height: 46 }}
            onClick={() => {
              const obj = engine.addGradientRect(g.from, g.to, 'd');
              if (obj) engine.reorder((obj as any).lid, 'back');
            }}
          >
            {g.name}
          </button>
        ))}
      </div>

      <span className="label">Image background</span>
      <button className="btn" onClick={() => void uploadBackground()}>
        Upload background image
      </button>
      <button className="btn sm" onClick={() => engine.clearBackgroundImage()}>
        Remove background image
      </button>
    </>
  );
}
