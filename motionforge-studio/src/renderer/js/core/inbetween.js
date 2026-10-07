// Auto Inbetween: generate in-between keys (every N frames) between existing keyframes. Computation runs in a Web Worker.
import { S, layerById } from './state.js';
import { H } from './history.js';
import { ease } from './anim.js';

let worker = null, seq = 0; const pending = new Map();
function getWorker() {
  if (worker === false) return null; if (worker) return worker;
  try { worker = new Worker(new URL('../workers/inbetween.js', import.meta.url)); worker.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); e.data.error ? p.reject(new Error(e.data.error)) : p.resolve(e.data); } }; worker.onerror = () => { worker = false; for (const p of pending.values()) p.reject(new Error('worker failed')); pending.clear(); }; return worker; } catch { worker = false; return null; }
}
export function computeLocal(tracks, n, easing) {
  const out = {}; let count = 0;
  for (const [name, keys] of Object.entries(tracks)) {
    const real = keys.filter((k) => !k.ib); const add = [];
    for (let i = 0; i + 1 < real.length; i++) {
      const a = real[i], b = real[i + 1]; const e0 = a.ibE || a.e || 'easeInOut'; if (e0 === 'hold' || b.f - a.f <= n) continue; if (Math.abs(a.v - b.v) < 1e-9) continue;
      const use = easing === 'keep' ? e0 : easing;
      for (let f = a.f + n; f < b.f - Math.max(1, n / 2) + 0.001; f += n) { const t = (f - a.f) / (b.f - a.f); add.push({ f, v: a.v + (b.v - a.v) * ease(t, use, a.bz), e: 'linear', ib: true }); count++; }
    }
    if (add.length) out[name] = add;
  }
  return { out, count };
}
async function compute(tracks, n, easing) {
  const w = getWorker();
  if (w) { try { return await new Promise((resolve, reject) => { const id = ++seq; pending.set(id, { resolve, reject }); w.postMessage({ id, tracks, n, ease: easing }); setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout')); } }, 15000); }); } catch (e) { console.warn('inbetween worker fallback:', e.message); } }
  return computeLocal(tracks, n, easing);
}
export function clearInbetweens(layer) {
  for (const tr of Object.values(layer.tracks || {})) {
    for (let i = tr.length - 1; i >= 0; i--) if (tr[i].ib) tr.splice(i, 1);
    for (const k of tr) if (k.ibE) { k.e = k.ibE; delete k.ibE; }
  }
}
/** Returns number of keys added. Re-running replaces previously generated keys ("regenerate"). */
export async function autoInbetween(layerId, n, easing = 'keep') {
  const l0 = layerById(layerId); if (!l0) return 0;
  // work on cleaned copies of tracks
  const clone = JSON.parse(JSON.stringify(l0.tracks || {}));
  for (const tr of Object.values(clone)) { for (let i = tr.length - 1; i >= 0; i--) if (tr[i].ib) tr.splice(i, 1); }
  for (const tr of Object.values(clone)) for (const k of tr) { /* restore original easing for calculation */ }
  // original easing = ibE when present (from previous run), else e
  const src = JSON.parse(JSON.stringify(l0.tracks || {}));
  for (const tr of Object.values(src)) for (let i = tr.length - 1; i >= 0; i--) if (tr[i].ib) tr.splice(i, 1);
  const res = await compute(src, n, easing);
  let added = 0;
  H.tx('Auto inbetween', () => {
    const l = layerById(layerId); if (!l) return; clearInbetweens(l);
    for (const [name, add] of Object.entries(res.out)) {
      const tr = l.tracks[name]; if (!tr) continue;
      for (const k of tr) { if (!k.ib && k.e !== 'hold') { k.ibE = k.e || 'easeInOut'; } }
      // only flatten key easing for segments we filled
      const filledStarts = new Set(); for (const a of add) { let prev = null; for (const k of tr) { if (k.f < a.f && !k.ib) prev = k; } if (prev) filledStarts.add(prev); }
      for (const k of tr) if (!filledStarts.has(k) && k.ibE) { delete k.ibE; }
      for (const k of filledStarts) k.e = 'linear';
      for (const a of add) { tr.push({ ...a }); added++; }
      tr.sort((a, b) => a.f - b.f);
    }
  });
  return added;
}
