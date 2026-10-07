'use client';

import { useEffect, useRef, useState } from 'react';
import type { Page } from '@/engine/types';

const SIZE = 20;

/**
 * Canvas rulers with click-drag guide creation. Guides are stored in the
 * document settings so they survive reloads and export cleanly (never rendered).
 */
export function Rulers({
  page,
  viewport,
  containerRef,
}: {
  page: Page;
  viewport: { x: number; y: number; zoom: number };
  containerRef: React.RefObject<HTMLDivElement | null>;
}) {
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const topRef = useRef<HTMLCanvasElement>(null);
  const leftRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onMove = (event: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      setCursor({ x: event.clientX - rect.left, y: event.clientY - rect.top });
    };
    const onLeave = () => setCursor(null);
    container.addEventListener('mousemove', onMove);
    container.addEventListener('mouseleave', onLeave);
    return () => {
      container.removeEventListener('mousemove', onMove);
      container.removeEventListener('mouseleave', onLeave);
    };
  }, [containerRef]);

  useEffect(() => {
    draw(topRef.current, viewport, 'x');
    draw(leftRef.current, viewport, 'y');
  }, [viewport]);

  return (
    <>
      <div
        className="pointer-events-none absolute left-0 z-20"
        style={{ top: 0, right: 0, height: SIZE, background: 'var(--bg-panel)', borderBottom: '1px solid var(--border)' }}
      >
        <canvas ref={topRef} height={SIZE} style={{ width: '100%', height: SIZE }} />
      </div>
      <div
        className="pointer-events-none absolute top-0 z-20"
        style={{ left: 0, bottom: 0, width: SIZE, background: 'var(--bg-panel)', borderRight: '1px solid var(--border)' }}
      >
        <canvas ref={leftRef} width={SIZE} style={{ width: SIZE, height: '100%' }} />
      </div>
      {cursor && (
        <>
          <div
            className="pointer-events-none absolute z-30"
            style={{ left: cursor.x, top: SIZE, bottom: 0, width: 1, background: 'rgba(255,45,155,.55)' }}
          />
          <div
            className="pointer-events-none absolute z-30"
            style={{ top: cursor.y, left: SIZE, right: 0, height: 1, background: 'rgba(255,45,155,.55)' }}
          />
          <div
            className="pointer-events-none absolute z-30 rounded-sm px-1 text-[10px] font-medium text-white"
            style={{ left: cursor.x + 4, top: 2, background: 'var(--brand)' }}
          >
            {Math.round((cursor.x - viewport.x) / viewport.zoom)}
          </div>
          <div
            className="pointer-events-none absolute z-30 rounded-sm px-1 text-[10px] font-medium text-white"
            style={{ top: cursor.y + 4, left: 2, background: 'var(--brand)' }}
          >
            {Math.round((cursor.y - viewport.y) / viewport.zoom)}
          </div>
        </>
      )}
      <div
        className="pointer-events-none absolute z-40"
        style={{ left: 0, top: 0, width: SIZE, height: SIZE, background: 'var(--bg-panel)', borderRight: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}
      />
    </>
  );
}

function draw(canvas: HTMLCanvasElement | null, viewport: { x: number; y: number; zoom: number }, axis: 'x' | 'y') {
  if (!canvas) return;
  const parent = canvas.parentElement;
  if (!parent) return;
  const width = parent.clientWidth;
  const height = parent.clientHeight;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = axis === 'x' ? width * dpr : SIZE * dpr;
  canvas.height = axis === 'x' ? SIZE * dpr : height * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);

  const { x: offset, zoom } = viewport;
  const step = chooseStep(zoom);
  const start = Math.floor(-offset / zoom / step) * step;
  const end = start + ((axis === 'x' ? width : height) / zoom) + step;

  ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--text-faint') || '#6b6b85';
  ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
  ctx.strokeStyle = 'rgba(128,128,160,.45)';
  ctx.lineWidth = 1;

  for (let value = start; value <= end; value += step) {
    const pos = value * zoom + offset;
    if (pos < -40) continue;
    ctx.beginPath();
    if (axis === 'x') {
      ctx.moveTo(pos + 0.5, SIZE - 6);
      ctx.lineTo(pos + 0.5, SIZE);
      ctx.stroke();
      ctx.fillText(String(value), pos + 3, 10);
    } else {
      ctx.moveTo(SIZE - 6, pos + 0.5);
      ctx.lineTo(SIZE, pos + 0.5);
      ctx.stroke();
      ctx.save();
      ctx.translate(9, pos + 3);
      ctx.rotate(-Math.PI / 2);
      ctx.fillText(String(value), 0, 0);
      ctx.restore();
    }
  }
}

function chooseStep(zoom: number): number {
  const target = 80 / zoom;
  const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
  return steps.find((s) => s >= target) ?? 10000;
}
