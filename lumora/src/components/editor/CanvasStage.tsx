import React, { useEffect, useRef } from 'react';
import { engine } from '@/editor/engine';
import { useEditor } from '@/state/editorStore';
import { useApp } from '@/state/appStore';
import { Icon } from '@/components/common/Icons';

export function CanvasStage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const project = useEditor((s) => s.project);
  const activePage = useEditor((s) => s.activePage);
  const zoom = useEditor((s) => s.zoom);
  const settings = useApp((s) => s.settings);
  const sync = useEditor((s) => s.syncFromEngine);
  const markDirty = useEditor((s) => s.markDirty);
  const page = project?.pages[activePage];

  // Mount the fabric canvas once per screen.
  useEffect(() => {
    if (!canvasRef.current) return;
    engine.mount(canvasRef.current, {
      showGrid: settings?.showGrid ?? false,
      snapToGrid: settings?.snapToGrid ?? true,
      gridSize: settings?.gridSize ?? 20,
      safeArea: settings?.safeAreaGuides ?? false,
      maxUndoSteps: settings?.maxUndoSteps ?? 60
    });
    const offSel = engine.on('selection', sync);
    const offHist = engine.on('history', sync);
    const offZoom = engine.on('zoom', sync);
    const offChange = engine.on('change', () => {
      sync();
      markDirty();
    });
    if (page) void engine.loadPage(page).then(() => fit());
    return () => {
      offSel();
      offHist();
      offZoom();
      offChange();
      engine.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    engine.setOptions({
      showGrid: settings?.showGrid ?? false,
      snapToGrid: settings?.snapToGrid ?? true,
      gridSize: settings?.gridSize ?? 20,
      safeArea: settings?.safeAreaGuides ?? false,
      maxUndoSteps: settings?.maxUndoSteps ?? 60
    });
  }, [settings?.showGrid, settings?.snapToGrid, settings?.gridSize, settings?.safeAreaGuides, settings?.maxUndoSteps]);

  const fit = () => {
    const el = wrapRef.current;
    if (!el) return;
    engine.fit(el.clientWidth - 40, el.clientHeight - 40);
    sync();
  };

  // Keep the page fitted when the window resizes.
  useEffect(() => {
    const ro = new ResizeObserver(() => fit());
    if (wrapRef.current) ro.observe(wrapRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !isEditingField()) {
        engine.setSpace(true);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') engine.setSpace(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files ?? []);
    for (const f of files) {
      if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(f.type)) {
        useApp.getState().toast('Unsupported image format.', 'error');
        continue;
      }
      const dataUrl = await new Promise<string>((res) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.readAsDataURL(f);
      });
      await engine.addImage(dataUrl, f.name);
      useEditor.getState().addUpload({ name: f.name, dataUrl });
    }
  };

  return (
    <div className="stage">
      <div className="row" style={{ padding: '7px 12px', borderBottom: '1px solid var(--line)', gap: 10 }}>
        <span className="muted">
          {page ? `${page.width} × ${page.height} px` : '—'}
        </span>
        <div className="spacer" />
        <button className="btn sm ghost" onClick={() => engine.align('left')} title="Align left">
          ⇤
        </button>
        <button className="btn sm ghost" onClick={() => engine.align('center-h')} title="Center horizontally">
          ⇔
        </button>
        <button className="btn sm ghost" onClick={() => engine.align('right')} title="Align right">
          ⇥
        </button>
        <button className="btn sm ghost" onClick={() => engine.align('top')} title="Align top">
          ⇞
        </button>
        <button className="btn sm ghost" onClick={() => engine.align('center-v')} title="Center vertically">
          ⇕
        </button>
        <button className="btn sm ghost" onClick={() => engine.align('bottom')} title="Align bottom">
          ⇟
        </button>
        <div style={{ width: 1, height: 18, background: 'var(--line)' }} />
        <button
          className="btn sm ghost"
          title="Toggle grid"
          onClick={() => useApp.getState().updateSettings({ showGrid: !settings?.showGrid })}
        >
          <Icon name="grid" size={15} />
        </button>
        <button className="btn sm" onClick={() => engine.zoomBy(1 / 1.15)}>
          −
        </button>
        <span style={{ width: 46, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button className="btn sm" onClick={() => engine.zoomBy(1.15)}>
          +
        </button>
        <button className="btn sm" onClick={fit}>
          Fit
        </button>
      </div>
      <div
        className="stage-scroll"
        ref={wrapRef}
        onDrop={onDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        <div className="canvas-frame">
          <canvas ref={canvasRef} />
        </div>
      </div>
    </div>
  );
}

function isEditingField(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || (el as HTMLElement).isContentEditable;
}
