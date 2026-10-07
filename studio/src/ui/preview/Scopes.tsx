/**
 * Video scopes (waveform, RGB parade, vectorscope, histogram) computed from the live preview canvas.
 * Reads a down-scaled copy of the rendered frame ~12× per second — real measurements of what you see.
 */
import { useEffect, useRef } from 'react';
import { engine } from '@/engine/PlaybackEngine';
import { useUI } from '@/core/uiStore';

export type ScopeMode = 'waveform' | 'parade' | 'vectorscope' | 'histogram';
const MODES: { id: ScopeMode; label: string }[] = [
  { id: 'waveform', label: 'Waveform' },
  { id: 'parade', label: 'RGB parade' },
  { id: 'vectorscope', label: 'Vectorscope' },
  { id: 'histogram', label: 'Histogram' },
];
const SW = 160, SH = 96; // sample size

export function Scopes({ mode }: { mode: ScopeMode }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const out = ref.current!;
    const W = (out.width = 260), H = (out.height = 150);
    const g = out.getContext('2d')!;
    const sample = document.createElement('canvas');
    sample.width = SW;
    sample.height = SH;
    const sg = sample.getContext('2d', { willReadFrequently: true })!;
    let raf = 0;
    let last = 0;
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      if (now - last < 80) return;
      last = now;
      const src = engine.canvas;
      if (!src || !src.width) return;
      try {
        sg.drawImage(src, 0, 0, SW, SH);
      } catch {
        return;
      }
      const d = sg.getImageData(0, 0, SW, SH).data;
      g.fillStyle = 'rgba(8,10,16,0.92)';
      g.fillRect(0, 0, W, H);
      g.strokeStyle = 'rgba(255,255,255,0.12)';
      g.lineWidth = 1;
      if (mode === 'waveform' || mode === 'parade') {
        // graticule 0/25/50/75/100 IRE
        for (let i = 0; i <= 4; i++) {
          const y = 4 + (H - 8) * (1 - i / 4);
          g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
        }
        const img = g.createImageData(W, H);
        const px = img.data;
        const cols = mode === 'parade' ? 3 : 1;
        const colW = W / cols;
        for (let x = 0; x < SW; x++) {
          for (let y = 0; y < SH; y++) {
            const i = (y * SW + x) * 4;
            for (let c = 0; c < cols; c++) {
              const v = mode === 'parade' ? d[i + c] : 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
              const ox = Math.floor(c * colW + (x / SW) * colW);
              const oy = Math.max(0, Math.min(H - 1, Math.round(4 + (H - 8) * (1 - v / 255))));
              const o = (oy * W + ox) * 4;
              if (mode === 'parade') {
                px[o + c] = Math.min(255, px[o + c] + 70);
                px[o + 3] = Math.min(255, px[o + 3] + 70);
              } else {
                px[o] = Math.min(255, px[o] + 40); px[o + 1] = Math.min(255, px[o + 1] + 70); px[o + 2] = Math.min(255, px[o + 2] + 40); px[o + 3] = Math.min(255, px[o + 3] + 60);
              }
            }
          }
        }
        // blend plot over graticule
        const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
        tmp.getContext('2d')!.putImageData(img, 0, 0);
        g.drawImage(tmp, 0, 0);
        g.fillStyle = 'rgba(255,255,255,0.5)';
        g.font = '9px system-ui';
        g.fillText('100', 2, 11); g.fillText('0', 2, H - 5);
      } else if (mode === 'vectorscope') {
        const cx = W / 2, cy = H / 2, R = H / 2 - 4;
        g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.stroke();
        g.beginPath(); g.arc(cx, cy, R * 0.75, 0, Math.PI * 2); g.stroke();
        g.beginPath(); g.moveTo(cx - R, cy); g.lineTo(cx + R, cy); g.moveTo(cx, cy - R); g.lineTo(cx, cy + R); g.stroke();
        // target boxes (75%) for R, Mg, B, Cy, G, Yl
        const targets: [string, number, number, number][] = [['R', 255, 0, 0], ['Mg', 255, 0, 255], ['B', 0, 0, 255], ['Cy', 0, 255, 255], ['G', 0, 255, 0], ['Yl', 255, 255, 0]];
        g.font = '9px system-ui';
        for (const [n, r, gg, b] of targets) {
          const cb = -0.1687 * r - 0.3313 * gg + 0.5 * b, cr = 0.5 * r - 0.4187 * gg - 0.0813 * b;
          const x = cx + (cb / 128) * R * 0.75, y = cy - (cr / 128) * R * 0.75;
          g.strokeStyle = 'rgba(255,255,255,0.35)';
          g.strokeRect(x - 4, y - 4, 8, 8);
          g.fillStyle = 'rgba(255,255,255,0.6)';
          g.fillText(n, x + 6, y + 3);
        }
        // skin-tone line (~123°)
        g.strokeStyle = 'rgba(255,200,160,0.35)';
        g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(-2.13) * R, cy + Math.sin(-2.13) * R); g.stroke();
        const img = g.createImageData(W, H);
        const px = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], gg = d[i + 1], b = d[i + 2];
          const cb = -0.1687 * r - 0.3313 * gg + 0.5 * b, cr = 0.5 * r - 0.4187 * gg - 0.0813 * b;
          const x = Math.round(cx + (cb / 128) * R), y = Math.round(cy - (cr / 128) * R);
          if (x < 0 || x >= W || y < 0 || y >= H) continue;
          const o = (y * W + x) * 4;
          px[o] = Math.min(255, px[o] + r * 0.4 + 60); px[o + 1] = Math.min(255, px[o + 1] + gg * 0.4 + 60); px[o + 2] = Math.min(255, px[o + 2] + b * 0.4 + 60); px[o + 3] = Math.min(255, px[o + 3] + 90);
        }
        const tmp = document.createElement('canvas'); tmp.width = W; tmp.height = H;
        tmp.getContext('2d')!.putImageData(img, 0, 0);
        g.drawImage(tmp, 0, 0);
      } else {
        const hist = [new Float32Array(64), new Float32Array(64), new Float32Array(64), new Float32Array(64)];
        for (let i = 0; i < d.length; i += 4) {
          hist[0][d[i] >> 2]++; hist[1][d[i + 1] >> 2]++; hist[2][d[i + 2] >> 2]++;
          hist[3][Math.min(63, Math.round((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 4))]++;
        }
        const max = Math.max(1, ...hist.flatMap((h) => Array.from(h)).sort((a, b) => b - a).slice(2, 3)); // ignore extreme spikes
        const bw = W / 64;
        const colors = ['rgba(255,80,80,0.55)', 'rgba(80,255,120,0.55)', 'rgba(90,140,255,0.55)', 'rgba(255,255,255,0.35)'];
        g.globalCompositeOperation = 'lighter';
        hist.forEach((h, c) => {
          g.fillStyle = colors[c];
          for (let i = 0; i < 64; i++) {
            const v = Math.min(1, h[i] / max);
            g.fillRect(i * bw, H - 4 - v * (H - 12), bw - 0.5, v * (H - 12));
          }
        });
        g.globalCompositeOperation = 'source-over';
        g.fillStyle = 'rgba(255,255,255,0.5)';
        g.font = '9px system-ui';
        g.fillText('shadows', 3, 10); g.fillText('highlights', W - 50, 10);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [mode]);
  return (
    <div className="scopes" onMouseDown={(e) => e.stopPropagation()}>
      <div className="scopes-tabs">
        {MODES.map((m) => (
          <button key={m.id} className={m.id === mode ? 'active' : ''} onClick={() => useUI.getState().set({ scopes: m.id })}>{m.label}</button>
        ))}
        <button onClick={() => useUI.getState().set({ scopes: null })} title="Close scopes">×</button>
      </div>
      <canvas ref={ref} />
    </div>
  );
}
