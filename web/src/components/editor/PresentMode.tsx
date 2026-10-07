'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, X, Play, Pause, Maximize, Minimize, Grid3x3, Clock } from 'lucide-react';
import { useEditor } from '@/store/editor';
import { NodeView } from './canvas/NodeView';
import type { Page } from '@/engine/types';

/**
 * Presentation mode: fullscreen slide show with per-node entrance animations,
 * slide transitions, speaker notes, a laser-free clicker and a slide navigator.
 */
export function PresentMode({ onExit }: { onExit: () => void }) {
  const doc = useEditor((s) => s.doc);
  const activePage = useEditor((s) => s.activePage);
  const setActivePage = useEditor((s) => s.setActivePage);
  const time = useEditor((s) => s.timeline.time);
  const setTime = useEditor((s) => s.setTime);

  const [showNotes, setShowNotes] = useState(true);
  const [grid, setGrid] = useState(false);
  const [animationKey, setAnimationKey] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  const page: Page | undefined = doc.pages[activePage];

  const go = useCallback(
    (delta: number) => {
      const next = Math.min(doc.pages.length - 1, Math.max(0, activePage + delta));
      if (next !== activePage) {
        setActivePage(next);
        setAnimationKey((value) => value + 1);
      }
    },
    [activePage, doc.pages.length, setActivePage],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === 'PageDown' || event.key === ' ') go(1);
      if (event.key === 'ArrowLeft' || event.key === 'PageUp') go(-1);
      if (event.key === 'Escape') onExit();
      if (event.key === 'g') setGrid((value) => !value);
      if (event.key === 'n') setShowNotes((value) => !value);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onExit]);

  // Slide timer (for the presenter).
  useEffect(() => {
    const id = window.setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => window.clearInterval(id);
  }, [activePage]);

  useEffect(() => {
    const element = document.documentElement;
    if (element.requestFullscreen) element.requestFullscreen().catch(() => undefined);
    return () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => undefined);
    };
  }, []);

  const transition = page?.transition;

  if (!page) return null;

  const scale = Math.min(
    (typeof window !== 'undefined' ? window.innerWidth - 80 : 1200) / page.width,
    (typeof window !== 'undefined' ? window.innerHeight - (showNotes ? 220 : 120) : 800) / page.height,
  );

  return (
    <div className="fixed inset-0 z-[9500] flex flex-col" style={{ background: '#05050a' }}>
      <div className="flex flex-1 items-center justify-center overflow-hidden p-6">
        <div
          key={`${activePage}-${animationKey}`}
          className="relative overflow-hidden shadow-2xl"
          style={{
            width: page.width * scale,
            height: page.height * scale,
            borderRadius: 6,
            animation: transition && transition.type !== 'none' ? `${transition.type === 'fade' ? 'prismFade' : transition.type === 'zoom' ? 'prismZoomIn' : 'prismPanRight'} ${transition.duration}ms ${transition.easing}` : undefined,
          }}
        >
          <div
            style={{
              width: page.width,
              height: page.height,
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              position: 'absolute',
              background: page.background.color,
            }}
          >
            {page.nodes.map((node) => (
              <NodeView key={node.id} node={node} mode="present" animationKey={animationKey} time={time} />
            ))}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------ chrome */}
      <div className="flex items-center gap-3 px-6 pb-4 text-white/80">
        <button type="button" onClick={() => go(-1)} disabled={activePage === 0} className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 disabled:opacity-40" aria-label="Previous slide">
          <ChevronLeft size={16} />
        </button>
        <span className="w-16 text-center text-[12.5px] tabular-nums">
          {activePage + 1} / {doc.pages.length}
        </span>
        <button
          type="button"
          onClick={() => go(1)}
          disabled={activePage === doc.pages.length - 1}
          className="grid h-9 w-9 place-items-center rounded-lg bg-white/10 disabled:opacity-40"
          aria-label="Next slide"
        >
          <ChevronRight size={16} />
        </button>

        <span className="ms-2 flex items-center gap-1.5 text-[12px]">
          <Clock size={12} /> {formatClock(elapsed)}
        </span>

        <div className="ms-auto flex items-center gap-2">
          <button type="button" onClick={() => setGrid((value) => !value)} className="grid h-9 w-9 place-items-center rounded-lg bg-white/10" aria-label="Slide grid">
            <Grid3x3 size={15} />
          </button>
          <button type="button" onClick={() => setShowNotes((value) => !value)} className="h-9 rounded-lg bg-white/10 px-3 text-[12px]">
            {showNotes ? 'Hide notes' : 'Notes'}
          </button>
          <button type="button" onClick={onExit} className="grid h-9 w-9 place-items-center rounded-lg bg-white/10" aria-label="Exit">
            <X size={16} />
          </button>
        </div>
      </div>

      {showNotes ? (
        <div className="mx-6 mb-6 max-h-[120px] overflow-y-auto rounded-xl bg-white/5 p-4 text-[13px] leading-relaxed text-white/70">
          <div className="mb-1 text-[11px] uppercase tracking-wide text-white/40">Speaker notes — {page.name}</div>
          {page.notes?.trim() ? page.notes : 'No notes for this slide yet.'}
        </div>
      ) : null}

      {grid ? (
        <div className="absolute inset-0 z-10 overflow-y-auto bg-black/90 p-8">
          <div className="mb-4 flex items-center justify-between text-white">
            <span className="text-[14px] font-semibold">All slides</span>
            <button type="button" onClick={() => setGrid(false)}>
              <X size={18} />
            </button>
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {doc.pages.map((item, index) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActivePage(index);
                  setGrid(false);
                  setAnimationKey((value) => value + 1);
                }}
                className="overflow-hidden rounded-lg"
                style={{ border: `2px solid ${index === activePage ? 'var(--brand)' : 'transparent'}` }}
              >
                <div style={{ width: item.width, height: item.height, transform: 'scale(0.2)', transformOrigin: 'top left' }}>
                  <div style={{ width: item.width * 5, height: item.height * 5 }}>
                    <SlideThumb page={item} />
                  </div>
                </div>
                <div className="bg-white/10 px-2 py-1 text-left text-[11px] text-white/70">
                  {index + 1}. {item.name}
                </div>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SlideThumb({ page }: { page: Page }) {
  const scale = 0.2;
  return (
    <div
      style={{
        width: page.width,
        height: page.height,
        transform: `scale(${scale})`,
        transformOrigin: 'top left',
        background: page.background.color,
        position: 'absolute',
      }}
    >
      {page.nodes.map((node) => (
        <NodeView key={node.id} node={node} mode="thumb" />
      ))}
    </div>
  );
}

function formatClock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

export { Play, Pause, Maximize, Minimize };
