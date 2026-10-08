import React, { useEffect, useState } from 'react';
import { Modal } from '@/components/common/ui';
import { useEditor, snapshotPages } from '@/state/editorStore';
import { renderPage } from '@/lib/exporter';
import { useApp } from '@/state/appStore';

export function PreviewModal() {
  const open = useEditor((s) => s.previewOpen);
  const setOpen = useEditor((s) => s.setPreview);
  const project = useEditor((s) => s.project);
  const toast = useApp((s) => s.toast);
  const [images, setImages] = useState<string[]>([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    setImages([]);
    setIndex(0);
    (async () => {
      try {
        const pages = snapshotPages();
        const urls: string[] = [];
        for (const page of pages) {
          urls.push(
            await renderPage(page, {
              format: 'png',
              scale: Math.min(1, 1400 / Math.max(page.width, page.height)),
              quality: 0.9,
              transparent: false,
              pageIndexes: []
            })
          );
        }
        setImages(urls);
      } catch (err) {
        toast(`Preview failed. ${(err as Error).message}`, 'error');
      }
    })();
  }, [open, toast]);

  if (!open || !project) return null;

  return (
    <Modal title={`Preview — ${project.name}`} width={1000} onClose={() => setOpen(false)}>
      {images.length ? (
        <>
          <img
            src={images[index]}
            alt={`Page ${index + 1}`}
            style={{ width: '100%', borderRadius: 10, background: '#0a0a12', objectFit: 'contain', maxHeight: '60vh' }}
          />
          <div className="row" style={{ justifyContent: 'center' }}>
            <button className="btn" disabled={index === 0} onClick={() => setIndex(index - 1)}>
              ‹ Prev
            </button>
            <span className="muted">
              Page {index + 1} of {images.length}
            </span>
            <button className="btn" disabled={index >= images.length - 1} onClick={() => setIndex(index + 1)}>
              Next ›
            </button>
          </div>
        </>
      ) : (
        <span className="muted">Rendering preview…</span>
      )}
    </Modal>
  );
}
