import React from 'react';
import { engine } from '@/editor/engine';
import { bridge } from '@/lib/bridge';
import { useEditor } from '@/state/editorStore';
import { useApp } from '@/state/appStore';
import { Empty } from '@/components/common/ui';

export function UploadsPanel() {
  const uploads = useEditor((s) => s.uploads);
  const addUpload = useEditor((s) => s.addUpload);
  const toast = useApp((s) => s.toast);

  const pick = async () => {
    try {
      const files = await bridge.files.pickImages();
      files.forEach(addUpload);
      if (files.length === 1) await engine.addImage(files[0].dataUrl, files[0].name);
      if (files.length) toast(`${files.length} image(s) added to uploads`, 'success');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <>
      <h3>Uploads</h3>
      <button className="btn primary" onClick={() => void pick()}>
        Upload images
      </button>
      <span className="muted" style={{ fontSize: 11 }}>
        PNG, JPG, WEBP, GIF and SVG. You can also drag files straight onto the canvas.
      </span>
      <div className="grid-3">
        {uploads.map((u, i) => (
          <button
            key={`${u.name}-${i}`}
            className="tile"
            title={u.name}
            onClick={() => void engine.addImage(u.dataUrl, u.name)}
          >
            <img src={u.dataUrl} alt={u.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          </button>
        ))}
      </div>
      {!uploads.length ? <Empty text="Your uploaded images appear here." /> : null}
    </>
  );
}
